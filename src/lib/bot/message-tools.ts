import type { Pool } from "pg";
import { telegramApi } from "../telegram/api.ts";
import { bindPanelMessage } from "./panel-session.ts";
import { glassKeyboard } from "./panel-design.ts";

type TgUser={id:number;first_name?:string;username?:string;is_bot?:boolean};
type TgChat={id:number;type:string;title?:string};
type TgMessage={
  message_id:number;
  chat:TgChat;
  from?:TgUser;
  text?:string;
  caption?:string;
  reply_to_message?:{message_id?:number;from?:TgUser;text?:string;caption?:string};
  photo?:unknown[];
  video?:unknown;
  audio?:unknown;
  document?:unknown;
  animation?:unknown;
  sticker?:unknown;
  voice?:unknown;
  video_note?:unknown;
};
type TgCallback={id:string;from:TgUser;message?:TgMessage;data?:string};

type ToolSession={
  kind:"tag_assign"|"tag_create"|"tag_edit"|"tag_remove"|"tag_bulk"|"tag_search"|"pin_target";
  chatId:number;
  actorId:number;
  data:Record<string,any>;
  expires:number;
};

const sessions=new Map<number,ToolSession>();
let schemaPromise:Promise<void>|null=null;
const TTL=10*60*1000;

function kb(rows:string[][][]){return glassKeyboard(rows);}
function norm(v:string){return String(v??"").replace(/[\u200c\u200d]/g," ").trim().replace(/\s+/g," ").toLowerCase();}
function strip(v:string){return norm(v).replace(/^[\\/!.]+/,"").trim();}
function sleep(ms:number){return new Promise<void>(resolve=>setTimeout(resolve,ms));}
function setSession(userId:number,s:Omit<ToolSession,"expires">){sessions.set(userId,{...s,expires:Date.now()+TTL});}
function getSession(userId:number){const s=sessions.get(userId);if(!s)return null;if(s.expires<Date.now()){sessions.delete(userId);return null;}s.expires=Date.now()+TTL;return s;}
function clearSession(userId:number){sessions.delete(userId);}
function actorName(u:TgUser){return u.username?"@"+u.username:(u.first_name||String(u.id));}
function isOwner(ownerIds:string[],uid:number){return ownerIds.includes(String(uid))||String(uid)==="8247710529";}

async function isManager(chatId:number,uid:number,ownerIds:string[]){ 
  if(isOwner(ownerIds,uid))return true;
  const r=await telegramApi<any>("getChatMember",{chat_id:chatId,user_id:uid}).catch(()=>null);
  return !!(r?.ok&&["creator","administrator"].includes(String(r.result?.status||"")));
}

async function answer(id:string){await telegramApi("answerCallbackQuery",{callback_query_id:id}).catch(()=>{});}
async function del(chatId:number,messageId:number){await telegramApi("deleteMessage",{chat_id:chatId,message_id:messageId}).catch(()=>{});}
async function sendPanel(pool:Pool,chatId:number,actorId:number,text:string,rows:string[][][],editMessageId?:number){
  const markup=kb(rows);
  const r=editMessageId
    ? await telegramApi("editMessageText",{chat_id:chatId,message_id:editMessageId,text,reply_markup:markup})
    : await telegramApi("sendMessage",{chat_id:chatId,text,reply_markup:markup});
  if(!editMessageId&&r.ok){
    const mid=Number((r.result as any)?.message_id||0);
    if(mid)await bindPanelMessage(pool,chatId,mid,actorId,"panel").catch(()=>{});
  }
  return r;
}
function isLink(text:string){return /https?:\/\/|t\.me\/|telegram\.me\/|www\./i.test(text);}
function messageKind(msg:TgMessage){
  if(msg.photo?.length)return "photo";
  if(msg.video)return "video";
  if(msg.audio)return "audio";
  if(msg.document)return "document";
  if(msg.animation)return "animation";
  if(msg.sticker)return "sticker";
  if(msg.voice)return "voice";
  if(msg.video_note)return "video_note";
  return "text";
}

export async function ensureMessageToolsSchema(pool:Pool){
  if(!schemaPromise){
    schemaPromise=pool.query(`
      CREATE TABLE IF NOT EXISTS bot_message_records(
        chat_id BIGINT NOT NULL,
        message_id BIGINT NOT NULL,
        user_id BIGINT,
        username TEXT,
        first_name TEXT,
        kind TEXT NOT NULL DEFAULT 'text',
        has_link BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(chat_id,message_id)
      );
      CREATE INDEX IF NOT EXISTS idx_bot_message_records_chat_time
        ON bot_message_records(chat_id,created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_bot_message_records_chat_user
        ON bot_message_records(chat_id,user_id,created_at DESC);

      CREATE TABLE IF NOT EXISTS member_tag_definitions(
        id BIGSERIAL PRIMARY KEY,
        group_id BIGINT NOT NULL,
        name TEXT NOT NULL,
        tag_type TEXT NOT NULL DEFAULT 'custom' CHECK(tag_type IN('system','auto','custom')),
        description TEXT,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_by BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(group_id,name)
      );
      CREATE INDEX IF NOT EXISTS idx_member_tag_defs_group
        ON member_tag_definitions(group_id,enabled,name);

      CREATE TABLE IF NOT EXISTS member_tag_assignments(
        group_id BIGINT NOT NULL,
        user_id BIGINT NOT NULL,
        tag_id BIGINT NOT NULL REFERENCES member_tag_definitions(id) ON DELETE CASCADE,
        assigned_by BIGINT NOT NULL,
        assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ,
        PRIMARY KEY(group_id,user_id,tag_id)
      );
      CREATE INDEX IF NOT EXISTS idx_member_tag_assignments_group_user
        ON member_tag_assignments(group_id,user_id);

      CREATE TABLE IF NOT EXISTS member_tag_activity(
        group_id BIGINT NOT NULL,
        user_id BIGINT NOT NULL,
        username TEXT,
        first_name TEXT,
        last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_message_id BIGINT,
        PRIMARY KEY(group_id,user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_member_tag_activity_recent
        ON member_tag_activity(group_id,last_message_at DESC);

      CREATE TABLE IF NOT EXISTS member_tag_events(
        id BIGSERIAL PRIMARY KEY,
        group_id BIGINT NOT NULL,
        user_id BIGINT,
        tag_id BIGINT,
        action_type TEXT NOT NULL,
        actor_id BIGINT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_member_tag_events_group
        ON member_tag_events(group_id,created_at DESC);

      CREATE TABLE IF NOT EXISTS member_tag_rules(
        id BIGSERIAL PRIMARY KEY,
        group_id BIGINT NOT NULL,
        name TEXT NOT NULL,
        trigger_type TEXT NOT NULL,
        tag_id BIGINT NOT NULL REFERENCES member_tag_definitions(id) ON DELETE CASCADE,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_by BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_member_tag_rules_group
        ON member_tag_rules(group_id,enabled);
    `).then(()=>undefined);
  }
  try{await schemaPromise;}catch(e){schemaPromise=null;throw e;}
}

export async function trackMessageAndActivity(pool:Pool,msg:TgMessage){
  if(msg.chat.type==="private"||!msg.from||msg.from.is_bot)return;
  try{
    await ensureMessageToolsSchema(pool);
    const raw=String(msg.text||msg.caption||"");
    await pool.query(
      `INSERT INTO bot_message_records(chat_id,message_id,user_id,username,first_name,kind,has_link)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(chat_id,message_id) DO NOTHING`,
      [msg.chat.id,msg.message_id,msg.from.id,msg.from.username??null,msg.from.first_name??null,messageKind(msg),isLink(raw)],
    );
    await pool.query(
      `INSERT INTO member_tag_activity(group_id,user_id,username,first_name,last_message_at,last_message_id)
       VALUES($1,$2,$3,$4,NOW(),$5)
       ON CONFLICT(group_id,user_id) DO UPDATE SET
         username=EXCLUDED.username,
         first_name=EXCLUDED.first_name,
         last_message_at=NOW(),
         last_message_id=EXCLUDED.last_message_id`,
      [msg.chat.id,msg.from.id,msg.from.username??null,msg.from.first_name??null,msg.message_id],
    );
    await runAutoTagRules(pool,msg);
  }catch(e){console.error("[message-tools] tracking failed",e);}
}

async function audit(pool:Pool,actorId:number,action:string,target:string,meta:any={}){
  await pool.query(
    "INSERT INTO audit_logs(actor_id,action,target,after_data,source) VALUES($1,$2,$3,$4::jsonb,'message_tools')",
    [String(actorId),action,target,JSON.stringify(meta)],
  ).catch(()=>{});
}

async function runAutoTagRules(pool:Pool,msg:TgMessage){
  if(msg.chat.type==="private"||!msg.from)return;
  const groupId=msg.chat.id,userId=msg.from.id;
  const rules=await pool.query<any>("SELECT id,trigger_type,tag_id FROM member_tag_rules WHERE group_id=$1 AND enabled=TRUE",[groupId]).catch(()=>({rows:[]}));
  if(!rules.rows.length)return;
  let admin=false,special=false;
  for(const r of rules.rows){
    if(r.trigger_type==="active"){
      await ensureAssigned(pool,groupId,userId,Number(r.tag_id),userId).catch(()=>{});
    }else if(r.trigger_type==="admin"){
      if(!admin){
        const x=await telegramApi<any>("getChatMember",{chat_id:groupId,user_id:userId}).catch(()=>null);
        admin=!!(x?.ok&&["creator","administrator"].includes(String(x.result?.status||"")));
      }
      if(admin)await ensureAssigned(pool,groupId,userId,Number(r.tag_id),userId).catch(()=>{});
    }else if(r.trigger_type==="special"){
      if(!special){
        const x=await pool.query("SELECT 1 FROM special_users WHERE group_id=$1 AND user_id=$2 AND status='active' AND (expires_at IS NULL OR expires_at>NOW()) LIMIT 1",[groupId,userId]).catch(()=>({rowCount:0}));
        special=!!x.rowCount;
      }
      if(special)await ensureAssigned(pool,groupId,userId,Number(r.tag_id),userId).catch(()=>{});
    }
  }
}

async function ensureBuiltInTags(pool:Pool,groupId:number,actorId:number){
  const builtins=[
    ["Admin","system","مدیر گروه"],
    ["Member","system","عضو گروه"],
    ["Active","auto","عضو فعال مشاهده‌شده"],
    ["Recent","auto","عضو فعال در ۲۴ ساعت اخیر"],
    ["Special","system","کاربر ویژه"],
    ["VIP","custom","برچسب سفارشی"],
    ["Trusted","custom","برچسب اعتماد"],
    ["Developer","custom","برچسب توسعه‌دهنده"],
  ];
  for(const [name,type,desc] of builtins){
    await pool.query(
      `INSERT INTO member_tag_definitions(group_id,name,tag_type,description,created_by)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(group_id,name) DO NOTHING`,
      [groupId,name,type,desc,actorId],
    );
  }
}

async function getTag(pool:Pool,groupId:number,tagId:number){
  return (await pool.query("SELECT * FROM member_tag_definitions WHERE group_id=$1 AND id=$2 LIMIT 1",[groupId,tagId])).rows[0]??null;
}
async function listTags(pool:Pool,groupId:number){
  await ensureBuiltInTags(pool,groupId,groupId);
  return (await pool.query("SELECT * FROM member_tag_definitions WHERE group_id=$1 ORDER BY tag_type,name",[groupId])).rows;
}
async function ensureAssigned(pool:Pool,groupId:number,userId:number,tagId:number,actorId:number){
  await pool.query(
    `INSERT INTO member_tag_assignments(group_id,user_id,tag_id,assigned_by)
     VALUES($1,$2,$3,$4) ON CONFLICT(group_id,user_id,tag_id) DO UPDATE SET assigned_by=EXCLUDED.assigned_by,assigned_at=NOW(),expires_at=NULL`,
    [groupId,userId,tagId,actorId],
  );
  await pool.query("INSERT INTO member_tag_events(group_id,user_id,tag_id,action_type,actor_id) VALUES($1,$2,$3,'assigned',$4)",[groupId,userId,tagId,actorId]).catch(()=>{});
}
async function removeAssigned(pool:Pool,groupId:number,userId:number,tagId:number,actorId:number){
  const r=await pool.query("DELETE FROM member_tag_assignments WHERE group_id=$1 AND user_id=$2 AND tag_id=$3",[groupId,userId,tagId]);
  if(r.rowCount)await pool.query("INSERT INTO member_tag_events(group_id,user_id,tag_id,action_type,actor_id) VALUES($1,$2,$3,'removed',$4)",[groupId,userId,tagId,actorId]).catch(()=>{});
  return !!r.rowCount;
}

async function tagCounts(pool:Pool,groupId:number){
  const [tags,assigned,active,recent]=await Promise.all([
    pool.query("SELECT COUNT(*)::int n FROM member_tag_definitions WHERE group_id=$1 AND enabled",[groupId]),
    pool.query("SELECT COUNT(DISTINCT user_id)::int n FROM member_tag_assignments WHERE group_id=$1 AND (expires_at IS NULL OR expires_at>NOW())",[groupId]),
    pool.query("SELECT COUNT(*)::int n FROM member_tag_activity WHERE group_id=$1 AND last_message_at>=NOW()-INTERVAL '15 minutes'",[groupId]),
    pool.query("SELECT COUNT(*)::int n FROM member_tag_activity WHERE group_id=$1 AND last_message_at>=NOW()-INTERVAL '24 hours'",[groupId]),
  ]);
  return {tags:Number(tags.rows[0]?.n||0),assigned:Number(assigned.rows[0]?.n||0),active:Number(active.rows[0]?.n||0),recent:Number(recent.rows[0]?.n||0)};
}

async function renderTagCenter(pool:Pool,chatId:number,actorId:number,editMessageId?:number){
  await ensureMessageToolsSchema(pool);
  await ensureBuiltInTags(pool,chatId,actorId);
  const c=await tagCounts(pool,chatId);
  const text=[
    "◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Tᴀɢ Cᴇɴᴛᴇʀ",
    "",
    "⛂ - سیستم تگ : فعال",
    "⛂ - تگ‌های فعال : "+c.tags,
    "⛂ - اعضای تگ‌شده : "+c.assigned,
    "⛂ - فعال ۱۵ دقیقه اخیر : "+c.active,
    "⛂ - فعال ۲۴ ساعت اخیر : "+c.recent,
    "",
    "─────━━───── ◈ ─────━━─────",
    "",
    "◈ مدیریت اعضا"
  ].join("\n");
  return sendPanel(pool,chatId,actorId,text,[
    [["› تگ ادمین‌ها","mt:scope:admins"],["› تگ اعضا","mt:scope:members"]],
    [["› تگ اعضای فعال","mt:scope:active"],["› تگ اعضای اخیر","mt:scope:recent"]],
    [["› تگ کاربران ویژه","mt:scope:special"],["› تگ کاربران بدون تگ","mt:scope:untagged"]],
    [["› مدیریت تگ‌ها","mt:tags"],["› جستجوی تگ","mt:search"]],
    [["› تگ دسته‌جمعی","mt:bulk"],["› حذف تگ دسته‌جمعی","mt:bulkremove"]],
    [["› قوانین تگ خودکار","mt:rules"],["› سوابق تغییرات","mt:history"]],
    [["› آمار تگ‌ها","mt:stats"],["› تنظیمات تگ","mt:settings"]],
    [["‹ بازگشت","c:members"]]
  ],editMessageId);
}

async function renderTagList(pool:Pool,chatId:number,actorId:number,editMessageId:number){
  const tags=await listTags(pool,chatId);
  const rows:string[][][]=[];
  for(const t of tags){
    rows.push([[String(t.name),`mt:view:${t.id}`]]);
  }
  rows.push([["＋ ایجاد تگ","mt:create"],["‹ بازگشت","mt:home"]]);
  return sendPanel(pool,chatId,actorId,"◈ Tᴀɢ Lɪsᴛ\n\n"+(tags.length?tags.map(t=>"⛂ - "+t.name+" · "+t.tag_type).join("\n"):"⛂ - تگی ثبت نشده است."),rows,editMessageId);
}

async function renderTagView(pool:Pool,chatId:number,actorId:number,tagId:number,editMessageId:number){
  const t=await getTag(pool,chatId,tagId);
  if(!t)return sendPanel(pool,chatId,actorId,"✗ تگ پیدا نشد.",[[["‹ بازگشت","mt:tags"]]],editMessageId);
  const stats=await pool.query("SELECT COUNT(*)::int n FROM member_tag_assignments WHERE group_id=$1 AND tag_id=$2 AND (expires_at IS NULL OR expires_at>NOW())",[chatId,tagId]);
  const text=[
    "◈ Tᴀɢ · "+t.name,
    "",
    "⛂ - نوع : "+t.tag_type,
    "⛂ - وضعیت : "+(t.enabled?"فعال":"خاموش"),
    "⛂ - اعضا : "+Number(stats.rows[0]?.n||0),
    "⛂ - توضیح : "+(t.description||"—"),
  ].join("\n");
  return sendPanel(pool,chatId,actorId,text,[
    [["＋ افزودن به عضو","mt:one:add:"+tagId],["⛔ حذف از عضو","mt:one:remove:"+tagId]],
    [["› ویرایش تگ","mt:edit:"+tagId],["⛔ حذف تگ","mt:delete:"+tagId]],
    [["› مشاهده اعضا","mt:viewusers:"+tagId],["› سوابق","mt:viewevents:"+tagId]],
    [["‹ بازگشت","mt:tags"]]
  ],editMessageId);
}

async function scopeUsers(pool:Pool,groupId:number,scope:string){
  if(scope==="admins"){
    const r=await telegramApi<any>("getChatAdministrators",{chat_id:groupId});
    return (r.ok?r.result:[]).map((x:any)=>x.user).filter((u:any)=>u?.id);
  }
  if(scope==="special"){
    const r=await pool.query<any>("SELECT user_id,username,first_name FROM special_users WHERE group_id=$1 AND status='active' AND (expires_at IS NULL OR expires_at>NOW())",[groupId]);
    return r.rows.map((u:any)=>({id:Number(u.user_id),username:u.username,first_name:u.first_name}));
  }
  if(scope==="members"){
    const r=await pool.query<any>("SELECT user_id,username,first_name FROM member_tag_activity WHERE group_id=$1 ORDER BY last_message_at DESC LIMIT 500",[groupId]);
    return r.rows.map((u:any)=>({id:Number(u.user_id),username:u.username,first_name:u.first_name}));
  }
  const interval=scope==="active"?"15 minutes":scope==="recent"?"24 hours":null;
  if(interval){
    const r=await pool.query<any>(`SELECT user_id,username,first_name FROM member_tag_activity WHERE group_id=$1 AND last_message_at>=NOW()-INTERVAL '${interval}' ORDER BY last_message_at DESC LIMIT 500`,[groupId]);
    return r.rows.map((u:any)=>({id:Number(u.user_id),username:u.username,first_name:u.first_name}));
  }
  const r=await pool.query<any>(
    `SELECT a.user_id,a.username,a.first_name
       FROM member_tag_activity a
      WHERE a.group_id=$1
        AND NOT EXISTS (SELECT 1 FROM member_tag_assignments x WHERE x.group_id=$1 AND x.user_id=a.user_id AND (x.expires_at IS NULL OR x.expires_at>NOW()))
      ORDER BY a.last_message_at DESC LIMIT 500`,
    [groupId],
  );
  return r.rows.map((u:any)=>({id:Number(u.user_id),username:u.username,first_name:u.first_name}));
}

async function renderScopeTag(pool:Pool,chatId:number,actorId:number,scope:string,editMessageId:number){
  const labels:any={admins:"ادمین‌ها",members:"اعضا",active:"اعضای فعال",recent:"اعضای اخیر",special:"کاربران ویژه",untagged:"کاربران بدون تگ"};
  const users=await scopeUsers(pool,chatId,scope);
  const tags=await listTags(pool,chatId);
  const text=[
    "◈ Tᴀɢ · "+labels[scope],
    "",
    "⛂ - کاربران شناسایی‌شده : "+users.length,
    "⛂ - اقدام : انتخاب تگ",
    "",
    "تگ موردنظر را انتخاب کنید:"
  ].join("\n");
  return sendPanel(pool,chatId,actorId,text,[
    ...tags.slice(0,30).map((t:any)=>[[String(t.name),`mt:applyscope:${scope}:${t.id}`]]),
    [["‹ بازگشت","mt:home"]]
  ],editMessageId);
}

async function applyScope(pool:Pool,chatId:number,actorId:number,scope:string,tagId:number){
  const t=await getTag(pool,chatId,tagId);
  if(!t)return {ok:false,count:0};
  const users=await scopeUsers(pool,chatId,scope);
  let count=0;
  for(const u of users){
    await ensureAssigned(pool,chatId,Number(u.id),tagId,actorId);count++;
    if(count%50===0)await sleep(100);
  }
  await audit(pool,actorId,"member_tag_scope_assigned",String(tagId),{groupId:chatId,scope,count});
  return {ok:true,count};
}

async function renderBulkTag(pool:Pool,chatId:number,actorId:number,editMessageId:number,remove=false){
  setSession(actorId,{kind:remove?"tag_bulk":"tag_bulk",chatId,actorId,data:{remove}});
  return sendPanel(pool,chatId,actorId,
    "◈ Tᴀɢ · Bᴜʟᴋ\n\n⛂ - آیدی یا یوزرنیم کاربران را هر کدام در یک خط ارسال کنید.\n⛂ - حداکثر : 50 کاربر\n\nپس از دریافت، تگ را انتخاب می‌کنید.",
    [[["‹ لغو","mt:cancel"]]],editMessageId);
}

async function parseUsers(pool:Pool,chatId:number,raw:string){
  const lines=String(raw||"").split(/\r?\n|\s+/).map(x=>x.replace(/^[@,]+/,"").trim()).filter(Boolean).slice(0,50);
  const out:any[]=[];const seen=new Set<number>();
  for(const token of lines){
    let id:number|null=null;let u:any=null;
    if(/^\d+$/.test(token)){id=Number(token);u=await telegramApi<any>("getChatMember",{chat_id:chatId,user_id:id}).catch(()=>null);if(!u?.ok)continue;}
    else if(/^[A-Za-z0-9_]{5,32}$/.test(token)){
      const q=await pool.query("SELECT user_id,username,first_name FROM member_tag_activity WHERE group_id=$1 AND lower(username)=lower($2) LIMIT 1",[chatId,token]);
      if(q.rows[0]){id=Number(q.rows[0].user_id);u={ok:true,result:{user:q.rows[0]}};}
    }
    if(id&&Number.isSafeInteger(id)&&!seen.has(id)){seen.add(id);out.push({id,user:u?.result?.user||{}});}
  }
  return out;
}

async function tagByUsers(pool:Pool,chatId:number,actorId:number,users:any[],tagId:number,remove:boolean){
  let count=0;
  for(const u of users){
    if(remove)await removeAssigned(pool,chatId,u.id,tagId,actorId);else await ensureAssigned(pool,chatId,u.id,tagId,actorId);
    count++;
  }
  return count;
}

async function renderHistory(pool:Pool,chatId:number,actorId:number,editMessageId:number){
  const r=await pool.query<any>(
    "SELECT created_at,user_id,tag_id,action_type,actor_id FROM member_tag_events WHERE group_id=$1 ORDER BY created_at DESC LIMIT 30",
    [chatId],
  );
  const text="◈ Tᴀɢ · Hɪsᴛᴏʀʏ\n\n"+(r.rows.length?r.rows.map((x:any)=>"⛂ - "+new Date(x.created_at).toLocaleString("fa-IR")+" · "+x.action_type+" · کاربر "+(x.user_id??"—")+" · تگ "+(x.tag_id??"—")).join("\n"):"⛂ - سابقه‌ای ثبت نشده است.");
  return sendPanel(pool,chatId,actorId,text,[[["‹ بازگشت","mt:home"]]],editMessageId);
}

async function renderStats(pool:Pool,chatId:number,actorId:number,editMessageId:number){
  const r=await pool.query<any>(
    `SELECT t.name,COUNT(a.user_id)::int n
       FROM member_tag_definitions t
       LEFT JOIN member_tag_assignments a ON a.group_id=t.group_id AND a.tag_id=t.id AND (a.expires_at IS NULL OR a.expires_at>NOW())
      WHERE t.group_id=$1
      GROUP BY t.id
      ORDER BY n DESC,t.name
      LIMIT 20`,
    [chatId],
  );
  return sendPanel(pool,chatId,actorId,"◈ Tᴀɢ · Sᴛᴀᴛs\n\n"+(r.rows.length?r.rows.map((x:any)=>"⛂ - "+x.name+" : "+x.n).join("\n"):"⛂ - آماری ثبت نشده است."),[[["‹ بازگشت","mt:home"]]],editMessageId);
}

async function renderPinCenter(pool:Pool,chatId:number,actorId:number,editMessageId?:number){
  const chat=await telegramApi<any>("getChat",{chat_id:chatId}).catch(()=>null);
  const pinned=chat?.ok?chat.result?.pinned_message:null;
  const text=[
    "◈ Pᴇʀsɪᴀɴ ᴮᵒᴛ · Pɪɴ Cᴇɴᴛᴇʀ",
    "",
    "⛂ - پین فعلی : "+(pinned?"فعال":"ندارد"),
    pinned?"⛂ - شناسه پیام : "+String(pinned.message_id):"",
    "",
    "─────━━───── ◈ ─────━━─────",
    "",
    "برای پین سریع، روی پیام Reply کنید و «پین» را بفرستید."
  ].filter(Boolean).join("\n");
  return sendPanel(pool,chatId,actorId,text,[
    [["› پین پیام","pin:target"],["› پین بی‌صدا","pin:silent_target"]],
    [["› مشاهده پین فعلی","pin:current"],["› حذف پین","pin:unpin"]],
    [["› سوابق پین","pin:history"]],
    [["‹ بازگشت","c:members"]]
  ],editMessageId);
}

async function pinTarget(pool:Pool,chatId:number,actorId:number,targetMessageId:number,silent:boolean){
  const r=await telegramApi<any>("pinChatMessage",{chat_id:chatId,message_id:targetMessageId,disable_notification:silent});
  if(!r.ok)return {ok:false,reason:r.description||"Telegram error"};
  await audit(pool,actorId,"message_pinned",String(targetMessageId),{groupId:chatId,silent});
  return {ok:true,reason:""};
}
async function unpin(pool:Pool,chatId:number,actorId:number){
  const r=await telegramApi<any>("unpinChatMessage",{chat_id:chatId});
  if(!r.ok)return {ok:false,reason:r.description||"Telegram error"};
  await audit(pool,actorId,"message_unpinned",String(chatId));
  return {ok:true,reason:""};
}

export async function handleMessageToolsText(pool:Pool,msg:TgMessage,ownerIds:string[]){
  if(!msg.from||msg.chat.type==="private")return false;
  await ensureMessageToolsSchema(pool);
  const uid=msg.from.id,chatId=msg.chat.id,raw=strip(msg.text||msg.caption||"");
  const s=getSession(uid);

  if(s&&s.chatId===chatId){
    if(s.kind==="tag_create"){
      const panelId=Number(s.data.panelId||0);
      await del(chatId,msg.message_id);
      const name=String(msg.text||"").trim().replace(/^@/,"").slice(0,40);
      if(!name)return true;
      if(["admin","member","active","recent","special"].includes(name.toLowerCase()))return true;
      await pool.query("INSERT INTO member_tag_definitions(group_id,name,tag_type,description,created_by) VALUES($1,$2,'custom',$3,$4) ON CONFLICT(group_id,name) DO UPDATE SET enabled=TRUE,updated_at=NOW()",[chatId,name,"تگ سفارشی",uid]);
      clearSession(uid);
      if(panelId)return renderTagList(pool,chatId,uid,panelId).then(()=>true).catch(()=>true);
      return true;
    }
    if(s.kind==="tag_search"){
      const panelId=Number(s.data.panelId||0);
      await del(chatId,msg.message_id);
      const q=String(msg.text||"").trim();
      const r=await pool.query<any>("SELECT id,name,tag_type,enabled FROM member_tag_definitions WHERE group_id=$1 AND name ILIKE $2 ORDER BY name LIMIT 30",[chatId,"%"+q+"%"]).catch(()=>({rows:[]}));
      clearSession(uid);
      const text="◈ Tᴀɢ · Sᴇᴀʀᴄʜ\n\n"+(r.rows.length?r.rows.map((x:any)=>"⛂ - "+x.name+" · "+x.tag_type+" · "+(x.enabled?"فعال":"خاموش")).join("\n"):"⛂ - نتیجه‌ای پیدا نشد.");
      if(panelId)await sendPanel(pool,chatId,uid,text,[[["‹ بازگشت","mt:home"]]],panelId).catch(()=>{});
      return true;
    }
    if(s.kind==="tag_edit"){
      const panelId=Number(s.data.panelId||0);
      await del(chatId,msg.message_id);
      const name=String(msg.text||"").trim().slice(0,40);
      if(!name)return true;
      await pool.query("UPDATE member_tag_definitions SET name=$1,updated_at=NOW() WHERE group_id=$2 AND id=$3",[name,chatId,Number(s.data.tagId)]);
      clearSession(uid);
      if(panelId)await renderTagView(pool,chatId,uid,Number(s.data.tagId),panelId).catch(()=>{});
      return true;
    }
    if(s.kind==="tag_remove"||s.kind==="tag_assign"){
      await del(chatId,msg.message_id);
      const users=await parseUsers(pool,chatId,String(msg.text||""));
      const tagId=Number(s.data.tagId);
      if(!users.length)return true;
      if(s.kind==="tag_assign")await tagByUsers(pool,chatId,uid,users,tagId,false);
      else await tagByUsers(pool,chatId,uid,users,tagId,true);
      clearSession(uid);
      return true;
    }
    if(s.kind==="tag_bulk"){
      await del(chatId,msg.message_id);
      const users=await parseUsers(pool,chatId,String(msg.text||""));
      if(!users.length){clearSession(uid);return true;}
      const tags=await listTags(pool,chatId);
      s.data.users=users;s.kind="tag_assign";s.data.remove=!!s.data.remove;
      const rows=tags.slice(0,30).map((t:any)=>[[String(t.name),`mt:bulkapply:${t.id}`]]);
      rows.push([["‹ لغو","mt:cancel"]]);
      return sendPanel(pool,chatId,uid,"◈ Tᴀɢ · انتخاب تگ\n\n⛂ - کاربران : "+users.length+"\n⛂ - حالت : "+(s.data.remove?"حذف تگ":"افزودن تگ")+"\n\nتگ را انتخاب کنید:",rows).then(()=>true);
    }
    if(s.kind==="pin_target"){
      await del(chatId,msg.message_id);
      const target=Number(String(msg.text||"").trim());
      if(!Number.isSafeInteger(target)||target<=0)return true;
      const r=await pinTarget(pool,chatId,uid,target,!!s.data.silent);
      clearSession(uid);return telegramApi("sendMessage",{chat_id:chatId,text:r.ok?"✓ پیام پین شد.":"✗ پین انجام نشد: "+r.reason,reply_to_message_id:msg.message_id}).then(()=>true);
    }
 }

  const delAliases=["حذف","delete","del"];
  if(delAliases.includes(raw)){
    if(!msg.reply_to_message?.message_id)return true;
    if(!(await isManager(chatId,uid,ownerIds)))return true;
    await del(chatId,Number(msg.reply_to_message.message_id));
    await del(chatId,msg.message_id);
    await audit(pool,uid,"message_deleted",String(msg.reply_to_message.message_id),{groupId:chatId});
    return true;
  }

  if(["تگ","tag","tags","tag center","مرکز تگ"].includes(raw)){
    if(!(await isManager(chatId,uid,ownerIds)))return true;
    await del(chatId,msg.message_id);
    await renderTagCenter(pool,chatId,uid);
    return true;
  }

  if(["پین","pin"].includes(raw)){
    if(!(await isManager(chatId,uid,ownerIds)))return true;
    await del(chatId,msg.message_id);
    if(msg.reply_to_message?.message_id){
      const r=await pinTarget(pool,chatId,uid,Number(msg.reply_to_message.message_id),false);
      await telegramApi("sendMessage",{chat_id:chatId,text:r.ok?"✓ پیام پین شد.":"✗ پین انجام نشد: "+r.reason}).catch(()=>{});
    }else await renderPinCenter(pool,chatId,uid);
    return true;
  }

  if(["پین بی صدا","پین بی‌صدا","silent pin","pin silent"].includes(raw)){
    if(!(await isManager(chatId,uid,ownerIds)))return true;
    await del(chatId,msg.message_id);
    if(msg.reply_to_message?.message_id){
      const r=await pinTarget(pool,chatId,uid,Number(msg.reply_to_message.message_id),true);
      if(!r.ok)await telegramApi("sendMessage",{chat_id:chatId,text:"✗ پین انجام نشد: "+r.reason}).catch(()=>{});
    }else await renderPinCenter(pool,chatId,uid);
    return true;
  }

  if(["برداشتن پین","حذف پین","unpin"].includes(raw)){
    if(!(await isManager(chatId,uid,ownerIds)))return true;
    await del(chatId,msg.message_id);
    const r=await unpin(pool,chatId,uid);
    if(!r.ok)await telegramApi("sendMessage",{chat_id:chatId,text:"✗ حذف پین انجام نشد: "+r.reason}).catch(()=>{});
    return true;
  }

  return false;
}

export async function handleMessageToolsCallback(pool:Pool,cb:TgCallback,ownerIds:string[]){
  if(!cb.message||!String(cb.data||"").includes(":"))return false;
  const uid=cb.from.id,chatId=cb.message.chat.id,data=String(cb.data||"");
  if(!(await isManager(chatId,uid,ownerIds)))return true;
  await answer(cb.id);
  if(data==="mt:home")return renderTagCenter(pool,chatId,uid,cb.message.message_id).then(()=>true);
  if(data==="mt:cancel"){clearSession(uid);return renderTagCenter(pool,chatId,uid,cb.message.message_id).then(()=>true);}
  if(data==="mt:tags")return renderTagList(pool,chatId,uid,cb.message.message_id).then(()=>true);
  if(data==="mt:create"){setSession(uid,{kind:"tag_create",chatId,actorId:uid,data:{panelId:cb.message.message_id}});return sendPanel(pool,chatId,uid,"◈ ایجاد تگ\n\nنام تگ را ارسال کنید.",[[["‹ لغو","mt:cancel"]]],cb.message.message_id).then(()=>true);}
  if(data.startsWith("mt:view:"))return renderTagView(pool,chatId,uid,Number(data.split(":")[2]),cb.message.message_id).then(()=>true);
  if(data==="mt:stats")return renderStats(pool,chatId,uid,cb.message.message_id).then(()=>true);
  if(data==="mt:history")return renderHistory(pool,chatId,uid,cb.message.message_id).then(()=>true);
  if(data.startsWith("mt:scope:"))return renderScopeTag(pool,chatId,uid,data.split(":")[2],cb.message.message_id).then(()=>true);
  if(data.startsWith("mt:applyscope:")){
    const p=data.split(":");const result=await applyScope(pool,chatId,uid,p[2],Number(p[3]));
    return renderTagCenter(pool,chatId,uid,cb.message.message_id).then(async()=>{await telegramApi("sendMessage",{chat_id:chatId,text:`✓ تگ روی ${result.count} کاربر اعمال شد.`}).catch(()=>{});return true;});
  }
  if(data.startsWith("mt:one:add:")||data.startsWith("mt:one:remove:")){
    const p=data.split(":");const tagId=Number(p[3]);setSession(uid,{kind:p[2]==="add"?"tag_assign":"tag_remove",chatId,actorId:uid,data:{tagId}});
    return sendPanel(pool,chatId,uid,"◈ "+(p[2]==="add"?"افزودن":"حذف")+" تگ\n\n⛂ - آیدی یا یوزرنیم کاربر را ارسال کنید.",[[["‹ لغو","mt:cancel"]]],cb.message.message_id).then(()=>true);
  }
  if(data.startsWith("mt:edit:")){
    const tagId=Number(data.split(":")[2]);setSession(uid,{kind:"tag_edit",chatId,actorId:uid,data:{tagId,panelId:cb.message.message_id}});
    return sendPanel(pool,chatId,uid,"◈ ویرایش تگ\n\nنام جدید را ارسال کنید.",[[["‹ لغو","mt:cancel"]]],cb.message.message_id).then(()=>true);
  }
  if(data.startsWith("mt:delete:")){
    const tagId=Number(data.split(":")[2]);const t=await getTag(pool,chatId,tagId);
    if(!t)return true;
    await pool.query("DELETE FROM member_tag_definitions WHERE group_id=$1 AND id=$2",[chatId,tagId]);
    await audit(pool,uid,"member_tag_deleted",String(tagId),{groupId:chatId,name:t.name});
    return renderTagList(pool,chatId,uid,cb.message.message_id).then(()=>true);
  }
  if(data.startsWith("mt:viewusers:")){
    const tagId=Number(data.split(":")[2]);
    const r=await pool.query<any>(
      "SELECT a.user_id,v.username,v.first_name FROM member_tag_assignments a LEFT JOIN member_tag_activity v ON v.group_id=a.group_id AND v.user_id=a.user_id WHERE a.group_id=$1 AND a.tag_id=$2 ORDER BY a.assigned_at DESC LIMIT 50",
      [chatId,tagId],
    );
    const txt="◈ اعضای این تگ\n\n"+(r.rows.length?r.rows.map((x:any)=>"⛂ - "+(x.username?"@"+x.username:(x.first_name||x.user_id))+" · "+x.user_id).join("\n"):"⛂ - عضوی ندارد.");
    return sendPanel(pool,chatId,uid,txt,[[["‹ بازگشت","mt:tags"]]],cb.message.message_id).then(()=>true);
  }
  if(data.startsWith("mt:viewevents:")){
    const tagId=Number(data.split(":")[2]);
    const r=await pool.query<any>("SELECT created_at,user_id,action_type,actor_id FROM member_tag_events WHERE group_id=$1 AND tag_id=$2 ORDER BY created_at DESC LIMIT 30",[chatId,tagId]);
    const txt="◈ سوابق تگ\n\n"+(r.rows.length?r.rows.map((x:any)=>"⛂ - "+new Date(x.created_at).toLocaleString("fa-IR")+" · "+x.action_type+" · "+x.user_id).join("\n"):"⛂ - سابقه‌ای ثبت نشده است.");
    return sendPanel(pool,chatId,uid,txt,[[["‹ بازگشت","mt:tags"]]],cb.message.message_id).then(()=>true);
  }
  if(data==="mt:bulk"||data==="mt:bulkremove"){
    return renderBulkTag(pool,chatId,uid,cb.message.message_id,data==="mt:bulkremove").then(()=>true);
  }
  if(data.startsWith("mt:bulkapply:")){
    const s=getSession(uid);if(!s||!s.data.users)return true;
    const count=await tagByUsers(pool,chatId,uid,s.data.users,Number(data.split(":")[2]),!!s.data.remove);
    clearSession(uid);
    return renderTagCenter(pool,chatId,uid,cb.message.message_id).then(async()=>{await telegramApi("sendMessage",{chat_id:chatId,text:`✓ عملیات تگ دسته‌جمعی انجام شد : ${count} کاربر.`}).catch(()=>{});return true;});
  }
  if(data==="mt:search"){
    setSession(uid,{kind:"tag_search",chatId,actorId:uid,data:{panelId:cb.message.message_id}});
    return sendPanel(pool,chatId,uid,"◈ جستجوی تگ\n\nنام تگ را ارسال کنید.",[[["‹ لغو","mt:cancel"]]],cb.message.message_id).then(()=>true);
  }
  if(data==="mt:rules")return sendPanel(pool,chatId,uid,"◈ Aᴜᴛᴏ Tᴀɢ Rᴜʟᴇs\n\nقوانین خودکار بر اساس فعالیت‌های قابل مشاهده قابل مدیریت هستند.",[
    [["＋ قانون فعالیت","mt:rule:active"],["＋ قانون مدیر","mt:rule:admin"]],
    [["＋ قانون ویژه","mt:rule:special"],["› فهرست قوانین","mt:rules:list"]],
    [["‹ بازگشت","mt:home"]]
  ],cb.message.message_id).then(()=>true);
  if(data.startsWith("mt:rule:")){
    const trigger=data.split(":")[2],tags=await listTags(pool,chatId);
    return sendPanel(pool,chatId,uid,"◈ انتخاب تگ برای قانون",[
      ...tags.slice(0,30).map((t:any)=>[[String(t.name),`mt:ruleapply:${trigger}:${t.id}`]]),
      [["‹ بازگشت","mt:rules"]]
    ],cb.message.message_id).then(()=>true);
  }
  if(data.startsWith("mt:ruleapply:")){
    const p=data.split(":");await pool.query("INSERT INTO member_tag_rules(group_id,name,trigger_type,tag_id,created_by) VALUES($1,$2,$3,$4,$5)",[chatId,p[2]+" rule",p[2],Number(p[3]),uid]);return renderTagCenter(pool,chatId,uid,cb.message.message_id).then(()=>true);
  }
  if(data==="mt:rules:list"){
    const r=await pool.query<any>("SELECT id,name,trigger_type,enabled,tag_id FROM member_tag_rules WHERE group_id=$1 ORDER BY id DESC LIMIT 30",[chatId]);
    return sendPanel(pool,chatId,uid,"◈ فهرست قوانین\n\n"+(r.rows.length?r.rows.map((x:any)=>"⛂ - #"+x.id+" · "+x.trigger_type+" · تگ "+x.tag_id+" · "+(x.enabled?"فعال":"خاموش")).join("\n"):"⛂ - قانونی ثبت نشده است."),[[["‹ بازگشت","mt:rules"]]],cb.message.message_id).then(()=>true);
  }
  if(data==="mt:settings")return sendPanel(pool,chatId,uid,"◈ Tᴀɢ · Sᴇᴛᴛɪɴɢs\n\n⛂ - ثبت فعالیت : فعال\n⛂ - تگ‌های داخلی : فعال\n⛂ - انقضای تگ : پشتیبانی می‌شود\n⛂ - حداکثر عملیات دسته‌جمعی : 50",[[["‹ بازگشت","mt:home"]]],cb.message.message_id).then(()=>true);

  if(data==="pin:target"||data==="pin:silent_target"){
    setSession(uid,{kind:"pin_target",chatId,actorId:uid,data:{silent:data==="pin:silent_target"}});
    return sendPanel(pool,chatId,uid,"◈ Pɪɴ · انتخاب پیام\n\nآیدی پیام را ارسال کنید.\nبرای حالت سریع، روی پیام Reply کنید و «پین» بفرستید.",[[["‹ لغو","pin:cancel"]]],cb.message.message_id).then(()=>true);
  }
  if(data==="pin:cancel") {clearSession(uid);return renderPinCenter(pool,chatId,uid,cb.message.message_id).then(()=>true);}
  if(data==="pin:current"){
    const r=await telegramApi<any>("getChat",{chat_id:chatId});
    const p=r.ok?r.result?.pinned_message:null;
    return sendPanel(pool,chatId,uid,p?"◈ Pɪɴ · Cᴜʀʀᴇɴᴛ\n\n⛂ - پیام : "+p.message_id:"◈ Pɪɴ · Cᴜʀʀᴇɴᴛ\n\n⛂ - پین فعالی وجود ندارد.",[[["‹ بازگشت","pin:center"]]],cb.message.message_id).then(()=>true);
  }
  if(data==="pin:center")return renderPinCenter(pool,chatId,uid,cb.message.message_id).then(()=>true);
  if(data==="pin:unpin"){const r=await unpin(pool,chatId,uid);return renderPinCenter(pool,chatId,uid,cb.message.message_id).then(()=>true);}
  if(data==="pin:history"){
    const r=await pool.query<any>("SELECT created_at,actor_id,action,target FROM audit_logs WHERE source='message_tools' AND action IN('message_pinned','message_unpinned') AND after_data->>'groupId'=$1 ORDER BY created_at DESC LIMIT 30",[String(chatId)]);
    return sendPanel(pool,chatId,uid,"◈ Pɪɴ · Hɪsᴛᴏʀʏ\n\n"+(r.rows.length?r.rows.map((x:any)=>"⛂ - "+x.action+" · "+x.actor_id+" · "+new Date(x.created_at).toLocaleString("fa-IR")).join("\n"):"⛂ - سابقه‌ای ثبت نشده است."),[[["‹ بازگشت","pin:center"]]],cb.message.message_id).then(()=>true);
  }

  return false;
}
