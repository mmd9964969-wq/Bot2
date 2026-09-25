import type { Pool } from "pg";
import { telegramApi } from "../telegram/api.ts";
import { ensureContentLocks } from "./content-locks.ts";
import type { Rank } from "./registry.ts";
import { executeRuntimeAction, isRuntimeMaintenance } from "../../bot/runtime-control.ts";
import { bindPanelMessage, currentPanelScope, touchPanelMessage, unbindPanelMessage } from "./panel-session.ts";
import { glassKeyboard } from "./panel-design.ts";

type TgMessage={message_id:number;chat:{id:number;type:string;title?:string};from?:{id:number;first_name?:string;username?:string};text?:string;caption?:string};
type TgCallback={id:string;from:{id:number;first_name?:string;username?:string};message?:TgMessage;data?:string};
type AdvSession={flow:string;data:Record<string,any>;expires:number};

const sessions=new Map<number,AdvSession>();
const automationCooldown=new Map<string,number>();
const scheduleLock=new Set<string>();

const MODULES=[
  ["locks","قفل و فیلتر"],["security","امنیت"],["warnings","اخطار و جریمه"],["members","اعضای گروه"],
  ["welcome","خوش‌آمدگویی"],["commands","دستورات"],["automation","اتوماسیون"],["content","استودیو محتوا"],
  ["schedule","زمان‌بندی"],["analytics","تحلیل و آمار"],["exceptions","استثناها"],["permissions","دسترسی‌ها"],
  ["health","سلامت ربات"],["audit","ممیزی و لاگ"]
] as const;
const ROLES=["OWNER","SUDO","ADMIN","MEMBER"];

function kb(rows:string[][][]){return glassKeyboard(rows);}
function frame(title:string,lines:string[]=[]){return ["━━━━━━━━━━━━━━━━━━━━━━━━","◈ "+title,"━━━━━━━━━━━━━━━━━━━━━━━━","",...lines].join("\n");}
function info(label:string,value:any){return "⛂ - "+label+" : "+String(value??"—");}
function state(v:boolean){return v?"● فعال":"○ خاموش";}
function dateFa(v:any){return new Date(v).toLocaleString("fa-IR",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});}
function setSession(uid:number,flow:string,data:Record<string,any>={}){sessions.set(uid,{flow,data,expires:Date.now()+10*60*1000});}
function getSession(uid:number){const s=sessions.get(uid);if(!s||s.expires<Date.now()){sessions.delete(uid);return null;}return s;}
function clearSession(uid:number){sessions.delete(uid);}
function sleep(ms:number){return new Promise(r=>setTimeout(r,ms));}
async function answer(id:string){await telegramApi("answerCallbackQuery",{callback_query_id:id});}
async function send(chatId:number,message:string,markup:any=null){
  const r=await telegramApi("sendMessage",{chat_id:chatId,text:message,reply_markup:markup});
  const scope=currentPanelScope();
  if(r.ok&&scope&&markup?.inline_keyboard){const mid=Number((r.result as any)?.message_id);if(Number.isSafeInteger(mid)&&mid>0)await bindPanelMessage(scope.pool,chatId,mid,scope.userId,"advanced");}
  return r;
}
async function edit(chatId:number,messageId:number,message:string,markup:any=null){
  await sleep(75);
  const r=await telegramApi("editMessageText",{chat_id:chatId,message_id:messageId,text:message,reply_markup:markup});
  const scope=currentPanelScope();
  if(r.ok&&scope){if(markup?.inline_keyboard)await touchPanelMessage(scope.pool,chatId,messageId,scope.userId);else await unbindPanelMessage(scope.pool,chatId,messageId,scope.userId);}
  return r;
}

export async function ensureAdvancedPanelSchema(pool:Pool){
  await pool.query("CREATE TABLE IF NOT EXISTS bot_group_automations (id BIGSERIAL PRIMARY KEY,group_id BIGINT NOT NULL,name TEXT NOT NULL,trigger_type TEXT NOT NULL DEFAULT 'keyword',trigger_value TEXT NOT NULL,action_type TEXT NOT NULL,action_payload TEXT NOT NULL DEFAULT '',cooldown_seconds INTEGER NOT NULL DEFAULT 10 CHECK(cooldown_seconds BETWEEN 0 AND 86400),enabled BOOLEAN NOT NULL DEFAULT TRUE,created_by BIGINT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS bot_group_permissions (group_id BIGINT NOT NULL,role TEXT NOT NULL,module TEXT NOT NULL,enabled BOOLEAN NOT NULL DEFAULT TRUE,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(group_id,role,module))");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_bot_group_automations_group ON bot_group_automations(group_id,enabled)");
}
async function seedPermissions(pool:Pool,groupId:number){
  await pool.query("INSERT INTO bot_group_permissions(group_id,role,module,enabled) SELECT $1,r,m,TRUE FROM unnest($2::text[]) r CROSS JOIN unnest($3::text[]) m ON CONFLICT(group_id,role,module) DO NOTHING",[groupId,ROLES,MODULES.map(x=>x[0])]);
}
async function moduleAllowed(pool:Pool,groupId:number,role:string,module:string){
  if(role==="OWNER"||role==="SUDO")return true;
  await seedPermissions(pool,groupId);
  const r=await pool.query("SELECT enabled FROM bot_group_permissions WHERE group_id=$1 AND role=$2 AND module=$3",[groupId,role,module]);
  return r.rowCount?Boolean(r.rows[0].enabled):true;
}
async function roleFor(pool:Pool,groupId:number,userId:number,isOwner:boolean){
  if(isOwner)return "OWNER";
  const r=await telegramApi<any>("getChatMember",{chat_id:groupId,user_id:userId});
  return ["administrator","creator"].includes(String(r.result?.status||""))?"ADMIN":"MEMBER";
}
function moduleFor(data:string){
  if(data.startsWith("adv:auto")||data==="c:automation")return "automation";
  if(data.startsWith("adv:perm")||data==="c:permissions")return "permissions";
  if(data.startsWith("adv:exc")||data==="c:exceptions")return "exceptions";
  if(data.startsWith("adv:sec")||data==="adv:security"||data==="c:security")return "security";
  if(data==="c:analytics")return "analytics";
  if(data==="c:audit")return "audit";
  if(data==="c:health")return "health";
  if(data==="c:content")return "content";
  return null;
}

async function overview(pool:Pool,groupId:number){
  await ensureContentLocks(pool,groupId);
  const [g,r,w,s,a]=await Promise.all([
    telegramApi<any>("getChat",{chat_id:groupId}),
    pool.query("SELECT COUNT(*)::int total,SUM(CASE WHEN enabled THEN 1 ELSE 0 END)::int active FROM content_lock_rules WHERE group_id=$1",[groupId]),
    pool.query("SELECT COUNT(*)::int n FROM warning_cases WHERE group_id=$1 AND warning_count>0",[groupId]),
    pool.query("SELECT COUNT(*)::int n FROM bot_schedules WHERE group_id=$1 AND enabled=TRUE",[groupId]),
    pool.query("SELECT COUNT(*)::int n FROM bot_group_automations WHERE group_id=$1 AND enabled=TRUE",[groupId])
  ]);
  const c=await telegramApi<any>("getChatMemberCount",{chat_id:groupId});
  return frame("Cᴏɴᴛʀᴏʟ Cᴇɴᴛᴇʀ",[
    info("گروه",g.result?.title||"—"),info("شناسه",groupId),info("اعضا",c.result??"—"),
    info("قفل‌های فعال",(r.rows[0]?.active||0)+" / "+(r.rows[0]?.total||0)),
    info("اخطارهای فعال",w.rows[0]?.n||0),info("زمان‌بندی فعال",s.rows[0]?.n||0),info("اتوماسیون فعال",a.rows[0]?.n||0),
    "","─────━━───── ◈ ─────━━─────","همه شاخص‌ها زنده از PostgreSQL و Telegram خوانده می‌شوند."
  ]);
}
async function contentView(pool:Pool,groupId:number){
  await ensureContentLocks(pool,groupId);
  const r=await pool.query("SELECT section,COUNT(*)::int total,SUM(CASE WHEN enabled THEN 1 ELSE 0 END)::int active FROM content_lock_rules WHERE group_id=$1 GROUP BY section ORDER BY section",[groupId]);
  return frame("Cᴏɴᴛᴇɴᴛ Sᴛᴜᴅɪᴏ",[
    info("کل قوانین",r.rows.reduce((n:number,x:any)=>n+Number(x.total||0),0)),
    info("کل فعال",r.rows.reduce((n:number,x:any)=>n+Number(x.active||0),0)),
    "",...r.rows.map((x:any)=>"⛂ - "+x.section+" : "+x.active+" / "+x.total),
    "","استودیو محتوا مستقیماً به Lock Center متصل است."
  ]);
}
async function analyticsView(pool:Pool,groupId:number){
  const [v,d,w,e,a]=await Promise.all([
    pool.query("SELECT COUNT(*)::int n FROM content_lock_logs WHERE group_id=$1 AND created_at>=NOW()-INTERVAL '24 hours'",[groupId]),
    pool.query("SELECT COUNT(*)::int n FROM content_lock_logs WHERE group_id=$1 AND action LIKE 'delete%' AND created_at>=NOW()-INTERVAL '24 hours'",[groupId]),
    pool.query("SELECT COUNT(*)::int n FROM warning_events WHERE group_id=$1 AND created_at>=NOW()-INTERVAL '24 hours'",[groupId]),
    pool.query("SELECT COUNT(*)::int n FROM supervision_events WHERE group_id=$1 AND created_at>=NOW()-INTERVAL '24 hours'",[groupId]),
    pool.query("SELECT COUNT(*)::int n FROM bot_group_automations WHERE group_id=$1 AND enabled=TRUE",[groupId])
  ]);
  return frame("Aɴᴀʟʏᴛɪᴄs Cᴇɴᴛᴇʀ",[info("تخلف‌های ۲۴ ساعت",v.rows[0]?.n||0),info("حذف‌های واقعی",d.rows[0]?.n||0),info("رویداد اخطار",w.rows[0]?.n||0),info("رویداد نظارتی",e.rows[0]?.n||0),info("اتوماسیون فعال",a.rows[0]?.n||0),"","اعداد این بخش از لاگ‌های عملیاتی محاسبه می‌شوند."]);
}
async function healthView(pool:Pool,groupId:number){
  let db="متصل";try{await pool.query("SELECT 1");}catch{db="خطا";}
  const me=await telegramApi<any>("getMe",{});const member=me.ok?await telegramApi<any>("getChatMember",{chat_id:groupId,user_id:me.result.id}):null;
  return frame("Bᴏᴛ Hᴇᴀʟᴛʜ",[info("PostgreSQL",db),info("Telegram API",me.ok?"متصل":"خطا"),info("دسترسی ربات",member?.ok?member.result?.status:"نامشخص"),info("Node",process.version),info("Uptime",Math.floor(process.uptime())+" sec"),info("RAM",Math.round(process.memoryUsage().rss/1048576)+" MB")]);
}
async function auditView(pool:Pool,groupId:number){
  const r=await pool.query("SELECT action,target,created_at FROM audit_logs WHERE target=$1 OR after_data->>'groupId'=$1 ORDER BY created_at DESC LIMIT 30",[String(groupId)]);
  return frame("Aᴜᴅɪᴛ Cᴇɴᴛᴇʀ",r.rows.length?r.rows.map((x:any)=>"⛂ - "+dateFa(x.created_at)+" · "+x.action+" · "+(x.target||"—")):["رویدادی برای نمایش ثبت نشده است."]);
}
async function automationView(pool:Pool,groupId:number){
  const r=await pool.query("SELECT id,name,trigger_value,action_type,cooldown_seconds,enabled FROM bot_group_automations WHERE group_id=$1 ORDER BY id DESC",[groupId]);
  return frame("Aᴜᴛᴏᴍᴀᴛɪᴏɴ Cᴇɴᴛᴇʀ",r.rows.length?r.rows.map((x:any)=>"⛂ - #"+x.id+" · "+x.name+" · "+x.trigger_value+" · "+x.action_type+" · "+state(Boolean(x.enabled))):["اتوماسیونی ثبت نشده است."]);
}
async function exceptionsView(pool:Pool,groupId:number){
  const r=await pool.query("SELECT id,exception_type,target_id,target_label,scope,enabled FROM content_lock_exceptions WHERE group_id=$1 ORDER BY id DESC LIMIT 50",[groupId]);
  return frame("E.xᴄᴇᴘᴛɪᴏɴ Cᴇɴᴛᴇʀ",r.rows.length?r.rows.map((x:any)=>"⛂ - #"+x.id+" · "+x.exception_type+" · "+(x.target_label||x.target_id)+" · "+state(Boolean(x.enabled))):["استثنایی ثبت نشده است."]);
}
async function permissionsView(pool:Pool,groupId:number,role:string){
  await seedPermissions(pool,groupId);
  const r=await pool.query("SELECT module,enabled FROM bot_group_permissions WHERE group_id=$1 AND role=$2 ORDER BY module",[groupId,role]);
  return {text:frame("Pᴇʀᴍɪssɪᴏɴ Cᴇɴᴛᴇʀ",[info("نقش",role),info("فعال",r.rows.filter((x:any)=>x.enabled).length+" / "+r.rows.length),"",...r.rows.map((x:any)=>"⛂ - "+(MODULES.find(m=>m[0]===x.module)?.[1]||x.module)+" : "+state(Boolean(x.enabled)))]),
    rows:r.rows.map((x:any)=>[[(x.enabled?"فعال":"غیرفعال"),"adv:perm:set:"+role+":"+x.module+":"+(x.enabled?"off":"on")]]).concat([ [["‹ بازگشت","c:permissions"]] ])};
}

export async function handleAdvancedCustomerCallback(pool:Pool,cb:TgCallback,ownerIds:string[],groupId:number){
  const msg=cb.message;if(!msg)return false;const data=String(cb.data||"");
  const handled=data==="c:overview"||data==="c:content"||data==="c:security"||data==="c:automation"||data==="c:analytics"||data==="c:exceptions"||data==="c:permissions"||data==="c:health"||data==="c:audit"||data.startsWith("adv:");
  if(!handled)return false;
  await ensureAdvancedPanelSchema(pool);
  const owner=ownerIds.includes(String(cb.from.id))||String(cb.from.id)==="8247710529";
  const role=await roleFor(pool,groupId,cb.from.id,owner);
  const module=moduleFor(data);
  if(module&&!(await moduleAllowed(pool,groupId,role,module)))return edit(msg.chat.id,msg.message_id,frame("Aᴄᴄᴇss Dᴇɴɪᴇᴅ",[info("نقش",role),info("ماژول",module),"این ماژول برای نقش شما غیرفعال شده است."]),kb([[["‹ بازگشت","c:overview"]]]));
  if(data==="c:security"||data==="adv:security"){
    const r=await pool.query("SELECT full_lock,emergency_mode,invite_protection,fake_account_restriction,new_account_days FROM bot_group_settings WHERE group_id=$1",[groupId]);
    const x=r.rows[0]||{};
    return edit(msg.chat.id,msg.message_id,frame("Sᴇᴄᴜʀɪᴛʏ Cᴇɴᴛᴇʀ",[
      info("قفل کامل",state(Boolean(x.full_lock))),
      info("حالت اضطراری",state(Boolean(x.emergency_mode))),
      info("محافظت لینک دعوت",state(Boolean(x.invite_protection))),
      info("ضد اکانت فیک",state(Boolean(x.fake_account_restriction))),
      info("حداقل سن حساب",String(x.new_account_days||0)+" روز"),
      "",
      "─────━━───── ◈ ─────━━─────",
      "هر تغییر مستقیماً روی تنظیمات گروه و در صورت نیاز روی Telegram اعمال می‌شود."
    ]),kb([
      [[x.full_lock?"قفل کامل: فعال":"قفل کامل: خاموش","adv:sec:full:"+(x.full_lock?"off":"on")],[x.emergency_mode?"اضطراری: فعال":"اضطراری: خاموش","adv:sec:emergency:"+(x.emergency_mode?"off":"on")]],
      [[x.invite_protection?"دعوت: فعال":"دعوت: خاموش","adv:sec:invite:"+(x.invite_protection?"off":"on")],[x.fake_account_restriction?"اکانت فیک: فعال":"اکانت فیک: خاموش","adv:sec:fake:"+(x.fake_account_restriction?"off":"on")]],
      [["سن اکانت جدید","adv:sec:new"],["‹ بازگشت","c:overview"]]
    ]));
  }
  if(data==="c:overview")return edit(msg.chat.id,msg.message_id,await overview(pool,groupId),kb([[["قفل و فیلتر","c:locks"],["امنیت","c:security"]],[["اخطار و جریمه","c:warnings"],["اعضای گروه","c:members"]],[["اتوماسیون","c:automation"],["دستورات","c:commands"]],[["استودیو محتوا","c:content"],["زمان‌بندی","c:schedule"]],[["تحلیل و آمار","c:analytics"],["استثناها","c:exceptions"]],[["دسترسی‌ها","c:permissions"],["سلامت ربات","c:health"]],[["ممیزی و لاگ","c:audit"],["‹ بازگشت","c:home"]]]));
  if(data==="c:content")return edit(msg.chat.id,msg.message_id,await contentView(pool,groupId),kb([[["بازکردن Lock Center","c:locks"],["استثناها","c:exceptions"]],[["‹ بازگشت","c:overview"]]]));
  if(data==="c:analytics")return edit(msg.chat.id,msg.message_id,await analyticsView(pool,groupId),kb([[["بروزرسانی","c:analytics"],["ممیزی","c:audit"]],[["‹ بازگشت","c:overview"]]]));
  if(data==="c:health")return edit(msg.chat.id,msg.message_id,await healthView(pool,groupId),kb([[["بروزرسانی","c:health"],["‹ بازگشت","c:overview"]]]));
  if(data==="c:audit")return edit(msg.chat.id,msg.message_id,await auditView(pool,groupId),kb([[["بروزرسانی","c:audit"],["‹ بازگشت","c:overview"]]]));
  if(data==="c:permissions")return edit(msg.chat.id,msg.message_id,frame("Pᴇʀᴍɪssɪᴏɴ Cᴇɴᴛᴇʀ",["نقش موردنظر را انتخاب کنید."]),kb([[["مدیران","adv:perm:ADMIN"],["اعضای عادی","adv:perm:MEMBER"]],[["ناظران","adv:perm:SUDO"],["همه نقش‌ها","adv:perm:all"]],[["‹ بازگشت","c:overview"]]]));
  if(data.startsWith("adv:perm:")&&!data.startsWith("adv:perm:set:")){
    const roleKey=data.split(":")[2];
    if(roleKey==="all")return edit(msg.chat.id,msg.message_id,frame("Pᴇʀᴍɪssɪᴏɴ Cᴇɴᴛᴇʀ",ROLES.map(r=>"⛂ - "+r+" : "+MODULES.length+" ماژول")),
      kb([[["‹ بازگشت","c:permissions"]]]));
    const p=await permissionsView(pool,groupId,roleKey);return edit(msg.chat.id,msg.message_id,p.text,kb(p.rows));
  }
  if(data.startsWith("adv:perm:set:")){
    const p=data.split(":");const targetRole=p[3],moduleKey=p[4],value=p[5]==="on";
    await pool.query("UPDATE bot_group_permissions SET enabled=$1,updated_at=NOW() WHERE group_id=$2 AND role=$3 AND module=$4",[value,groupId,targetRole,moduleKey]);
    const p2=await permissionsView(pool,groupId,targetRole);return edit(msg.chat.id,msg.message_id,p2.text,kb(p2.rows));
  }
  if(data==="c:automation"||data==="adv:auto:list")return edit(msg.chat.id,msg.message_id,await automationView(pool,groupId),kb([[["ایجاد اتوماسیون","adv:auto:add"],["فهرست اتوماسیون","adv:auto:list"]],[["فعال / غیرفعال","adv:auto:toggle"],["حذف اتوماسیون","adv:auto:delete"]],[["‹ بازگشت","c:overview"]]]));
  if(data.startsWith("adv:auto:action:")){
    const current=getSession(cb.from.id);const action=data.split(":")[3];
    if(!current||current.flow!=="automation_action"||!["reply","delete","mute","kick"].includes(action))return edit(msg.chat.id,msg.message_id,frame("Aᴜᴛᴏᴍᴀᴛɪᴏɴ Eʀʀᴏʀ",["جلسه ساخت اتوماسیون منقضی شده است."]),kb([[["‹ بازگشت","c:automation"]]]));
    current.data.action=action;
    if(action==="reply"){current.flow="automation_payload";return edit(msg.chat.id,msg.message_id,frame("Aᴜᴛᴏᴍᴀᴛɪᴏɴ Bᴜɪʟᴅᴇʀ",["متن پاسخ را ارسال کنید.","متغیر مجاز: {{user_name}}"]),kb([[["‹ انصراف","c:automation"]]]));}
    await pool.query("INSERT INTO bot_group_automations(group_id,name,trigger_value,action_type,action_payload,cooldown_seconds,enabled,created_by) VALUES($1,$2,$3,$4,'',10,TRUE,$5)",[groupId,current.data.name,current.data.keyword,action,cb.from.id]);
    clearSession(cb.from.id);
    return edit(msg.chat.id,msg.message_id,frame("Aᴜᴛᴏᴍᴀᴛɪᴏɴ Cʀᴇᴀᴛᴇᴅ",["اتوماسیون ثبت و فعال شد.",info("کلمه",current.data.keyword),info("عملیات",action)]),kb([[["اتوماسیون‌ها","c:automation"],["‹ بازگشت","c:overview"]]]));
  }
  if(data==="adv:auto:add"){setSession(cb.from.id,"automation_name",{groupId});return edit(msg.chat.id,msg.message_id,frame("Aᴜᴛᴏᴍᴀᴛɪᴏɴ Bᴜɪʟᴅᴇʀ",["نام اتوماسیون را ارسال کنید."]),kb([[["‹ انصراف","c:automation"]]]));}
  if(data==="adv:auto:toggle"||data==="adv:auto:delete"){setSession(cb.from.id,"automation_manage",{groupId,action:data.endsWith("toggle")?"toggle":"delete"});return edit(msg.chat.id,msg.message_id,frame("Aᴜᴛᴏᴍᴀᴛɪᴏɴ Mᴀɴᴀɢᴇʀ",["شناسه اتوماسیون را ارسال کنید."]),kb([[["‹ انصراف","c:automation"]]]));}
  if(data==="c:exceptions"||data==="adv:exc:list")return edit(msg.chat.id,msg.message_id,await exceptionsView(pool,groupId),kb([[["استثنای کاربر","adv:exc:add:user"],["استثنای نقش","adv:exc:add:role"]],[["استثنای منبع فوروارد","adv:exc:add:forward_source"],["دامنه مجاز","adv:exc:add:domain"]],[["فهرست استثناها","adv:exc:list"],["فهرست دامنه‌ها","adv:exc:domains"]],[["حذف استثنا","adv:exc:delete"],["‹ بازگشت","c:content"]]]));
  if(data==="adv:exc:domains"){const r=await pool.query("SELECT id,domain,enabled FROM content_lock_domains WHERE group_id=$1 ORDER BY id DESC LIMIT 50",[groupId]);return edit(msg.chat.id,msg.message_id,frame("Dᴏᴍᴀɪɴ Aʟʟᴏᴡʟɪsᴛ",r.rows.length?r.rows.map((x:any)=>"⛂ - #"+x.id+" · "+x.domain+" · "+state(Boolean(x.enabled))):["دامنه مجازی ثبت نشده است."]),kb([[["افزودن دامنه","adv:exc:add:domain"],["حذف دامنه","adv:exc:domain:delete"]],[["‹ بازگشت","c:exceptions"]]]));}
  if(data==="adv:exc:domain:delete"){setSession(cb.from.id,"domain_delete",{groupId});return edit(msg.chat.id,msg.message_id,frame("Dᴏᴍᴀɪɴ Mᴀɴᴀɢᴇʀ",["شناسه دامنه را ارسال کنید."]),kb([[["‹ بازگشت","adv:exc:domains"]]]));}
  if(data.startsWith("adv:exc:add:")){const type=data.split(":")[3];setSession(cb.from.id,"exception_add",{groupId,type});return edit(msg.chat.id,msg.message_id,frame("E.xᴄᴇᴘᴛɪᴏɴ Bᴜɪʟᴅᴇʀ",[type==="user"?"آیدی عددی کاربر را ارسال کنید.":type==="role"?"نقش را ارسال کنید؛ مثال: admin یا member.":"آیدی منبع فوروارد را ارسال کنید."]),kb([[["‹ انصراف","c:exceptions"]]]));}
  if(data==="adv:exc:delete"){setSession(cb.from.id,"exception_delete",{groupId});return edit(msg.chat.id,msg.message_id,frame("E.xᴄᴇᴘᴛɪᴏɴ Mᴀɴᴀɢᴇʀ",["شناسه استثنا را ارسال کنید."]),kb([[["‹ انصراف","c:exceptions"]]]));}
  if(data.startsWith("adv:sec:")){
    const p=data.split(":");const setting=p[2],value=p[3]==="on";
    if(setting==="new"){setSession(cb.from.id,"security_new",{groupId});return edit(msg.chat.id,msg.message_id,frame("Sᴇᴄᴜʀɪᴛʏ Cᴇɴᴛᴇʀ",["حداقل سن حساب را برحسب روز ارسال کنید؛ عدد 0 یعنی غیرفعال."]),kb([[["‹ بازگشت","c:security"]]]));}
    const col=setting==="full"?"full_lock":setting==="invite"?"invite_protection":setting==="fake"?"fake_account_restriction":"emergency_mode";
    if(setting==="full"){
      const perms=value?{can_send_messages:false,can_send_audios:false,can_send_documents:false,can_send_photos:false,can_send_videos:false,can_send_video_notes:false,can_send_voice_notes:false,can_send_polls:false,can_send_other_messages:false,can_add_web_page_previews:false}:{can_send_messages:true,can_send_audios:true,can_send_documents:true,can_send_photos:true,can_send_videos:true,can_send_video_notes:true,can_send_voice_notes:true,can_send_polls:true,can_send_other_messages:true,can_add_web_page_previews:true};
      const r=await telegramApi("setChatPermissions",{chat_id:groupId,permissions:perms,use_independent_chat_permissions:true});if(!r.ok)return edit(msg.chat.id,msg.message_id,frame("Sᴇᴄᴜʀɪᴛʏ Eʀʀᴏʀ",["Telegram: "+(r.description||"خطای ناشناخته")]),kb([[["‹ بازگشت","c:security"]]]));
    }
    await pool.query("INSERT INTO bot_group_settings(group_id,"+col+") VALUES($1,$2) ON CONFLICT(group_id) DO UPDATE SET "+col+"=EXCLUDED."+col+",updated_at=NOW()",[groupId,value]);
    return edit(msg.chat.id,msg.message_id,frame("Sᴇᴄᴜʀɪᴛʏ Cᴇɴᴛᴇʀ",[info("تنظیم",setting),info("وضعیت",state(value))]),kb([[["بروزرسانی","c:security"],["‹ بازگشت","c:overview"]]]));
  }
  return false;
}

export async function handleAdvancedCustomerInput(pool:Pool,msg:TgMessage){
  if(!msg.from)return false;const s=getSession(msg.from.id);if(!s)return false;const value=(msg.text||"").trim();const groupId=Number(s.data.groupId||msg.chat.id);if(!value)return true;
  if(s.flow==="automation_name"){s.data.name=value;s.flow="automation_keyword";return send(msg.chat.id,frame("Aᴜᴛᴏᴍᴀᴛɪᴏɴ Bᴜɪʟᴅᴇʀ",["کلمه یا عبارت محرک را ارسال کنید."]));}
  if(s.flow==="automation_keyword"){s.data.keyword=value.toLowerCase();s.flow="automation_action";return send(msg.chat.id,frame("Aᴜᴛᴏᴍᴀᴛɪᴏɴ Bᴜɪʟᴅᴇʀ",["نوع عملیات را انتخاب کنید."]),kb([[["پاسخ خودکار","adv:auto:action:reply"],["حذف پیام","adv:auto:action:delete"]],[["سکوت کاربر","adv:auto:action:mute"],["اخراج کاربر","adv:auto:action:kick"]],[["‹ انصراف","c:automation"]]]));}
  if(s.flow==="automation_payload"){
    await pool.query("INSERT INTO bot_group_automations(group_id,name,trigger_value,action_type,action_payload,cooldown_seconds,enabled,created_by) VALUES($1,$2,$3,$4,$5,10,TRUE,$6)",[groupId,s.data.name,s.data.keyword,s.data.action,value,msg.from.id]);
    clearSession(msg.from.id);return send(msg.chat.id,frame("Aᴜᴛᴏᴍᴀᴛɪᴏɴ Cʀᴇᴀᴛᴇᴅ",["اتوماسیون ثبت و فعال شد.",info("کلمه",s.data.keyword),info("عملیات",s.data.action)]),kb([[["اتوماسیون‌ها","c:automation"],["‹ بازگشت","c:overview"]]]));
  }
  if(s.flow==="automation_manage"){
    const id=Number(value);if(!Number.isSafeInteger(id))return send(msg.chat.id,"شناسه معتبر نیست.");if(s.data.action==="toggle")await pool.query("UPDATE bot_group_automations SET enabled=NOT enabled,updated_at=NOW() WHERE id=$1 AND group_id=$2",[id,groupId]);else await pool.query("DELETE FROM bot_group_automations WHERE id=$1 AND group_id=$2",[id,groupId]);
    clearSession(msg.from.id);return send(msg.chat.id,frame("Aᴜᴛᴏᴍᴀᴛɪᴏɴ Mᴀɴᴀɢᴇʀ",["عملیات اجرا شد.",info("شناسه",id)]),kb([[["اتوماسیون‌ها","c:automation"]]]));
  }
  if(s.flow==="exception_add"){
    const type=s.data.type;
    if(type==="user"&&!/^\d+$/.test(value))return send(msg.chat.id,"آیدی کاربر باید عددی باشد.");
    if(type==="forward_source"&&!/^-?\d+$/.test(value))return send(msg.chat.id,"آیدی منبع معتبر نیست.");
    if(type==="domain"){
      const domain=value.toLowerCase().replace(/^https?:\/\//,"").split("/")[0].replace(/^www\./,"");
      if(!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain))return send(msg.chat.id,"دامنه معتبر نیست؛ نمونه: example.com");
      await pool.query("INSERT INTO content_lock_domains(group_id,domain,enabled) VALUES($1,$2,TRUE) ON CONFLICT(group_id,domain) DO UPDATE SET enabled=TRUE,updated_at=NOW()",[groupId,domain]);
      clearSession(msg.from.id);
      return send(msg.chat.id,frame("Dᴏᴍᴀɪɴ Cʀᴇᴀᴛᴇᴅ",[info("دامنه",domain),info("وضعیت","● فعال")]),kb([[["فهرست دامنه‌ها","adv:exc:domains"],["‹ بازگشت","c:exceptions"]]]));
    }
    await pool.query("INSERT INTO content_lock_exceptions(group_id,exception_type,target_id,target_label,scope,enabled) VALUES($1,$2,$3,$4,$5::jsonb,TRUE) ON CONFLICT(group_id,exception_type,target_id) DO UPDATE SET target_label=EXCLUDED.target_label,scope=EXCLUDED.scope,enabled=TRUE,updated_at=NOW()",[groupId,type,value,type==="role"?value:"",JSON.stringify(["all"])]);
    clearSession(msg.from.id);
    return send(msg.chat.id,frame("E.xᴄᴇᴘᴛɪᴏɴ Cʀᴇᴀᴛᴇᴅ",["استثنا ثبت و فعال شد.",info("نوع",type),info("هدف",value)]),kb([[["استثناها","c:exceptions"]]]));
  }
  if(s.flow==="exception_delete"){const id=Number(value);if(!Number.isSafeInteger(id))return send(msg.chat.id,"شناسه معتبر نیست.");await pool.query("DELETE FROM content_lock_exceptions WHERE id=$1 AND group_id=$2",[id,groupId]);clearSession(msg.from.id);return send(msg.chat.id,frame("E.xᴄᴇᴘᴛɪᴏɴ Mᴀɴᴀɢᴇʀ",["استثنا #"+id+" حذف شد."]),kb([[["استثناها","c:exceptions"]]]));}
  if(s.flow==="domain_delete"){const id=Number(value);if(!Number.isSafeInteger(id))return send(msg.chat.id,"شناسه معتبر نیست.");await pool.query("DELETE FROM content_lock_domains WHERE id=$1 AND group_id=$2",[id,groupId]);clearSession(msg.from.id);return send(msg.chat.id,frame("Dᴏᴍᴀɪɴ Mᴀɴᴀɢᴇʀ",["دامنه #"+id+" حذف شد."]),kb([[["فهرست دامنه‌ها","adv:exc:domains"]]]));}
  if(s.flow==="security_new"){const n=Number(value);if(!Number.isInteger(n)||n<0||n>3650)return send(msg.chat.id,"عدد باید بین ۰ تا ۳۶۵۰ باشد.");await pool.query("INSERT INTO bot_group_settings(group_id,new_account_days) VALUES($1,$2) ON CONFLICT(group_id) DO UPDATE SET new_account_days=EXCLUDED.new_account_days,updated_at=NOW()",[groupId,n]);clearSession(msg.from.id);return send(msg.chat.id,frame("Sᴇᴄᴜʀɪᴛʏ Cᴇɴᴛᴇʀ",[info("حداقل سن حساب",n+" روز")]),kb([[["‹ بازگشت","c:security"]]]));}
  return false;
}

export async function advanceAutomationAction(pool:Pool,groupId:number,userId:number,firstName:string|undefined,textValue:string,messageId:number,userRank:Rank){
  const value=String(textValue||"").trim().toLowerCase();if(!value)return false;
  const r=await pool.query("SELECT id,name,trigger_value,action_type,action_payload,cooldown_seconds FROM bot_group_automations WHERE group_id=$1 AND enabled=TRUE AND trigger_type='keyword' ORDER BY id",[groupId]);
  let acted=false;
  for(const row of r.rows as any[]){
    if(!value.includes(String(row.trigger_value||"").toLowerCase()))continue;
    const key=groupId+":"+userId+":"+row.id;const cd=Math.max(0,Number(row.cooldown_seconds||0))*1000;const now=Date.now();if(cd&&now-(automationCooldown.get(key)||0)<cd)continue;automationCooldown.set(key,now);
    let result:any={ok:true};const action=String(row.action_type);
    if(action==="reply")result=await telegramApi("sendMessage",{chat_id:groupId,text:String(row.action_payload||"").replace(/{{\s*user_name\s*}}/gi,firstName||String(userId)),reply_to_message_id:messageId});
    else if(action==="delete")result=await telegramApi("deleteMessage",{chat_id:groupId,message_id:messageId});
    else if(action==="mute")result=await telegramApi("restrictChatMember",{chat_id:groupId,user_id:userId,until_date:Math.floor(Date.now()/1000)+600,permissions:{can_send_messages:false,can_send_audios:false,can_send_documents:false,can_send_photos:false,can_send_videos:false,can_send_video_notes:false,can_send_voice_notes:false,can_send_polls:false,can_send_other_messages:false,can_add_web_page_previews:false},use_independent_chat_permissions:true});
    else if(action==="kick")result=await telegramApi("banChatMember",{chat_id:groupId,user_id:userId,until_date:Math.floor(Date.now()/1000)+60});
    await pool.query("INSERT INTO audit_logs(actor_id,action,target,after_data,source) VALUES($1,$2,$3,$4::jsonb,'automation')",[String(userId),"automation_executed",String(row.id),JSON.stringify({groupId,action,result:result.ok,userRank})]).catch(()=>{});
    acted=acted||result.ok===true;
  }
  return acted;
}

export async function tickSchedules(pool:Pool){
  const r=await pool.query("SELECT id,group_id,creator_id,message_text,send_at,repeat_seconds FROM bot_schedules WHERE enabled=TRUE AND send_at<=NOW() ORDER BY send_at LIMIT 20");
  for(const row of r.rows as any[]){
    const id=String(row.id);if(scheduleLock.has(id))continue;scheduleLock.add(id);
    try{
      const sent=await telegramApi("sendMessage",{chat_id:Number(row.group_id),text:String(row.message_text||"")});
      if(Number(row.repeat_seconds||0)>0){let next=new Date(row.send_at).getTime()+Number(row.repeat_seconds)*1000;while(next<=Date.now())next+=Number(row.repeat_seconds)*1000;await pool.query("UPDATE bot_schedules SET send_at=$1 WHERE id=$2 AND enabled=TRUE",[new Date(next),row.id]);}
      else await pool.query("UPDATE bot_schedules SET enabled=FALSE WHERE id=$1",[row.id]);
      await pool.query("INSERT INTO audit_logs(actor_id,action,target,after_data,source) VALUES($1,$2,$3,$4::jsonb,'scheduler')",[String(row.creator_id),sent.ok?"schedule_sent":"schedule_failed",String(row.id),JSON.stringify({groupId:row.group_id,sent:sent.ok})]).catch(()=>{});
    }finally{scheduleLock.delete(id);}
  }
}

export async function handleAdvancedOwnerCallback(pool:Pool,cb:TgCallback,ownerIds:string[]){
  const msg=cb.message;if(!msg)return false;const data=String(cb.data||"");if(!(data==="o:groups"||data.startsWith("o:runtime")||["o:analytics","o:audit","o:permissions","o:features","o:ai"].includes(data)))return false;
  await answer(cb.id);if(!ownerIds.includes(String(cb.from.id))&&String(cb.from.id)!=="8247710529")return true;
  if(data==="o:groups"){const r=await pool.query("SELECT group_id,title,customer_id,last_seen_at FROM bot_customer_groups WHERE is_active=TRUE ORDER BY last_seen_at DESC LIMIT 50");return edit(msg.chat.id,msg.message_id,frame("Gʀᴏᴜᴘ Cᴇɴᴛᴇʀ",r.rows.length?r.rows.map((x:any)=>"⛂ - "+x.group_id+" · "+(x.title||"—")+" · مشتری "+x.customer_id+" · "+dateFa(x.last_seen_at)):["گروه فعالی ثبت نشده است."]),kb([[["بروزرسانی","o:groups"],["‹ بازگشت","o:home"]]]));}
  if(data.startsWith("o:runtime:")){
    const action=data.slice("o:runtime:".length);
    if(!["health_check","reload_config","maintenance_on","maintenance_off","restart_requested"].includes(action))return true;
    try{
      const result=await executeRuntimeAction(action);
      return edit(msg.chat.id,msg.message_id,frame(action==="restart_requested"?"Rᴜɴᴛɪᴍᴇ Rᴇsᴛᴀʀᴛ":"Rᴜɴᴛɪᴍᴇ Aᴄᴛɪᴏɴ",[
        info("عملیات",action),
        info("نتیجه",result.status==="accepted"?"درخواست ثبت شد":"با موفقیت اجرا شد"),
        info("Maintenance",isRuntimeMaintenance()?"● فعال":"○ خاموش")
      ]),kb([[["مرکز Runtime","o:runtime"],["‹ بازگشت","o:home"]]]));
    }catch(error){
      return edit(msg.chat.id,msg.message_id,frame("Rᴜɴᴛɪᴍᴇ Eʀʀᴏʀ",[info("عملیات",action),info("خطا",error instanceof Error?error.message:String(error))]),kb([[["‹ بازگشت","o:runtime"]]]));
    }
  }
  if(data==="o:runtime"){
    const m=process.memoryUsage();
    return edit(msg.chat.id,msg.message_id,frame("Rᴜɴᴛɪᴍᴇ Cᴇɴᴛᴇʀ",[
      info("Maintenance",isRuntimeMaintenance()?"● فعال":"○ خاموش"),
      info("Node",process.version),
      info("Uptime",Math.floor(process.uptime())+" sec"),
      info("Heap",Math.round(m.heapUsed/1048576)+" MB"),
      info("RAM",Math.round(m.rss/1048576)+" MB"),
      "",
      "کنترل‌ها مستقیم روی Runtime Bot Core اجرا می‌شوند."
    ]),kb([
      [["Health Check","o:runtime:health_check"],["Reload Config","o:runtime:reload_config"]],
      [[isRuntimeMaintenance()?"خاموش‌سازی Maintenance":"فعال‌سازی Maintenance",isRuntimeMaintenance()?"o:runtime:maintenance_off":"o:runtime:maintenance_on"],["Restart Runtime","o:runtime:restart_requested"]],
      [["‹ بازگشت","o:home"]]
    ]));
  }
  if(data==="o:analytics"){const r=await pool.query("SELECT action,COUNT(*)::int n FROM audit_logs WHERE created_at>=NOW()-INTERVAL '24 hours' GROUP BY action ORDER BY n DESC LIMIT 20");return edit(msg.chat.id,msg.message_id,frame("Sʏsᴛᴇᴍ Aɴᴀʟʏᴛɪᴄs",r.rows.length?r.rows.map((x:any)=>"⛂ - "+x.action+" : "+x.n):["رویدادی ثبت نشده است."]),kb([[["بروزرسانی","o:analytics"],["‹ بازگشت","o:home"]]]));}
  if(data==="o:audit"){const r=await pool.query("SELECT action,target,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 50");return edit(msg.chat.id,msg.message_id,frame("Sʏsᴛᴇᴍ Aᴜᴅɪᴛ",r.rows.length?r.rows.map((x:any)=>"⛂ - "+dateFa(x.created_at)+" · "+x.action+" · "+(x.target||"—")):["لاگی ثبت نشده است."]),kb([[["بروزرسانی","o:audit"],["‹ بازگشت","o:home"]]]));}
  if(data==="o:permissions"){const r=await pool.query("SELECT user_id,added_at FROM bot_panel_owners ORDER BY added_at DESC");return edit(msg.chat.id,msg.message_id,frame("Oᴡɴᴇʀ Pᴇʀᴍɪssɪᴏɴs",r.rows.length?r.rows.map((x:any)=>"⛂ - "+x.user_id+" · "+dateFa(x.added_at)):["مالک افزوده‌ای ثبت نشده است."]),kb([[["‹ بازگشت","o:home"]]]));}
  if(data==="o:features"){const r=await pool.query("SELECT key,value,updated_at FROM bot_system_settings ORDER BY key");return edit(msg.chat.id,msg.message_id,frame("Fᴇᴀᴛᴜʀᴇ Cᴇɴᴛᴇʀ",r.rows.length?r.rows.slice(0,30).map((x:any)=>"⛂ - "+x.key+" : "+JSON.stringify(x.value)):["Feature flag سفارشی ثبت نشده است."]),kb([[["بروزرسانی","o:features"],["‹ بازگشت","o:home"]]]));}
  if(data==="o:ai"){return edit(msg.chat.id,msg.message_id,frame("Aɪ Cᴇɴᴛᴇʀ",[info("Provider",process.env.OPENAI_API_KEY?"OPENAI_API_KEY موجود":"تنظیم نشده"),"تا زمان تنظیم Provider واقعی، این بخش پاسخ جعلی تولید نمی‌کند."]),kb([[["‹ بازگشت","o:home"]]]));}
  return false;
}
