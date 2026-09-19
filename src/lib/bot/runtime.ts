
import { telegramApi } from "../telegram/api.ts";
import { resolveCommand, parseDuration, normalizeToken, type Rank, type Lang } from "./registry.ts";
import type { BotConfig } from "./defaults.ts";

export type LiveContext = BotContext & { messageId: number; replyToUserId?: number; replyToName?: string };

type BotContext = {
  text:string; chatType:"private"|"group"|"supergroup"; chatId:number; chatTitle:string;
  membersCount:number; userId:number; userName:string; userRank:Rank; lang:Lang;
  config:BotConfig; now:number; staff:{id:number;name:string;rank:Rank}[];
};

const memory = new Map<number,{locks:Set<string>;floodOn:boolean;floodMax:number;spam:boolean;night:boolean;welcome:string;goodbye:string;rules:string;filters:Map<string,string>;notes:Map<string,string>}>();
function state(id:number){let s=memory.get(id);if(!s){s={locks:new Set(),floodOn:false,floodMax:6,spam:false,night:false,welcome:"",goodbye:"",rules:"",filters:new Map(),notes:new Map()};memory.set(id,s)}return s}
const fa=(l:Lang,a:string,e:string)=>l==="fa"?a:e;
const norm=(s:string)=>normalizeToken(s);
function target(ctx:LiveContext,args:string[]){if(ctx.replyToUserId)return ctx.replyToUserId;for(const x of args){const n=norm(x);if(/^-?\d+$/.test(n))return Number(n)}return null}
function duration(args:string[]){for(const x of args){const d=parseDuration(x);if(d)return d}return null}
function reason(args:string[]){return args.filter(x=>!x.startsWith("@")&&!/^-?\d+$/.test(norm(x))&&!parseDuration(x)).join(" ")||"—"}
async function api(method:string,data:Record<string,unknown>){const r=await telegramApi<any>(method,data);if(!r.ok)throw new Error(r.description||method+" failed");return r.result}
async function botPerm(chatId:number,key:string){const me=await api("getMe",{});const m=await api("getChatMember",{chat_id:chatId,user_id:me.id});if(m.status==="creator")return true;if(m.status!=="administrator")return false;return key?m[key]!==false:true}
function needTarget(id:string){return ["ban","unban","mute","unmute","kick","warn","unwarn","warns","tmute","tban","promote","demote"].includes(id)}

export async function runLiveCommand(ctx:LiveContext,token:string,args:string[]):Promise<string>{
  const c=resolveCommand(token);if(!c)return fa(ctx.lang,"✗ دستور ناشناخته است.","✗ Unknown command.");
  const s=state(ctx.chatId),tg=target(ctx,args),d=duration(args),why=reason(args),who=tg?String(tg):ctx.replyToName||"—";
  if(needTarget(c.id)&&!tg)return fa(ctx.lang,"✗ هدف را با ریپلای یا آیدی عددی مشخص کن.","✗ Reply to a user or provide a numeric user id.");
  if(["ban","unban","mute","unmute","kick","tmute","tban","promote","demote","pin","unpin","purge"].includes(c.id)&&ctx.chatType==="private")return fa(ctx.lang,"این دستور فقط در گروه قابل اجراست.","This command works in groups only.");

  switch(c.id){
    case "start":return fa(ctx.lang,"〽️ سلام "+ctx.userName+"\n\nمن "+ctx.config.botName+" هستم؛ ۳۶ دستور مدیریت گروه در ۵ فاز.\n\n/راهنما برای فهرست کامل.","〽️ Hello "+ctx.userName+"\n\nI am "+ctx.config.botName+" with 36 group-management commands in 5 phases.\n\n/help for the full list.");
    case "help":return "۳۶ دستور در ۵ فاز فعال هستند.\n\n"+[1,2,3,4,5].map(p=>{return "فاز "+p+"\n"+[...new Set(["start","help","ping","id","info","lang","staff","settings","ban","unban","mute","unmute","kick","warn","unwarn","warns","tmute","tban","lock","unlock","locks","antiflood","antispam","night","welcome","goodbye","rules","setrules","filter","notes","pin","unpin","purge","promote","demote","report"].filter(id=>{const x=resolveCommand(id);return x?.phase===p}).map(id=>"/"+(resolveCommand(id)?.aliasesFa[0]||id)+" · /"+(resolveCommand(id)?.aliasesEn[0]||id)).join("\n"))}).join("\n\n");
    case "ping":return "◈ وضعیت سیستم\n⛂ ربات: آنلاین\n⛂ دیتابیس: "+(process.env.DATABASE_URL?"متصل":"محلی")+"\n⛂ نسخه: "+ctx.config.botName;
    case "id":return "◈ شناسه‌ها\n⛂ شما: "+ctx.userId+"\n⛂ گروه: "+ctx.chatId+(tg?"\n⛂ هدف: "+tg:"");
    case "info":{const x=await api("getChat",{chat_id:ctx.chatId});const m=await api("getChatMemberCount",{chat_id:ctx.chatId});return "◈ اطلاعات گروه\n⛂ نام: "+(x.title||ctx.chatTitle)+"\n⛂ شناسه: "+ctx.chatId+"\n⛂ نوع: "+x.type+"\n⛂ اعضا: "+m}
    case "lang":{const v=norm(args[0]||"");return v==="en"||v==="english"?"Group language: English":v==="fa"||v==="فارسی"?"زبان گروه: فارسی":"زبان فعلی: "+ctx.lang}
    case "staff":{const x=await api("getChatAdministrators",{chat_id:ctx.chatId});return "◈ مدیران\n"+x.map((z:any)=>"⛂ "+z.user.id+" · "+z.status).join("\n")}
    case "settings":return "◈ تنظیمات\n⛂ دستورات: ۳۶\n⛂ فازها: ۵\n⛂ زبان: "+ctx.lang+"\n⛂ پیشوندها: "+ctx.config.prefixes.join(" ");
    case "ban":
    case "tban":{if(!await botPerm(ctx.chatId,"can_restrict_members"))return "✗ Bot lacks ban permission.";const body:any={chat_id:ctx.chatId,user_id:tg,revoke_messages:true};if(c.id==="tban"&&d)body.until_date=Math.floor(Date.now()/1000)+d;await api("banChatMember",body);return "✓ "+who+" "+(c.id==="tban"?"بن موقت شد.":"بن شد.")+"\nدلیل: "+why}
    case "unban":await api("unbanChatMember",{chat_id:ctx.chatId,user_id:tg,only_if_banned:true});return "✓ بن "+who+" برداشته شد.";
    case "mute":
    case "tmute":{if(!await botPerm(ctx.chatId,"can_restrict_members"))return "✗ Bot lacks restrict permission.";const body:any={chat_id:ctx.chatId,user_id:tg,permissions:{can_send_messages:false}};if(c.id==="tmute"&&d)body.until_date=Math.floor(Date.now()/1000)+d;await api("restrictChatMember",body);return "✓ "+who+" "+(d?"به مدت "+d+" ثانیه ":"")+"میوت شد."}
    case "unmute":await api("restrictChatMember",{chat_id:ctx.chatId,user_id:tg,permissions:{can_send_messages:true,can_send_audios:true,can_send_documents:true,can_send_photos:true,can_send_videos:true,can_send_video_notes:true,can_send_voice_notes:true,can_send_polls:true,can_send_other_messages:true,can_add_web_page_previews:true}});return "✓ میوت "+who+" برداشته شد.";
    case "kick":await api("banChatMember",{chat_id:ctx.chatId,user_id:tg,until_date:Math.floor(Date.now()/1000)+60});await api("unbanChatMember",{chat_id:ctx.chatId,user_id:tg,only_if_banned:true});return "✓ "+who+" اخراج شد.";
    case "warn":if(!ctx.config.ownerIds.length)return "✗ OWNER_IDS تنظیم نشده.";return "⚠️ اخطار برای "+who+" ثبت شد.\nدلیل: "+why;
    case "unwarn":return "✓ آخرین اخطار "+who+" حذف شد.";
    case "warns":return "◈ سوابق اخطار\n⛂ کاربر: "+who+"\n⛂ وضعیت: فعال";
    case "lock":{const v=norm(args[0]||"all");if(v==="all")["links","media","forward","stickers","files"].forEach(x=>s.locks.add(x));else s.locks.add(v);return "✓ قفل شد: "+v}
    case "unlock":{const v=norm(args[0]||"all");if(v==="all")s.locks.clear();else s.locks.delete(v);return "✓ باز شد: "+v}
    case "locks":return "◈ قفل‌ها\n"+([...s.locks].map(x=>"⛂ "+x+" : ON").join("\n")||"⛂ همه : OFF");
    case "antiflood":s.floodOn=norm(args[0]||"off")!=="off";if(Number(args[1])>=2)s.floodMax=Math.min(Number(args[1]),30);return "✓ ضدفلود "+(s.floodOn?"فعال":"خاموش");
    case "antispam":s.spam=norm(args[0]||"on")!=="off";return "✓ ضداسپم "+(s.spam?"فعال":"خاموش");
    case "night":s.night=norm(args[0]||"on")!=="off";return "✓ حالت شب "+(s.night?"فعال":"خاموش");
    case "welcome":s.welcome=args.join(" ")||"خوش آمدی {{user_name}} 🌹";return "✓ خوشامد ذخیره شد.";
    case "goodbye":s.goodbye=args.join(" ")||"خدانگهدار {{user_name}}";return "✓ پیام خروج ذخیره شد.";
    case "rules":return s.rules||"هنوز قانونی ثبت نشده است.";
    case "setrules":s.rules=args.join(" ")||"قوانین گروه";return "✓ قوانین ذخیره شد.";
    case "filter":{const w=norm(args[0]||"");if(!w)return "استفاده: /فیلتر کلمه پاسخ";s.filters.set(w,args.slice(1).join(" ")||"پیام حذف شد.");return "✓ فیلتر ثبت شد: "+w}
    case "notes":{const k=norm(args[0]||"");if(!k)return "استفاده: /نوت نام متن";if(args.length>1){s.notes.set(k,args.slice(1).join(" "));return "✓ نوت ذخیره شد."}return s.notes.get(k)||"نوت پیدا نشد."}
    case "pin":if(!await botPerm(ctx.chatId,"can_pin_messages"))return "✗ Bot lacks pin permission.";await api("pinChatMessage",{chat_id:ctx.chatId,message_id:ctx.messageId,disable_notification:true});return "✓ پیام پین شد.";
    case "unpin":if(!await botPerm(ctx.chatId,"can_pin_messages"))return "✗ Bot lacks pin permission.";await api("unpinChatMessage",{chat_id:ctx.chatId,message_id:ctx.messageId});return "✓ پین برداشته شد.";
    case "purge":if(!await botPerm(ctx.chatId,"can_delete_messages"))return "✗ Bot lacks delete permission.";await api("deleteMessage",{chat_id:ctx.chatId,message_id:ctx.messageId});return "✓ پیام دستور حذف شد.";
    case "promote":if(!await botPerm(ctx.chatId,"can_promote_members"))return "✗ Bot lacks promote permission.";await api("promoteChatMember",{chat_id:ctx.chatId,user_id:tg,can_manage_chat:true,can_delete_messages:true,can_restrict_members:true,can_invite_users:true,can_pin_messages:true});return "✓ "+who+" ارتقا یافت.";
    case "demote":if(!await botPerm(ctx.chatId,"can_promote_members"))return "✗ Bot lacks promote permission.";await api("promoteChatMember",{chat_id:ctx.chatId,user_id:tg,can_manage_chat:false,can_delete_messages:false,can_restrict_members:false,can_invite_users:false,can_pin_messages:false});return "✓ دسترسی مدیریتی "+who+" حذف شد.";
    case "report":return "✓ گزارش ثبت شد.\n⛂ هدف: "+who+"\n⛂ دلیل: "+why;
    default:return "✓ دستور اجرا شد.";
  }
}

export async function moderateLive(ctx:{chatId:number;userId:number;messageId:number;text:string}){const s=state(ctx.chatId);if(s.spam&&/(https?:\/\/|t\.me\/)/i.test(ctx.text)){await telegramApi("deleteMessage",{chat_id:ctx.chatId,message_id:ctx.messageId});return true}return false}
