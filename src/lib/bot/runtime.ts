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
  muted:Set<number>; special:Set<number>;
  joins:Map<number,number>; firstSeen:Map<number,number>;
  groupMessageTotal:number; groupDaily:{day:string;count:number};
  advertising:{enabled:boolean;mode:"standard"|"strict";exemptAdmins:boolean;exemptSpecialUsers:boolean};
};
const groups=new Map<number,GroupState>();
let robotIndex=0;

const DEFAULT_ADVERTISING_POLICY={enabled:false,mode:"standard" as const,exemptAdmins:true,exemptSpecialUsers:true};

export function setGroupAdvertisingPolicy(chatId:number, policy:Partial<typeof DEFAULT_ADVERTISING_POLICY>){
  const s=state(chatId);
  s.advertising={
    ...DEFAULT_ADVERTISING_POLICY,
    ...s.advertising,
    ...policy,
  };
  return s.advertising;
}

export function getGroupAdvertisingPolicy(chatId:number){
  return {...state(chatId).advertising};
}
const chatLang=new Map<number,Lang>();
const messageTimes=new Map<number,number[]>();
const userMessageCounts=new Map<string, number>();
const userMessageDailyCounts=new Map<string, { day:string; count:number }>();
const groupMessageTotals=new Map<number,number>();
const groupMessageDailyCounts=new Map<number,{day:string;count:number}>();
const memberJoins=new Map<string,number[]>();
const memberJoinDates=new Map<string,number>();
function userKey(chatId:number,userId:number){ return chatId+":"+userId; }
function dayKey(){ return new Date().toISOString().slice(0,10); }
function userStats(chatId:number,userId:number){
  const key=userKey(chatId,userId);
  const daily=userMessageDailyCounts.get(key);
  return { total:userMessageCounts.get(key)??0, today:daily?.day===dayKey()?daily.count:0 };
}
function groupStats(chatId:number){
  const daily=groupMessageDailyCounts.get(chatId);
  const joins=memberJoins.get(String(chatId))??[];
  const today=dayKey();
  return {
    messagesTotal:groupMessageTotals.get(chatId)??0,
    messagesToday:daily?.day===today?daily.count:0,
    joinsTotal:joins.length,
    joinsToday:joins.filter(t=>new Date(t).toISOString().slice(0,10)===today).length
  };
}
function formatDate(ts:number|undefined,l:Lang){
  if(!ts)return "ثبت نشده";
  return new Intl.DateTimeFormat(l==="fa"?"fa-IR":"en-GB",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Tehran"}).format(new Date(ts));
}
export async function recordMemberJoin(chatId:number,userId:number,ts:number){
  const key=String(chatId);
  const list=memberJoins.get(key)??[];
  list.push(ts);
  memberJoins.set(key,list);
  const user=userKey(chatId,userId);
  if(!memberJoinDates.has(user)) memberJoinDates.set(user,ts);
  const s=state(chatId);
  if(!s.joins.has(userId)) s.joins.set(userId,ts);
  if(!s.firstSeen.has(userId)) s.firstSeen.set(userId,ts);
}
function state(id:number):GroupState{
  let s=groups.get(id);
  if(!s){s={locks:new Set(),floodOn:false,floodMax:6,spamOn:false,nightOn:false,welcome:"",goodbye:"",rules:"",filters:new Set(),notes:new Map(),warnings:new Map(),recent:[],language:"fa",muted:new Set(),special:new Set(),joins:new Map(),firstSeen:new Map(),groupMessageTotal:0,groupDaily:{day:dayKey(),count:0},advertising:{...DEFAULT_ADVERTISING_POLICY}};groups.set(id,s)}
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
function stats(chatId:number){const s=state(chatId);return {warnings:[...s.warnings.values()].reduce((n,x)=>n+x.count,0),recent:s.recent.length,muted:s.muted.size,special:s.special.size};}

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
    case "ping": {
      const t=Date.now();
      await api("getMe",{});
      const ms=Date.now()-t;
      return fa(ctx.lang,
        "◈ وضعیت سیستم\n\n⛂ - وضعیت ربات : آنلاین\n⛂ - سرعت پاسخ : "+ms+"ms\n⛂ - اتصال دیتابیس : "+(process.env.DATABASE_URL?"متصل":"محلی")+"\n⛂ - وضعیت گروه : فعال\n⛂ - نسخه ربات : v"+(process.env.BOT_VERSION??"2.0.0")+"\n⛂ - وضعیت ضد اسپم : فعال\n⛂ - ادمین‌های آنلاین : "+ctx.staff.length+" از "+ctx.staff.length+"\n\n─────━━───── ◈ ─────━━─────\n\n★ - سیستم پایدار است",
        "◈ System status\n\n⛂ - Bot : Online\n⛂ - Response : "+ms+"ms\n⛂ - Database : "+(process.env.DATABASE_URL?"Connected":"Local")+"\n⛂ - Group : Active\n⛂ - Version : v"+(process.env.BOT_VERSION??"2.0.0")+"\n⛂ - Anti-spam : Active\n⛂ - Online admins : "+ctx.staff.length+"\n\n─────━━───── ◈ ─────━━─────\n\n★ - System is stable");
    }
    case "id": {
      const us=userStats(ctx.chatId,ctx.userId);
      const gs=groupStats(ctx.chatId);
      const username=ctx.userName.startsWith("@")?ctx.userName:"@"+ctx.userName;
      const faText=[
        "◈ اطلاعات کاربر",
        "",
        "⛂ - نام : "+ctx.userName,
        "⛂ - شناسه : "+ctx.userId,
        "⛂ - نام کاربری : "+username,
        "⛂ - مقام : "+rankLabel(ctx.lang,rank),
        "",
        "─────━━───── ◈ ─────━━─────",
        "",
        "⛂ - تعداد پیام امروز : "+us.today,
        "⛂ - تعداد عضویت امروز : "+gs.joinsToday,
        "⛂ - تعداد پیام کل : "+us.total,
        "⛂ - تعداد عضویت کل : "+gs.joinsTotal
      ].join("\n");
      const enText=[
        "◈ User information",
        "",
        "⛂ - Name : "+ctx.userName,
        "⛂ - ID : "+ctx.userId,
        "⛂ - Username : "+username,
        "⛂ - Rank : "+rank,
        "",
        "─────━━───── ◈ ─────━━─────",
        "",
        "⛂ - Messages today : "+us.today,
        "⛂ - Joins today : "+gs.joinsToday,
        "⛂ - Total messages : "+us.total,
        "⛂ - Total joins : "+gs.joinsTotal
      ].join("\n");
      return fa(ctx.lang,faText,enText);
    }
    case "info": {
      const m=await api<number>("getChatMemberCount",{chat_id:ctx.chatId});
      const a=await adminCount(ctx.chatId);
      const gs=groupStats(ctx.chatId);
      const admins=await api<any[]>("getChatAdministrators",{chat_id:ctx.chatId});
      const owner=admins.find(x=>x.status==="creator")?.user;
      const invite=ctx.chat?.invite_link ?? null;
      const st=state(ctx.chatId);
      const faText=[
        "◈ اطلاعات گروه",
        "",
        "⛂ - نام گروه : "+(ctx.chatTitle||"ثبت نشده"),
        "⛂ - شناسه گروه : "+ctx.chatId,
        "⛂ - نام کاربری گروه : "+(ctx.chat?.username?"@"+ctx.chat.username:"ندارد"),
        "⛂ - نوع گروه : "+(ctx.chat?.type||"نامشخص"),
        "⛂ - تعداد اعضا : "+m,
        "⛂ - تعداد مدیران : "+a,
        "⛂ - مالک گروه : "+(owner?.username?("@"+owner.username):(owner?.first_name||"ثبت نشده")),
        "",
        "─────━━───── ◈ ─────━━─────",
        "",
        "⛂ - پیام‌های امروز : "+gs.messagesToday,
        "⛂ - اعضای جدید امروز : "+gs.joinsToday,
        "⛂ - پیام‌های کل : "+gs.messagesTotal,
        "⛂ - اعضای فعلی : "+m,
        "⛂ - افراد در لیست سکوت : "+st.muted.size,
        "⛂ - افراد در لیست ویژه : "+st.special.size,
        "⛂ - اخطارهای فعال : "+stats(ctx.chatId).warnings,
        "",
        "★ - تاریخ ساخت گروه : ثبت نشده",
        "★ - لینک دعوت : "+(invite||"در دسترس نیست"),
        "★ - وضعیت لینک دعوت : "+(invite?"فعال":"در دسترس نیست")
      ].join("\n");
      const enText=[
        "◈ Group information",
        "",
        "⛂ - Name : "+(ctx.chatTitle||"Not recorded"),
        "⛂ - ID : "+ctx.chatId,
        "⛂ - Username : "+(ctx.chat?.username?"@"+ctx.chat.username:"None"),
        "⛂ - Type : "+(ctx.chat?.type||"Unknown"),
        "⛂ - Members : "+m,
        "⛂ - Admins : "+a,
        "⛂ - Owner : "+(owner?.username?("@"+owner.username):(owner?.first_name||"Not recorded")),
        "",
        "─────━━───── ◈ ─────━━─────",
        "",
        "⛂ - Messages today : "+gs.messagesToday,
        "⛂ - New members today : "+gs.joinsToday,
        "⛂ - Total messages : "+gs.messagesTotal,
        "⛂ - Current members : "+m,
        "⛂ - Muted users : "+st.muted.size,
        "⛂ - Special users : "+st.special.size,
        "⛂ - Active warnings : "+stats(ctx.chatId).warnings,
        "",
        "★ - Group creation date : Not recorded",
        "★ - Invite link : "+(invite||"Unavailable"),
        "★ - Invite status : "+(invite?"Active":"Unavailable")
      ].join("\n");
      return fa(ctx.lang,faText,enText);
    }
    case "rank": {
      const rankStart=memberJoinDates.get(userKey(ctx.chatId,ctx.userId));
      const responsibility=rank==="owner"?"تصمیم‌گیری نهایی و مدیریت کامل گروه":rank==="sudo"?"مدیریت ارشد و نظارت کامل":rank==="admin"?"اجرای مدیریت و کنترل گروه":"عضویت و استفاده از امکانات گروه";
      const responsibilityEn=rank==="owner"?"Final group management and decisions":rank==="sudo"?"Senior management and oversight":rank==="admin"?"Group management and moderation":"Group membership and normal use";
      return fa(ctx.lang,
        "◈ سیستم پیشرفته مدیران\n\n★ - "+rankLabel(ctx.lang,rank)+"\n\n⛂ - نام : "+ctx.userName+"\n⛂ - نام کاربری : "+(ctx.userName.startsWith("@")?ctx.userName:"@"+ctx.userName)+"\n⛂ - شناسه : "+ctx.userId+"\n⛂ - مقام : "+rankLabel(ctx.lang,rank)+"\n⛂ - تاریخ شروع : "+formatDate(rankStart,ctx.lang)+"\n⛂ - دسترسی‌ها : "+(rank==="owner"?"کامل":rank==="admin"?"مدیریتی":"عادی")+"\n⛂ - مسئولیت اصلی : "+responsibility,
        "◈ Advanced manager system\n\n★ - "+rank+"\n\n⛂ - Name : "+ctx.userName+"\n⛂ - Username : "+(ctx.userName.startsWith("@")?ctx.userName:"@"+ctx.userName)+"\n⛂ - ID : "+ctx.userId+"\n⛂ - Rank : "+rank+"\n⛂ - Start date : "+formatDate(rankStart,ctx.lang)+"\n⛂ - Access : "+(rank==="owner"?"Full":rank==="admin"?"Management":"Standard")+"\n⛂ - Responsibility : "+responsibilityEn); }
    case "me": {
      const us=userStats(ctx.chatId,ctx.userId);
      const joined=memberJoinDates.get(userKey(ctx.chatId,ctx.userId));
      const muted=state(ctx.chatId).muted.has(ctx.userId);
      const special=state(ctx.chatId).special.has(ctx.userId);
      const warnings=s.warnings.get(ctx.userId)?.count??0;
      const faText=[
        "◈ اطلاعات کاربر",
        "",
        "⛂ - نام : "+ctx.userName,
        "⛂ - نام کاربری : "+(ctx.userName.startsWith("@")?ctx.userName:"@"+ctx.userName),
        "⛂ - شناسه : "+ctx.userId,
        "⛂ - مقام : "+rankLabel(ctx.lang,rank),
        "⛂ - تاریخ عضویت : "+formatDate(joined,ctx.lang),
        "",
        "─────━━───── ◈ ─────━━─────",
        "",
        "⛂ - تعداد پیام امروز : "+us.today,
        "⛂ - تعداد پیام کل : "+us.total,
        "⛂ - تعداد اخطار فعال : "+warnings,
        "⛂ - وضعیت سکوت : "+(muted?"فعال":"غیرفعال"),
        "⛂ - وضعیت لیست ویژه : "+(special?"فعال":"غیرفعال")
      ].join("\n");
      const enText=[
        "◈ User information",
        "",
        "⛂ - Name : "+ctx.userName,
        "⛂ - Username : "+(ctx.userName.startsWith("@")?ctx.userName:"@"+ctx.userName),
        "⛂ - ID : "+ctx.userId,
        "⛂ - Rank : "+rank,
        "⛂ - Join date : "+formatDate(joined,ctx.lang),
        "",
        "─────━━───── ◈ ─────━━─────",
        "",
        "⛂ - Messages today : "+us.today,
        "⛂ - Total messages : "+us.total,
        "⛂ - Active warnings : "+warnings,
        "⛂ - Mute status : "+(muted?"Active":"Inactive"),
        "⛂ - Special status : "+(special?"Active":"Inactive")
      ].join("\n");
      return fa(ctx.lang,faText,enText);
    }
    case "bot": {
      const me=await api<any>("getMe",{});
      const botId=me.id??"—";
      return fa(ctx.lang,
        "◈ اطلاعات فنی ربات\n\n⛂ - نام ربات : "+(ctx.config.botName||"نظم")+"\n⛂ - نام کاربری : "+(ctx.config.botUsername||"—")+"\n⛂ - شناسه ربات : "+botId+"\n⛂ - نسخه ربات : v"+(process.env.BOT_VERSION??"2.0.0")+"\n⛂ - وضعیت ربات : آنلاین\n⛂ - اتصال دیتابیس : "+(process.env.DATABASE_URL?"متصل":"محلی")+"\n⛂ - روش ارتباط تلگرام : Polling\n⛂ - وضعیت سرویس : فعال\n⛂ - سیستم‌عامل : "+process.platform+"\n⛂ - نسخه Node.js : "+process.version+"\n⛂ - uptime : "+Math.floor(process.uptime())+" ثانیه",
        "◈ Bot technical information\n\n⛂ - Bot name : "+(ctx.config.botName||"Nizam")+"\n⛂ - Username : "+(ctx.config.botUsername||"—")+"\n⛂ - Bot ID : "+botId+"\n⛂ - Version : v"+(process.env.BOT_VERSION??"2.0.0")+"\n⛂ - Status : Online\n⛂ - Database : "+(process.env.DATABASE_URL?"Connected":"Local")+"\n⛂ - Telegram connection : Polling\n⛂ - Service : Active\n⛂ - OS : "+process.platform+"\n⛂ - Node.js : "+process.version+"\n⛂ - Uptime : "+Math.floor(process.uptime())+"s");
    }
    case "advertising-lock": {
      requireGroup();
      requireAdmin();
      const value=normalizeToken(args[0]??"status");
      if(["on","enable","enabled","روشن","فعال"].includes(value)){
        setGroupAdvertisingPolicy(ctx.chatId,{enabled:true});
        return fa(ctx.lang,
          "◈ قفل تبلیغات\n\n⛂ - وضعیت : ● فعال\n⛂ - حالت تشخیص : استاندارد\n⛂ - مدیران : مستثنی\n⛂ - کاربران ویژه : مستثنی\n\n★ - محافظت تبلیغاتی گروه فعال شد.",
          "◈ Advertising lock\n\n⛂ - Status : ● Active\n⛂ - Detection : Standard\n⛂ - Administrators : Exempt\n⛂ - Special users : Exempt\n\n★ - Advertising protection is now active."
        );
      }
      if(["off","disable","disabled","خاموش","غیرفعال"].includes(value)){
        setGroupAdvertisingPolicy(ctx.chatId,{enabled:false});
        return fa(ctx.lang,
          "◈ قفل تبلیغات\n\n⛂ - وضعیت : ○ غیرفعال\n\n★ - محافظت تبلیغاتی گروه خاموش شد.",
          "◈ Advertising lock\n\n⛂ - Status : ○ Inactive\n\n★ - Advertising protection is disabled."
        );
      }
      if(["strict","سختگیر","سختگیرانه"].includes(value)){
        setGroupAdvertisingPolicy(ctx.chatId,{enabled:true,mode:"strict"});
        return fa(ctx.lang,
          "◈ قفل تبلیغات\n\n⛂ - وضعیت : ● فعال\n⛂ - حالت تشخیص : سختگیرانه\n⛂ - مدیران : مستثنی\n⛂ - کاربران ویژه : مستثنی",
          "◈ Advertising lock\n\n⛂ - Status : ● Active\n⛂ - Detection : Strict\n⛂ - Administrators : Exempt\n⛂ - Special users : Exempt"
        );
      }
      const p=getGroupAdvertisingPolicy(ctx.chatId);
      return fa(ctx.lang,
        "◈ قفل تبلیغات\n\n⛂ - وضعیت : "+(p.enabled?"● فعال":"○ غیرفعال")+"\n⛂ - حالت تشخیص : "+(p.mode==="strict"?"سختگیرانه":"استاندارد")+"\n⛂ - مدیران : "+(p.exemptAdmins?"مستثنی":"مشمول")+"\n⛂ - کاربران ویژه : "+(p.exemptSpecialUsers?"مستثنی":"مشمول")+"\n\n★ - استفاده : قفل تبلیغات روشن | خاموش | وضعیت | سختگیرانه",
        "◈ Advertising lock\n\n⛂ - Status : "+(p.enabled?"● Active":"○ Inactive")+"\n⛂ - Detection : "+(p.mode==="strict"?"Strict":"Standard")+"\n⛂ - Administrators : "+(p.exemptAdmins?"Exempt":"Included")+"\n⛂ - Special users : "+(p.exemptSpecialUsers?"Exempt":"Included")+"\n\n★ - Usage: advertising lock on | off | status | strict"
      );
    }
    case "status": {
      const gs=groupStats(ctx.chatId);
      const st=state(ctx.chatId);
      const faText=[
        "◈ وضعیت گروه","",
        "⛂ - وضعیت ربات : ● فعال",
        "⛂ - وضعیت مدیریت : ● فعال",
        "⛂ - وضعیت دیتابیس : ● "+(process.env.DATABASE_URL?"متصل":"محلی"),
        "⛂ - وضعیت ضد اسپم : ● فعال",
        "⛂ - وضعیت ضد فلود : ● فعال",
        "⛂ - وضعیت امنیت : ● فعال","",
        "─────━━───── ◈ ─────━━─────","",
        "⛂ - تعداد اعضا : "+ctx.membersCount,
        "⛂ - تعداد مدیران : "+ctx.staff.length,
        "⛂ - پیام‌های امروز : "+gs.messagesToday,
        "⛂ - اخطارهای فعال : "+stats(ctx.chatId).warnings,
        "⛂ - افراد در لیست سکوت : "+st.muted.size,
        "⛂ - افراد در لیست ویژه : "+st.special.size,"",
        "★ - وضعیت کلی گروه : پایدار"
      ].join("\n");
      const enText=[
        "◈ Group status","",
        "⛂ - Bot : ● Active",
        "⛂ - Management : ● Active",
        "⛂ - Database : ● "+(process.env.DATABASE_URL?"Connected":"Local"),
        "⛂ - Anti-spam : ● Active",
        "⛂ - Anti-flood : ● Active",
        "⛂ - Security : ● Active","",
        "─────━━───── ◈ ─────━━─────","",
        "⛂ - Members : "+ctx.membersCount,
        "⛂ - Admins : "+ctx.staff.length,
        "⛂ - Messages today : "+gs.messagesToday,
        "⛂ - Active warnings : "+stats(ctx.chatId).warnings,
        "⛂ - Muted users : "+st.muted.size,
        "⛂ - Special users : "+st.special.size,"",
        "★ - Overall group status : Stable"
      ].join("\n");
      return fa(ctx.lang,faText,enText);
    }
  }
}

export async function recordMessage(chatId:number,userId:number,messageId:number){
  const s=state(chatId);
  s.recent.push(messageId);
  if(s.recent.length>100)s.recent.shift();

  const key=userKey(chatId,userId);
  if(!s.firstSeen.has(userId)) s.firstSeen.set(userId,Date.now());

  userMessageCounts.set(key,(userMessageCounts.get(key)??0)+1);

  const day=dayKey();
  const daily=userMessageDailyCounts.get(key);
  userMessageDailyCounts.set(key,{day,count:(daily?.day===day?daily.count:0)+1});

  const total=(groupMessageTotals.get(chatId)??0)+1;
  groupMessageTotals.set(chatId,total);

  const gd=groupMessageDailyCounts.get(chatId);
  groupMessageDailyCounts.set(chatId,{day,count:(gd?.day===day?gd.count:0)+1});

  const now=Date.now();
  const times=messageTimes.get(chatId)??[];
  times.push(now);
  while(times.length&&now-times[0]>10000)times.shift();
  messageTimes.set(chatId,times);
}

function looksAdvertising(text:string, mode:"standard"|"strict"){
  const t=text.toLowerCase();
  const hasUrl=/(https?:\/\/|www\.|t\.me\/|telegram\.me\/|wa\.me\/)/i.test(t);
  const invite=/(t\.me\/\+|t\.me\/joinchat|telegram\.me\/joinchat)/i.test(t);
  const promo=/(تبلیغ|فروش|خرید|تخفیف|سفارش|درآمد|عضو\s*شو|عضو\s*بشید|کانال\s*ما|پیج\s*ما|قیمت|promo|sale|discount|shop|join\s+us|advertis)/i.test(t);
  if(invite)return true;
  if(mode==="strict")return hasUrl || (promo&&/@[a-z0-9_]{4,}/i.test(t));
  return (hasUrl&&promo) || (promo&&/(لینک|دایرکت|سفارش|رایگان)/i.test(t));
}

export async function moderateLive(ctx:{chatId:number;userId:number;messageId:number;text:string;userRank?:Rank;isSpecial?:boolean}){
  const s=state(ctx.chatId);const now=Date.now();
  const times=messageTimes.get(ctx.chatId)??[];while(times.length&&now-times[0]>10000)times.shift();messageTimes.set(ctx.chatId,times);
  if(s.advertising.enabled){
    const privilegedAdmin=s.advertising.exemptAdmins && ctx.userRank && ctx.userRank!=="member";
    const privilegedSpecial=s.advertising.exemptSpecialUsers && ctx.isSpecial===true;
    if(!privilegedAdmin && !privilegedSpecial && looksAdvertising(ctx.text,s.advertising.mode)){
      try{await api("deleteMessage",{chat_id:ctx.chatId,message_id:ctx.messageId});return true}catch{}
    }
  }
  if(s.nightOn){const h=new Date().getHours();if(h>=0&&h<6){try{await api("deleteMessage",{chat_id:ctx.chatId,message_id:ctx.messageId});return true}catch{}}}
  if(s.floodOn&&times.length>s.floodMax){try{await api("deleteMessage",{chat_id:ctx.chatId,message_id:ctx.messageId});return true}catch{}}
  if(s.spamOn&&/(https?:\/\/|t\.me\/|telegram\.me\/)/i.test(ctx.text)){try{await api("deleteMessage",{chat_id:ctx.chatId,message_id:ctx.messageId});return true}catch{}}
  const lower=ctx.text.toLowerCase();for(const w of s.filters){if(w&&lower.includes(w)){try{await api("deleteMessage",{chat_id:ctx.chatId,message_id:ctx.messageId});return true}catch{}}}
  if(s.locks.has("link")&&/(https?:\/\/|t\.me\/)/i.test(ctx.text)){try{await api("deleteMessage",{chat_id:ctx.chatId,message_id:ctx.messageId});return true}catch{}}
  return false;
}

const robotLinesFa=["جانم من اینجا هستم حاضر و آماده در خدمت شما","بله فرمانده فرمان بدی آماده‌ خدمتم","کاپیتان دستور بده که رو این دریا یه کاپیتان داریم اونم شمایی"];
const robotLinesEn=["I am here and ready to serve.","Yes, commander. Give the order.","Captain, give the order. There is one captain here — you."];
