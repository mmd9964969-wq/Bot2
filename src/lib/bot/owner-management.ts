import os from "node:os";
import type { Pool } from "pg";
import { telegramApi } from "../telegram/api.ts";
import { prepareRichDocument, validateRichDocument } from "./rich-message.ts";
import { glassKeyboard, styledGlassButton } from "./panel-design.ts";
import { bindPanelMessage, touchPanelMessage } from "./panel-session.ts";
import { isRuntimeMaintenance, executeRuntimeAction } from "../../../bot/runtime-control.ts";

type TgMessage={message_id?:number;chat:{id:number;type:string;title?:string;username?:string};from?:{id:number};text?:string;caption?:string};
type TgCallback={id:string;from:{id:number};message?:TgMessage;data?:string};

const flows=new Map<number,{kind:string;expires:number;data:Record<string,any>}>();
const BTN=(text:string,data:string)=>({text,callback_data:data});
const BACK=(data:string)=>styledGlassButton("‹ بازگشت",data,"primary");
const ON=(text:string,data:string)=>styledGlassButton(text,data,"success");
const OFF=(text:string,data:string)=>styledGlassButton(text,data,"danger");

function startFlow(uid:number,kind:string,data:Record<string,any>={}){flows.set(uid,{kind,expires:Date.now()+10*60*1000,data});}
function getFlow(uid:number){const x=flows.get(uid);if(!x)return null;if(x.expires<Date.now()){flows.delete(uid);return null;}return x;}
function clearFlow(uid:number){flows.delete(uid);}
function kb(rows:any[][]){return glassKeyboard(rows);}
function num(v:unknown){const x=Number(v);return Number.isFinite(x)?x:0;}
function dateFa(v:unknown){if(v==null||String(v)==="")return "ثبت نشده";const d=new Date(String(v));if(Number.isNaN(d.getTime()))return "ثبت نشده";return new Intl.DateTimeFormat("fa-IR",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Tehran"}).format(d);}
function statusFa(v:unknown){const s=String(v??"").toUpperCase();if(["ACTIVE","RUNNING","ONLINE","OPEN","INSTALLED","ENABLED"].includes(s))return "فعال";if(["DISABLED","STOPPED","BLOCKED","EXPIRED","CANCELLED","CLOSED"].includes(s))return "غیرفعال";if(["PENDING","INSTALLING","BUILDING","DEPLOYING","IN_PROGRESS","WAITING"].includes(s))return "در حال پردازش";if(["FAILED","ERROR","CRASHED"].includes(s))return "خطادار";return String(v??"ثبت نشده");}
function table(caption:string,rows:Array<[string,string]>){return {type:"table",caption,is_bordered:true,is_striped:false,is_compact:true,cells:[[{text:"عنوان",is_header:true,align:"right",valign:"middle"},{text:"مقدار",is_header:true,align:"right",valign:"middle"}],...rows.map(function(r){return [{text:r[0],align:"right",valign:"middle"},{text:r[1],align:"right",valign:"middle"}]})]};}
function rich(title:string,blocks:any[]){return {version:1,is_rtl:true,blocks:[{type:"heading",text:"Pᴇʀsɪᴀɴ ᴮᵒᵗ · "+title,size:1},{type:"divider"},...blocks,{type:"footer",text:"Pᴇʀsɪᴀɴ ᴮᵒᵗ · Pᴏᴡɴᴇʀ Cᴇɴᴛᴇʀ"}]};}
async function edit(pool:Pool,uid:number,chatId:number,messageId:number,doc:any,markup:any){
  const p=prepareRichDocument(doc),v=validateRichDocument(p);if(!v.ok){console.error("[owner-management]",v.errors);return null;}
  const r=await telegramApi("editMessageText",{chat_id:chatId,message_id:messageId,rich_message:{blocks:p.blocks,is_rtl:true},reply_markup:markup}).catch(function(){return null});
  if(r?.ok)await touchPanelMessage(pool,chatId,messageId,uid).catch(function(){});
  return r;
}
async function audit(pool:Pool,actor:string,action:string,target:string,meta:any={}){
  await pool.query("INSERT INTO audit_logs(actor_id,action,target,after_data,source) VALUES($1,$2,$3,$4::jsonb,'owner_center')",[actor,action,target,JSON.stringify(meta)]).catch(function(){});
}
export async function ensureOwnerManagementSchema(pool:Pool){
  await pool.query("CREATE TABLE IF NOT EXISTS owner_services(id BIGSERIAL PRIMARY KEY,service_key TEXT UNIQUE NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',version TEXT NOT NULL DEFAULT '1.0.0',status TEXT NOT NULL DEFAULT 'ACTIVE',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS owner_requests(id BIGSERIAL PRIMARY KEY,requester_id BIGINT,customer_id BIGINT,group_id BIGINT,type TEXT NOT NULL,subject TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',priority TEXT NOT NULL DEFAULT 'NORMAL',status TEXT NOT NULL DEFAULT 'OPEN',assignee_id BIGINT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),closed_at TIMESTAMPTZ)");
  await pool.query("CREATE TABLE IF NOT EXISTS owner_support_tickets(id BIGSERIAL PRIMARY KEY,customer_id BIGINT,requester_id BIGINT,category TEXT NOT NULL DEFAULT 'general',subject TEXT NOT NULL,message TEXT NOT NULL,priority TEXT NOT NULL DEFAULT 'NORMAL',status TEXT NOT NULL DEFAULT 'OPEN',assignee_id BIGINT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),resolved_at TIMESTAMPTZ)");
  await pool.query("CREATE TABLE IF NOT EXISTS owner_financial_ledger(id BIGSERIAL PRIMARY KEY,customer_id BIGINT,type TEXT NOT NULL,amount NUMERIC(18,2) NOT NULL,currency TEXT NOT NULL DEFAULT 'IRR',description TEXT NOT NULL DEFAULT '',actor_id BIGINT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE INDEX IF NOT EXISTS owner_requests_status_idx ON owner_requests(status,created_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS owner_support_status_idx ON owner_support_tickets(status,created_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS owner_finance_created_idx ON owner_financial_ledger(created_at DESC)");
  await pool.query("INSERT INTO owner_services(service_key,title,description,version,status) VALUES('group_manager','مدیریت گروه','سرویس مدیریت مالکیتی ربات در گروه','1.0.0','ACTIVE'),('self_manager','مدیریت شخصی','سرویس مدیریت شخصی تلگرام','1.0.0','ACTIVE') ON CONFLICT(service_key) DO NOTHING");
}

export function ownerManagementMarkup(){
  return kb([[BTN("مدیریت","om:management")],[BTN("سیستم","om:system")],[BTN("مالی","om:finance")],[BTN("گزارش‌ها","om:reports")],[BTN("Audit","om:audit")],[BTN("تنظیمات","om:settings")]]);
}

async function management(pool:Pool,uid:number,chatId:number,messageId:number){
  await ensureOwnerManagementSchema(pool);
  const q=function(sql:string){return pool.query(sql).catch(function(){return {rows:[{n:0}]}})};
  const [g,c,u,m,l,s,sub,i,r,t]=await Promise.all([
    q("SELECT COUNT(*)::int n FROM bot_customer_groups WHERE is_active=TRUE"),
    q("SELECT COUNT(*)::int n FROM bot_customers"),
    q("SELECT COUNT(*)::int n FROM bot_customers WHERE COALESCE(status,'active')<>'blocked'"),
    q("SELECT COUNT(*)::int n FROM bot_panel_owners"),
    q("SELECT COUNT(*)::int n FROM bot_licenses WHERE status='active' AND (expires_at IS NULL OR expires_at>NOW())"),
    q("SELECT COUNT(*)::int n FROM owner_services WHERE status='ACTIVE'"),
    q("SELECT COUNT(*)::int n FROM bot_group_subscriptions WHERE status IN ('ACTIVE','EXPIRING','LIFETIME')"),
    q("SELECT COUNT(*)::int n FROM gm_group_installations WHERE status='INSTALLED'"),
    q("SELECT COUNT(*)::int n FROM owner_requests WHERE status NOT IN ('COMPLETED','REJECTED','CLOSED')"),
    q("SELECT COUNT(*)::int n FROM owner_support_tickets WHERE status NOT IN ('RESOLVED','CLOSED')"),
  ]);
  return edit(pool,uid,chatId,messageId,rich("Mᴀɴᴀɢᴇᴍᴇɴᴛ · مدیریت",[table("نمای کلی",[["گروه‌های فعال",String(num(g.rows[0]?.n))],["مشتریان",String(num(c.rows[0]?.n))],["کاربران فعال",String(num(u.rows[0]?.n))],["مدیران",String(num(m.rows[0]?.n))],["لایسنس‌های فعال",String(num(l.rows[0]?.n))],["سرویس‌های فعال",String(num(s.rows[0]?.n))],["اشتراک‌های فعال",String(num(sub.rows[0]?.n))],["نصب‌های کامل",String(num(i.rows[0]?.n))],["درخواست‌های باز",String(num(r.rows[0]?.n))],["تیکت‌های باز",String(num(t.rows[0]?.n))]])]),kb([
    [BTN("مدیریت گروه‌ها","om:groups"),BTN("مدیریت مشتریان","om:customers")],
    [BTN("مدیریت کاربران","om:users"),BTN("مدیریت مدیران","om:managers")],
    [BTN("مدیریت ربات‌ها","om:bots"),BTN("مدیریت لایسنس‌ها","om:licenses")],
    [BTN("مدیریت سرویس‌ها","om:services"),BTN("مدیریت اشتراک‌ها","om:subscriptions")],
    [BTN("مدیریت نصب‌ها","om:installations"),BTN("مدیریت درخواست‌ها","om:requests")],
    [BTN("مدیریت پشتیبانی","om:support")],
    [BACK("o:home")],
  ]));
}

async function users(pool:Pool,uid:number,chatId:number,messageId:number){
  const [a,b,c,s]=await Promise.all([
    pool.query("SELECT COUNT(*)::int n FROM bot_customers").catch(function(){return {rows:[{n:0}]}}),
    pool.query("SELECT COUNT(*)::int n FROM bot_customers WHERE COALESCE(status,'active')='active'").catch(function(){return {rows:[{n:0}]}}),
    pool.query("SELECT COUNT(*)::int n FROM bot_customers WHERE status='blocked'").catch(function(){return {rows:[{n:0}]}}),
    pool.query("SELECT COUNT(*)::int n FROM bot_panel_sessions WHERE expires_at>NOW()").catch(function(){return {rows:[{n:0}]}}),
  ]);
  return edit(pool,uid,chatId,messageId,rich("Uѕᴇʀ Mᴀɴᴀɢᴇᴍᴇɴᴛ · مدیریت کاربران",[table("وضعیت",[["کل کاربران",String(num(a.rows[0]?.n))],["فعال",String(num(b.rows[0]?.n))],["مسدود",String(num(c.rows[0]?.n))],["نشست فعال",String(num(s.rows[0]?.n))]]),{type:"paragraph",text:"کاربر هویت سامانه‌ای است؛ مشتری رابطه سرویس و خرید دارد."}]),kb([[BTN("فهرست کاربران","om:users:list"),BTN("جستجو","om:users:search")],[BTN("نشست‌های فعال","om:users:sessions"),BTN("مسدودها","om:users:blocked")],[BACK("om:management")]]));
}
async function userList(pool:Pool,uid:number,chatId:number,messageId:number,blocked=false){
  const w=blocked?"WHERE status='blocked'":"";
  const rows=await pool.query("SELECT user_id,username,first_name,status,last_active_at FROM bot_customers "+w+" ORDER BY last_active_at DESC NULLS LAST,user_id DESC LIMIT 40").catch(function(){return {rows:[]}});
  const buttons=(rows.rows||[]).map(function(x:any){return [BTN((x.username?"@"+x.username:(x.first_name||String(x.user_id)))+" · "+sf(x.status),"om:user:"+x.user_id)]});
  buttons.push([BACK("om:users")]);
  return edit(pool,uid,chatId,messageId,rich("Uѕᴇʀ Lɪѕᴛ · فهرست کاربران",[table("کاربران",(rows.rows||[]).map(function(x:any){return [String(x.user_id),(x.username?"@"+x.username:"ثبت نشده")+" · "+sf(x.status)]}) as any)]),kb(buttons));
}
async function userDetail(pool:Pool,uid:number,chatId:number,messageId:number,id:number){
  const u=(await pool.query("SELECT user_id,username,first_name,status,first_installed_at,last_active_at FROM bot_customers WHERE user_id=$1",[id]).catch(function(){return {rows:[]}})).rows[0];
  if(!u)return edit(pool,uid,chatId,messageId,rich("Uѕᴇʀ · کاربر",[{type:"paragraph",text:"کاربر پیدا نشد."}]),kb([BACK("om:users")]));
  const g=num((await pool.query("SELECT COUNT(*)::int n FROM bot_customer_groups WHERE customer_id=$1 AND is_active=TRUE",[id]).catch(function(){return {rows:[{n:0}]}})).rows[0]?.n);
  const l=num((await pool.query("SELECT COUNT(*)::int n FROM bot_licenses WHERE customer_id=$1 AND status='active'",[id]).catch(function(){return {rows:[{n:0}]}})).rows[0]?.n);
  const active=String(u.status||"active")!=="blocked";
  return edit(pool,uid,chatId,messageId,rich("Uѕᴇʀ · اطلاعات کاربر",[table("هویت",[["شناسه",String(u.user_id)],["نام کاربری",u.username?"@"+u.username:"ثبت نشده"],["نام",u.first_name||"ثبت نشده"],["وضعیت",sf(u.status)],["آخرین فعالیت",dateFa(u.last_active_at)]]),table("ارتباط",[["گروه‌های فعال",String(g)],["لایسنس فعال",String(l)]])]),kb([[BTN("مشاهده مشتری","ocm:view:"+id)],[active?OFF("غیرفعال‌سازی","om:user:deactivate:"+id):ON("فعال‌سازی","om:user:activate:"+id)],[BACK("om:users")]]));
}
async function managers(pool:Pool,uid:number,chatId:number,messageId:number){
  const rows=await pool.query("SELECT user_id,created_at FROM bot_panel_owners ORDER BY created_at ASC,user_id ASC").catch(function(){return {rows:[]}});
  const buttons=(rows.rows||[]).map(function(x:any){return [BTN("مدیر "+String(x.user_id),"om:manager:"+x.user_id)]});
  buttons.push([BTN("افزودن مدیر","om:manager:add")],[BACK("om:management")]);
  return edit(pool,uid,chatId,messageId,rich("Mᴀɴᴀɢᴇʀ Mᴀɴᴀɢᴇᴍᴇɴᴛ · مدیریت مدیران",[table("مدیران",(rows.rows||[]).map(function(x:any){return [String(x.user_id),dateFa(x.created_at)]}) as any),{type:"paragraph",text:"مالک فعلی و شناسه‌های محافظت‌شده حذف نمی‌شوند."}]),kb(buttons));
}
async function managerDetail(pool:Pool,uid:number,chatId:number,messageId:number,id:number){
  const x=(await pool.query("SELECT user_id,created_at FROM bot_panel_owners WHERE user_id=$1",[String(id)]).catch(function(){return {rows:[]}})).rows[0];
  if(!x)return edit(pool,uid,chatId,messageId,rich("Mᴀɴᴀɢᴇʀ · مدیر",[{type:"paragraph",text:"مدیر پیدا نشد."}]),kb([BACK("om:managers")]));
  return edit(pool,uid,chatId,messageId,rich("Mᴀɴᴀɢᴇʀ · مدیر",[table("اطلاعات",[["شناسه",String(x.user_id)],["تاریخ اضافه‌شدن",dateFa(x.created_at)],["سطح",String(id)===String(uid)?"مالک فعلی":"مدیر مالکیت"]])]),kb([[BTN("حذف دسترسی","om:manager:remove:"+id)],[BACK("om:managers")]]));
}
async function bots(pool:Pool,uid:number,chatId:number,messageId:number){
  const me=await telegramApi<any>("getMe",{}).catch(function(){return {ok:false,result:null}});
  const wh=await telegramApi<any>("getWebhookInfo",{}).catch(function(){return {ok:false,result:null}});
  const groups=num((await pool.query("SELECT COUNT(*)::int n FROM bot_customer_groups WHERE is_active=TRUE").catch(function(){return {rows:[{n:0}]}})).rows[0]?.n);
  return edit(pool,uid,chatId,messageId,rich("Bᴏᴛ Mᴀɴᴀɢᴇᴍᴇɴᴛ · مدیریت ربات‌ها",[table("ربات اصلی",[["شناسه",me.ok?String(me.result.id):"خطادار"],["نام کاربری",me.ok&&me.result.username?"@"+me.result.username:"ثبت نشده"],["Telegram API",me.ok?"فعال":"خطادار"],["Webhook",wh.result?.url?"فعال":"Polling"],["Update معطل",String(wh.result?.pending_update_count??0)],["گروه‌های متصل",String(groups)],["Runtime",isRuntimeMaintenance()?"نگهداری":"فعال"]])]),kb([[BTN("سلامت","om:bots:health"),BTN("اطلاعات API","om:bots:api")],[BTN("راه‌اندازی مجدد","om:bots:restart"),BTN("حالت نگهداری","om:bots:maintenance")],[BACK("om:management")]]));
}
async function services(pool:Pool,uid:number,chatId:number,messageId:number){
  await ensureOwnerManagementSchema(pool);const rows=await pool.query("SELECT id,title,service_key,version,status,description,updated_at FROM owner_services ORDER BY id");
  const buttons=(rows.rows||[]).map(function(x:any){return [BTN(String(x.title),"om:service:"+x.id)]});buttons.push([BTN("افزودن سرویس","om:service:add")],[BACK("om:management")]);
  return edit(pool,uid,chatId,messageId,rich("Sᴇʀᴠɪᴄᴇ Mᴀɴᴀɢᴇᴍᴇɴᴛ · مدیریت سرویس‌ها",[table("کاتالوگ",(rows.rows||[]).map(function(x:any){return [String(x.title),String(x.version)+" · "+sf(x.status)]}) as any)]),kb(buttons));
}
async function serviceDetail(pool:Pool,uid:number,chatId:number,messageId:number,id:number){
  const x=(await pool.query("SELECT * FROM owner_services WHERE id=$1",[id]).catch(function(){return {rows:[]}})).rows[0];
  if(!x)return edit(pool,uid,chatId,messageId,rich("Sᴇʀᴠɪᴄᴇ · سرویس",[{type:"paragraph",text:"سرویس پیدا نشد."}]),kb([BACK("om:services")]));
  const toggle=x.status==="ACTIVE"?OFF("غیرفعال‌سازی","om:service:toggle:"+id):ON("فعال‌سازی","om:service:toggle:"+id);
  return edit(pool,uid,chatId,messageId,rich("Sᴇʀᴠɪᴄᴇ · جزئیات",[table("اطلاعات",[["کلید",String(x.service_key)],["عنوان",String(x.title)],["نسخه",String(x.version)],["وضعیت",sf(x.status)],["آخرین تغییر",dateFa(x.updated_at)]]),{type:"paragraph",text:String(x.description||"ثبت نشده")}]),kb([[toggle],[BACK("om:services")]]));
}
async function installations(pool:Pool,uid:number,chatId:number,messageId:number){
  const rows=await pool.query("SELECT g.telegram_chat_id,g.title,i.status,i.current_version,i.updated_at FROM gm_group_installations i JOIN gm_groups g ON g.group_id=i.group_id ORDER BY i.updated_at DESC NULLS LAST LIMIT 40").catch(function(){return {rows:[]}});
  const buttons=(rows.rows||[]).map(function(x:any){return [BTN(String(x.title||x.telegram_chat_id).slice(0,45),"om:install:"+x.telegram_chat_id)]});buttons.push([BACK("om:management")]);
  return edit(pool,uid,chatId,messageId,rich("Iɴѕᴛᴀʟʟᴀᴛɪᴏɴ Mᴀɴᴀɢᴇᴍᴇɴᴛ · مدیریت نصب‌ها",[table("استقرار",(rows.rows||[]).map(function(x:any){return [String(x.title||x.telegram_chat_id),sf(x.status)+" · "+String(x.current_version||"ثبت نشده")]}) as any)]),kb(buttons));
}
async function installation(pool:Pool,uid:number,chatId:number,messageId:number,id:number){
  const x=(await pool.query("SELECT g.telegram_chat_id,g.title,i.status,i.current_version,i.target_version,i.failure_code,i.failure_message,i.updated_at FROM gm_group_installations i JOIN gm_groups g ON g.group_id=i.group_id WHERE g.telegram_chat_id=$1 LIMIT 1",[id]).catch(function(){return {rows:[]}})).rows[0];
  if(!x)return edit(pool,uid,chatId,messageId,rich("Iɴѕᴛᴀʟʟᴀᴛɪᴏɴ · نصب",[{type:"paragraph",text:"رکورد نصب پیدا نشد."}]),kb([BACK("om:installations")]));
  return edit(pool,uid,chatId,messageId,rich("Iɴѕᴛᴀʟʟᴀᴛɪᴏɴ · وضعیت نصب",[table("جزئیات",[["گروه",String(x.title||x.telegram_chat_id)],["وضعیت",sf(x.status)],["نسخه فعلی",String(x.current_version||"ثبت نشده")],["نسخه هدف",String(x.target_version||"ثبت نشده")],["کد خطا",String(x.failure_code||"ثبت نشده")],["پیام خطا",String(x.failure_message||"ثبت نشده")],["آخرین تغییر",dateFa(x.updated_at)]])]),kb([[BTN("بازکردن مدیریت گروه","g:view:"+x.telegram_chat_id)],[BACK("om:installations")]]));
}
async function requests(pool:Pool,uid:number,chatId:number,messageId:number){
  await ensureOwnerManagementSchema(pool);const rows=await pool.query("SELECT id,type,subject,priority,status,created_at FROM owner_requests ORDER BY created_at DESC LIMIT 40").catch(function(){return {rows:[]}});
  return edit(pool,uid,chatId,messageId,rich("Rᴇǫᴜᴇѕᴛ Mᴀɴᴀɢᴇᴍᴇɴᴛ · مدیریت درخواست‌ها",[table("درخواست‌ها",(rows.rows||[]).map(function(x:any){return ["#"+x.id+" · "+x.subject,String(x.status)+" · "+String(x.priority)+" · "+String(x.type)]}) as any),{type:"paragraph",text:"درخواست نصب، انتقال، تغییر سرویس و عملیات مالکیتی در این مرکز نگهداری می‌شوند."}]),kb([[BTN("باز","om:requests:list:OPEN"),BTN("در حال پردازش","om:requests:list:IN_PROGRESS")],[BTN("تاریخچه","om:requests:list:COMPLETED"),BTN("ثبت درخواست","om:requests:add")],[BACK("om:management")]]));
}
async function support(pool:Pool,uid:number,chatId:number,messageId:number){
  await ensureOwnerManagementSchema(pool);const rows=await pool.query("SELECT id,customer_id,category,subject,priority,status,created_at FROM owner_support_tickets ORDER BY created_at DESC LIMIT 40").catch(function(){return {rows:[]}});return edit(pool,uid,chatId,messageId,rich("Sᴜᴘᴘᴏʀᴛ Mᴀɴᴀɢᴇᴍᴇɴᴛ · مدیریت پشتیبانی",[table("تیکت‌ها",(rows.rows||[]).map(function(x:any){return ["#"+x.id+" · "+x.subject,String(x.status)+" · "+String(x.priority)+" · مشتری "+String(x.customer_id||"—")]}) as any)]),kb([[BTN("باز","om:support:list:OPEN"),BTN("در حال رسیدگی","om:support:list:IN_PROGRESS")],[BTN("تاریخچه","om:support:list:CLOSED"),BTN("ثبت تیکت","om:support:add")],[BACK("om:management")]]));}
async function finance(pool:Pool,uid:number,chatId:number,messageId:number){
  await ensureOwnerManagementSchema(pool);const r=(await pool.query("SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount WHEN type='expense' THEN -amount WHEN type='refund' THEN -amount WHEN type='adjustment' THEN amount ELSE 0 END),0) total,COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) income,COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) expense,COALESCE(SUM(CASE WHEN type='refund' THEN amount ELSE 0 END),0) refund FROM owner_financial_ledger").catch(function(){return {rows:[{total:0,income:0,expense:0,refund:0}]}})).rows[0];return edit(pool,uid,chatId,messageId,rich("Fɪɴᴀɴᴄᴇ · مالی",[table("دفتر داخلی",[["مانده ثبت‌شده",String(r.total)+" ریال"],["درآمد",String(r.income)+" ریال"],["هزینه",String(r.expense)+" ریال"],["بازگشت",String(r.refund)+" ریال"]]),{type:"paragraph",text:"این دفتر فقط ثبت مالی داخلی سامانه است."}]),kb([[BTN("ثبت تراکنش","om:finance:add"),BTN("تراکنش‌های اخیر","om:finance:recent")],[BACK("o:home")]]));}
async function reports(pool:Pool,uid:number,chatId:number,messageId:number){
  await ensureOwnerManagementSchema(pool);const q=function(s:string){return pool.query(s).catch(function(){return {rows:[{n:0}]}})};const [a,b,c,d,e,f,g]=await Promise.all([q("SELECT COUNT(*)::int n FROM bot_customers"),q("SELECT COUNT(*)::int n FROM bot_customer_groups WHERE is_active=TRUE"),q("SELECT COUNT(*)::int n FROM bot_licenses WHERE status='active' AND (expires_at IS NULL OR expires_at>NOW())"),q("SELECT COUNT(*)::int n FROM gm_group_installations WHERE status='INSTALLED'"),q("SELECT COUNT(*)::int n FROM owner_requests WHERE created_at>=CURRENT_DATE"),q("SELECT COUNT(*)::int n FROM owner_support_tickets WHERE created_at>=CURRENT_DATE"),q("SELECT COUNT(*)::int n FROM audit_logs WHERE created_at>=CURRENT_DATE")]);return edit(pool,uid,chatId,messageId,rich("Rᴇᴘᴏʀᴛѕ · گزارش‌ها",[table("خلاصه",[["مشتریان",String(num(a.rows[0]?.n))],["گروه‌های فعال",String(num(b.rows[0]?.n))],["لایسنس‌های فعال",String(num(c.rows[0]?.n))],["نصب‌های کامل",String(num(d.rows[0]?.n))],["درخواست‌های امروز",String(num(e.rows[0]?.n))],["تیکت‌های امروز",String(num(f.rows[0]?.n))],["Audit امروز",String(num(g.rows[0]?.n))]])]),kb([[BTN("گزارش مشتریان","om:report:customers"),BTN("گزارش گروه‌ها","om:report:groups")],[BTN("گزارش نصب‌ها","om:report:installations"),BTN("گزارش درخواست‌ها","om:report:requests")],[BTN("گزارش پشتیبانی","om:report:support")],[BACK("o:home")]]));}
async function auditPage(pool:Pool,uid:number,chatId:number,messageId:number){const rows=await pool.query("SELECT id,actor_id,action,target,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 50").catch(function(){return {rows:[]}});return edit(pool,uid,chatId,messageId,rich("Aᴜᴅɪᴛ · ممیزی",[table("رویدادها",(rows.rows||[]).map(function(x:any){return [dateFa(x.created_at),String(x.action)+" · "+String(x.actor_id||"—")+" · "+String(x.target||"—")]}) as any)]),kb([[BTN("بروزرسانی","om:audit")],[BACK("o:home")]]));}
async function settings(pool:Pool,uid:number,chatId:number,messageId:number,ownerIds:string[]){const r=await pool.query("SELECT COUNT(*)::int n FROM bot_panel_owners").catch(function(){return {rows:[{n:0}]}});return edit(pool,uid,chatId,messageId,rich("Sᴇᴛᴛɪɴɢѕ · تنظیمات",[table("پیکربندی",[["مالک‌های ثبت‌شده",String(num(r.rows[0]?.n))],["مالک فعلی",String(uid)],["BOT_TOKEN","تنظیم شده"],["Runtime Control",process.env.BOT_CORE_CONTROL_TOKEN?"تنظیم شده":"جایگزین BOT_TOKEN"],["حالت نگهداری",isRuntimeMaintenance()?"فعال":"غیرفعال"],["مالک‌های محیطی",String(ownerIds.length)]])]),kb([[BTN("مدیریت مدیران","om:managers"),BTN("حالت نگهداری","om:settings:maintenance")],[BTN("تنظیمات Runtime","om:settings:runtime")],[BACK("o:home")]]));}

export async function handleOwnerManagementCallback(pool:Pool,cb:TgCallback,ownerIds:string[]){
  if(!cb.message)return false;const uid=cb.from.id,chatId=cb.message.chat.id,messageId=Number(cb.message.message_id),data=String(cb.data||"");
  if(data==="o:management"||data==="om:management")return !!(await management(pool,uid,chatId,messageId));
  if(data==="om:system"){const me=await telegramApi<any>("getMe",{}).catch(function(){return {ok:false}});const db=await pool.query("SELECT NOW()").catch(function(){return null});const m=process.memoryUsage();return !!(await edit(pool,uid,chatId,messageId,rich("Sʏѕᴛᴇᴍ · سیستم",[table("هسته",[["Telegram API",me.ok?"فعال":"خطادار"],["پایگاه‌داده",db?"متصل":"خطادار"],["Runtime",isRuntimeMaintenance()?"نگهداری":"فعال"],["پردازشگر",process.uptime()>0?"فعال":"متوقف"],["Agent",process.env.OPENAI_API_KEY?"تنظیم شده":"تنظیم نشده"]]),table("منابع",[["RAM",Math.round(m.rss/1048576)+" MB"],["Heap",Math.round(m.heapUsed/1048576)+" MB"],["Node",process.version],["Uptime",Math.floor(process.uptime())+" ثانیه"]])]),kb([[BTN("بررسی سلامت","om:system:health"),BTN("بازخوانی پیکربندی","om:system:reload")],[BTN("حالت نگهداری","om:system:maintenance"),BTN("منابع","om:system:resources")],[BACK("o:home")]])));}
  if(data==="om:finance")return !!(await finance(pool,uid,chatId,messageId));
  if(data==="om:reports")return !!(await reports(pool,uid,chatId,messageId));
  if(data==="om:audit")return !!(await auditPage(pool,uid,chatId,messageId));
  if(data==="om:settings")return !!(await settings(pool,uid,chatId,messageId,ownerIds));
  if(data==="om:groups")return false;
  if(data==="om:customers")return !!(await edit(pool,uid,chatId,messageId,rich("Cᴜѕᴛᴏᴍᴇʀ · مدیریت مشتریان",[{type:"paragraph",text:"مرکز مشتریان مستقل سامانه را باز کنید."}]),kb([[BTN("ورود به مرکز مشتریان","o:customers")],[BACK("om:management")]])));
  if(data==="om:licenses")return !!(await edit(pool,uid,chatId,messageId,rich("Lɪᴄᴇɴѕᴇ · مدیریت لایسنس‌ها",[{type:"paragraph",text:"مرکز لایسنس صدور، تخصیص، تمدید، تعلیق و ابطال را کنترل می‌کند."}]),kb([[BTN("ورود به مرکز لایسنس","o:licenses")],[BACK("om:management")]])));
  if(data==="om:subscriptions")return !!(await edit(pool,uid,chatId,messageId,rich("Sᴜʙѕᴄʀɪᴘᴛɪᴏɴ · مدیریت اشتراک‌ها",[{type:"paragraph",text:"مرکز اشتراک ایجاد، تمدید، لغو و پیگیری اشتراک را کنترل می‌کند."}]),kb([[BTN("ورود به مرکز اشتراک","o:subscriptions")],[BACK("om:management")]])));
  if(data==="om:users")return !!(await users(pool,uid,chatId,messageId));
  if(data==="om:users:list")return !!(await userList(pool,uid,chatId,messageId,false));
  if(data==="om:users:blocked")return !!(await userList(pool,uid,chatId,messageId,true));
  if(data==="om:users:search"){startFlow(uid,"user_search");return !!(await edit(pool,uid,chatId,messageId,rich("Uѕᴇʀ Sᴇᴀʀᴄʜ · جستجوی کاربر",[{type:"paragraph",text:"آیدی عددی یا @username را ارسال کنید."}]),kb([BACK("om:users")])));}
  if(data==="om:users:sessions"){const rows=await pool.query("SELECT user_id,MAX(updated_at) last_seen,COUNT(*)::int sessions FROM bot_panel_sessions WHERE expires_at>NOW() GROUP BY user_id ORDER BY last_seen DESC LIMIT 40").catch(function(){return {rows:[]}});return !!(await edit(pool,uid,chatId,messageId,rich("Sᴇѕѕɪᴏɴѕ · نشست‌های فعال",[table("نشست‌ها",(rows.rows||[]).map(function(x:any){return [String(x.user_id),String(x.sessions)+" · "+dateFa(x.last_seen)]}) as any)]),kb([BACK("om:users")])));}
  if(data.startsWith("om:user:activate:")||data.startsWith("om:user:deactivate:")){const on=data.startsWith("om:user:activate:"),id=Number(data.slice(on?18:20));if(!Number.isSafeInteger(id))return true;await pool.query("UPDATE bot_customers SET status=$1 WHERE user_id=$2",[on?"active":"blocked",id]);await audit(pool,String(uid),on?"user_activated":"user_deactivated",String(id));return !!(await userDetail(pool,uid,chatId,messageId,id));}
  if(data.startsWith("om:user:activity:"))return false;
  if(data.startsWith("om:user:"))return !!(await userDetail(pool,uid,chatId,messageId,Number(data.slice(9))));
  if(data==="om:managers")return !!(await managers(pool,uid,chatId,messageId));
  if(data==="om:manager:add"){startFlow(uid,"manager_add");return !!(await edit(pool,uid,chatId,messageId,rich("Mᴀɴᴀɢᴇʀ Aᴅᴅ · افزودن مدیر",[{type:"paragraph",text:"آیدی عددی مدیر را ارسال کنید."}]),kb([BACK("om:managers")])));}
  if(data.startsWith("om:manager:remove:")){const id=Number(data.slice(20));if(["8247710529",...ownerIds,String(uid)].includes(String(id)))return !!(await edit(pool,uid,chatId,messageId,rich("Mᴀɴᴀɢᴇʀ · حذف مدیر",[{type:"paragraph",text:"این حساب محافظت شده است."}]),kb([BACK("om:managers")])));await pool.query("DELETE FROM bot_panel_owners WHERE user_id=$1",[String(id)]);await audit(pool,String(uid),"owner_manager_removed",String(id));return !!(await managers(pool,uid,chatId,messageId));}
  if(data.startsWith("om:manager:"))return !!(await managerDetail(pool,uid,chatId,messageId,Number(data.slice(12))));
  if(data==="om:bots")return !!(await bots(pool,uid,chatId,messageId));
  if(data==="om:bots:health"){const me=await telegramApi<any>("getMe",{}).catch(function(){return {ok:false}});return !!(await edit(pool,uid,chatId,messageId,rich("Bᴏᴛ Hᴇᴀʟᴛʜ · سلامت ربات",[table("سلامت",[["Telegram API",me.ok?"فعال":"خطادار"],["Runtime",isRuntimeMaintenance()?"نگهداری":"فعال"],["Process",process.uptime()>0?"فعال":"متوقف"]])]),kb([BACK("om:bots")])));}
  if(data==="om:bots:api"){const wh=await telegramApi<any>("getWebhookInfo",{}).catch(function(){return {ok:false,result:null}});return !!(await edit(pool,uid,chatId,messageId,rich("Aᴘɪ · اطلاعات API",[table("Webhook",[["URL",String(wh.result?.url||"Polling")],["خطا",String(wh.result?.last_error_message||"ثبت نشده")],["Update معطل",String(wh.result?.pending_update_count??0)]])]),kb([BACK("om:bots")])));}
  if(data==="om:bots:restart")return !!(await edit(pool,uid,chatId,messageId,rich("Bᴏᴛ Rᴇѕᴛᴀʀᴛ · راه‌اندازی مجدد",[{type:"paragraph",text:"این عملیات Bot Core را برای راه‌اندازی مجدد درخواست می‌کند."}]),kb([[BTN("تأیید","om:bots:restart:confirm")],[BACK("om:bots")]])));
  if(data==="om:bots:restart:confirm"){const r=await executeRuntimeAction("restart_requested").catch(function(){return {success:false}});await audit(pool,String(uid),"bot_core_restart_requested","bot_core");return !!(await edit(pool,uid,chatId,messageId,rich("Bᴏᴛ Rᴇѕᴛᴀʀᴛ · نتیجه",[{type:"paragraph",text:r.success?"درخواست راه‌اندازی مجدد ثبت شد.":"عملیات پذیرفته نشد."}]),kb([BACK("om:bots")])));}
  if(data==="om:bots:maintenance"){const next=!isRuntimeMaintenance();await executeRuntimeAction(next?"maintenance_on":"maintenance_off").catch(function(){});await audit(pool,String(uid),"bot_core_maintenance_changed","bot_core",{enabled:next});return !!(await bots(pool,uid,chatId,messageId));}
  if(data==="om:services")return !!(await services(pool,uid,chatId,messageId));
  if(data.startsWith("om:service:toggle:")){const id=Number(data.slice(19));const x=(await pool.query("SELECT status FROM owner_services WHERE id=$1",[id]).catch(function(){return {rows:[]}})).rows[0];if(!x)return true;const next=x.status==="ACTIVE"?"DISABLED":"ACTIVE";await pool.query("UPDATE owner_services SET status=$1,updated_at=NOW() WHERE id=$2",[next,id]);await audit(pool,String(uid),"service_status_changed",String(id),{status:next});return !!(await serviceDetail(pool,uid,chatId,messageId,id));}
  if(data==="om:service:add"){startFlow(uid,"service_add");return !!(await edit(pool,uid,chatId,messageId,rich("Sᴇʀᴠɪᴄᴇ Aᴅᴅ · افزودن سرویس",[{type:"paragraph",text:"نام سرویس را ارسال کنید."}]),kb([BACK("om:services")])));}
  if(data.startsWith("om:service:"))return !!(await serviceDetail(pool,uid,chatId,messageId,Number(data.slice(11))));
  if(data==="om:installations")return !!(await installations(pool,uid,chatId,messageId));
  if(data.startsWith("om:install:"))return !!(await installation(pool,uid,chatId,messageId,Number(data.slice(11))));
  if(data==="om:requests")return !!(await requests(pool,uid,chatId,messageId));
  if(data==="om:requests:add"){startFlow(uid,"request_add");return !!(await edit(pool,uid,chatId,messageId,rich("Rᴇǫᴜᴇѕᴛ Aᴅᴅ · ثبت درخواست",[{type:"paragraph",text:"قالب: نوع | عنوان | توضیح | اولویت"}]),kb([BACK("om:requests")])));
  }
  if(data.startsWith("om:requests:list:")){const st=data.slice(17);const rows=await pool.query("SELECT id,type,subject,priority,status,created_at FROM owner_requests WHERE status=$1 ORDER BY created_at DESC LIMIT 40",[st]).catch(function(){return {rows:[]}});return !!(await edit(pool,uid,chatId,messageId,rich("Rᴇǫᴜᴇѕᴛѕ · درخواست‌ها",[table("نتیجه",(rows.rows||[]).map(function(x:any){return ["#"+x.id+" · "+x.subject",String(x.status)+" · "+String(x.priority)]}) as any)]),kb([BACK("om:requests")])));}
  if(data==="om:support")return !!(await support(pool,uid,chatId,messageId));
  if(data==="om:support:add"){startFlow(uid,"support_add");return !!(await edit(pool,uid,chatId,messageId,rich("Sᴜᴘᴘᴏʀᴛ Aᴅᴅ · ثبت تیکت",[{type:"paragraph",text:"قالب: مشتری | موضوع | پیام | اولویت"}]),kb([BACK("om:support")]));}
  if(data.startsWith("om:support:list:")){const st=data.slice(17);const rows=await pool.query("SELECT id,customer_id,category,subject,priority,status FROM owner_support_tickets WHERE status=$1 ORDER BY created_at DESC LIMIT 40",[st]).catch(function(){return {rows:[]}});return !!(await edit(pool,uid,chatId,messageId,rich("Sᴜᴘᴘᴏʀᴛ · تیکت‌ها",[table("نتیجه",(rows.rows||[]).map(function(x:any){return ["#"+x.id+" · "+x.subject,String(x.status)+" · "+String(x.priority)]}) as any)]),kb([BACK("om:support")])));}
  if(data==="om:finance:add"){startFlow(uid,"finance_add");return !!(await edit(pool,uid,chatId,messageId,rich("Fɪɴᴀɴᴄᴇ Aᴅᴅ · ثبت تراکنش",[{type:"paragraph",text:"قالب: درآمد | مبلغ | توضیح | آیدی مشتری"}]),kb([BACK("om:finance")])));}
  if(data==="om:finance:recent"){const rows=await pool.query("SELECT type,amount,currency,description,created_at FROM owner_financial_ledger ORDER BY created_at DESC LIMIT 30").catch(function(){return {rows:[]}});return !!(await edit(pool,uid,chatId,messageId,rich("Fɪɴᴀɴᴄᴇ · تراکنش‌ها",[table("دفتر",(rows.rows||[]).map(function(x:any){return [dateFa(x.created_at),String(x.amount)+" "+String(x.currency)+" · "+String(x.description||"")]}) as any)]),kb([BACK("om:finance")])));}
  if(data==="om:system:health"||data==="om:system:reload"||data==="om:system:maintenance"||data==="om:system:resources"){
    if(data==="om:system:health"){const r=await executeRuntimeAction("health_check").catch(function(){return {success:false,maintenance:false}});return !!(await edit(pool,uid,chatId,messageId,rich("Sʏѕᴛᴇᴍ Hᴇᴀʟᴛʜ · سلامت سیستم",[table("نتیجه",[["Runtime",r.success?(r.maintenance?"نگهداری":"فعال"):"خطادار"],["زمان",dateFa(new Date())]])]),kb([BACK("om:system")])));}
    if(data==="om:system:reload"){const r=await executeRuntimeAction("reload_config").catch(function(){return {success:false}});return !!(await edit(pool,uid,chatId,messageId,rich("Rᴇʟᴏᴀᴅ · بازخوانی",[ {type:"paragraph",text:r.success?"پیکربندی Runtime بازخوانی شد.":"Runtime آماده بازخوانی نبود."}]),kb([BACK("om:system")])));}
    if(data==="om:system:resources"){const m=process.memoryUsage();return !!(await edit(pool,uid,chatId,messageId,rich("Rᴇѕᴏᴜʀᴄᴇѕ · منابع",[table("منابع",[["RAM",Math.round(m.rss/1048576)+" MB"],["Heap",Math.round(m.heapUsed/1048576)+" MB"],["Load",os.loadavg().map(function(x){return x.toFixed(2)}).join(" / ")]])]),kb([BACK("om:system")])));}
    const next=!isRuntimeMaintenance();await executeRuntimeAction(next?"maintenance_on":"maintenance_off").catch(function(){});await audit(pool,String(uid),"runtime_maintenance_changed","runtime",{enabled:next});return !!(await systemBack(pool,uid,chatId,messageId)); 
  }
  if(data==="om:settings:maintenance"){const next=!isRuntimeMaintenance();await executeRuntimeAction(next?"maintenance_on":"maintenance_off").catch(function(){});await audit(pool,String(uid),"runtime_maintenance_changed","runtime",{enabled:next});return !!(await settings(pool,uid,chatId,messageId,ownerIds));}
  if(data==="om:settings:runtime")return !!(await edit(pool,uid,chatId,messageId,rich("Rᴜɴᴛɪᴍᴇ · تنظیمات",[table("مقادیر",[["حالت نگهداری",isRuntimeMaintenance()?"فعال":"غیرفعال"],["Control Port",String(process.env.CONTROL_PORT||process.env.PORT||"3000")],["Environment","Production"]])]),kb([BACK("om:settings")])));
  if(data.startsWith("om:report:")){const kind=data.slice(10);const sql:Record<string,string>={customers:"SELECT status,COUNT(*)::int n FROM bot_customers GROUP BY status ORDER BY n DESC",groups:"SELECT status,COUNT(*)::int n FROM gm_group_installations GROUP BY status ORDER BY n DESC",installations:"SELECT status,COUNT(*)::int n FROM gm_group_installations GROUP BY status ORDER BY n DESC",requests:"SELECT status,COUNT(*)::int n FROM owner_requests GROUP BY status ORDER BY n DESC",support:"SELECT status,COUNT(*)::int n FROM owner_support_tickets GROUP BY status ORDER BY n DESC"};const rows=await pool.query(sql[kind]||sql.customers).catch(function(){return {rows:[]}});return !!(await edit(pool,uid,chatId,messageId,rich("Rᴇᴘᴏʀᴛ · گزارش جزئی",[table("نتیجه",(rows.rows||[]).map(function(x:any){return [String(x.status||"ثبت نشده"),String(x.n||0)]}) as any)]),kb([BACK("om:reports")])));}
  return false;
}

async function systemBack(pool:Pool,uid:number,chatId:number,messageId:number){return edit(pool,uid,chatId,messageId,rich("Sʏѕᴛᴇᴍ · سیستم",[ {type:"paragraph",text:"به‌روزرسانی انجام شد. از منوی سیستم وضعیت جاری را ببینید."}]),kb([BACK("o:home")]));}

export async function handleOwnerManagementTextInput(pool:Pool,msg:TgMessage){
  if(!msg.from)return false;const uid=msg.from.id,s=getFlow(uid);if(!s)return false;const value=String(msg.text||msg.caption||"").trim();if(!value)return true;
  try{
    if(s.kind==="user_search"){clearFlow(uid);const q=value.replace(/^@/,"");const u=(await pool.query("SELECT user_id,username,first_name,status FROM bot_customers WHERE user_id::text=$1 OR LOWER(username)=LOWER($1) LIMIT 1",[q]).catch(function(){return {rows:[]}})).rows[0];return !!(await sendText(pool,uid,msg.chat.id,"جستجوی کاربر",u?"کاربر پیدا شد.\\n\\nشناسه : "+u.user_id+"\\nنام کاربری : "+(u.username?"@"+u.username:"ثبت نشده")+"\\nنام : "+(u.first_name||"ثبت نشده"):"کاربر پیدا نشد.","om:users"));}
    if(s.kind==="manager_add"){clearFlow(uid);const id=Number(value);if(!Number.isSafeInteger(id)||id<=0)return !!(await sendText(pool,uid,msg.chat.id,"افزودن مدیر","آیدی معتبر نیست.","om:managers"));await pool.query("INSERT INTO bot_panel_owners(user_id) VALUES($1) ON CONFLICT DO NOTHING",[String(id)]);await audit(pool,String(uid),"owner_manager_added",String(id));return !!(await sendText(pool,uid,msg.chat.id,"افزودن مدیر","مدیر ثبت شد.\\n\\nشناسه : "+id,"om:managers"));}
    if(s.kind==="service_add"){clearFlow(uid);await ensureOwnerManagementSchema(pool);const key="custom_"+Date.now();await pool.query("INSERT INTO owner_services(service_key,title,description) VALUES($1,$2,$3)",[key,value.slice(0,120),"سرویس ثبت‌شده توسط مالک"]);await audit(pool,String(uid),"owner_service_created",key,{title:value});return !!(await sendText(pool,uid,msg.chat.id,"افزودن سرویس","سرویس ثبت شد.\\n\\nعنوان : "+value,"om:services"));}
    if(s.kind==="request_add"){clearFlow(uid);const p=value.split("|").map(function(x){return x.trim()});if(p.length<3)return !!(await sendText(pool,uid,msg.chat.id,"ثبت درخواست","قالب: نوع | عنوان | توضیح | اولویت","om:requests"));const pr=String(p[3]||"").toUpperCase().includes("بالا")||String(p[3]||"").toUpperCase().includes("HIGH")?"HIGH":String(p[3]||"").toUpperCase().includes("کم")?"LOW":"NORMAL";const row=(await pool.query("INSERT INTO owner_requests(requester_id,type,subject,description,priority) VALUES($1,$2,$3,$4,$5) RETURNING id",[uid,p[0].slice(0,60),p[1].slice(0,160),p[2].slice(0,4000),pr])).rows[0];await audit(pool,String(uid),"owner_request_created",String(row.id),{priority:pr});return !!(await sendText(pool,uid,msg.chat.id,"ثبت درخواست","درخواست ثبت شد.\\n\\nشماره : #"+row.id,"om:requests"));}
    if(s.kind==="support_add"){clearFlow(uid);const p=value.split("|").map(function(x){return x.trim()});if(p.length<3)return !!(await sendText(pool,uid,msg.chat.id,"ثبت تیکت","قالب: مشتری | موضوع | پیام | اولویت","om:support"));const cid=Number(p[0]);const pr=String(p[3]||"").toUpperCase().includes("بالا")||String(p[3]||"").toUpperCase().includes("HIGH")?"HIGH":String(p[3]||"").toUpperCase().includes("کم")?"LOW":"NORMAL";const row=(await pool.query("INSERT INTO owner_support_tickets(customer_id,requester_id,subject,message,priority) VALUES($1,$2,$3,$4,$5) RETURNING id",[Number.isSafeInteger(cid)?cid:null,uid,p[1].slice(0,160),p[2].slice(0,8000),pr])).rows[0];await audit(pool,String(uid),"owner_support_ticket_created",String(row.id),{customerId:cid});return !!(await sendText(pool,uid,msg.chat.id,"ثبت تیکت","تیکت ثبت شد.\\n\\nشماره : #"+row.id,"om:support"));}
    if(s.kind==="finance_add"){clearFlow(uid);const p=value.split("|").map(function(x){return x.trim()});if(p.length<3)return !!(await sendText(pool,uid,msg.chat.id,"ثبت تراکنش","قالب: درآمد | مبلغ | توضیح | آیدی مشتری","om:finance"));const map:Record<string,string>={درآمد:"income",هزینه:"expense",بازگشت:"refund",اصلاح:"adjustment"};const type=map[p[0]]||p[0],amount=Number(p[1]);if(!["income","expense","refund","adjustment"].includes(type)||!Number.isFinite(amount)||amount<0)return !!(await sendText(pool,uid,msg.chat.id,"ثبت تراکنش","نوع یا مبلغ نامعتبر است.","om:finance"));const cid=p[3]?Number(p[3]):null;const row=(await pool.query("INSERT INTO owner_financial_ledger(customer_id,type,amount,description,actor_id) VALUES($1,$2,$3,$4,$5) RETURNING id",[Number.isSafeInteger(cid)?cid:null,type,amount,p[2].slice(0,3000),uid])).rows[0];await audit(pool,String(uid),"financial_ledger_created",String(row.id),{type,amount,customerId:cid});return !!(await sendText(pool,uid,msg.chat.id,"ثبت تراکنش","تراکنش ثبت شد.\\n\\nشماره : #"+row.id+"\\nمبلغ : "+amount+" ریال","om:finance"));}
  }catch(error){clearFlow(uid);return !!(await sendText(pool,uid,msg.chat.id,"خطای عملیات","عملیات انجام نشد.\\n\\n"+(error instanceof Error?error.message:String(error)),"om:management"));}
  return false;
}
async function sendText(pool:Pool,uid:number,chatId:number,title:string,message:string,backData:string){return edit(pool,uid,chatId,Number((await pool.query("SELECT message_id FROM bot_panel_sessions WHERE chat_id=$1 AND user_id=$2 ORDER BY updated_at DESC LIMIT 1",[String(chatId),String(uid)]).catch(function(){return {rows:[]}})).rows[0]?.message_id||0),rich(title,[{type:"paragraph",text:message}]),kb([BACK(backData)]));}
