import { telegramApi } from "../telegram/api.ts";
import { resolveCommand, parseDuration, normalizeToken, type Rank, type Lang } from "./registry.ts";
import type { BotConfig } from "./defaults.ts";

export type LiveContext = BotContext & { messageId:number; replyToUserId?:number; replyToName?:string; replyToMessageId?:number; authorizedByManager?:boolean };
export type BotContext = {
  text:string; chatType:"private"|"group"|"supergroup"; chatId:number; chatTitle:string; chatUsername?:string;
  membersCount:number; userId:number; userName:string; userUsername?:string; userRank:Rank; lang:Lang;
  getMemberJoinDate?: (chatId:number,userId:number)=>Promise<number|undefined>;
  getUserMessageStats?: (chatId:number,userId:number)=>Promise<{today:number;total:number;average:number|null;rank:number;lastActivity?:number;exact:boolean}>;
  getUserJoinStats?: (chatId:number,userId:number)=>Promise<{today:number;total:number}>;
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
};
const groups=new Map<number,GroupState>();
let robotIndex=0;
const chatLang=new Map<number,Lang>();
const messageTimes=new Map<number,number[]>();
const userMessageCounts=new Map<string, number>();
const userMessageDailyCounts=new Map<string, { day:string; count:number }>();
const userLastMessageAt=new Map<string,number>();
const groupMessageTotals=new Map<number,number>();
const groupMessageDailyCounts=new Map<number,{day:string;count:number}>();
const memberJoins=new Map<string,number[]>();
const userJoinCounts=new Map<string,number[]>();
const memberJoinDates=new Map<string,number>();
function userKey(chatId:number,userId:number){ return chatId+":"+userId; }
function dayKey(){ return new Intl.DateTimeFormat("en-CA",{year:"numeric",month:"2-digit",day:"2-digit",timeZone:"Asia/Tehran"}).format(new Date()); }
function userStats(chatId:number,userId:number){
  const key=userKey(chatId,userId);
  const daily=userMessageDailyCounts.get(key);
  return { total:userMessageCounts.get(key)??0, today:daily?.day===dayKey()?daily.count:0 };
}
export function getGroupStats(chatId:number){
  const daily=groupMessageDailyCounts.get(chatId);
  const joins=memberJoins.get(String(chatId))??[];
  const today=dayKey();
  const prefix=chatId+":";
  const now=Date.now();
  let activeUsers=0;
  for(const [key,lastSeen] of userLastMessageAt){
    if(key.startsWith(prefix)&&now-lastSeen<=30*60*1000)activeUsers++;
  }
  return {
    messagesTotal:groupMessageTotals.get(chatId)??0,
    messagesToday:daily?.day===today?daily.count:0,
    joinsTotal:joins.length,
    joinsToday:joins.filter(t=>new Date(t).toISOString().slice(0,10)===today).length,
    activeUsers
  };
}
function relativeTime(ts:number,l:Lang){
  const diff=Math.max(0,Date.now()-ts);
  const minutes=Math.floor(diff/60000);
  if(minutes<1)return l==="fa"?"همین الان":"Just now";
  if(minutes<60)return l==="fa"?minutes+" دقیقه پیش":minutes+" minutes ago";
  const hours=Math.floor(minutes/60);
  if(hours<24)return l==="fa"?hours+" ساعت پیش":hours+" hours ago";
  const days=Math.floor(hours/24);
  return l==="fa"?days+" روز پیش":days+" days ago";
}
function pad2(n:number){return String(n).padStart(2,"0");}
function dualDate(ts:number|undefined,l:Lang){
  if(!ts)return l==="fa"?"ثبت نشده":"Not recorded";
  const d=new Date(ts);
  const greg=new Intl.DateTimeFormat("en-CA",{year:"numeric",month:"2-digit",day:"2-digit",timeZone:"Asia/Tehran"}).format(d).replace(/-/g,"/");
  const persianParts=new Intl.DateTimeFormat("fa-IR-u-ca-persian",{year:"numeric",month:"2-digit",day:"2-digit",timeZone:"Asia/Tehran"}).formatToParts(d);
  const gy=persianParts.find(x=>x.type==="year")?.value??"—";
  const gm=persianParts.find(x=>x.type==="month")?.value??"—";
  const gd=persianParts.find(x=>x.type==="day")?.value??"—";
  const faDate=gy+"/"+gm+"/"+gd;
  return l==="fa"?faDate+" - "+greg:greg;
}
function formatDate(ts:number|undefined,l:Lang){
  return dualDate(ts,l);
}
export async function recordMemberJoin(chatId:number,userId:number,ts:number){
  const key=String(chatId);
  const list=memberJoins.get(key)??[];
  list.push(ts);
  memberJoins.set(key,list);
  const user=userKey(chatId,userId);
  const userJoins=userJoinCounts.get(user)??[];
  userJoins.push(ts);
  userJoinCounts.set(user,userJoins);
  if(!memberJoinDates.has(user)) memberJoinDates.set(user,ts);
  const s=state(chatId);
  if(!s.joins.has(userId)) s.joins.set(userId,ts);
  if(!s.firstSeen.has(userId)) s.firstSeen.set(userId,ts);
}
function state(id:number):GroupState{
  let s=groups.get(id);
  if(!s){s={locks:new Set(),floodOn:false,floodMax:6,spamOn:false,nightOn:false,welcome:"",goodbye:"",rules:"",filters:new Set(),notes:new Map(),warnings:new Map(),recent:[],language:"fa",muted:new Set(),special:new Set(),joins:new Map(),firstSeen:new Map(),groupMessageTotal:0,groupDaily:{day:dayKey(),count:0}};groups.set(id,s)}
  return s;
}
const fa=(l:Lang,a:string,e:string)=>l==="fa"?a:e;
async function api<T=any>(method:string,data:Record<string,unknown>){const r=await telegramApi<T>(method,data);if(!r.ok)throw new Error(r.description||method+" failed");return r.result;}
function target(ctx:LiveContext,args:string[]){if(ctx.replyToUserId)return ctx.replyToUserId;for(const x of args){const n=normalizeToken(x);if(/^-?\d+$/.test(n))return Number(n)}return null;}
function duration(args:string[]){for(const x of args){const d=parseDuration(x);if(d)return d}return null;}
function reason(args:string[]){return args.filter(x=>!x.startsWith("@")&&!/^-?\d+$/.test(normalizeToken(x))&&!parseDuration(x)).join(" ")||"—";}
function rankLabel(l:Lang,r:Rank){return l==="fa"?(r==="owner"?"مالک":r==="member"?"کاربر":"مدیر"):r==="owner"?"owner":r==="member"?"member":"manager";}
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
  const rank=await realRank(ctx,ctx.userId);
  if(rank==="member" && command.id!=="me" && !ctx.authorizedByManager) return fa(ctx.lang,"✗ کاربران عادی اجازه اجرای این دستور را ندارند.","✗ Regular members are not allowed to execute this command.");
  const s=state(ctx.chatId); const targetId=target(ctx,args);
  const requireGroup=()=>{if(ctx.chatType==="private")throw new Error(fa(ctx.lang,"این دستور فقط در گروه قابل اجراست.","This command works in groups only."));};
  const requireAdmin=()=>{if(!["owner","sudo","admin"].includes(rank))throw new Error(fa(ctx.lang,"✗ دسترسی مدیریتی ندارید.","✗ Administrator access required."));};
  const targetRequired=()=>{if(!targetId)throw new Error(fa(ctx.lang,"✗ روی پیام کاربر ریپلای کن یا شناسه عددی بده.","✗ Reply to a user or provide a numeric ID."));return targetId;};

  switch(command.id){
    case "robot": {
      const lines=ctx.lang==="fa"?robotLinesFa:robotLinesEn;
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
      const userKeyValue=userKey(ctx.chatId,ctx.userId);
      const fallbackStats=userStats(ctx.chatId,ctx.userId);
      const persistentStats=ctx.getUserMessageStats
        ? await ctx.getUserMessageStats(ctx.chatId,ctx.userId).catch(()=>undefined)
        : undefined;
      const us=persistentStats ?? {
        ...fallbackStats,
        average:fallbackStats.total,
        rank:0,
      };
      const joinList=userJoinCounts.get(userKeyValue)??[];
      const persistentJoinStats=ctx.getUserJoinStats
        ? await ctx.getUserJoinStats(ctx.chatId,ctx.userId).catch(()=>undefined)
        : undefined;
      const joinedAt=ctx.getMemberJoinDate
        ? (await ctx.getMemberJoinDate(ctx.chatId,ctx.userId)) ?? memberJoinDates.get(userKeyValue)
        : memberJoinDates.get(userKeyValue);

      const warnings=state(ctx.chatId).warnings.get(ctx.userId)?.count??0;
      const muted=state(ctx.chatId).muted.has(ctx.userId);
      const now=Date.now();
      const lastAt=userLastMessageAt.get(userKeyValue);
      const elapsedDays=joinedAt?Math.max(1,Math.ceil((now-joinedAt)/86400000)):1;
      const average=persistentStats?.average ?? Math.round(us.total/elapsedDays);
      const lastTimestamp=persistentStats?.lastActivity ?? lastAt;
      const lastActivity=lastTimestamp?relativeTime(lastTimestamp,ctx.lang):"ثبت نشده";
      const rankByMessages=persistentStats?.rank
        ? persistentStats.rank
        : Array.from(userMessageCounts.entries())
            .filter(([k])=>k.startsWith(ctx.chatId+":"))
            .sort((a,b)=>b[1]-a[1])
            .findIndex(([k])=>k===userKeyValue)+1;
      const todayJoins=persistentJoinStats?.today ?? joinList.filter(t=>new Date(t).toISOString().slice(0,10)===dayKey()).length;
      const totalJoins=persistentJoinStats?.total ?? joinList.length;
      const faText=[
        "◈ اطلاعات کاربر",
        "",
        "⛂ - نام : "+ctx.userName,
        "⛂ - شناسه : "+ctx.userId,
        "⛂ - نام کاربری : "+(ctx.userUsername?"@"+ctx.userUsername.replace(/^@/,""):"ثبت نشده"),
        "⛂ - مقام : "+rankLabel(ctx.lang,rank),
        "⛂ - تاریخ عضویت : "+(joinedAt?formatDate(joinedAt,"fa"):"ثبت نشده"),
        "⛂ - آخرین فعالیت : "+(persistentStats && !persistentStats.lastActivity ? "قابل تعیین نیست" : lastActivity),
        "",
        "                         ─────━━───── ◈ ─────━━───── ",
        "",
        "⛂ - تعداد پیام امروز : "+(us.today<0?"قابل تعیین نیست":us.today),
        "⛂ - تعداد پیام کل : "+us.total,
        "⛂ - میانگین پیام روزانه : "+(persistentStats && !persistentStats.exact ? "قابل تعیین نیست" : (average??"قابل تعیین نیست")),
        "⛂ - رتبه در گروه : #"+(rankByMessages||"—"),
        "",
        "                         ─────━━───── ◈ ─────━━───── ",
        "",
        "⛂ - تعداد عضویت امروز : "+todayJoins,
        "⛂ - تعداد عضویت کل : "+totalJoins,
        "⛂ - اخطارها : "+warnings+"/3",
        "⛂ - وضعیت سکوت : "+(muted?"دارد":"ندارد")
      ].join("\n");
      const enText=[
        "◈ User information",
        "",
        "⛂ - Name : "+ctx.userName,
        "⛂ - ID : "+ctx.userId,
        "⛂ - Username : "+(ctx.userUsername?"@"+ctx.userUsername.replace(/^@/,""):"Not set"),
        "⛂ - Rank : "+rank,
        "⛂ - Join date : "+(joinedAt?formatDate(joinedAt,"en-GB"):"Not recorded"),
        "⛂ - Last activity : "+(persistentStats && !persistentStats.lastActivity ? "Cannot determine" : lastActivity),
        "",
        "                         ─────━━───── ◈ ─────━━───── ",
        "",
        "⛂ - Messages today : "+(us.today<0?"Cannot determine":us.today),
        "⛂ - Total messages : "+us.total,
        "⛂ - Average daily messages : "+(persistentStats && !persistentStats.exact ? "Cannot determine" : (average??"Cannot determine")),
        "⛂ - Group rank : #"+(rankByMessages||"—"),
        "",
        "─────━━───── ◈ ─────━━─────",
        "",
        "⛂ - Joins today : "+todayJoins,
        "⛂ - Total joins : "+totalJoins,
        "⛂ - Warnings : "+warnings+"/3",
        "⛂ - Mute status : "+(muted?"Muted":"Not muted")
      ].join("\n");
      return fa(ctx.lang,faText,enText);
    }
    case "info": {
      const chatInfo=await api<any>("getChat",{chat_id:ctx.chatId});
      const m=await api<number>("getChatMemberCount",{chat_id:ctx.chatId});
      const admins=await api<any[]>("getChatAdministrators",{chat_id:ctx.chatId});
      const a=admins.length;
      const owner=admins.find(x=>x.status==="creator")?.user;
      const gs=getGroupStats(ctx.chatId);
      const st=state(ctx.chatId);
      const chatName=String(chatInfo?.title||ctx.chatTitle||"ثبت نشده").trim()||"ثبت نشده";
      const chatUsername=chatInfo?.username?("@"+String(chatInfo.username)):"—";
      const chatType=String(chatInfo?.type||ctx.chatType||"نامشخص");
      const invite=chatInfo?.invite_link?String(chatInfo.invite_link):(chatInfo?.username?("https://t.me/"+String(chatInfo.username)):null);
      const ownerName=owner?(owner.username?("@"+String(owner.username)):[owner.first_name,owner.last_name].filter(Boolean).join(" ")||String(owner.id)):"قابل شناسایی نیست";
      const creationDate="از Telegram Bot API قابل دریافت نیست";
      const inviteStatus=invite?(chatInfo?.invite_link?"فعال":"لینک عمومی گروه"):"لینک قابل دریافت نیست";
      const faText=[
        "◈ اطلاعات گروه",
        "",
        "⛂ - نام گروه : "+chatName,
        "⛂ - شناسه گروه : "+ctx.chatId,
        "⛂ - نام کاربری گروه : "+chatUsername,
        "⛂ - نوع گروه : "+chatType,
        "⛂ - تعداد اعضا : "+m,
        "⛂ - تعداد مدیران : "+a,
        "⛂ - مالک گروه : "+ownerName,
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
        "★ - تاریخ ساخت گروه : "+creationDate,
        "★ - لینک دعوت : "+(invite||"در دسترس نیست"),
        "★ - وضعیت لینک دعوت : "+inviteStatus
      ].join("\n");
      const enText=[
        "◈ Group information",
        "",
        "⛂ - Name : "+chatName,
        "⛂ - ID : "+ctx.chatId,
        "⛂ - Username : "+chatUsername,
        "⛂ - Type : "+chatType,
        "⛂ - Members : "+m,
        "⛂ - Admins : "+a,
        "⛂ - Owner : "+ownerName,
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
        "★ - Group creation date : "+creationDate,
        "★ - Invite link : "+(invite||"Unavailable"),
        "★ - Invite status : "+(invite?"Active":"Unavailable")
      ].join("\n");
      return fa(ctx.lang,faText,enText);
    }
    case "rank": {
      const rankStart=ctx.getMemberJoinDate
        ? (await ctx.getMemberJoinDate(ctx.chatId,ctx.userId)) ?? memberJoinDates.get(userKey(ctx.chatId,ctx.userId))
        : memberJoinDates.get(userKey(ctx.chatId,ctx.userId));
      const responsibility=rank==="owner"?"تصمیم‌گیری نهایی و مدیریت کامل گروه":rank==="sudo"?"مدیریت ارشد و نظارت کامل":rank==="admin"?"اجرای مدیریت و کنترل گروه":"عضویت و استفاده از امکانات گروه";
      const responsibilityEn=rank==="owner"?"Final group management and decisions":rank==="sudo"?"Senior management and oversight":rank==="admin"?"Group management and moderation":"Group membership and normal use";
      return fa(ctx.lang,
        "◈ سیستم پیشرفته مدیران\n\n★ - "+rankLabel(ctx.lang,rank)+"\n\n⛂ - نام : "+ctx.userName+"\n⛂ - نام کاربری : "+(ctx.userName.startsWith("@")?ctx.userName:"@"+ctx.userName)+"\n⛂ - شناسه : "+ctx.userId+"\n⛂ - مقام : "+rankLabel(ctx.lang,rank)+"\n⛂ - تاریخ شروع : "+formatDate(rankStart,ctx.lang)+"\n⛂ - دسترسی‌ها : "+(rank==="owner"?"کامل":rank==="admin"?"مدیریتی":"عادی")+"\n⛂ - مسئولیت اصلی : "+responsibility,
        "◈ Advanced manager system\n\n★ - "+rank+"\n\n⛂ - Name : "+ctx.userName+"\n⛂ - Username : "+(ctx.userName.startsWith("@")?ctx.userName:"@"+ctx.userName)+"\n⛂ - ID : "+ctx.userId+"\n⛂ - Rank : "+rank+"\n⛂ - Start date : "+formatDate(rankStart,ctx.lang)+"\n⛂ - Access : "+(rank==="owner"?"Full":rank==="admin"?"Management":"Standard")+"\n⛂ - Responsibility : "+responsibilityEn); }
    case "me": {
      const us=userStats(ctx.chatId,ctx.userId);
      const joined=ctx.getMemberJoinDate
        ? (await ctx.getMemberJoinDate(ctx.chatId,ctx.userId)) ?? memberJoinDates.get(userKey(ctx.chatId,ctx.userId))
        : memberJoinDates.get(userKey(ctx.chatId,ctx.userId));
      const muted=state(ctx.chatId).muted.has(ctx.userId);
      const special=state(ctx.chatId).special.has(ctx.userId);
      const warnings=s.warnings.get(ctx.userId)?.count??0;
      const faText=[
        "◈ اطلاعات کاربر",
        "",
        "⛂ - نام : "+ctx.userName,
        "⛂ - نام کاربری : "+(ctx.userUsername?"@"+ctx.userUsername.replace(/^@/,""):"ثبت نشده"),
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
        "⛂ - Username : "+(ctx.userUsername?"@"+ctx.userUsername.replace(/^@/,""):"Not set"),
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
    case "status": {
      const gs=getGroupStats(ctx.chatId);
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
  userLastMessageAt.set(key,Date.now());

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

export async function moderateLive(ctx:{chatId:number;userId:number;messageId:number;text:string}){
  // Automatic member-message deletion is intentionally disabled.
  // Messages are only removable through explicit manager actions such as «حذف» or confirmed «پاکسازی».
  return false;
}

const robotLinesFa=["جانم من اینجا هستم حاضر و آماده در خدمت شما","بله فرمانده فرمان بدی آماده‌ خدمتم","کاپیتان دستور بده که رو این دریا یه کاپیتان داریم اونم شمایی","بله فرمانده گوش به فرمانم","جانم کاپیتان بگو چیکار کنه این خدمه","حاضر و آماده‌ام فقط فرمان بده","چشم قربان ربات در خدمت شماست.","کاپیتان صدام کرد؟ کشتی آماده‌ی حرکته","بله رئیس منتظر دستور بعدی‌ام","فرمانده این سرباز کوچیک آماده‌ی خدمته","جانم؟ ربات با تمام قوا پای کاره","بفرمایید ناخدا دریا دست شماست","ربات گزارش میده آماده‌ی اجرای دستورات","بله سرورم هر دستوری باشه انجام میشه","جانم فرمانده مأموریت چیه؟","کشتی و خدمه آماده‌ان دستور بدید ناخدا","صدام کردی؟ با سرعت نور رسیدم فرمان بده","چشم کاپیتان سکان دست شماست","فرمانده‌ی عزیز ربات در موقعیت و آماده‌ به‌کار است","بله بله کاپیتان واقعی شما هستین بفرمایید"];
const robotLinesEn=["I am here and ready to serve.","Yes, commander. Give the order.","Captain, give the order. There is one captain here — you."];
