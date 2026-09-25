import type { Pool } from "pg";
import { telegramApi } from "../src/lib/telegram/api.ts";

type TgUser = { id:number; first_name?:string; username?:string };
type TgChat = { id:number; type:string; title?:string; username?:string };
type TgMessage = { message_id:number; chat:TgChat; from?:TgUser; text?:string; caption?:string };
type TgCallback = { id:string; from:TgUser; message?:TgMessage; data?:string };
export type InstallationGateResult = "handled"|"allow"|"drop";

const VERSION=process.env.NIZAM_PANEL_VERSION||"v1.0.0";
const BUILTIN_OWNER_IDS=["8247710529"];
const PANEL_URL=String(process.env.PANEL_URL||"").replace(/\/$/,"");

function norm(v:unknown){return String(v??"").trim().replace(/\s+/g," ").toLowerCase();}
function plain(v:unknown){return norm(v).replace(/^[/!.]+/,"").trim();}
function authorized(uid:number,owners:string[],sudo:string[]){return new Set([...BUILTIN_OWNER_IDS,...owners,...sudo].filter(Boolean)).has(String(uid));}
function isInstallText(v:unknown){return ["install","نصب","نصب ربات","راه اندازی","راه‌اندازی","group install","group installation"].includes(plain(v));}
function isUninstallText(v:unknown){return ["uninstall","حذف نصب","حذف نصب ربات","uninstall bot"].includes(plain(v));}
function kb(rows:Array<Array<{text:string;callback_data?:string;url?:string}>>){return {inline_keyboard:rows};}
async function send(chatId:number,message:string,markup:any=null){return telegramApi("sendMessage",{chat_id:chatId,text:message,...(markup?{reply_markup:markup}:{})});}
async function edit(chatId:number,messageId:number,message:string,markup:any=null){return telegramApi("editMessageText",{chat_id:chatId,message_id:messageId,text:message,...(markup?{reply_markup:markup}:{})});}
async function answer(id:string,message=""){return telegramApi("answerCallbackQuery",{callback_query_id:id,...(message?{text:message}:{})});}

async function ensureSchema(pool:Pool){
  await pool.query("CREATE TABLE IF NOT EXISTS bot_group_installations (group_id BIGINT PRIMARY KEY,installed BOOLEAN NOT NULL DEFAULT FALSE,installed_at TIMESTAMPTZ,installed_by BIGINT,uninstalled_at TIMESTAMPTZ,uninstalled_by BIGINT,installation_version TEXT NOT NULL DEFAULT 'v1.0.0',bot_permission_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,response_policy TEXT NOT NULL DEFAULT 'standard',member_message_policy TEXT NOT NULL DEFAULT 'silent',command_policy TEXT NOT NULL DEFAULT 'enabled',command_mode TEXT NOT NULL DEFAULT 'plain',automation_enabled BOOLEAN NOT NULL DEFAULT FALSE,security_mode TEXT NOT NULL DEFAULT 'standard',audit_enabled BOOLEAN NOT NULL DEFAULT TRUE,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS bot_installation_events (id BIGSERIAL PRIMARY KEY,group_id BIGINT NOT NULL,actor_id BIGINT,event_type TEXT NOT NULL,metadata JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_bot_installation_events_group_time ON bot_installation_events(group_id,created_at DESC)");
}
async function ensureGroup(pool:Pool,chat:TgChat){
  await pool.query("INSERT INTO bot_groups(id,title,username,type,is_active,updated_at) VALUES($1,$2,$3,$4,TRUE,NOW()) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,username=EXCLUDED.username,type=EXCLUDED.type,is_active=TRUE,updated_at=NOW()",[String(chat.id),chat.title||"",chat.username||null,chat.type||"supergroup"]);
  await pool.query("INSERT INTO bot_group_installations(group_id) VALUES($1) ON CONFLICT(group_id) DO NOTHING",[String(chat.id)]);
}
async function state(pool:Pool,groupId:number){
  await pool.query("INSERT INTO bot_group_installations(group_id) VALUES($1) ON CONFLICT(group_id) DO NOTHING",[String(groupId)]);
  return (await pool.query("SELECT * FROM bot_group_installations WHERE group_id=$1 LIMIT 1",[String(groupId)])).rows[0];
}
async function permissionCheck(groupId:number){
  const me=await telegramApi<any>("getMe",{});
  if(!me.ok)return {ok:false,status:"unreachable",missing:["اتصال Telegram API"],snapshot:{}};
  const botId=Number(me.result?.id);
  const member=await telegramApi<any>("getChatMember",{chat_id:groupId,user_id:botId});
  if(!member.ok)return {ok:false,status:"unreachable",missing:["دسترسی ربات به گروه"],snapshot:{bot_id:botId}};
  const m=member.result||{};
  if(String(m.status||"")!=="administrator")return {ok:false,status:String(m.status||"unknown"),missing:["administrator"],snapshot:{bot_id:botId,status:m.status||"unknown"}};
  const required:[string,string][]=[["can_delete_messages","حذف پیام"],["can_restrict_members","محدودکردن اعضا"],["can_invite_users","دعوت اعضا"],["can_pin_messages","پین پیام"],["can_promote_members","تغییر نقش مدیران"]];
  const missing=required.filter(function(x){return m[x[0]]!==true}).map(function(x){return x[1]});
  return {ok:missing.length===0,status:missing.length?"partial":"complete",missing,snapshot:{bot_id:botId,status:String(m.status),can_manage_chat:m.can_manage_chat===undefined?null:m.can_manage_chat,can_delete_messages:m.can_delete_messages===undefined?null:m.can_delete_messages,can_restrict_members:m.can_restrict_members===undefined?null:m.can_restrict_members,can_invite_users:m.can_invite_users===undefined?null:m.can_invite_users,can_pin_messages:m.can_pin_messages===undefined?null:m.can_pin_messages,can_promote_members:m.can_promote_members===undefined?null:m.can_promote_members,can_manage_topics:m.can_manage_topics===undefined?null:m.can_manage_topics,checked_at:new Date().toISOString()}};
}
async function saveSnapshot(pool:Pool,groupId:number,snapshot:any){await pool.query("UPDATE bot_group_installations SET bot_permission_snapshot=$1::jsonb,updated_at=NOW() WHERE group_id=$2",[JSON.stringify(snapshot||{}),String(groupId)]);}
function startText(chat:TgChat,uid:number,owners:string[],sudo:string[]){
  const role=new Set([...BUILTIN_OWNER_IDS,...owners].filter(Boolean)).has(String(uid))?"Owner":new Set(sudo).has(String(uid))?"Sudo":"Authorized";
  return ["━━━━━━━━━━━━━━━━━━━━━━━━","◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ - Gʀᴏᴜᴘ Iɴsᴛᴀʟʟᴀᴛɪᴏɴ","━━━━━━━━━━━━━━━━━━━━━━━━","","★ - ربات آماده راه‌اندازی در این گروه است.","","⛂ - گروه : "+(chat.title||"نام گروه"),"⛂ - وضعیت : ● آماده نصب","⛂ - درخواست‌کننده : "+role,"⛂ - نسخه : "+VERSION,"","─────━━───── ◈ ─────━━─────","","برای فعال‌سازی مراحل راه‌اندازی رو تایید و تکمیل کنید.",""].join("\n");
}
function completeText(chat:TgChat,s:any){
  return ["━━━━━━━━━━━━━━━━━━━━━━━━","◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ - Iɴsᴛᴀʟʟᴀᴛɪᴏɴ Cᴏᴍᴘʟᴇᴛᴇ","━━━━━━━━━━━━━━━━━━━━━━━━","","● ربات با موفقیت نصب شد.","","⛂ - گروه : "+(chat.title||"نام گروه"),"⛂ - مالک : تأیید شده","⛂ - دسترسی‌ها : کامل","⛂ - Command : فعال","⛂ - Member Messages : "+(s.member_message_policy==="silent"?"Silent":String(s.member_message_policy||"Silent")),"⛂ - Private Chat : Disabled","","سیستم مدیریت گروه اکنون آماده است.",""].join("\n");
}
function startMarkup(){return kb([[{text:"[ ❯› شروع نصب ]",callback_data:"inst:start"}],[{text:"[ ❯› تنظیمات نصب ]",callback_data:"inst:settings"},{text:"[ ‹ انصراف ]",callback_data:"inst:cancel"}]]);}
function completeMarkup(){const management=PANEL_URL?{text:"[ ❯› مدیریت گروه ]",url:PANEL_URL+"#dashboard"}:{text:"[ ❯› مدیریت گروه ]",callback_data:"inst:manage"};return kb([[management],[{text:"[ ❯› تنظیمات ]",callback_data:"inst:settings"}],[{text:"[ ❯› دستورات ]",callback_data:"inst:commands"},{text:"[ ❯› وضعیت ]",callback_data:"inst:status"}]]);}
function checkText(chat:TgChat,check:any){
  if(check.ok)return ["━━━━━━━━━━━━━━━━━━━━━━━━","◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ - Iɴsᴛᴀʟʟ Cʜᴇᴄᴋ","━━━━━━━━━━━━━━━━━━━━━━━━","","● پیش‌نیازهای نصب با موفقیت تأیید شد.","","⛂ - گروه : "+(chat.title||"نام گروه"),"⛂ - مالک : ● تأیید شده","⛂ - دسترسی ربات : ● کامل","⛂ - مدیریت گروه : ● تأیید شده","⛂ - دسترسی پیام‌ها : ● آماده","⛂ - وضعیت سیستم : ● پایدار","","برای ادامه، نتیجه بررسی را تأیید کنید."].join("\n");
  return ["━━━━━━━━━━━━━━━━━━━━━━━━","◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ - Iɴsᴛᴀʟʟ Cʜᴇᴄᴋ","━━━━━━━━━━━━━━━━━━━━━━━━","","● نصب هنوز قابل انجام نیست.","","⛂ - گروه : "+(chat.title||"نام گروه"),"⛂ - وضعیت : ● دسترسی ناقص","⛂ - کمبود : "+(check.missing&&check.missing.length?check.missing.join("، "):"—"),"⛂ - راهنما : ربات را در گروه مدیر کنید و دسترسی‌های مدیریتی لازم را فعال کنید."].join("\n");
}
function checkMarkup(ok:boolean){return kb([ok?[{text:"[ ✓ تأیید نصب ]",callback_data:"inst:confirm"},{text:"[ ⟳ بررسی مجدد ]",callback_data:"inst:recheck"}]:[{text:"[ ⟳ بررسی مجدد ]",callback_data:"inst:recheck"}],[{text:"[ ‹ بازگشت ]",callback_data:"inst:back"}]]);}

async function updatePolicy(pool:Pool,groupId:number,key:string){
  const c=await pool.connect();
  try{
    await c.query("BEGIN");
    const r=await c.query("SELECT * FROM bot_group_installations WHERE group_id=$1 FOR UPDATE",[String(groupId)]);
    if(!r.rows[0])throw new Error("installation_state_missing");
    const s=r.rows[0];
    if(key==="member"){const order=["silent","commands_only","automation","custom"];let i=order.indexOf(String(s.member_message_policy));if(i<0)i=0;const next=order[(i+1)%order.length];await c.query("UPDATE bot_group_installations SET member_message_policy=$1,response_policy=$2,updated_at=NOW() WHERE group_id=$3",[next,next==="silent"?"standard":"custom",String(groupId)]);}
    else if(key==="commands")await c.query("UPDATE bot_group_installations SET command_policy=$1,updated_at=NOW() WHERE group_id=$2",[s.command_policy==="enabled"?"disabled":"enabled",String(groupId)]);
    else if(key==="auto"){const next=!Boolean(s.automation_enabled);await c.query("UPDATE bot_group_installations SET automation_enabled=$1,member_message_policy=CASE WHEN $1=TRUE AND member_message_policy='silent' THEN 'automation' ELSE member_message_policy END,updated_at=NOW() WHERE group_id=$2",[next,String(groupId)]);}
    else if(key==="security"){const order=["standard","strict","custom"];let i=order.indexOf(String(s.security_mode));if(i<0)i=0;await c.query("UPDATE bot_group_installations SET security_mode=$1,updated_at=NOW() WHERE group_id=$2",[order[(i+1)%order.length],String(groupId)]);}
    else if(key==="audit")await c.query("UPDATE bot_group_installations SET audit_enabled=NOT audit_enabled,updated_at=NOW() WHERE group_id=$1",[String(groupId)]);
    await c.query("COMMIT");
  }catch(e){await c.query("ROLLBACK").catch(function(){});throw e;}finally{c.release();}
}
async function install(pool:Pool,chat:TgChat,actor:number){
  const check=await permissionCheck(chat.id);await saveSnapshot(pool,chat.id,check.snapshot);if(!check.ok)return check;
  const c=await pool.connect();
  try{
    await c.query("BEGIN");
    const r=await c.query("SELECT installed FROM bot_group_installations WHERE group_id=$1 FOR UPDATE",[String(chat.id)]);
    if(r.rows[0]?.installed===true){await c.query("COMMIT");return {ok:true,status:"complete",missing:[],snapshot:check.snapshot};}
    await c.query("UPDATE bot_group_installations SET installed=TRUE,installed_at=NOW(),installed_by=$2,uninstalled_at=NULL,uninstalled_by=NULL,installation_version=$3,bot_permission_snapshot=$4::jsonb,response_policy='standard',member_message_policy='silent',command_policy='enabled',command_mode='plain',automation_enabled=FALSE,security_mode='standard',audit_enabled=TRUE,updated_at=NOW() WHERE group_id=$1",[String(chat.id),String(actor),VERSION,JSON.stringify(check.snapshot)]);
    await c.query("INSERT INTO bot_group_settings(group_id) VALUES($1) ON CONFLICT(group_id) DO NOTHING",[String(chat.id)]);
    await c.query("INSERT INTO warning_system_settings(group_id) VALUES($1) ON CONFLICT(group_id) DO NOTHING",[String(chat.id)]);
    await c.query("INSERT INTO content_lock_settings(group_id) VALUES($1) ON CONFLICT(group_id) DO NOTHING",[String(chat.id)]);
    await c.query("INSERT INTO bot_installation_events(group_id,actor_id,event_type,metadata) VALUES($1,$2,'installed',$3::jsonb)",[String(chat.id),String(actor),JSON.stringify({version:VERSION,snapshot:check.snapshot})]);
    await c.query("INSERT INTO audit_logs(actor_id,action,target,after_data,source) VALUES($1,'group_installed',$2,$3::jsonb,'telegram_installation')",[String(actor),String(chat.id),JSON.stringify({version:VERSION,member_message_policy:"silent",command_mode:"plain"})]);
    await c.query("COMMIT");return {ok:true,status:"complete",missing:[],snapshot:check.snapshot};
  }catch(e){await c.query("ROLLBACK").catch(function(){});throw e;}finally{c.release();}
}
async function uninstall(pool:Pool,chat:TgChat,actor:number){
  const c=await pool.connect();
  try{
    await c.query("BEGIN");
    const r=await c.query("SELECT installed FROM bot_group_installations WHERE group_id=$1 FOR UPDATE",[String(chat.id)]);
    if(!r.rows[0]?.installed){await c.query("COMMIT");return false;}
    await c.query("UPDATE bot_group_installations SET installed=FALSE,uninstalled_at=NOW(),uninstalled_by=$2,command_policy='disabled',automation_enabled=FALSE,updated_at=NOW() WHERE group_id=$1",[String(chat.id),String(actor)]);
    await c.query("INSERT INTO bot_installation_events(group_id,actor_id,event_type,metadata) VALUES($1,$2,'uninstalled',$3::jsonb)",[String(chat.id),String(actor),JSON.stringify({retained_data:true})]);
    await c.query("INSERT INTO audit_logs(actor_id,action,target,after_data,source) VALUES($1,'group_uninstalled',$2,$3::jsonb,'telegram_installation')",[String(actor),String(chat.id),JSON.stringify({retained_data:true})]);
    await c.query("COMMIT");return true;
  }catch(e){await c.query("ROLLBACK").catch(function(){});throw e;}finally{c.release();}
}
export async function ensureInstallationSchema(pool:Pool){await ensureSchema(pool);}
export async function installationGate(pool:Pool,msg:TgMessage,owners:string[],sudo:string[],allowActions=true):Promise<InstallationGateResult>{
  if(!msg.from || ["private","channel"].includes(msg.chat.type))return "drop";
  await ensureSchema(pool);await ensureGroup(pool,msg.chat);
  const s=await state(pool,msg.chat.id);const raw=msg.text||msg.caption||"";const op=authorized(msg.from.id,owners,sudo);
  if(allowActions&&op&&isInstallText(raw)){if(s.installed){await send(msg.chat.id,completeText(msg.chat,s),completeMarkup());return "handled";}await send(msg.chat.id,startText(msg.chat,msg.from.id,owners,sudo),startMarkup());return "handled";}
  if(allowActions&&op&&isUninstallText(raw)){if(!s.installed){await send(msg.chat.id,startText(msg.chat,msg.from.id,owners,sudo),startMarkup());return "handled";}await send(msg.chat.id,["━━━━━━━━━━━━━━━━━━━━━━━━","◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ - Uɴɪɴsᴛᴀʟʟ Cᴏɴғɪʀᴍ","━━━━━━━━━━━━━━━━━━━━━━━━","","★ - حذف نصب باعث توقف پردازش مدیریتی ربات در این گروه می‌شود.","","⛂ - گروه : "+(msg.chat.title||"نام گروه"),"⛂ - داده‌های ثبت‌شده : حفظ می‌شوند","⛂ - تاریخچه نصب : حفظ می‌شود","⛂ - Command : غیرفعال می‌شود","⛂ - Automation : غیرفعال می‌شود","","برای ادامه، حذف نصب را تأیید کنید."].join("\n"),kb([[{text:"[ ✓ تأیید حذف نصب ]",callback_data:"inst:uninstall:confirm"}],[{text:"[ × لغو ]",callback_data:"inst:complete"},{text:"[ ‹ بازگشت ]",callback_data:"inst:complete"}]]));return "handled";}
  return s.installed?"allow":"drop";
}
async function renderSettings(pool:Pool,cb:TgCallback){
  const g=Number(cb.message!.chat.id),s=await state(pool,g);const labels:any={silent:"Silent",commands_only:"Commands Only",automation:"Automation",custom:"Custom"};const security:any={standard:"Standard",strict:"Strict",custom:"Custom"};
  const body=["━━━━━━━━━━━━━━━━━━━━━━━━","◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ - Iɴsᴛᴀʟʟ Sᴇᴛᴛɪɴɢs","━━━━━━━━━━━━━━━━━━━━━━━━","","⛂ - پاسخ به اعضا : "+(labels[s.member_message_policy]||s.member_message_policy),"⛂ - پاسخ در پیوی : Disabled","⛂ - دستورات : "+(s.command_policy==="enabled"?"فعال":"خاموش"),"⛂ - حالت دستورات : بدون Slash","⛂ - ثبت رویدادها : "+(s.audit_enabled?"فعال":"خاموش"),"⛂ - سیستم امنیتی : "+(security[s.security_mode]||s.security_mode),"⛂ - اتوماسیون : "+(s.automation_enabled?"فعال":"خاموش"),"","─────━━───── ◈ ─────━━─────","","Private Chat همیشه غیرفعال است و از این بخش قابل فعال‌سازی نیست."].join("\n");
  return edit(g,cb.message!.message_id,body,kb([[{text:"[ ❯› پاسخ به اعضا : "+(labels[s.member_message_policy]||"Silent")+" ]",callback_data:"inst:set:member"}],[{text:"[ ❯› دستورات : "+(s.command_policy==="enabled"?"فعال":"خاموش")+" ]",callback_data:"inst:set:commands"}],[{text:"[ ❯› اتوماسیون : "+(s.automation_enabled?"فعال":"خاموش")+" ]",callback_data:"inst:set:auto"}],[{text:"[ ❯› امنیت : "+(security[s.security_mode]||"Standard")+" ]",callback_data:"inst:set:security"}],[{text:"[ ❯› ثبت رویدادها : "+(s.audit_enabled?"فعال":"خاموش")+" ]",callback_data:"inst:set:audit"}],[{text:"[ ✓ ذخیره تنظیمات ]",callback_data:"inst:settings:save"}],[{text:"[ ‹ بازگشت ]",callback_data:s.installed?"inst:complete":"inst:back"}]]));
}
export async function handleInstallationCallback(pool:Pool,cb:TgCallback,owners:string[],sudo:string[]):Promise<boolean>{
  const data=norm(cb.data);if(!data.startsWith("inst:"))return false;
  await answer(cb.id);if(!cb.message||["private","channel"].includes(cb.message.chat.type))return true;
  if(!authorized(cb.from.id,owners,sudo))return true;
  await ensureSchema(pool);await ensureGroup(pool,cb.message.chat);const chat=cb.message.chat;switch(data){
    case "inst:start":case "inst:recheck":{const check=await permissionCheck(chat.id);await saveSnapshot(pool,chat.id,check.snapshot);await edit(chat.id,cb.message.message_id,checkText(chat,check),checkMarkup(check.ok));return true;}
    case "inst:settings":await renderSettings(pool,cb);return true;
    case "inst:settings:save":await pool.query("INSERT INTO audit_logs(actor_id,action,target,after_data,source) VALUES($1,'installation_settings_saved',$2,$3::jsonb,'telegram_installation')",[String(cb.from.id),String(chat.id),JSON.stringify({saved:true})]);await edit(chat.id,cb.message.message_id,completeText(chat,await state(pool,chat.id)),completeMarkup());return true;
    case "inst:back":await edit(chat.id,cb.message.message_id,startText(chat,cb.from.id,owners,sudo),startMarkup());return true;
    case "inst:cancel":await edit(chat.id,cb.message.message_id,"● عملیات نصب لغو شد.",null);return true;
    case "inst:confirm":{const result=await install(pool,chat,cb.from.id);if(!result.ok){await edit(chat.id,cb.message.message_id,checkText(chat,result),checkMarkup(false));return true;}await edit(chat.id,cb.message.message_id,completeText(chat,await state(pool,chat.id)),completeMarkup());return true;}
    case "inst:complete":{const fresh=await state(pool,chat.id);await edit(chat.id,cb.message.message_id,fresh.installed?completeText(chat,fresh):startText(chat,cb.from.id,owners,sudo),fresh.installed?completeMarkup():startMarkup());return true;}
    case "inst:status":{const check=await permissionCheck(chat.id);await saveSnapshot(pool,chat.id,check.snapshot);const fresh=await state(pool,chat.id);await edit(chat.id,cb.message.message_id,["━━━━━━━━━━━━━━━━━━━━━━━━","◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ - Iɴsᴛᴀʟʟ Sᴛᴀᴛᴜs","━━━━━━━━━━━━━━━━━━━━━━━━","","⛂ - نصب : "+(fresh.installed?"● فعال":"● آماده نصب"),"⛂ - نسخه : "+(fresh.installation_version||VERSION),"⛂ - Command : "+(fresh.command_policy==="enabled"?"فعال":"خاموش"),"⛂ - Member Messages : "+(fresh.member_message_policy==="silent"?"Silent":fresh.member_message_policy),"⛂ - Private Chat : Disabled","⛂ - دسترسی ربات : "+(check.ok?"● کامل":"● ناقص"),"⛂ - بررسی : "+new Date().toLocaleString("fa-IR"),"⛂ - کمبود : "+(check.missing&&check.missing.length?check.missing.join("، "):"—")].join("\n"),kb([[{text:"[ ⟳ بررسی مجدد ]",callback_data:"inst:status"}],[{text:"[ ‹ بازگشت ]",callback_data:"inst:complete"}]]));return true;}
    case "inst:commands":{const fresh=await state(pool,chat.id);await edit(chat.id,cb.message.message_id,["━━━━━━━━━━━━━━━━━━━━━━━━","◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ - Cᴏᴍᴍᴀɴᴅ Pᴏʟɪᴄʏ","━━━━━━━━━━━━━━━━━━━━━━━━","","⛂ - Command : "+(fresh.command_policy==="enabled"?"● فعال":"● خاموش"),"⛂ - حالت : Plain Text","⛂ - Slash : Disabled","⛂ - دستورات ناشناخته : Silent","⛂ - پاسخ اعضا : قابل تنظیم از بخش سیاست پاسخ","","برای تغییر سیاست پردازش دستورات، وارد تنظیمات نصب شوید."].join("\n"),kb([[{text:"[ ❯› تنظیمات دستورات ]",callback_data:"inst:settings"}],[{text:"[ ‹ بازگشت ]",callback_data:"inst:complete"}]]));return true;}
    case "inst:manage":{const url=PANEL_URL||"https://persian-bot-studio-panel-production.up.railway.app/";await edit(chat.id,cb.message.message_id,["━━━━━━━━━━━━━━━━━━━━━━━━","◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ - Gʀᴏᴜᴘ Mᴀɴᴀɢᴇᴍᴇɴᴛ","━━━━━━━━━━━━━━━━━━━━━━━━","","★ - گروه با موفقیت به مرکز مدیریت متصل است.","","⛂ - وضعیت نصب : ● فعال","⛂ - Command : فعال","⛂ - Private Chat : Disabled","⛂ - کنترل کامل : Web Panel"].join("\n"),kb([[{text:"[ ❯› مدیریت وب ]",url:url+"#dashboard"}],[{text:"[ ❯› تنظیمات نصب ]",callback_data:"inst:settings"}],[{text:"[ ‹ بازگشت ]",callback_data:"inst:complete"}]]));return true;}
    case "inst:set:member":case "inst:set:commands":case "inst:set:auto":case "inst:set:security":case "inst:set:audit":await updatePolicy(pool,chat.id,data.slice(9));await renderSettings(pool,cb);return true;
    case "inst:uninstall:confirm":{const removed=await uninstall(pool,chat,cb.from.id);await edit(chat.id,cb.message.message_id,removed?["━━━━━━━━━━━━━━━━━━━━━━━━","◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ - Uɴɪɴsᴛᴀʟʟᴇᴅ","━━━━━━━━━━━━━━━━━━━━━━━━","","● ربات از چرخه مدیریت این گروه خارج شد.","","⛂ - داده‌ها : حفظ شدند","⛂ - تاریخچه نصب : حفظ شد","⛂ - Command : غیرفعال","⛂ - Automation : غیرفعال","","برای نصب مجدد، دستور install را ارسال کنید."].join("\n"):"● این گروه در حال حاضر نصب نشده است.",null);return true;}
    default:return true;
  }
}
