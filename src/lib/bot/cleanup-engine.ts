import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { telegramApi } from "../telegram/api.ts";
import type { BotContext } from "./engine.ts";

type TgUser = { id:number; first_name?:string; username?:string; is_bot?:boolean };
type TgMessage = {
  message_id:number;
  chat:{id:number;type:string};
  from?:TgUser;
  text?:string;
  caption?:string;
  photo?:unknown[];
  video?:unknown;
  audio?:unknown;
  document?:unknown;
  animation?:unknown;
  sticker?:unknown;
  voice?:unknown;
  video_note?:unknown;
  reply_to_message?:{from?:TgUser};
};

type CleanupMode = "count"|"media"|"links"|"bots"|"user"|"commands"|"time";

const MAX_MANUAL_DELETE = 100;
const CONFIRM_TTL_SECONDS = 60;

function normalize(value:string){
  return value.trim().replace(/^[\\/!.]+/,"").replace(/[\\u200c\\u200d]/g," ").replace(/\\s+/g," ").toLowerCase();
}

function hasMedia(msg:TgMessage){
  return Boolean(
    msg.photo?.length ||
    msg.video ||
    msg.audio ||
    msg.document ||
    msg.animation ||
    msg.sticker ||
    msg.voice ||
    msg.video_note
  );
}

function hasLink(msg:TgMessage){
  const text=(msg.text||msg.caption||"");
  return /(?:https?:\\/\\/|www\\.|t\\.me\\/|telegram\\.me\\/|(?:^|\\s)@[a-z0-9_]{4,})/i.test(text);
}

function isCommandMessage(msg:TgMessage){
  const text=String(msg.text||msg.caption||"").trim();
  return /^[\\/!]/.test(text);
}

function parseDuration(raw:string){
  const value=normalize(raw).replace(/\\s+/g,"");
  const match=value.match(/^(\\d+)(s|sec|ثانیه|m|min|دقیقه|h|hr|ساعت|d|day|روز|w|week|هفته)$/);
  if(!match)return null;
  const amount=Number(match[1]);
  if(!Number.isSafeInteger(amount)||amount<=0)return null;
  const unit=match[2];
  const factor=["s","sec","ثانیه"].includes(unit)?1
    :["m","min","دقیقه"].includes(unit)?60
    :["h","hr","ساعت"].includes(unit)?3600
    :["d","day","روز"].includes(unit)?86400
    :604800;
  return amount*factor;
}

async function actorCanDelete(pool:Pool,chatId:number,actorId:number,ownerIds:string[]){
  const isBotOwner=ownerIds.includes(String(actorId));
  const actor=await telegramApi<any>("getChatMember",{chat_id:chatId,user_id:actorId});
  if(!actor.ok){
    return {ok:false,authorized:false,owner:isBotOwner,canDelete:false,reason:actor.description||"actor_lookup_failed"};
  }
  const status=String(actor.result?.status||"");
  const isGroupAdmin=status==="creator"||status==="administrator";
  const canDelete=isGroupAdmin && (status==="creator" || actor.result?.can_delete_messages===true);
  const authorized=isBotOwner||isGroupAdmin;
  return {
    ok:true,
    authorized,
    owner:isBotOwner,
    isGroupAdmin,
    canDelete,
    reason:!authorized?"not_admin":authorized&&!canDelete?"delete_permission_missing":"allowed",
  };
}

async function botCanDelete(chatId:number){
  const me=await telegramApi<any>("getMe",{});
  if(!me.ok||!me.result?.id)return {ok:false,canDelete:false,reason:"bot_identity_failed"};
  const member=await telegramApi<any>("getChatMember",{chat_id:chatId,user_id:me.result.id});
  if(!member.ok)return {ok:false,canDelete:false,reason:member.description||"bot_membership_failed"};
  const status=String(member.result?.status||"");
  const canDelete=(status==="creator" || status==="administrator") && member.result?.can_delete_messages===true;
  return {ok:true,canDelete,reason:canDelete?"allowed":"bot_delete_permission_missing"};
}

export async function ensureCleanupSchema(pool:Pool){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cleanup_messages (
      id BIGSERIAL PRIMARY KEY,
      group_id BIGINT NOT NULL,
      message_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      is_bot BOOLEAN NOT NULL DEFAULT FALSE,
      is_media BOOLEAN NOT NULL DEFAULT FALSE,
      has_link BOOLEAN NOT NULL DEFAULT FALSE,
      is_command BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'active',
      last_error TEXT,
      UNIQUE(group_id,message_id)
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS idx_cleanup_messages_group_created ON cleanup_messages(group_id,created_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_cleanup_messages_group_user ON cleanup_messages(group_id,user_id,created_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_cleanup_messages_group_filters ON cleanup_messages(group_id,is_media,has_link,is_bot,is_command,created_at DESC)");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cleanup_actions (
      id BIGSERIAL PRIMARY KEY,
      group_id BIGINT NOT NULL,
      actor_id BIGINT NOT NULL,
      action_type TEXT NOT NULL,
      requested_count INTEGER NOT NULL DEFAULT 0,
      deleted_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'success',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS idx_cleanup_actions_group_created ON cleanup_actions(group_id,created_at DESC)");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cleanup_confirmations (
      token TEXT PRIMARY KEY,
      group_id BIGINT NOT NULL,
      actor_id BIGINT NOT NULL,
      panel_message_id BIGINT NOT NULL,
      action_type TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS idx_cleanup_confirmations_actor ON cleanup_confirmations(group_id,actor_id,expires_at)");
}

export async function recordCleanupMessage(pool:Pool,msg:TgMessage){
  if(msg.chat.type==="private" || !msg.from)return;
  await pool.query(
    `INSERT INTO cleanup_messages(group_id,message_id,user_id,is_bot,is_media,has_link,is_command)
     VALUES($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT(group_id,message_id) DO NOTHING`,
    [
      msg.chat.id,
      msg.message_id,
      msg.from.id,
      msg.from.is_bot===true,
      hasMedia(msg),
      hasLink(msg),
      isCommandMessage(msg),
    ],
  ).catch(error=>console.error("[cleanup] message tracking failed:",error));
}

function commandMatch(token:string){
  return ["پاکسازی","پاک سازی","پاک","cleanup","clean"].includes(token);
}

async function deleteRows(pool:Pool,rows:any[],groupId:number,actorId:number,actionType:string){
  let deleted=0;
  let failed=0;
  for(const row of rows){
    const result=await telegramApi("deleteMessage",{chat_id:groupId,message_id:Number(row.message_id)});
    if(result.ok){
      deleted++;
      await pool.query(
        "UPDATE cleanup_messages SET status='deleted',deleted_at=NOW(),last_error=NULL WHERE group_id=$1 AND message_id=$2",
        [groupId,Number(row.message_id)],
      ).catch(()=>{});
    }else{
      failed++;
      await pool.query(
        "UPDATE cleanup_messages SET status='failed',last_error=$3 WHERE group_id=$1 AND message_id=$2",
        [groupId,Number(row.message_id),String(result.description||"Telegram delete failed")],
      ).catch(()=>{});
    }
  }
  await pool.query(
    "INSERT INTO cleanup_actions(group_id,actor_id,action_type,requested_count,deleted_count,failed_count,status) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [groupId,actorId,actionType,rows.length,deleted,failed,failed>0&&deleted===0?"failed":"success"],
  ).catch(()=>{});
  return {requested:rows.length,deleted,failed};
}

function resultText(mode:string,result:{requested:number;deleted:number;failed:number},extra=""){
  return [
    "✓ پاکسازی اجرا شد.",
    "⛂ - نوع : "+mode,
    "⛂ - بررسی‌شده : "+result.requested,
    "⛂ - حذف‌شده : "+result.deleted,
    "⛂ - ناموفق : "+result.failed,
    extra,
  ].filter(Boolean).join("\\n");
}

export async function handleCleanupText(
  pool:Pool,
  ctx:BotContext,
  msg:TgMessage,
  ownerIds:string[],
):Promise<string|null>{
  if(ctx.chatType==="private")return null;
  const raw=String(msg.text||msg.caption||"").trim();
  if(!raw)return null;
  const normalized=normalize(raw);
  const parts=normalized.split(/\\s+/);
  if(!commandMatch(parts[0]))return null;

  if(parts[1]==="کامل" || parts[1]==="full"){
    return ctx.lang==="fa"
      ? "✗ پاکسازی کامل فقط از پنل مدیر قابل اجراست."
      : "✗ Full cleanup is available only from the management panel.";
  }

  const auth=await actorCanDelete(pool,ctx.chatId,ctx.userId,ownerIds);
  if(!auth.authorized){
    return ctx.lang==="fa"
      ? "✗ فقط مدیر گروه یا مالک ربات می‌تواند از پاکسازی استفاده کند."
      : "✗ Only a group admin or bot owner can use cleanup.";
  }
  if(!auth.canDelete){
    return ctx.lang==="fa"
      ? "✗ شما مجاز هستید، اما ربات یا سطح دسترسی فعلی اجازه حذف پیام را نمی‌دهد."
      : "✗ You are authorized, but the current Telegram delete permission is missing.";
  }

  await ensureCleanupSchema(pool);

  let mode:CleanupMode="count";
  let limit=20;
  let userId:number|undefined;
  let before:Date|undefined;

  if(parts.length===1){
    limit=20;
  }else if(/^\\d+$/.test(parts[1]||"")){
    limit=Math.min(MAX_MANUAL_DELETE,Math.max(1,Number(parts[1])));
  }else if(["رسانه","media"].includes(parts[1]||"")){
    mode="media";
  }else if(["لینک","لینک‌ها","لینکها","links","link"].includes(parts[1]||"")){
    mode="links";
  }else if(["ربات","bots","bot"].includes(parts[1]||"")){
    mode="bots";
  }else if(["دستورات","دستور","commands","command"].includes(parts[1]||"")){
    mode="commands";
  }else if(["کاربر","user"].includes(parts[1]||"")){
    mode="user";
    userId=msg.reply_to_message?.from?.id;
    if(!userId && /^\\d+$/.test(parts[2]||""))userId=Number(parts[2]);
    if(!userId){
      return ctx.lang==="fa"
        ? "✗ برای «پاکسازی کاربر» روی پیام آن کاربر ریپلای کنید یا آیدی عددی او را وارد کنید."
        : "✗ Reply to a user's message or provide the numeric ID.";
    }
  }else{
    const duration=parseDuration(parts[1]||"");
    if(duration){
      mode="time";
      before=new Date(Date.now()-duration*1000);
    }else{
      return ctx.lang==="fa"
        ? "✗ نوع پاکسازی نامعتبر است. نمونه: «پاکسازی 20»، «پاکسازی رسانه»، «پاکسازی لینک»، «پاکسازی 24h»."
        : "✗ Invalid cleanup type.";
    }
  }

  if(parts[2]){
    const duration=parseDuration(parts[2]);
    if(duration){
      mode=mode==="count"?"time":mode;
      before=new Date(Date.now()-duration*1000);
    }
  }

  const conditions:string[]=["group_id=$1","status='active'","message_id<>$2"];
  const values:any[]=[ctx.chatId,msg.message_id];
  let p=3;

  if(mode==="count"){
    const rows=(await pool.query(
      "SELECT message_id FROM cleanup_messages WHERE "+conditions.join(" AND ")+" ORDER BY created_at DESC LIMIT "+Math.max(1,limit),
      values,
    )).rows;
    const result=await deleteRows(pool,rows,ctx.chatId,ctx.userId,"manual_count");
    return resultText("پیام‌های اخیر",result);
  }

  if(mode==="media")conditions.push("is_media=TRUE");
  if(mode==="links")conditions.push("has_link=TRUE");
  if(mode==="bots")conditions.push("is_bot=TRUE");
  if(mode==="commands")conditions.push("is_command=TRUE");
  if(mode==="user"){conditions.push("user_id=$"+p);values.push(userId);p++;}
  if(before){conditions.push("created_at >= $"+p);values.push(before);p++;}

  const rows=(await pool.query(
    "SELECT message_id FROM cleanup_messages WHERE "+conditions.join(" AND ")+" ORDER BY created_at DESC LIMIT "+MAX_MANUAL_DELETE,
    values,
  )).rows;
  const result=await deleteRows(pool,rows,ctx.chatId,ctx.userId,mode);
  const labels:Record<CleanupMode,string>={count:"پیام‌های اخیر",media:"رسانه",links:"لینک‌ها",bots:"ربات‌ها",user:"کاربر",commands:"دستورات",time:"بازه زمانی"};
  return resultText(labels[mode],result);
}

export async function cleanupStats(pool:Pool,groupId:number){
  await ensureCleanupSchema(pool);
  const [active,total,failed]=await Promise.all([
    pool.query("SELECT COUNT(*)::int AS n FROM cleanup_messages WHERE group_id=$1 AND status='active'",[groupId]),
    pool.query("SELECT COUNT(*)::int AS n FROM cleanup_messages WHERE group_id=$1",[groupId]),
    pool.query("SELECT COUNT(*)::int AS n FROM cleanup_actions WHERE group_id=$1 AND status='failed'",[groupId]),
  ]);
  return {
    active:Number(active.rows[0]?.n||0),
    total:Number(total.rows[0]?.n||0),
    failed:Number(failed.rows[0]?.n||0),
  };
}

export async function prepareFullCleanup(
  pool:Pool,
  groupId:number,
  actorId:number,
  panelMessageId:number,
  ownerIds:string[],
){
  await ensureCleanupSchema(pool);
  const auth=await actorCanDelete(pool,groupId,actorId,ownerIds);
  if(!auth.authorized)return {ok:false,error:"فقط مدیر گروه یا مالک ربات مجاز است."};
  if(!auth.canDelete)return {ok:false,error:"دسترسی حذف پیام در تلگرام برای اجراکننده فعال نیست."};
  const bot=await botCanDelete(groupId);
  if(!bot.canDelete)return {ok:false,error:"ربات دسترسی حذف پیام در این گروه را ندارد."};

  const token=randomUUID();
  await pool.query(
    "DELETE FROM cleanup_confirmations WHERE group_id=$1 AND actor_id=$2 AND (used_at IS NOT NULL OR expires_at<=NOW())",
    [groupId,actorId],
  ).catch(()=>{});
  await pool.query(
    "INSERT INTO cleanup_confirmations(token,group_id,actor_id,panel_message_id,action_type,expires_at) VALUES($1,$2,$3,$4,'full',NOW()+($5 || ' seconds')::interval)",
    [token,groupId,actorId,panelMessageId,CONFIRM_TTL_SECONDS],
  );
  return {ok:true,token,active:(await cleanupStats(pool,groupId)).active};
}

export async function executeFullCleanup(
  pool:Pool,
  groupId:number,
  actorId:number,
  panelMessageId:number,
  token:string,
  ownerIds:string[],
){
  await ensureCleanupSchema(pool);
  const auth=await actorCanDelete(pool,groupId,actorId,ownerIds);
  if(!auth.authorized)return {ok:false,error:"دسترسی اجراکننده منقضی یا لغو شده است."};
  if(!auth.canDelete)return {ok:false,error:"دسترسی حذف پیام اجراکننده دیگر فعال نیست."};
  const bot=await botCanDelete(groupId);
  if(!bot.canDelete)return {ok:false,error:"دسترسی حذف پیام ربات دیگر فعال نیست."};

  const confirmation=await pool.query(
    "SELECT token FROM cleanup_confirmations WHERE token=$1 AND group_id=$2 AND actor_id=$3 AND panel_message_id=$4 AND action_type='full' AND used_at IS NULL AND expires_at>NOW() LIMIT 1",
    [token,groupId,actorId,panelMessageId],
  );
  if(!confirmation.rowCount)return {ok:false,error:"تأیید منقضی شده است. دوباره عملیات را از پنل آغاز کنید."};

  const lock=await pool.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked",["cleanup:"+groupId]);
  if(lock.rows[0]?.locked!==true)return {ok:false,error:"یک عملیات پاکسازی دیگر در حال اجراست."};

  try{
    await pool.query("UPDATE cleanup_confirmations SET used_at=NOW() WHERE token=$1",[token]);
    const rows=(
      await pool.query(
        "SELECT message_id FROM cleanup_messages WHERE group_id=$1 AND status='active' ORDER BY created_at DESC",
        [groupId],
      )
    ).rows;
    const result=await deleteRows(pool,rows,groupId,actorId,"full_panel");
    return {ok:true,...result};
  }finally{
    await pool.query("SELECT pg_advisory_unlock(hashtext($1))",["cleanup:"+groupId]).catch(()=>{});
  }
}
