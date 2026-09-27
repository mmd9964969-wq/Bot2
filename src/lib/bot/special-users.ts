import type { Pool } from "pg";
import { telegramApi } from "../telegram/api.ts";
import { getGroupLanguage, type BotLang } from "./i18n.ts";
import { bindPanelMessage } from "./panel-session.ts";

type TgUser={id:number;first_name?:string;username?:string};
type TgChat={id:number;type:string;title?:string;username?:string};
type TgMessage={message_id:number;chat:TgChat;from?:TgUser;text?:string;caption?:string;reply_to_message?:{from?:TgUser}};
type TgCallback={id:string;from:TgUser;message?:TgMessage;data?:string};
type Mode="set"|"extend"|"reduce";
type SpecialSession={groupId:number;targetId:number;actorId:number;mode:Mode;expires:number};

const sessions=new Map<number,SpecialSession>();

function digits(v:string){
  return String(v??"").replace(/[۰-۹]/g,d=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g,d=>String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}
function norm(v:string){return digits(v).replace(/\u200c/g," ").trim().replace(/\s+/g," ").toLowerCase();}
function strip(v:string){return norm(v).replace(/^[\\/!.]+/,"").trim();}
function tr(lang:BotLang,fa:string,en:string){return lang==="fa"?fa:en;}
function kb(rows:any[][]){return {inline_keyboard:rows};}

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
function fmtSec(sec:number,lang:BotLang){
  if(sec<=0)return tr(lang,"بدون انقضا","Unlimited");
  const d=Math.floor(sec/86400),h=Math.floor(sec%86400/3600),m=Math.floor(sec%3600/60);
  const out:string[]=[];
  if(d)out.push(lang==="fa"?d+" روز":d+"d");
  if(h)out.push(lang==="fa"?h+" ساعت":h+"h");
  if(m&&!d&&!h)out.push(lang==="fa"?m+" دقیقه":m+"m");
  return out.join(lang==="fa"?" و ":" ")||tr(lang,"کمتر از یک دقیقه","<1m");
}
function fmtDate(v:unknown,lang:BotLang){
  if(!v)return "—";
  const d=new Date(String(v)); if(Number.isNaN(d.getTime()))return "—";
  return new Intl.DateTimeFormat(lang==="fa"?"fa-IR":"en-GB",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Tehran"}).format(d);
}
function left(v:unknown){return v?Math.max(0,Math.floor((new Date(String(v)).getTime()-Date.now())/1000)):0;}
function actorName(u:TgUser){return u.username?"@"+u.username:(u.first_name||String(u.id));}

async function isAdmin(chatId:number,userId:number,ownerIds:string[]){
  if(ownerIds.includes(String(userId)))return true;
  const r=await telegramApi<any>("getChatMember",{chat_id:chatId,user_id:userId});
  return !!(r.ok&&["creator","administrator"].includes(String(r.result?.status||"")));
}

export async function ensureSpecialUsersSchema(pool:Pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS special_users(
    id BIGSERIAL PRIMARY KEY,group_id BIGINT NOT NULL,user_id BIGINT NOT NULL,
    first_name TEXT,username TEXT,status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','expired','removed')),
    starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),expires_at TIMESTAMPTZ,
    created_by BIGINT NOT NULL,updated_by BIGINT,reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(group_id,user_id)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS special_user_events(
    id BIGSERIAL PRIMARY KEY,group_id BIGINT NOT NULL,user_id BIGINT NOT NULL,
    action_type TEXT NOT NULL CHECK(action_type IN('set','extend','reduce','remove','expire')),
    duration_seconds BIGINT,previous_expires_at TIMESTAMPTZ,new_expires_at TIMESTAMPTZ,
    actor_id BIGINT,actor_name TEXT,reason TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query("CREATE INDEX IF NOT EXISTS idx_special_users_active ON special_users(group_id,status,expires_at)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_special_events_user ON special_user_events(group_id,user_id,created_at DESC)");
}

export async function sweepSpecialUsers(pool:Pool){
  await ensureSpecialUsersSchema(pool);
  const r=await pool.query("UPDATE special_users SET status='expired',updated_at=NOW() WHERE status='active' AND expires_at IS NOT NULL AND expires_at<=NOW() RETURNING group_id,user_id,expires_at");
  for(const row of r.rows){
    await pool.query("INSERT INTO special_user_events(group_id,user_id,action_type,previous_expires_at,reason) VALUES($1,$2,'expire',$3,$4)",
      [row.group_id,row.user_id,row.expires_at,"انقضای خودکار"]).catch(()=>{});
  }
}
async function userInfo(chatId:number,userId:number){
  const r=await telegramApi<any>("getChatMember",{chat_id:chatId,user_id:userId});
  if(!r.ok)return null;
  return {user:r.result?.user as TgUser,status:String(r.result?.status||"member")};
}
async function event(pool:Pool,o:any){
  await pool.query("INSERT INTO special_user_events(group_id,user_id,action_type,duration_seconds,previous_expires_at,new_expires_at,actor_id,actor_name,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [o.groupId,o.userId,o.action,o.durationSeconds??null,o.previous??null,o.next??null,o.actorId,o.actorName,o.reason??null]);
}
async function apply(pool:Pool,groupId:number,userId:number,actorId:number,actorName:string,sec:number,mode:Mode,reason:string){
  await sweepSpecialUsers(pool);
  const i=await userInfo(groupId,userId); if(!i)return {ok:false,error:"کاربر در گروه پیدا نشد."};
  const cur=(await pool.query<any>("SELECT * FROM special_users WHERE group_id=$1 AND user_id=$2 LIMIT 1",[groupId,userId])).rows[0];
  const now=Date.now(),previous=cur?.expires_at??null;
  if(mode==="reduce"&&!cur)return {ok:false,error:"این کاربر ویژه فعال ندارد."};
  if(mode==="reduce"&&cur?.status!=="active")return {ok:false,error:"این کاربر ویژه فعال ندارد."};
  let next:Date|null;
  if(sec===0)next=null;
  else if(mode==="set")next=new Date(now+sec*1000);
  else if(mode==="extend")next=cur?.expires_at&&new Date(cur.expires_at).getTime()>now?new Date(new Date(cur.expires_at).getTime()+sec*1000):new Date(now+sec*1000);
  else{
    if(!cur?.expires_at)return {ok:false,error:"برای ویژه دائمی کاهش مدت معنی ندارد."};
    const t=new Date(cur.expires_at).getTime()-sec*1000;
    if(t<=now){
      await pool.query("UPDATE special_users SET status='expired',expires_at=NOW(),updated_by=$3,updated_at=NOW() WHERE group_id=$1 AND user_id=$2",[groupId,userId,actorId]);
      next=new Date(now);
    }else next=new Date(t);
  }
  const active=mode!=="reduce"||!next||next.getTime()>now;
  if(cur){
    await pool.query("UPDATE special_users SET first_name=$3,username=$4,status=$5,starts_at=CASE WHEN $5='active' AND $6='set' THEN NOW() ELSE starts_at END,expires_at=$7,updated_by=$8,updated_at=NOW(),reason=$9 WHERE group_id=$1 AND user_id=$2",
      [groupId,userId,i.user?.first_name??null,i.user?.username??null,active?"active":"expired",mode,next,actorId,reason]);
  }else{
    await pool.query("INSERT INTO special_users(group_id,user_id,first_name,username,status,starts_at,expires_at,created_by,updated_by,reason) VALUES($1,$2,$3,$4,'active',NOW(),$5,$6,$6,$7)",
      [groupId,userId,i.user?.first_name??null,i.user?.username??null,next,actorId,reason]);
  }
  await event(pool,{groupId,userId,action:mode,durationSeconds:sec,previous,next,actorId,actorName,reason});
  return {ok:true,next,info:i};
}
async function remove(pool:Pool,groupId:number,userId:number,actorId:number,actorName:string){
  await sweepSpecialUsers(pool);
  const cur=(await pool.query<any>("SELECT * FROM special_users WHERE group_id=$1 AND user_id=$2 LIMIT 1",[groupId,userId])).rows[0];
  if(!cur||cur.status!=="active")return {ok:false,error:"این کاربر در حال حاضر ویژه نیست."};
  await pool.query("UPDATE special_users SET status='removed',expires_at=NULL,updated_by=$3,updated_at=NOW() WHERE group_id=$1 AND user_id=$2",[groupId,userId,actorId]);
  await event(pool,{groupId,userId,action:"remove",previous:cur.expires_at,actorId,actorName,reason:"حذف توسط مدیر"});
  return {ok:true};
}
async function sendPanel(pool:Pool,chatId:number,actorId:number,text:string,rows:any[][]){
  const r=await telegramApi("sendMessage",{chat_id:chatId,text,reply_markup:kb(rows)});
  if(r.ok){const mid=Number((r.result as any)?.message_id);if(Number.isSafeInteger(mid)&&mid>0)await bindPanelMessage(pool,chatId,mid,actorId,"panel").catch(()=>{});}
  return r;
}
async function centerText(pool:Pool,chatId:number,targetId:number){
  const lang=await getGroupLanguage(pool,chatId,"fa");
  const i=await userInfo(chatId,targetId); if(!i)return {lang,text:tr(lang,"✗ کاربر در گروه پیدا نشد.","✗ User was not found in this group.")};
  const r=(await pool.query<any>("SELECT * FROM special_users WHERE group_id=$1 AND user_id=$2 LIMIT 1",[chatId,targetId])).rows[0];
  const active=r?.status==="active"&&(!r.expires_at||new Date(r.expires_at).getTime()>Date.now());
  const name=i.user?.username?"@"+i.user.username:(i.user?.first_name||String(targetId));
  const title="◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Sᴘᴇᴄɪᴀʟ Cᴇɴᴛᴇʀ";
  const body=[
    `⛂ - ${tr(lang,"کاربر","User")} : ${name}`,
    `⛂ - ${tr(lang,"نام","Name")} : ${i.user?.first_name||"—"}`,
    `⛂ - ${tr(lang,"شناسه","ID")} : ${targetId}`,
    `⛂ - ${tr(lang,"وضعیت","Status")} : ${i.status==="administrator"||i.status==="creator"?tr(lang,"مدیر","Admin"):tr(lang,"عضو","Member")}`,
    `⛂ - ${tr(lang,"ویژه","Special")} : ${active?"● "+tr(lang,"فعال","Active"):"○ "+tr(lang,"غیرفعال","Inactive")}`,
    `⛂ - ${tr(lang,"مدت","Duration")} : ${active?(r.expires_at?fmtSec(left(r.expires_at),lang):tr(lang,"بدون انقضا","Unlimited")):"—"}`,
    `⛂ - ${tr(lang,"پایان","Expires")} : ${active?fmtDate(r.expires_at,lang):"—"}`,
    "","─────━━───── ◈ ─────━━─────","",
    `⛂ - ${tr(lang,"نوع","Type")} : Special Member`,
    `⛂ - ${tr(lang,"وضعیت عملیات","Operation")} : ${active?tr(lang,"فعال و آماده مدیریت","Active and ready"):tr(lang,"آماده تنظیم","Ready to configure")}`
  ].join("\n");
  const rows=[
    [
      {text:tr(lang,"تنظیم ویژه","Set Special"),callback_data:`sp:set:${targetId}:10800`},
      {text:tr(lang,"تنظیم مدت","Set duration"),callback_data:`sp:custom:${targetId}:set`}
    ],
    [{text:"۱ ساعت",callback_data:`sp:set:${targetId}:3600`},{text:"۳ ساعت",callback_data:`sp:set:${targetId}:10800`},{text:"۶ ساعت",callback_data:`sp:set:${targetId}:21600`}],
    [{text:"۱۲ ساعت",callback_data:`sp:set:${targetId}:43200`},{text:"۱ روز",callback_data:`sp:set:${targetId}:86400`},{text:"۷ روز",callback_data:`sp:set:${targetId}:604800`}],
    [{text:tr(lang,"بدون انقضا","Unlimited"),callback_data:`sp:set:${targetId}:0`},{text:tr(lang,"افزایش +۱ ساعت","Extend +1h"),callback_data:`sp:extend:${targetId}:3600`}],
    [{text:tr(lang,"کاهش ۱ ساعت","Reduce 1h"),callback_data:`sp:reduce:${targetId}:3600`},{text:tr(lang,"حذف ویژه","Remove Special"),callback_data:`sp:remove:${targetId}`}],
    [{text:tr(lang,"سابقه ویژه","Special History"),callback_data:`sp:history:${targetId}:0`},{text:tr(lang,"لیست ویژه‌ها","Special List"),callback_data:"sp:list:0"}],
    [{text:"‹ بازگشت",callback_data:"c:members"}]
  ];
  return {lang,text:title+"\n\n"+body,rows};
}
async function renderCenter(pool:Pool,chatId:number,actorId:number,targetId:number,edit?:{chatId:number;messageId:number}){
  await sweepSpecialUsers(pool); const r=await centerText(pool,chatId,targetId);
  if(edit)return telegramApi("editMessageText",{chat_id:edit.chatId,message_id:edit.messageId,text:r.text,reply_markup:kb(r.rows)});
  return sendPanel(pool,chatId,actorId,r.text,r.rows);
}
async function renderList(pool:Pool,chatId:number,actorId:number,page:number,edit?:{chatId:number;messageId:number},expired=false){
  await sweepSpecialUsers(pool);
  const lang=await getGroupLanguage(pool,chatId,"fa"),size=8,current=Math.max(0,page);
  const where=expired?"status='expired'":"status='active' AND (expires_at IS NULL OR expires_at>NOW())";
  const count=Number((await pool.query("SELECT COUNT(*)::int n FROM special_users WHERE group_id=$1 AND "+where,[chatId])).rows[0]?.n||0);
  const pages=Math.max(1,Math.ceil(count/size)),p=Math.min(current,pages-1);
  const rows=await pool.query("SELECT user_id,first_name,username,expires_at FROM special_users WHERE group_id=$1 AND "+where+" ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END,expires_at ASC,created_at DESC LIMIT $2 OFFSET $3",[chatId,size,p*size]);
  const text=[
    "◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Sᴘᴇᴄɪᴀʟ Lɪsᴛ",
    "",`⛂ - ${tr(lang,expired?"ویژه‌های منقضی":"تعداد ویژه‌ها",expired?"Expired":"Special users")} : ${count}`,`⛂ - ${tr(lang,"صفحه","Page")} : ${p+1}/${pages}`,"","─────━━───── ◈ ─────━━─────","",
    rows.rows.length?rows.rows.map((x:any,i:number)=>`${String(i+1).padStart(2,"0")} · ${x.username?"@"+x.username:(x.first_name||x.user_id)}\n   └ ${x.user_id} · ${x.expires_at?fmtSec(left(x.expires_at),lang):"∞"}`).join("\n\n"):tr(lang,"⛂ - موردی برای نمایش وجود ندارد.","⛂ - Nothing to display.")
  ].join("\n");
  const buttons:any[][]=rows.rows.map((x:any)=>[{text:`${x.username?"@"+x.username:(x.first_name||x.user_id)} · ${x.expires_at?fmtSec(left(x.expires_at),lang):"∞"}`,callback_data:`sp:center:${x.user_id}`}]);
  const nav:any[]=[]; if(p>0)nav.push({text:"‹ قبلی",callback_data:`sp:${expired?"expired":"list"}:${p-1}`});nav.push({text:`${p+1}/${pages}`,callback_data:"sp:noop"});if(p<pages-1)nav.push({text:"بعدی ›",callback_data:`sp:${expired?"expired":"list"}:${p+1}`}); buttons.push(nav);
  buttons.push([{text:tr(lang,"افزودن ویژه","Add Special"),callback_data:"sp:add"},{text:tr(lang,"ویژه‌های منقضی","Expired"),callback_data:"sp:expired:0"}]);
  buttons.push([{text:"‹ بازگشت",callback_data:"c:members"}]);
  if(edit)return telegramApi("editMessageText",{chat_id:edit.chatId,message_id:edit.messageId,text,reply_markup:kb(buttons)});
  return sendPanel(pool,chatId,actorId,text,buttons);
}
async function renderHistory(pool:Pool,chatId:number,actorId:number,targetId:number,page:number,edit?:{chatId:number;messageId:number}){
  const lang=await getGroupLanguage(pool,chatId,"fa"),size=8,p=Math.max(0,page);
  const rows=await pool.query("SELECT action_type,duration_seconds,actor_id,actor_name,created_at FROM special_user_events WHERE group_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT $3 OFFSET $4",[chatId,targetId,size,p*size]);
  const count=Number((await pool.query("SELECT COUNT(*)::int n FROM special_user_events WHERE group_id=$1 AND user_id=$2",[chatId,targetId])).rows[0]?.n||0),pages=Math.max(1,Math.ceil(count/size)),cur=Math.min(p,pages-1);
  const labels:any={set:"تنظیم ویژه",extend:"افزایش مدت",reduce:"کاهش مدت",remove:"حذف ویژه",expire:"انقضای خودکار"};
  const info=await userInfo(chatId,targetId),name=info?.user?.username?"@"+info.user.username:(info?.user?.first_name||String(targetId));
  const body=rows.rows.length?rows.rows.map((x:any,i:number)=>`${String(i+1).padStart(2,"0")} · ${lang==="fa"?(labels[x.action_type]||x.action_type):x.action_type}\n   └ ${x.duration_seconds?fmtSec(Number(x.duration_seconds),lang):"—"} · ${fmtDate(x.created_at,lang)} · ${x.actor_name||x.actor_id||"system"}`).join("\n\n"):tr(lang,"⛂ - سابقه‌ای ثبت نشده است.","⛂ - No history recorded.");
  const text=`◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Sᴘᴇᴄɪᴀʟ Hɪsᴛᴏʀʏ\n\n⛂ - ${tr(lang,"کاربر","User")} : ${name}\n⛂ - ${tr(lang,"شناسه","ID")} : ${targetId}\n\n─────━━───── ◈ ─────━━─────\n\n${body}`;
  const nav:any[]=[];if(cur>0)nav.push({text:"‹ قبلی",callback_data:`sp:history:${targetId}:${cur-1}`});nav.push({text:`${cur+1}/${pages}`,callback_data:"sp:noop"});if(cur<pages-1)nav.push({text:"بعدی ›",callback_data:`sp:history:${targetId}:${cur+1}`});
  const buttons=[nav,[{text:"‹ بازگشت",callback_data:`sp:center:${targetId}`}]];
  if(edit)return telegramApi("editMessageText",{chat_id:edit.chatId,message_id:edit.messageId,text,reply_markup:kb(buttons)});
  return sendPanel(pool,chatId,actorId,text,buttons);
}

export async function handleSpecialCommand(pool:Pool,msg:TgMessage,ownerIds:string[]){
  if(!msg.from||msg.chat.type==="private")return false;
  const raw=strip(msg.text||msg.caption||"");if(!raw)return false;
  const parts=raw.split(" "),first=parts[0],rest=parts.slice(1);
  const isSpecial=(first==="ویژه"||first==="special")&&parts.length===1;
  const isSet=raw==="تنظیم ویژه"||raw==="special set"||raw.startsWith("تنظیم ویژه ")||raw.startsWith("special set ");
  const isRemove=raw==="حذف ویژه"||raw==="special remove";
  const isList=raw==="لیست ویژه"||raw==="فهرست ویژه"||raw==="special list";
  if(!isSpecial&&!isSet&&!isRemove&&!isList)return false;
  if(!(await isAdmin(msg.chat.id,msg.from.id,ownerIds)))return false;
  if(isSpecial){
    const targetId=msg.reply_to_message?.from?.id;
    if(!targetId){await telegramApi("sendMessage",{chat_id:msg.chat.id,text:"✗ برای «ویژه» روی پیام کاربر ریپلای کنید.",reply_to_message_id:msg.message_id});return true;}
    await renderCenter(pool,msg.chat.id,msg.from.id,targetId);return true;
  }
  if(isList){await renderList(pool,msg.chat.id,msg.from.id,0);return true;}
  let targetId=msg.reply_to_message?.from?.id||null;
  let durationText="";
  if(rest.length&&Number.isSafeInteger(Number(digits(rest[0])))&&Number(digits(rest[0]))>0&&rest.length>=3&&!targetId){
    targetId=Number(digits(rest[0]));durationText=rest.slice(1).join(" ");
  }else durationText=rest.join(" ");
  if(!targetId){
    await telegramApi("sendMessage",{chat_id:msg.chat.id,text:"✗ کاربر مشخص نیست. روی پیام او ریپلای کنید یا آیدی عددی بدهید.",reply_to_message_id:msg.message_id});return true;
  }
  if(isRemove){
    await telegramApi("sendMessage",{chat_id:msg.chat.id,text:"◈ حذف ویژه\n\n⛂ - کاربر : "+targetId+"\n⛂ - برای تأیید حذف، پنل تأیید را باز کنید.",reply_markup:kb([[{text:"✓ تأیید حذف",callback_data:`sp:remove_yes:${targetId}`},{text:"لغو",callback_data:`sp:center:${targetId}`}]] )});
    return true;
  }
  if(isSet){
    if(!durationText){await renderCenter(pool,msg.chat.id,msg.from.id,targetId);return true;}
    const sec=parseDuration(durationText);if(sec===null){await telegramApi("sendMessage",{chat_id:msg.chat.id,text:"✗ مدت نامعتبر است. نمونه: 3 ساعت، 90 دقیقه، 1 روز یا بدون انقضا.",reply_to_message_id:msg.message_id});return true;}
    const r=await apply(pool,msg.chat.id,targetId,msg.from.id,actorName(msg.from),sec,"set","تنظیم مستقیم توسط مدیر");
    await telegramApi("sendMessage",{chat_id:msg.chat.id,text:r.ok?"✓ ویژه کاربر تنظیم شد.\n⛂ - کاربر : "+targetId+"\n⛂ - مدت : "+fmtSec(sec,await getGroupLanguage(pool,msg.chat.id,"fa")):"✗ "+r.error,reply_to_message_id:msg.message_id});
    return true;
  }
  return true;
}

export async function handleSpecialTextInput(pool:Pool,msg:TgMessage){
  if(!msg.from||msg.chat.type==="private")return false;
  const s=sessions.get(msg.from.id);if(!s||s.expires<Date.now()){sessions.delete(msg.from.id);return false;}
  if(s.groupId!==msg.chat.id)return false;
  const raw=strip(msg.text||msg.caption||"");
  if(s.targetId===0){
    const targetId=Number(digits(raw));if(!Number.isSafeInteger(targetId)||targetId<=0){await telegramApi("sendMessage",{chat_id:msg.chat.id,text:"✗ آیدی معتبر نیست.",reply_to_message_id:msg.message_id});return true;}
    sessions.set(msg.from.id,{...s,targetId});
    await renderCenter(pool,msg.chat.id,msg.from.id,targetId);return true;
  }
  const sec=parseDuration(raw);
  if(sec===null){await telegramApi("sendMessage",{chat_id:msg.chat.id,text:"✗ مدت نامعتبر است. نمونه: 3 ساعت، 90 دقیقه، 1 روز یا بدون انقضا.",reply_to_message_id:msg.message_id});return true;}
  const r=await apply(pool,s.groupId,s.targetId,s.actorId,actorName(msg.from),sec,s.mode,s.mode==="extend"?"افزایش مدت از پنل":s.mode==="reduce"?"کاهش مدت از پنل":"تنظیم مدت از پنل");
  sessions.delete(msg.from.id);
  await telegramApi("sendMessage",{chat_id:msg.chat.id,text:r.ok?"✓ عملیات ویژه انجام شد.\n⛂ - مدت : "+fmtSec(sec,await getGroupLanguage(pool,msg.chat.id,"fa")):"✗ "+r.error,reply_to_message_id:msg.message_id});
  return true;
}

export async function handleSpecialCallback(pool:Pool,cb:TgCallback,ownerIds:string[]){
  if(!cb.message||!String(cb.data||"").startsWith("sp:"))return false;
  const chatId=cb.message.chat.id,uid=cb.from.id;if(!(await isAdmin(chatId,uid,ownerIds)))return true;
  await telegramApi("answerCallbackQuery",{callback_query_id:cb.id}).catch(()=>{});
  const p=String(cb.data).split(":"),action=p[1],targetId=Number(p[2]);
  if(action==="noop")return true;
  if(action==="center"&&Number.isSafeInteger(targetId)&&targetId>0){await renderCenter(pool,chatId,uid,targetId,{chatId,messageId:cb.message.message_id});return true;}
  if(action==="list"||action==="expired"){await renderList(pool,chatId,uid,Number(p[2])||0,{chatId,messageId:cb.message.message_id},action==="expired");return true;}
  if(action==="history"){await renderHistory(pool,chatId,uid,targetId,Number(p[3])||0,{chatId,messageId:cb.message.message_id});return true;}
  if(action==="custom"){
    const mode=(p[3]||"set") as Mode;
    sessions.set(uid,{groupId:chatId,targetId,actorId:uid,mode,expires:Date.now()+10*60*1000});
    await telegramApi("editMessageText",{chat_id:chatId,message_id:cb.message.message_id,text:"◈ تنظیم مدت ویژه\n\n⛂ - مدت را ارسال کنید.\n\nنمونه: 3 ساعت\n90 دقیقه\n1 روز\nبدون انقضا",reply_markup:kb([[{text:"‹ بازگشت",callback_data:`sp:center:${targetId}`}]] )});
    return true;
  }
  if((action==="set"||action==="extend"||action==="reduce")&&Number.isSafeInteger(targetId)&&targetId>0){
    const sec=Number(p[3]);if(!Number.isSafeInteger(sec)||sec<0)return true;
    const r=await apply(pool,chatId,targetId,uid,actorName(cb.from),sec,action as Mode,action==="set"?"تنظیم از مرکز ویژه":action==="extend"?"افزایش مدت از مرکز ویژه":"کاهش مدت از مرکز ویژه");
    if(r.ok)await renderCenter(pool,chatId,uid,targetId,{chatId,messageId:cb.message.message_id});
    else await telegramApi("editMessageText",{chat_id:chatId,message_id:cb.message.message_id,text:"✗ "+r.error,reply_markup:kb([[{text:"‹ بازگشت",callback_data:`sp:center:${targetId}`}]] )});
    return true;
  }
  if(action==="remove"){
    await telegramApi("editMessageText",{chat_id:chatId,message_id:cb.message.message_id,text:"◈ حذف ویژه\n\n⛂ - کاربر : "+targetId+"\n\n⚠️ برای حذف تأیید کنید.",reply_markup:kb([[{text:"✓ تأیید حذف",callback_data:`sp:remove_yes:${targetId}`},{text:"لغو",callback_data:`sp:center:${targetId}`}],[{text:"‹ بازگشت",callback_data:"c:members"}]])});
    return true;
  }
  if(action==="remove_yes"){
    const r=await remove(pool,chatId,targetId,uid,actorName(cb.from));
    if(r.ok)await renderCenter(pool,chatId,uid,targetId,{chatId,messageId:cb.message.message_id});
    else await telegramApi("editMessageText",{chat_id:chatId,message_id:cb.message.message_id,text:"✗ "+r.error,reply_markup:kb([[{text:"‹ بازگشت",callback_data:"c:members"}]])});
    return true;
  }
  if(action==="add"){
    sessions.set(uid,{groupId:chatId,targetId:0,actorId:uid,mode:"set",expires:Date.now()+10*60*1000});
    await telegramApi("editMessageText",{chat_id:chatId,message_id:cb.message.message_id,text:"◈ افزودن کاربر ویژه\n\n⛂ - آیدی عددی کاربر را ارسال کنید.",reply_markup:kb([[{text:"‹ بازگشت",callback_data:"sp:list:0"}]])});
    return true;
  }
  return true;
}
