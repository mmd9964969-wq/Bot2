import type { Pool } from "pg";
import { telegramApi } from "../telegram/api.ts";

type TgMessage = {
  message_id:number;
  chat:{id:number;type:string};
  from?:{id:number;username?:string;first_name?:string;is_bot?:boolean};
  text?:string; caption?:string; photo?:unknown[]; video?:unknown; audio?:unknown; document?:unknown;
  animation?:unknown; sticker?:unknown; voice?:unknown; video_note?:unknown; contact?:unknown; location?:unknown;
  poll?:unknown; venue?:unknown; dice?:unknown; date?:number;
};

const running=new Set<number>();

const schemaSQL=[
`CREATE TABLE IF NOT EXISTS cleanup_messages(
  id BIGSERIAL PRIMARY KEY,group_id BIGINT NOT NULL,message_id BIGINT NOT NULL,user_id BIGINT,username TEXT,
  message_type TEXT NOT NULL DEFAULT 'text',has_link BOOLEAN NOT NULL DEFAULT FALSE,has_media BOOLEAN NOT NULL DEFAULT FALSE,
  has_bot BOOLEAN NOT NULL DEFAULT FALSE,content TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(group_id,message_id)
)`,
`ALTER TABLE cleanup_messages ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE cleanup_messages ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text';
ALTER TABLE cleanup_messages ADD COLUMN IF NOT EXISTS has_link BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE cleanup_messages ADD COLUMN IF NOT EXISTS has_media BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE cleanup_messages ADD COLUMN IF NOT EXISTS has_bot BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE cleanup_messages ADD COLUMN IF NOT EXISTS content TEXT;
ALTER TABLE cleanup_messages ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE UNIQUE INDEX IF NOT EXISTS cleanup_messages_group_message_uidx ON cleanup_messages(group_id,message_id);
CREATE INDEX IF NOT EXISTS cleanup_messages_group_created_idx ON cleanup_messages(group_id,created_at DESC)`,
`CREATE INDEX IF NOT EXISTS cleanup_messages_group_user_idx ON cleanup_messages(group_id,user_id,created_at DESC)`,
`CREATE TABLE IF NOT EXISTS cleanup_jobs(
  id BIGSERIAL PRIMARY KEY,job_key TEXT UNIQUE NOT NULL,group_id BIGINT NOT NULL,actor_id BIGINT NOT NULL,mode TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,status TEXT NOT NULL DEFAULT 'preview',total_count INT NOT NULL DEFAULT 0,
  eligible_count INT NOT NULL DEFAULT 0,success_count INT NOT NULL DEFAULT 0,failure_count INT NOT NULL DEFAULT 0,
  skipped_count INT NOT NULL DEFAULT 0,last_error TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,finished_at TIMESTAMPTZ
)`,
`CREATE INDEX IF NOT EXISTS cleanup_jobs_group_status_idx ON cleanup_jobs(group_id,status,created_at DESC)`,
`CREATE TABLE IF NOT EXISTS cleanup_job_items(
  id BIGSERIAL PRIMARY KEY,job_id BIGINT NOT NULL REFERENCES cleanup_jobs(id) ON DELETE CASCADE,message_id BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',error_code TEXT,error_text TEXT,UNIQUE(job_id,message_id)
)`,
`CREATE TABLE IF NOT EXISTS cleanup_protected_messages(
  group_id BIGINT NOT NULL,message_id BIGINT NOT NULL,reason TEXT,created_by BIGINT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(group_id,message_id)
)`,
`CREATE TABLE IF NOT EXISTS cleanup_rules(
  id BIGSERIAL PRIMARY KEY,group_id BIGINT NOT NULL,name TEXT NOT NULL,filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,created_by BIGINT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE INDEX IF NOT EXISTS cleanup_rules_group_idx ON cleanup_rules(group_id,enabled,updated_at DESC)`,
`CREATE TABLE IF NOT EXISTS cleanup_rule_sessions(
  group_id BIGINT NOT NULL,actor_id BIGINT NOT NULL,filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(group_id,actor_id)
)`,
`CREATE TABLE IF NOT EXISTS cleanup_spam_scores(
  id BIGSERIAL PRIMARY KEY,group_id BIGINT NOT NULL,message_id BIGINT NOT NULL,user_id BIGINT,score INT NOT NULL DEFAULT 0,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(group_id,message_id)
)`,
`CREATE INDEX IF NOT EXISTS cleanup_spam_scores_group_score_idx ON cleanup_spam_scores(group_id,score DESC,created_at DESC)`,
`CREATE TABLE IF NOT EXISTS cleanup_audit_log(
  id BIGSERIAL PRIMARY KEY,group_id BIGINT NOT NULL,actor_id BIGINT NOT NULL,action TEXT NOT NULL,job_id BIGINT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`
];

export async function ensureCleanupSchema(pool:Pool){
  for(const sql of schemaSQL) await pool.query(sql);
}

function meta(msg:TgMessage){
  const content=String(msg.text??msg.caption??"").slice(0,4000);
  const media=!!(msg.photo||msg.video||msg.audio||msg.document||msg.animation||msg.sticker||msg.voice||msg.video_note);
  const type=msg.photo?"photo":msg.video?"video":msg.document?"document":msg.audio?"audio":msg.voice?"voice":
    msg.video_note?"video_note":msg.animation?"animation":msg.sticker?"sticker":msg.contact?"contact":msg.location?"location":
    msg.poll?"poll":msg.venue?"venue":msg.dice?"dice":"text";
  const link=/(https?:\/\/|t\.me\/|www\.)/i.test(content);
  const bot=!!msg.from?.is_bot;
  return {content,media,type,link,bot};
}

export async function trackCleanupMessage(pool:Pool,msg:TgMessage){
  if(!msg.from||msg.chat.type==="private") return;
  const m=meta(msg);
  await pool.query(
    `INSERT INTO cleanup_messages(group_id,message_id,user_id,username,message_type,has_link,has_media,has_bot,content,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE(to_timestamp($11),NOW()))
     ON CONFLICT(group_id,message_id) DO UPDATE SET
       content=EXCLUDED.content,username=EXCLUDED.username,message_type=EXCLUDED.message_type,
       has_link=EXCLUDED.has_link,has_media=EXCLUDED.has_media,has_bot=EXCLUDED.has_bot`,
    [msg.chat.id,msg.message_id,msg.from.id,msg.from.username??null,m.type,m.link,m.media,m.bot,m.content,msg.date??null]
  );
  try{
    const spam=await scoreSpamMessage(pool,msg.chat.id,msg.message_id,msg.from.id,m.content,m.link,m.bot);
    await pool.query(
      `INSERT INTO cleanup_spam_scores(group_id,message_id,user_id,score,reasons)
       VALUES($1,$2,$3,$4,$5::jsonb)
       ON CONFLICT(group_id,message_id) DO UPDATE SET score=EXCLUDED.score,reasons=EXCLUDED.reasons`,
      [msg.chat.id,msg.message_id,msg.from.id,spam.score,JSON.stringify(spam.reasons)]
    );
  }catch(error){
    console.error("[cleanup] spam scoring failed:",error);
  }
}

function normalizeContent(value:string){
  return value.toLowerCase().replace(/https?:\/\/\S+/g,"<url>").replace(/\s+/g," ").trim().slice(0,500);
}

async function scoreSpamMessage(pool:Pool,groupId:number,messageId:number,userId:number,content:string,hasLink:boolean,isBot:boolean){
  let score=0;
  const reasons:string[]=[];
  const normalized=normalizeContent(content);
  if(isBot){score+=15;reasons.push("bot");}
  if(hasLink){score+=25;reasons.push("link");}
  const mentions=(content.match(/@/g)||[]).length;
  if(mentions>=3){score+=15;reasons.push("many_mentions");}
  if(/(?:فروش|خرید|تبلیغ|promo|buy now|free|airdrop|casino|crypto|telegram\.me\/joinchat)/i.test(content)){
    score+=30;reasons.push("advertising");
  }
  if(normalized){
    const duplicate=await pool.query(
      `SELECT COUNT(*)::int AS n FROM cleanup_messages WHERE group_id=$1 AND user_id=$2
       AND message_id<>$3 AND created_at>=NOW()-INTERVAL '10 minutes'
       AND lower(regexp_replace(regexp_replace(COALESCE(content,''),'https?:\\/\\/\\S+','<url>','gi'),'\\s+',' ','g'))= $4`,
      [groupId,userId,messageId,normalized]
    );
    if(Number(duplicate.rows[0]?.n??0)>=1){score+=30;reasons.push("duplicate");}
  }
  const burst=await pool.query(
    `SELECT COUNT(*)::int AS n FROM cleanup_messages WHERE group_id=$1 AND user_id=$2
     AND created_at>=NOW()-INTERVAL '15 seconds'`,
    [groupId,userId]
  );
  if(Number(burst.rows[0]?.n??0)>=5){score+=20;reasons.push("burst");}
  return {score:Math.min(100,score),reasons};
}

function filterWhere(filters:any){
  const w:string[]=["m.group_id=$1"];const p:any[]=[];let n=2;
  if(filters.hours){
    w.push(`m.created_at>=NOW()-($${n}::int * INTERVAL '1 hour')`);
    p.push(Math.min(168,Math.max(1,Number(filters.hours)||24)));n++;
  }
  if(Array.isArray(filters.types)&&filters.types.length){
    const vals=filters.types.map((x:any)=>String(x)).filter(Boolean);
    const ph=vals.map((_,i)=>"$"+(n+i)).join(",");
    w.push(`m.message_type IN (${ph})`);p.push(...vals);n+=vals.length;
  }else if(filters.type&&filters.type!=="all"){
    if(filters.type==="media") w.push("m.has_media=TRUE");
    else if(filters.type==="link") w.push("m.has_link=TRUE");
    else if(filters.type==="bot") w.push("m.has_bot=TRUE");
    else {w.push(`m.message_type=$${n}`);p.push(filters.type);n++;}
  }
  if(filters.userId){w.push(`m.user_id=${n}`);p.push(String(filters.userId));n++;}
  if(filters.userType==="members"){w.push("m.has_bot=FALSE");}
  if(filters.contains){w.push(`COALESCE(m.content,'') ILIKE $${n}`);p.push("%"+String(filters.contains)+"%");n++;}
  if(filters.notContains){w.push(`COALESCE(m.content,'') NOT ILIKE $${n}`);p.push("%"+String(filters.notContains)+"%");n++;}
  if(filters.spamThreshold){
    w.push(`EXISTS(SELECT 1 FROM cleanup_spam_scores ss WHERE ss.group_id=m.group_id AND ss.message_id=m.message_id AND ss.score >= $${n})`);
    p.push(Math.min(100,Math.max(0,Number(filters.spamThreshold)||60)));n++;
  }
  if(filters.limit){
    const lim=Math.min(10000,Math.max(1,Number(filters.limit)||100));
    w.push(`m.message_id IN (SELECT message_id FROM cleanup_messages WHERE group_id=$1 ORDER BY created_at DESC LIMIT $${n})`);
    p.push(lim);n++;
  }
  return {where:w.join(" AND "),params:p};
}

async function pinnedMessageId(groupId:number){
  try{
    const r=await telegramApi<any>("getChat",{chat_id:groupId});
    return r.ok&&r.result?.pinned_message?.message_id?Number(r.result.pinned_message.message_id):null;
  }catch{return null;}
}

async function candidateRows(pool:Pool,groupId:number,filters:any){
  const f=filterWhere(filters);
  const messageId=filters?.messageId!=null?Number(filters.messageId):null;
  if(messageId&&Number.isSafeInteger(messageId)){
    const r=await pool.query(
      `SELECT m.message_id,m.user_id,m.message_type,m.has_media,m.has_link,m.has_bot,m.content,m.created_at
       FROM cleanup_messages m
       WHERE m.group_id=$1 AND m.message_id=$2
       AND NOT EXISTS(SELECT 1 FROM cleanup_protected_messages p WHERE p.group_id=m.group_id AND p.message_id=m.message_id)`,
      [groupId,messageId]
    );
    return r.rows;
  }
  const pinned=await pinnedMessageId(groupId);
  const r=await pool.query(
    `SELECT m.message_id,m.user_id,m.message_type,m.has_media,m.has_link,m.has_bot,m.content,m.created_at
     FROM cleanup_messages m WHERE ${f.where}
     AND NOT EXISTS(SELECT 1 FROM cleanup_protected_messages p WHERE p.group_id=m.group_id AND p.message_id=m.message_id)
     ${pinned? "AND m.message_id<>$"+(f.params.length+2):""}
     ORDER BY m.created_at DESC LIMIT 10000`,
    [groupId,...f.params,...(pinned?[pinned]:[])]
  );
  return r.rows;
}

async function isAdmin(groupId:number,userId:string,cache:Map<string,boolean>){
  if(cache.has(userId))return cache.get(userId)!;
  const r=await telegramApi<any>("getChatMember",{chat_id:groupId,user_id:Number(userId)});
  const v=!!r.ok&&["administrator","creator"].includes(String(r.result?.status??""));
  cache.set(userId,v);return v;
}

function panelText(title:string,lines:string[]){
  return "◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Cʟᴇᴀɴᴜᴘ Cᴇɴᴛᴇʀ\n\n─────━━───── ◈ ─────━━─────\n\n★ - "+title+"\n\n"+lines.join("\n")+"\n\n─────━━───── ◈ ─────━━─────";
}

function keyboard(rows:string[][]){
  return {inline_keyboard:rows.map(r=>r.map(x=>{const [text,data]=x.split("§");return {text,callback_data:data};}))};
}

async function createPreview(pool:Pool,groupId:number,actorId:number,filters:any){
  const raw=await candidateRows(pool,groupId,filters);
  const cache=new Map<string,boolean>();
  const rows:any[]=[];
  for(const x of raw){
    if(x.user_id&&await isAdmin(groupId,String(x.user_id),cache)) continue;
    rows.push(x);
  }
  const key="CLN-"+Date.now()+"-"+Math.floor(Math.random()*1000);
  const j=await pool.query(
    `INSERT INTO cleanup_jobs(job_key,group_id,actor_id,mode,filters,status,total_count,eligible_count,skipped_count)
     VALUES($1,$2,$3,'delete',$4,'preview',$5,$6,$7) RETURNING id,job_key`,
    [key,groupId,actorId,JSON.stringify(filters),raw.length,rows.length,raw.length-rows.length]
  );
  const job=j.rows[0];
  for(const x of rows){
    await pool.query("INSERT INTO cleanup_job_items(job_id,message_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[job.id,x.message_id]);
  }
  await pool.query(
    "INSERT INTO cleanup_audit_log(group_id,actor_id,action,job_id,details) VALUES($1,$2,'preview',$3,$4)",
    [groupId,actorId,job.id,JSON.stringify({filters,total:raw.length,eligible:rows.length})]
  );
  return {job,rawCount:raw.length,eligible:rows.length,skipped:raw.length-rows.length};
}

async function executeJob(pool:Pool,jobId:number,groupId:number){
  if(running.has(groupId)) throw new Error("CLEANUP_BUSY");
  running.add(groupId);
  try{
    await pool.query(
      "UPDATE cleanup_jobs SET status='running',started_at=COALESCE(started_at,NOW()),finished_at=NULL WHERE id=$1 AND status IN ('preview','queued','paused','retrying')",
      [jobId]
    );
    while(true){
      const state=(await pool.query("SELECT status FROM cleanup_jobs WHERE id=$1 AND group_id=$2",[jobId,groupId])).rows[0]?.status;
      if(state==="paused"||state==="cancelled"||state!=="running") break;
      const item=(await pool.query(
        "SELECT message_id FROM cleanup_job_items WHERE job_id=$1 AND status='pending' ORDER BY id LIMIT 1",[jobId]
      )).rows[0];
      if(!item) break;
      const id=Number(item.message_id);
      const r=await telegramApi<any>("deleteMessage",{chat_id:groupId,message_id:id});
      if(r.ok){
        await pool.query("UPDATE cleanup_job_items SET status='success' WHERE job_id=$1 AND message_id=$2",[jobId,id]);
        await pool.query("UPDATE cleanup_jobs SET success_count=success_count+1 WHERE id=$1",[jobId]);
      }else{
        await pool.query(
          "UPDATE cleanup_job_items SET status='failed',error_code=$3,error_text=$4 WHERE job_id=$1 AND message_id=$2",
          [jobId,id,String(r.error_code??"TELEGRAM_ERROR"),String(r.description??"Telegram deleteMessage failed")]
        );
        await pool.query(
          "UPDATE cleanup_jobs SET failure_count=failure_count+1,last_error=$2 WHERE id=$1",
          [jobId,String(r.description??"Telegram deleteMessage failed")]
        );
      }
    }
    const state=(await pool.query("SELECT * FROM cleanup_jobs WHERE id=$1",[jobId])).rows[0];
    if(state?.status==="running"){
      await pool.query(
        "UPDATE cleanup_jobs SET status=$2,finished_at=NOW(),last_error=$3 WHERE id=$1",
        [jobId,Number(state.failure_count)>0?"completed_with_errors":"completed",Number(state.failure_count)>0?"برخی پیام‌ها توسط Telegram حذف نشدند.":null]
      );
    }
    await pool.query(
      "INSERT INTO cleanup_audit_log(group_id,actor_id,action,job_id,details) SELECT group_id,actor_id,'execute',$1,jsonb_build_object('success',success_count,'failure',failure_count) FROM cleanup_jobs WHERE id=$1",
      [jobId]
    );
  }finally{running.delete(groupId);}
}

function queueJob(pool:Pool,jobId:number,groupId:number){
  if(running.has(groupId)) throw new Error("CLEANUP_BUSY");
  void executeJob(pool,jobId,groupId).catch(async error=>{
    const message=String((error as any)?.message??error);
    await pool.query("UPDATE cleanup_jobs SET status='failed',last_error=$2,finished_at=NOW() WHERE id=$1",[jobId,message]).catch(()=>{});
  });
}

async function getRuleSession(pool:Pool,groupId:number,actorId:number){
  const r=await pool.query("SELECT filters FROM cleanup_rule_sessions WHERE group_id=$1 AND actor_id=$2",[groupId,actorId]);
  return r.rows[0]?.filters??{};
}

async function setRuleSession(pool:Pool,groupId:number,actorId:number,filters:any){
  await pool.query(
    `INSERT INTO cleanup_rule_sessions(group_id,actor_id,filters,updated_at) VALUES($1,$2,$3,NOW())
     ON CONFLICT(group_id,actor_id) DO UPDATE SET filters=EXCLUDED.filters,updated_at=NOW()`,
    [groupId,actorId,JSON.stringify(filters)]
  );
}

async function ruleBuilder(pool:Pool,groupId:number,actorId:number){
  const f=await getRuleSession(pool,groupId,actorId);
  const type=Array.isArray(f.types)?f.types.join(", "):(f.type??"all");
  const lines=[
    "⛂ - نوع پیام : "+type,
    "⛂ - کاربر : "+(f.userId??"همه"),
    "⛂ - بازه : "+(f.hours?f.hours+" ساعت":"همه"),
    "⛂ - تعداد : "+(f.limit??"همه"),
    "⛂ - متن شامل : "+(f.contains??"—"),
    "⛂ - امتیاز اسپم : "+(f.spamThreshold??"خاموش"),
    "⛂ - مدیران : همیشه مستثنی",
    "⛂ - پیام محافظت‌شده : مستثنی",
    "⛂ - پیام پین‌شده : مستثنی"
  ];
  return telegramApi("editMessageText",{
    chat_id:groupId,message_id:currentCallbackMessageId,
    text:panelText("Rule Builder",lines),
    reply_markup:keyboard([
      ["نوع پیام§cln:builder:type","کاربر§cln:builder:user"],
      ["بازه زمانی§cln:builder:hours","تعداد پیام§cln:builder:limit"],
      ["امتیاز اسپم§cln:builder:spam","متن/شرط§cln:builder:text"],
      ["پیش‌نمایش Rule§cln:builder:preview","ذخیره Rule§cln:builder:save"],
      ["پاک‌کردن تنظیمات§cln:builder:reset","بازگشت§cln:center"]
    ])
  });
}

let currentCallbackMessageId=0;

export async function openCleanupCenter(pool:Pool,chatId:number,actorId:number){
  await ensureCleanupSchema(pool);
  const [stats,removed,ok,bad,queue,active]=await Promise.all([
    pool.query("SELECT COUNT(*)::int count FROM cleanup_messages WHERE group_id=$1",[chatId]),
    pool.query("SELECT COALESCE(SUM(success_count),0)::int n FROM cleanup_jobs WHERE group_id=$1",[chatId]),
    pool.query("SELECT COUNT(*)::int n FROM cleanup_jobs WHERE group_id=$1 AND status='completed'",[chatId]),
    pool.query("SELECT COUNT(*)::int n FROM cleanup_jobs WHERE group_id=$1 AND failure_count>0",[chatId]),
    pool.query("SELECT COUNT(*)::int n FROM cleanup_jobs WHERE group_id=$1 AND status IN ('preview','queued','paused','retrying')",[chatId]),
    pool.query("SELECT COUNT(*)::int n FROM cleanup_jobs WHERE group_id=$1 AND status='running'",[chatId])
  ]);
  const s=stats.rows[0]??{count:0};
  return (await telegramApi("sendMessage",{
    chat_id:chatId,
    text:panelText("وضعیت",[
      "⛂ - سیستم : ✓ آماده",
      "⛂ - ایندکس پیام : ✓ فعال",
      "⛂ - دسترسی حذف : ✓",
      "⛂ - Queue : "+queue.rows[0].n,
      "⛂ - عملیات فعال : "+active.rows[0].n,
      "",
      "★ - آمار",
      "",
      "⛂ - پیام بررسی‌شده : "+s.count,
      "⛂ - پیام حذف‌شده : "+removed.rows[0].n,
      "⛂ - عملیات موفق : "+ok.rows[0].n,
      "⛂ - عملیات ناموفق : "+bad.rows[0].n,
      "",
      "★ - عملیات"
    ]),
    reply_markup:keyboard([
      ["پیام‌ها — اسکن§cln:scan:all","رسانه‌ها — اسکن§cln:scan:media"],
      ["لینک‌ها — اسکن§cln:scan:link","کاربر — پاکسازی انتخابی§cln:user"],
      ["اسپم — اسکن§cln:spam","Rule Builder§cln:custom"],
      ["آخرین Preview§cln:preview","مدیریت Jobها§cln:jobs"],
      ["تاریخچه§cln:history","قوانین§cln:rules"],
      ["استثناها§cln:protected","تنظیمات§cln:settings"],
      ["بازگشت§cln:close"]
    ])
  })).ok;
}

export async function handleCleanupText(pool:Pool,chatId:number,actorId:number,text:string,replyUserId?:number,replyMessageId?:number){
  const raw=text.trim().replace(/^[/!]/,"").trim();
  const n=raw.toLowerCase();
  if(!["پاکسازی","cleanup"].includes(n)&&!n.startsWith("پاکسازی ")) return false;
  await ensureCleanupSchema(pool);

  if(n==="پاکسازی محافظت"&&replyMessageId){
    await pool.query(
      "INSERT INTO cleanup_protected_messages(group_id,message_id,created_by,reason) VALUES($1,$2,$3,'manual') ON CONFLICT DO NOTHING",
      [chatId,replyMessageId,actorId]
    );
    await telegramApi("sendMessage",{chat_id:chatId,text:panelText("پیام محافظت شد",[
      "⛂ - پیام : "+replyMessageId,"⛂ - وضعیت : ✓ در برابر پاکسازی محافظت شد"
    ])});
    return true;
  }

  if(n==="پاکسازی رفع محافظت"&&replyMessageId){
    await pool.query("DELETE FROM cleanup_protected_messages WHERE group_id=$1 AND message_id=$2",[chatId,replyMessageId]);
    await telegramApi("sendMessage",{chat_id:chatId,text:panelText("حفاظت حذف شد",[
      "⛂ - پیام : "+replyMessageId,"⛂ - وضعیت : ✓ دوباره قابل بررسی است"
    ])});
    return true;
  }

  if(n==="پاکسازی متن"){
    await telegramApi("sendMessage",{chat_id:chatId,text:panelText("شرط متنی",[
      "⛂ - قالب : پاکسازی متن <عبارت>",
      "⛂ - نمونه : پاکسازی متن تبلیغ",
      "⛂ - عبارت در پیام یا کپشن جست‌وجو می‌شود."
    ])});
    return true;
  }
  if(n.startsWith("پاکسازی متن ")){
    const phrase=raw.slice("پاکسازی متن ".length).trim();
    if(phrase){
      const f=await getRuleSession(pool,chatId,actorId);
      f.contains=phrase;
      await setRuleSession(pool,chatId,actorId,f);
      await telegramApi("sendMessage",{chat_id:chatId,text:panelText("شرط متنی ثبت شد",[
        "⛂ - شامل : "+phrase,
        "⛂ - وضعیت : ✓ آماده استفاده در Rule Builder"
      ]),reply_markup:keyboard([["Rule Builder§cln:custom"]])});
    }
    return true;
  }

  if((n==="پاکسازی پیام"||n==="cleanup message")&&replyMessageId){
    const p=await createPreview(pool,chatId,actorId,{type:"all",messageId:replyMessageId});
    await telegramApi("sendMessage",{chat_id:chatId,text:panelText("پیش‌نمایش پیام انتخاب‌شده",[
      "⛂ - پیام : "+replyMessageId,
      "⛂ - بررسی‌شده : "+p.rawCount,
      "⛂ - قابل حذف : "+p.eligible,
      "⛂ - مستثنی‌شده : "+p.skipped
    ]),reply_markup:keyboard([
      ["تأیید حذف§cln:run:"+p.job.id],["لغو§cln:cancel:"+p.job.id],
      ["مرکز پاکسازی§cln:center"]
    ])});
    return true;
  }
  if((n==="پاکسازی پیام"||n==="cleanup message")&&!replyMessageId){
    await telegramApi("sendMessage",{chat_id:chatId,text:panelText("پاکسازی پیام",[
      "⛂ - ابتدا روی پیام موردنظر Reply کنید.",
      "⛂ - سپس بنویسید : پاکسازی پیام",
      "⛂ - قبل از حذف، Preview نمایش داده می‌شود."
    ]),reply_markup:keyboard([["مرکز پاکسازی§cln:center"]])});
    return true;
  }

  if(n==="پاکسازی کاربر"&&replyUserId){
    const p=await createPreview(pool,chatId,actorId,{type:"all",userId:replyUserId});
    await telegramApi("sendMessage",{chat_id:chatId,text:panelText("پیش‌نمایش کاربر",[
      "⛂ - کاربر : "+replyUserId,"⛂ - بررسی‌شده : "+p.rawCount,"⛂ - قابل حذف : "+p.eligible,
      "⛂ - مستثنی‌شده : "+p.skipped
    ]),reply_markup:keyboard([
      ["تأیید حذف§cln:run:"+p.job.id],["لغو§cln:cancel:"+p.job.id]
    ])});
    return true;
  }

  const m=n.match(/^پاکسازی\s+(لینک|رسانه|عکس|ویدیو|فایل|صوت|ویس|استیکر|ربات)(?:\s+(\d+)h)?$/i);
  if(m){
    const aliases:any={لینک:"link",رسانه:"media",عکس:"photo",ویدیو:"video",فایل:"document",صوت:"audio",ویس:"voice",استیکر:"sticker",ربات:"bot"};
    const p=await createPreview(pool,chatId,actorId,{type:aliases[m[1]],hours:m[2]?Number(m[2]):48});
    await telegramApi("sendMessage",{chat_id:chatId,text:panelText("پیش‌نمایش عملیات",[
      "⛂ - نوع : "+m[1],"⛂ - بازه : "+(m[2]?m[2]+" ساعت":"۴۸ ساعت"),
      "⛂ - بررسی‌شده : "+p.rawCount,"⛂ - قابل حذف : "+p.eligible,"⛂ - مستثنی‌شده : "+p.skipped
    ]),reply_markup:keyboard([
      ["تأیید حذف§cln:run:"+p.job.id],["لغو§cln:cancel:"+p.job.id]
    ])});
    return true;
  }

  await openCleanupCenter(pool,chatId,actorId);
  return true;
}

async function handleBuilderCallback(pool:Pool,cb:any,parts:string[],groupId:number,actorId:number){
  const sub=parts[2];
  let f=await getRuleSession(pool,groupId,actorId);

  if(sub==="reset"){
    f={};await setRuleSession(pool,groupId,actorId,f);currentCallbackMessageId=cb.message.message_id;await ruleBuilder(pool,groupId,actorId);return true;
  }
  if(sub==="type"){
    const seq=["all","text","photo","video","document","audio","voice","sticker","media","link","bot"];
    const cur=String(f.type??"all");
    const idx=Math.max(0,seq.indexOf(cur));
    const next=seq[(idx+1)%seq.length];
    f.type=next;
    delete f.types;
  }else if(sub==="user"){
    f.userMode=f.userMode==="members"?"all":"members";
    if(f.userMode==="members")f.userType="members";else delete f.userType;
  }else if(sub==="hours"){
    const seq=[undefined,1,6,24,48,168];const cur=Number(f.hours||0);const idx=seq.findIndex(x=>Number(x||0)===cur);const next=seq[(idx+1)%seq.length];
    if(next)f.hours=next;else delete f.hours;
  }else if(sub==="limit"){
    const seq=[undefined,100,500,1000,5000];const cur=Number(f.limit||0);const idx=seq.findIndex(x=>Number(x||0)===cur);const next=seq[(idx+1)%seq.length];
    if(next)f.limit=next;else delete f.limit;
  }else if(sub==="spam"){
    const seq=[undefined,60,80];const cur=Number(f.spamThreshold||0);const idx=seq.findIndex(x=>Number(x||0)===cur);const next=seq[(idx+1)%seq.length];
    if(next)f.spamThreshold=next;else delete f.spamThreshold;
  }else if(sub==="text"){
    await telegramApi("answerCallbackQuery",{callback_query_id:cb.id,text:"شرط متن را با «پاکسازی متن عبارت» ثبت کنید.",show_alert:true});
    return ruleBuilder(pool,groupId,actorId);
  }else if(sub==="preview"){
    const p=await createPreview(pool,groupId,actorId,f);
    await telegramApi("editMessageText",{chat_id:groupId,message_id:cb.message.message_id,text:panelText("پیش‌نمایش Rule",[
      "⛂ - بررسی‌شده : "+p.rawCount,"⛂ - قابل حذف : "+p.eligible,"⛂ - مستثنی‌شده : "+p.skipped,
      "⛂ - وضعیت : آماده تأیید"
    ]),reply_markup:keyboard([
      ["تأیید حذف§cln:run:"+p.job.id],["لغو§cln:cancel:"+p.job.id],["Rule Builder§cln:custom"]
    ])});
    return true;
  }else if(sub==="save"){
    const name="Rule-"+Date.now();
    const r=await pool.query(
      "INSERT INTO cleanup_rules(group_id,name,filters,created_by) VALUES($1,$2,$3,$4) RETURNING id",
      [groupId,name,JSON.stringify(f),actorId]
    );
    await pool.query("DELETE FROM cleanup_rule_sessions WHERE group_id=$1 AND actor_id=$2",[groupId,actorId]);
    await telegramApi("editMessageText",{chat_id:groupId,message_id:cb.message.message_id,text:panelText("Rule ذخیره شد",[
      "⛂ - نام : "+name,"⛂ - شناسه : "+r.rows[0].id,"⛂ - وضعیت : ✓ فعال"
    ]),reply_markup:keyboard([
      ["قوانین§cln:rules"],["مرکز پاکسازی§cln:center"]
    ])});
    return true;
  }
  await setRuleSession(pool,groupId,actorId,f);
  currentCallbackMessageId=cb.message.message_id;
  return ruleBuilder(pool,groupId,actorId);
}

export async function handleCleanupCallback(pool:Pool,cb:any){
  const data=String(cb.data??"");
  if(!data.startsWith("cln:")) return false;
  const groupId=Number(cb.message?.chat?.id);
  const actorId=Number(cb.from?.id);
  if(!Number.isSafeInteger(groupId)) return true;
  await ensureCleanupSchema(pool);
  currentCallbackMessageId=Number(cb.message?.message_id||0);

  try{
    const parts=data.split(":");
    const action=parts[1];

    if(action==="scan"){
      const kind=parts[2];
      const filters:any={type:kind==="all"?"all":kind};
      if(kind==="hours"||kind==="limit"){filters.type="all";filters[kind]=Number(parts[3]);}
      const p=await createPreview(pool,groupId,actorId,filters);
      const j=p.job;
      await telegramApi("editMessageText",{chat_id:groupId,message_id:cb.message.message_id,text:panelText("پیش‌نمایش عملیات",[
        "⛂ - Job : "+j.job_key,"⛂ - بررسی‌شده : "+p.rawCount,"⛂ - قابل حذف : "+p.eligible,
        "⛂ - مستثنی‌شده : "+p.skipped,"","⛂ - وضعیت : آماده تأیید"
      ]),reply_markup:keyboard([
        ["تأیید حذف§cln:run:"+j.id],["لغو§cln:cancel:"+j.id],["تاریخچه§cln:history"]
      ])});
      return true;
    }

    if(action==="spam"){
      const threshold=Number(parts[2])||60;
      const p=await createPreview(pool,groupId,actorId,{spamThreshold:threshold,hours:48,limit:500});
      await telegramApi("editMessageText",{chat_id:groupId,message_id:cb.message.message_id,text:panelText("تشخیص اسپم",[
        "⛂ - آستانه : "+threshold,
        "⛂ - بازه : ۴۸ ساعت",
        "⛂ - حداکثر بررسی : ۵۰۰ پیام",
        "⛂ - بررسی‌شده : "+p.rawCount,
        "⛂ - قابل حذف : "+p.eligible,
        "⛂ - وضعیت : آماده تأیید"
      ]),reply_markup:keyboard([
        ["تأیید حذف§cln:run:"+p.job.id],
        ["آستانه ۶۰§cln:spam:60","آستانه ۸۰§cln:spam:80"],
        ["Rule Builder§cln:custom"],["بازگشت§cln:center"]
      ])});
      return true;
    }

    if(action==="custom"){
      const existing=await getRuleSession(pool,groupId,actorId);
      await setRuleSession(pool,groupId,actorId,existing);
      currentCallbackMessageId=cb.message.message_id;
      return ruleBuilder(pool,groupId,actorId);
    }

    if(action==="builder") return handleBuilderCallback(pool,cb,parts,groupId,actorId);

    if(action==="rules"){
      const r=await pool.query(
        "SELECT id,name,enabled,filters FROM cleanup_rules WHERE group_id=$1 ORDER BY id DESC LIMIT 12",[groupId]
      );
      const lines=r.rows.length?r.rows.map((x:any)=>"⛂ - "+x.id+" · "+x.name+" · "+(x.enabled?"فعال":"خاموش")):["⛂ - هنوز Ruleای ذخیره نشده است."];
      const rows:string[][]=r.rows.map((x:any)=>[x.name+" · اجرا§cln:rule_run:"+x.id]);
      rows.push(["Rule جدید§cln:custom"],["بازگشت§cln:center"]);
      await telegramApi("editMessageText",{chat_id:groupId,message_id:cb.message.message_id,text:panelText("قوانین",lines),reply_markup:keyboard(rows)});
      return true;
    }

    if(action==="rule_run"){
      const id=Number(parts[2]);
      const r=(await pool.query("SELECT * FROM cleanup_rules WHERE id=$1 AND group_id=$2 AND enabled=TRUE",[id,groupId])).rows[0];
      if(!r)throw new Error("RULE_NOT_FOUND");
      const p=await createPreview(pool,groupId,actorId,r.filters||{});
      await telegramApi("editMessageText",{chat_id:groupId,message_id:cb.message.message_id,text:panelText("پیش‌نمایش Rule",[
        "⛂ - Rule : "+r.name,"⛂ - بررسی‌شده : "+p.rawCount,"⛂ - قابل حذف : "+p.eligible,
        "⛂ - مستثنی‌شده : "+p.skipped,"⛂ - وضعیت : آماده تأیید"
      ]),reply_markup:keyboard([
        ["تأیید حذف§cln:run:"+p.job.id],["لغو§cln:cancel:"+p.job.id],["قوانین§cln:rules"]
      ])});
      return true;
    }

    if(action==="run"){
      const id=Number(parts[2]);
      const j=(await pool.query("SELECT * FROM cleanup_jobs WHERE id=$1 AND group_id=$2",[id,groupId])).rows[0];
      if(!j)throw new Error("JOB_NOT_FOUND");
      if(Number(j.actor_id)!==actorId)throw new Error("NOT_OWNER");
      if(!["preview"].includes(String(j.status)))throw new Error("JOB_ALREADY_USED");
      await pool.query("UPDATE cleanup_jobs SET status='queued' WHERE id=$1",[id]);
      queueJob(pool,id,groupId);
      await telegramApi("editMessageText",{chat_id:groupId,message_id:cb.message.message_id,text:panelText("Job در صف قرار گرفت",[
        "⛂ - Job : "+j.job_key,"⛂ - وضعیت : queued","⛂ - اجرا : ✓ آغاز شد"
      ]),reply_markup:keyboard([
        ["Jobها§cln:jobs"],["مرکز پاکسازی§cln:center"]
      ])});
      return true;
    }

    if(action==="pause"||action==="resume"||action==="cancel_job"||action==="retry"){
      const id=Number(parts[2]);
      const j=(await pool.query("SELECT * FROM cleanup_jobs WHERE id=$1 AND group_id=$2",[id,groupId])).rows[0];
      if(!j)throw new Error("JOB_NOT_FOUND");
      if(Number(j.actor_id)!==actorId)throw new Error("NOT_OWNER");

      if(action==="pause"){
        if(!["running","queued"].includes(String(j.status)))throw new Error("JOB_NOT_PAUSABLE");
        await pool.query("UPDATE cleanup_jobs SET status='paused' WHERE id=$1",[id]);
      }else if(action==="resume"){
        if(!["paused","queued"].includes(String(j.status)))throw new Error("JOB_NOT_RESUMABLE");
        if(running.has(groupId))throw new Error("CLEANUP_BUSY");
        await pool.query("UPDATE cleanup_jobs SET status='queued' WHERE id=$1",[id]);
        queueJob(pool,id,groupId);
      }else if(action==="cancel_job"){
        if(["completed","completed_with_errors","cancelled","failed"].includes(String(j.status)))throw new Error("JOB_ALREADY_FINISHED");
        await pool.query("UPDATE cleanup_jobs SET status='cancelled',finished_at=NOW() WHERE id=$1",[id]);
      }else{
        if(!["completed_with_errors","failed"].includes(String(j.status)))throw new Error("JOB_NOT_RETRYABLE");
        await pool.query("UPDATE cleanup_job_items SET status='pending',error_code=NULL,error_text=NULL WHERE job_id=$1 AND status='failed'",[id]);
        await pool.query("UPDATE cleanup_jobs SET status='queued',failure_count=0,last_error=NULL,finished_at=NULL WHERE id=$1",[id]);
        queueJob(pool,id,groupId);
      }

      const state=(await pool.query(
        "SELECT job_key,status,eligible_count,success_count,failure_count FROM cleanup_jobs WHERE id=$1",[id]
      )).rows[0];
      await telegramApi("editMessageText",{chat_id:groupId,message_id:cb.message.message_id,text:panelText("مدیریت Job",[
        "⛂ - Job : "+state.job_key,
        "⛂ - وضعیت : "+state.status,
        "⛂ - پیشرفت : "+state.success_count+"/"+state.eligible_count,
        "⛂ - ناموفق : "+state.failure_count,
        "⛂ - باقی‌مانده : "+Math.max(0,Number(state.eligible_count)-Number(state.success_count)-Number(state.failure_count))
      ]),reply_markup:keyboard([
        ["توقف موقت§cln:pause:"+id,"ادامه§cln:resume:"+id],
        ["لغو Job§cln:cancel_job:"+id,"تلاش مجدد§cln:retry:"+id],
        ["بازگشت§cln:jobs"]
      ])});
      return true;
    }

    if(action==="job"){
      const id=Number(parts[2]);
      const j=(await pool.query("SELECT * FROM cleanup_jobs WHERE id=$1 AND group_id=$2",[id,groupId])).rows[0];
      if(!j)throw new Error("JOB_NOT_FOUND");
      const buttons:string[][]=[];
      if(["running","queued"].includes(String(j.status)))buttons.push(["توقف موقت§cln:pause:"+id]);
      if(["paused","queued"].includes(String(j.status)))buttons.push(["ادامه§cln:resume:"+id]);
      if(!["completed","completed_with_errors","cancelled","failed"].includes(String(j.status)))buttons.push(["لغو Job§cln:cancel_job:"+id]);
      if(["completed_with_errors","failed"].includes(String(j.status)))buttons.push(["تلاش مجدد§cln:retry:"+id]);
      buttons.push(["بازگشت§cln:jobs"]);
      await telegramApi("editMessageText",{chat_id:groupId,message_id:cb.message.message_id,text:panelText("مدیریت Job",[
        "⛂ - Job : "+j.job_key,"⛂ - وضعیت : "+j.status,
        "⛂ - پیشرفت : "+j.success_count+"/"+j.eligible_count,
        "⛂ - ناموفق : "+j.failure_count,
        "⛂ - باقی‌مانده : "+Math.max(0,Number(j.eligible_count)-Number(j.success_count)-Number(j.failure_count))
      ]),reply_markup:keyboard(buttons)});
      return true;
    }

    if(action==="cancel"){
      const id=Number(parts[2]);
      await pool.query("UPDATE cleanup_jobs SET status='cancelled',finished_at=NOW() WHERE id=$1 AND group_id=$2 AND actor_id=$3 AND status='preview'",[id,groupId,actorId]);
      await telegramApi("editMessageText",{chat_id:groupId,message_id:cb.message.message_id,text:panelText("عملیات لغو شد",[
        "⛂ - Job : CLN-"+id,"⛂ - وضعیت : ✗ لغو شده"
      ]),reply_markup:keyboard([["مرکز پاکسازی§cln:center"]])});
      return true;
    }

    if(action==="center"){
      await openCleanupCenter(pool,groupId,actorId);return true;
    }

    if(action==="history"){
      const r=await pool.query(
        "SELECT job_key,status,total_count,eligible_count,success_count,failure_count,created_at FROM cleanup_jobs WHERE group_id=$1 ORDER BY id DESC LIMIT 10",[groupId]
      );
      const lines=r.rows.length?r.rows.map((x:any)=>"⛂ - "+x.job_key+" | "+x.status+" | "+x.success_count+"/"+x.total_count):["⛂ - هنوز عملیاتی ثبت نشده است."];
      await telegramApi("editMessageText",{chat_id:groupId,message_id:cb.message.message_id,text:panelText("تاریخچه",lines),reply_markup:keyboard([["بازگشت§cln:center"]])});
      return true;
    }

    if(action==="jobs"){
      const r=await pool.query(
        "SELECT id,job_key,status,eligible_count,success_count,failure_count FROM cleanup_jobs WHERE group_id=$1 ORDER BY id DESC LIMIT 8",[groupId]
      );
      const lines=r.rows.length?r.rows.map((x:any)=>"⛂ - "+x.job_key+" | "+x.status+" | "+x.success_count+"/"+x.eligible_count):["⛂ - Job فعالی وجود ندارد."];
      const rows:string[][]=r.rows.map((x:any)=>[x.job_key+" · مدیریت§cln:job:"+x.id]);
      rows.push(["بازگشت§cln:center"]);
      await telegramApi("editMessageText",{chat_id:groupId,message_id:cb.message.message_id,text:panelText("Jobهای پاکسازی",lines),reply_markup:keyboard(rows)});
      return true;
    }

    if(action==="protected"){
      const r=await pool.query(
        "SELECT message_id,reason FROM cleanup_protected_messages WHERE group_id=$1 ORDER BY created_at DESC LIMIT 30",[groupId]
      );
      const lines=r.rows.length?r.rows.map((x:any)=>"⛂ - پیام "+x.message_id+" | "+(x.reason??"—")):["⛂ - پیام محافظت‌شده‌ای ثبت نشده است."];
      await telegramApi("editMessageText",{chat_id:groupId,message_id:cb.message.message_id,text:panelText("استثناها و پیام‌های محافظت‌شده",lines),reply_markup:keyboard([["بازگشت§cln:center"]])});
      return true;
    }

    if(action==="user"){
      await telegramApi("editMessageText",{chat_id:groupId,message_id:cb.message.message_id,text:panelText("پاکسازی کاربر",[
        "⛂ - پیام کاربر را Reply کنید و «پاکسازی کاربر» را بفرستید.",
        "⛂ - فقط پیام‌های ثبت‌شده در Cleanup Index بررسی می‌شوند.",
        "⛂ - مدیران و پیام‌های محافظت‌شده حذف نمی‌شوند."
      ]),reply_markup:keyboard([["بازگشت§cln:center"]])});
      return true;
    }

    if(action==="preview"){
      const r=await pool.query(
        "SELECT job_key,status,filters,total_count,eligible_count,success_count,failure_count FROM cleanup_jobs WHERE group_id=$1 ORDER BY id DESC LIMIT 1",[groupId]
      );
      const x=r.rows[0];
      const lines=x?[
        "⛂ - Job : "+x.job_key,"⛂ - وضعیت : "+x.status,
        "⛂ - بررسی‌شده : "+x.total_count,"⛂ - قابل حذف : "+x.eligible_count,
        "⛂ - موفق : "+x.success_count,"⛂ - ناموفق : "+x.failure_count,
        "⛂ - فیلترها : "+JSON.stringify(x.filters)
      ]:["⛂ - هنوز Previewای ثبت نشده است."];
      await telegramApi("editMessageText",{chat_id:groupId,message_id:cb.message.message_id,text:panelText("آخرین پیش‌نمایش",lines),reply_markup:keyboard([["بازگشت§cln:center"]])});
      return true;
    }

    if(action==="rule_toggle"||action==="rule_delete"){
      const id=Number(parts[2]);
      const r=(await pool.query("SELECT * FROM cleanup_rules WHERE id=$1 AND group_id=$2",[id,groupId])).rows[0];
      if(!r)throw new Error("RULE_NOT_FOUND");
      if(action==="rule_toggle"){
        await pool.query("UPDATE cleanup_rules SET enabled=NOT enabled,updated_at=NOW() WHERE id=$1",[id]);
      }else{
        await pool.query("DELETE FROM cleanup_rules WHERE id=$1",[id]);
      }
      const rows=await pool.query("SELECT id,name,enabled FROM cleanup_rules WHERE group_id=$1 ORDER BY id DESC LIMIT 12",[groupId]);
      const lines=rows.rows.length?rows.rows.map((x:any)=>"⛂ - "+x.id+" · "+x.name+" · "+(x.enabled?"فعال":"خاموش")):["⛂ - هنوز Ruleای ذخیره نشده است."];
      const keys:string[][]=rows.rows.map((x:any)=>[x.name+" · اجرا§cln:rule_run:"+x.id,x.enabled?"خاموش§cln:rule_toggle:"+x.id:"فعال§cln:rule_toggle:"+x.id,x.name+" · حذف§cln:rule_delete:"+x.id]);
      keys.push(["Rule جدید§cln:custom"],["بازگشت§cln:center"]);
      await telegramApi("editMessageText",{chat_id:groupId,message_id:cb.message.message_id,text:panelText("قوانین",lines),reply_markup:keyboard(keys)});
      return true;
    }

    if(action==="close"){
      await telegramApi("deleteMessage",{chat_id:groupId,message_id:cb.message.message_id}).catch(()=>{});
      return true;
    }

    if(action==="settings"){
      const r=await pool.query("SELECT COUNT(*)::int n FROM cleanup_rules WHERE group_id=$1 AND enabled=TRUE",[groupId]);
      await telegramApi("editMessageText",{chat_id:groupId,message_id:cb.message.message_id,text:panelText("تنظیمات Cleanup",[
        "⛂ - Preview قبل از حذف : ✓ اجباری",
        "⛂ - مدیران : ✓ محافظت",
        "⛂ - پیام پین‌شده : ✓ محافظت",
        "⛂ - پیام محافظت‌شده : ✓ محافظت",
        "⛂ - Spam Detection : ✓ فعال",
        "⛂ - Rule فعال : "+r.rows[0].n,
        "⛂ - حذف خودکار اسپم : ✗ پیش‌فرض خاموش"
      ]),reply_markup:keyboard([["Rule Builder§cln:custom"],["بازگشت§cln:center"]])});
      return true;
    }
  }catch(e){
    const msg=String((e as any)?.message??e);
    await telegramApi("editMessageText",{chat_id:groupId,message_id:cb.message.message_id,text:panelText("خطای پاکسازی",[
      "⛂ - وضعیت : ✗ عملیات انجام نشد","⛂ - خطا : "+msg
    ]),reply_markup:keyboard([["بازگشت§cln:center"]])}).catch(()=>{});
  }
  return true;
}
