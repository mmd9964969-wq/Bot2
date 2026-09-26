import type { Pool } from "pg";
import { telegramApi } from "../telegram/api.ts";
import { glassButton, glassKeyboard, styledGlassButton } from "./panel-design.ts";
import { ensureContentLocks } from "./content-locks.ts";
import { getGroupLanguage, setGroupLanguage, SUPPORTED_LANGUAGES, languageNative } from "./i18n.ts";
import { bindPanelMessage } from "./panel-session.ts";

type User = { id:number; first_name?:string; username?:string };
type Chat = { id:number; type:string; title?:string; username?:string };
type TgMessage = {
  message_id:number;
  chat:Chat;
  from?:User;
  text?:string;
  photo?:Array<{file_id?:string;file_size?:number}>;
  video?:{file_id?:string;file_size?:number};
  animation?:{file_id?:string};
  document?:{file_id?:string;file_name?:string};
};
type TgCallback = { id:string; from:User; message?:TgMessage; data?:string };

type ConfigSession = {
  groupId:number;
  flow:string;
  data:Record<string,any>;
  expires:number;
};

const sessions = new Map<number,ConfigSession>();
const TTL = 10 * 60 * 1000;
const SEP = "─────━━───── ◈ ─────━━─────";

function setSession(userId:number,groupId:number,flow:string,data:Record<string,any>={}){
  sessions.set(userId,{groupId,flow,data,expires:Date.now()+TTL});
}
function getSession(userId:number){
  const s=sessions.get(userId);
  if(!s || s.expires<Date.now()){sessions.delete(userId);return null;}
  return s;
}
function clearSession(userId:number){sessions.delete(userId);}

function send(chatId:number,text:string,replyMarkup?:any){
  return telegramApi("sendMessage",{chat_id:chatId,text,reply_markup:replyMarkup});
}
function edit(chatId:number,messageId:number,text:string,replyMarkup?:any){
  return telegramApi("editMessageText",{chat_id:chatId,message_id:messageId,text,reply_markup:replyMarkup});
}
function title(name:string,body:string){
  return "◈ "+name+"\n\n"+body;
}
function neutral(label:string,callback:string){
  return [label,callback] as [string,string];
}
function toggle(label:string,callback:string,enabled:boolean){
  return styledGlassButton(label,callback,enabled?"success":"danger");
}
function back(callback:string){
  return styledGlassButton("‹ بازگشت",callback,"primary");
}
function keyboard(rows:Array<Array<[string,string]>>){
  return glassKeyboard(rows);
}
function clean(value:any){return String(value??"").trim();}

async function isOwner(userId:number){
  const ids=(process.env.OWNER_IDS??"").split(/[,\s]+/).filter(Boolean);
  return ids.includes(String(userId));
}

async function groupAllowed(pool:Pool,userId:number,groupId:number){
  if(await isOwner(userId))return true;
  const r=await pool.query(
    "SELECT 1 FROM bot_customer_groups WHERE customer_id=$1 AND group_id=$2 AND is_active=TRUE LIMIT 1",
    [userId,groupId]
  ).catch(()=>({rowCount:0,rows:[] as any[]}));
  return (r.rowCount??0)>0;
}

async function groupAdmin(groupId:number,userId:number){
  const r=await telegramApi<any>("getChatMember",{chat_id:groupId,user_id:userId});
  if(!r.ok)return false;
  return ["administrator","creator"].includes(String(r.result?.status??""));
}

async function ensureConfig(pool:Pool,groupId:number){
  await pool.query("INSERT INTO bot_group_configuration(group_id) VALUES($1) ON CONFLICT(group_id) DO NOTHING",[groupId]);
  await pool.query(
    "INSERT INTO bot_group_settings(group_id) VALUES($1) ON CONFLICT(group_id) DO NOTHING",
    [groupId]
  );
  await pool.query(
    "INSERT INTO warning_system_settings(group_id) VALUES($1) ON CONFLICT(group_id) DO NOTHING",
    [groupId]
  ).catch(()=>{});
  const levels=[
    [1,"سطح ۱",1,"mute",1,"hours"],
    [2,"سطح ۲",2,"mute",6,"hours"],
    [3,"سطح ۳",3,"restrict",12,"hours"],
    [4,"سطح ۴",4,"temp_ban",1,"days"],
    [5,"سطح ۵",5,"permanent_ban",null,null]
  ] as const;
  for(const [no,name,threshold,type,duration,unit] of levels){
    await pool.query(
      "INSERT INTO warning_levels(group_id,level_no,name,warning_count_required,penalty_type,duration_value,duration_unit) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(group_id,level_no) DO NOTHING",
      [groupId,no,name,threshold,type,duration,unit]
    ).catch(()=>{});
  }
}

async function loadConfig(pool:Pool,groupId:number){
  await ensureConfig(pool,groupId);
  const config=(await pool.query("SELECT * FROM bot_group_configuration WHERE group_id=$1 LIMIT 1",[groupId])).rows[0];
  const settings=(await pool.query("SELECT * FROM bot_group_settings WHERE group_id=$1 LIMIT 1",[groupId])).rows[0]??{};
  return {config,settings};
}

function configMainText(chatTitle:string,groupId:number,cfg:any){
  return title("پنل پیکربندی گروه",
    "وضعیت سیستم: "+(cfg.system_enabled!==false?"فعال":"خاموش")+
    "\nگروه: "+(chatTitle||"—")+
    "\nشناسه گروه: "+groupId+
    "\n\nاز منوی زیر بخش مورد نظر را انتخاب کنید."+
    "\n\n"+SEP
  );
}

function configMainKeyboard(){
  return keyboard([
    [neutral("تنظیمات عمومی","cfg:general"),neutral("سیستم قفل و فیلتر","cfg:locks")],
    [neutral("سیستم اخطار و جریمه","cfg:warnings"),neutral("خوش‌آمدگویی و خروج","cfg:welcome")],
    [neutral("دستورات و پاسخ خودکار","cfg:commands"),neutral("آمار و گزارش","cfg:stats")],
    [neutral("امنیت و حفاظت","cfg:security"),neutral("زمان‌بندی پیام‌ها","cfg:schedule")],
    [neutral("پشتیبان‌گیری تنظیمات","cfg:backup"),neutral("بازنشانی تنظیمات","cfg:reset")],
    [neutral("خروج از پنل","cfg:exit")]
  ]);
}

async function renderConfig(pool:Pool,chatId:number,messageId:number|undefined,groupId:number,chatTitle:string){
  const {config}=await loadConfig(pool,groupId);
  const text=configMainText(chatTitle,groupId,config);
  if(messageId)return edit(chatId,messageId,text,configMainKeyboard());
  const r=await send(chatId,text,configMainKeyboard());
  if(r.ok){
    const mid=Number((r.result as any)?.message_id);
    if(Number.isSafeInteger(mid))await bindPanelMessage(pool,chatId,mid,groupId>0?Number((r.result as any)?.chat?.id?0:0):0).catch(()=>{});
  }
  return r;
}

async function renderGroupPicker(pool:Pool,userId:number,chatId:number){
  const rows=(await pool.query(
    "SELECT group_id,COALESCE(title,'گروه بدون نام') AS title FROM bot_customer_groups WHERE customer_id=$1 AND is_active=TRUE ORDER BY title",
    [userId]
  ).catch(()=>({rows:[] as any[]}))).rows;
  if(!rows.length){
    return send(chatId,title("پیکربندی گروه","⛂ - هیچ گروه فعالی برای این حساب پیدا نشد."),keyboard([[neutral("‹ بازگشت","cfg:exit")]]));
  }
  const buttons=rows.slice(0,50).map((x:any)=>[neutral(String(x.title||x.group_id),"cfg:group:"+x.group_id)]);
  buttons.push([["‹ بازگشت","cfg:exit"]]);
  return send(chatId,title("انتخاب گروه","⛂ - گروهی را که می‌خواهید پیکربندی کنید انتخاب کنید."),keyboard(buttons));
}

async function saveField(pool:Pool,groupId:number,field:string,value:any){
  const allowed=new Set([
    "system_enabled","system_notifications","command_prefix","timezone","quiet_mode_enabled",
    "quiet_start","quiet_end","default_message","report_enabled","daily_report_enabled",
    "report_target_chat_id","membership_verification","rules_text","stats_retention_days","forbidden_words","default_commands_enabled",
    "welcome_button","welcome_media","goodbye_media"
  ]);
  if(!allowed.has(field))throw new Error("invalid_config_field");
  const sql = ["forbidden_words","welcome_button","welcome_media","goodbye_media"].includes(field)
    ? "INSERT INTO bot_group_configuration(group_id,"+field+") VALUES($1,$2::jsonb) ON CONFLICT(group_id) DO UPDATE SET "+field+"=EXCLUDED."+field+",updated_at=NOW()"
    : "INSERT INTO bot_group_configuration(group_id,"+field+") VALUES($1,$2) ON CONFLICT(group_id) DO UPDATE SET "+field+"=EXCLUDED."+field+",updated_at=NOW()";
  await pool.query(sql,[groupId,["forbidden_words","welcome_button","welcome_media","goodbye_media"].includes(field)?JSON.stringify(value):value]);
}

async function generalPage(pool:Pool,chatId:number,messageId:number,groupId:number){
  const {config}=await loadConfig(pool,groupId);
  return edit(chatId,messageId,title("تنظیمات عمومی",
    "⛂ - زبان : "+languageNative(await getGroupLanguage(pool,groupId,"fa"))+
    "\n⛂ - اعلان‌های سیستمی : "+(config.system_notifications?"فعال":"خاموش")+
    "\n⛂ - پیشوند : "+(clean(config.command_prefix)||"بدون پیشوند")+
    "\n⛂ - منطقه زمانی : "+(config.timezone||"Asia/Tehran")+
    "\n⛂ - سکوت شب : "+(config.quiet_mode_enabled?"فعال":"خاموش")+
    "\n⛂ - بازه سکوت : "+(config.quiet_start||"23:00")+" تا "+(config.quiet_end||"07:00")+
    "\n⛂ - پیام پیش‌فرض : "+(clean(config.default_message)||"تنظیم نشده")
  ),keyboard([
    [neutral("زبان ربات","cfg:language"),toggle("اعلان‌های سیستمی","cfg:toggle:notifications",config.system_notifications)],
    [neutral("تنظیم پیشوند","cfg:input:prefix"),neutral("منطقه زمانی","cfg:input:timezone")],
    [toggle("سکوت شب","cfg:toggle:quiet",config.quiet_mode_enabled),neutral("ساعت سکوت","cfg:quiettimes")],
    [neutral("پیام پیش‌فرض ربات","cfg:input:default_message")],
    [back("cfg:home")]
  ]));
}

async function locksPage(pool:Pool,chatId:number,messageId:number,groupId:number){
  await ensureContentLocks(pool,groupId);
  const r=await pool.query("SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE enabled=TRUE)::int active FROM content_lock_rules WHERE group_id=$1",[groupId]);
  const x=r.rows[0]??{};
  return edit(chatId,messageId,title("سیستم قفل و فیلتر",
    "⛂ - قوانین فعال : "+Number(x.active||0)+" از "+Number(x.total||0)+
    "\n⛂ - وضعیت : هر قفل در مرکز قفل با رنگ دکمه نمایش داده می‌شود."
  ),keyboard([
    [neutral("مدیریت تمام قفل‌ها","c:locks")],
    [neutral("کلمات ممنوعه","cfg:forbidden"),neutral("استثناها و فهرست مجاز","c:exceptions")],
    [back("cfg:home")]
  ]));
}

async function warningsPage(pool:Pool,chatId:number,messageId:number,groupId:number){
  await ensureConfig(pool,groupId);
  const x=(await pool.query("SELECT * FROM warning_system_settings WHERE group_id=$1 LIMIT 1",[groupId])).rows[0]??{};
  const levels=(await pool.query("SELECT level_no,warning_count_required,penalty_type,duration_value,duration_unit,enabled FROM warning_levels WHERE group_id=$1 ORDER BY level_no",[groupId]).catch(()=>({rows:[]}))).rows;
  const levelSummary=levels.map((r:any)=>"سطح "+r.level_no+" · "+r.warning_count_required+" اخطار · "+r.penalty_type+(r.duration_value?(" · "+r.duration_value+" "+r.duration_unit):"")).join("\n");
  return edit(chatId,messageId,title("سیستم اخطار و جریمه",
    "⛂ - سیستم : "+(x.enabled?"فعال":"خاموش")+
    "\n⛂ - حذف خودکار : "+(x.auto_expire_enabled?"فعال":"خاموش")+
    "\n⛂ - پیام خصوصی : "+(x.notify_private?"فعال":"خاموش")+
    "\n⛂ - معافیت ادمین : "+(x.exempt_admins?"فعال":"خاموش")+
    "\n⛂ - آستانه بن نهایی : "+(x.permanent_threshold??5)+
    "\n\n"+SEP+"\n"+levelSummary
  ),keyboard([
    [toggle("سیستم اخطار","cfg:warning:toggle:enabled",x.enabled),toggle("پیام خصوصی","cfg:warning:toggle:notify_private",x.notify_private)],
    [toggle("حذف خودکار","cfg:warning:toggle:auto_expire_enabled",x.auto_expire_enabled),toggle("معافیت ادمین","cfg:warning:toggle:exempt_admins",x.exempt_admins)],
    [neutral("آستانه بن نهایی","cfg:warning:threshold"),neutral("ویرایش مراحل","cfg:warning:levels")],
    [back("cfg:home")]
  ]));
}

async function welcomePage(pool:Pool,chatId:number,messageId:number,groupId:number){
  await ensureConfig(pool,groupId);
  const {settings}=await loadConfig(pool,groupId);
  return edit(chatId,messageId,title("خوش‌آمدگویی و خروج",
    "⛂ - خوش‌آمدگویی : "+(settings.welcome_enabled?"فعال":"خاموش")+
    "\n⛂ - خداحافظی : "+(settings.goodbye_text?"تنظیم شده":"خالی")+
    "\n⛂ - تأیید عضویت : "+((await loadConfig(pool,groupId)).config.membership_verification?"فعال":"خاموش")+
    "\n⛂ - ارسال قوانین : "+(settings.rules_on_join?"فعال":"خاموش")+
    "\n⛂ - خوش‌آمدگویی خصوصی : "+(settings.pv_welcome?"فعال":"خاموش")+
    "\n⛂ - پیام خوش‌آمد : "+(clean(settings.welcome_text)||"تنظیم نشده")+
    "\n⛂ - متغیرها : {name} {username} {id} {group} {count}"
  ),keyboard([
    [toggle("خوش‌آمدگویی","cfg:welcome:toggle:welcome_enabled",settings.welcome_enabled),toggle("تأیید عضویت","cfg:welcome:toggle:membership_verification",(await loadConfig(pool,groupId)).config.membership_verification)],
    [toggle("ارسال قوانین","cfg:welcome:toggle:rules_on_join",settings.rules_on_join),toggle("خوش‌آمدگویی خصوصی","cfg:welcome:toggle:pv_welcome",settings.pv_welcome)],
    [neutral("متن خوش‌آمدگویی","cfg:input:welcome_text"),neutral("متن خداحافظی","cfg:input:goodbye_text")],
    [neutral("متن قوانین","cfg:input:rules_text"),neutral("رسانه خوش‌آمدگویی","cfg:media:welcome")],
    [neutral("رسانه خداحافظی","cfg:media:goodbye")],
    [back("cfg:home")]
  ]));
}

async function commandsPage(pool:Pool,chatId:number,messageId:number,groupId:number){
  const {config}=await loadConfig(pool,groupId);
  const count=(await pool.query("SELECT COUNT(*)::int n FROM bot_group_commands WHERE group_id=$1",[groupId]).catch(()=>({rows:[{n:0}]}))).rows[0]?.n||0;
  return edit(chatId,messageId,title("دستورات و پاسخ خودکار",
    "⛂ - دستورات اختصاصی : "+Number(count)+
    "\n⛂ - دستورات پیش‌فرض : "+(config.default_commands_enabled?"فعال":"خاموش")
  ),keyboard([
    [toggle("دستورات پیش‌فرض","cfg:toggle:default_commands",config.default_commands_enabled)],
    [neutral("مدیریت دستورات اختصاصی","c:commands"),neutral("پاسخ خودکار و اتوماسیون","c:automation")],
    [back("cfg:home")]
  ]));
}

async function statsPage(pool:Pool,chatId:number,messageId:number,groupId:number,actorId:number){
  const {config}=await loadConfig(pool,groupId);
  const target=config.report_target_chat_id||groupId;
  const events=await pool.query("SELECT COUNT(*)::int n FROM supervision_events WHERE group_id=$1 AND created_at>=CURRENT_DATE",[groupId]).catch(()=>({rows:[{n:0}]}));
  return edit(chatId,messageId,title("آمار و گزارش",
    "⛂ - ثبت آمار : "+(config.report_enabled?"فعال":"خاموش")+
    "\n⛂ - گزارش روزانه : "+(config.daily_report_enabled?"فعال":"خاموش")+
    "\n⛂ - مقصد گزارش : "+target+
    "\n⛂ - نگهداری آمار : "+(config.stats_retention_days||90)+" روز"+
    "\n⛂ - رویدادهای امروز : "+Number(events.rows[0]?.n||0)
  ),keyboard([
    [toggle("ثبت آمار","cfg:stats:toggle",config.report_enabled),toggle("گزارش روزانه","cfg:stats:daily",config.daily_report_enabled)],
    [neutral("مقصد گزارش","cfg:input:report_target"),neutral("مدت نگهداری","cfg:input:retention")],
    [neutral("پاک‌سازی آمار قدیمی","cfg:stats:purge"),neutral("تحلیل گروه","c:analytics")],
    [back("cfg:home")]
  ]));
}

async function securityPage(pool:Pool,chatId:number,messageId:number,groupId:number){
  await ensureContentLocks(pool,groupId);
  await ensureConfig(pool,groupId);
  const settings=(await pool.query("SELECT * FROM bot_group_settings WHERE group_id=$1 LIMIT 1",[groupId])).rows[0]??{};
  const config=(await loadConfig(pool,groupId)).config;
  const locks=(await pool.query("SELECT rule_key,enabled FROM content_lock_rules WHERE group_id=$1 AND rule_key IN ('normal_bot','attack_join_flood') ORDER BY rule_key",[groupId])).rows;
  const antiBot=locks.find((x:any)=>x.rule_key==="normal_bot")?.enabled===true;
  const joinFlood=locks.find((x:any)=>x.rule_key==="attack_join_flood")?.enabled===true;
  return edit(chatId,messageId,title("امنیت و حفاظت",
    "⛂ - قفل کامل گروه : "+(settings.full_lock?"فعال":"خاموش")+
    "\n⛂ - ضد ربات : "+(antiBot?"فعال":"خاموش")+
    "\n⛂ - محدودیت سن اکانت : "+(settings.new_account_days||0)+" روز"+
    "\n⛂ - محافظت لینک دعوت : "+(settings.invite_protection?"فعال":"خاموش")+
    "\n⛂ - حالت اضطراری : "+(settings.emergency_mode?"فعال":"خاموش")+
    "\n⛂ - ضد هجوم عضویت : "+(joinFlood?"فعال":"خاموش")
  ),keyboard([
    [toggle("قفل کامل گروه","cfg:security:full_lock",settings.full_lock),toggle("ضد ربات","cfg:security:antibot",antiBot)],
    [toggle("محافظت لینک دعوت","cfg:security:invite",settings.invite_protection),toggle("حالت اضطراری","cfg:security:emergency",settings.emergency_mode)],
    [toggle("ضد هجوم عضویت","cfg:security:joinflood",joinFlood),neutral("سن اکانت جدید","cfg:input:new_account_days")],
    [neutral("اسکن اعضای مشکوک","cfg:security:scan")],
    [back("cfg:home")]
  ]));
}

async function schedulePage(pool:Pool,chatId:number,messageId:number,groupId:number){
  const rows=await pool.query("SELECT id,enabled,send_at,repeat_seconds,message_text FROM bot_schedules WHERE group_id=$1 ORDER BY send_at LIMIT 25",[groupId]).catch(()=>({rows:[] as any[]}));
  const text=rows.rows.length
    ? rows.rows.map((x:any)=>"#"+x.id+" · "+x.message_text.slice(0,35)+" · "+(x.repeat_seconds?"تکرار":"یک‌باره")+" · "+(x.enabled?"فعال":"خاموش")).join("\n")
    : "⛂ - زمان‌بندی ثبت نشده است.";
  return edit(chatId,messageId,title("زمان‌بندی پیام‌ها",text),keyboard([
    [neutral("ایجاد زمان‌بندی","sc:add"),neutral("فهرست زمان‌بندی‌ها","sc:list")],
    [neutral("ویرایش","sc:edit"),neutral("حذف","sc:delete")],
    [neutral("فعال / غیرفعال","sc:toggle")],
    [back("cfg:home")]
  ]));
}

async function snapshotGroup(pool:Pool,groupId:number){
  const tables=[
    "bot_groups","bot_group_configuration","bot_group_settings",
    "content_lock_settings","content_lock_rules","content_lock_exceptions","content_lock_domains",
    "warning_system_settings","warning_levels","bot_group_commands","bot_group_automations","bot_schedules"
  ];
  const snapshot:any={};
  for(const table of tables){
    try{snapshot[table]=(await pool.query("SELECT * FROM "+table+" WHERE group_id=$1",[groupId])).rows;}catch{snapshot[table]=[];}
  }
  return snapshot;
}

async function restoreGroup(pool:Pool,groupId:number,snapshot:any){
  const client=await pool.connect();
  const tables=[
    "bot_group_configuration","bot_group_settings",
    "content_lock_settings","content_lock_rules","content_lock_exceptions","content_lock_domains",
    "warning_system_settings","warning_levels","bot_group_commands","bot_group_automations","bot_schedules"
  ];
  try{
    await client.query("BEGIN");
    for(const table of tables){
      await client.query("DELETE FROM "+table+" WHERE group_id=$1",[groupId]);
      const rows=Array.isArray(snapshot?.[table])?snapshot[table]:[];
      for(const row of rows){
        const cleanRow={...row};delete cleanRow.id;
        const keys=Object.keys(cleanRow);
        if(!keys.length)continue;
        const placeholders=keys.map((_,i)=>"$"+(i+1)).join(",");
        await client.query(
          "INSERT INTO "+table+" ("+keys.join(",")+") VALUES ("+placeholders+") ON CONFLICT DO NOTHING",
          keys.map(k=>cleanRow[k])
        );
      }
    }
    await client.query("COMMIT");
  }catch(e){
    await client.query("ROLLBACK").catch(()=>{});
    throw e;
  }finally{
    client.release();
  }
}

async function renderBackups(pool:Pool,chatId:number,messageId:number,groupId:number){
  const rows=await pool.query("SELECT id,created_at FROM bot_group_config_backups WHERE group_id=$1 ORDER BY created_at DESC LIMIT 15",[groupId]);
  const body=rows.rows.length
    ? rows.rows.map((r:any)=>"#"+r.id+" · "+new Date(r.created_at).toLocaleString("fa-IR")).join("\n")
    : "⛂ - هیچ پشتیبانی ثبت نشده است.";
  const buttons=rows.rows.map((r:any)=>[neutral("بازیابی #"+r.id,"cfg:backup:restore:"+r.id)]);
  buttons.push([neutral("ایجاد پشتیبان","cfg:backup:make")]);
  buttons.push([back("cfg:home")]);
  return edit(chatId,messageId,title("پشتیبان‌گیری تنظیمات",body),keyboard(buttons));
}

async function resetGroup(pool:Pool,groupId:number){
  await pool.query("DELETE FROM bot_group_configuration WHERE group_id=$1",[groupId]);
  await pool.query("DELETE FROM bot_group_settings WHERE group_id=$1",[groupId]);
  await pool.query("DELETE FROM content_lock_exceptions WHERE group_id=$1",[groupId]).catch(()=>{});
  await pool.query("DELETE FROM content_lock_domains WHERE group_id=$1",[groupId]).catch(()=>{});
  await pool.query("DELETE FROM content_lock_rules WHERE group_id=$1",[groupId]).catch(()=>{});
  await pool.query("DELETE FROM content_lock_settings WHERE group_id=$1",[groupId]).catch(()=>{});
  await pool.query("DELETE FROM warning_levels WHERE group_id=$1",[groupId]).catch(()=>{});
  await pool.query("DELETE FROM warning_system_settings WHERE group_id=$1",[groupId]).catch(()=>{});
  await pool.query("DELETE FROM bot_group_commands WHERE group_id=$1",[groupId]).catch(()=>{});
  await pool.query("DELETE FROM bot_group_automations WHERE group_id=$1",[groupId]).catch(()=>{});
  await pool.query("DELETE FROM bot_schedules WHERE group_id=$1",[groupId]).catch(()=>{});
  await ensureContentLocks(pool,groupId);
  await ensureConfig(pool,groupId);
  await pool.query(
    "UPDATE bot_group_settings SET full_lock=FALSE,invite_protection=FALSE,fake_account_restriction=FALSE,new_account_days=0,emergency_mode=FALSE,welcome_text='',goodbye_text='',welcome_enabled=TRUE,rules_on_join=FALSE,pv_welcome=FALSE,updated_at=NOW() WHERE group_id=$1",
    [groupId]
  );
}

async function reportSchedule(pool:Pool,groupId:number,actorId:number,enabled:boolean,targetId:number){
  try{
    await pool.query("CREATE TABLE IF NOT EXISTS bot_schedules(id BIGSERIAL PRIMARY KEY,group_id BIGINT NOT NULL,creator_id BIGINT NOT NULL,message_text TEXT NOT NULL,send_at TIMESTAMPTZ NOT NULL,enabled BOOLEAN NOT NULL DEFAULT TRUE,repeat_seconds INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    const marker="__PERSIAN_BOT_DAILY_REPORT__:"+groupId;
    await pool.query("DELETE FROM bot_schedules WHERE message_text=$1",[marker]);
    if(enabled){
      await pool.query("INSERT INTO bot_schedules(group_id,creator_id,message_text,send_at,enabled,repeat_seconds) VALUES($1,$2,$3,NOW()+INTERVAL '1 day',TRUE,86400)",[targetId,actorId,marker]);
    }
  }catch{}
}

export async function ensureGroupConfigSchema(pool:Pool){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_group_configuration (
      group_id BIGINT PRIMARY KEY,
      system_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      system_notifications BOOLEAN NOT NULL DEFAULT TRUE,
      command_prefix TEXT NOT NULL DEFAULT '',
      timezone TEXT NOT NULL DEFAULT 'Asia/Tehran',
      quiet_mode_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      quiet_start TEXT NOT NULL DEFAULT '23:00',
      quiet_end TEXT NOT NULL DEFAULT '07:00',
      default_message TEXT NOT NULL DEFAULT '',
      report_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      daily_report_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      report_target_chat_id BIGINT,
      membership_verification BOOLEAN NOT NULL DEFAULT FALSE,
      rules_text TEXT NOT NULL DEFAULT '',
      stats_retention_days INTEGER NOT NULL DEFAULT 90,
      forbidden_words JSONB NOT NULL DEFAULT '[]'::jsonb,
      default_commands_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      welcome_button JSONB NOT NULL DEFAULT '{}'::jsonb,
      welcome_media JSONB NOT NULL DEFAULT '{}'::jsonb,
      goodbye_media JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_group_config_backups(
      id BIGSERIAL PRIMARY KEY,
      group_id BIGINT NOT NULL,
      created_by BIGINT NOT NULL,
      snapshot JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
}

export async function handleGroupConfigMessage(pool:Pool,msg:TgMessage,ownerIds:string[]){
  if(!msg.from)return false;
  const raw=clean(msg.text).replace(/^[/!]/,"").toLowerCase();
  if(!["config","پیکربندی"].includes(raw))return false;
  const uid=msg.from.id;
  if(msg.chat.type==="private"){
    const rows=(await pool.query("SELECT group_id,COALESCE(title,'گروه بدون نام') AS title FROM bot_customer_groups WHERE customer_id=$1 AND is_active=TRUE ORDER BY title",[uid]).catch(()=>({rows:[] as any[]}))).rows;
    if(rows.length===1){
      if(!(await groupAllowed(pool,uid,Number(rows[0].group_id)) && await groupAdmin(Number(rows[0].group_id),uid) && !(await isOwner(uid))))return send(msg.chat.id,title("دسترسی رد شد","⛂ - فقط مدیر گروه می‌تواند پیکربندی را باز کند."),keyboard([[neutral("‹ بازگشت","cfg:exit")]]))&&true;
      const gid=Number(rows[0].group_id);setSession(uid,gid,"open",{});await renderConfig(pool,msg.chat.id,undefined,gid,String(rows[0].title));return true;
    }
    if(rows.length>1)return await renderGroupPicker(pool,uid,msg.chat.id).then(()=>true);
    if(await isOwner(uid))return send(msg.chat.id,title("پیکربندی گروه","⛂ - در پیوی، ابتدا گروه موردنظر باید انتخاب شود."),keyboard([[neutral("انتخاب گروه","cfg:group_picker")],[neutral("‹ بازگشت","cfg:exit")]])).then(()=>true);
    return send(msg.chat.id,title("دسترسی رد شد","⛂ - هیچ گروه فعالی برای این حساب پیدا نشد."),keyboard([[neutral("‹ بازگشت","cfg:exit")]])).then(()=>true);
  }

  const gid=msg.chat.id;
  if(!(await groupAllowed(pool,uid,gid) || await isOwner(uid))){
    return send(msg.chat.id,title("دسترسی رد شد","⛂ - این گروه به حساب شما متصل نیست."),keyboard([[neutral("‹ بازگشت","cfg:exit")]])).then(()=>true);
  }
  if(!(await groupAdmin(gid,uid)) && !(await isOwner(uid))){
    return send(msg.chat.id,title("دسترسی رد شد","⛂ - فقط مدیر گروه می‌تواند پیکربندی را باز کند."),keyboard([[neutral("‹ بازگشت","cfg:exit")]])).then(()=>true);
  }
  setSession(uid,gid,"open",{});
  await renderConfig(pool,msg.chat.id,undefined,gid,msg.chat.title||String(gid));
  return true;
}

export async function handleGroupConfigInput(pool:Pool,msg:TgMessage){
  if(!msg.from)return false;
  const s=getSession(msg.from.id);
  if(!s)return false;
  const value=clean(msg.text);
  const gid=s.groupId;
  if(s.flow==="input"){
    const field=String(s.data.field||"");
    if(field==="stats_retention_days"){
      const n=Number(value);
      if(!Number.isInteger(n)||n<1||n>3650)return send(msg.chat.id,"مقدار نگهداری باید بین ۱ تا ۳۶۵۰ روز باشد.").then(()=>true);
      await saveField(pool,gid,field,n);
    }else if(field==="report_target_chat_id"||field==="new_account_days"){
      const n=Number(value);if(!Number.isSafeInteger(n))return send(msg.chat.id,"شناسه یا مقدار عددی معتبر نیست.").then(()=>true);
      if(field==="new_account_days"){
        await pool.query("UPDATE bot_group_settings SET new_account_days=$1,updated_at=NOW() WHERE group_id=$2",[Math.max(0,Math.min(3650,n)),gid]);
      }else await saveField(pool,gid,field,n);
    }else if(field==="timezone"){
      try{new Intl.DateTimeFormat("en-US",{timeZone:value}).format();}catch{return send(msg.chat.id,"منطقه زمانی نامعتبر است؛ نمونه: Asia/Tehran").then(()=>true);}
      await saveField(pool,gid,field,value);
    }else if(field==="quiet_start"||field==="quiet_end"){
      if(!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(value))return send(msg.chat.id,"ساعت باید با قالب HH:mm باشد.").then(()=>true);
      await saveField(pool,gid,field,value);
    }else if(field==="command_prefix"){
      await saveField(pool,gid,field,value.slice(0,5));
    }else if(field==="default_message"){
      await saveField(pool,gid,field,value.slice(0,2000));
    }else if(field==="forbidden_words"){
      const words=value.split(/[,،\\n]+/).map((x:string)=>x.trim().toLowerCase()).filter(Boolean).slice(0,200);
      await saveField(pool,gid,field,words);
    }else if(field==="welcome_text"||field==="goodbye_text"||field==="rules_text"){
      const col=field==="welcome_text"?"welcome_text":"goodbye_text";
      if(field==="rules_text"){
        await saveField(pool,gid,"rules_text",value.slice(0,4000));
        await pool.query("UPDATE bot_group_settings SET rules_on_join=TRUE,updated_at=NOW() WHERE group_id=$1",[gid]);
      }else{
        await pool.query("UPDATE bot_group_settings SET "+col+"=$1,updated_at=NOW() WHERE group_id=$2",[value.slice(0,4000),gid]);
      }
    }else if(field==="prefix"){
      await saveField(pool,gid,"command_prefix",value.slice(0,5));
    }
    clearSession(msg.from.id);
    return send(msg.chat.id,"✓ تنظیم با موفقیت ذخیره شد.").then(()=>true);
  }

  if(s.flow==="quiettimes"){
    if(!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(value))return send(msg.chat.id,"ساعت باید با قالب HH:mm باشد.").then(()=>true);
    if(s.data.step===1){s.data.step=2;s.expires=Date.now()+TTL;sessions.set(msg.from.id,s);await saveField(pool,gid,"quiet_start",value);return send(msg.chat.id,"⛂ - ساعت پایان سکوت را با قالب HH:mm ارسال کنید.").then(()=>true);}
    await saveField(pool,gid,"quiet_end",value);clearSession(msg.from.id);return send(msg.chat.id,"✓ بازه سکوت شب ذخیره شد.").then(()=>true);
  }

  if(s.flow==="media"){
    let fileId="";
    let type="";
    if(msg.photo?.length){fileId=String(msg.photo[msg.photo.length-1]?.file_id||"");type="photo";}
    else if(msg.video?.file_id){fileId=String(msg.video.file_id);type="video";}
    else if(msg.animation?.file_id){fileId=String(msg.animation.file_id);type="animation";}
    else if(msg.document?.file_id){fileId=String(msg.document.file_id);type="document";}
    if(!fileId)return send(msg.chat.id,"رسانه معتبر ارسال کنید؛ عکس، ویدیو، گیف یا فایل.").then(()=>true);
    await saveField(pool,gid,s.data.target==="welcome"?"welcome_media":"goodbye_media",{type,file_id:fileId});
    clearSession(msg.from.id);return send(msg.chat.id,"✓ رسانه ذخیره شد.").then(()=>true);
  }

  if(s.flow==="warning_threshold"){
    const n=Math.max(1,Math.min(100,Number(value)||0));if(!n)return send(msg.chat.id,"عدد معتبر بین ۱ تا ۱۰۰ ارسال کنید.").then(()=>true);
    await pool.query("UPDATE warning_system_settings SET permanent_threshold=$1,updated_at=NOW() WHERE group_id=$2",[n,gid]);
    clearSession(msg.from.id);return send(msg.chat.id,"✓ آستانه بن نهایی ذخیره شد.").then(()=>true);
  }

  if(s.flow==="warning_level"){
    const step=Number(s.data.step||1),level=Number(s.data.level||0);
    if(step===1){
      const n=Number(value);if(!Number.isInteger(n)||n<1||n>5)return send(msg.chat.id,"شماره سطح باید بین ۱ تا ۵ باشد.").then(()=>true);
      s.data.level=n;s.data.step=2;s.expires=Date.now()+TTL;sessions.set(msg.from.id,s);
      return send(msg.chat.id,title("ویرایش سطح اخطار","نوع جریمه را انتخاب کنید."),keyboard([
        [neutral("سکوت","cfg:warning:pen:"+n+":mute"),neutral("محدودیت","cfg:warning:pen:"+n+":restrict")],
        [neutral("بن موقت","cfg:warning:pen:"+n+":temp_ban"),neutral("بن دائمی","cfg:warning:pen:"+n+":permanent_ban")],
        [back("cfg:warnings")]
      ])).then(()=>true);
    }
    if(step===3){
      if(String(s.data.penalty)==="permanent_ban"){await pool.query("UPDATE warning_levels SET penalty_type='permanent_ban',duration_value=NULL,duration_unit=NULL,enabled=TRUE,updated_at=NOW() WHERE group_id=$1 AND level_no=$2",[gid,level]);}
      else{
        const parts=value.toLowerCase().split(/\\s+/);const duration=Number(parts[0]);const unit=parts[1]==="day"||parts[1]==="days"||parts[1]==="روز"?"days":"hours";
        if(!Number.isInteger(duration)||duration<1||duration>3650)return send(msg.chat.id,"مدت معتبر نیست؛ نمونه: 6 hours").then(()=>true);
        await pool.query("UPDATE warning_levels SET penalty_type=$3,duration_value=$4,duration_unit=$5,enabled=TRUE,updated_at=NOW() WHERE group_id=$1 AND level_no=$2",[gid,level,s.data.penalty,duration,unit]);
      }
      clearSession(msg.from.id);return send(msg.chat.id,"✓ سطح اخطار به‌روزرسانی شد.").then(()=>true);
    }
  }
  return false;
}

export async function handleGroupConfigCallback(pool:Pool,cb:TgCallback){
  if(!cb.message)return;
  const uid=cb.from.id,msg=cb.message,data=clean(cb.data);
  const s=getSession(uid);
  let gid=Number(s?.groupId||0);
  if(data==="cfg:exit"){clearSession(uid);return edit(msg.chat.id,msg.message_id,"✓ از پنل پیکربندی خارج شدید.",undefined);}
  if(data==="cfg:group_picker")return renderGroupPicker(pool,uid,msg.chat.id);

  if(data.startsWith("cfg:group:")){
    const selected=Number(data.slice(10));
    if(!Number.isSafeInteger(selected))return;
    if(!(await groupAllowed(pool,uid,selected)||await isOwner(uid)))return edit(msg.chat.id,msg.message_id,title("دسترسی رد شد","⛂ - این گروه برای حساب شما فعال نیست."),keyboard([[back("cfg:exit")]]));
    if(!(await groupAdmin(selected,uid))&&!(await isOwner(uid)))return edit(msg.chat.id,msg.message_id,title("دسترسی رد شد","⛂ - فقط مدیر گروه مجاز است."),keyboard([[back("cfg:exit")]]));
    setSession(uid,selected,"open",{});
    const chat=await telegramApi<any>("getChat",{chat_id:selected});
    return renderConfig(pool,msg.chat.id,msg.message_id,selected,chat.ok?String(chat.result?.title||selected):String(selected));
  }

  if(!data.startsWith("cfg:"))return false;
  if(!gid){
    if(data==="cfg:home"||data==="cfg:general"||data==="cfg:locks"||data==="cfg:warnings"||data==="cfg:welcome"||data==="cfg:commands"||data==="cfg:stats"||data==="cfg:security"||data==="cfg:schedule"||data==="cfg:backup"||data==="cfg:reset"){
      const rows=(await pool.query("SELECT group_id,COALESCE(title,'گروه بدون نام') title FROM bot_customer_groups WHERE customer_id=$1 AND is_active=TRUE LIMIT 50",[uid]).catch(()=>({rows:[] as any[]}))).rows;
      if(rows.length===1)gid=Number(rows[0].group_id);else return renderGroupPicker(pool,uid,msg.chat.id);
      setSession(uid,gid,"open",{});
    }
  }
  if(!gid)return false;
  if(!(await groupAllowed(pool,uid,gid)||await isOwner(uid)))return false;
  if(!(await groupAdmin(gid,uid))&&!(await isOwner(uid)))return false;

  if(data==="cfg:home"){
    const chat=msg.chat.type==="private"?await telegramApi<any>("getChat",{chat_id:gid}):null;
    return renderConfig(pool,msg.chat.id,msg.message_id,gid,chat?.ok?String(chat.result?.title||gid):msg.chat.title||String(gid));
  }
  if(data==="cfg:general")return generalPage(pool,msg.chat.id,msg.message_id,gid);
  if(data==="cfg:locks")return locksPage(pool,msg.chat.id,msg.message_id,gid);
  if(data==="cfg:warnings")return warningsPage(pool,msg.chat.id,msg.message_id,gid);
  if(data==="cfg:welcome")return welcomePage(pool,msg.chat.id,msg.message_id,gid);
  if(data==="cfg:commands")return commandsPage(pool,msg.chat.id,msg.message_id,gid);
  if(data==="cfg:stats")return statsPage(pool,msg.chat.id,msg.message_id,gid,uid);
  if(data==="cfg:security")return securityPage(pool,msg.chat.id,msg.message_id,gid);
  if(data==="cfg:schedule")return schedulePage(pool,msg.chat.id,msg.message_id,gid);

  if(data==="cfg:language"){
    const current=await getGroupLanguage(pool,gid,"fa");
    const rows=SUPPORTED_LANGUAGES.map(x=>{
      const b=x.code===current
        ? styledGlassButton(x.native,"cfg:setlang:"+x.code,"success")
        : glassButton(x.native,"cfg:setlang:"+x.code);
      return [b];
    });
    rows.push([back("cfg:general")]);
    return edit(msg.chat.id,msg.message_id,title("زبان ربات","⛂ - زبان فعلی : "+languageNative(current)),{inline_keyboard:rows});
  }
  if(data.startsWith("cfg:setlang:")){
    const code=data.slice(12);
    if(!SUPPORTED_LANGUAGES.some(x=>x.code===code))return;
    await setGroupLanguage(pool,gid,code as any);
    return generalPage(pool,msg.chat.id,msg.message_id,gid);
  }

  if(data==="cfg:toggle:notifications"||data==="cfg:toggle:quiet"||data==="cfg:toggle:default_commands"||data==="cfg:stats:toggle"||data==="cfg:stats:daily"){
    const {config}=await loadConfig(pool,gid);
    const field=data==="cfg:toggle:notifications"?"system_notifications":
      data==="cfg:toggle:quiet"?"quiet_mode_enabled":
      data==="cfg:toggle:default_commands"?"default_commands_enabled":
      data==="cfg:stats:toggle"?"report_enabled":"daily_report_enabled";
    const next=config[field]!==true;
    await saveField(pool,gid,field,next);
    if(field==="daily_report_enabled")await reportSchedule(pool,gid,uid,next,Number(config.report_target_chat_id||gid));
    return field.startsWith("report")||field==="daily_report_enabled"
      ?statsPage(pool,msg.chat.id,msg.message_id,gid,uid)
      :generalPage(pool,msg.chat.id,msg.message_id,gid);
  }

  if(data==="cfg:quiettimes"){
    const {config}=await loadConfig(pool,gid);setSession(uid,gid,"quiettimes",{step:1});
    return edit(msg.chat.id,msg.message_id,title("ساعت سکوت شب","⛂ - ساعت شروع فعلی : "+config.quiet_start+"\n⛂ - ساعت شروع جدید را با قالب HH:mm ارسال کنید."),keyboard([[back("cfg:general")]]));
  }

  if(data.startsWith("cfg:input:")){
    const field=data.slice(10);
    if(field==="report_target"||field==="new_account_days"||field==="retention") {
      const dbField=field==="report_target"?"report_target_chat_id":field==="retention"?"stats_retention_days":"new_account_days";
      setSession(uid,gid,"input",{field:dbField});
      return edit(msg.chat.id,msg.message_id,title("تنظیم مقدار","⛂ - مقدار جدید را ارسال کنید."),keyboard([[back(field==="new_account_days"?"cfg:security":"cfg:stats")]]));
    }
    const allowed=["prefix","timezone","default_message","welcome_text","goodbye_text","rules_text"];
    const map:any={prefix:"command_prefix",timezone:"timezone",default_message:"default_message"};
    const dbField=map[field]||field;
    if(!allowed.includes(field))return;
    setSession(uid,gid,"input",{field:dbField});
    return edit(msg.chat.id,msg.message_id,title("تنظیم مقدار","مقدار جدید را ارسال کنید."),keyboard([[back(field.includes("welcome")?"cfg:welcome":"cfg:general")]]));
  }

  if(data==="cfg:forbidden"){
    const {config}=await loadConfig(pool,gid);
    const list=Array.isArray(config.forbidden_words)?config.forbidden_words:[];
    return edit(msg.chat.id,msg.message_id,title("کلمات ممنوعه",
      list.length?list.map((x:string)=>"⛂ - "+x).join("\n"):"⛂ - فهرست خالی است."
    ),keyboard([
      [neutral("ویرایش فهرست","cfg:forbidden:edit")],
      [neutral("پاک‌سازی فهرست","cfg:forbidden:clear")],
      [back("cfg:locks")]
    ]));
  }
  if(data==="cfg:forbidden:edit"){
    setSession(uid,gid,"input",{field:"forbidden_words"});
    return edit(msg.chat.id,msg.message_id,title("کلمات ممنوعه","⛂ - کلمات را با ویرگول جدا کنید."),keyboard([[back("cfg:forbidden")]]));
  }
  if(data==="cfg:forbidden:clear"){
    await saveField(pool,gid,"forbidden_words",[]);
    return edit(msg.chat.id,msg.message_id,"✓ فهرست کلمات ممنوعه پاک شد.",keyboard([[back("cfg:forbidden")]]));
  }

  if(data.startsWith("cfg:warning:toggle:")){
    const field=data.slice(19);
    const current=(await pool.query("SELECT "+field+" FROM warning_system_settings WHERE group_id=$1",[gid])).rows[0]?.[field]===true;
    await pool.query("UPDATE warning_system_settings SET "+field+"=$1,updated_at=NOW() WHERE group_id=$2",[!current,gid]);
    return warningsPage(pool,msg.chat.id,msg.message_id,gid);
  }
  if(data==="cfg:warning:threshold"){
    setSession(uid,gid,"warning_threshold",{});
    return edit(msg.chat.id,msg.message_id,title("آستانه بن نهایی","عدد اخطار نهایی را ارسال کنید."),keyboard([[back("cfg:warnings")]]));
  }
  if(data==="cfg:warning:levels"){
    const rows=await pool.query("SELECT level_no,warning_count_required,penalty_type,duration_value,duration_unit FROM warning_levels WHERE group_id=$1 ORDER BY level_no",[gid]);
    const kbrows=rows.rows.map((r:any)=>[neutral("سطح "+r.level_no,"cfg:warning:edit:"+r.level_no)]);
    kbrows.push([back("cfg:warnings")]);
    return edit(msg.chat.id,msg.message_id,title("سطوح اخطار",rows.rows.map((r:any)=>"⛂ - سطح "+r.level_no+" : "+r.warning_count_required+" اخطار · "+r.penalty_type+(r.duration_value?(" · "+r.duration_value+" "+r.duration_unit):"")).join("\n")),keyboard(kbrows));
  }
  if(data.startsWith("cfg:warning:edit:")){
    const level=Number(data.slice(17));if(!Number.isInteger(level)||level<1||level>5)return;
    setSession(uid,gid,"warning_level",{step:1,level});
    return edit(msg.chat.id,msg.message_id,title("ویرایش سطح اخطار","شماره سطح: "+level+"\nشماره سطح برای ویرایش را دوباره ارسال کنید."),keyboard([[back("cfg:warning:levels")]]));
  }
  if(data.startsWith("cfg:warning:pen:")){
    const parts=data.split(":");const level=Number(parts[3]),penalty=parts[4];
    const s2=getSession(uid);if(!s2||s2.flow!=="warning_level"||Number(s2.data.level)!==level)return;
    s2.data.penalty=penalty;s2.data.step=3;sessions.set(uid,{...s2,expires:Date.now()+TTL});
    if(penalty==="permanent_ban"){
      await pool.query("UPDATE warning_levels SET penalty_type='permanent_ban',duration_value=NULL,duration_unit=NULL,enabled=TRUE,updated_at=NOW() WHERE group_id=$1 AND level_no=$2",[gid,level]);
      clearSession(uid);return warningsPage(pool,msg.chat.id,msg.message_id,gid);
    }
    return edit(msg.chat.id,msg.message_id,title("مدت جریمه","مدت را با قالب «عدد واحد» ارسال کنید؛ نمونه: 6 hours یا 2 روز."),keyboard([[back("cfg:warning:levels")]]));
  }

  if(data==="cfg:welcome:toggle:welcome_enabled"||data==="cfg:welcome:toggle:rules_on_join"||data==="cfg:welcome:toggle:pv_welcome"||data==="cfg:welcome:toggle:membership_verification"){
    const field=data.slice("cfg:welcome:toggle:".length);
    if(field==="membership_verification"){
      const current=(await loadConfig(pool,gid)).config.membership_verification===true;
      await saveField(pool,gid,field,!current);
    }else{
      const current=(await pool.query("SELECT "+field+" FROM bot_group_settings WHERE group_id=$1",[gid])).rows[0]?.[field]===true;
      await pool.query("UPDATE bot_group_settings SET "+field+"=$1,updated_at=NOW() WHERE group_id=$2",[!current,gid]);
    }
    return welcomePage(pool,msg.chat.id,msg.message_id,gid);
  }

  if(data==="cfg:media:welcome"||data==="cfg:media:goodbye"){
    setSession(uid,gid,"media",{target:data.endsWith("welcome")?"welcome":"goodbye"});
    return edit(msg.chat.id,msg.message_id,title("ثبت رسانه","رسانه را همین‌جا ارسال کنید؛ عکس، ویدیو، گیف یا فایل."),keyboard([[back("cfg:welcome")]]));
  }

  if(data.startsWith("cfg:security:")){
    const mode=data.slice(13);
    await ensureContentLocks(pool,gid);
    if(mode==="full_lock"||mode==="invite"||mode==="emergency"){
      const col=mode==="full_lock"?"full_lock":mode==="invite"?"invite_protection":"emergency_mode";
      const current=(await pool.query("SELECT "+col+" FROM bot_group_settings WHERE group_id=$1",[gid])).rows[0]?.[col]===true;
      const next=!current;
      if(mode==="full_lock"){
        const permissions=next
          ?{can_send_messages:false,can_send_audios:false,can_send_documents:false,can_send_photos:false,can_send_videos:false,can_send_video_notes:false,can_send_voice_notes:false,can_send_polls:false,can_send_other_messages:false,can_add_web_page_previews:false}
          :{can_send_messages:true,can_send_audios:true,can_send_documents:true,can_send_photos:true,can_send_videos:true,can_send_video_notes:true,can_send_voice_notes:true,can_send_polls:true,can_send_other_messages:true,can_add_web_page_previews:true};
        const tg=await telegramApi("setChatPermissions",{chat_id:gid,permissions,use_independent_chat_permissions:true});
        if(!tg.ok)return edit(msg.chat.id,msg.message_id,title("مرکز امنیت","⛂ - Telegram : "+(tg.description||"خطا")),keyboard([[back("cfg:security")]]));
      }
      await pool.query("INSERT INTO bot_group_settings(group_id,"+col+") VALUES($1,$2) ON CONFLICT(group_id) DO UPDATE SET "+col+"=EXCLUDED."+col+",updated_at=NOW()",[gid,next]);
      return securityPage(pool,msg.chat.id,msg.message_id,gid);
    }
    const mappings:any={
      antibot:["content_lock_rules","normal_bot"],
      joinflood:["content_lock_rules","attack_join_flood"]
    };
    if(mappings[mode]){
      const [,key]=mappings[mode];
      const current=(await pool.query("SELECT enabled FROM content_lock_rules WHERE group_id=$1 AND rule_key=$2",[gid,key])).rows[0]?.enabled===true;
      await pool.query("UPDATE content_lock_rules SET enabled=$1,updated_at=NOW() WHERE group_id=$2 AND rule_key=$3",[!current,gid,key]);
      return securityPage(pool,msg.chat.id,msg.message_id,gid);
    }
    if(mode==="scan"){
      const [warn,events]=await Promise.all([
        pool.query("SELECT COUNT(*)::int n FROM warning_cases WHERE group_id=$1 AND warning_count>0",[gid]).catch(()=>({rows:[{n:0}]})),
        pool.query("SELECT COUNT(*)::int n FROM supervision_events WHERE group_id=$1 AND severity IN ('warning','critical') AND created_at>=NOW()-INTERVAL '7 days'",[gid]).catch(()=>({rows:[{n:0}]}))
      ]);
      return edit(msg.chat.id,msg.message_id,title("اسکن اعضای مشکوک",
        "⛂ - اعضای دارای اخطار فعال : "+Number(warn.rows[0]?.n||0)+
        "\n⛂ - هشدارهای امنیتی ۷ روز اخیر : "+Number(events.rows[0]?.n||0)+
        "\n\nاین گزارش بر اساس داده‌های ثبت‌شده ربات تهیه شده است."
      ),keyboard([[back("cfg:security")]]));
    }
  }

  if(data==="cfg:stats:purge"){
    setSession(uid,gid,"stats_purge_confirm1",{});
    return edit(msg.chat.id,msg.message_id,title("پاک‌سازی آمار","مرحله ۱ از ۲\n\nرویدادهای آماری قدیمی‌تر از مدت نگهداری حذف می‌شوند؛ لاگ‌های ممیزی و سابقه اخطار حفظ می‌شوند."),keyboard([
      [neutral("ادامه پاک‌سازی","cfg:stats:purge:confirm1")],
      [back("cfg:stats")]
    ]));
  }
  if(data==="cfg:stats:purge:confirm1"){
    const ss=getSession(uid);if(!ss||ss.flow!=="stats_purge_confirm1")return;
    setSession(uid,gid,"stats_purge_confirm2",{});
    return edit(msg.chat.id,msg.message_id,title("تأیید نهایی پاک‌سازی","مرحله ۲ از ۲\n\nآمار قدیمی به‌صورت دائمی حذف می‌شود."),keyboard([
      [neutral("پاک‌سازی نهایی","cfg:stats:purge:confirm2")],
      [back("cfg:stats")]
    ]));
  }
  if(data==="cfg:stats:purge:confirm2"){
    const ss=getSession(uid);if(!ss||ss.flow!=="stats_purge_confirm2")return;
    const keep=(await loadConfig(pool,gid)).config.stats_retention_days||90;
    const cutoff=Math.min(3650,Math.max(1,Number(keep)));
    const results:any[]=[];
    for(const table of ["supervision_events","content_lock_logs"]){
      try{
        const q=await pool.query("DELETE FROM "+table+" WHERE group_id=$1 AND created_at < NOW() - ($2 * INTERVAL '1 day')",[gid,cutoff]);
        results.push((q.rowCount||0));
      }catch{results.push(0);}
    }
    clearSession(uid);
    return edit(msg.chat.id,msg.message_id,"✓ پاک‌سازی انجام شد. موارد حذف‌شده: "+results.reduce((a,b)=>a+b,0),keyboard([[back("cfg:stats")]]));
  }

  if(data==="cfg:backup")return renderBackups(pool,msg.chat.id,msg.message_id,gid);
  if(data==="cfg:backup:make"){
    const snapshot=await snapshotGroup(pool,gid);
    const row=(await pool.query("INSERT INTO bot_group_config_backups(group_id,created_by,snapshot) VALUES($1,$2,$3::jsonb) RETURNING id,created_at",[gid,uid,JSON.stringify(snapshot)])).rows[0];
    await pool.query("INSERT INTO audit_logs(actor_id,action,target,after_data,source) VALUES($1,'group_config_backup_created',$2,$3::jsonb,'telegram_panel')",[String(uid),String(gid),JSON.stringify({backupId:row.id})]).catch(()=>{});
    return renderBackups(pool,msg.chat.id,msg.message_id,gid);
  }
  if(data.startsWith("cfg:backup:restore:")){
    const id=Number(data.slice(19));if(!Number.isSafeInteger(id))return;
    const row=(await pool.query("SELECT id FROM bot_group_config_backups WHERE id=$1 AND group_id=$2",[id,gid])).rows[0];
    if(!row)return;
    setSession(uid,gid,"restore_confirm",{backupId:id});
    return edit(msg.chat.id,msg.message_id,title("بازیابی تنظیمات","مرحله ۱ از ۲\n\nبازیابی، تنظیمات فعلی این گروه را با پشتیبان انتخاب‌شده جایگزین می‌کند."),keyboard([
      [neutral("تأیید بازیابی","cfg:backup:restore_confirm")],
      [back("cfg:backup")]
    ]));
  }
  if(data==="cfg:backup:restore_confirm"){
    const ss=getSession(uid);if(!ss||ss.flow!=="restore_confirm")return;
    await restoreGroup(pool,gid,await pool.query("SELECT snapshot FROM bot_group_config_backups WHERE id=$1 AND group_id=$2",[ss.data.backupId,gid]).then(r=>r.rows[0]?.snapshot));
    clearSession(uid);
    return edit(msg.chat.id,msg.message_id,"✓ بازیابی تنظیمات انجام شد.",keyboard([[back("cfg:home")]]));
  }

  if(data==="cfg:reset"){
    setSession(uid,gid,"reset_confirm1",{});
    return edit(msg.chat.id,msg.message_id,title("بازنشانی تنظیمات","مرحله ۱ از ۲\n\nتمام تنظیمات مدیریتی این گروه به پیش‌فرض برمی‌گردد؛ سابقه اخطار و لاگ‌ها حذف نمی‌شوند."),keyboard([
      [neutral("ادامه بازنشانی","cfg:reset:confirm1")],
      [back("cfg:home")]
    ]));
  }
  if(data==="cfg:reset:confirm1"){
    const ss=getSession(uid);if(!ss||ss.flow!=="reset_confirm1")return;
    setSession(uid,gid,"reset_confirm2",{});
    return edit(msg.chat.id,msg.message_id,title("تأیید نهایی بازنشانی","مرحله ۲ از ۲\n\nاین عملیات برگشت‌پذیر نیست؛ قبل از ادامه از تنظیمات پشتیبان بگیرید."),keyboard([
      [neutral("بازنشانی نهایی","cfg:reset:confirm2")],
      [back("cfg:home")]
    ]));
  }
  if(data==="cfg:reset:confirm2"){
    const ss=getSession(uid);if(!ss||ss.flow!=="reset_confirm2")return;
    await resetGroup(pool,gid);
    clearSession(uid);
    return edit(msg.chat.id,msg.message_id,"✓ تمام تنظیمات مدیریتی گروه به حالت پیش‌فرض برگشت.",keyboard([[back("cfg:home")]]));
  }

  return false;
}
