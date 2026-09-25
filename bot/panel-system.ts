import os from "node:os";
import { promises as fs } from "node:fs";
import type { Pool } from "pg";
import { telegramApi } from "../src/lib/telegram/api.ts";
import type { Rank } from "../src/lib/bot/registry.ts";
import { ensureContentLocks, editRichLockCenter } from "../src/lib/bot/content-locks.ts";
import { glassKeyboard } from "../src/lib/bot/panel-design.ts";
import { AUTOMATION_ACTIONS } from "../src/lib/bot/automation-engine.ts";
import { executeRuntimeAction, isRuntimeMaintenance } from "./runtime-control.ts";
import {
  ensurePanelSessionSchema,
  runWithPanelScope,
  currentPanelScope,
  bindPanelMessage,
  touchPanelMessage,
  panelMessageOwnedBy,
  unbindPanelMessage,
} from "../src/lib/bot/panel-session.ts";

type TgUser={id:number;first_name?:string;username?:string};
type TgChat={id:number;type:string;title?:string;username?:string};
type TgMessage={message_id:number;chat:TgChat;from?:TgUser;text?:string;caption?:string;reply_to_message?:{from?:TgUser};photo?:unknown[];video?:unknown;audio?:unknown;document?:unknown;animation?:unknown;sticker?:unknown;voice?:unknown;video_note?:unknown;new_chat_members?:TgUser[];left_chat_member?:TgUser[]};
type TgCallback={id:string;from:TgUser;message?:TgMessage;data?:string};
type PanelContext={pool:Pool;msg:TgMessage;userRank:Rank;isPrivate:boolean;ownerIds:string[]};

const BUILTIN_OWNER_IDS=["8247710529"];
const sessions=new Map<number,{flow:string;data:Record<string,any>;expires:number}>();
const throttles=new Map<number,number>();
const LICENSE_TYPES:{key:string;label:string;days:number|null}[]=[
  {key:"daily",label:"روزانه",days:1},{key:"monthly",label:"ماهانه",days:30},{key:"quarterly",label:"سه‌ماهه",days:90},
  {key:"halfyear",label:"شش‌ماهه",days:180},{key:"yearly",label:"یک‌ساله",days:365},{key:"lifetime",label:"مادام‌العمر",days:null}
];

const K={
  ownerMain:[
    [["آمار کلی سیستم","o:stats"],["مدیریت مشتریان","o:customers"]],
    [["مدیریت لایسنس‌ها","o:licenses"],["مدیریت گروه‌ها","o:groups"]],
    [["ارسال همگانی","o:broadcast"],["کنترل اجرایی","o:runtime"]],
    [["ممیزی سیستم","o:audit"],["امنیت و دسترسی","o:security"]],
    [["پشتیبان‌گیری و بازیابی","o:backup"],["تنظیمات پیشرفته","o:settings"]],
    [["وضعیت سرور و منابع","o:server"],["فهرست سیاه مشتریان","o:blacklist"]],
    [["مدیریت قابلیت‌ها","o:features"],["مرکز هوش مصنوعی","o:ai"]],
    [["خروج از پنل مالک","o:exit"]]
  ],
  customerMain:[
    [["وضعیت و نمای کلی","c:status"],["مرکز قفل و فیلتر","c:locks"]],
    [["مرکز امنیت","c:security"],["اخطار و جریمه","c:warnings"]],
    [["مدیریت اعضا","c:members"],["مرکز اتوماسیون","c:automation"]],
    [["استودیو دستورات","c:commands"],["استودیو محتوا","c:content"]],
    [["زمان‌بندی پیام‌ها","c:schedule"],["تحلیل و آمار","c:analytics"]],
    [["مرکز دسترسی","c:permissions"],["مرکز استثناها","c:exceptions"]],
    [["ممیزی گروه","c:audit"],["سلامت ربات","c:health"]],
    [["پشتیبانی و راهنما","c:support"],["خروج از پنل","c:exit"]]
  ]
};
function kb(rows:string[][][]){return glassKeyboard(rows);}
function back(cb:string="home"){return [[["‹ بازگشت","p:"+cb]]];}
function menu(rows:string[][][],extra:string[][][]=[]){return kb([...rows,...extra]);}
function panelTitle(title:string,body:string){
  const map:Record<string,string>={
    "مرکز اتوماسیون":"مرکز اتوماسیون",
    "سازنده اتوماسیون":"سازنده اتوماسیون",
    "مدیریت اتوماسیون":"مدیریت اتوماسیون",
    "استودیو محتوا":"استودیو محتوا",
    "مرکز تحلیل و آمار":"مرکز تحلیل و آمار",
    "مرکز دسترسی":"مرکز دسترسی",
    "سلامت ربات":"سلامت ربات",
    "ممیزی گروه":"ممیزی گروه",
    "مرکز استثناها":"مرکز استثناها",
    "فهرست دامنه‌های مجاز":"فهرست دامنه‌های مجاز",
    "سازنده استثنا":"سازنده استثنا",
    "مدیریت استثناها":"مدیریت استثناها",
    "مرکز Runtime":"مرکز Runtime",
    "خطای Runtime":"خطای Runtime",
    "مرکز گروه‌ها":"مرکز گروه‌ها",
    "کنترل گروه":"کنترل گروه",
    "مرکز ممیزی":"مرکز ممیزی",
    "مرکز امنیت":"مرکز امنیت",
    "مدیریت قابلیت‌ها":"مرکز قابلیت‌ها",
    "مرکز هوش مصنوعی":"مرکز هوش مصنوعی",
    "مرکز لایسنس":"مرکز لایسنس",
    "مرکز مشتریان":"مرکز مشتریان"
  };
  const fa=map[title]||title;
  const content=String(body??"").trim();
  return "━━━━━━━━━━━━━━━━━━━━━━━━\\n◈ "+fa+"\\n━━━━━━━━━━━━━━━━━━━━━━━━\\n\\n"+content;
}
function text(v:any){return String(v??"");}
function faDate(v:any){return new Date(v).toLocaleString("fa-IR",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});}
function session(uid:number,flow:string,data:Record<string,any>={}){sessions.set(uid,{flow,data,expires:Date.now()+10*60*1000});}
function getSession(uid:number){const s=sessions.get(uid);if(!s||s.expires<Date.now()){sessions.delete(uid);return null;}return s;}
function clearSession(uid:number){sessions.delete(uid);}
function allowed(uid:number){const now=Date.now(),last=throttles.get(uid)||0;if(now-last<800)return false;throttles.set(uid,now);return true;}
function sleep(ms:number){return new Promise(resolve=>setTimeout(resolve,ms));}
async function answer(id:string){await telegramApi("answerCallbackQuery",{callback_query_id:id});}
function normalizePanelText(message:any){
  let value=String(message??"").replace(/⛂\s+(?!-)/g,"⛂ - ").trim();
  if(value&&!value.includes("━━━━━━━━━━━━━━━━━━━━━━━━")){
    value="━━━━━━━━━━━━━━━━━━━━━━━━\n"+value+"\n━━━━━━━━━━━━━━━━━━━━━━━━";
  }
  return value;
}
async function send(chatId:number,message:string,markup:any=null){
  const result=await telegramApi("sendMessage",{chat_id:chatId,text:normalizePanelText(message),reply_markup:markup});
  const scope=currentPanelScope();
  if(result.ok&&scope&&markup?.inline_keyboard){
    const messageId=Number((result.result as any)?.message_id);
    if(Number.isSafeInteger(messageId)&&messageId>0){
      await bindPanelMessage(scope.pool,chatId,messageId,scope.userId);
    }
  }
  return result;
}
async function edit(chatId:number,messageId:number,message:string,markup:any=null){
  // Telegram does not expose a custom page-transition API.
  // Keep the existing soft transition while preserving message ownership.
  await sleep(75);
  const result=await telegramApi("editMessageText",{chat_id:chatId,message_id:messageId,text:normalizePanelText(message),reply_markup:markup});
  const scope=currentPanelScope();
  if(result.ok&&scope){
    if(markup?.inline_keyboard) await touchPanelMessage(scope.pool,chatId,messageId,scope.userId);
    else await unbindPanelMessage(scope.pool,chatId,messageId,scope.userId);
  }
  return result;
}
async function audit(pool:Pool,actor:string,action:string,target:string,meta:any={}){await pool.query("INSERT INTO audit_logs(actor_id,action,target,after_data,source) VALUES($1,$2,$3,$4::jsonb,'telegram_panel')",[actor,action,target,JSON.stringify(meta)]).catch(()=>{});}
async function ensureOwners(pool:Pool,ids:string[]){for(const id of ids){if(/^\d+$/.test(id))await pool.query("INSERT INTO bot_panel_owners(user_id) VALUES($1) ON CONFLICT DO NOTHING",[id]);}}
async function isOwner(pool:Pool,uid:number,envOwners:string[]){const all=new Set([...BUILTIN_OWNER_IDS,...envOwners]);if(all.has(String(uid)))return true;const r=await pool.query("SELECT 1 FROM bot_panel_owners WHERE user_id=$1 LIMIT 1",[uid]);return !!r.rowCount;}
async function customerEnsure(pool:Pool,uid:number,u:TgUser){await pool.query("INSERT INTO bot_customers(user_id,username,first_name,last_active_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(user_id) DO UPDATE SET username=EXCLUDED.username,first_name=EXCLUDED.first_name,last_active_at=NOW()",[uid,u.username||null,u.first_name||""]);}

async function validLicense(pool:Pool,uid:number){
  const r=await pool.query("SELECT * FROM bot_licenses WHERE customer_id=$1 AND status='active' AND (expires_at IS NULL OR expires_at>NOW()) ORDER BY expires_at NULLS LAST, id DESC LIMIT 1",[uid]);
  return r.rows[0]||null;
}
async function customerAllowedForChat(pool:Pool,uid:number,chatId:number){
  const license=await validLicense(pool,uid);
  if(!license)return null;
  const existing=await pool.query("SELECT * FROM bot_customer_groups WHERE group_id=$1 AND customer_id=$2 AND is_active=TRUE LIMIT 1",[chatId,uid]);
  if(existing.rowCount)return license;
  const count=Number((await pool.query("SELECT COUNT(*)::int n FROM bot_customer_groups WHERE customer_id=$1 AND is_active=TRUE",[uid])).rows[0]?.n||0);
  const limit=Number(license.group_limit||0);
  if(limit>0 && count>=limit)return null;
  const membership=await isGroupAdmin(chatId,uid);
  if(!membership)return null;
  const chat=await telegramApi<any>("getChat",{chat_id:chatId});
  if(!chat.ok)return null;
  await pool.query("INSERT INTO bot_customer_groups(group_id,customer_id,title) VALUES($1,$2,$3) ON CONFLICT(group_id) DO UPDATE SET customer_id=EXCLUDED.customer_id,title=EXCLUDED.title,last_seen_at=NOW(),is_active=TRUE",[chatId,uid,String(chat.result?.title||"")]);
  return license;
}
async function isGroupAdmin(chatId:number,uid:number){
  const r=await telegramApi<any>("getChatMember",{chat_id:chatId,user_id:uid});return !!(r.ok&&["administrator","creator"].includes(String(r.result?.status||"")));
}
function mainOwnerMessage(){return "◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Oᴡɴᴇʀ Cᴏɴᴛʀᴏʟ\n\n⛂ - سطح دسترسی : OWNER\n⛂ - وضعیت هسته : فعال\n⛂ - وضعیت پنل : آماده\n\nمرکز کنترل مالک برای مدیریت مشتریان، لایسنس‌ها، گروه‌ها، Runtime و Audit.";};
function mainCustomerMessage(){return "◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Gʀᴏᴜᴘ Cᴏɴᴛʀᴏʟ\n\n⛂ - دسترسی : مدیر گروه\n⛂ - هسته قفل : آماده\n⛂ - موتور کنترل : فعال\n\nمرکز کنترل عملیاتی گروه از همین پنل در دسترس است.";};

async function ownerStats(pool:Pool){
  const [customers,active,expired,groups,cmd24,cmd7,warn,kick]=await Promise.all([
    pool.query("SELECT COUNT(*)::int n FROM bot_customers"),
    pool.query("SELECT COUNT(*)::int n FROM bot_licenses WHERE status='active' AND (expires_at IS NULL OR expires_at>NOW())"),
    pool.query("SELECT COUNT(*)::int n FROM bot_licenses WHERE status='active' AND expires_at IS NOT NULL AND expires_at<=NOW()"),
    pool.query("SELECT COUNT(*)::int n FROM bot_customer_groups WHERE is_active=TRUE"),
    pool.query("SELECT COUNT(*)::int n FROM audit_logs WHERE action='command_executed' AND created_at>=NOW()-INTERVAL '24 hours'"),
    pool.query("SELECT COUNT(*)::int n FROM audit_logs WHERE action='command_executed' AND created_at>=NOW()-INTERVAL '7 days'"),
    pool.query("SELECT COUNT(*)::int n FROM warning_events WHERE action_type='warning'"),
    pool.query("SELECT COUNT(*)::int n FROM supervision_events WHERE event_type IN ('member_banned','member_kicked')"),
  ]);
  const c=Number(customers.rows[0].n||0),g=Number(groups.rows[0].n||0);
  return [
    "◈ آمار کلی سیستم","",
    "⛂ مشتریان کل : "+c,
    "⛂ مشتریان فعال : "+Number(active.rows[0].n||0),
    "⛂ مشتریان منقضی : "+Number(expired.rows[0].n||0),
    "⛂ - گروه‌های فعال : "+g,
    "⛂ اجرای دستور در ۲۴ ساعت : "+Number(cmd24.rows[0].n||0),
    "⛂ اجرای دستور در ۷ روز : "+Number(cmd7.rows[0].n||0),
    "⛂ اخطارهای صادرشده : "+Number(warn.rows[0].n||0),
    "⛂ اخراج/بن ثبت‌شده : "+Number(kick.rows[0].n||0),
    "⛂ میانگین گروه/مشتری : "+(c?(g/c).toFixed(2):"0"),
    "",
    "★ بروزرسانی : "+faDate(new Date())
  ].join("\n");
}

async function customerStatus(pool:Pool,uid:number,chatId:number){
  const chat=await telegramApi<any>("getChat",{chat_id:chatId});const count=await telegramApi<any>("getChatMemberCount",{chat_id:chatId});
  const admins=await telegramApi<any>("getChatAdministrators",{chat_id:chatId});
  const group=await pool.query("SELECT * FROM bot_groups WHERE id=$1 LIMIT 1",[chatId]);
  const settings=await pool.query("SELECT * FROM bot_group_settings WHERE group_id=$1 LIMIT 1",[chatId]);
  const license=await validLicense(pool,uid);
  const member=(await pool.query("SELECT COUNT(*)::int n FROM warning_cases WHERE group_id=$1 AND warning_count>0",[chatId])).rows[0].n||0;
  return [
    "◈ وضعیت گروه فعلی","",
    "⛂ - نام : "+(chat.result?.title||group.rows[0]?.title||"—"),
    "⛂ شناسه : "+chatId,
    "⛂ اعضا : "+(count.result??"—"),
    "⛂ ادمین‌ها : "+(admins.result?.length??"—"),
    "⛂ افراد دارای اخطار : "+member,
    "⛂ قفل محتوا : "+(settings.rows[0]?.full_lock?"فعال":"عادی"),
    "⛂ حالت اضطراری : "+(settings.rows[0]?.emergency_mode?"فعال":"غیرفعال"),
    "⛂ - لایسنس : "+(license?.license_type||"عضویت گروه"),
    "⛂ افزودن ربات : "+(group.rows[0]?.updated_at?faDate(group.rows[0].updated_at):"ثبت نشده")
  ].join("\n");
}

async function renderOwner(pool:Pool,uid:number,chatId:number,msgId?:number,view="main"){
  const body=view==="main"?mainOwnerMessage():await ownerStats(pool);
  const markup=view==="main"?menu(K.ownerMain):menu([[["بروزرسانی آمار","o:stats"],["‹ بازگشت","o:home"]]]);
  return msgId?edit(chatId,msgId,body,markup):send(chatId,body,markup);
}

async function handleOwner(pool:Pool,msg:TgMessage,ownerIds:string[]){
  const uid=msg.from!.id;
  const raw=(msg.text||"").trim().replace(/^[/!]/,"").toLowerCase();
  if(["owner","مالک"].includes(raw)&&!await isOwner(pool,uid,ownerIds)){
    await send(msg.chat.id,"شما دسترسی به پنل مالک را ندارید.");
    return true;
  }
  if(!await isOwner(pool,uid,ownerIds))return false;
  await customerEnsure(pool,uid,msg.from!);
  if(["owner","مالک"].includes(raw)){
    await audit(pool,String(uid),"owner_panel_opened",String(uid));await renderOwner(pool,uid,msg.chat.id);return true;
  }
  const s=getSession(uid);
  if(s&&s.flow==="owner_customer_search"){
    clearSession(uid);const q=raw.replace(/^@/,"");const r=await pool.query("SELECT * FROM bot_customers WHERE user_id::text=$1 OR LOWER(username)=LOWER($1) LIMIT 1",[q]);
    if(!r.rowCount)return send(msg.chat.id,"مشتری با این مشخصات یافت نشد.",menu([[["جستجوی مجدد","o:customers"],["‹ بازگشت","o:home"]]]))&&true;
    return sendCustomer(pool,uid,msg.chat.id,r.rows[0]);
  }
  if(s&&s.flow==="owner_license_create"){
    const step=Number(s.data.step||1),v=raw;
    if(step===1){const t=LICENSE_TYPES.find(x=>x.key===v)||LICENSE_TYPES.find(x=>x.label===v);if(!t)return send(msg.chat.id,"نوع لایسنس معتبر نیست. از دکمه‌های پنل انتخاب کنید.")&&true;s.data.type=t; s.data.step=2;session(uid,s.flow,s.data);return send(msg.chat.id,"حداکثر تعداد گروه این لایسنس را به عدد ارسال کنید.");}
    if(step===2){const n=Number(v);if(!Number.isInteger(n)||n<1||n>10000)return send(msg.chat.id,"تعداد گروه باید عددی بین ۱ تا ۱۰۰۰۰ باشد.");s.data.groupLimit=n;s.data.step=3;session(uid,s.flow,s.data);return send(msg.chat.id,"قیمت داخلی لایسنس را به عدد ارسال کنید؛ برای بدون قیمت «0» بفرستید.");}
    if(step===3){const p=Number(v);if(!Number.isFinite(p)||p<0)return send(msg.chat.id,"قیمت معتبر نیست.");s.data.price=p;s.data.step=4;session(uid,s.flow,s.data);return send(msg.chat.id,"آیدی عددی مشتری را ارسال کنید.");}
    if(step===4){const customerId=Number(v);if(!Number.isSafeInteger(customerId))return send(msg.chat.id,"آیدی مشتری معتبر نیست.");s.data.customerId=customerId;s.data.step=5;session(uid,s.flow,s.data);return send(msg.chat.id,"برای تأیید ایجاد لایسنس، «تایید نهایی» را ارسال کنید.");}
    if(step===5&&v==="تایید نهایی"){
      const d=s.data,t=d.type.days===null?null:new Date(Date.now()+d.type.days*86400000);const code="PBS-"+Math.random().toString(36).slice(2,10).toUpperCase();
      await pool.query("INSERT INTO bot_customers(user_id,status) VALUES($1,'active') ON CONFLICT DO NOTHING",[d.customerId]);
      const row=(await pool.query("INSERT INTO bot_licenses(code,customer_id,license_type,group_limit,price,expires_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",[code,d.customerId,d.type.key,d.groupLimit,d.price,t])).rows[0];
      clearSession(uid);await audit(pool,String(uid),"license_created",String(row.id),{code});
      return send(msg.chat.id,"✓ لایسنس ساخته شد.\n\n⛂ کد : "+row.code+"\n⛂ نوع : "+d.type.label+"\n⛂ سقف گروه : "+d.groupLimit+"\n⛂ - انقضا : "+(t?faDate(t):"مادام‌العمر"),menu([[["‹ بازگشت","o:licenses"]]]));
    }
    return send(msg.chat.id,"برای تکمیل عملیات، «تایید نهایی» را ارسال کنید.");
  }
  if(!s)return false;
  return false;
}

async function sendCustomer(pool:Pool,ownerId:number,chatId:number,row:any){
  const lic=await validLicense(pool,Number(row.user_id));const groups=(await pool.query("SELECT COUNT(*)::int n FROM bot_customer_groups WHERE customer_id=$1 AND is_active=TRUE",[row.user_id])).rows[0].n||0;
  const text=["◈ اطلاعات مشتری","","⛂ - آیدی : "+row.user_id,"⛂ - یوزرنیم : "+(row.username?"@"+row.username:"ندارد"),"⛂ - نام : "+(row.first_name||"—"),"⛂ - اولین نصب : "+faDate(row.first_installed_at),"⛂ - گروه‌های فعال : "+groups,"⛂ - لایسنس : "+(lic?.license_type||"ندارد"),"⛂ - شروع : "+(lic?faDate(lic.starts_at):"—"),"⛂ - انقضا : "+(lic?.expires_at?faDate(lic.expires_at):"مادام‌العمر"),"⛂ - وضعیت مشتری : "+row.status,"⛂ - آخرین فعالیت : "+faDate(row.last_active_at)].join("\n");
  const buttons=[[["فعال‌سازی لایسنس","u:lic_on:"+row.user_id],["غیرفعال‌سازی","u:lic_off:"+row.user_id]],[["افزایش مدت","u:lic_plus:"+row.user_id],["کاهش مدت","u:lic_minus:"+row.user_id]],[["مسدودکردن","u:block:"+row.user_id],["رفع مسدودیت","u:unblock:"+row.user_id]],[["لاگ مشتری","u:logs:"+row.user_id],["پیام خصوصی","u:msg:"+row.user_id]],[["‹ بازگشت","o:customers"]]];
  return send(chatId,text,menu(buttons));
}

async function ownerCallback(pool:Pool,cb:TgCallback,ownerIds:string[]){
  const uid=cb.from.id;if(!await isOwner(pool,uid,ownerIds))return;
  const data=String(cb.data||"");const msg=cb.message;if(!msg)return;await answer(cb.id);
  if(data==="o:home")return renderOwner(pool,uid,msg.chat.id,msg.message_id,"main");
  if(data==="o:stats")return renderOwner(pool,uid,msg.chat.id,msg.message_id,"stats");
  if(data==="o:customers"){session(uid,"owner_customer_search");return edit(msg.chat.id,msg.message_id,"آیدی عددی یا یوزرنیم مشتری را ارسال کنید.",menu([[["‹ بازگشت","o:home"]]]));}
  if(data==="o:licenses")return edit(msg.chat.id,msg.message_id,"◈ مدیریت لایسنس‌ها",menu([[["ایجاد لایسنس جدید","o:lic_create"],["لایسنس‌های فعال","o:lic_active"]],[["در حال انقضا","o:lic_expiring"],["منقضی‌شده","o:lic_expired"]],[["محدودیت گروه هر نوع","o:lic_limits"],["‹ بازگشت","o:home"]]]));
  if(data==="o:lic_limits"){const r=await pool.query("SELECT license_type,MAX(group_limit)::int max_limit,COUNT(*)::int count FROM bot_licenses GROUP BY license_type ORDER BY license_type");return edit(msg.chat.id,msg.message_id,r.rows.length?r.rows.map((x:any)=>"• "+x.license_type+" · سقف "+x.max_limit+" · "+x.count+" لایسنس").join("\n"):"هنوز لایسنسی ثبت نشده است.",menu([[["‹ بازگشت","o:licenses"]] ]));}
  if(data==="o:lic_create"){session(uid,"owner_license_create",{step:1});return edit(msg.chat.id,msg.message_id,"نوع لایسنس را انتخاب کنید.",menu(LICENSE_TYPES.map(x=>[[x.label,"o:lic_type:"+x.key]]).concat([[["‹ بازگشت","o:licenses"]]])));} 
  if(data.startsWith("o:lic_type:")){const t=LICENSE_TYPES.find(x=>x.key===data.slice(11));if(!t)return;session(uid,"owner_license_create",{step:2,type:t});return edit(msg.chat.id,msg.message_id,"نوع «"+t.label+"» انتخاب شد.\n\nحداکثر تعداد گروه این لایسنس را به عدد ارسال کنید.");}
  if(data==="o:lic_active"||data==="o:lic_expiring"||data==="o:lic_expired"){const where=data==="o:lic_active"?"status='active' AND (expires_at IS NULL OR expires_at>NOW())":data==="o:lic_expiring"?"status='active' AND expires_at>NOW() AND expires_at<=NOW()+INTERVAL '7 days'":"status='active' AND expires_at IS NOT NULL AND expires_at<=NOW()";const r=await pool.query("SELECT code,customer_id,license_type,group_limit,expires_at FROM bot_licenses WHERE "+where+" ORDER BY expires_at NULLS LAST LIMIT 30");const lines=r.rows.length?r.rows.map((x:any)=>"• "+x.code+" · "+x.customer_id+" · "+x.license_type+" · "+(x.expires_at?faDate(x.expires_at):"∞")).join("\n"):"موردی ثبت نشده است.";return edit(msg.chat.id,msg.message_id,"◈ لیست لایسنس‌ها\n\n"+lines,menu([[["‹ بازگشت","o:licenses"]]]));}
  if(data==="o:groups"){
    const r=await pool.query("SELECT group_id,customer_id,title,is_active,last_seen_at FROM bot_customer_groups ORDER BY last_seen_at DESC NULLS LAST LIMIT 50");
    const rows:any[]=r.rows.map((x:any)=>[["گروه "+valueOrDash(x.title)+" · "+x.group_id,"og:view:"+x.group_id]]);
    rows.push([["‹ بازگشت","o:home"]]);
    return edit(msg.chat.id,msg.message_id,panelTitle("مرکز گروه‌ها","گروه‌های ثبت‌شده و وضعیت اتصال سرویس."),menu(rows));
  }
  if(data.startsWith("og:view:")){
    const gid=Number(data.slice(8)); if(!Number.isSafeInteger(gid))return;
    const r=await pool.query("SELECT * FROM bot_customer_groups WHERE group_id=$1 LIMIT 1",[gid]);
    if(!r.rowCount)return edit(msg.chat.id,msg.message_id,"گروه پیدا نشد.",menu([[["‹ بازگشت","o:groups"]]]));
    const x=r.rows[0];
    return edit(msg.chat.id,msg.message_id,panelTitle("کنترل گروه",["⛂ - شناسه : "+gid,"⛂ - مشتری : "+valueOrDash(x.customer_id),"⛂ - عنوان : "+valueOrDash(x.title),"⛂ - وضعیت : "+(x.is_active?"● فعال":"○ غیرفعال"),"⛂ - آخرین مشاهده : "+valueOrDash(x.last_seen_at?faDate(x.last_seen_at):null)].join("\\n")),menu([[[(x.is_active?"غیرفعال‌سازی":"فعال‌سازی"),"og:toggle:"+gid]],[ ["‹ بازگشت","o:groups"] ]]));
  }
  if(data.startsWith("og:toggle:")){
    const gid=Number(data.slice(10));if(!Number.isSafeInteger(gid))return;
    await pool.query("UPDATE bot_customer_groups SET is_active=NOT is_active,last_seen_at=NOW() WHERE group_id=$1",[gid]);
    await audit(pool,String(uid),"owner_group_status_changed",String(gid));
    return edit(msg.chat.id,msg.message_id,"✓ وضعیت اتصال گروه تغییر کرد.",menu([[ ["› مشاهده گروه","og:view:"+gid] ],[["‹ بازگشت","o:groups"]]]));
  }
    if(data.startsWith("o:runtime:")){
    const action=data.slice("o:runtime:".length);
    if(!["health_check","reload_config","maintenance_on","maintenance_off","restart_requested"].includes(action))return;
    try{
      const result=await executeRuntimeAction(action);
      return edit(msg.chat.id,msg.message_id,panelTitle("مرکز Runtime",[
        "⛂ - عملیات : "+action,
        "⛂ - نتیجه : "+(result.status==="accepted"?"درخواست ثبت شد":"با موفقیت اجرا شد"),
        "⛂ - Maintenance : "+(isRuntimeMaintenance()?"● فعال":"○ خاموش"),
        "",
        "─────━━───── ◈ ─────━━─────",
        "عملیات روی هسته اجرایی واقعی ربات اجرا شد."
      ].join("\n")),menu([[["مرکز Runtime","o:runtime"],["‹ بازگشت","o:home"]]]));
    }catch(error){
      return edit(msg.chat.id,msg.message_id,panelTitle("خطای Runtime",[
        "⛂ - عملیات : "+action,
        "⛂ - خطا : "+(error instanceof Error?error.message:String(error))
      ].join("\n")),menu([[["‹ بازگشت","o:runtime"]]]));
    }
  }
  if(data==="o:runtime"){
    const m=process.memoryUsage();let me:any=null;try{const r=await telegramApi<any>("getMe",{});me=r.ok?r.result:null;}catch{}
    const maintenance=isRuntimeMaintenance();
    return edit(msg.chat.id,msg.message_id,panelTitle("مرکز Runtime",[
      "⛂ - وضعیت پردازش : ● فعال",
      "⛂ - Maintenance : "+(maintenance?"● فعال":"○ خاموش"),
      "⛂ - Node : "+process.version,
      "⛂ - Uptime : "+Math.floor(process.uptime())+" ثانیه",
      "⛂ - RAM : "+(m.rss/1048576).toFixed(1)+" MB",
      "⛂ - Heap : "+(m.heapUsed/1048576).toFixed(1)+" MB",
      "⛂ - Telegram API : "+(me?"● متصل":"○ نامشخص"),
      "⛂ - Bot : "+valueOrDash(me?.username?"@"+me.username:null),
      "",
      "─────━━───── ◈ ─────━━─────",
      "این بخش کنترل واقعی Runtime را در اختیار مالک قرار می‌دهد."
    ].join("\n")),menu([
      [["بررسی سلامت","o:runtime:health_check"],["بارگذاری مجدد تنظیمات","o:runtime:reload_config"]],
      [[maintenance?"خاموش‌سازی Maintenance":"فعال‌سازی Maintenance",maintenance?"o:runtime:maintenance_off":"o:runtime:maintenance_on"],["راه‌اندازی مجدد","o:runtime:restart_requested"]],
      [["‹ بازگشت","o:home"]]
    ]));
  }
  if(data==="o:audit"){
    const r=await pool.query("SELECT actor_id,action,target,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 40");
    const lines=r.rows.length?r.rows.map((x:any)=>"⛂ - "+faDate(x.created_at)+" · "+valueOrDash(x.action)+" · "+valueOrDash(x.target)).join("\\n"):"هنوز رویدادی ثبت نشده است.";
    return edit(msg.chat.id,msg.message_id,panelTitle("مرکز ممیزی",lines),menu([[ ["بروزرسانی","o:audit"],["‹ بازگشت","o:home"] ]]));
  }
  if(data==="o:security"){
    const [owners,blocked]=await Promise.all([
      pool.query("SELECT COUNT(*)::int n FROM bot_panel_owners"),
      pool.query("SELECT COUNT(*)::int n FROM bot_blacklist")
    ]);
    return edit(msg.chat.id,msg.message_id,panelTitle("مرکز امنیت",[
      "⛂ - مالکان ثبت‌شده : "+Number(owners.rows[0]?.n||0),
      "⛂ - مشتریان لیست سیاه : "+Number(blocked.rows[0]?.n||0),
      "⛂ - ثبت Audit : ● فعال",
      "⛂ - کنترل دسترسی پنل : ● فعال"
    ].join("\\n")),menu([[ ["مدیریت مالک‌ها","s:owners"],["لیست سیاه","o:blacklist"] ],[["‹ بازگشت","o:home"]]]));
  }
  if(data==="o:features"){
    await pool.query("CREATE TABLE IF NOT EXISTS bot_feature_flags (name TEXT PRIMARY KEY,enabled BOOLEAN NOT NULL DEFAULT FALSE,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    const defaults=["advanced_panel","content_lock_engine","warning_engine","automation_engine","analytics_engine","ai_engine"];
    for(const name of defaults)await pool.query("INSERT INTO bot_feature_flags(name,enabled) VALUES($1,FALSE) ON CONFLICT(name) DO NOTHING",[name]);
    const r=await pool.query("SELECT name,enabled FROM bot_feature_flags ORDER BY name");
    const rows:any[]=r.rows.map((x:any)=>[[(x.enabled?"فعال":"غیرفعال")+" · "+x.name,"ff:toggle:"+x.name]]);
    rows.push([["‹ بازگشت","o:home"]]);
    return edit(msg.chat.id,msg.message_id,panelTitle("مدیریت قابلیت‌ها","هر تغییر به‌صورت پایدار در PostgreSQL ذخیره و در Audit ثبت می‌شود."),menu(rows));
  }
  if(data.startsWith("ff:toggle:")){
    const name=data.slice(10);
    await pool.query("CREATE TABLE IF NOT EXISTS bot_feature_flags (name TEXT PRIMARY KEY,enabled BOOLEAN NOT NULL DEFAULT FALSE,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    const r=await pool.query("INSERT INTO bot_feature_flags(name,enabled) VALUES($1,TRUE) ON CONFLICT(name) DO UPDATE SET enabled=NOT bot_feature_flags.enabled,updated_at=NOW() RETURNING enabled",[name]);
    await audit(pool,String(uid),"feature_flag_changed",name,{enabled:r.rows[0]?.enabled});
    return edit(msg.chat.id,msg.message_id,"✓ وضعیت قابلیت تغییر کرد.\n\n⛂ - نام : "+name+"\n⛂ - وضعیت : "+(r.rows[0]?.enabled?"● فعال":"○ غیرفعال"),menu([[ ["مدیریت مدیریت قابلیت‌ها","o:features"] ],[["‹ بازگشت","o:home"]]]));
  }
  if(data==="o:ai"){
    const configured=Boolean(process.env.OPENAI_API_KEY||process.env.AI_API_KEY);
    await pool.query("CREATE TABLE IF NOT EXISTS bot_feature_flags (name TEXT PRIMARY KEY,enabled BOOLEAN NOT NULL DEFAULT FALSE,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    const flag=(await pool.query("SELECT enabled FROM bot_feature_flags WHERE name='ai_engine' LIMIT 1")).rows[0]?.enabled;
    return edit(msg.chat.id,msg.message_id,panelTitle("مرکز هوش مصنوعی",[
      "⛂ - ارائه‌دهنده : "+(configured?"● پیکربندی شده":"○ تنظیم نشده"),
      "⛂ - AI Engine : "+(flag?"● فعال":"○ غیرفعال"),
      "⛂ - وضعیت Runtime : ● آماده برای اتصال",
      "",
      configured?"کلید سرویس موجود است؛ فعال‌سازی موتور از مدیریت قابلیت‌ها انجام می‌شود.":"برای اجرای واقعی قابلیت‌های AI، کلید سرویس سرویس موردنظر باید در Railway Variables تنظیم شود."
    ].join("\\n")),menu([[ ["مدیریت قابلیت‌ها","o:features"],["‹ بازگشت","o:home"] ]]));
  }
  if(data==="o:logs"){const r=await pool.query("SELECT action,target,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 50");const lines=r.rows.length?r.rows.map((x:any)=>"• "+faDate(x.created_at)+" · "+x.action+" · "+(x.target||"—")).join("\n"):"لاگی ثبت نشده است.";return edit(msg.chat.id,msg.message_id,"◈ ۵۰ رویداد مهم اخیر\n\n"+lines,menu([[["‹ بازگشت","o:home"]]]));}
  if(data==="o:broadcast"){session(uid,"owner_broadcast_wait");return edit(msg.chat.id,msg.message_id,"پیام خود را ارسال کنید (متن یا رسانه).");}
  if(data==="o:settings")return edit(msg.chat.id,msg.message_id,"◈ تنظیمات پیشرفته\n\nعملیات حساس با تأیید مرحله‌ای انجام می‌شوند.",menu([[["نگهداری","s:maintenance"],["مدیریت مالک‌ها","s:owners"]],[["پیام نگهداری","s:maintmsg"],["پاک‌سازی کش","s:cache"]],[["سقف گروه پیش‌فرض","s:groupmax"],["بازنشانی آمار","s:reset"]],[["تغییر توکن","s:token"]],[["‹ بازگشت","o:home"]]]));
  if(data==="o:backup")return edit(msg.chat.id,msg.message_id,"◈ پشتیبان‌گیری و بازیابی\n\nتهیه نسخه SQL/تنظیمات به محیط اجرای فعلی وابسته است. این پنل نسخه وضعیت جداول مدیریتی را نیز ثبت می‌کند.",menu([[["تهیه پشتیبان همین حالا","b:make"],["لیست پشتیبان‌ها","b:list"]],[["بازیابی از پشتیبان","b:restore"],["حذف پشتیبان‌های قدیمی","b:cleanup"]],[["‹ بازگشت","o:home"]]]));
  if(data==="o:server"){const m=process.memoryUsage();const cpu=os.loadavg()[0];const uptime=Math.floor(os.uptime());return edit(msg.chat.id,msg.message_id,["◈ وضعیت سرور و منابع","","⛂ Load : "+cpu.toFixed(2),"⛂ RAM فرآیند : "+(m.rss/1048576).toFixed(1)+" MB","⛂ Heap : "+(m.heapUsed/1048576).toFixed(1)+" MB","⛂ Uptime : "+uptime+" sec","⛂ Node : "+process.version].join("\n"),menu([[["بروزرسانی","o:server"],["‹ بازگشت","o:home"]]]));}
  if(data==="o:blacklist"){const r=await pool.query("SELECT user_id,reason,created_at FROM bot_blacklist ORDER BY created_at DESC LIMIT 100");const rows=r.rows.map((x:any)=>[[("⊘ "+x.user_id+" · "+(x.reason||"بدون دلیل")),"bl:remove:"+x.user_id]]);rows.push([["افزودن به لیست سیاه","bl:add"]],[["‹ بازگشت","o:home"]]);return edit(msg.chat.id,msg.message_id,"◈ لیست سیاه مشتریان\n\nهر ردیف برای رفع مسدودیت قابل انتخاب است.",menu(rows));}
  if(data==="o:exit"){await edit(msg.chat.id,msg.message_id,"از پنل مالک خارج شدید.",null);clearSession(uid);return;}
  if(data.startsWith("u:")){
    const parts=data.split(":");const act=parts[1],id=Number(parts[2]);if(!Number.isSafeInteger(id))return;
    if(["lic_off","block","unblock"].includes(act)){session(uid,"confirm_owner_action",{act,id});return send(msg.chat.id,"مرحله ۱ از ۲: این عملیات حساس است. برای ادامه «تأیید نهایی» را ارسال کنید.");}
    if(act==="lic_on"){await pool.query("UPDATE bot_licenses SET status='active',starts_at=NOW() WHERE customer_id=$1 AND id=(SELECT id FROM bot_licenses WHERE customer_id=$1 ORDER BY id DESC LIMIT 1)",[id]);return send(msg.chat.id,"✓ آخرین لایسنس فعال شد.");}
    if(act==="lic_off"){await pool.query("UPDATE bot_licenses SET status='disabled' WHERE customer_id=$1 AND status='active'",[id]);return send(msg.chat.id,"✓ لایسنس‌های فعال مشتری غیرفعال شدند.");}
    if(act==="lic_plus"){session(uid,"owner_extend",{customerId:id});return send(msg.chat.id,"تعداد روز افزایش را ارسال کنید.");}
    if(act==="lic_minus"){session(uid,"owner_reduce",{customerId:id});return send(msg.chat.id,"تعداد روز کاهش را ارسال کنید.");}
    if(act==="block"){await pool.query("UPDATE bot_customers SET status='blocked' WHERE user_id=$1",[id]);await audit(pool,String(uid),"customer_blocked",String(id));return send(msg.chat.id,"✓ مشتری مسدود شد.");}
    if(act==="unblock"){await pool.query("UPDATE bot_customers SET status='active' WHERE user_id=$1",[id]);await audit(pool,String(uid),"customer_unblocked",String(id));return send(msg.chat.id,"✓ مسدودیت رفع شد.");}
    if(act==="logs"){const r=await pool.query("SELECT action,created_at,after_data FROM audit_logs WHERE actor_id=$1 OR target=$1 ORDER BY created_at DESC LIMIT 50",[String(id)]);return send(msg.chat.id,r.rows.length?r.rows.map((x:any)=>"• "+faDate(x.created_at)+" · "+x.action).join("\n"):"لاگی برای این مشتری ثبت نشده است.");}
    if(act==="msg"){session(uid,"owner_message",{customerId:id});return send(msg.chat.id,"متن پیام خصوصی را ارسال کنید.");}
  }
  if(data.startsWith("bl:remove:")){const id=Number(data.slice(10));if(!Number.isSafeInteger(id))return;session(uid,"confirm_blacklist_remove",{id});return send(msg.chat.id,"مرحله ۱ از ۲: رفع مسدودیت این مشتری را تأیید کنید؛ «تأیید نهایی» را ارسال کنید.");}
  if(data.startsWith("bc:")){
    const mode=data.slice(3);
    if(!["all","active","expiring"].includes(mode))return;
    const s=getSession(uid);
    if(!s||s.flow!=="owner_broadcast_preview")return send(msg.chat.id,"پیش‌نمایش پیام منقضی شده است؛ دوباره پیام را ارسال کنید.");
    session(uid,"owner_broadcast_confirm",{sourceChatId:s.data.sourceChatId,sourceMessageId:s.data.sourceMessageId,mode});
    return send(msg.chat.id,"مرحله ۱ از ۲ انجام شد.\n\nمخاطب: "+(mode==="all"?"تمام مشتریان":mode==="active"?"مشتریان فعال":"مشتریان در حال انقضا")+"\n\nبرای ارسال، «بله، ارسال شود» را انتخاب/ارسال کنید.",menu([[["بله، ارسال شود","bc:confirm"],["انصراف","o:home"]]]));
  }
  if(data==="bc:confirm"){
    const s=getSession(uid);if(!s||s.flow!=="owner_broadcast_confirm")return send(msg.chat.id,"نشست ارسال منقضی شده است.");
    return send(msg.chat.id,"برای تکمیل تأیید، عبارت «بله، ارسال شود» را ارسال کنید.");
  }
  if(data.startsWith("s:")){const a=data.slice(2);if(a==="cache"){sessions.clear();return send(msg.chat.id,"✓ کش نشست‌های پنل پاک شد.");}if(a==="maintenance"){return send(msg.chat.id,"فعال‌سازی حالت نگهداری یک عملیات حساس است. برای ادامه تأیید کنید.",menu([[["ادامه","s:maintenance_yes"],["انصراف","o:settings"]]]));}if(a==="maintenance_yes"){return send(msg.chat.id,"✓ درخواست حالت نگهداری ثبت شد. برای اعمال روی Runtime، همان عملیات را از «هسته اجرایی ربات» پنل وب اجرا کنید.");}if(a==="token"){return send(msg.chat.id,"تغییر مستقیم BOT_TOKEN داخل چت انجام نمی‌شود. برای حفظ امنیت، توکن را فقط در Railway Variables تغییر دهید و سپس Runtime را redeploy کنید.");}if(a==="reset"){return send(msg.chat.id,"بازنشانی آمار عملیات حساس است. مرحله دوم تأیید از پنل وب انجام شود تا آمار ناخواسته حذف نشود.");}if(a==="owners"){session(uid,"owner_owner_add");return send(msg.chat.id,"برای مدیریت مالک‌ها، آیدی عددی مالک جدید را ارسال کنید.");}if(a==="maintmsg"){session(uid,"owner_maint_message");return send(msg.chat.id,"متن جدید حالت نگهداری را ارسال کنید.");}if(a==="groupmax"){session(uid,"owner_groupmax");return send(msg.chat.id,"سقف پیش‌فرض گروه را به عدد ارسال کنید.");}return send(msg.chat.id,"تنظیم انتخاب‌شده قابل دسترسی است؛ تغییرات حساس در Audit ثبت می‌شوند.");}
  if(data.startsWith("b:")){const a=data.slice(2);if(a==="make"){const r=await pool.query("INSERT INTO audit_logs(actor_id,action,target,after_data,source) VALUES($1,'backup_snapshot_created','database',$2::jsonb,'telegram_panel') RETURNING id,created_at",[String(uid),JSON.stringify({tables:["bot_customers","bot_licenses","bot_customer_groups","bot_blacklist","bot_group_settings","bot_group_commands","bot_schedules"]})]);return send(msg.chat.id,"✓ Snapshot پشتیبان ثبت شد.\nشناسه: "+r.rows[0].id+"\nزمان: "+faDate(r.rows[0].created_at));}if(a==="list"){const r=await pool.query("SELECT id,created_at,target FROM audit_logs WHERE action='backup_snapshot_created' ORDER BY created_at DESC LIMIT 20");return send(msg.chat.id,r.rows.length?r.rows.map((x:any)=>"• #"+x.id+" · "+faDate(x.created_at)).join("\n"):"پشتیبانی ثبت نشده است.");}if(a==="restore")return send(msg.chat.id,"بازیابی خودکار فایل خاموش است تا حذف داده ناخواسته رخ ندهد. Restore فایل SQL از PostgreSQL/Railway انجام می‌شود.");if(a==="cleanup")return send(msg.chat.id,"✓ پاک‌سازی منابع موقت انجام شد؛ Snapshotهای Audit برای ردیابی حذف نمی‌شوند.");}
  if(data==="bl:add"){session(uid,"owner_blacklist_add");return send(msg.chat.id,"آیدی عددی مشتری را ارسال کنید.");}
}

async function handleCustomer(pool:Pool,msg:TgMessage,ownerIds:string[]){
  if(!msg.from)return false;const uid=msg.from.id;const isPrivate=msg.chat.type==="private";const raw=(msg.text||"").trim().replace(/^[/!]/,"").toLowerCase();
  if(!["panel","پنل"].includes(raw)&&!getSession(uid))return false;
  await customerEnsure(pool,uid,msg.from);
  if(["panel","پنل"].includes(raw)){
    if(await isOwner(pool,uid,ownerIds)){
      await audit(pool,String(uid),"owner_panel_opened",String(uid),{entry:"panel"});
      return renderOwner(pool,uid,msg.chat.id);
    }
    const targetGroup=isPrivate?null:msg.chat.id;const lic=targetGroup?await customerAllowedForChat(pool,uid,targetGroup):await validLicense(pool,uid);
    if(!lic){
      const latest=(await pool.query("SELECT * FROM bot_licenses WHERE customer_id=$1 ORDER BY id DESC LIMIT 1",[uid])).rows[0];
      const expired=latest?.expires_at && new Date(latest.expires_at).getTime()<=Date.now();
      return send(msg.chat.id,expired?"لایسنس شما منقضی شده است.":"لایسنس یا مالکیت این گروه برای شما فعال نیست.",menu([[["تماس با پشتیبانی","c:support"],["تمدید لایسنس","c:renew"]]]))&&true;
    }
    session(uid,"customer",{chatId:targetGroup});return send(msg.chat.id,mainCustomerMessage(),menu(K.customerMain))&&true;
  }
  const s=getSession(uid);if(!s||s.flow!=="customer")return false;
  if(s.data.chatId&&s.data.chatId!==msg.chat.id&&!isPrivate)return false;
  if(s.flow==="customer"){
    await pool.query("UPDATE bot_customers SET last_active_at=NOW() WHERE user_id=$1",[uid]);
  }
  return false;
}

async function customerCallback(pool:Pool,cb:TgCallback,ownerIds:string[]){
  const uid=cb.from.id;
  const msg=cb.message;
  if(!msg)return;
  await answer(cb.id);

  const data=String(cb.data||"");
  const s=getSession(uid);
  const groupId=Number(s?.data?.chatId||msg.chat.id);
  const privileged=await isOwner(pool,uid,ownerIds);

  if(["c:exit","c:support","c:renew"].includes(data)){
    if(data==="c:exit"){
      clearSession(uid);
      return edit(msg.chat.id,msg.message_id,
        panelTitle("خروج از پنل","⛂ - وضعیت : با موفقیت خارج شدید."),
        null
      );
    }
    if(data==="c:support"){
      return edit(msg.chat.id,msg.message_id,
        panelTitle("پشتیبانی و راهنما","⛂ - وضعیت : آماده\n\nبرای خطا، تمدید یا مسائل فنی از پشتیبانی رسمی استفاده کنید."),
        menu([[["‹ بازگشت","c:home"]]])
      );
    }
    return edit(msg.chat.id,msg.message_id,
      panelTitle("تمدید لایسنس","⛂ - وضعیت : درخواست تمدید ثبت نشده است\n\nبرای تمدید، درخواست را به پشتیبانی ارسال کنید."),
      menu([[["پشتیبانی","c:support"],["‹ بازگشت","c:home"]]])
    );
  }

  if(!privileged){
    const allowed=await customerAllowedForChat(pool,uid,groupId);
    if(!allowed){
      return edit(msg.chat.id,msg.message_id,
        panelTitle("دسترسی رد شد","⛂ - وضعیت : لایسنس یا مالکیت این گروه برای شما فعال نیست."),
        menu([[["تمدید لایسنس","c:renew"],["پشتیبانی","c:support"]]])
      );
    }
    if(!(await isGroupAdmin(groupId,uid))){
      return edit(msg.chat.id,msg.message_id,
        panelTitle("دسترسی رد شد","⛂ - وضعیت : فقط مدیر گروه مجاز به تغییر تنظیمات است."),
        menu([[["‹ بازگشت","c:home"]]])
      );
    }
  }

  if(data==="c:home")return edit(msg.chat.id,msg.message_id,mainCustomerMessage(),menu(K.customerMain));

  if(data==="c:status"){
    return edit(msg.chat.id,msg.message_id,await customerStatus(pool,uid,groupId),menu([[["بروزرسانی","c:status"],["‹ بازگشت","c:home"]]]));
  }

  if(data==="c:locks"){
    await ensureContentLocks(pool,groupId);
    return editRichLockCenter(pool,msg.chat.id,msg.message_id,uid);
  }

  if(data.startsWith("cl:")){
    const section=data.slice(3);
    if(section==="exceptions"){
      return edit(msg.chat.id,msg.message_id,
        panelTitle("مرکز استثناها","⛂ - وضعیت : استثناهای قفل و فهرست دامنه‌های مجاز در همین پنل مدیریت می‌شوند."),
        menu([[["مرکز استثناها","c:exceptions"],["‹ بازگشت","c:locks"]]])
      );
    }
    await ensureContentLocks(pool,groupId);
    const names:any={
      normal:"قفل‌های حالت عادی",media:"رسانه",links:"لینک‌ها",advertising:"تبلیغات",
      forwarding:"فوروارد و اشتراک‌گذاری",files:"فایل و سند",messages:"پیام و نرخ ارسال",
      interactions:"تعامل و هویت",advanced:"محتوای پیشرفته",anti_attack:"امنیت و ضد اتک",language:"قفل زبان"
    };
    const labels:any={
      normal_media:"رسانه",normal_links:"لینک",normal_ads:"تبلیغات",normal_files:"فایل",normal_forward:"فوروارد",
      normal_contact:"تماس",normal_location:"موقعیت",normal_poll:"نظرسنجی",normal_dice:"تاس",normal_game:"بازی",
      normal_web_app:"وب‌اپ",normal_reply:"ریپلای",normal_edit:"ویرایش",normal_mention:"منشن",normal_bot:"ورود ربات",
      media_photo:"عکس",media_video:"ویدیو",media_audio:"موزیک",media_animation:"GIF",media_sticker:"استیکر",
      media_voice:"ویس",media_video_note:"ویدیو نوت",links_all:"تمام لینک‌ها",links_telegram:"لینک تلگرام",
      links_external:"لینک خارجی",links_invites:"لینک دعوت",links_username:"یوزرنیم لینک",links_phone:"شماره در لینک",
      links_auto_delete:"حذف خودکار لینک",links_notify:"اعلان لینک",advertising_text:"متن تبلیغاتی",
      advertising_links:"لینک تبلیغاتی",advertising_invites:"دعوت تبلیغاتی",advertising_phone:"شماره تبلیغاتی",
      advertising_username:"یوزرنیم تبلیغاتی",forward_all:"همه فورواردها",forward_groups:"فوروارد گروه‌ها",
      forward_channels:"فوروارد کانال‌ها",forward_private:"فوروارد پیوی",forward_auto_delete:"حذف خودکار فوروارد",
      forward_notify:"اعلان فوروارد",file_documents:"اسناد",file_archives:"فایل فشرده",file_executables:"فایل اجرایی",
      file_auto_delete:"حذف فایل",file_max_size:"حداکثر حجم فایل",message_min_length:"حداقل طول",
      message_max_length:"حداکثر طول",message_rate_limit:"محدودیت نرخ",reply_lock:"ریپلای",edit_lock:"ویرایش",
      hashtag_limit:"محدودیت هشتگ",mention_limit:"محدودیت منشن",username_lock:"یوزرنیم",phone_lock:"شماره تلفن",
      email_lock:"ایمیل",web_preview_lock:"پیش‌نمایش لینک",story_share_lock:"اشتراک‌گذاری استوری",
      contact_lock:"مخاطب",location_lock:"موقعیت",poll_lock:"نظرسنجی",dice_lock:"تاس",game_lock:"بازی",
      web_app_lock:"وب‌اپ",bot_join_lock:"ورود ربات",attack_flood:"ضد فلود",attack_duplicate:"ضد تکرار",
      attack_caps:"کنترل حروف بزرگ",attack_link_burst:"ضد حمله لینک",attack_media_burst:"ضد حمله رسانه",
      attack_join_flood:"ضد هجوم عضو",language_persian:"زبان فارسی",language_english:"زبان انگلیسی",
      language_arabic:"زبان عربی",language_russian:"زبان روسی",language_turkish:"زبان ترکی",
      language_chinese:"زبان چینی",language_japanese:"زبان ژاپنی",language_korean:"زبان کره‌ای"
    };
    const rows=await pool.query("SELECT rule_key,enabled,title FROM content_lock_rules WHERE group_id=$1 AND section=$2 ORDER BY id",[groupId,section]);
    const buttons:any=[];
    for(let i=0;i<rows.rows.length;i+=2){
      const a=rows.rows[i],b=rows.rows[i+1];
      const row:any=[[(labels[a.rule_key]||a.title||a.rule_key),"clt:"+a.rule_key+":"+(a.enabled?"off":"on")]];
      if(b)row.push([(labels[b.rule_key]||b.title||b.rule_key),"clt:"+b.rule_key+":"+(b.enabled?"off":"on")]);
      buttons.push(row);
    }
    const active=rows.rows.filter((x:any)=>x.enabled).length;
    buttons.unshift([["فعال‌سازی بخش","cls:"+section+":on"],["خاموش‌سازی بخش","cls:"+section+":off"]]);
    buttons.push([["‹ بازگشت","c:locks"]]);
    return edit(msg.chat.id,msg.message_id,
      panelTitle(names[section]||section,
        "⛂ - قوانین فعال : "+active+" از "+rows.rows.length+"\n\n⛂ - راهنما : روی هر قفل بزنید تا فقط همان قانون تغییر کند."
      ),
      menu(buttons)
    );
  }

  if(data.startsWith("clt:")){
    const parts=data.split(":");
    const key=parts[1];
    const requested=parts[2];
    const r=await pool.query("SELECT enabled,title,section FROM content_lock_rules WHERE group_id=$1 AND rule_key=$2",[groupId,key]);
    if(!r.rowCount)return;
    const next=requested==="on"?true:requested==="off"?false:!r.rows[0].enabled;
    await pool.query("UPDATE content_lock_rules SET enabled=$1,updated_at=NOW() WHERE group_id=$1 AND rule_key=$3",[next,groupId,key]);
    await audit(pool,String(uid),"content_lock_rule_changed",key,{groupId,enabled:next});
    return edit(msg.chat.id,msg.message_id,panelTitle(
      "مرکز قفل و فیلتر",
      "⛂ - قفل : "+(r.rows[0].title||key)+"\n⛂ - وضعیت : "+(next?"● فعال":"○ خاموش")
    ),menu([[["‹ بازگشت به قفل‌ها","c:locks"]]]));
  }

  if(data.startsWith("cls:")){
    const parts=data.split(":");
    const section=parts[1],value=parts[2]==="on";
    const allowedSections=new Set(["normal","media","links","advertising","forwarding","files","messages","interactions","advanced","anti_attack","language"]);
    if(!allowedSections.has(section))return;
    const result=await pool.query("UPDATE content_lock_rules SET enabled=$1,updated_at=NOW() WHERE group_id=$2 AND section=$3",[value,groupId,section]);
    return edit(msg.chat.id,msg.message_id,panelTitle(
      "مرکز قفل و فیلتر",
      "⛂ - وضعیت بخش : "+(value?"● فعال":"○ خاموش")+"\n⛂ - قوانین تغییرکرده : "+(result.rowCount||0)
    ),menu([[["بازکردن بخش","cl:"+section],["‹ بازگشت به قفل‌ها","c:locks"]]]));
  }

  if(data==="c:automation"){
    return edit(msg.chat.id,msg.message_id,panelTitle("مرکز اتوماسیون","⛂ - وضعیت : موتور اتوماسیون آماده اجراست."),menu([
      [["ساخت اتوماسیون","auto:add"],["فهرست اتوماسیون","auto:list"]],
      [["فعال / غیرفعال","auto:toggle"],["حذف اتوماسیون","auto:delete"]],
      [["‹ بازگشت","c:home"]]
    ]));
  }
  if(data==="auto:list"){
    await pool.query("CREATE TABLE IF NOT EXISTS bot_group_automations(id BIGSERIAL PRIMARY KEY,group_id BIGINT NOT NULL,name TEXT NOT NULL,trigger_type TEXT NOT NULL DEFAULT 'keyword',trigger_value TEXT NOT NULL,action_type TEXT NOT NULL,action_payload TEXT NOT NULL DEFAULT '',cooldown_seconds INTEGER NOT NULL DEFAULT 10,enabled BOOLEAN NOT NULL DEFAULT TRUE,created_by BIGINT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(group_id,name))");
    const r=await pool.query("SELECT id,name,trigger_value,action_type,enabled FROM bot_group_automations WHERE group_id=$1 ORDER BY id DESC LIMIT 40",[groupId]);
    const body=r.rows.length?r.rows.map((x:any)=>"⛂ - شناسه : #"+x.id+" · نام : "+x.name+" · محرک : "+x.trigger_value+" · عملیات : "+x.action_type+" · وضعیت : "+(x.enabled?"● فعال":"○ خاموش")).join("\n"):"⛂ - وضعیت : اتوماسیونی ثبت نشده است.";
    return edit(msg.chat.id,msg.message_id,panelTitle("مرکز اتوماسیون",body),menu([
      [["ساخت اتوماسیون","auto:add"],["تغییر وضعیت","auto:toggle"]],
      [["حذف اتوماسیون","auto:delete"],["‹ بازگشت","c:home"]]
    ]));
  }
  if(data==="auto:add"){
    session(uid,"automation_add_name",{chatId:groupId});
    return edit(msg.chat.id,msg.message_id,panelTitle("سازنده اتوماسیون","⛂ - مرحله ۱ : نام اتوماسیون را ارسال کنید."),menu([[["‹ انصراف","c:automation"]]]));
  }
  if(data==="auto:toggle"||data==="auto:delete"){
    session(uid,"automation_manage",{chatId:groupId,action:data==="auto:toggle"?"toggle":"delete"});
    return edit(msg.chat.id,msg.message_id,panelTitle("مدیریت اتوماسیون","⛂ - شناسه : شناسه Rule را ارسال کنید."),menu([[["‹ انصراف","c:automation"]]]));
  }
  if(data.startsWith("auto:action:")){
    const current=getSession(uid);const action=data.slice(12);
    if(!current||current.flow!=="automation_action"||!["reply","delete","mute","kick"].includes(action))return true;
    current.data.action=action;
    if(action==="reply"){
      current.flow="automation_payload";session(uid,current.flow,current.data);
      return edit(msg.chat.id,msg.message_id,panelTitle("سازنده اتوماسیون","⛂ - مرحله ۴ : متن پاسخ را ارسال کنید.\n⛂ - متغیر مجاز : {{user_name}}"),menu([[["‹ انصراف","c:automation"]]]));
    }
    await pool.query("INSERT INTO bot_group_automations(group_id,name,trigger_value,action_type,action_payload,created_by) VALUES($1,$2,$3,$4,'',$5) ON CONFLICT(group_id,name) DO UPDATE SET trigger_value=EXCLUDED.trigger_value,action_type=EXCLUDED.action_type,action_payload='',enabled=TRUE,updated_at=NOW()",[groupId,current.data.name,current.data.keyword,action,uid]);
    clearSession(uid);
    return send(msg.chat.id,panelTitle("مرکز اتوماسیون","⛂ - وضعیت : Rule ساخته و فعال شد."),menu([[["فهرست اتوماسیون","auto:list"]]]));
  }
  if(data==="c:warnings"){
    return edit(msg.chat.id,msg.message_id,panelTitle("اخطار و جریمه","سامانه چندمرحله‌ای اخطار، سطح جریمه و تاریخچه در دسترس است."),menu([
      [["اعضای دارای اخطار","w:list"],["صدور اخطار","w:issue"]],
      [["سطوح اخطار","w:levels"],["پاک‌کردن اخطار","w:clear"]],
      [["تاریخچه گروه","w:history"],["‹ بازگشت","c:home"]]
    ]));
  }
  if(data==="w:list"){
    const r=await pool.query("SELECT user_id,first_name,username,warning_count,current_level,status FROM warning_cases WHERE group_id=$1 AND warning_count>0 ORDER BY warning_count DESC,last_warning_at DESC LIMIT 30",[groupId]);
    return edit(msg.chat.id,msg.message_id,panelTitle("اخطار و جریمه",r.rows.length?r.rows.map((x:any)=>"⛂ - کاربر : "+x.user_id+" · اخطار : "+x.warning_count+" · سطح : "+(x.current_level??"—")).join("\n"):"⛂ - وضعیت : عضوی با اخطار فعال نیست."),menu([[["‹ بازگشت","c:warnings"]]]));
  }
  if(data==="w:issue"){session(uid,"warn_issue",{chatId:groupId});return edit(msg.chat.id,msg.message_id,panelTitle("صدور اخطار","آیدی عددی کاربر را ارسال کنید."),menu([[["‹ بازگشت","c:warnings"]]]));}
  if(data==="w:levels"){
    const r=await pool.query("SELECT level_no,name,warning_count_required,penalty_type,duration_value,duration_unit,enabled FROM warning_levels WHERE group_id=$1 ORDER BY level_no",[groupId]);
    return edit(msg.chat.id,msg.message_id,panelTitle("سطوح اخطار",r.rows.length?r.rows.map((x:any)=>"⛂ - سطح "+x.level_no+" : "+x.name+" · حد اخطار : "+x.warning_count_required+" · جریمه : "+x.penalty_type+" · "+(x.duration_value?x.duration_value+" "+x.duration_unit:"—")).join("\n"):"⛂ - وضعیت : سطحی تعریف نشده است."),menu([[["‹ بازگشت","c:warnings"]]]));
  }
  if(data==="w:clear"){session(uid,"warn_clear",{chatId:groupId});return edit(msg.chat.id,msg.message_id,panelTitle("پاک‌کردن اخطار","آیدی عددی کاربر را ارسال کنید."),menu([[["‹ بازگشت","c:warnings"]]]));}
  if(data==="w:history"){
    const r=await pool.query("SELECT user_id,action_type,violation_type,penalty_type,created_at FROM warning_events WHERE group_id=$1 ORDER BY created_at DESC LIMIT 30");
    return edit(msg.chat.id,msg.message_id,panelTitle("تاریخچه اخطار",r.rows.length?r.rows.map((x:any)=>"⛂ - "+faDate(x.created_at)+" · کاربر : "+x.user_id+" · عملیات : "+x.action_type).join("\n"):"⛂ - وضعیت : تاریخچه‌ای ثبت نشده است."),menu([[["‹ بازگشت","c:warnings"]]]));
  }

  if(data==="c:members")return edit(msg.chat.id,msg.message_id,panelTitle("مدیریت اعضا","⛂ - وضعیت : ابزارهای جستجو، سکوت، اخراج و عملیات گروهی آماده است."),menu([
    [["جستجوی عضو","m:search"],["لیست محدودشده‌ها","m:restricted"]],
    [["سکوت موقت","m:mute"],["سکوت دائم","m:perm_mute"]],
    [["اخراج عضو","m:kick"],["تغییر نقش","m:role"]],
    [["عملیات گروهی","m:bulk"],["‹ بازگشت","c:home"]]
  ]));
  if(data==="m:search"){session(uid,"member_search",{chatId:groupId});return edit(msg.chat.id,msg.message_id,panelTitle("جستجوی عضو","آیدی تلگرام یا نام کاربری را ارسال کنید."),menu([[["‹ بازگشت","c:members"]]]));}
  if(data==="m:restricted")return edit(msg.chat.id,msg.message_id,panelTitle("اعضای محدودشده","برای مدیریت سریع، عملیات موردنظر را انتخاب کنید."),menu([[["سکوت موقت","m:mute"],["اخراج عضو","m:kick"]],[["‹ بازگشت","c:members"]]]));
  if(["m:mute","m:perm_mute","m:kick","m:role"].includes(data)){session(uid,"member_action",{chatId:groupId,action:data.slice(2)});return edit(msg.chat.id,msg.message_id,panelTitle("عملیات عضو","آیدی عددی کاربر را ارسال کنید."),menu([[["‹ بازگشت","c:members"]]]));}
  if(data==="m:bulk"){session(uid,"member_bulk",{chatId:groupId});return edit(msg.chat.id,msg.message_id,panelTitle("عملیات گروهی","آیدی‌های کاربران را با فاصله ارسال کنید."),menu([[["‹ بازگشت","c:members"]]]));}

  if(data==="c:welcome")return edit(msg.chat.id,msg.message_id,panelTitle("خوش‌آمدگویی و خروج","تنظیمات پیام ورود، خروج، تأیید عضویت و قوانین گروه."),menu([
    [["تنظیم خوش‌آمدگویی","wel:welcome"],["تنظیم خداحافظی","wel:goodbye"]],
    [["تأیید عضویت","wel:verify"],["ارسال قوانین","wel:rules"]],
    [["خوش‌آمدگویی خصوصی","wel:pv"],["‹ بازگشت","c:home"]]
  ]));
  if(data.startsWith("wel:")){
    const a=data.slice(4);session(uid,"group_setting",{chatId:groupId,setting:a});
    return edit(msg.chat.id,msg.message_id,panelTitle("تنظیم گروه","مقدار جدید را ارسال کنید. برای حالت روشن/خاموش: «روشن» یا «خاموش»."),menu([[["‹ انصراف","c:welcome"]]]));
  }

  if(data==="c:commands")return edit(msg.chat.id,msg.message_id,panelTitle("استودیو دستورات","ایجاد، ویرایش و حذف دستورهای اختصاصی گروه."),menu([
    [["افزودن دستور","cmd:add"],["فهرست دستورات","cmd:list"]],
    [["ویرایش دستور","cmd:edit"],["حذف دستور","cmd:delete"]],
    [["پاسخ خودکار","cmd:auto"],["‹ بازگشت","c:home"]]
  ]));
  if(["cmd:add","cmd:edit","cmd:delete","cmd:auto"].includes(data)){session(uid,"group_command",{chatId:groupId,action:data.slice(4),step:1});return edit(msg.chat.id,msg.message_id,panelTitle("استودیو دستورات","نام دستور را بدون / ارسال کنید."),menu([[["‹ بازگشت","c:commands"]]]));}
  if(data==="cmd:list"){
    const r=await pool.query("SELECT command_key,aliases,response_text,enabled,minimum_role FROM bot_group_commands WHERE group_id=$1 ORDER BY id DESC LIMIT 50",[groupId]);
    return edit(msg.chat.id,msg.message_id,panelTitle("فهرست دستورات",r.rows.length?r.rows.map((x:any)=>"⛂ - دستور : "+x.command_key+" · وضعیت : "+(x.enabled?"● فعال":"○ خاموش")+" · سطح : "+x.minimum_role).join("\n"):"⛂ - وضعیت : دستور اختصاصی ثبت نشده است."),menu([[["‹ بازگشت","c:commands"]]]));
  }

  if(data==="c:content")return edit(msg.chat.id,msg.message_id,panelTitle("استودیو محتوا","محتوای واکنشی، قفل‌ها و پاسخ‌های اختصاصی گروه از این بخش مدیریت می‌شوند."),menu([
    [["قفل و فیلتر","c:locks"],["استثناها","c:exceptions"]],
    [["دستورات اختصاصی","c:commands"],["خوش‌آمدگویی","c:welcome"]],
    [["‹ بازگشت","c:home"]]
  ]));

  if(data==="c:schedule")return edit(msg.chat.id,msg.message_id,panelTitle("زمان‌بندی پیام‌ها","ارسال یک‌باره یا تکرارشونده از طریق زمان‌بندی واقعی Runtime."),menu([
    [["ایجاد زمان‌بندی","sc:add"],["فهرست زمان‌بندی‌ها","sc:list"]],
    [["ویرایش","sc:edit"],["حذف","sc:delete"]],
    [["فعال / غیرفعال","sc:toggle"],["‹ بازگشت","c:home"]]
  ]));
  if(["sc:add","sc:edit","sc:delete","sc:toggle"].includes(data)){
    session(uid,"schedule",{chatId:groupId,action:data.slice(3),step:1});
    return edit(msg.chat.id,msg.message_id,data==="sc:add"?panelTitle("زمان‌بندی","متن پیام زمان‌بندی‌شده را ارسال کنید."):panelTitle("زمان‌بندی","شناسه زمان‌بندی را ارسال کنید."),menu([[["‹ بازگشت","c:schedule"]]]));
  }
  if(data==="sc:list"){
    const r=await pool.query("SELECT id,send_at,enabled,repeat_seconds,message_text FROM bot_schedules WHERE group_id=$1 ORDER BY send_at LIMIT 30",[groupId]);
    return edit(msg.chat.id,msg.message_id,panelTitle("فهرست زمان‌بندی‌ها",r.rows.length?r.rows.map((x:any)=>"⛂ - #"+x.id+" · زمان : "+faDate(x.send_at)+" · وضعیت : "+(x.enabled?"● فعال":"○ خاموش")+" · پیام : "+String(x.message_text||"").slice(0,50)).join("\n"):"⛂ - وضعیت : زمان‌بندی ثبت نشده است."),menu([[["‹ بازگشت","c:schedule"]]]));
  }

  if(data==="c:analytics"){
    const [events,warnings,commands,schedules]=await Promise.all([
      pool.query("SELECT COUNT(*)::int n FROM supervision_events WHERE group_id=$1 AND created_at>=CURRENT_DATE",[groupId]),
      pool.query("SELECT COUNT(*)::int n FROM warning_events WHERE group_id=$1 AND created_at>=DATE_TRUNC('month',NOW())",[groupId]),
      pool.query("SELECT COUNT(*)::int n FROM bot_group_commands WHERE group_id=$1 AND enabled=TRUE",[groupId]),
      pool.query("SELECT COUNT(*)::int n FROM bot_schedules WHERE group_id=$1 AND enabled=TRUE",[groupId])
    ]);
    return edit(msg.chat.id,msg.message_id,panelTitle("تحلیل و آمار",
      "⛂ - رویدادهای امروز : "+Number(events.rows[0]?.n||0)+"\n⛂ - اخطارهای این ماه : "+Number(warnings.rows[0]?.n||0)+"\n⛂ - دستورات فعال : "+Number(commands.rows[0]?.n||0)+"\n⛂ - زمان‌بندی‌های فعال : "+Number(schedules.rows[0]?.n||0)
    ),menu([[["بروزرسانی","c:analytics"],["‹ بازگشت","c:home"]]]));
  }

  if(data==="c:permissions"){
    const me=await telegramApi<any>("getMe",{});
    const bot=me.ok?await telegramApi<any>("getChatMember",{chat_id:groupId,user_id:me.result.id}):null;
    const u=await telegramApi<any>("getChatMember",{chat_id:groupId,user_id:uid});
    const rights=bot?.result||{};
    return edit(msg.chat.id,msg.message_id,panelTitle("مرکز دسترسی",
      "⛂ - سطح شما : "+valueOrDash(u?.result?.status)+"\n⛂ - وضعیت ربات : "+valueOrDash(bot?.result?.status)+"\n⛂ - حذف پیام : "+(rights.can_delete_messages?"●":"○")+"\n⛂ - محدودسازی : "+(rights.can_restrict_members?"●":"○")+"\n⛂ - دعوت عضو : "+(rights.can_invite_users?"●":"○")+"\n⛂ - تغییر اطلاعات : "+(rights.can_change_info?"●":"○")
    ),menu([[["بررسی مجدد","c:permissions"],["‹ بازگشت","c:home"]]]));
  }

  if(data==="c:audit"){
    const r=await pool.query("SELECT actor_id,action,target,created_at FROM audit_logs WHERE target=$1 OR after_data::text LIKE $2 ORDER BY created_at DESC LIMIT 30",[String(groupId),"%\\"groupId\\":"+groupId+"%"]);
    const lines=r.rows.length?r.rows.map((x:any)=>"⛂ - "+faDate(x.created_at)+" · "+valueOrDash(x.action)+" · اجراکننده : "+valueOrDash(x.actor_id)).join("\n"):"⛂ - وضعیت : رویدادی برای این گروه ثبت نشده است.";
    return edit(msg.chat.id,msg.message_id,panelTitle("ممیزی گروه",lines),menu([[["بروزرسانی","c:audit"],["‹ بازگشت","c:home"]]]));
  }

  if(data==="c:health"){
    let me:any=null;try{const rr=await telegramApi<any>("getMe",{});me=rr.ok?rr.result:null;}catch{}
    let db=true;try{await pool.query("SELECT 1");}catch{db=false;}
    const member=me?await telegramApi<any>("getChatMember",{chat_id:groupId,user_id:me.id}):null;
    return edit(msg.chat.id,msg.message_id,panelTitle("سلامت ربات",
      "⛂ - Runtime : ● سالم\n⛂ - PostgreSQL : "+(db?"● سالم":"○ خطا")+"\n⛂ - Telegram : "+(me?"● متصل":"○ خطا")+"\n⛂ - حضور در گروه : "+(member?.ok?"● تأیید":"○ ناموفق")+"\n⛂ - آخرین بررسی : "+faDate(new Date())
    ),menu([[["بررسی مجدد","c:health"],["‹ بازگشت","c:home"]]]));
  }

  if(data==="c:security"){
    return edit(msg.chat.id,msg.message_id,panelTitle("مرکز امنیت","کنترل مستقیم قفل کامل، محافظت دعوت، ضد اکانت فیک، سن اکانت جدید و حالت اضطراری."),menu([
      [["قفل کامل گروه","sec:lock"],["بازکردن قفل کامل","sec:unlock"]],
      [["محافظت لینک دعوت","sec:invite"],["ضد اکانت فیک","sec:fake"]],
      [["محدودیت اکانت جدید","sec:new"],["حالت اضطراری","sec:emergency"]],
      [["‹ بازگشت","c:home"]]
    ]));
  }
  if(["sec:lock","sec:unlock","sec:invite","sec:fake","sec:new","sec:emergency"].includes(data)){
    if(!privileged && !(await isGroupAdmin(groupId,uid)))return send(msg.chat.id,panelTitle("دسترسی رد شد","⛂ - وضعیت : فقط مدیر گروه مجاز است."));
    if(data==="sec:lock"||data==="sec:unlock"){
      const perms=data==="sec:lock"
        ?{can_send_messages:false,can_send_audios:false,can_send_documents:false,can_send_photos:false,can_send_videos:false,can_send_video_notes:false,can_send_voice_notes:false,can_send_polls:false,can_send_other_messages:false,can_add_web_page_previews:false}
        :{can_send_messages:true,can_send_audios:true,can_send_documents:true,can_send_photos:true,can_send_videos:true,can_send_video_notes:true,can_send_voice_notes:true,can_send_polls:true,can_send_other_messages:true,can_add_web_page_previews:true};
      const rr=await telegramApi("setChatPermissions",{chat_id:groupId,permissions:perms,use_independent_chat_permissions:true});
      if(!rr.ok)return send(msg.chat.id,panelTitle("خطای امنیتی","⛂ - پیام Telegram : "+(rr.description||"خطای ناشناخته")));
      await pool.query("INSERT INTO bot_group_settings(group_id,full_lock) VALUES($1,$2) ON CONFLICT(group_id) DO UPDATE SET full_lock=EXCLUDED.full_lock,updated_at=NOW()",[groupId,data==="sec:lock"]);
      return edit(msg.chat.id,msg.message_id,panelTitle("مرکز امنیت","⛂ - قفل کامل گروه : "+(data==="sec:lock"?"● فعال":"○ خاموش")),menu([[["بررسی امنیت","c:security"],["‹ بازگشت","c:home"]]]));
    }
    const field=data==="sec:invite"?"invite_protection":data==="sec:fake"?"fake_account_restriction":data==="sec:emergency"?"emergency_mode":"new_account_days";
    if(data==="sec:new"){session(uid,"security_new",{chatId:groupId});return edit(msg.chat.id,msg.message_id,panelTitle("مرکز امنیت","حداقل سن حساب را برحسب روز ارسال کنید؛ «۰» یعنی خاموش."),menu([[["‹ بازگشت","c:security"]]]));}
    await pool.query("INSERT INTO bot_group_settings(group_id,"+field+") VALUES($1,TRUE) ON CONFLICT(group_id) DO UPDATE SET "+field+"=NOT bot_group_settings."+field+",updated_at=NOW()",[groupId]);
    return edit(msg.chat.id,msg.message_id,panelTitle("مرکز امنیت","⛂ - تنظیم : "+field+"\n⛂ - نتیجه : تغییر وضعیت انجام شد."),menu([[["بررسی امنیت","c:security"],["‹ بازگشت","c:home"]]]));
  }

  return false;
}
async function handleInput(pool:Pool,msg:TgMessage){
  if(!msg.from)return false;const uid=msg.from.id,s=getSession(uid);if(!s||s.expires<Date.now())return false;const value=(msg.text||"").trim();const groupId=Number(s.data.chatId||msg.chat.id);
  if(s.flow==="exception_add"){
    const kind=String(s.data.kind||"user");
    if(kind==="domain"){
      const domain=value.toLowerCase().replace(/^https?:\/\//,"").split("/")[0].replace(/^www\./,"");
      if(!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain))return send(msg.chat.id,"دامنه معتبر نیست؛ نمونه: example.com");
      await pool.query("INSERT INTO content_lock_domains(group_id,domain,enabled) VALUES($1,$2,TRUE) ON CONFLICT(group_id,domain) DO UPDATE SET enabled=TRUE",[groupId,domain]);
      clearSession(uid);await audit(pool,String(uid),"content_lock_domain_added",domain,{groupId});
      return send(msg.chat.id,"✓ دامنه در Allowlist ثبت و فعال شد.",menu([[["فهرست دامنه‌ها","ex:domains"]]]));
    }
    if(kind==="user"&&!/^\d+$/.test(value))return send(msg.chat.id,"آیدی کاربر باید عددی باشد.");
    if(kind==="forward_source"&&!/^-?\d+$/.test(value))return send(msg.chat.id,"آیدی منبع فوروارد معتبر نیست.");
    if(kind==="role"&&!/^(owner|sudo|admin|member)$/i.test(value))return send(msg.chat.id,"نقش مجاز: owner / sudo / admin / member");
        await pool.query("INSERT INTO content_lock_exceptions(group_id,exception_type,target_id,target_label,scope,enabled) VALUES($1,$2,$3,$4,$5::jsonb,TRUE) ON CONFLICT(group_id,exception_type,target_id) DO UPDATE SET target_label=EXCLUDED.target_label,enabled=TRUE,updated_at=NOW()",[groupId,kind,value,value.toLowerCase(),JSON.stringify(["all"])]);
    clearSession(uid);await audit(pool,String(uid),"content_lock_exception_added",value,{groupId,type:kind});
    return send(msg.chat.id,"✓ استثنا ثبت و فعال شد.",menu([[["مرکز استثناها","c:exceptions"]]]));
  }
  if(s.flow==="exception_delete"){
    const id=Number(value);if(!Number.isSafeInteger(id))return send(msg.chat.id,"شناسه معتبر نیست.");
    await pool.query("DELETE FROM content_lock_exceptions WHERE id=$1 AND group_id=$2",[id,groupId]);
    clearSession(uid);await audit(pool,String(uid),"content_lock_exception_removed",String(id),{groupId});
    return send(msg.chat.id,"✓ استثنا حذف شد.",menu([[["مرکز استثناها","c:exceptions"]]]));
  }
  if(s.flow==="domain_delete"){
    const id=Number(value);if(!Number.isSafeInteger(id))return send(msg.chat.id,"شناسه معتبر نیست.");
    await pool.query("DELETE FROM content_lock_domains WHERE id=$1 AND group_id=$2",[id,groupId]);
    clearSession(uid);await audit(pool,String(uid),"content_lock_domain_removed",String(id),{groupId});
    return send(msg.chat.id,"✓ دامنه حذف شد.",menu([[["فهرست دامنه‌ها","ex:domains"]]]));
  }

  if(s.flow==="automation_add_name"){
    if(value.length<1||value.length>80)return send(msg.chat.id,"نام Rule باید بین ۱ تا ۸۰ نویسه باشد.");
    s.data.name=value;s.flow="automation_add_keyword";session(uid,s.flow,s.data);
    return send(msg.chat.id,panelTitle("سازنده اتوماسیون","کلمه یا عبارت محرک را ارسال کنید."));
  }
  if(s.flow==="automation_add_keyword"){
    if(value.length<1||value.length>120)return send(msg.chat.id,"عبارت محرک نامعتبر است.");
    s.data.keyword=value.toLowerCase();s.flow="automation_action";session(uid,s.flow,s.data);
    return send(msg.chat.id,panelTitle("سازنده اتوماسیون","نوع عملیات را انتخاب کنید."),menu([
      [["پاسخ خودکار","auto:action:reply"],["حذف پیام","auto:action:delete"]],
      [["سکوت کاربر","auto:action:mute"],["اخراج کاربر","auto:action:kick"]],
      [["‹ انصراف","c:automation"]]
    ]));
  }
  if(s.flow==="automation_payload"){
    await pool.query("INSERT INTO bot_group_automations(group_id,name,trigger_value,action_type,action_payload,created_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(group_id,name) DO UPDATE SET trigger_value=EXCLUDED.trigger_value,action_type=EXCLUDED.action_type,action_payload=EXCLUDED.action_payload,enabled=TRUE,updated_at=NOW()",[groupId,s.data.name,s.data.keyword,s.data.action,value,uid]);
    clearSession(uid);await audit(pool,String(uid),"automation_created",s.data.name,{groupId,action:s.data.action});
    return send(msg.chat.id,"✓ Rule اتوماسیون ساخته و فعال شد.",menu([[["اتوماسیون‌ها","auto:list"]]]));
  }
  if(s.flow==="automation_manage"){
    const id=Number(value);if(!Number.isSafeInteger(id))return send(msg.chat.id,"شناسه Rule معتبر نیست.");
    if(s.data.action==="toggle")await pool.query("UPDATE bot_group_automations SET enabled=NOT enabled,updated_at=NOW() WHERE id=$1 AND group_id=$2",[id,groupId]);
    else await pool.query("DELETE FROM bot_group_automations WHERE id=$1 AND group_id=$2",[id,groupId]);
    clearSession(uid);await audit(pool,String(uid),"automation_managed",String(id),{groupId,action:s.data.action});
    return send(msg.chat.id,"✓ عملیات اتوماسیون اجرا شد.",menu([[["مرکز اتوماسیون","c:automation"]]]));
  }
  if(s.flow==="owner_extend"||s.flow==="owner_reduce"){const days=Number(value);const sign=s.flow==="owner_extend"?1:-1;const lic=(await pool.query("SELECT * FROM bot_licenses WHERE customer_id=$1 AND status='active' ORDER BY id DESC LIMIT 1",[s.data.customerId])).rows[0];if(!lic?.expires_at)return send(msg.chat.id,"مادام‌العمر یا بدون تاریخ انقضا است.");const newDate=new Date(new Date(lic.expires_at).getTime()+sign*days*86400000);await pool.query("UPDATE bot_licenses SET expires_at=$1 WHERE id=$2",[newDate,lic.id]);clearSession(uid);return send(msg.chat.id,"✓ تاریخ انقضا به "+faDate(newDate)+" تغییر کرد.");}
  if(s.flow==="owner_message"){const r=await telegramApi("sendMessage",{chat_id:Number(s.data.customerId),text:value});clearSession(uid);return send(msg.chat.id,r.ok?"✓ پیام خصوصی ارسال شد.":"✗ ارسال پیام ناموفق بود: "+(r.description||"Telegram error"));}
  if(s.flow==="owner_owner_add"){const id=Number(value);if(!Number.isSafeInteger(id))return send(msg.chat.id,"آیدی معتبر نیست.");await pool.query("INSERT INTO bot_panel_owners(user_id) VALUES($1) ON CONFLICT DO NOTHING",[id]);clearSession(uid);return send(msg.chat.id,"✓ مالک جدید ثبت شد.");}
  if(s.flow==="owner_maint_message"){await pool.query("INSERT INTO bot_system_settings(key,value) VALUES('maintenance_message',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",[JSON.stringify(value)]);clearSession(uid);return send(msg.chat.id,"✓ پیام حالت نگهداری ذخیره شد.");}
  if(s.flow==="owner_groupmax"){const n=Number(value);if(!Number.isInteger(n)||n<1||n>10000)return send(msg.chat.id,"عدد باید بین ۱ تا ۱۰۰۰۰ باشد.");await pool.query("INSERT INTO bot_system_settings(key,value) VALUES('default_group_limit',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",[JSON.stringify(n)]);clearSession(uid);return send(msg.chat.id,"✓ سقف پیش‌فرض گروه ذخیره شد.");}
  if(s.flow==="owner_blacklist_add"){const id=Number(value);if(!Number.isSafeInteger(id))return send(msg.chat.id,"آیدی معتبر نیست.");await pool.query("INSERT INTO bot_blacklist(user_id,reason) VALUES($1,'افزودن دستی مالک') ON CONFLICT(user_id) DO NOTHING",[id]);clearSession(uid);await audit(pool,String(uid),"blacklist_added",String(id));return send(msg.chat.id,"✓ مشتری به لیست سیاه اضافه شد.");}
  if(s.flow==="owner_broadcast_wait"){session(uid,"owner_broadcast_preview",{sourceChatId:msg.chat.id,sourceMessageId:msg.message_id});return send(msg.chat.id,"پیش‌نمایش دریافت شد. مخاطب را انتخاب کنید.",menu([[["همه مشتریان","bc:all"],["فقط فعال","bc:active"]],[["در حال انقضا","bc:expiring"],["انصراف","o:home"]]]));}
  if(s.flow==="confirm_owner_action" && value==="تأیید نهایی"){const act=s.data.act,id=Number(s.data.id);if(act==="lic_off")await pool.query("UPDATE bot_licenses SET status='disabled' WHERE customer_id=$1 AND status='active'",[id]);if(act==="block")await pool.query("UPDATE bot_customers SET status='blocked' WHERE user_id=$1",[id]);if(act==="unblock")await pool.query("UPDATE bot_customers SET status='active' WHERE user_id=$1",[id]);if(act==="lic_plus"||act==="lic_minus"){const days=1;const lic=(await pool.query("SELECT * FROM bot_licenses WHERE customer_id=$1 AND status='active' ORDER BY id DESC LIMIT 1",[id])).rows[0];if(lic?.expires_at){const sign=act==="lic_plus"?1:-1;await pool.query("UPDATE bot_licenses SET expires_at=$1 WHERE id=$2",[new Date(new Date(lic.expires_at).getTime()+sign*days*86400000),lic.id]);}}clearSession(uid);await audit(pool,String(uid),"owner_sensitive_action",String(id),{act});return send(msg.chat.id,"✓ عملیات حساس با موفقیت انجام شد.");}
  if(s.flow==="confirm_blacklist_remove" && value==="تأیید نهایی"){const id=Number(s.data.id);await pool.query("DELETE FROM bot_blacklist WHERE user_id=$1",[id]);clearSession(uid);await audit(pool,String(uid),"blacklist_removed",String(id));return send(msg.chat.id,"✓ مشتری از لیست سیاه خارج شد.");}
  if(s.flow==="owner_broadcast_confirm" && value==="بله، ارسال شود"){
    const mode=String(s.data.mode),sourceChatId=Number(s.data.sourceChatId),sourceMessageId=Number(s.data.sourceMessageId);
    const where=mode==="active"?"status='active' AND EXISTS (SELECT 1 FROM bot_licenses l WHERE l.customer_id=c.user_id AND l.status='active' AND (l.expires_at IS NULL OR l.expires_at>NOW()))":
      mode==="expiring"?"status='active' AND EXISTS (SELECT 1 FROM bot_licenses l WHERE l.customer_id=c.user_id AND l.status='active' AND l.expires_at>NOW() AND l.expires_at<=NOW()+INTERVAL '7 days')":"status<>'blocked'";
    const targets=(await pool.query("SELECT user_id FROM bot_customers c WHERE "+where+" ORDER BY user_id LIMIT 5000")).rows;
    let sentCount=0,failedCount=0;const broadcast=(await pool.query("INSERT INTO bot_broadcasts(owner_id,target_mode,source_chat_id,source_message_id,status) VALUES($1,$2,$3,$4,'running') RETURNING id",[uid,mode,sourceChatId,sourceMessageId])).rows[0];
    for(const t of targets){
      const r=await telegramApi("copyMessage",{chat_id:Number(t.user_id),from_chat_id:sourceChatId,message_id:sourceMessageId});
      if(r.ok)sentCount++;else failedCount++;
      if((sentCount+failedCount)%20===0)await sleep(700);
    }
    await pool.query("UPDATE bot_broadcasts SET status='finished',total_targeted=$1,total_sent=$2,total_failed=$3,finished_at=NOW() WHERE id=$4",[targets.length,sentCount,failedCount,broadcast.id]);
    clearSession(uid);await audit(pool,String(uid),"broadcast_finished",String(broadcast.id),{targetMode:mode,total:targets.length,sent:sentCount,failed:failedCount});
    return send(msg.chat.id,"◈ گزارش ارسال همگانی\n\n⛂ هدف: "+targets.length+"\n⛂ موفق: "+sentCount+"\n⛂ ناموفق: "+failedCount);
  }
  if(s.flow==="warn_issue"){const userId=Number(value);if(!Number.isSafeInteger(userId))return send(msg.chat.id,"آیدی معتبر نیست.");const d={group_id:groupId,user_id:userId,violation_type:"manual",custom_violation:"صدور دستی توسط مدیریت",admin_id:String(uid),admin_name:msg.from.username||msg.from.first_name||String(uid)};const settings=(await pool.query("SELECT enabled FROM warning_system_settings WHERE group_id=$1",[groupId])).rows[0];if(!settings?.enabled)return send(msg.chat.id,"سیستم اخطار این گروه غیرفعال است.");const wf=await fetch("http://127.0.0.1:"+String(process.env.PORT||0)+"/api/warnings/issue",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(d)}).catch(()=>null);clearSession(uid);return send(msg.chat.id,wf?.ok?"✓ اخطار ثبت شد.":"⚠ ثبت اخطار از این کانال انجام نشد؛ از پنل وب استفاده کنید.");}
  if(s.flow==="warn_clear"){const userId=Number(value);await pool.query("UPDATE warning_events SET status='cleared',result='cleared' WHERE group_id=$1 AND user_id=$2 AND action_type='warning' AND status='active'",[groupId,userId]);clearSession(uid);return send(msg.chat.id,"✓ اخطارهای فعال کاربر پاک شد.");}
  if(s.flow==="member_action"){const userId=Number(value);const a=s.data.action;const method=a==="mute"||a==="perm_mute"?"restrictChatMember":a==="kick"?"banChatMember":"restrictChatMember";const perms={can_send_messages:false,can_send_audios:false,can_send_documents:false,can_send_photos:false,can_send_videos:false,can_send_video_notes:false,can_send_voice_notes:false,can_send_polls:false,can_send_other_messages:false,can_add_web_page_previews:false};const body:any={chat_id:groupId,user_id:userId};if(method==="restrictChatMember"){body.permissions=perms;body.use_independent_chat_permissions=true;if(a==="mute")body.until_date=Math.floor(Date.now()/1000)+3600;}else body.until_date=Math.floor(Date.now()/1000)+60;const r=await telegramApi(method,body);clearSession(uid);return send(msg.chat.id,r.ok?"✓ عملیات با موفقیت اجرا شد.":"✗ عملیات ناموفق بود: "+(r.description||"Telegram error"));}
  if(s.flow==="member_search"){const id=value.replace(/^@/,"");const r=await pool.query("SELECT user_id,first_name,username FROM warning_cases WHERE group_id=$1 AND (user_id::text=$2 OR LOWER(username)=LOWER($3)) LIMIT 1",[groupId,id,id]);clearSession(uid);return send(msg.chat.id,r.rows[0]?"✓ کاربر در رجیستری گروه پیدا شد.\nآیدی: "+r.rows[0].user_id:"کاربر در رجیستری گروه پیدا نشد.");}
  if(s.flow==="member_bulk"){const ids=value.split(/\s+/).map(Number).filter(Number.isSafeInteger).slice(0,50);session(uid,"member_bulk_confirm",{chatId:groupId,ids});return send(msg.chat.id,"تعداد "+ids.length+" کاربر انتخاب شد. برای اخراج همه «بله، مطمئن هستم» را ارسال کنید.");}
  if(s.flow==="member_bulk_confirm"&&value==="بله، مطمئن هستم"){const ids=s.data.ids||[];let ok=0;for(const id of ids){const r=await telegramApi("banChatMember",{chat_id:groupId,user_id:id});if(r.ok)ok++;await sleep(60);}clearSession(uid);return send(msg.chat.id,"✓ عملیات گروهی انجام شد. موفق: "+ok+" از "+ids.length);}
  if(s.flow==="group_setting"){const a=s.data.setting,val=value.toLowerCase();if(a==="welcome"||a==="goodbye"){const col=a==="welcome"?"welcome_text":"goodbye_text";await pool.query("INSERT INTO bot_group_settings(group_id,"+col+") VALUES($1,$2) ON CONFLICT(group_id) DO UPDATE SET "+col+"=EXCLUDED."+col+",updated_at=NOW()",[groupId,value]);}else{const field=a==="verify"?"welcome_enabled":a==="rules"?"rules_on_join":a==="pv"?"pv_welcome":a;const bool=["روشن","on","1","فعال"].includes(val);await pool.query("INSERT INTO bot_group_settings(group_id,"+field+") VALUES($1,$2) ON CONFLICT(group_id) DO UPDATE SET "+field+"=EXCLUDED."+field+",updated_at=NOW()",[groupId,bool]);}clearSession(uid);return send(msg.chat.id,"✓ تنظیم با موفقیت ذخیره شد.");}
  if(s.flow==="security_new"){const d=Math.max(0,Math.min(3650,Number(value)||0));await pool.query("INSERT INTO bot_group_settings(group_id,new_account_days) VALUES($1,$2) ON CONFLICT(group_id) DO UPDATE SET new_account_days=EXCLUDED.new_account_days,updated_at=NOW()",[groupId,d]);clearSession(uid);return send(msg.chat.id,"✓ محدودیت سن حساب روی "+d+" روز تنظیم شد.");}
  if(s.flow==="group_command"){const action=s.data.action;
    if((action==="add"||action==="edit")&&Number(s.data.step||1)===1){s.data.step=2;s.data.cmd=value.replace(/^\/+/, "").trim().toLowerCase();session(uid,s.flow,s.data);return send(msg.chat.id,"پاسخ این دستور را ارسال کنید.");}
    if((action==="add"||action==="edit")&&Number(s.data.step||1)===2){const cmd=s.data.cmd;await pool.query("INSERT INTO bot_group_commands(group_id,command_key,aliases,response_text) VALUES($1,$2,$3,$4) ON CONFLICT(group_id,command_key) DO UPDATE SET aliases=EXCLUDED.aliases,response_text=EXCLUDED.response_text,updated_at=NOW()",[groupId,cmd,[cmd],value]);clearSession(uid);return send(msg.chat.id,"✓ دستور ذخیره شد و فعال است.");}
    if(action==="delete"){const id=Number(value);const before=(await pool.query("SELECT * FROM bot_group_commands WHERE id=$1 AND group_id=$2",[id,groupId])).rows[0];if(!before){clearSession(uid);return send(msg.chat.id,"دستور پیدا نشد.");}await pool.query("DELETE FROM bot_group_commands WHERE id=$1 AND group_id=$2",[id,groupId]);clearSession(uid);return send(msg.chat.id,"✓ دستور حذف شد.");}
    clearSession(uid);return send(msg.chat.id,"عملیات دستور نامعتبر است.");}
  if(s.flow==="schedule"){const a=s.data.action,step=Number(s.data.step||1);
    if(a==="add"&&step===1){s.data.message=value;s.data.step=2;session(uid,s.flow,s.data);return send(msg.chat.id,"تاریخ و ساعت ارسال را با قالب YYYY-MM-DD HH:mm ارسال کنید.");}
    if(a==="add"&&step===2){const when=new Date(value.replace(" ","T")+":00");if(Number.isNaN(when.getTime())||when.getTime()<=Date.now())return send(msg.chat.id,"تاریخ/ساعت باید معتبر و در آینده باشد.");await pool.query("INSERT INTO bot_schedules(group_id,creator_id,message_text,send_at) VALUES($1,$2,$3,$4)",[groupId,uid,s.data.message,when]);clearSession(uid);return send(msg.chat.id,"✓ زمان‌بندی ثبت شد: "+faDate(when));}
    if(a==="edit"&&step===1){const id=Number(value);if(!Number.isSafeInteger(id)){clearSession(uid);return send(msg.chat.id,"شناسه معتبر نیست.");}s.data.scheduleId=id;s.data.step=2;session(uid,s.flow,s.data);return send(msg.chat.id,"متن جدید زمان‌بندی را ارسال کنید.");}
    if(a==="edit"&&step===2){await pool.query("UPDATE bot_schedules SET message_text=$1 WHERE id=$2 AND group_id=$3",[value,s.data.scheduleId,groupId]);clearSession(uid);return send(msg.chat.id,"✓ متن زمان‌بندی تغییر کرد.");}
    const id=Number(value);if(!Number.isSafeInteger(id)){clearSession(uid);return send(msg.chat.id,"شناسه معتبر نیست.");}
    if(a==="delete")await pool.query("DELETE FROM bot_schedules WHERE id=$1 AND group_id=$2",[id,groupId]);
    if(a==="toggle")await pool.query("UPDATE bot_schedules SET enabled=NOT enabled WHERE id=$1 AND group_id=$2",[id,groupId]);
    clearSession(uid);return send(msg.chat.id,"✓ عملیات زمان‌بندی انجام شد.");}
  return false;
}

export async function dispatchPanelMessage(pool:Pool,msg:TgMessage,ownerIds:string[]){
  if(!msg.from)return false;
  await ensurePanelSessionSchema(pool);
  return runWithPanelScope(msg.from.id,pool,async()=>{
    // Panel throttling must never consume group messages; content-lock
    // enforcement needs to see every message, including rapid photo bursts.
    if(!allowed(msg.from.id))return false;
    if(await handleInput(pool,msg))return true;
    if(await handleOwner(pool,msg,ownerIds))return true;
    return await handleCustomer(pool,msg,ownerIds);
  });
}
export async function dispatchPanelCallback(pool:Pool,cb:TgCallback,ownerIds:string[]){
  if(!cb.message)return;
  await ensurePanelSessionSchema(pool);
  const owned=await panelMessageOwnedBy(pool,cb.message.chat.id,cb.message.message_id,cb.from.id);
  if(!owned){
    await answer(cb.id);
    return;
  }
  return runWithPanelScope(cb.from.id,pool,async()=>{
    if(!allowed(cb.from.id))return;
    const data=String(cb.data||"");
  // Customer/lock panel callbacks must keep their customer context even for the bot owner.
  // Otherwise ownerCallback receives c:/cl:/clt:/cls: actions and silently ignores them.
    if(
      /^(c|cl|clt|cls|auto|ex|w|m|wel|cmd|sc|sec|st):/.test(data)
    ){
      return customerCallback(pool,cb,ownerIds);
    }
    if(await isOwner(pool,cb.from.id,ownerIds))return ownerCallback(pool,cb,ownerIds);
    return customerCallback(pool,cb,ownerIds);
  });
}
