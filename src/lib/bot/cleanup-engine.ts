import type { Pool } from "pg";
import { telegramApi } from "../telegram/api.ts";

type TgMessage = {
  message_id:number; chat:{id:number;type:string}; from?:{id:number;username?:string;first_name?:string};
  text?:string; caption?:string; photo?:unknown[]; video?:unknown; audio?:unknown; document?:unknown;
  animation?:unknown; sticker?:unknown; voice?:unknown; video_note?:unknown; contact?:unknown; location?:unknown;
  poll?:unknown; venue?:unknown; dice?:unknown; date?:number;
};

const running=new Set<number>();
const schemaSQL=[
`CREATE TABLE IF NOT EXISTS cleanup_messages(id BIGSERIAL PRIMARY KEY,group_id BIGINT NOT NULL,message_id BIGINT NOT NULL,user_id BIGINT,username TEXT,message_type TEXT NOT NULL DEFAULT 'text',has_link BOOLEAN NOT NULL DEFAULT FALSE,has_media BOOLEAN NOT NULL DEFAULT FALSE,has_bot BOOLEAN NOT NULL DEFAULT FALSE,content TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(group_id,message_id))`,
`CREATE INDEX IF NOT EXISTS cleanup_messages_group_created_idx ON cleanup_messages(group_id,created_at DESC)`,
`CREATE INDEX IF NOT EXISTS cleanup_messages_group_user_idx ON cleanup_messages(group_id,user_id,created_at DESC)`,
`CREATE TABLE IF NOT EXISTS cleanup_jobs(id BIGSERIAL PRIMARY KEY,job_key TEXT UNIQUE NOT NULL,group_id BIGINT NOT NULL,actor_id BIGINT NOT NULL,mode TEXT NOT NULL,filters JSONB NOT NULL DEFAULT '{}'::jsonb,status TEXT NOT NULL DEFAULT 'preview',total_count INT NOT NULL DEFAULT 0,eligible_count INT NOT NULL DEFAULT 0,success_count INT NOT NULL DEFAULT 0,failure_count INT NOT NULL DEFAULT 0,skipped_count INT NOT NULL DEFAULT 0,last_error TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),started_at TIMESTAMPTZ,finished_at TIMESTAMPTZ)`,
`CREATE TABLE IF NOT EXISTS cleanup_job_items(id BIGSERIAL PRIMARY KEY,job_id BIGINT NOT NULL REFERENCES cleanup_jobs(id) ON DELETE CASCADE,message_id BIGINT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',error_code TEXT,error_text TEXT,UNIQUE(job_id,message_id))`,
`CREATE TABLE IF NOT EXISTS cleanup_protected_messages(group_id BIGINT NOT NULL,message_id BIGINT NOT NULL,reason TEXT,created_by BIGINT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(group_id,message_id))`,
`CREATE TABLE IF NOT EXISTS cleanup_rules(id BIGSERIAL PRIMARY KEY,group_id BIGINT NOT NULL,name TEXT NOT NULL,filters JSONB NOT NULL DEFAULT '{}'::jsonb,enabled BOOLEAN NOT NULL DEFAULT TRUE,created_by BIGINT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
`CREATE TABLE IF NOT EXISTS cleanup_audit_log(id BIGSERIAL PRIMARY KEY,group_id BIGINT NOT NULL,actor_id BIGINT NOT NULL,action TEXT NOT NULL,job_id BIGINT,details JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
];
export async function ensureCleanupSchema(pool:Pool){for(const sql of schemaSQL)await pool.query(sql);}

function meta(msg:TgMessage){
  const content=String(msg.text??msg.caption??"").slice(0,4000);
  const media=!!(msg.photo||msg.video||msg.audio||msg.document||msg.animation||msg.sticker||msg.voice||msg.video_note);
  const type=msg.photo?"photo":msg.video?"video":msg.document?"document":msg.audio?"audio":msg.voice?"voice":msg.video_note?"video_note":msg.animation?"animation":msg.sticker?"sticker":msg.contact?"contact":msg.location?"location":msg.poll?"poll":msg.venue?"venue":msg.dice?"dice":"text";
  const link=/(https?:\/\/|t\.me\/|www\\.)/i.test(content);
  const bot=!!msg.from?.is_bot;
  return {content,media,type,link,bot};
}
export async function trackCleanupMessage(pool:Pool,msg:TgMessage){
  if(!msg.from||msg.chat.type==="private")return;
  const m=meta(msg);
  await pool.query(`INSERT INTO cleanup_messages(group_id,message_id,user_id,username,message_type,has_link,has_media,has_bot,content,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE(to_timestamp($11),NOW())) ON CONFLICT(group_id,message_id) DO UPDATE SET content=EXCLUDED.content,username=EXCLUDED.username,message_type=EXCLUDED.message_type,has_link=EXCLUDED.has_link,has_media=EXCLUDED.has_media,has_bot=EXCLUDED.has_bot`,
    [msg.chat.id,msg.message_id,msg.from.id,msg.from.username??null,m.type,m.link,m.media,m.bot,m.content,msg.date??null]);
}
function filterWhere(filters:any){
  const w:string[]=["m.group_id=$1"];const p:any[]=[];let n=2;
  if(filters.hours){w.push(`m.created_at>=NOW()-($${n}::int * INTERVAL '1 hour')`);p.push(Math.min(48,Math.max(1,Number(filters.hours)||24)));n++;}
  if(filters.type&&filters.type!=="all"){if(filters.type==="media")w.push("m.has_media=TRUE");else if(filters.type==="link")w.push("m.has_link=TRUE");else if(filters.type==="bot")w.push("m.has_bot=TRUE");else {w.push(`m.message_type=$${n}`);p.push(filters.type);n++;}}
  if(filters.userId){w.push(`m.user_id=$${n}`);p.push(String(filters.userId));n++;}
  if(filters.limit){p.push(Math.min(10000,Math.max(1,Number(filters.limit)||100)));w.push(`m.message_id IN (SELECT message_id FROM cleanup_messages WHERE group_id=$1 ORDER BY created_at DESC LIMIT $${n})`);n++;}
  return {where:w.join(" AND "),params:p};
}
async function candidateRows(pool:Pool,groupId:number,filters:any){
  const f=filterWhere(filters);
  const r=await pool.query(`SELECT m.message_id,m.user_id,m.message_type,m.has_media,m.has_link,m.content FROM cleanup_messages m
    WHERE ${f.where}
      AND NOT EXISTS(SELECT 1 FROM cleanup_protected_messages p WHERE p.group_id=m.group_id AND p.message_id=m.message_id)
    ORDER BY m.created_at DESC LIMIT 10000`,[groupId,...f.params]);
  return r.rows;
}
async function isAdmin(pool:Pool,groupId:number,userId:string,cache:Map<string,boolean>){
  if(cache.has(userId))return cache.get(userId)!;
  const r=await telegramApi<any>("getChatMember",{chat_id:groupId,user_id:Number(userId)});
  const v=!!r.ok&&["administrator","creator"].includes(String(r.result?.status??""));
  cache.set(userId,v);return v;
}
function panelText(title:string,lines:string[]){return "◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Cʟᴇᴀɴᴜᴘ Cᴇɴᴛᴇʀ\n\n─────━━───── ◈ ─────━━─────\n\n★ - "+title+"\n\n"+lines.join("\n")+"\n\n─────━━───── ◈ ─────━━─────";}
function keyboard(rows:string[][]){return {inline_keyboard:rows.map(r=>r.map(x=>{const [text,data]=x.split("§");return {text,callback_data:data};}))};}
export async function openCleanupCenter(pool:Pool,chatId:number,actorId:number){
  await ensureCleanupSchema(pool);
  const stats=await pool.query("SELECT COUNT(*)::int count FROM cleanup_messages WHERE group_id=$1",[chatId]);
  const removed=await pool.query("SELECT COALESCE(SUM(success_count),0)::int n FROM cleanup_jobs WHERE group_id=$1",[chatId]);
  const ok=await pool.query("SELECT COUNT(*)::int n FROM cleanup_jobs WHERE group_id=$1 AND status='completed'",[chatId]);
  const bad=await pool.query("SELECT COUNT(*)::int n FROM cleanup_jobs WHERE group_id=$1 AND failure_count>0",[chatId]);
  const s=stats.rows[0]??{count:0};
  return (await telegramApi("sendMessage",{chat_id:chatId,text:panelText("وضعیت",[
    "⛂ - سیستم : ✓ آماده",
    "⛂ - دسترسی حذف : ✓",
    "⛂ - Queue : 0",
    "⛂ - عملیات فعال : 0",
    "",
    "★ - آمار",
    "",
    "⛂ - پیام بررسی‌شده : "+s.count,
    "⛂ - پیام حذف‌شده : "+removed.rows[0].n,
    "⛂ - عملیات موفق : "+ok.rows[0].n,
    "⛂ - عملیات ناموفق : "+bad.rows[0].n,
    "",
    "★ - عملیات"
  ]),reply_markup:keyboard([
    ["پاکسازی پیام§cln:scan:all","پاکسازی رسانه§cln:scan:media"],
    ["پاکسازی لینک§cln:scan:link","پاکسازی کاربر§cln:user"],
    ["پاکسازی اسپم§cln:spam","پاکسازی سفارشی§cln:custom"],
    ["پیش‌نمایش§cln:preview","Jobها§cln:jobs"],
    ["تاریخچه§cln:history","قوانین§cln:rules"],
    ["استثناها§cln:protected","تنظیمات§cln:settings"],
    ["بازگشت§cln:close"]
  ])})).ok;
}
export async function handleCleanupText(pool:Pool,chatId:number,actorId:number,text:string,replyUserId?:number,replyMessageId?:number){
  const raw=text.trim().replace(/^[/!]/,"").trim();
  const n=raw.toLowerCase();
  if(!["پاکسازی","cleanup"].includes(n)&&!n.startsWith("پاکسازی "))return false;
  await ensureCleanupSchema(pool);
  if(n==="پاکسازی محافظت"&&replyMessageId){
    await pool.query("INSERT INTO cleanup_protected_messages(group_id,message_id,created_by,reason) VALUES($1,$2,$3,'manual') ON CONFLICT DO NOTHING",[chatId,replyMessageId,actorId]);
    await telegramApi("sendMessage",{chat_id:chatId,text:panelText("پیام محافظت شد",["⛂ - پیام : "+replyMessageId,"⛂ - وضعیت : ✓ در برابر پاکسازی محافظت شد"])});
    return true;
  }
  if(n==="پاکسازی رفع محافظت"&&replyMessageId){
    await pool.query("DELETE FROM cleanup_protected_messages WHERE group_id=$1 AND message_id=$2",[chatId,replyMessageId]);
    await telegramApi("sendMessage",{chat_id:chatId,text:panelText("حفاظت حذف شد",["⛂ - پیام : "+replyMessageId,"⛂ - وضعیت : ✓ دوباره قابل بررسی است"])});
    return true;
  }
  if(n==="پاکسازی کاربر"&&replyUserId){
    const p=await createPreview(pool,chatId,actorId,{type:"all",userId:replyUserId});
    await telegramApi("sendMessage",{chat_id:chatId,text:panelText("پیش‌نمایش کاربر",["⛂ - کاربر : "+replyUserId,"⛂ - بررسی‌شده : "+p.rawCount,"⛂ - قابل حذف : "+p.eligible,"⛂ - مستثنی‌شده : "+p.skipped]),reply_markup:keyboard([["تأیید حذف§cln:run:"+p.job.id],["لغو§cln:cancel:"+p.job.id]])});
    return true;
  }
  const m=n.match(/^پاکسازی\s+(لینک|رسانه|عکس|ویدیو|فایل|صوت|ویس|استیکر|ربات)(?:\s+(\\d+)h)?$/i);
  if(m){
    const aliases:any={لینک:"link",رسانه:"media",عکس:"photo",ویدیو:"video",فایل:"document",صوت:"audio",ویس:"voice",استیکر:"sticker",ربات:"bot"};
    const p=await createPreview(pool,chatId,actorId,{type:aliases[m[1]],hours:m[2]?Number(m[2]):48});
    await telegramApi("sendMessage",{chat_id:chatId,text:panelText("پیش‌نمایش عملیات",["⛂ - نوع : "+m[1],"⛂ - بازه : "+(m[2]?m[2]+" ساعت":"۴۸ ساعت"),"⛂ - بررسی‌شده : "+p.rawCount,"⛂ - قابل حذف : "+p.eligible,"⛂ - مستثنی‌شده : "+p.skipped]),reply_markup:keyboard([["تأیید حذف§cln:run:"+p.job.id],["لغو§cln:cancel:"+p.job.id]])});
    return true;
  }
  await openCleanupCenter(pool,chatId,actorId);return true;
}
async function createPreview(pool:Pool,groupId:number,actorId:number,filters:any){
  const raw=await candidateRows(pool,groupId,filters);const cache=new Map<string,boolean>();const rows=[];
  for(const x of raw){if(x.user_id&&await isAdmin(pool,groupId,String(x.user_id),cache))continue;rows.push(x);}
  const key="CLN-"+Date.now()+"-"+Math.floor(Math.random()*1000);
  const j=await pool.query("INSERT INTO cleanup_jobs(job_key,group_id,actor_id,mode,filters,status,total_count,eligible_count,skipped_count) VALUES($1,$2,$3,'delete',$4,'preview',$5,$6,$7) RETURNING id,job_key",[key,groupId,actorId,JSON.stringify(filters),raw.length,rows.length,raw.length-rows.length]);
  const job=j.rows[0];
  for(const x of rows)await pool.query("INSERT INTO cleanup_job_items(job_id,message_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[job.id,x.message_id]);
  await pool.query("INSERT INTO cleanup_audit_log(group_id,actor_id,action,job_id,details) VALUES($1,$2,'preview',$3,$4)",[groupId,actorId,job.id,JSON.stringify({filters,total:raw.length,eligible:rows.length})]);
  return {job,rawCount:raw.length,eligible:rows.length,skipped:raw.length-rows.length};
}
async function executeJob(pool:Pool,jobId:number,groupId:number){
  if(running.has(groupId))throw new Error("CLEANUP_BUSY");
  running.add(groupId);
  try{
    await pool.query("UPDATE cleanup_jobs SET status='running',started_at=NOW() WHERE id=$1 AND status='preview'",[jobId]);
    const items=(await pool.query("SELECT message_id FROM cleanup_job_items WHERE job_id=$1 AND status='pending' ORDER BY id",[jobId])).rows;
    let ok=0,fail=0;
    for(let i=0;i<items.length;i+=100){
      const ids=items.slice(i,i+100).map((x:any)=>Number(x.message_id));
      const r=await telegramApi<any>("deleteMessages",{chat_id:groupId,message_ids:ids});
      if(r.ok){
        ok+=ids.length;await pool.query("UPDATE cleanup_job_items SET status='success' WHERE job_id=$1 AND message_id=ANY($2::bigint[])",[jobId,ids]);
      }else{
        for(const id of ids){const one=await telegramApi<any>("deleteMessage",{chat_id:groupId,message_id:id});if(one.ok){ok++;await pool.query("UPDATE cleanup_job_items SET status='success' WHERE job_id=$1 AND message_id=$2",[jobId,id]);}else{fail++;await pool.query("UPDATE cleanup_job_items SET status='failed',error_text=$3 WHERE job_id=$1 AND message_id=$2",[jobId,id,String(one.description??r.description??"Telegram error")]);}}
      }
    }
    await pool.query("UPDATE cleanup_jobs SET status=$2,success_count=$3,failure_count=$4,finished_at=NOW() WHERE id=$1",[jobId,fail?"completed_with_errors":"completed",ok,fail]);
    await pool.query("INSERT INTO cleanup_audit_log(group_id,actor_id,action,job_id,details) SELECT group_id,actor_id,'execute',$1,jsonb_build_object('success',$2,'failure',$3) FROM cleanup_jobs WHERE id=$1",[jobId,ok,fail]);
    return {ok,fail,total:items.length};
  }finally{running.delete(groupId);}
}
export async function handleCleanupCallback(pool:Pool,cb:any){
  const data=String(cb.data??"");if(!data.startsWith("cln:"))return false;
  const groupId=Number(cb.message?.chat?.id);const actorId=Number(cb.from?.id);if(!Number.isSafeInteger(groupId))return true;
  await ensureCleanupSchema(pool);
  try{
    const parts=data.split(":");const action=parts[1];
    if(action==="scan"){
      const kind=parts[2];const filters:any={type:kind==="all"?"all":kind};
      if(kind==="hours"||kind==="limit"){filters.type="all";filters[kind]=Number(parts[3]);}
      const p=await createPreview(pool,groupId,actorId,filters);const j=p.job;
      await telegramApi("editMessageText",{chat_id:groupId,message_id:cb.message.message_id,text:panelText("پیش‌نمایش عملیات",[
        "⛂ - Job : "+j.job_key,
        "⛂ - بررسی‌شده : "+p.rawCount,
        "⛂ - قابل حذف : "+p.eligible,
        "⛂ - مستثنی‌شده : "+p.skipped,
        "",
        "⛂ - وضعیت : آماده تأیید"
      ]),reply_markup:keyboard([["تأیید حذف§cln:run:"+j.id],["لغو§cln:cancel:"+j.id],["تاریخچه§cln:history"]])});
      return true;
    }
    if(action==="run"){
      const id=Number(parts[2]);const j=(await pool.query("SELECT * FROM cleanup_jobs WHERE id=$1 AND group_id=$2",[id,groupId])).rows[0];if(!j)throw new Error("JOB_NOT_FOUND");
      if(Number(j.actor_id)!==actorId)throw new Error("NOT_OWNER");
      if(j.status!=="preview")throw new Error("JOB_ALREADY_USED");
      const result=await executeJob(pool,id,groupId);
      await telegramApi("editMessageText",{chat_id:groupId,message_id:cb.message.message_id,text:panelText("نتیجه پاکسازی",[
        "⛂ - Job : "+j.job_key,
        "⛂ - موفق : "+result.ok,
        "⛂ - ناموفق : "+result.fail,
        "⛂ - مجموع : "+result.total,
        "⛂ - وضعیت : "+(result.fail?"⚠ با خطا":"✓ کامل")
      ]),reply_markup:keyboard([["مرکز پاکسازی§cln:center"],["تاریخچه§cln:history"]])});
      return true;
    }
    if(action==="cancel"){const id=Number(parts[2]);await pool.query("UPDATE cleanup_jobs SET status='cancelled',finished_at=NOW() WHERE id=$1 AND group_id=$2 AND actor_id=$3 AND status='preview'",[id,groupId,actorId]);await telegramApi("editMessageText",{chat_id:groupId,message_id:cb.message.message_id,text:panelText("عملیات لغو شد",["⛂ - Job : CLN-"+id,"⛂ - وضعیت : ✗ لغو شده"]),reply_markup:keyboard([["مرکز پاکسازی§cln:center"]])});return true;}
    if(action==="center"){await openCleanupCenter(pool,groupId,actorId);return true;}
    if(action==="history"){const r=await pool.query("SELECT job_key,status,total_count,eligible_count,success_count,failure_count,created_at FROM cleanup_jobs WHERE group_id=$1 ORDER BY id DESC LIMIT 10",[groupId]);const lines=r.rows.length?r.rows.map((x:any)=>"⛂ - "+x.job_key+" | "+x.status+" | "+x.success_count+"/"+x.total_count):["⛂ - هنوز عملیاتی ثبت نشده است."];await telegramApi("editMessageText",{chat_id:groupId,message_id:cb.message.message_id,text:panelText("تاریخچه",lines),reply_markup:keyboard([["‹ بازگشت§cln:center"]])});return true;}
    if(action==="jobs"){const r=await pool.query("SELECT job_key,status,eligible_count,success_count,failure_count FROM cleanup_jobs WHERE group_id=$1 ORDER BY id DESC LIMIT 8",[groupId]);const lines=r.rows.length?r.rows.map((x:any)=>"⛂ - "+x.job_key+" | "+x.status+" | "+x.success_count+"/"+x.eligible_count):["⛂ - Job فعالی وجود ندارد."];await telegramApi("editMessageText",{chat_id:groupId,message_id:cb.message.message_id,text:panelText("Jobهای پاکسازی",lines),reply_markup:keyboard([["‹ بازگشت§cln:center"]])});return true;}
    if(action==="protected"){const r=await pool.query("SELECT message_id,reason FROM cleanup_protected_messages WHERE group_id=$1 ORDER BY created_at DESC LIMIT 30",[groupId]);const lines=r.rows.length?r.rows.map((x:any)=>"⛂ - پیام "+x.message_id+" | "+(x.reason??"—")):["⛂ - پیام محافظت‌شده‌ای ثبت نشده است."];await telegramApi("editMessageText",{chat_id:groupId,message_id:cb.message.message_id,text:panelText("استثناها و پیام‌های محافظت‌شده",lines),reply_markup:keyboard([["‹ بازگشت§cln:center"]])});return true;}
    if(action==="user"){await telegramApi("editMessageText",{chat_id:groupId,message_id:cb.message.message_id,text:panelText("پاکسازی کاربر",["⛂ - این بخش برای Reply به پیام کاربر طراحی شده است.","⛂ - در نسخه فعلی، پیام‌های کاربر از طریق فیلتر Job قابل اجرا هستند."]),reply_markup:keyboard([["‹ بازگشت§cln:center"]])});return true;}
    if(action==="custom"){await telegramApi("editMessageText",{chat_id:groupId,message_id:cb.message.message_id,text:panelText("پاکسازی سفارشی",["⛂ - نمونه : پاکسازی لینک 24h","⛂ - نمونه : «پاکسازی کاربر» در پاسخ به پیام کاربر","⛂ - پیام محافظت‌شده با «پاکسازی محافظت» در Reply ثبت می‌شود.","⛂ - همه عملیات قبل از حذف وارد Preview می‌شوند."]),reply_markup:keyboard([["‹ بازگشت§cln:center"]])});return true;}
  }catch(e){
    const msg=String((e as any)?.message??e);await telegramApi("editMessageText",{chat_id:groupId,message_id:cb.message.message_id,text:panelText("خطای پاکسازی",["⛂ - وضعیت : ✗ عملیات انجام نشد","⛂ - خطا : "+msg]),reply_markup:keyboard([["‹ بازگشت§cln:center"]])}).catch(()=>{});
  }
  return true;
}
