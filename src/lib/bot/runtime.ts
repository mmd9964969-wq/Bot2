import { telegramApi } from "../telegram/api.ts";
import { resolveCommand, parseDuration, normalizeToken, type Rank, type Lang } from "./registry.ts";
import type { BotConfig } from "./defaults.ts";

export type LiveContext = BotContext & { messageId:number; replyToUserId?:number; replyToName?:string; replyToMessageId?:number };
export type BotContext = {
  text:string; chatType:"private"|"group"|"supergroup"; chatId:number; chatTitle:string;
  membersCount:number; userId:number; userName:string; userRank:Rank; lang:Lang;
  config:BotConfig; now:number; staff:{id:number;name:string;rank:Rank}[];
};

type GroupState = {
  locks:Set<string>; floodOn:boolean; floodMax:number; spamOn:boolean; nightOn:boolean;
  welcome:string; goodbye:string; rules:string; filters:Set<string>; notes:Map<string,string>;
  warnings:Map<number,{count:number;reasons:string[]}>; recent:number[];
  language:Lang;
};
const groups=new Map<number,GroupState>();
let robotIndex=0;
const chatLang=new Map<number,Lang>();
const messageTimes=new Map<number,number[]>();
function state(id:number):GroupState{
  let s=groups.get(id);
  if(!s){s={locks:new Set(),floodOn:false,floodMax:6,spamOn:false,nightOn:false,welcome:"",goodbye:"",rules:"",filters:new Set(),notes:new Map(),warnings:new Map(),recent:[],language:"fa"};groups.set(id,s)}
  return s;
}
const fa=(l:Lang,a:string,e:string)=>l==="fa"?a:e;
async function api<T=any>(method:string,data:Record<string,unknown>){const r=await telegramApi<T>(method,data);if(!r.ok)throw new Error(r.description||method+" failed");return r.result;}
function target(ctx:LiveContext,args:string[]){if(ctx.replyToUserId)return ctx.replyToUserId;for(const x of args){const n=normalizeToken(x);if(/^-?\d+$/.test(n))return Number(n)}return null;}
function duration(args:string[]){for(const x of args){const d=parseDuration(x);if(d)return d}return null;}
function reason(args:string[]){return args.filter(x=>!x.startsWith("@")&&!/^-?\d+$/.test(normalizeToken(x))&&!parseDuration(x)).join(" ")||"—";}
function rankLabel(l:Lang,r:Rank){return l==="fa"?({owner:"مالک",sudo:"سودو",admin:"مدیر",member:"کاربر"}[r]):r;}
async function adminCount(chatId:number){const a=await api<any[]>("getChatAdministrators",{chat_id:chatId});return a.length;}
async function realRank(ctx:LiveContext,userId:number):Promise<Rank>{
  const id=String(userId);
  if(ctx.config.ownerIds.includes(id))return "owner";
  if(ctx.config.sudoIds.includes(id))return "sudo";
  try{const m=await api<any>("getChatMember",{chat_id:ctx.chatId,user_id:userId});if(m.status==="creator")return "owner";if(m.status==="administrator")return "admin";}catch{}
  return "member";
}
async function canTarget(ctx:LiveContext,id:number){
  try{const m=await api<any>("getChatMember",{chat_id:ctx.chatId,user_id:id});if(m.status==="creator")return false;if(m.status==="administrator"&&ctx.userRank!=="owner")return false;return true}catch{return false}
}
function stats(chatId:number){const s=state(chatId);return {warnings:[...s.warnings.values()].reduce((n,x)=>n+x.count,0),recent:s.recent.length};}

export async function runLiveCommand(ctx:LiveContext,token:string,args:string[]):Promise<string>{
  const command=resolveCommand(token); if(!command)return fa(ctx.lang,"✗ دستور ناشناخته است.","✗ Unknown command.");
  const rank=await realRank(ctx,ctx.userId); const s=state(ctx.chatId); const targetId=target(ctx,args);
  const requireGroup=()=>{if(ctx.chatType==="private")throw new Error(fa(ctx.lang,"این دستور فقط در گروه قابل اجراست.","This command works in groups only."));};
  const requireAdmin=()=>{if(!["owner","sudo","admin"].includes(rank))throw new Error(fa(ctx.lang,"✗ دسترسی مدیریتی ندارید.","✗ Administrator access required."));};
  const targetRequired=()=>{if(!targetId)throw new Error(fa(ctx.lang,"✗ روی پیام کاربر ریپلای کن یا شناسه عددی بده.","✗ Reply to a user or provide a numeric ID."));return targetId;};

  switch(command.id){
    case "robot": {
      const faLines=["جانم من اینجا هستم حاضر و آماده در خدمت شما","بله فرمانده فرمان بدی آماده‌ خدمتم","کاپیتان دستور بده که رو این دریا یه کاپیتان داریم اونم شمایی"];
      const enLines=["I am here and ready to serve.","Yes, commander. Give the order.","Captain, give the order. There is one captain here — you."];
      const lines=ctx.lang==="fa"?faLines:enLines;
      const out=lines[robotIndex%lines.length];
      robotIndex=(robotIndex+1)%lines.length;
      return out;
    }
    case "admin":
      return ["owner","sudo","admin"].includes(rank)
        ? fa(ctx.lang,"✓ دسترسی تأیید شد شما ادمین این گروه هستید.","✓ Access confirmed. You are an admin of this group.")
        : fa(ctx.lang,"✗ دسترسی رد شد شما ادمین این گروه نیستید.","✗ Access denied. You are not an admin of this group.");
    case "rank":
      return fa(ctx.lang,
        "◈ سیستم پیشرفته مدیران\n\n★ - "+rankLabel(ctx.lang,rank)+"\n\n⛂ - نام : "+ctx.userName+"\n⛂ - نام کاربری : "+(ctx.userName.startsWith("@")?ctx.userName:"@"+ctx.userName)+"\n⛂ - شناسه : "+ctx.userId+"\n⛂ - مقام : "+rankLabel(ctx.lang,rank)+"\n⛂ - تاریخ شروع : —\n⛂ - دسترسی‌ها : "+(rank==="owner"?"کامل":rank==="admin"?"مدیریتی":"عادی")+"\n⛂ - مسئولیت اصلی : —",
        "◈ Advanced manager system\n\n★ - "+rankLabel(ctx.lang,rank)+"\n\n⛂ - Name : "+ctx.userName+"\n⛂ - Username : "+(ctx.userName.startsWith("@")?ctx.userName:"@"+ctx.userName)+"\n⛂ - ID : "+ctx.userId+"\n⛂ - Rank : "+rank+"\n⛂ - Start date : —\n⛂ - Access : "+(rank==="owner"?"Full":rank==="admin"?"Management":"Standard"));
    case "me":
      return fa(ctx.lang,
        "◈ اطلاعات کاربر\n\n⛂ - نام : "+ctx.userName+"\n⛂ - نام کاربری : "+(ctx.userName.startsWith("@")?ctx.userName:"@"+ctx.userName)+"\n⛂ - شناسه : "+ctx.userId+"\n⛂ - مقام : "+rankLabel(ctx.lang,rank)+"\n⛂ - تاریخ عضویت : —\n\n─────━━───── ◈ ─────━━─────\n\n⛂ - تعداد پیام امروز : —\n⛂ - تعداد پیام کل : —\n⛂ - تعداد اخطار فعال : "+(s.warnings.get(ctx.userId)?.count??0)+"\n⛂ - وضعیت سکوت : —\n⛂ - وضعیت لیست ویژه : —",
        "◈ User information\n\n⛂ - Name : "+ctx.userName+"\n⛂ - Username : "+(ctx.userName.startsWith("@")?ctx.userName:"@"+ctx.userName)+"\n⛂ - ID : "+ctx.userId+"\n⛂ - Rank : "+rank+"\n⛂ - Join date : —\n\n─────━━───── ◈ ─────━━─────\n\n⛂ - Messages today : —\n⛂ - Total messages : —\n⛂ - Active warnings : "+(s.warnings.get(ctx.userId)?.count??0)+"\n⛂ - Mute status : —\n⛂ - Special status : —");
    case "bot":
      return fa(ctx.lang,
        "◈ اطلاعات فنی ربات\n\n⛂ - نام ربات : "+(ctx.config.botName||"نظم")+"\n⛂ - نام کاربری : "+(ctx.config.botUsername||"—")+"\n⛂ - شناسه ربات : —\n⛂ - نسخه ربات : v"+(process.env.BOT_VERSION??"2.0.0")+"\n⛂ - وضعیت ربات : آنلاین\n⛂ - اتصال دیتابیس : "+(process.env.DATABASE_URL?"متصل":"محلی")+"\n⛂ - روش ارتباط تلگرام : Polling\n⛂ - وضعیت سرویس : فعال\n⛂ - سیستم‌عامل : "+process.platform+"\n⛂ - نسخه Node.js : "+process.version+"\n⛂ - uptime : "+Math.floor(process.uptime())+" ثانیه",
        "◈ Bot technical information\n\n⛂ - Bot name : "+(ctx.config.botName||"Nizam")+"\n⛂ - Username : "+(ctx.config.botUsername||"—")+"\n⛂ - Bot ID : —\n⛂ - Version : v"+(process.env.BOT_VERSION??"2.0.0")+"\n⛂ - Status : Online\n⛂ - Database : "+(process.env.DATABASE_URL?"Connected":"Local")+"\n⛂ - Telegram connection : Polling\n⛂ - Service : Active\n⛂ - OS : "+process.platform+"\n⛂ - Node.js : "+process.version+"\n⛂ - Uptime : "+Math.floor(process.uptime())+"s");
    case "status":
      return fa(ctx.lang,
        "◈ وضعیت گروه\n\n⛂ - وضعیت ربات : ● فعال\n⛂ - وضعیت مدیریت : ● فعال\n⛂ - وضعیت دیتابیس : ● "+(process.env.DATABASE_URL?"متصل":"محلی")+"\n⛂ - وضعیت ضد اسپم : ● فعال\n⛂ - وضعیت ضد فلود : ● فعال\n⛂ - وضعیت امنیت : ● فعال\n\n─────━━───── ◈ ─────━━─────\n\n⛂ - تعداد اعضا : "+ctx.membersCount+"\n⛂ - تعداد مدیران : "+ctx.staff.length+"\n⛂ - پیام‌های امروز : —\n⛂ - اخطارهای فعال : "+stats(ctx.chatId).warnings+"\n⛂ - افراد در لیست سکوت : —\n⛂ - افراد در لیست ویژه : —\n\n★ - وضعیت کلی گروه : پایدار",
        "◈ Group status\n\n⛂ - Bot : ● Active\n⛂ - Management : ● Active\n⛂ - Database : ● "+(process.env.DATABASE_URL?"Connected":"Local")+"\n⛂ - Anti-spam : ● Active\n⛂ - Anti-flood : ● Active\n⛂ - Security : ● Active\n\n─────━━───── ◈ ─────━━─────\n\n⛂ - Members : "+ctx.membersCount+"\n⛂ - Admins : "+ctx.staff.length+"\n⛂ - Messages today : —\n⛂ - Active warnings : "+stats(ctx.chatId).warnings+"\n⛂ - Muted users : —\n⛂ - Special users : —\n\n★ - Overall group status : Stable");
    case "start": return fa(ctx.lang,"〽️ سلام 🌹\n\nربات مدیریت گروه فعال است. برای راهنما، «راهنما» را ارسال کن.","〽️ Hello 🌹\n\nThe group manager is online. Send “help” for commands.");
    case "help": return fa(ctx.lang,
      "◈ راهنمای ربات\n\nفاز ۱ — هسته و مدیریت\nاستارت | راهنما | پینگ | آیدی | اطلاعات | زبان | مدیران | تنظیمات | بن | آنبن | میوت | آنمیوت | کیک | اخطار | حذفاخطار | اخطارها | تی‌میوت | تی‌بن\n\nفاز ۲ — امنیت و تنظیمات\nقفل | آنلاک | قفلها | ضدفلود | ضداسپم | نایت | خوشامد | خدافظی | قوانین | تنظیم‌قوانین | فیلتر | نوت | پین | آنپین | پاکسازی | ارتقا | عزل | گزارش",
      "◈ Bot help\n\nPhase 1 — Core & management\nstart | help | ping | id | info | lang | managers | settings | ban | unban | mute | unmute | kick | warn | unwarn | warns | tmute | tban\n\nPhase 2 — Security & settings\nlock | unlock | locks | anti-flood | anti-spam | night | welcome | goodbye | rules | set-rules | filter | note | pin | unpin | cleanup | promote | demote | reports");
    case "ping": {const t=Date.now();await api("getMe",{});const ms=Date.now()-t;return fa(ctx.lang,`◈ وضعیت سیستم\n\n⛂ - وضعیت ربات : آنلاین\n⛂ - سرعت پاسخ : ${ms}ms\n⛂ - اتصال دیتابیس : ${process.env.DATABASE_URL?"متصل":"محلی"}\n⛂ - نسخه ربات : v${process.env.BOT_VERSION??"2.0.0"}\n\n─────━━───── ◈ ─────━━─────\n\n★ - سیستم پایدار است`,`◈ System status\n\n⛂ - Bot : Online\n⛂ - Response : ${ms}ms\n⛂ - Database : ${process.env.DATABASE_URL?"Connected":"Local"}\n⛂ - Version : v${process.env.BOT_VERSION??"2.0.0"}`)}
    case "id": return fa(ctx.lang,`◈ اطلاعات کاربر\n\n⛂ - نام : ${ctx.userName}\n⛂ - شناسه : ${ctx.userId}\n⛂ - نام کاربری : ${ctx.userName.startsWith("@")?ctx.userName:"@"+ctx.userName}\n⛂ - مقام : ${rankLabel(ctx.lang,rank)}\n\n─────━━───── ◈ ─────━━─────\n\n⛂ - تعداد پیام امروز : —\n⛂ - تعداد پیام کل : —`,`◈ User information\n\n⛂ - Name : ${ctx.userName}\n⛂ - ID : ${ctx.userId}\n⛂ - Username : ${ctx.userName.startsWith("@")?ctx.userName:"@"+ctx.userName}\n⛂ - Rank : ${rankLabel(ctx.lang,rank)}`);
    case "info": {requireGroup();const c=await api<any>("getChat",{chat_id:ctx.chatId});const m=await api<number>("getChatMemberCount",{chat_id:ctx.chatId});const a=await adminCount(ctx.chatId);return fa(ctx.lang,`◈ اطلاعات گروه\n\n⛂ - نام گروه : ${c.title??ctx.chatTitle}\n⛂ - شناسه گروه : ${ctx.chatId}\n⛂ - نام کاربری گروه : ${c.username?"@"+c.username:"ندارد"}\n⛂ - نوع گروه : ${c.type}\n⛂ - تعداد اعضا : ${m}\n⛂ - تعداد مدیران : ${a}\n⛂ - مالک گروه : —\n\n─────━━───── ◈ ─────━━─────\n\n⛂ - افراد در لیست سکوت : —\n⛂ - تعداد اخطارهای فعال : ${stats(ctx.chatId).warnings}\n★ - وضعیت : پایدار`,`◈ Group information\n\n⛂ - Name : ${c.title??ctx.chatTitle}\n⛂ - ID : ${ctx.chatId}\n⛂ - Username : ${c.username?"@"+c.username:"None"}\n⛂ - Type : ${c.type}\n⛂ - Members : ${m}\n⛂ - Admins : ${a}`)}
    case "lang": {requireAdmin();const v=(args[0]??"").toLowerCase();if(!["fa","en","فارسی","انگلیسی"].includes(v))return fa(ctx.lang,"✗ استفاده: زبان فارسی یا زبان انگلیسی","✗ Usage: lang fa or lang en");const l=v==="en"||v==="انگلیسی"?"en":"fa";chatLang.set(ctx.chatId,l);s.language=l;return fa(l,"✓ زبان گروه روی فارسی تنظیم شد.","✓ Group language set to English.")}
    case "managers": {requireGroup();const a=await api<any[]>("getChatAdministrators",{chat_id:ctx.chatId});return fa(ctx.lang,"◈ مدیران گروه\n\n"+a.map((x,i)=>`⛂ - ${i+1}. ${x.user?.first_name??x.user?.id} — ${x.status}`).join("\n"),"◈ Group managers\n\n"+a.map((x,i)=>`⛂ - ${i+1}. ${x.user?.first_name??x.user?.id} — ${x.status}`).join("\n"))}
    case "settings": requireAdmin(); return fa(ctx.lang,`◈ تنظیمات گروه\n\n⛂ - ضد فلود : ${s.floodOn?"فعال":"غیرفعال"}\n⛂ - ضد اسپم : ${s.spamOn?"فعال":"غیرفعال"}\n⛂ - حالت شب : ${s.nightOn?"فعال":"غیرفعال"}\n⛂ - خوشامد : ${s.welcome?"فعال":"غیرفعال"}\n⛂ - خداحافظی : ${s.goodbye?"فعال":"غیرفعال"}\n⛂ - تعداد قفل‌ها : ${s.locks.size}`,`◈ Group settings\n\n⛂ - Anti-flood : ${s.floodOn?"On":"Off"}\n⛂ - Anti-spam : ${s.spamOn?"On":"Off"}\n⛂ - Night : ${s.nightOn?"On":"Off"}\n⛂ - Welcome : ${s.welcome?"On":"Off"}\n⛂ - Goodbye : ${s.goodbye?"On":"Off"}\n⛂ - Locks : ${s.locks.size}`);
    case "ban": {requireAdmin();requireGroup();const id=targetRequired();if(!(await canTarget(ctx,id)))throw new Error(fa(ctx.lang,"✗ این کاربر قابل بن نیست.","✗ This user cannot be banned."));await api("banChatMember",{chat_id:ctx.chatId,user_id:id});return fa(ctx.lang,`✓ کاربر ${id} بن شد.`,`✓ User ${id} was banned.`)}
    case "unban": {requireAdmin();requireGroup();const id=targetRequired();await api("unbanChatMember",{chat_id:ctx.chatId,user_id:id,only_if_banned:true});return fa(ctx.lang,`✓ بن کاربر ${id} برداشته شد.`,`✓ User ${id} was unbanned.`)}
    case "mute": {requireAdmin();requireGroup();const id=targetRequired();if(!(await canTarget(ctx,id)))throw new Error(fa(ctx.lang,"✗ این کاربر قابل میوت نیست.","✗ This user cannot be muted."));await api("restrictChatMember",{chat_id:ctx.chatId,user_id:id,permissions:{can_send_messages:false}});return fa(ctx.lang,`✓ کاربر ${id} میوت شد.`,`✓ User ${id} was muted.`)}
    case "unmute": {requireAdmin();requireGroup();const id=targetRequired();await api("restrictChatMember",{chat_id:ctx.chatId,user_id:id,permissions:{can_send_messages:true,can_send_audios:true,can_send_documents:true,can_send_photos:true,can_send_videos:true,can_send_video_notes:true,can_send_voice_notes:true,can_send_polls:true,can_send_other_messages:true,can_add_web_page_previews:true}});return fa(ctx.lang,`✓ میوت کاربر ${id} برداشته شد.`,`✓ User ${id} was unmuted.`)}
    case "kick": {requireAdmin();requireGroup();const id=targetRequired();if(!(await canTarget(ctx,id)))throw new Error("target");await api("banChatMember",{chat_id:ctx.chatId,user_id:id});await api("unbanChatMember",{chat_id:ctx.chatId,user_id:id});return fa(ctx.lang,`✓ کاربر ${id} از گروه اخراج شد.`,`✓ User ${id} was kicked.`)}
    case "warn": {requireAdmin();const id=targetRequired();const w=s.warnings.get(id)??{count:0,reasons:[]};w.count++;w.reasons.push(reason(args));s.warnings.set(id,w);return fa(ctx.lang,`⚠️ اخطار ثبت شد\n⛂ - شناسه : ${id}\n⛂ - تعداد اخطار : ${w.count}`,`⚠️ Warning added\n⛂ - ID : ${id}\n⛂ - Warnings : ${w.count}`)}
    case "unwarn": {requireAdmin();const id=targetRequired();const w=s.warnings.get(id);if(!w)return fa(ctx.lang,"✗ اخطاری برای این کاربر ثبت نشده.","✗ No warning exists.");w.count=Math.max(0,w.count-1);if(w.count===0)s.warnings.delete(id);else s.warnings.set(id,w);return fa(ctx.lang,`✓ یک اخطار حذف شد.\n⛂ - شناسه : ${id}\n⛂ - اخطار فعال : ${w.count}`,`✓ One warning removed.\n⛂ - ID : ${id}\n⛂ - Active warnings : ${w.count}`)}
    case "warns": {const id=target(ctx,args)??ctx.userId;const w=s.warnings.get(id);return fa(ctx.lang,`◈ سوابق اخطار\n\n⛂ - شناسه : ${id}\n⛂ - اخطار فعال : ${w?.count??0}\n⛂ - دلایل : ${w?.reasons.join(" | ")||"—"}`,`◈ Warning history\n\n⛂ - ID : ${id}\n⛂ - Active : ${w?.count??0}\n⛂ - Reasons : ${w?.reasons.join(" | ")||"—"}`)}
    case "tmute": {requireAdmin();requireGroup();const id=targetRequired();const d=duration(args)??300;await api("restrictChatMember",{chat_id:ctx.chatId,user_id:id,permissions:{can_send_messages:false},until_date:Math.floor(Date.now()/1000)+d});return fa(ctx.lang,`✓ میوت موقت انجام شد.\n⛂ - شناسه : ${id}\n⛂ - مدت : ${d} ثانیه`,`✓ Temporary mute applied.\n⛂ - ID : ${id}\n⛂ - Duration : ${d}s`)}
    case "tban": {requireAdmin();requireGroup();const id=targetRequired();const d=duration(args)??3600;await api("banChatMember",{chat_id:ctx.chatId,user_id:id,until_date:Math.floor(Date.now()/1000)+d});return fa(ctx.lang,`✓ بن موقت انجام شد.\n⛂ - شناسه : ${id}\n⛂ - مدت : ${d} ثانیه`,`✓ Temporary ban applied.\n⛂ - ID : ${id}\n⛂ - Duration : ${d}s`)}
    case "lock": {requireAdmin();const key=normalizeToken(args[0]??"");if(!key)return fa(ctx.lang,"✗ نام قفل را بده.","✗ Provide a lock name.");s.locks.add(key);return fa(ctx.lang,`✓ قفل «${key}» فعال شد.`,`✓ Lock “${key}” enabled.`)}
    case "unlock": {requireAdmin();const key=normalizeToken(args[0]??"");if(!key)return fa(ctx.lang,"✗ نام قفل را بده.","✗ Provide a lock name.");s.locks.delete(key);return fa(ctx.lang,`✓ قفل «${key}» غیرفعال شد.`,`✓ Lock “${key}” disabled.`)}
    case "locks": return fa(ctx.lang,`◈ قفل‌ها\n\n⛂ - تعداد فعال : ${s.locks.size}\n⛂ - قفل‌ها : ${[...s.locks].join("، ")||"—"}`,`◈ Locks\n\n⛂ - Active : ${s.locks.size}\n⛂ - Locks : ${[...s.locks].join(", ")||"—"}`);
    case "anti-flood": {requireAdmin();s.floodOn=!s.floodOn;return fa(ctx.lang,`✓ ضد فلود ${s.floodOn?"فعال":"غیرفعال"} شد.`,`✓ Anti-flood ${s.floodOn?"enabled":"disabled"}.`)}
    case "anti-spam": {requireAdmin();s.spamOn=!s.spamOn;return fa(ctx.lang,`✓ ضد اسپم ${s.spamOn?"فعال":"غیرفعال"} شد.`,`✓ Anti-spam ${s.spamOn?"enabled":"disabled"}.`)}
    case "night": {requireAdmin();s.nightOn=!s.nightOn;return fa(ctx.lang,`✓ حالت شب ${s.nightOn?"فعال":"غیرفعال"} شد.`,`✓ Night mode ${s.nightOn?"enabled":"disabled"}.`)}
    case "welcome": {requireAdmin();const v=args.join(" ");s.welcome=v||s.welcome?"فعال":"غیرفعال";return fa(ctx.lang,`✓ خوشامد تنظیم شد.\n⛂ - متن : ${s.welcome||"غیرفعال"}`,`✓ Welcome updated.\n⛂ - Text : ${s.welcome||"disabled"}`)}
    case "goodbye": {requireAdmin();const v=args.join(" ");s.goodbye=v||s.goodbye?"فعال":"غیرفعال";return fa(ctx.lang,`✓ خداحافظی تنظیم شد.\n⛂ - متن : ${s.goodbye||"غیرفعال"}`,`✓ Goodbye updated.\n⛂ - Text : ${s.goodbye||"disabled"}`)}
    case "rules": return fa(ctx.lang,`◈ قوانین گروه\n\n${s.rules||"قوانین هنوز تنظیم نشده است."}`,`◈ Group rules\n\n${s.rules||"Rules are not set yet."}`);
    case "set-rules": requireAdmin();s.rules=args.join(" ")||"—";return fa(ctx.lang,"✓ قوانین ذخیره شد.","✓ Rules saved.");
    case "filter": {requireAdmin();const word=normalizeToken(args[0]??"");if(!word)return fa(ctx.lang,`◈ فیلترها\n\n⛂ - موارد : ${[...s.filters].join("، ")||"—"}`,`◈ Filters\n\n⛂ - Words : ${[...s.filters].join(", ")||"—"}`);s.filters.add(word);return fa(ctx.lang,`✓ کلمه «${word}» به فیلتر اضافه شد.`,`✓ “${word}” added to filters.`)}
    case "note": {requireAdmin();const k=args.shift();if(!k)return fa(ctx.lang,"✗ استفاده: نوت نام متن","✗ Usage: note name text");const v=args.join(" ");s.notes.set(k,v);return fa(ctx.lang,`✓ نوت «${k}» ذخیره شد.`,`✓ Note “${k}” saved.`)}
    case "pin": requireAdmin();if(!ctx.replyToMessageId)throw new Error(fa(ctx.lang,"✗ روی پیام موردنظر ریپلای کن.","✗ Reply to the message."));await api("pinChatMessage",{chat_id:ctx.chatId,message_id:ctx.replyToMessageId});return fa(ctx.lang,"✓ پیام پین شد.","✓ Message pinned.");
    case "unpin": requireAdmin();if(ctx.replyToMessageId)await api("unpinChatMessage",{chat_id:ctx.chatId,message_id:ctx.replyToMessageId});else await api("unpinChatMessage",{chat_id:ctx.chatId});return fa(ctx.lang,"✓ پین برداشته شد.","✓ Message unpinned.");
    case "cleanup": {requireAdmin();const n=Math.min(Math.max(Number(args[0]??10),1),50);const ids=s.recent.slice(-n);let ok=0;for(const mid of ids){try{await api("deleteMessage",{chat_id:ctx.chatId,message_id:mid});ok++}catch{}}return fa(ctx.lang,`✓ پاکسازی انجام شد.\n⛂ - تعداد حذف : ${ok}`,`✓ Cleanup complete.\n⛂ - Deleted : ${ok}`)}
    case "promote": {if(rank!=="owner")throw new Error(fa(ctx.lang,"✗ فقط مالک می‌تواند مدیر ارتقا دهد.","✗ Only the owner can promote managers."));const id=targetRequired();await api("promoteChatMember",{chat_id:ctx.chatId,user_id:id,can_manage_chat:true,can_delete_messages:true,can_restrict_members:true,can_invite_users:true,can_pin_messages:true,can_manage_video_chats:true});return fa(ctx.lang,`✓ کاربر ${id} ارتقا یافت.`,`✓ User ${id} promoted.`)}
    case "demote": {if(rank!=="owner")throw new Error(fa(ctx.lang,"✗ فقط مالک می‌تواند مدیر را عزل کند.","✗ Only the owner can demote managers."));const id=targetRequired();await api("promoteChatMember",{chat_id:ctx.chatId,user_id:id,can_manage_chat:false,can_delete_messages:false,can_restrict_members:false,can_invite_users:false,can_pin_messages:false,can_manage_video_chats:false});return fa(ctx.lang,`✓ کاربر ${id} عزل شد.`,`✓ User ${id} demoted.`)}
    case "reports": {requireAdmin();return fa(ctx.lang,`◈ گزارش مدیریتی\n\n⛂ - اخطارها : ${stats(ctx.chatId).warnings}\n⛂ - پیام‌های اخیر ثبت‌شده : ${s.recent.length}\n⛂ - قفل‌های فعال : ${s.locks.size}\n⛂ - فیلترها : ${s.filters.size}\n⛂ - ضد فلود : ${s.floodOn?"فعال":"غیرفعال"}\n⛂ - ضد اسپم : ${s.spamOn?"فعال":"غیرفعال"}`,`◈ Management reports\n\n⛂ - Warnings : ${stats(ctx.chatId).warnings}\n⛂ - Recent messages tracked : ${s.recent.length}\n⛂ - Locks : ${s.locks.size}\n⛂ - Filters : ${s.filters.size}\n⛂ - Anti-flood : ${s.floodOn?"On":"Off"}\n⛂ - Anti-spam : ${s.spamOn?"On":"Off"}`)}
  }
}

export async function recordMessage(chatId:number,messageId:number){
  const s=state(chatId);s.recent.push(messageId);if(s.recent.length>100)s.recent.shift();
  const now=Date.now();const times=messageTimes.get(chatId)??[];times.push(now);while(times.length&&now-times[0]>10000)times.shift();messageTimes.set(chatId,times);
}

export async function moderateLive(ctx:{chatId:number;userId:number;messageId:number;text:string}){
  const s=state(ctx.chatId);const now=Date.now();
  const times=messageTimes.get(ctx.chatId)??[];while(times.length&&now-times[0]>10000)times.shift();messageTimes.set(ctx.chatId,times);
  if(s.nightOn){const h=new Date().getHours();if(h>=0&&h<6){try{await api("deleteMessage",{chat_id:ctx.chatId,message_id:ctx.messageId});return true}catch{}}}
  if(s.floodOn&&times.length>s.floodMax){try{await api("deleteMessage",{chat_id:ctx.chatId,message_id:ctx.messageId});return true}catch{}}
  if(s.spamOn&&/(https?:\/\/|t\.me\/|telegram\.me\/)/i.test(ctx.text)){try{await api("deleteMessage",{chat_id:ctx.chatId,message_id:ctx.messageId});return true}catch{}}
  const lower=ctx.text.toLowerCase();for(const w of s.filters){if(w&&lower.includes(w)){try{await api("deleteMessage",{chat_id:ctx.chatId,message_id:ctx.messageId});return true}catch{}}}
  if(s.locks.has("link")&&/(https?:\/\/|t\.me\/)/i.test(ctx.text)){try{await api("deleteMessage",{chat_id:ctx.chatId,message_id:ctx.messageId});return true}catch{}}
  return false;
}

const robotLinesFa=["جانم من اینجا هستم حاضر و آماده در خدمت شما","بله فرمانده فرمان بدی آماده‌ خدمتم","کاپیتان دستور بده که رو این دریا یه کاپیتان داریم اونم شمایی"];
const robotLinesEn=["I am here and ready to serve.","Yes, commander. Give the order.","Captain, give the order. There is one captain here — you."];
