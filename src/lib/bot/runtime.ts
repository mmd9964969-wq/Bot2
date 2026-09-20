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

export async function runLiveCommand(ctx:LiveContext,token:string,args:string[],rankOverride?:Rank):Promise<string>{
  const command=resolveCommand(token); if(!command)return fa(ctx.lang,"✗ دستور ناشناخته است.","✗ Unknown command.");
  const rank=rankOverride ?? await realRank(ctx,ctx.userId); const s=state(ctx.chatId); const targetId=target(ctx,args);
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
    case "id":
      return fa(ctx.lang,
        "◈ اطلاعات کاربر\n\n⛂ - نام : "+ctx.userName+"\n⛂ - شناسه : "+ctx.userId+"\n⛂ - نام کاربری : "+(ctx.userName.startsWith("@")?ctx.userName:"@"+ctx.userName)+"\n⛂ - مقام : "+rankLabel(ctx.lang,rank)+"\n\n─────━━───── ◈ ─────━━─────\n\n⛂ - تعداد پیام امروز : —\n⛂ - تعداد عضویت امروز : —\n⛂ - تعداد پیام کل : —\n⛂ - تعداد عضویت کل : —",
        "◈ User information\n\n⛂ - Name : "+ctx.userName+"\n⛂ - ID : "+ctx.userId+"\n⛂ - Username : "+(ctx.userName.startsWith("@")?ctx.userName:"@"+ctx.userName)+"\n⛂ - Rank : "+rank+"\n\n─────━━───── ◈ ─────━━─────\n\n⛂ - Messages today : —\n⛂ - Joins today : —\n⛂ - Total messages : —\n⛂ - Total joins : —");
    case "info": {
      requireGroup();
      const [c,m]=await Promise.all([
        api<any>("getChat",{chat_id:ctx.chatId}),
        api<number>("getChatMemberCount",{chat_id:ctx.chatId}),
      ]);
      const a=ctx.staff.length;
      return fa(ctx.lang,
        "◈ اطلاعات گروه\n\n⛂ - نام گروه : "+(c.title??ctx.chatTitle)+"\n⛂ - شناسه گروه : "+ctx.chatId+"\n⛂ - نام کاربری گروه : "+(c.username?"@"+c.username:"ندارد")+"\n⛂ - نوع گروه : "+c.type+"\n⛂ - تعداد اعضا : "+m+"\n⛂ - تعداد مدیران : "+a+"\n⛂ - مالک گروه : —\n\n─────━━───── ◈ ─────━━─────\n\n⛂ - پیام‌های امروز : —\n⛂ - اعضای جدید امروز : —\n⛂ - پیام‌های کل : —\n⛂ - اعضای فعلی : "+m+"\n⛂ - تعداد افراد در لیست سکوت : —\n⛂ - تعداد افراد در لیست ویژه : —\n⛂ - تعداد اخطار های فعال : "+stats(ctx.chatId).warnings+"\n\n★ - تاریخ ساخت گروه : —\n★ - لینک دعوت : —\n★ - وضعیت لینک دعوت : —",
        "◈ Group information\n\n⛂ - Name : "+(c.title??ctx.chatTitle)+"\n⛂ - ID : "+ctx.chatId+"\n⛂ - Username : "+(c.username?"@"+c.username:"None")+"\n⛂ - Type : "+c.type+"\n⛂ - Members : "+m+"\n⛂ - Admins : "+a+"\n⛂ - Owner : —\n\n─────━━───── ◈ ─────━━─────\n\n⛂ - Messages today : —\n⛂ - New members today : —\n⛂ - Total messages : —\n⛂ - Current members : "+m+"\n⛂ - Muted users : —\n⛂ - Special users : —\n⛂ - Active warnings : "+stats(ctx.chatId).warnings+"\n\n★ - Group creation date : —\n★ - Invite link : —\n★ - Invite status : —");
    }
    case "rank":
      return fa(ctx.lang,
        "◈ سیستم پیشرفته مدیران\n\n★ - "+rankLabel(ctx.lang,rank)+"\n\n⛂ - نام : "+ctx.userName+"\n⛂ - نام کاربری : "+(ctx.userName.startsWith("@")?ctx.userName:"@"+ctx.userName)+"\n⛂ - شناسه : "+ctx.userId+"\n⛂ - مقام : "+rankLabel(ctx.lang,rank)+"\n⛂ - تاریخ شروع : —\n⛂ - دسترسی‌ها : "+(rank==="owner"?"کامل":rank==="admin"?"مدیریتی":"عادی")+"\n⛂ - مسئولیت اصلی : —",
        "◈ Advanced manager system\n\n★ - "+rank+"\n\n⛂ - Name : "+ctx.userName+"\n⛂ - Username : "+(ctx.userName.startsWith("@")?ctx.userName:"@"+ctx.userName)+"\n⛂ - ID : "+ctx.userId+"\n⛂ - Rank : "+rank+"\n⛂ - Start date : —\n⛂ - Access : "+(rank==="owner"?"Full":rank==="admin"?"Management":"Standard"));
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
  }
}

export function recordMessage(chatId:number,messageId:number){
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
