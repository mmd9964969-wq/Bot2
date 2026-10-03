import type { Pool } from "pg";
import { telegramApi } from "../telegram/api.ts";
import { prepareRichDocument, validateRichDocument } from "./rich-message.ts";
import { styledGlassButton } from "./panel-design.ts";
import {
  ensureGroupManagementCoreSchema,
  groupManagementOverview,
  listManagedGroups,
  getGroupOverview,
  getRuntimeState,
  getPermissions,
  getModuleState,
  inspectGroup,
  resolveGroupInput,
  registerGroup,
  installGroup,
  archiveGroup,
  restoreGroup,
  reconcileGroup,
  resumeGroup,
  groupStatusLabel,
  botMembershipLabel,
} from "./group-management-core.ts";
import {
  syncOwnerGroup,
  setOwnerGroupEnabled,
  sendMessageToOwnerGroup,
} from "./owner-groups.ts";

type TgUser={id:number;first_name?:string;last_name?:string;username?:string};
type TgChat={id:number;type:string;title?:string;username?:string};
type TgMessage={message_id:number;chat:TgChat;from?:TgUser;text?:string;caption?:string};
type TgCallback={id:string;from:TgUser;message?:TgMessage;data?:string};

const BUILTIN_OWNER_IDS=["8247710529"];
const GROUP_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const inputFlows=new Map<number,{messageId:number;expires:number}>();
const listCursors=new Map<number,Map<number,string|null>>();
const archiveConfirm=new Map<number,{groupId:string;expires:number}>();

function clean(value:unknown){const s=String(value??"").trim();return s||"—";}
function faDate(value:unknown){
  if(!value)return "ثبت نشده";
  const d=value instanceof Date?value:new Date(String(value));
  if(Number.isNaN(d.getTime()))return "ثبت نشده";
  return new Intl.DateTimeFormat("fa-IR",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Tehran"}).format(d);
}
function n(value:unknown){const x=Number(value??0);return Number.isFinite(x)?x:0;}
function status(value:string){
  if(value==="ACTIVE"||value==="INSTALLED"||value==="ADMINISTRATOR"||value==="HEALTHY"||value==="REGISTERED")return "● فعال";
  if(value==="DEGRADED"||value==="PENDING"||value==="INSTALLING"||value==="RESTRICTED")return "◐ نیازمند بررسی";
  if(value==="STOPPED"||value==="DISABLED"||value==="UNINSTALLED"||value==="UNKNOWN"||value==="NOT_INSTALLED")return "○ غیرفعال";
  if(value==="FAILED"||value==="BLOCKED"||value==="LEFT"||value==="BANNED")return "✗ مشکل";
  if(value==="ARCHIVED")return "○ آرشیو";
  return clean(value);
}
function btn(text:string,data:string,style:"primary"|"success"|"danger"="success"){
  return styledGlassButton(text,data,style);
}
function keyboard(rows:any[][]){
  return {inline_keyboard:rows};
}
function back(data:string){
  return [[btn("‹ بازگشت",data,"primary")]];
}
function table(caption:string,rows:Array<[string,string]>,headers=["عنوان","مقدار"]){
  return {
    type:"table",
    caption,
    is_bordered:true,
    is_striped:false,
    is_compact:false,
    cells:[
      [{text:headers[0],is_header:true,align:"right",valign:"middle"},{text:headers[1],is_header:true,align:"right",valign:"middle"}],
      ...rows.map(([a,b])=>[
        {text:String(a),align:"right",valign:"middle"},
        {text:String(b),align:"right",valign:"middle"},
      ]),
    ],
  };
}
function rich(title:string,blocks:any[]){
  return {
    version:1,
    is_rtl:true,
    blocks:[
      {type:"heading",text:title,size:1},
      {type:"divider"},
      ...blocks,
      {type:"footer",text:"Pᴇʀsɪᴀɴ ᴮᵒᵗ · Gʀᴏᴜᴘ Pʀᴏ"},
    ],
  };
}
function groupContext(groupId:string,chatId:number,title:string){
  return {groupId,chatId,title};
}
function validGroupId(groupId:string){return GROUP_UUID.test(groupId);}

async function sendRich(pool:Pool,uid:number,chatId:number,richMessage:any,markup:any,messageId?:number){
  const prepared=prepareRichDocument(richMessage);
  const validation=validateRichDocument(prepared);
  if(!validation.ok){
    console.error("[group-pro] rich validation failed",validation.errors);
    return null;
  }
  const payload={
    rich_message:{blocks:prepared.blocks,is_rtl:prepared.is_rtl},
    reply_markup:markup||undefined,
  };
  const result=messageId
    ? await telegramApi("editMessageText",{chat_id:chatId,message_id:messageId,...payload}).catch(error=>{console.error("[group-pro] edit failed",error);return null;})
    : await telegramApi("sendRichMessage",{chat_id:chatId,...payload}).catch(error=>{console.error("[group-pro] send failed",error);return null;});
  if(result?.ok&&Number.isSafeInteger(Number((result.result as any)?.message_id))){
    const mid=Number((result.result as any)?.message_id);
    await pool.query(
      "INSERT INTO bot_panel_sessions(chat_id,message_id,user_id,panel_kind,expires_at) VALUES($1,$2,$3,'owner',$4) ON CONFLICT(chat_id,message_id,user_id) DO UPDATE SET expires_at=EXCLUDED.expires_at,panel_kind='owner'",
      [String(chatId),mid,String(uid),new Date(Date.now()+30*60*1000)]
    ).catch(()=>{});
  }else if(result?.ok){
    await pool.query(
      "UPDATE bot_panel_sessions SET expires_at=$4 WHERE chat_id=$1 AND message_id=$2 AND user_id=$3",
      [String(chatId),String(messageId||0),String(uid),new Date(Date.now()+30*60*1000)]
    ).catch(()=>{});
  }
  return result;
}

async function isOwner(pool:Pool,uid:number,ownerIds:string[]){
  if(new Set([...BUILTIN_OWNER_IDS,...ownerIds]).has(String(uid)))return true;
  const r=await pool.query("SELECT 1 FROM bot_panel_owners WHERE user_id=$1 LIMIT 1",[uid]).catch(()=>({rowCount:0}));
  return !!r.rowCount;
}

async function countTable(pool:Pool,table:string,where="TRUE",params:any[]=[]){
  const allowed=new Set([
    "content_lock_settings","content_lock_domains","content_lock_exceptions",
    "warning_cases","warning_events","bot_group_automations","bot_group_messages",
    "scheduled_messages","scheduled_tasks","bot_group_configs","bot_group_config",
    "audit_logs","gm_group_audit_log","gm_group_access","gm_group_module_states"
  ]);
  if(!allowed.has(table))return 0;
  const exists=await pool.query(
    "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1) AS e",
    [table]
  ).catch(()=>({rows:[{e:false}]}));
  if(!exists.rows[0]?.e)return 0;
  const r=await pool.query("SELECT COUNT(*)::int AS n FROM \"" + table + "\" WHERE "+where,params).catch(()=>({rows:[{n:0}]}));
  return n(r.rows[0]?.n);
}

async function getGroupData(pool:Pool,groupId:string){
  await ensureGroupManagementCoreSchema(pool);
  const overview=await getGroupOverview(pool,groupId);
  if(!overview)throw new Error("گروه پیدا نشد.");
  const [runtime,permissions,modules]=await Promise.all([
    getRuntimeState(pool,groupId).catch(()=>null),
    getPermissions(pool,groupId).catch(()=>null),
    getModuleState(pool,groupId).catch(()=>[]),
  ]);
  return {overview,runtime,permissions,modules:Array.isArray(modules)?modules:[]};
}

async function moduleCounts(pool:Pool,chatId:number){
  const [
    locks,lockDomains,lockExceptions,warnings,warningEvents,automations,content,
    schedules,configs,audit
  ]=await Promise.all([
    countTable(pool,"content_lock_settings",\"group_id=$1\",[chatId]).catch(()=>0),
    countTable(pool,"content_lock_domains",\"group_id=$1\",[chatId]).catch(()=>0),
    countTable(pool,"content_lock_exceptions",\"group_id=$1\",[chatId]).catch(()=>0),
    countTable(pool,"warning_cases",\"group_id=$1 AND COALESCE(warning_count,0)>0\",[chatId]).catch(()=>0),
    countTable(pool,"warning_events",\"group_id=$1\",[chatId]).catch(()=>0),
    countTable(pool,"bot_group_automations",\"group_id=$1\",[chatId]).catch(()=>0),
    countTable(pool,"bot_group_messages",\"group_id=$1\",[chatId]).catch(()=>0),
    countTable(pool,"scheduled_messages",\"group_id=$1\",[chatId]).catch(()=>0),
    Math.max(
      await countTable(pool,"bot_group_configs",\"group_id=$1\",[chatId]).catch(()=>0),
      await countTable(pool,"bot_group_config",\"group_id=$1\",[chatId]).catch(()=>0)
    ),
    countTable(pool,"audit_logs",\"target=$1 OR after_data->>'groupId'=$2 OR after_data->>'group_id'=$2\",[String(chatId),String(chatId)]).catch(()=>0),
  ]);
  return {locks,lockDomains,lockExceptions,warnings,warningEvents,automations,content,schedules,configs,audit};
}

function moduleMeta(key:string){
  const map:Record<string,{title:string;description:string}> = {
    overview:{title:"نمای کلی",description:"وضعیت، سلامت و خلاصه عملیاتی گروه"},
    settings:{title:"تنظیمات",description:"پروفایل تنظیمات، نسخه پیکربندی و سیاست‌های پایه"},
    security:{title:"امنیت",description:"دسترسی ربات، سطح امنیت و بررسی مجوزها"},
    locks:{title:"قفل‌ها",description:"قوانین فیلتر محتوا، دامنه‌ها و استثناها"},
    members:{title:"اعضا",description:"تعداد اعضا و اطلاعات زنده مدیران گروه"},
    managers:{title:"مدیران",description:"فهرست مدیران و توانایی‌های مدیریتی ربات"},
    commands:{title:"دستورات",description:"وضعیت ماژول فرمان‌ها و پیکربندی اجرایی"},
    automation:{title:"اتوماسیون",description:"قوانین خودکار و وضعیت اجرای آن‌ها"},
    content:{title:"محتوا",description:"پیام‌ها، قالب‌ها و محتوای ذخیره‌شده"},
    schedule:{title:"زمان‌بندی",description:"وظایف و پیام‌های برنامه‌ریزی‌شده"},
    stats:{title:"آمار",description:"شاخص‌های زنده گروه و فعالیت مدیریتی"},
    activity:{title:"فعالیت",description:"آخرین رویدادها و زمان‌های مهم گروه"},
    permissions:{title:"دسترسی‌ها",description:"مجوزهای جاری ربات در Telegram"},
    exceptions:{title:"استثناها",description:"دامنه‌ها و کاربران خارج از قواعد عمومی"},
    audit:{title:"Audit",description:"ردپای عملیات، تغییرات و رویدادهای مهم"},
    health:{title:"سلامت",description:"وضعیت هسته، سرویس، نصب و خطاهای اخیر"},
    installation:{title:"نصب و سرویس",description:"چرخه نصب، نسخه، سرویس و تعمیر"},
  };
  return map[key]||{title:key,description:"مرکز اختصاصی گروه"};
}

async function renderGroupHome(pool:Pool,uid:number,chatId:number,messageId:number,groupId:string){
  const d=await getGroupData(pool,groupId);
  const o=d.overview;
  const counts=await moduleCounts(pool,Number(o.telegram_chat_id));
  const rows:string[][] = [
    ["شناسه",clean(o.telegram_chat_id)],
    ["اعضا",o.member_count==null?"ثبت نشده":String(o.member_count)],
    ["مدیران",o.admin_count==null?"ثبت نشده":String(o.admin_count)],
    ["ربات",botMembershipLabel(String(o.bot_membership_status||"UNKNOWN"))],
    ["ثبت گروه",status(String(o.registration_status||"UNREGISTERED"))],
    ["نصب",status(String(o.installation_status||"NOT_INSTALLED"))],
    ["سرویس",status(String(o.service_status||"UNKNOWN"))],
    ["سلامت",groupStatusLabel(String(o.health_status||"DEGRADED"))],
  ];
  const moduleRows=[
    [["نمای کلی","g:module:"+groupId+":overview"],["تنظیمات","g:module:"+groupId+":settings"]],
    [["امنیت","g:module:"+groupId+":security"],["قفل‌ها","g:module:"+groupId+":locks"]],
    [["اعضا","g:module:"+groupId+":members"],["مدیران","g:module:"+groupId+":managers"]],
    [["دستورات","g:module:"+groupId+":commands"],["اتوماسیون","g:module:"+groupId+":automation"]],
    [["محتوا","g:module:"+groupId+":content"],["زمان‌بندی","g:module:"+groupId+":schedule"]],
    [["آمار","g:module:"+groupId+":stats"],["فعالیت","g:module:"+groupId+":activity"]],
    [["دسترسی‌ها","g:module:"+groupId+":permissions"],["استثناها","g:module:"+groupId+":exceptions"]],
    [["Audit","g:module:"+groupId+":audit"],["سلامت","g:module:"+groupId+":health"]],
    [["نصب و سرویس","g:module:"+groupId+":installation"]],
  ].map(row=>row.map(([label,data])=>btn(label,data,"success")));
  const richMessage=rich("Pᴇʀsɪᴀɴ ᴮᵒᵗ · Gʀᴏᴜᴘ Pʀᴏ",[
    {type:"paragraph",text:clean(o.title)},
    table("وضعیت گروه",rows),
    {type:"divider"},
    table("شاخص‌های مرکز",[
      ["قوانین قفل",String(counts.locks)],
      ["دامنه‌ها",String(counts.lockDomains)],
      ["استثناها",String(counts.lockExceptions)],
      ["هشدارهای فعال",String(counts.warnings)],
      ["اتوماسیون‌ها",String(counts.automations)],
      ["محتوای ذخیره",String(counts.content)],
      ["زمان‌بندی‌ها",String(counts.schedules)],
      ["رویدادهای Audit",String(counts.audit)],
    ]),
    {type:"divider"},
    {type:"heading",text:"★ مراکز اختصاصی گروه",size:2},
  ]);
  const markup=keyboard([
    ...moduleRows,
    [btn("بروزرسانی","g:reconcile:"+groupId,"primary"),btn("ارسال پیام","g:message:"+groupId,"primary")],
    [btn(o.registration_status==="ARCHIVED"?"بازیابی گروه":"آرشیو گروه","g:"+(o.registration_status==="ARCHIVED"?"restore":"archive")+":"+groupId,o.registration_status==="ARCHIVED"?"success":"danger")],
    [btn("‹ بازگشت به گروه‌ها","g:list","primary")],
  ]);
  return sendRich(pool,uid,chatId,richMessage,markup,messageId);
}

async function renderGroupList(pool:Pool,uid:number,chatId:number,messageId:number,page=1){
  const overview=await groupManagementOverview(pool);
  const state=listCursors.get(uid)??new Map<number,string|null>();
  listCursors.set(uid,state);
  const cursor=page===1?null:(state.get(page)||null);
  const result=await listManagedGroups(pool,{limit:8,cursor});
  if(result.nextCursor)state.set(page+1,result.nextCursor);
  const rows=(result.rows||[]).map((x:any)=>[
    btn(String(x.title||"گروه بدون نام").slice(0,38),"g:view:"+x.group_id,"success")
  ]);
  if(!rows.length)rows.push([btn("گروه ثبت‌شده‌ای نیست","g:global","primary")]);
  const nav:any[]=[];
  if(page>1)nav.push(btn("‹ صفحه قبل","g:list:"+String(page-1),"primary"));
  if(result.nextCursor)nav.push(btn("صفحه بعد","g:list:"+String(page+1),"primary"));
  const richMessage=rich("مدیریت یک گروه",[
    {type:"heading",text:"★ گروه‌های تحت مدیریت",size:2},
    table("نمای کلی",[
      ["کل ثبت‌شده",String(overview.total)],
      ["فعال",String(overview.active)],
      ["نیازمند بررسی",String(overview.needsReview)],
      ["دسترسی از دست‌رفته",String(overview.unavailable)],
      ["صفحه",String(page)],
    ]),
    {type:"divider"},
    {type:"paragraph",text:"برای ورود، خود گروه را انتخاب کنید. بعد از انتخاب، تمام بخش‌ها داخل پنل اختصاصی همان گروه ادامه پیدا می‌کند."},
  ]);
  if(nav.length)rows.push(nav);
  rows.push([btn("‹ بازگشت به مدیریت گروه‌ها","g:home","primary")]);
  return sendRich(pool,uid,chatId,richMessage,keyboard(rows),messageId);
}

async function renderGroupHub(pool:Pool,uid:number,chatId:number,messageId:number){
  const overview=await groupManagementOverview(pool);
  const richMessage=rich("Pᴇʀsɪᴀɴ ᴮᵒᵗ · Gʀᴏᴜᴘ Mᴀɴᴀɢᴇᴍᴇɴᴛ",[
    {type:"paragraph",text:"مرکز مدیریت گروه‌ها؛ انتخاب کن و مستقیم وارد پنل همان گروه شو."},
    table("وضعیت مرکز",[
      ["گروه‌های ثبت‌شده",String(overview.total)],
      ["فعال",String(overview.active)],
      ["نیازمند بررسی",String(overview.needsReview)],
      ["غیرقابل دسترسی",String(overview.unavailable)],
    ]),
    {type:"divider"},
    {type:"heading",text:"★ محدوده مدیریت",size:2},
    {type:"paragraph",text:"«یک گروه» برای کار روی یک گروه مشخص است. «سراسری گروه» برای شناسایی گروه با شناسه، نام کاربری یا لینک عمومی استفاده می‌شود."},
  ]);
  return sendRich(pool,uid,chatId,richMessage,keyboard([
    [btn("یک گروه","g:list","success")],
    [btn("سراسری گروه","g:global","success")],
    [btn("‹ بازگشت","o:home","primary")],
  ]),messageId);
}

async function renderResolverPrompt(pool:Pool,uid:number,chatId:number,messageId:number){
  inputFlows.set(uid,{messageId,expires:Date.now()+10*60*1000});
  const richMessage=rich("سراسری گروه",[
    {type:"heading",text:"★ شناسایی گروه",size:2},
    {type:"paragraph",text:"شناسه یا نام گروه را بفرست. سیستم ابتدا Telegram را بررسی می‌کند و بعد وضعیت ثبت، نصب و دسترسی ربات را مشخص می‌کند."},
    table("ورودی‌های قابل قبول",[
      ["شناسه","-1001234567890"],
      ["نام کاربری","@groupname"],
      ["لینک عمومی","https://t.me/groupname"],
      ["لینک خصوصی","https://t.me/+invite"],
    ]),
    {type:"paragraph",text:"لینک خصوصی بدون دسترسی واقعی ربات، قابل ورود خودکار نیست."},
  ]);
  return sendRich(pool,uid,chatId,richMessage,keyboard(back("g:home")),messageId);
}

async function renderResolved(pool:Pool,uid:number,chatId:number,messageId:number,result:any){
  if(!result.group){
    const richMessage=rich("نتیجه شناسایی گروه",[
      table("نتیجه",[
        ["وضعیت",clean(result.status)],
        ["دسترسی",clean(result.accessState)],
        ["مسیر بعدی",clean(result.nextAction)],
      ]),
      {type:"paragraph",text:clean(result.message)},
    ]);
    return sendRich(pool,uid,chatId,richMessage,keyboard(back("g:home")),messageId);
  }
  const g=result.group;
  const target=result.nextAction==="MANAGE"
    ? "g:view:"+g.groupId
    : result.nextAction==="REGISTER"
      ? "g:register:"+g.groupId
      : "g:home";
  const label=result.nextAction==="MANAGE"?"ورود به پنل گروه":result.nextAction==="REGISTER"?"ثبت گروه":"بازگشت";
  const richMessage=rich("نتیجه شناسایی گروه",[
    {type:"paragraph",text:clean(g.title)},
    table("هویت و وضعیت",[
      ["شناسه Telegram",clean(g.telegramChatId)],
      ["نام کاربری",g.username?"@"+String(g.username).replace(/^@/,""):"ثبت نشده"],
      ["نوع",clean(g.chatType)],
      ["ثبت",clean(result.registrationStatus)],
      ["نصب",clean(result.installationStatus)],
      ["دسترسی ربات",botMembershipLabel(String(result.botStatus||"UNKNOWN"))],
    ]),
    {type:"divider"},
    {type:"paragraph",text:result.nextAction==="MANAGE"?"گروه آماده مدیریت است.":result.nextAction==="REGISTER"?"گروه شناسایی شد و هنوز وارد چرخه ثبت سامانه نشده است.":clean(result.message)},
  ]);
  return sendRich(pool,uid,chatId,richMessage,keyboard([
    [btn(label,target,"success")],
    [btn("‹ بازگشت","g:home","primary")],
  ]),messageId);
}

async function renderRegister(pool:Pool,uid:number,chatId:number,messageId:number,groupId:string){
  const d=await getGroupData(pool,groupId);
  const o=d.overview;
  const richMessage=rich("ثبت گروه",[
    {type:"paragraph",text:clean(o.title)},
    table("وضعیت پیش از ثبت",[
      ["شناسه",clean(o.telegram_chat_id)],
      ["حضور ربات",botMembershipLabel(String(o.bot_membership_status||"UNKNOWN"))],
      ["ثبت",clean(o.registration_status)],
      ["نصب",clean(o.installation_status)],
      ["سلامت",groupStatusLabel(String(o.health_status||"DEGRADED"))],
    ]),
    {type:"divider"},
    {type:"heading",text:"★ پیش‌نیازها",size:2},
    {type:"list",items:[
      {blocks:[{type:"paragraph",text:"شناسایی معتبر گروه"}]},
      {blocks:[{type:"paragraph",text:"حضور واقعی ربات در گروه"}]},
      {blocks:[{type:"paragraph",text:"دسترسی مدیریتی موردنیاز"}]},
      {blocks:[{type:"paragraph",text:"آماده بودن چرخه نصب"}]},
    ]},
    {type:"paragraph",text:o.registration_status==="REGISTERED"?"گروه قبلاً ثبت شده است؛ مستقیم وارد پنل مدیریت شوید.":"بعد از ثبت، چرخه نصب و سرویس گروه از همین Context ادامه پیدا می‌کند."},
  ]);
  const rows:any[][]=[];
  if(o.registration_status==="REGISTERED") rows.push([btn("ورود به پنل گروه","g:view:"+groupId,"success")]);
  else rows.push([btn("ثبت و آماده‌سازی","g:register_install:"+groupId,"success")]);
  rows.push([btn("‹ بازگشت","g:home","primary")]);
  return sendRich(pool,uid,chatId,richMessage,keyboard(rows),messageId);
}

async function renderModule(pool:Pool,uid:number,chatId:number,messageId:number,groupId:string,moduleKey:string){
  const d=await getGroupData(pool,groupId);
  const o=d.overview;
  const meta=moduleMeta(moduleKey);
  const counts=await moduleCounts(pool,Number(o.telegram_chat_id));
  const rows:Array<[string,string]>=[];
  let blocks:any[]=[];
  let extra:any[][]=[];

  if(moduleKey==="settings"){
    const settings=await pool.query(
      "SELECT gs.config_version,gs.security_profile_key,gs.settings_overrides,sp.display_name FROM gm_group_settings gs LEFT JOIN gm_settings_profiles sp ON sp.settings_profile_id=gs.settings_profile_id WHERE gs.group_id=$1 LIMIT 1",
      [groupId]
    ).catch(()=>({rows:[]}));
    const s=settings.rows[0];
    rows.push(["پروفایل",clean(s?.display_name||"پیش‌فرض")],["نسخه پیکربندی",clean(s?.config_version)],["پروفایل امنیتی",clean(s?.security_profile_key||"default")],["Overrideها",s?.settings_overrides?String(Object.keys(s.settings_overrides).length):"۰"]);
    blocks=[table("پیکربندی فعلی",rows),{type:"paragraph",text:"این صفحه فقط Context همین گروه را تغییر می‌دهد؛ هیچ تنظیمی از پنل مشتری وارد این مسیر نمی‌شود."}];
    extra=[[btn("بروزرسانی","g:module:"+groupId+":settings","primary")]];
  } else if(moduleKey==="security"){
    const p=d.permissions||{};
    rows.push(["حضور ربات",botMembershipLabel(String(p.membership_status||o.bot_membership_status||"UNKNOWN"))],["مدیریت گروه",p.can_manage_chat?"● دارد":"○ ندارد"],["حذف پیام",p.can_delete_messages?"● دارد":"○ ندارد"],["محدودکردن اعضا",p.can_restrict_members?"● دارد":"○ ندارد"],["ارتقای مدیر",p.can_promote_members?"● دارد":"○ ندارد"],["تغییر اطلاعات",p.can_change_info?"● دارد":"○ ندارد"],["دعوت کاربر",p.can_invite_users?"● دارد":"○ ندارد"]);
    blocks=[table("مجوزهای جاری ربات",rows),{type:"paragraph",text:"سطح دسترسی از Telegram خوانده می‌شود و با Context گروه ثبت می‌شود."}];
    extra=[[btn("بازبینی مجدد","g:reconcile:"+groupId,"primary")]];
  } else if(moduleKey==="locks"){
    rows.push(["قوانین اصلی",String(counts.locks)],["دامنه‌ها",String(counts.lockDomains)],["استثناهای دامنه",String(counts.lockExceptions)]);
    blocks=[table("مرکز قفل و فیلتر",rows),{type:"paragraph",text:"ساختار این مرکز برای همین گروه نگه داشته می‌شود؛ دامنه‌ها و استثناها از داده‌ی گروه خوانده می‌شوند."}];
    extra=[[btn("استثناها","g:module:"+groupId+":exceptions","success")]];
  } else if(moduleKey==="members"){
    const admins=await telegramApi<any>("getChatAdministrators",{chat_id:Number(o.telegram_chat_id)}).catch(()=>({ok:false,result:[]}));
    const adminRows=Array.isArray(admins.result)?admins.result.slice(0,12).map((x:any)=>[
      [String(x?.user?.first_name||"بدون نام")+" "+(x?.user?.last_name||"").trim(),String(x?.user?.id||"—")]
    ]):[];
    rows.push(["اعضای فعلی",o.member_count==null?"ثبت نشده":String(o.member_count)],["مدیران فعلی",o.admin_count==null?"ثبت نشده":String(o.admin_count)]);
    blocks=[table("وضعیت اعضا",rows),{type:"divider"},{type:"heading",text:"★ مدیران حاضر",size:2},adminRows.length?table("فهرست مدیران",adminRows.map((r:any)=>[String(r[0]),String(r[1])])):{type:"paragraph",text:"اطلاعات مدیران فعلاً در دسترس نیست."}];
    extra=[[btn("بازخوانی اعضا","g:reconcile:"+groupId,"primary"),btn("مرکز مدیران","g:module:"+groupId+":managers","success")]];
  } else if(moduleKey==="managers"){
    const admins=await telegramApi<any>("getChatAdministrators",{chat_id:Number(o.telegram_chat_id)}).catch(()=>({ok:false,result:[]}));
    const rows2:Array<[string,string]>=Array.isArray(admins.result)?admins.result.slice(0,12).map((x:any)=>[
      String(x?.user?.first_name||"بدون نام"),String(x?.status==="creator"?"مالک":x?.status==="administrator"?"مدیر":"مدیر")
    ]):[];
    blocks=[table("مدیران گروه",[
      ["تعداد مدیران",String(o.admin_count??"ثبت نشده")],
      ["دسترسی مدیریت ربات",botMembershipLabel(String(o.bot_membership_status||"UNKNOWN"))],
    ]),{type:"divider"},table("فهرست مدیران",rows2.length?rows2:[["داده","ثبت نشده"]])];
    extra=[[btn("بازخوانی","g:reconcile:"+groupId,"primary")]];
  } else if(moduleKey==="commands"){
    const m=d.modules.find((x:any)=>x.module_key==="commands");
    rows.push(["ماژول",status(String(m?.state||"READY"))],["فعال",m?.enabled?"● بله":"○ خیر"],["نسخه",clean(m?.version)],["نسخه پیکربندی",clean(m?.config_version)]);
    blocks=[table("استودیو دستورات",rows),{type:"paragraph",text:"مسیر دستورات اینجا با گروه جاری قفل می‌شود و وارد پنل مشتری نمی‌شود."}];
  } else if(moduleKey==="automation"){
    rows.push(["قوانین اتوماسیون",String(counts.automations)],["رویدادهای هشدار",String(counts.warningEvents)]);
    blocks=[table("اتوماسیون گروه",rows),{type:"paragraph",text:"آمار این مرکز از رکوردهای واقعی گروه خوانده می‌شود."}];
  } else if(moduleKey==="content"){
    rows.push(["رکوردهای محتوا",String(counts.content)],["پیکربندی گروه",String(counts.configs)],["قفل‌های مرتبط",String(counts.locks)]);
    blocks=[table("استودیو محتوا",rows),{type:"paragraph",text:"قالب‌ها، پیام‌های ذخیره‌شده و تنظیمات محتوا در Scope همین گروه نمایش داده می‌شوند."}];
  } else if(moduleKey==="schedule"){
    rows.push(["وظایف زمان‌بندی‌شده",String(counts.schedules)],["آخرین بررسی",faDate(o.last_reconcile_at)]);
    blocks=[table("زمان‌بندی",rows),{type:"paragraph",text:"هر زمان‌بندی در ادامه‌ی Context گروه مدیریت می‌شود."}];
  } else if(moduleKey==="stats"){
    rows.push(["اعضای فعلی",clean(o.member_count)],["مدیران",clean(o.admin_count)],["آخرین پیام",faDate(o.last_message_at)],["آخرین فعالیت ربات",faDate(o.last_bot_activity_at)],["آخرین عملیات مدیریتی",faDate(o.last_admin_action_at)]);
    blocks=[table("آمار زنده گروه",rows),{type:"paragraph",text:"این صفحه شاخص‌های زنده را از Runtime و هسته مدیریت گروه می‌گیرد."}];
  } else if(moduleKey==="activity"){
    rows.push(["آخرین پیام",faDate(o.last_message_at)],["فعالیت ربات",faDate(o.last_bot_activity_at)],["عملیات مدیریتی",faDate(o.last_admin_action_at)],["رویداد امنیتی",faDate(o.last_security_event_at)],["آخرین همگام‌سازی",faDate(o.last_reconcile_at)]);
    blocks=[table("فعالیت اخیر",rows),{type:"paragraph",text:"تاریخچه تفصیلی در Audit گروه نگه داشته می‌شود."}];
    extra=[[btn("مشاهده Audit","g:module:"+groupId+":audit","success")]];
  } else if(moduleKey==="permissions"){
    const p=d.permissions||{};
    const bool=(x:any)=>x===true?"● فعال":"○ غیرفعال";
    blocks=[table("دسترسی‌های ربات",[
      ["مدیریت گروه",bool(p.can_manage_chat)],
      ["حذف پیام",bool(p.can_delete_messages)],
      ["محدودسازی اعضا",bool(p.can_restrict_members)],
      ["ارتقای مدیر",bool(p.can_promote_members)],
      ["تغییر اطلاعات",bool(p.can_change_info)],
      ["دعوت کاربر",bool(p.can_invite_users)],
      ["مدیریت موضوعات",bool(p.can_manage_topics)],
      ["پین پیام",bool(p.can_pin_messages)],
      ["استوری",bool(p.can_post_stories)],
    ])];
    extra=[[btn("همگام‌سازی","g:reconcile:"+groupId,"primary")]];
  } else if(moduleKey==="exceptions"){
    blocks=[table("استثناهای گروه",[
      ["استثنای دامنه",String(counts.lockExceptions)],
      ["دامنه‌های ثبت‌شده",String(counts.lockDomains)],
      ["هشدارهای دارای پرونده",String(counts.warnings)],
    ]),{type:"paragraph",text:"استثناها به همین گروه محدود می‌مانند و از Scope مشتری جدا هستند."}];
  } else if(moduleKey==="audit"){
    const audits=await pool.query(
      "SELECT action,result,created_at FROM gm_group_audit_log WHERE group_id=$1 ORDER BY created_at DESC LIMIT 12",
      [groupId]
    ).catch(()=>({rows:[]}));
    const auditRows=(audits.rows||[]).map((x:any)=>[
      String(x.action||"—"),String(x.result||"—")+" · "+faDate(x.created_at)
    ]) as Array<[string,string]>;
    blocks=[table("آخرین عملیات گروه",auditRows.length?auditRows:[["رویداد","ثبت نشده"]]),{type:"paragraph",text:"Audit این مرکز مخصوص همین گروه است."}];
  } else if(moduleKey==="health"){
    rows.push(["ثبت",status(String(o.registration_status||"UNKNOWN"))],["نصب",status(String(o.installation_status||"UNKNOWN"))],["ربات",botMembershipLabel(String(o.bot_membership_status||"UNKNOWN"))],["سرویس",status(String(o.service_status||"UNKNOWN"))],["سلامت",groupStatusLabel(String(o.health_status||"DEGRADED"))],["خطا",clean(o.last_error_code)],["آخرین خطا",faDate(o.last_error_at)]);
    blocks=[table("سلامت گروه",rows),{type:"paragraph",text:"هر مشکل از مسیر همین گروه قابل پیگیری و همگام‌سازی است."}];
    extra=[[btn("بازبینی کامل","g:reconcile:"+groupId,"primary"),btn("نصب و سرویس","g:module:"+groupId+":installation","success")]];
  } else if(moduleKey==="installation"){
    rows.push(["وضعیت نصب",status(String(o.installation_status||"NOT_INSTALLED"))],["نسخه جاری",clean(o.current_version)],["نسخه هدف",clean(o.target_version)],["تلاش",clean(o.attempt_no)],["خطای نصب",clean(o.failure_code)],["پیام خطا",clean(o.failure_message)]);
    blocks=[table("چرخه نصب",rows),{type:"paragraph",text:"نصب از موتور مرکزی سامانه عبور می‌کند؛ اینجا نقطه کنترل همان گروه است."}];
    const action=o.installation_status==="INSTALLED"?"بازبینی نصب":"ادامه نصب";
    extra=[[btn(action,"g:install:"+groupId,"success"),btn("بازبینی","g:reconcile:"+groupId,"primary")]];
  } else if(moduleKey==="overview"){
    blocks=[table("خلاصه جاری",[
      ["ثبت",status(String(o.registration_status||"UNKNOWN"))],
      ["نصب",status(String(o.installation_status||"UNKNOWN"))],
      ["ربات",botMembershipLabel(String(o.bot_membership_status||"UNKNOWN"))],
      ["سرویس",status(String(o.service_status||"UNKNOWN"))],
      ["سلامت",groupStatusLabel(String(o.health_status||"DEGRADED"))],
      ["آخرین همگام‌سازی",faDate(o.last_reconcile_at)],
    ]),{type:"paragraph",text:"این صفحه همان Context ثابت گروه را نگه می‌دارد و مسیر برگشت مستقیم به خانه گروه است."}];
  }

  if(moduleKey!=="installation"&&o.installation_status!=="INSTALLED"){
    extra.push([btn("چرخه نصب","g:module:"+groupId+":installation","success")]);
  }
  const navigation=[
    ...(extra||[]),
    [btn("‹ بازگشت به گروه","g:view:"+groupId,"primary")],
  ];
  return sendRich(pool,uid,chatId,rich(meta.title+" · "+clean(o.title),[
    {type:"paragraph",text:meta.description},
    ...blocks,
  ]),keyboard(navigation),messageId);
}

async function renderOperationResult(pool:Pool,uid:number,chatId:number,messageId:number,groupId:string,title:string,textValue:string,button="g:view:"+groupId){
  return sendRich(pool,uid,chatId,messageId?rich(title,[{type:"paragraph",text:textValue}]):rich(title,[{type:"paragraph",text:textValue}]),keyboard([
    [btn("مشاهده گروه",button,"success")],
    [btn("‹ بازگشت","g:view:"+groupId,"primary")],
  ]),messageId);
}

async function handleService(pool:Pool,uid:number,chatId:number,messageId:number,groupId:string,enabled:boolean){
  const d=await getGroupData(pool,groupId);
  const telegramChatId=Number(d.overview.telegram_chat_id);
  try{
    await syncOwnerGroup(pool,telegramChatId,true);
    const updated=await setOwnerGroupEnabled(pool,uid,telegramChatId,enabled);
    await pool.query(
      "UPDATE gm_group_runtime SET service_status=$2,runtime_revision=runtime_revision+1,updated_at=NOW() WHERE group_id=$1",
      [groupId,enabled?"ACTIVE":"STOPPED"]
    ).catch(()=>{});
    return renderOperationResult(pool,uid,chatId,messageId,groupId,enabled?"فعال‌سازی سرویس":"غیرفعال‌سازی سرویس",
      "سرویس این گروه "+(enabled?"فعال شد.":"غیرفعال شد.")+"\n\nوضعیت ثبت و Context گروه حفظ شده است.");
  }catch(error){
    return renderOperationResult(pool,uid,chatId,messageId,groupId,"عملیات سرویس",
      "عملیات انجام نشد.\n\nدلیل : "+(error instanceof Error?error.message:String(error)));
  }
}

async function handleGroupAction(pool:Pool,uid:number,chatId:number,messageId:number,data:string){
  if(data==="g:home")return renderGroupHub(pool,uid,chatId,messageId);
  if(data==="g:list"){
    listCursors.set(uid,new Map([[1,null]]));
    return renderGroupList(pool,uid,chatId,messageId,1);
  }
  if(data.startsWith("g:list:")){
    const page=Math.max(1,Number(data.slice(7))||1);
    return renderGroupList(pool,uid,chatId,messageId,page);
  }
  if(data==="g:global")return renderResolverPrompt(pool,uid,chatId,messageId);
  if(data.startsWith("g:view:")){
    const groupId=data.slice(7);
    if(!validGroupId(groupId))return null;
    return renderGroupHome(pool,uid,chatId,messageId,groupId);
  }
  if(data.startsWith("g:register_install:")){
    const groupId=data.slice(19);
    if(!validGroupId(groupId))return null;
    try{
      await registerGroup(pool,uid,groupId);
      const result=await installGroup(pool,uid,groupId);
      return renderOperationResult(pool,uid,chatId,messageId,groupId,"ثبت و آماده‌سازی گروه",
        "ثبت گروه انجام شد.\n\nوضعیت نصب : "+status(String(result?.installation_status||"PENDING"))+"\n\nبعد از تکمیل موتور نصب، همین مرکز وضعیت نهایی را نشان می‌دهد.");
    }catch(error){
      return renderOperationResult(pool,uid,chatId,messageId,groupId,"ثبت گروه",
        "ثبت یا نصب انجام نشد.\n\nدلیل : "+(error instanceof Error?error.message:String(error)));
    }
  }
  if(data.startsWith("g:register:")){
    const groupId=data.slice(10);
    if(!validGroupId(groupId))return null;
    return renderRegister(pool,uid,chatId,messageId,groupId);
  }
  if(data.startsWith("g:module:")){
    const rest=data.slice(9);
    const split=rest.split(":");
    const groupId=split[0];const moduleKey=split.slice(1).join(":");
    if(!validGroupId(groupId))return null;
    return renderModule(pool,uid,chatId,messageId,groupId,moduleKey);
  }
  if(data.startsWith("g:reconcile:")){
    const groupId=data.slice(13);
    if(!validGroupId(groupId))return null;
    try{
      const x=await reconcileGroup(pool,groupId);
      return renderOperationResult(pool,uid,chatId,messageId,groupId,"همگام‌سازی گروه",
        "Telegram و هسته مدیریت گروه دوباره بررسی شدند.\n\nربات : "+botMembershipLabel(String(x?.bot_membership_status||"UNKNOWN"))+"\nسرویس : "+status(String(x?.service_status||"UNKNOWN"))+"\nسلامت : "+groupStatusLabel(String(x?.health_status||"DEGRADED")));
    }catch(error){
      return renderOperationResult(pool,uid,chatId,messageId,groupId,"همگام‌سازی گروه",
        "همگام‌سازی کامل نشد.\n\nدلیل : "+(error instanceof Error?error.message:String(error)));
    }
  }
  if(data.startsWith("g:install:")){
    const groupId=data.slice(10);
    if(!validGroupId(groupId))return null;
    try{
      const x=await installGroup(pool,uid,groupId);
      return renderOperationResult(pool,uid,chatId,messageId,groupId,"چرخه نصب",
        "وضعیت نصب : "+status(String(x?.installation_status||"UNKNOWN"))+"\nنسخه جاری : "+clean(x?.current_version)+"\nنسخه هدف : "+clean(x?.target_version));
    }catch(error){
      return renderOperationResult(pool,uid,chatId,messageId,groupId,"چرخه نصب",
        "عملیات نصب انجام نشد.\n\nدلیل : "+(error instanceof Error?error.message:String(error)));
    }
  }
  if(data.startsWith("g:service:on:")||data.startsWith("g:service:off:")){
    const enabled=data.startsWith("g:service:on:");
    const groupId=data.slice(enabled?13:14);
    if(!validGroupId(groupId))return null;
    return handleService(pool,uid,chatId,messageId,groupId,enabled);
  }
  if(data.startsWith("g:archive:")){
    const groupId=data.slice(10);
    if(!validGroupId(groupId))return null;
    archiveConfirm.set(uid,{groupId,expires:Date.now()+5*60*1000});
    const d=await getGroupData(pool,groupId);
    return sendRich(pool,uid,chatId,rich("بررسی آرشیو گروه",[
      {type:"paragraph",text:"آرشیو، سرویس گروه را متوقف و وضعیت ماژول‌ها را غیرفعال می‌کند؛ داده‌های گروه حذف نمی‌شوند."},
      table("گروه",[
        ["نام",clean(d.overview.title)],
        ["شناسه",clean(d.overview.telegram_chat_id)],
        ["وضعیت فعلی",status(String(d.overview.registration_status||"UNKNOWN"))],
      ]),
    ]),keyboard([
      [btn("تأیید آرشیو","g:archive_execute:"+groupId,"danger")],
      [btn("‹ لغو","g:view:"+groupId,"primary")],
    ]),messageId);
  }
  if(data.startsWith("g:archive_execute:")){
    const groupId=data.slice(18);
    const c=archiveConfirm.get(uid);
    if(!c||c.groupId!==groupId||c.expires<Date.now())return renderOperationResult(pool,uid,chatId,messageId,groupId,"آرشیو گروه","مرحله تأیید منقضی شده است.");
    archiveConfirm.delete(uid);
    try{
      await archiveGroup(pool,uid,groupId);
      return renderOperationResult(pool,uid,chatId,messageId,groupId,"آرشیو گروه","گروه آرشیو شد و اطلاعات آن حفظ شد.");
    }catch(error){
      return renderOperationResult(pool,uid,chatId,messageId,groupId,"آرشیو گروه","آرشیو انجام نشد.\n\nدلیل : "+(error instanceof Error?error.message:String(error)));
    }
  }
  if(data.startsWith("g:restore:")){
    const groupId=data.slice(10);
    if(!validGroupId(groupId))return null;
    try{
      await restoreGroup(pool,uid,groupId);
      return renderOperationResult(pool,uid,chatId,messageId,groupId,"بازیابی گروه","گروه دوباره در وضعیت ثبت‌شده قرار گرفت. برای فعال‌سازی کامل، نصب و سلامت را بررسی کن.");
    }catch(error){
      return renderOperationResult(pool,uid,chatId,messageId,groupId,"بازیابی گروه","بازیابی انجام نشد.\n\nدلیل : "+(error instanceof Error?error.message:String(error)));
    }
  }
  if(data.startsWith("g:service_center:")){
    const groupId=data.slice(17);
    if(!validGroupId(groupId))return null;
    const d=await getGroupData(pool,groupId);
    return sendRich(pool,uid,chatId,rich("نصب و سرویس · "+clean(d.overview.title),[
      table("وضعیت اجرایی",[
        ["سرویس",status(String(d.overview.service_status||"UNKNOWN"))],
        ["نصب",status(String(d.overview.installation_status||"UNKNOWN"))],
        ["ربات",botMembershipLabel(String(d.overview.bot_membership_status||"UNKNOWN"))],
        ["سلامت",groupStatusLabel(String(d.overview.health_status||"DEGRADED"))],
      ]),
    ]),keyboard([
      [btn("فعال‌سازی سرویس","g:service:on:"+groupId,"success"),btn("غیرفعال‌سازی سرویس","g:service:off:"+groupId,"danger")],
      [btn("ادامه نصب","g:install:"+groupId,"success"),btn("همگام‌سازی","g:reconcile:"+groupId,"primary")],
      [btn("‹ بازگشت به گروه","g:view:"+groupId,"primary")],
    ]),messageId);
  }
  if(data.startsWith("g:resume:")){
    const groupId=data.slice(9);
    if(!validGroupId(groupId))return null;
    try{
      const x=await resumeGroup(pool,uid,groupId);
      return renderOperationResult(pool,uid,chatId,messageId,groupId,"فعال‌سازی دوباره",
        "سرویس گروه از روی وضعیت نصب و دسترسی Telegram دوباره محاسبه شد.\n\nسرویس : "+status(String(x?.service_status||"UNKNOWN")));
    }catch(error){
      return renderOperationResult(pool,uid,chatId,messageId,groupId,"فعال‌سازی دوباره","عملیات انجام نشد.\n\nدلیل : "+(error instanceof Error?error.message:String(error)));
    }
  }
  if(data.startsWith("g:message:")){
    const groupId=data.slice(10);
    if(!validGroupId(groupId))return null;
    inputFlows.set(uid,{messageId,expires:Date.now()+10*60*1000});
    await messageInputMode.set(uid,{groupId,expires:Date.now()+10*60*1000});
    return sendRich(pool,uid,chatId,rich("ارسال پیام به گروه",[
      {type:"paragraph",text:"متن پیام را بفرست. پیام مستقیماً در همین گروه ارسال می‌شود و نتیجه در پنل همین Context برمی‌گردد."},
      table("مقصد",[
        ["گروه",clean((await getGroupData(pool,groupId)).overview.title)],
        ["شناسه",clean((await getGroupData(pool,groupId)).overview.telegram_chat_id)],
      ]),
    ]),keyboard(back("g:view:"+groupId)),messageId);
  }
  return null;
}

const messageInputMode=new Map<number,{groupId:string;expires:number}>();

export async function groupProCallback(pool:Pool,cb:TgCallback,ownerIds:string[],authenticated=true){
  if(!cb.message)return false;
  const uid=cb.from.id;
  if(!(await isOwner(pool,uid,ownerIds))||!authenticated){
    await telegramApi("editMessageText",{
      chat_id:cb.message.chat.id,
      message_id:cb.message.message_id,
      text:"دسترسی این مرکز برای شما فعال نیست.",
      reply_markup:keyboard(back("o:home")),
    }).catch(()=>{});
    return true;
  }
  try{
    const result=await handleGroupAction(pool,uid,cb.message.chat.id,cb.message.message_id,String(cb.data||""));
    return result??false;
  }catch(error){
    console.error("[group-pro] callback failed",error);
    await telegramApi("editMessageText",{
      chat_id:cb.message.chat.id,
      message_id:cb.message.message_id,
      rich_message:{
        blocks:prepareRichDocument(rich("خطای مرکز مدیریت گروه‌ها",[
          {type:"paragraph",text:"عملیات کامل نشد.\n\nدلیل : "+(error instanceof Error?error.message:String(error))},
        ])).blocks,
        is_rtl:true,
      },
      reply_markup:keyboard(back("g:home")),
    }).catch(()=>{});
    return true;
  }
}

export async function handleGroupProTextInput(pool:Pool,msg:TgMessage){
  if(!msg.from)return false;
  const uid=msg.from.id;
  const messageId=Number(msg.message_id||0);
  const flow=inputFlows.get(uid);
  const text=String(msg.text||msg.caption||"").trim();
  if(flow&&flow.expires<Date.now()){inputFlows.delete(uid);}
  const active=inputFlows.get(uid);
  if(active&&active.messageId>0&&text){
    const messageMode=messageInputMode.get(uid);
    if(messageMode&&messageMode.expires>=Date.now()){
      messageInputMode.delete(uid);
      try{
        await sendMessageToOwnerGroup(pool,uid,Number((await getGroupData(pool,messageMode.groupId)).overview.telegram_chat_id),text);
        return await renderOperationResult(pool,uid,msg.chat.id,active.messageId,messageMode.groupId,"ارسال پیام","پیام با موفقیت به گروه ارسال شد.");
      }catch(error){
        return await renderOperationResult(pool,uid,msg.chat.id,active.messageId,messageMode.groupId,"ارسال پیام","پیام ارسال نشد.\n\nدلیل : "+(error instanceof Error?error.message:String(error)));
      }
    }
    inputFlows.delete(uid);
    try{
      const result=await resolveGroupInput(pool,uid,text);
      return !!(await renderResolved(pool,uid,msg.chat.id,active.messageId,result));
    }catch(error){
      return !!(await renderResolved(pool,uid,msg.chat.id,active.messageId,{status:"ERROR",accessState:"UNKNOWN",nextAction:"UNAVAILABLE",message:"شناسایی گروه انجام نشد: "+(error instanceof Error?error.message:String(error))}));
    }
  }
  return false;
}
