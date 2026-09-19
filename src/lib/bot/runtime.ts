
import { telegramApi } from "../telegram/api.ts";
import { resolveCommand, parseDuration, normalizeToken, type Rank, type Lang } from "./registry.ts";
import type { BotConfig } from "./defaults.ts";

export type LiveContext = BotContext & { messageId: number; replyToUserId?: number; replyToName?: string; replyToMessageId?: number };

type BotContext = {
  text:string; chatType:"private"|"group"|"supergroup"; chatId:number; chatTitle:string;
  membersCount:number; userId:number; userName:string; userRank:Rank; lang:Lang;
  config:BotConfig; now:number; staff:{id:number;name:string;rank:Rank}[];
};

const memory = new Map<number,{locks:Set<string>;floodOn:boolean;floodMax:number;spam:boolean;night:boolean;welcome:string;goodbye:string;rules:string;filters:Map<string,string>;notes:Map<string,string>;warnings:Map<number,{count:number;reasons:string[]}>}>();
function state(id:number){let s=memory.get(id);if(!s){s={locks:new Set(),floodOn:false,floodMax:6,spam:false,night:false,welcome:"",goodbye:"",rules:"",filters:new Map(),notes:new Map(),warnings:new Map()};memory.set(id,s)}return s}
const fa=(l:Lang,a:string,e:string)=>l==="fa"?a:e;
const norm=(s:string)=>normalizeToken(s);
function target(ctx:LiveContext,args:string[]){if(ctx.replyToUserId)return ctx.replyToUserId;for(const x of args){const n=norm(x);if(/^-?\d+$/.test(n))return Number(n)}return null}
function duration(args:string[]){for(const x of args){const d=parseDuration(x);if(d)return d}return null}
function reason(args:string[]){return args.filter(x=>!x.startsWith("@")&&!/^-?\d+$/.test(norm(x))&&!parseDuration(x)).join(" ")||"—"}
async function api(method:string,data:Record<string,unknown>){const r=await telegramApi<any>(method,data);if(!r.ok)throw new Error(r.description||method+" failed");return r.result}
async function botPerm(chatId:number,key:string){const me=await api("getMe",{});const m=await api("getChatMember",{chat_id:chatId,user_id:me.id});if(m.status==="creator")return true;if(m.status!=="administrator")return false;return key?m[key]!==false:true}
async function targetMember(chatId:number,userId:number){return api("getChatMember",{chat_id:chatId,user_id:userId})}
async function canModerateTarget(ctx:LiveContext,userId:number){const m=await targetMember(ctx.chatId,userId);if(m.status==="creator")return false;if(m.status==="administrator" && ctx.userRank!=="owner")return false;return true}
function needTarget(id:string){return ["ban","unban","mute","unmute","kick","warn","unwarn","warns","tmute","tban","promote","demote"].includes(id)}

export async function runLiveCommand(ctx: LiveContext, token: string, args: string[]): Promise<string> {
  const command = resolveCommand(token);
  if (!command) return fa(ctx.lang, "✗ دستور ناشناخته است.", "✗ Unknown command.");
  const rank = await realRank(ctx, ctx.userId);
  const targetId = target(ctx, args);
  const s = stats(ctx.chatId);
  switch (command.id) {
    case "robot": {
      const lines = ctx.lang === "fa" ? robotLinesFa : robotLinesEn;
      return lines[Math.floor(Math.random() * lines.length)];
    }
    case "id":
      return ctx.lang === "fa"
        ? \`◈ اطلاعات کاربر

⛂ - نام : \${ctx.userName}
⛂ - شناسه : \${ctx.userId}
⛂ - نام کاربری : \${ctx.userName.startsWith("@") ? ctx.userName : "@" + ctx.userName}
⛂ - مقام : \${rankLabel(ctx.lang, rank)}

─────━━───── ◈ ─────━━─────

⛂ - تعداد پیام امروز : \${s.today}
⛂ - تعداد عضویت امروز : —
⛂ - تعداد پیام کل : \${s.total}
⛂ - تعداد عضویت کل : —\`
        : \`◈ User information

⛂ - Name : \${ctx.userName}
⛂ - ID : \${ctx.userId}
⛂ - Username : \${ctx.userName.startsWith("@") ? ctx.userName : "@" + ctx.userName}
⛂ - Rank : \${rankLabel(ctx.lang, rank)}

─────━━───── ◈ ─────━━─────

⛂ - Messages today : \${s.today}
⛂ - Joins today : —
⛂ - Total messages : \${s.total}
⛂ - Total joins : —\`;
    case "admin":
      return rank === "owner" || rank === "sudo" || rank === "admin"
        ? "✓ دسترسی تأیید شد شما ادمین این گروه هستید."
        : "✗ دسترسی رد شد شما ادمین این گروه نیستید.";
    case "info": {
      if (ctx.chatType === "private") return fa(ctx.lang, "این دستور فقط در گروه قابل اجراست.", "This command works in groups only.");
      const chat = await api<any>("getChat", { chat_id: ctx.chatId });
      const members = await api<number>("getChatMemberCount", { chat_id: ctx.chatId });
      const admins = await adminCount(ctx.chatId);
      return ctx.lang === "fa"
        ? \`◈ اطلاعات گروه

⛂ - نام گروه : \${chat.title ?? ctx.chatTitle}
⛂ - شناسه گروه : \${ctx.chatId}
⛂ - نام کاربری گروه : \${chat.username ? "@" + chat.username : "ندارد"}
⛂ - نوع گروه : \${chat.type}
⛂ - تعداد اعضا : \${members}
⛂ - تعداد مدیران : \${admins}
⛂ - مالک گروه : —

─────━━───── ◈ ─────━━─────

⛂ - پیام‌های امروز : \${s.today}
⛂ - اعضای جدید امروز : —
⛂ - پیام‌های کل : \${s.total}
⛂ - اعضای فعلی : \${members}
⛂ - تعداد افراد در لیست سکوت : —
⛂ - تعداد افراد در لیست ویژه : —
⛂ - تعداد اخطار های فعال : —

★ - تاریخ ساخت گروه : —
★ - لینک دعوت : —
★ - وضعیت لینک دعوت : —\`
        : \`◈ Group information

⛂ - Group name : \${chat.title ?? ctx.chatTitle}
⛂ - Group ID : \${ctx.chatId}
⛂ - Group username : \${chat.username ? "@" + chat.username : "None"}
⛂ - Group type : \${chat.type}
⛂ - Members : \${members}
⛂ - Admins : \${admins}
⛂ - Owner : —

─────━━───── ◈ ─────━━─────

⛂ - Messages today : \${s.today}
⛂ - New members today : —
⛂ - Total messages : \${s.total}
⛂ - Current members : \${members}
⛂ - Muted users : —
⛂ - Special users : —
⛂ - Active warnings : —

★ - Group creation date : —
★ - Invite link : —
★ - Invite status : —\`;
    }
    case "rank": {
      if (ctx.chatType === "private") return fa(ctx.lang, "این دستور فقط در گروه قابل اجراست.", "This command works in groups only.");
      if (rank === "member") return fa(ctx.lang, "✗ این دستور فقط برای مدیران قابل استفاده است.", "✗ This command is available to administrators.");
      if (!ctx.replyToUserId) return fa(ctx.lang, "✗ برای مشاهده مقام، روی پیام کاربر موردنظر ریپلای کن.", "✗ Reply to the target user's message.");
      const r = await realRank(ctx, ctx.replyToUserId);
      const special = envIds("SPECIAL_IDS").has(String(ctx.replyToUserId));
      const access = r === "owner" ? (ctx.lang === "fa" ? "کامل و غیرقابل محدود شدن" : "Full and unrestricted") : r === "admin" ? (ctx.lang === "fa" ? "مدیریتی" : "Management") : special ? (ctx.lang === "fa" ? "دور از قفل‌ها" : "Lock-exempt") : (ctx.lang === "fa" ? "عادی" : "Standard");
      return ctx.lang === "fa"
        ? \`◈ سیستم پیشرفته مدیران گروه

★ - \${rankLabel(ctx.lang, r)}

⛂ - نام : \${ctx.replyToName ?? "—"}
⛂ - نام کاربری : \${ctx.replyToName ? "@" + ctx.replyToName.replace(/^@/, "") : "—"}
⛂ - شناسه : \${ctx.replyToUserId}
⛂ - مقام : \${rankLabel(ctx.lang, r)}
⛂ - تاریخ شروع : —
⛂ - دسترسی‌ها : \${access}
⛂ - مسئولیت اصلی : \${r === "owner" ? "تصمیم‌گیری نهایی و مدیریت کل گروه" : r === "admin" ? "مدیریت روزانه گروه و کنترل محتوا" : "—"}\`
        : \`◈ Advanced group role system

★ - \${rankLabel(ctx.lang, r)}

⛂ - Name : \${ctx.replyToName ?? "—"}
⛂ - Username : \${ctx.replyToName ? "@" + ctx.replyToName.replace(/^@/, "") : "—"}
⛂ - ID : \${ctx.replyToUserId}
⛂ - Role : \${rankLabel(ctx.lang, r)}
⛂ - Start date : —
⛂ - Access : \${access}
⛂ - Responsibility : \${r === "owner" ? "Final decisions and full group management" : r === "admin" ? "Daily management and content control" : "—"}\`;
    }
    case "me":
      return ctx.lang === "fa"
        ? \`◈ اطلاعات کاربر

⛂ - نام : \${ctx.userName}
⛂ - نام کاربری : \${ctx.userName.startsWith("@") ? ctx.userName : "@" + ctx.userName}
⛂ - شناسه : \${ctx.userId}
⛂ - مقام : \${rankLabel(ctx.lang, rank)}
⛂ - تاریخ عضویت : —

─────━━───── ◈ ─────━━─────

⛂ - تعداد پیام امروز : \${s.today}
⛂ - تعداد پیام کل : \${s.total}
⛂ - تعداد اخطار فعال : —
⛂ - وضعیت سکوت : —
⛂ - وضعیت لیست ویژه : \${envIds("SPECIAL_IDS").has(String(ctx.userId)) ? "فعال" : "غیرفعال"}\`
        : \`◈ User information

⛂ - Name : \${ctx.userName}
⛂ - Username : \${ctx.userName.startsWith("@") ? ctx.userName : "@" + ctx.userName}
⛂ - ID : \${ctx.userId}
⛂ - Rank : \${rankLabel(ctx.lang, rank)}
⛂ - Join date : —

─────━━───── ◈ ─────━━─────

⛂ - Messages today : \${s.today}
⛂ - Total messages : \${s.total}
⛂ - Active warnings : —
⛂ - Mute status : —
⛂ - Special list : \${envIds("SPECIAL_IDS").has(String(ctx.userId)) ? "Active" : "Inactive"}\`;
    case "ping": {
      const t = Date.now();
      await api("getMe", {});
      const latency = Date.now() - t;
      const admins = ctx.chatType === "private" ? 0 : await adminCount(ctx.chatId);
      return ctx.lang === "fa"
        ? \`◈ وضعیت سیستم

⛂ - وضعیت ربات : آنلاین
⛂ - سرعت پاسخ : \${latency}ms
⛂ - اتصال دیتابیس : \${process.env.DATABASE_URL ? "متصل" : "محلی"}
⛂ - وضعیت گروه : \${ctx.chatType === "private" ? "خصوصی" : "فعال"}
⛂ - نسخه ربات : v\${process.env.BOT_VERSION ?? "2.0.0"}
⛂ - وضعیت ضد اسپم : فعال
⛂ - ادمین‌های فعال : \${admins}

─────━━───── ◈ ─────━━─────

★ - سیستم پایدار است\`
        : \`◈ System status

⛂ - Bot status : Online
⛂ - Response speed : \${latency}ms
⛂ - Database : \${process.env.DATABASE_URL ? "Connected" : "Local"}
⛂ - Group status : \${ctx.chatType === "private" ? "Private" : "Active"}
⛂ - Bot version : v\${process.env.BOT_VERSION ?? "2.0.0"}
⛂ - Anti-spam : Active
⛂ - Active admins : \${admins}

─────━━───── ◈ ─────━━─────

★ - System is stable\`;
    }
    case "bot": {
      const t = Date.now();
      const me = await api<any>("getMe", {});
      const latency = Date.now() - t;
      return ctx.lang === "fa"
        ? \`◈ اطلاعات فنی ربات

⛂ - نام ربات : \${me.first_name ?? ctx.config.botName}
⛂ - نام کاربری : \${me.username ? "@" + me.username : "—"}
⛂ - شناسه ربات : \${me.id}
⛂ - نسخه ربات : v\${process.env.BOT_VERSION ?? "2.0.0"}
⛂ - وضعیت ربات : آنلاین
⛂ - وضعیت دیتابیس : \${process.env.DATABASE_URL ? "متصل" : "محلی"}
⛂ - API تلگرام : متصل
⛂ - روش دریافت آپدیت : Polling
⛂ - سرعت پاسخ : \${latency}ms
⛂ - سرور : Railway
⛂ - منطقه : \${process.env.RAILWAY_REPLICA_REGION ?? process.env.RAILWAY_REGION ?? "—"}
⛂ - سیستم‌عامل : \${process.platform}
⛂ - Node.js : \${process.version}

★ - اطلاعات محرمانه مانند BOT_TOKEN نمایش داده نمی‌شود.\`
        : \`◈ Bot technical status

⛂ - Bot name : \${me.first_name ?? ctx.config.botName}
⛂ - Username : \${me.username ? "@" + me.username : "—"}
⛂ - Bot ID : \${me.id}
⛂ - Bot version : v\${process.env.BOT_VERSION ?? "2.0.0"}
⛂ - Bot status : Online
⛂ - Database : \${process.env.DATABASE_URL ? "Connected" : "Local"}
⛂ - Telegram API : Connected
⛂ - Update method : Polling
⛂ - Response speed : \${latency}ms
⛂ - Server : Railway
⛂ - Region : \${process.env.RAILWAY_REPLICA_REGION ?? process.env.RAILWAY_REGION ?? "—"}
⛂ - OS : \${process.platform}
⛂ - Node.js : \${process.version}

★ - Sensitive secrets such as BOT_TOKEN are never displayed.\`;
    }
    case "status": {
      if (ctx.chatType === "private") return fa(ctx.lang, "وضعیت گروه در چت خصوصی قابل نمایش نیست.", "Group status is unavailable in private chat.");
      const members = await api<number>("getChatMemberCount", { chat_id: ctx.chatId });
      const admins = await adminCount(ctx.chatId);
      return ctx.lang === "fa"
        ? \`◈ وضعیت گروه

⛂ - وضعیت ربات : ● فعال
⛂ - وضعیت مدیریت : ● فعال
⛂ - وضعیت دیتابیس : ● \${process.env.DATABASE_URL ? "متصل" : "محلی"}
⛂ - وضعیت ضد اسپم : ● فعال
⛂ - وضعیت ضد فلود : ● فعال
⛂ - وضعیت امنیت : ● فعال

─────━━───── ◈ ─────━━─────

⛂ - تعداد اعضا : \${members}
⛂ - تعداد مدیران : \${admins}
⛂ - پیام‌های امروز : \${s.today}
⛂ - اخطارهای فعال : —
⛂ - افراد در لیست سکوت : —
⛂ - افراد در لیست ویژه : —

★ - وضعیت کلی گروه : پایدار\`
        : \`◈ Group status

⛂ - Bot : ● Active
⛂ - Management : ● Active
⛂ - Database : ● \${process.env.DATABASE_URL ? "Connected" : "Local"}
⛂ - Anti-spam : ● Active
⛂ - Anti-flood : ● Active
⛂ - Security : ● Active

─────━━───── ◈ ─────━━─────

⛂ - Members : \${members}
⛂ - Admins : \${admins}
⛂ - Messages today : \${s.today}
⛂ - Active warnings : —
⛂ - Muted users : —
⛂ - Special users : —

★ - Overall group status : Stable\`;
    }
    default:
      return fa(ctx.lang, "✗ این دستور در دو فاز فعال ربات وجود ندارد.", "✗ This command is not part of the two active bot phases.");
  }
}

export async function moderateLive(ctx:{chatId:number;userId:number;messageId:number;text:string}){const s=state(ctx.chatId);if(s.spam&&/(https?:\/\/|t\.me\/)/i.test(ctx.text)){await telegramApi("deleteMessage",{chat_id:ctx.chatId,message_id:ctx.messageId});return true}return false}
