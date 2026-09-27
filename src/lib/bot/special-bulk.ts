import type { Pool } from "pg";
import { telegramApi } from "../telegram/api.ts";
import { getGroupLanguage, type BotLang } from "./i18n.ts";
import { bindPanelMessage } from "./panel-session.ts";
import { ensureSpecialUsersSchema, sweepSpecialUsers } from "./special-users.ts";

type TgUser={id:number;first_name?:string;username?:string};
type TgChat={id:number;type:string;title?:string;username?:string};
type TgMessage={message_id:number;chat:TgChat;from?:TgUser;text?:string;caption?:string;reply_to_message?:{from?:TgUser}};
type TgCallback={id:string;from:TgUser;message?:TgMessage;data?:string};

type BulkMode="set"|"extend"|"reduce"|"remove";
type BulkPolicy="replace"|"extend"|"skip";
type BulkStep="users"|"duration"|"confirm";

type BulkItem={
  input:string;
  userId:number|null;
  username?:string;
  firstName?:string;
  resolution:"valid"|"unresolved"|"duplicate";
  reason?:string;
  specialStatus?:string;
  expiresAt?:string|null;
};

type BulkSession={
  groupId:number;
  actorId:number;
  mode:BulkMode;
  step:BulkStep;
  items:BulkItem[];
  durationSeconds:number|null;
  policy:BulkPolicy;
  expires:number;
};

const sessions=new Map<number,BulkSession>();
const BULK_MAX=50;
const TTL=10*60*1000;

function digits(v:string){
  return String(v??"")
    .replace(/[۰-۹]/g,d=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g,d=>String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}
function norm(v:string){return digits(v).replace(/\u200c/g," ").trim().replace(/\s+/g," ").toLowerCase();}
function strip(v:string){return norm(v).replace(/^[\\/!.]+/,"").trim();}
function tr(lang:BotLang,fa:string,en:string){return lang==="fa"?fa:en;}
function kb(rows:any[][]){return {inline_keyboard:rows};}
function actorName(u:TgUser){return u.username?"@"+u.username:(u.first_name||String(u.id));}
function left(v:unknown){return v?Math.max(0,Math.floor((new Date(String(v)).getTime()-Date.now())/1000)):0;}
function fmtSec(sec:number,lang:BotLang){
  if(sec<=0)return tr(lang,"بدون انقضا","Unlimited");
  const d=Math.floor(sec/86400),h=Math.floor(sec%86400/3600),m=Math.floor(sec%3600/60);
  const out:string[]=[];
  if(d)out.push(lang==="fa"?d+" روز":d+"d");
  if(h)out.push(lang==="fa"?h+" ساعت":h+"h");
  if(m&&!d&&!h)out.push(lang==="fa"?m+" دقیقه":m+"m");
  return out.join(lang==="fa"?" و ":" ")||tr(lang,"کمتر از یک دقیقه","<1m");
}
function parseDuration(v:string):number|null{
  const s=norm(v);
  if(/^(بدون ?انقضا|بی ?نهایت|دائمی|unlimited|forever|permanent)$/.test(s))return 0;
  const m=s.match(/^(\d+(?:\.\d+)?)\s*(ثانیه|second|seconds|s|دقیقه|minute|minutes|min|m|ساعت|hour|hours|h|روز|day|days|d)$/);
  if(!m)return null;
  const n=Number(m[1]);
  if(!Number.isFinite(n)||n<=0)return null;
  const mult=/^(ثانیه|second|seconds|s)$/.test(m[2])?1:/^(دقیقه|minute|minutes|min|m)$/.test(m[2])?60:/^(ساعت|hour|hours|h)$/.test(m[2])?3600:86400;
  return Math.round(n*mult);
}
async function isAdmin(chatId:number,userId:number,ownerIds:string[]){
  if(ownerIds.includes(String(userId)))return true;
  const r=await telegramApi<any>("getChatMember",{chat_id:chatId,user_id:userId});
  return !!(r.ok&&["creator","administrator"].includes(String(r.result?.status||"")));
}
async function ensureBulkSchema(pool:Pool){
  await ensureSpecialUsersSchema(pool);
  await pool.query(`CREATE TABLE IF NOT EXISTS special_bulk_operations(
    id BIGSERIAL PRIMARY KEY,
    group_id BIGINT NOT NULL,
    actor_id BIGINT NOT NULL,
    mode TEXT NOT NULL CHECK(mode IN('set','extend','reduce','remove')),
    policy TEXT NOT NULL CHECK(policy IN('replace','extend','skip')),
    requested_count INTEGER NOT NULL DEFAULT 0,
    resolved_count INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    duration_seconds BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS special_bulk_operation_items(
    id BIGSERIAL PRIMARY KEY,
    operation_id BIGINT NOT NULL REFERENCES special_bulk_operations(id) ON DELETE CASCADE,
    input_value TEXT NOT NULL,
    user_id BIGINT,
    status TEXT NOT NULL CHECK(status IN('success','skipped','failed')),
    action_type TEXT,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query("CREATE INDEX IF NOT EXISTS idx_special_bulk_ops_group ON special_bulk_operations(group_id,created_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_special_bulk_items_op ON special_bulk_operation_items(operation_id,created_at)");
}
async function userInfo(chatId:number,userId:number){
  const r=await telegramApi<any>("getChatMember",{chat_id:chatId,user_id:userId});
  if(!r.ok)return null;
  return {user:r.result?.user as TgUser,status:String(r.result?.status||"member")};
}
async function observedUsername(pool:Pool,username:string){
  const clean=username.replace(/^@/,"").trim().toLowerCase();
  if(!clean)return null;
  const c=await pool.query<any>(
    "SELECT user_id,username,first_name FROM bot_customers WHERE lower(username)=lower($1) ORDER BY last_active_at DESC NULLS LAST LIMIT 1",
    [clean],
  ).catch(()=>({rows:[]}));
  if(c.rows[0])return c.rows[0];
  const s=await pool.query<any>(
    "SELECT user_id,username,first_name FROM special_users WHERE lower(username)=lower($1) ORDER BY updated_at DESC LIMIT 1",
    [clean],
  ).catch(()=>({rows:[]}));
  return s.rows[0]??null;
}
function cleanBulkLine(line:string){
  return line
    .replace(/^\s*(?:[-•*]|\d+[.)])\s*/,"")
    .trim()
    .split(/\s+/)[0]
    .trim();
}
function isNumericId(v:string){
  const n=Number(digits(v).replace(/^@/,""));
  return /^\d+$/.test(digits(v).replace(/^@/,""))&&Number.isSafeInteger(n)&&n>0;
}
async function resolveOne(pool:Pool,groupId:number,input:string):Promise<BulkItem>{
  const token=cleanBulkLine(input);
  if(!token)return {input,userId:null,resolution:"unresolved",reason:"ورودی خالی است."};
  if(isNumericId(token)){
    const userId=Number(digits(token));
    const info=await userInfo(groupId,userId);
    if(!info)return {input,userId:null,resolution:"unresolved",reason:"کاربر در گروه پیدا نشد."};
    return {input,userId,username:info.user?.username,firstName:info.user?.first_name,resolution:"valid"};
  }
  if(/^@?[a-zA-Z0-9_]{5,32}$/.test(token)){
    const observed=await observedUsername(pool,token);
    if(!observed){
      return {input,userId:null,resolution:"unresolved",reason:"نام کاربری هنوز توسط ربات مشاهده نشده است."};
    }
    const userId=Number(observed.user_id);
    if(!Number.isSafeInteger(userId)||userId<=0){
      return {input,userId:null,resolution:"unresolved",reason:"شناسه کاربر معتبر نیست."};
    }
    const info=await userInfo(groupId,userId);
    if(!info)return {input,userId:null,resolution:"unresolved",reason:"کاربر با این نام کاربری در گروه پیدا نشد."};
    return {input,userId,username:info.user?.username??observed.username,firstName:info.user?.first_name??observed.first_name,resolution:"valid"};
  }
  return {input,userId:null,resolution:"unresolved",reason:"فرمت نام کاربری یا آیدی معتبر نیست."};
}
async function resolveItems(pool:Pool,groupId:number,raw:string){
  const lines=String(raw??"").split(/\r?\n/).map(cleanBulkLine).filter(Boolean);
  if(lines.length===0)return {items:[] as BulkItem[],error:"هیچ آیدی یا نام کاربری دریافت نشد."};
  if(lines.length>BULK_MAX)return {items:[] as BulkItem[],error:`حداکثر ${BULK_MAX} کاربر در هر عملیات دسته‌جمعی مجاز است.`};
  const seen=new Set<string>(),items:BulkItem[]=new Array(lines.length);
  let cursor=0;
  const worker=async()=>{
    while(cursor<lines.length){
      const i=cursor++;
      const key=norm(lines[i]);
      if(seen.has(key)){
        items[i]={input:lines[i],userId:null,resolution:"duplicate",reason:"تکراری است."};
        continue;
      }
      seen.add(key);
      items[i]=await resolveOne(pool,groupId,lines[i]);
    }
  };
  await Promise.all(Array.from({length:Math.min(5,lines.length)},()=>worker()));
  const ids=[...new Set(items.filter(x=>x.resolution==="valid"&&x.userId).map(x=>Number(x.userId)))];
  if(ids.length){
    const r=await pool.query<any>(
      "SELECT user_id,status,expires_at FROM special_users WHERE group_id=$1 AND user_id=ANY($2::bigint[])",
      [groupId,ids],
    ).catch(()=>({rows:[]}));
    const map=new Map<number,any>(r.rows.map((x:any)=>[Number(x.user_id),x]));
    for(const item of items){
      if(item.resolution!=="valid"||!item.userId)continue;
      const row=map.get(item.userId);
      item.specialStatus=row?.status??"none";
      item.expiresAt=row?.expires_at??null;
    }
  }
  return {items,error:null as string|null};
}
function activeSpecial(item:BulkItem){
  if(item.specialStatus!=="active")return false;
  return !item.expiresAt||new Date(item.expiresAt).getTime()>Date.now();
}
function eligible(item:BulkItem,mode:BulkMode){
  if(item.resolution!=="valid")return false;
  if(mode==="set")return true;
  if(mode==="extend"||mode==="remove")return activeSpecial(item);
  return activeSpecial(item)&&Boolean(item.expiresAt);
}
function counts(s:BulkSession){
  const requested=s.items.length;
  const valid=s.items.filter(x=>x.resolution==="valid").length;
  const unresolved=s.items.filter(x=>x.resolution==="unresolved").length;
  const duplicate=s.items.filter(x=>x.resolution==="duplicate").length;
  const existing=s.items.filter(x=>x.resolution==="valid"&&activeSpecial(x)).length;
  const eligibleCount=s.items.filter(x=>eligible(x,s.mode)).length;
  return {requested,valid,unresolved,duplicate,existing,eligible:eligibleCount};
}
async function sendPanel(pool:Pool,chatId:number,actorId:number,text:string,rows:any[][]){
  const r=await telegramApi("sendMessage",{chat_id:chatId,text,reply_markup:kb(rows)});
  if(r.ok){
    const mid=Number((r.result as any)?.message_id);
    if(Number.isSafeInteger(mid)&&mid>0)await bindPanelMessage(pool,chatId,mid,actorId,"panel").catch(()=>{});
  }
  return r;
}
async function renderMembers(pool:Pool,chatId:number,actorId:number,editMessageId?:number){
  const text="◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Gʀᴏᴜᴘ Mᴇᴍʙᴇʀs\n\n⛂ - مرکز مدیریت اعضا\n⛂ - ابزارهای جستجو، اخطار، سکوت، بن و ویژه آماده است.";
  const rows=[
    [{text:"جستجوی عضو",callback_data:"m:search"},{text:"لیست محدودشده‌ها",callback_data:"m:restricted"}],
    [{text:"اخطار",callback_data:"m:warn"},{text:"سکوت موقت",callback_data:"m:mute"}],
    [{text:"سکوت دائم",callback_data:"m:perm_mute"},{text:"بن عضو",callback_data:"m:ban"}],
    [{text:"اخراج عضو",callback_data:"m:kick"},{text:"کاربران ویژه",callback_data:"sp:list:0"}],
    [{text:"ویژه دسته‌جمعی",callback_data:"spb:start:set"},{text:"عملیات گروهی",callback_data:"m:bulk"}],
    [{text:"‹ بازگشت",callback_data:"c:home"}]
  ];
  if(editMessageId)return telegramApi("editMessageText",{chat_id:chatId,message_id:editMessageId,text,reply_markup:kb(rows)});
  return sendPanel(pool,chatId,actorId,text,rows);
}
async function renderUsersPrompt(pool:Pool,chatId:number,actorId:number,session:BulkSession,editMessageId?:number){
  const lang=await getGroupLanguage(pool,chatId,"fa");
  const mode=tr(lang,session.mode==="set"?"تنظیم ویژه دسته‌جمعی":session.mode==="extend"?"افزایش ویژه دسته‌جمعی":session.mode==="reduce"?"کاهش ویژه دسته‌جمعی":"حذف ویژه دسته‌جمعی",
    session.mode==="set"?"Bulk Special Set":session.mode==="extend"?"Bulk Special Extend":session.mode==="reduce"?"Bulk Special Reduce":"Bulk Special Remove");
  const text=[
    "◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Bᴜʟᴋ Sᴘᴇᴄɪᴀʟ",
    "",
    "⛂ - "+tr(lang,"عملیات","Operation")+" : "+mode,
    session.durationSeconds!==null?"⛂ - "+tr(lang,"مدت آماده","Duration")+" : "+fmtSec(session.durationSeconds,lang):"",
    "",
    "لیست کاربران را ارسال کنید؛ هر کاربر در یک خط:",
    "@username",
    "@username2",
    "123456789",
    "",
    "⛂ - "+tr(lang,"حداکثر","Maximum")+" : "+BULK_MAX+" کاربر",
    "⛂ - "+tr(lang,"فقط اعضای قابل شناسایی گروه اجرا می‌شوند.","Only resolvable group members will be processed.")
  ].filter(Boolean).join("\n");
  const rows=[[{text:"‹ لغو",callback_data:"spb:cancel"}]];
  if(editMessageId)return telegramApi("editMessageText",{chat_id:chatId,message_id:editMessageId,text,reply_markup:kb(rows)});
  return sendPanel(pool,chatId,actorId,text,rows);
}
async function renderDuration(pool:Pool,chatId:number,actorId:number,s:BulkSession,editMessageId?:number){
  const lang=await getGroupLanguage(pool,chatId,"fa"),c=counts(s);
  const text=[
    "◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Bᴜʟᴋ Dᴜʀᴀᴛɪᴏɴ",
    "",
    "⛂ - کاربران ورودی : "+c.requested,
    "⛂ - معتبر : "+c.valid,
    "⛂ - نامشخص : "+c.unresolved,
    "⛂ - تکراری : "+c.duplicate,
    "⛂ - ویژه فعال موجود : "+c.existing,
    "",
    "⛂ - مدت ویژه را انتخاب کنید:"
  ].join("\n");
  const rows:any[][]=[
    [{text:"۱ ساعت",callback_data:"spb:duration:3600"},{text:"۳ ساعت",callback_data:"spb:duration:10800"},{text:"۶ ساعت",callback_data:"spb:duration:21600"}],
    [{text:"۱۲ ساعت",callback_data:"spb:duration:43200"},{text:"۱ روز",callback_data:"spb:duration:86400"},{text:"۷ روز",callback_data:"spb:duration:604800"}],
    [{text:"۳۰ روز",callback_data:"spb:duration:2592000"},{text:"مدت سفارشی",callback_data:"spb:custom_duration"}]
  ];
  if(s.mode==="set")rows.push([{text:"بدون انقضا",callback_data:"spb:duration:0"}]);
  rows.push([{text:"‹ لغو",callback_data:"spb:cancel"}]);
  if(editMessageId)return telegramApi("editMessageText",{chat_id:chatId,message_id:editMessageId,text,reply_markup:kb(rows)});
  return sendPanel(pool,chatId,actorId,text,rows);
}
async function renderConfirm(pool:Pool,chatId:number,actorId:number,s:BulkSession,editMessageId?:number){
  const lang=await getGroupLanguage(pool,chatId,"fa"),c=counts(s);
  const policyLabel=s.policy==="replace"?"جایگزینی مدت":s.policy==="extend"?"افزایش مدت":"بدون تغییر کاربران ویژه فعلی";
  const modeLabel=s.mode==="set"?"تنظیم":s.mode==="extend"?"افزایش":s.mode==="reduce"?"کاهش":"حذف";
  const invalid=s.items.filter(x=>x.resolution!=="valid"||!eligible(x,s.mode)).slice(0,8);
  const text=[
    "◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Bᴜʟᴋ Cᴏɴғɪʀᴍ",
    "",
    "⛂ - عملیات : "+modeLabel,
    "⛂ - تعداد ورودی : "+c.requested,
    "⛂ - معتبر : "+c.valid,
    "⛂ - قابل اجرا : "+c.eligible,
    "⛂ - نامشخص/نامعتبر : "+c.unresolved,
    "⛂ - تکراری : "+c.duplicate,
    "⛂ - ویژه فعال موجود : "+c.existing,
    s.mode!=="remove"?"⛂ - مدت : "+fmtSec(s.durationSeconds??0,lang):"",
    s.mode==="set"?"⛂ - سیاست اعضای ویژه فعلی : "+policyLabel:"",
    "",
    invalid.length?"⛂ - موارد خارج از اجرا:\n"+invalid.map((x,i)=>String(i+1).padStart(2,"0")+" · "+x.input+" — "+(x.reason||"ویژه فعال ندارد")).join("\n"):"",
    "",
    "⚠️ "+tr(lang,"این مرحله «تأیید اصلی» است؛ بعد از تأیید عملیات اجرا می‌شود.","This is the final confirmation; the operation will run after approval.")
  ].filter(Boolean).join("\n");
  const rows:any[][]=[];
  if(s.mode==="set"&&c.existing>0){
    rows.push([
      {text:"جایگزینی مدت",callback_data:"spb:policy:replace"},
      {text:"افزایش مدت",callback_data:"spb:policy:extend"},
      {text:"بدون تغییر",callback_data:"spb:policy:skip"}
    ]);
  }
  if(c.eligible>0){
    rows.push([{text:"✓ تأیید اصلی",callback_data:"spb:confirm"}]);
  }
  rows.push([{text:"✕ لغو عملیات",callback_data:"spb:cancel"}]);
  if(editMessageId)return telegramApi("editMessageText",{chat_id:chatId,message_id:editMessageId,text,reply_markup:kb(rows)});
  return sendPanel(pool,chatId,actorId,text,rows);
}
async function currentSpecial(pool:Pool,groupId:number,userId:number){
  return (await pool.query<any>("SELECT * FROM special_users WHERE group_id=$1 AND user_id=$2 LIMIT 1",[groupId,userId])).rows[0]??null;
}
async function insertEvent(pool:Pool,o:any){
  await pool.query(
    "INSERT INTO special_user_events(group_id,user_id,action_type,duration_seconds,previous_expires_at,new_expires_at,actor_id,actor_name,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [o.groupId,o.userId,o.action,o.durationSeconds??null,o.previous??null,o.next??null,o.actorId,o.actorName,o.reason??null],
  );
}
async function applyBulkItem(pool:Pool,s:BulkSession,item:BulkItem){
  if(!item.userId)return {status:"failed" as const,error:item.reason||"کاربر معتبر نیست."};
  const info=await userInfo(s.groupId,item.userId);
  if(!info)return {status:"failed" as const,error:"کاربر دیگر در گروه پیدا نشد."};
  const now=Date.now(),cur=await currentSpecial(pool,s.groupId,item.userId);
  const active=!!cur&&cur.status==="active"&&(!cur.expires_at||new Date(cur.expires_at).getTime()>now);
  const actor=item.username||item.firstName||String(s.actorId);
  const sec=s.durationSeconds??0;

  if(s.mode==="remove"){
    if(!active)return {status:"failed" as const,error:"این کاربر ویژه فعال ندارد."};
    await pool.query("UPDATE special_users SET status='removed',expires_at=NULL,updated_by=$3,updated_at=NOW() WHERE group_id=$1 AND user_id=$2",[s.groupId,item.userId,s.actorId]);
    await insertEvent(pool,{groupId:s.groupId,userId:item.userId,action:"remove",previous:cur.expires_at,actorId:s.actorId,actorName:actor,reason:"حذف دسته‌جمعی توسط مدیر"});
    return {status:"success" as const,error:null};
  }

  if(sec<0||!Number.isFinite(sec))return {status:"failed" as const,error:"مدت نامعتبر است."};
  if(s.mode!=="set"&&sec<=0)return {status:"failed" as const,error:"برای افزایش یا کاهش، مدت باید بیشتر از صفر باشد."};

  if(s.mode==="extend"&&!active)return {status:"failed" as const,error:"این کاربر ویژه فعال ندارد."};
  if(s.mode==="reduce"&&(!active||!cur?.expires_at))return {status:"failed" as const,error:"ویژه این کاربر دائمی است یا ویژه فعال ندارد."};

  if(s.mode==="set"&&s.policy==="skip"&&active){
    return {status:"skipped" as const,error:"ویژه فعلی بدون تغییر باقی ماند."};
  }

  let action:"set"|"extend"|"reduce";
  let next:Date|null;
  let status="active";
  const previous=cur?.expires_at??null;

  if(s.mode==="set"&&s.policy==="extend"&&active){
    if(sec===0){
      if(!cur?.expires_at)return {status:"skipped" as const,error:"ویژه فعلی دائمی است."};
      next=null;
      action="set";
    }else{
      if(!cur?.expires_at)return {status:"skipped" as const,error:"ویژه فعلی دائمی است."};
      next=new Date(new Date(cur.expires_at).getTime()+sec*1000);
      action="extend";
    }
  }else if(s.mode==="extend"){
    if(!cur?.expires_at)return {status:"skipped" as const,error:"ویژه فعلی دائمی است."};
    next=new Date(new Date(cur.expires_at).getTime()+sec*1000);
    action="extend";
  }else if(s.mode==="reduce"){
    const t=new Date(cur!.expires_at).getTime()-sec*1000;
    if(t<=now){next=new Date(now);status="expired";}else next=new Date(t);
    action="reduce";
  }else{
    next=sec===0?null:new Date(now+sec*1000);
    action="set";
  }

  if(cur){
    await pool.query(
      "UPDATE special_users SET first_name=$3,username=$4,status=$5,starts_at=CASE WHEN $5='active' AND $6='set' THEN NOW() ELSE starts_at END,expires_at=$7,updated_by=$8,updated_at=NOW(),reason=$9 WHERE group_id=$1 AND user_id=$2",
      [s.groupId,item.userId,info.user?.first_name??null,info.user?.username??null,status,action,next,s.actorId,s.mode==="set"?"تنظیم دسته‌جمعی ویژه":s.mode==="extend"?"افزایش دسته‌جمعی ویژه":"کاهش دسته‌جمعی ویژه"],
    );
  }else{
    await pool.query(
      "INSERT INTO special_users(group_id,user_id,first_name,username,status,starts_at,expires_at,created_by,updated_by,reason) VALUES($1,$2,$3,$4,$5,NOW(),$6,$7,$7,$8)",
      [s.groupId,item.userId,info.user?.first_name??null,info.user?.username??null,status,next,s.actorId,"تنظیم دسته‌جمعی ویژه"],
    );
  }
  await insertEvent(pool,{groupId:s.groupId,userId:item.userId,action,durationSeconds:sec,previous,next,actorId:s.actorId,actorName:actor,reason:s.mode==="set"?"تنظیم دسته‌جمعی ویژه":s.mode==="extend"?"افزایش دسته‌جمعی ویژه":"کاهش دسته‌جمعی ویژه"});
  return {status:"success" as const,error:null};
}
async function executeBulk(pool:Pool,s:BulkSession){
  await ensureBulkSchema(pool);
  await sweepSpecialUsers(pool);
  const op=await pool.query<any>(
    "INSERT INTO special_bulk_operations(group_id,actor_id,mode,policy,requested_count,duration_seconds) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
    [s.groupId,s.actorId,s.mode,s.policy,s.items.length,s.durationSeconds],
  );
  const opId=Number(op.rows[0]?.id||0);
  let success=0,skipped=0,failed=0,resolved=0;
  const failures:string[]=[];
  for(const item of s.items){
    if(item.resolution==="valid")resolved++;
    let result:{status:"success"|"skipped"|"failed";error:string|null};
    try{
      if(item.resolution==="duplicate"){
        result={status:"skipped",error:"ورودی تکراری."};
      }else if(item.resolution!=="valid"){
        result={status:"failed",error:item.reason||"کاربر قابل شناسایی نیست."};
      }else{
        result=await applyBulkItem(pool,s,item);
      }
    }catch(error){
      console.error("[special-bulk] item failed",error);
      result={status:"failed",error:"خطای داخلی در اجرای این کاربر."};
    }
    if(result.status==="success")success++;
    else if(result.status==="skipped")skipped++;
    else {failed++; if(failures.length<8)failures.push(item.input+" — "+(result.error||"خطا"));}
    await pool.query(
      "INSERT INTO special_bulk_operation_items(operation_id,input_value,user_id,status,action_type,error) VALUES($1,$2,$3,$4,$5,$6)",
      [opId,item.input,item.userId??null,result.status,s.mode,result.error],
    ).catch(()=>{});
  }
  await pool.query(
    "UPDATE special_bulk_operations SET resolved_count=$2,success_count=$3,skipped_count=$4,failed_count=$5,finished_at=NOW() WHERE id=$1",
    [opId,resolved,success,skipped,failed],
  );
  return {opId,success,skipped,failed,resolved,failures};
}
async function renderResult(pool:Pool,chatId:number,actorId:number,s:BulkSession,result:any,editMessageId?:number){
  const lang=await getGroupLanguage(pool,chatId,"fa");
  const text=[
    "◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Bᴜʟᴋ Rᴇsᴜʟᴛ",
    "",
    "✓ "+tr(lang,"عملیات دسته‌جمعی اجرا شد.","Bulk operation completed."),
    "⛂ - "+tr(lang,"شناسه عملیات","Operation ID")+" : "+result.opId,
    "⛂ - "+tr(lang,"شناسایی‌شده","Resolved")+" : "+result.resolved,
    "⛂ - "+tr(lang,"موفق","Success")+" : "+result.success,
    "⛂ - "+tr(lang,"بدون تغییر","Skipped")+" : "+result.skipped,
    "⛂ - "+tr(lang,"ناموفق","Failed")+" : "+result.failed,
    result.failures?.length?"":""
  ].filter(Boolean).join("\n")+(result.failures?.length?"\n\n⛂ - موارد ناموفق:\n"+result.failures.join("\n"):"");
  const rows=[
    [{text:"ویژه دسته‌جمعی جدید",callback_data:"spb:start:set"},{text:"لیست ویژه‌ها",callback_data:"sp:list:0"}],
    [{text:"‹ مدیریت اعضا",callback_data:"c:members"}]
  ];
  if(editMessageId)return telegramApi("editMessageText",{chat_id:chatId,message_id:editMessageId,text,reply_markup:kb(rows)});
  return sendPanel(pool,chatId,actorId,text,rows);
}
async function startFlow(pool:Pool,chatId:number,actorId:number,mode:BulkMode,preset:number|null,editMessageId?:number){
  if((mode==="extend"||mode==="reduce")&&preset===0){
    if(editMessageId)return telegramApi("editMessageText",{chat_id:chatId,message_id:editMessageId,text:"✗ برای افزایش یا کاهش، «بدون انقضا» معتبر نیست.",reply_markup:kb([[{text:"‹ لغو",callback_data:"spb:cancel"}]])});
    return telegramApi("sendMessage",{chat_id:chatId,text:"✗ برای افزایش یا کاهش، مدت باید بیشتر از صفر باشد."});
  }
  const s:BulkSession={groupId:chatId,actorId,mode,step:"users",items:[],durationSeconds:preset,policy:"replace",expires:Date.now()+TTL};
  sessions.set(actorId,s);
  return renderUsersPrompt(pool,chatId,actorId,s,editMessageId);
}

export async function handleSpecialBulkCommand(pool:Pool,msg:TgMessage,ownerIds:string[]){
  if(!msg.from||msg.chat.type==="private")return false;
  const raw=strip(msg.text||msg.caption||"");if(!raw)return false;
  let mode:BulkMode|null=null,durationText="";
  const exactSet=new Set(["ویژه دسته جمعی","ویژه دسته‌جمعی","special bulk","تنظیم ویژه گروهی","setspecialbulk"]);
  const exactExtend=new Set(["افزایش ویژه گروهی","افزایش ویژه دسته جمعی","increase special bulk","extendspecialbulk","special bulk extend"]);
  const exactReduce=new Set(["کاهش ویژه گروهی","کاهش ویژه دسته جمعی","decrease special bulk","reducespecialbulk","special bulk reduce"]);
  const exactRemove=new Set(["حذف ویژه گروهی","حذف ویژه دسته جمعی","remove special bulk","removespecialbulk","special bulk remove"]);
  if(exactSet.has(raw)){mode="set";}
  else if(exactExtend.has(raw)){mode="extend";}
  else if(exactReduce.has(raw)){mode="reduce";}
  else if(exactRemove.has(raw)){mode="remove";}
  else if(raw.startsWith("افزایش ویژه گروهی ")||raw.startsWith("extendspecialbulk ")||raw.startsWith("increase special bulk ")||raw.startsWith("special bulk extend ")){
    mode="extend";
    durationText=raw.startsWith("extendspecialbulk ")?raw.slice("extendspecialbulk ".length):raw.startsWith("increase special bulk ")?raw.slice("increase special bulk ".length):raw.startsWith("special bulk extend ")?raw.slice("special bulk extend ".length):raw.slice(raw.indexOf(" ") + 1);
  }else if(raw.startsWith("تنظیم ویژه گروهی ")||raw.startsWith("تنظیم ویژه دسته جمعی ")||raw.startsWith("setspecialbulk ")||raw.startsWith("special bulk ")){
    mode="set";
    durationText=raw.startsWith("setspecialbulk ")?raw.slice("setspecialbulk ".length):raw.startsWith("special bulk ")?raw.slice("special bulk ".length):raw.slice(raw.indexOf(" ") + 1);
  }  }else if(raw.startsWith("کاهش ویژه گروهی ")||raw.startsWith("reducespecialbulk ")||raw.startsWith("decrease special bulk ")||raw.startsWith("special bulk reduce ")){
    mode="reduce";
    durationText=raw.startsWith("reducespecialbulk ")?raw.slice("reducespecialbulk ".length):raw.startsWith("decrease special bulk ")?raw.slice("decrease special bulk ".length):raw.startsWith("special bulk reduce ")?raw.slice("special bulk reduce ".length):raw.slice(raw.indexOf(" ") + 1);
  }
  if(!mode)return false;
  if(!(await isAdmin(msg.chat.id,msg.from.id,ownerIds)))return false;
  let preset:number|null=null;
  if(mode!=="remove"&&durationText){
    preset=parseDuration(durationText);
    if(preset===null){
      await telegramApi("sendMessage",{chat_id:msg.chat.id,text:"✗ مدت نامعتبر است. نمونه: 3 ساعت، 90 دقیقه، 1 روز یا بدون انقضا.",reply_to_message_id:msg.message_id});
      return true;
    }
  }
  await ensureBulkSchema(pool);
  await startFlow(pool,msg.chat.id,msg.from.id,mode,preset);
  return true;
}
export async function handleSpecialBulkTextInput(pool:Pool,msg:TgMessage){
  if(!msg.from||msg.chat.type==="private")return false;
  const s=sessions.get(msg.from.id);
  if(!s||s.expires<Date.now()){if(s) sessions.delete(msg.from.id);return false;}
  if(s.groupId!==msg.chat.id)return false;
  const messageText=String(msg.text||msg.caption||"");
  if(!messageText.trim())return true;
  s.expires=Date.now()+TTL;

  if(s.step==="users"){
    const raw=messageText.replace(/\\r/g,"").trim();
    const resolved=await resolveItems(pool,s.groupId,raw);
    if(resolved.error){
      await telegramApi("sendMessage",{chat_id:s.groupId,text:"✗ "+resolved.error,reply_to_message_id:msg.message_id});
      return true;
    }
    s.items=resolved.items;
    s.step=s.mode==="remove"||(s.durationSeconds!==null)?"confirm":"duration";
    if(s.step==="duration")await renderDuration(pool,s.groupId,s.actorId,s);
    else await renderConfirm(pool,s.groupId,s.actorId,s);
    return true;
  }

  if(s.step==="duration"){
    const sec=parseDuration(raw);
    if(sec===null||(s.mode!=="set"&&sec===0)){
      await telegramApi("sendMessage",{chat_id:s.groupId,text:s.mode==="set"?"✗ مدت نامعتبر است. نمونه: 3 ساعت، 1 روز یا بدون انقضا.":"✗ برای این عملیات مدت باید بیشتر از صفر باشد.",reply_to_message_id:msg.message_id});
      return true;
    }
    s.durationSeconds=sec;s.step="confirm";
    await renderConfirm(pool,s.groupId,s.actorId,s);
    return true;
  }
  return true;
}

export async function handleSpecialBulkCallback(pool:Pool,cb:TgCallback,ownerIds:string[]){
  if(!cb.message||!String(cb.data||"").startsWith("spb:"))return false;
  const chatId=cb.message.chat.id,uid=cb.from.id;
  if(!(await isAdmin(chatId,uid,ownerIds)))return true;
  await telegramApi("answerCallbackQuery",{callback_query_id:cb.id}).catch(()=>{});
  const p=String(cb.data).split(":"),action=p[1];
  const s=sessions.get(uid);

  if(action==="start"){
    const mode=(p[2]||"set") as BulkMode;
    if(!["set","extend","reduce","remove"].includes(mode))return true;
    await ensureBulkSchema(pool);
    await startFlow(pool,chatId,uid,mode,null,cb.message.message_id);
    return true;
  }
  if(action==="cancel"){
    sessions.delete(uid);
    await renderMembers(pool,chatId,uid,cb.message.message_id);
    return true;
  }
  if(!s||s.groupId!==chatId||s.expires<Date.now()){
    sessions.delete(uid);
    await telegramApi("editMessageText",{chat_id:chatId,message_id:cb.message.message_id,text:"✗ نشست ویژه دسته‌جمعی منقضی شده است.",reply_markup:kb([[{text:"ویژه دسته‌جمعی",callback_data:"spb:start:set"}],[{text:"‹ مدیریت اعضا",callback_data:"c:members"}]])});
    return true;
  }
  s.expires=Date.now()+TTL;
  if(action==="duration"){
    const sec=Number(p[2]);
    if(!Number.isSafeInteger(sec)||sec<0||(s.mode!=="set"&&sec===0))return true;
    s.durationSeconds=sec;s.step="confirm";
    await renderConfirm(pool,chatId,uid,s,cb.message.message_id);
    return true;
  }
  if(action==="custom_duration"){
    s.step="duration";
    await telegramApi("editMessageText",{chat_id:chatId,message_id:cb.message.message_id,text:"◈ مدت سفارشی ویژه دسته‌جمعی\n\n⛂ - مدت را ارسال کنید.\n\nنمونه: 3 ساعت\n90 دقیقه\n1 روز\n"+(s.mode==="set"?"بدون انقضا":""),reply_markup:kb([[{text:"‹ لغو",callback_data:"spb:cancel"}]])});
    return true;
  }
  if(action==="policy"){
    const policy=(p[2]||"replace") as BulkPolicy;
    if(!["replace","extend","skip"].includes(policy))return true;
    s.policy=policy;s.step="confirm";
    await renderConfirm(pool,chatId,uid,s,cb.message.message_id);
    return true;
  }
  if(action==="confirm"){
    if(s.step!=="confirm")return true;
    const c=counts(s);
    if(c.eligible<=0){
      await renderConfirm(pool,chatId,uid,s,cb.message.message_id);
      return true;
    }
    sessions.delete(uid);
    const result=await executeBulk(pool,s);
    await renderResult(pool,chatId,uid,s,result,cb.message.message_id);
    return true;
  }
  return true;
}
