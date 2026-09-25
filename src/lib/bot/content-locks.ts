
import type { Pool } from "pg";
import { telegramApi } from "../telegram/api.ts";
import { glassKeyboard } from "./panel-design.ts";
import type { Rank } from "./registry.ts";

type Entity={type?:string;offset?:number;length?:number;url?:string};
type FileLike={file_name?:string;file_size?:number;mime_type?:string};
type ForwardOrigin={type?:string;chat?:{id?:number;type?:string};sender_chat?:{id?:number;type?:string};sender_user?:{id?:number}};
export type ContentLockMessage={
  message_id:number;
  chat:{id:number;type:string};
  text?:string;
  caption?:string;
  entities?:Entity[];
  caption_entities?:Entity[];
  reply_to_message?:unknown;
  forward_origin?:ForwardOrigin;
  has_protected_content?:boolean;
  is_automatic_forward?:boolean;
  photo?:FileLike[];
  video?:FileLike;
  audio?:FileLike;
  animation?:FileLike;
  sticker?:FileLike;
  voice?:FileLike;
  video_note?:FileLike;
  document?:FileLike;
  contact?:unknown;
  location?:unknown;
  venue?:unknown;
  poll?:unknown;
  dice?:unknown;
  game?:unknown;
  web_app_data?:unknown;
  new_chat_members?:Array<{id:number;is_bot?:boolean;first_name?:string;username?:string}>;
  story?:{chat?:{id?:number;type?:string};id?:number};
  link_preview_options?:unknown;
};
type Rule={rule_key:string;section:string;enabled:boolean;config:any};
type Exception={exception_type:string;target_id:string;scope:string[];enabled:boolean};
type Domain={domain:string;enabled:boolean};
type Input={
  pool:Pool|null;
  groupId:number;
  userId:number;
  firstName?:string;
  username?:string;
  userRank:Rank;
  text:string;
  message:ContentLockMessage;
  edited?:boolean;
};

const cache=new Map<number,{at:number;settings:any;rules:Rule[];exceptions:Exception[];domains:Domain[]}>();
const windows=new Map<string,number[]>();
const duplicateWindows=new Map<string,string[]>();
const joinWindows=new Map<number,number[]>();
const customRoleCache=new Map<number,{at:number;role:string}>();

const defaultRules=[
  ["normal","normal_media",false,{action:"delete"}],["normal","normal_links",false,{action:"delete_notify"}],["normal","normal_ads",false,{action:"delete_notify"}],["normal","normal_files",false,{action:"delete"}],["normal","normal_forward",false,{action:"delete_notify"}],["normal","normal_contact",false,{action:"delete_notify"}],["normal","normal_location",false,{action:"delete_notify"}],["normal","normal_poll",false,{action:"delete"}],["normal","normal_dice",false,{action:"delete"}],["normal","normal_game",false,{action:"delete"}],["normal","normal_web_app",false,{action:"delete"}],["normal","normal_reply",false,{action:"delete"}],["normal","normal_edit",false,{action:"delete_notify"}],["normal","normal_mention",false,{action:"delete"}],["normal","normal_bot",false,{action:"delete_ban"}],
  ["links","links_all",false,{action:"delete_notify"}],["links","links_telegram",true,{action:"delete_notify"}],["links","links_external",false,{action:"delete_notify"}],["links","links_invites",false,{action:"delete_notify"}],["links","links_username",false,{action:"delete"}],["links","links_phone",false,{action:"delete_notify"}],["links","links_auto_delete",true,{}],["links","links_notify",false,{}],
  ["advertising","advertising_text",false,{action:"delete_notify"}],["advertising","advertising_links",false,{action:"delete_notify"}],["advertising","advertising_invites",false,{action:"delete_notify"}],["advertising","advertising_phone",false,{action:"delete_notify"}],["advertising","advertising_username",false,{action:"delete_notify"}],
  ["media","media_photo",false,{max_mb:20,max_per_minute:0,action:"delete"}],["media","media_video",false,{max_mb:50,max_per_minute:0,action:"delete"}],["media","media_audio",false,{max_mb:50,max_per_minute:0,action:"delete"}],["media","media_animation",false,{max_mb:50,max_per_minute:0,action:"delete"}],["media","media_sticker",false,{max_mb:5,max_per_minute:0,action:"delete"}],["media","media_voice",false,{max_mb:50,max_per_minute:0,action:"delete"}],["media","media_video_note",false,{max_mb:50,max_per_minute:0,action:"delete"}],
  ["forwarding","forward_all",false,{action:"delete_notify"}],["forwarding","forward_groups",false,{action:"delete_notify"}],["forwarding","forward_channels",false,{action:"delete_notify"}],["forwarding","forward_private",false,{action:"delete_notify"}],["forwarding","forward_auto_delete",true,{}],["forwarding","forward_notify",false,{}],
  ["files","file_documents",false,{max_mb:20,action:"delete",blocked_extensions:[],allowed_extensions:[]}],["files","file_archives",false,{max_mb:20,action:"delete"}],["files","file_executables",true,{max_mb:20,action:"delete_notify"}],["files","file_auto_delete",true,{}],["files","file_max_size",true,{max_mb:50,action:"delete"}],
  ["messages","message_min_length",false,{min_chars:2,action:"delete"}],["messages","message_max_length",false,{max_chars:4000,action:"delete"}],["messages","message_rate_limit",false,{count:10,window_seconds:60,action:"delete"}],
  ["interactions","reply_lock",false,{action:"delete"}],["interactions","edit_lock",false,{action:"delete_notify"}],["interactions","hashtag_limit",false,{max_hashtags:5,action:"delete"}],["interactions","mention_limit",false,{max_mentions:5,action:"delete"}],["interactions","username_lock",false,{action:"delete_notify"}],["interactions","phone_lock",false,{action:"delete_notify"}],["interactions","email_lock",false,{action:"delete_notify"}],["interactions","web_preview_lock",false,{action:"delete"}],["interactions","story_share_lock",false,{action:"delete_notify"}],
  ["advanced","contact_lock",false,{action:"delete_notify"}],["advanced","location_lock",false,{action:"delete_notify"}],["advanced","poll_lock",false,{action:"delete"}],["advanced","dice_lock",false,{action:"delete"}],["advanced","game_lock",false,{action:"delete"}],["advanced","web_app_lock",false,{action:"delete"}],["advanced","bot_join_lock",false,{action:"delete_ban"}],
  ["language","language_persian",false,{action:"delete"}],["language","language_english",false,{action:"delete"}],["language","language_arabic",false,{action:"delete"}],["language","language_russian",false,{action:"delete"}],["language","language_turkish",false,{action:"delete"}],["language","language_chinese",false,{action:"delete"}],["language","language_japanese",false,{action:"delete"}],["language","language_korean",false,{action:"delete"}],
  ["anti_attack","attack_flood",true,{count:8,window_seconds:5,action:"delete"}],["anti_attack","attack_duplicate",true,{count:3,window_seconds:30,action:"delete"}],["anti_attack","attack_caps",false,{percent:90,min_letters:20,action:"delete"}],["anti_attack","attack_link_burst",false,{count:3,window_seconds:15,action:"delete"}],["anti_attack","attack_media_burst",false,{count:5,window_seconds:15,action:"delete"}],["anti_attack","attack_join_flood",false,{count:5,window_seconds:30,action:"delete"}]
] as const;

function json(v:any){return JSON.stringify(v??{});}
function mb(size?:number){return Number.isFinite(size)?Number(size)/1048576:null;}
function ruleMap(rows:any[]):Rule[]{return rows.map(r=>({rule_key:String(r.rule_key),section:String(r.section),enabled:r.enabled===true,config:r.config&&typeof r.config==="object"?r.config:{}}));}

async function seed(pool:Pool,groupId:number){
  await pool.query("INSERT INTO content_lock_settings(group_id) VALUES($1) ON CONFLICT(group_id) DO NOTHING",[groupId]);
  for(const row of defaultRules){
    const section=row[0],key=row[1],enabled=row[2],config=row[3];
    await pool.query(
      "INSERT INTO content_lock_rules(group_id,section,rule_key,title,description,enabled,config) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(group_id,rule_key) DO NOTHING",
      [groupId,section,key,String(key),String(key),enabled,json(config)]
    );
  }
}
async function load(pool:Pool,groupId:number){
  const hit=cache.get(groupId);
  if(hit&&Date.now()-hit.at<5000)return hit;
  await seed(pool,groupId);
  const [s,r,e,d]=await Promise.all([
    pool.query("SELECT enabled,exempt_admins,notify_user FROM content_lock_settings WHERE group_id=$1",[groupId]),
    pool.query("SELECT rule_key,section,enabled,config FROM content_lock_rules WHERE group_id=$1",[groupId]),
    pool.query("SELECT exception_type,target_id,scope,enabled FROM content_lock_exceptions WHERE group_id=$1 AND enabled=TRUE",[groupId]),
    pool.query("SELECT domain,enabled FROM content_lock_domains WHERE group_id=$1 AND enabled=TRUE",[groupId])
  ]);
  const value={
    at:Date.now(),
    settings:s.rows[0]??{enabled:true,exempt_admins:true,notify_user:false},
    rules:ruleMap(r.rows),
    exceptions:e.rows.map(x=>({
      exception_type:String(x.exception_type),
      target_id:String(x.target_id),
      scope:Array.isArray(x.scope)?x.scope:[],
      enabled:x.enabled===true
    })),
    domains:d.rows
  };
  cache.set(groupId,value);return value;
}
function getRule(data:any,key:string){return data.rules.find((r:Rule)=>r.rule_key===key);}
function enabled(data:any,key:string){return !!getRule(data,key)?.enabled;}
function config(data:any,key:string){return getRule(data,key)?.config??{};}
function scopeMatches(scope:string[],section:string,key:string){return scope.includes("all")||scope.includes(section)||scope.includes(key);}
async function effectiveRole(pool:Pool|null,userId:number,userRank:Rank){
  const hit=customRoleCache.get(userId);
  if(hit&&Date.now()-hit.at<30_000)return hit.role;
  if(!pool)return userRank;
  try{
    const r=await pool.query<{role:string}>("SELECT role FROM users WHERE telegram_id=$1 AND is_active=TRUE LIMIT 1",[userId]);
    const role=String(r.rows[0]?.role||userRank);
    customRoleCache.set(userId,{at:Date.now(),role});
    return role;
  }catch{
    customRoleCache.set(userId,{at:Date.now(),role:userRank});
    return userRank;
  }
}
async function exceptionMatches(data:any,input:Input,section:string,key:string,sourceId?:number){
  if(data.settings.exempt_admins&&["owner","sudo","admin"].includes(input.userRank))return true;
  const role=String(await effectiveRole(input.pool,input.userId,input.userRank)).toLowerCase();
  return data.exceptions.some((e:Exception)=>{
    if(!e.enabled||!scopeMatches(e.scope,section,key))return false;
    if(e.exception_type==="user"&&e.target_id===String(input.userId))return true;
    if(e.exception_type==="role"&&e.target_id.toLowerCase()===role)return true;
    return e.exception_type==="forward_source"&&sourceId!=null&&e.target_id===String(sourceId);
  });
}
function urls(text:string,entities:Entity[]=[]){
  const out:string[]=[];
  for(const m of text.matchAll(/(?:https?:\/\/|www\.)[^\s<>()]+|(?:t\.me|telegram\.me)\/[^\s<>()]+/gi))out.push(m[0]);
  for(const e of entities)if(e.type==="text_link"&&e.url)out.push(e.url);
  return [...new Set(out)];
}
function domainOf(url:string){
  try{return new URL(url.includes("://")?url:"https://"+url).hostname.toLowerCase().replace(/^www\./,"");}
  catch{return "";}
}
function mediaType(m:ContentLockMessage):string|null{
  if(m.photo?.length)return"photo";
  if(m.video)return"video";
  if(m.audio)return"audio";
  if(m.animation)return"animation";
  if(m.sticker)return"sticker";
  if(m.voice)return"voice";
  if(m.video_note)return"video_note";
  if(m.document)return"document";
  if(m.contact)return"contact";
  if(m.location||m.venue)return"location";
  if(m.poll)return"poll";
  if(m.dice)return"dice";
  if(m.game)return"game";
  if(m.web_app_data)return"web_app";
  return null;
}
function fileInfo(m:ContentLockMessage){
  const f=m.document,name=String(f?.file_name||"").toLowerCase();
  const ext=name.includes(".")?name.split(".").pop()||"":"";
  return{ext,size:mb(f?.file_size),name,mime:String(f?.mime_type||"").toLowerCase()};
}
function forwarded(m:ContentLockMessage){
  const o=m.forward_origin;if(!o)return null;
  const type=String(o.type||"");
  const raw=Number(o.chat?.id??o.sender_chat?.id??o.sender_user?.id);
  const sourceId=Number.isFinite(raw)?raw:null;
  if(type==="channel")return{kind:"channel",sourceId};
  if(type==="chat")return{kind:"group",sourceId};
  if(type==="user")return{kind:"private",sourceId};
  return{kind:"unknown",sourceId};
}
function track(map:Map<string,number[]>,key:string,windowMs:number){
  const now=Date.now(),a=map.get(key)??[];
  while(a.length&&now-a[0]>windowMs)a.shift();
  a.push(now);map.set(key,a);return a.length;
}
function duplicateTrack(key:string,value:string,windowMs:number){
  const now=Date.now(),a=duplicateWindows.get(key)??[];
  while(a.length&&now-Number(a[0].split("|")[0])>windowMs)a.shift();
  a.push(String(now)+"|"+value);duplicateWindows.set(key,a);
  return a.filter(x=>x.slice(x.indexOf("|")+1)===value).length;
}
async function log(pool:Pool,input:Input,ruleKey:string,contentType:string,action:string,extra:any={}){
  await pool.query(
    "INSERT INTO content_lock_logs(group_id,message_id,user_id,username,first_name,content_type,rule_key,action,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)",
    [input.groupId,input.message.message_id,input.userId,input.username||null,input.firstName||null,contentType,ruleKey,action,json({...extra,edited:input.edited===true})]
  );
}
async function act(input:Input,rule:Rule,contentType:string,reason:string){
  const action=String(rule.config?.action||"delete");
  let applied="delete_failed";
  try{
    const d=await telegramApi("deleteMessage",{chat_id:input.groupId,message_id:input.message.message_id});
    if(!d.ok)throw new Error(d.description||"deleteMessage failed");
    applied=action;
    if(action==="delete_notify"||action==="delete_mute"||action==="delete_ban"){
      const notice=await telegramApi("sendMessage",{chat_id:input.groupId,text:"⚠️ محتوای ارسالی با قوانین قفل محتوا مطابقت نداشت و حذف شد."});
      if(!notice.ok)console.warn("[content-locks] notice failed:",notice.description);
    }
    if(action==="delete_mute"){
      const duration=Math.max(60,Number(rule.config?.duration_minutes||10)*60);
      const r=await telegramApi("restrictChatMember",{
        chat_id:input.groupId,user_id:input.userId,until_date:Math.floor(Date.now()/1000)+duration,
        permissions:{can_send_messages:false,can_send_audios:false,can_send_documents:false,can_send_photos:false,can_send_videos:false,can_send_video_notes:false,can_send_voice_notes:false,can_send_polls:false,can_send_other_messages:false,can_add_web_page_previews:false},
        use_independent_chat_permissions:true
      });
      if(!r.ok)throw new Error(r.description||"restrictChatMember failed");
    }
    if(action==="delete_ban"){
      const duration=Math.max(300,Number(rule.config?.duration_minutes||60)*60);
      const r=await telegramApi("banChatMember",{chat_id:input.groupId,user_id:input.userId,until_date:Math.floor(Date.now()/1000)+duration});
      if(!r.ok)throw new Error(r.description||"banChatMember failed");
    }
  }catch(error){
    applied="delete_failed";
    console.error("[content-locks] enforcement failed:",error);
  }
  await log(input.pool!,input,rule.rule_key,contentType,applied,{reason});
  return applied!=="delete_failed";
}
async function block(input:Input,data:any,key:string,contentType:string,reason:string,sourceId?:number){
  const rule=getRule(data,key);if(!rule?.enabled)return false;
  if(await exceptionMatches(data,input,rule.section,key,sourceId))return false;
  const behavior:any={links:["links_auto_delete","links_notify"],forwarding:["forward_auto_delete","forward_notify"],files:["file_auto_delete",null]}[rule.section];
  if(behavior&&enabled(data,behavior[0])===false){
    if(behavior[1]&&enabled(data,behavior[1])){
      const n=await telegramApi("sendMessage",{chat_id:input.groupId,text:"⚠️ این پیام با سیاست قفل محتوا مغایرت دارد."});
      if(!n.ok)console.warn("[content-locks] notification failed:",n.description);
    }
    await log(input.pool!,input,key,contentType,"detected_no_delete",{reason});
    return false;
  }
  return act(input,rule,contentType,reason);
}

type LockCommandContext={chatId:number;userId:number;userRank:Rank;lang:"fa"|"en";chatTitle:string};
const LOCK_BUNDLE_KEYS=[
  "normal_media","normal_links","normal_ads","normal_files","normal_forward","normal_contact","normal_location","normal_poll","normal_dice","normal_game","normal_web_app","normal_reply","normal_edit","normal_mention","normal_bot"
];
const LOCK_LABELS:Record<string,string>={
  normal_media:"رسانه",normal_links:"لینک",normal_ads:"تبلیغات",normal_files:"فایل",normal_forward:"فوروارد",normal_contact:"تماس",normal_location:"موقعیت",normal_poll:"نظرسنجی",normal_dice:"تاس",normal_game:"بازی",normal_web_app:"وب اپ",normal_reply:"ریپلای",normal_edit:"ویرایش",normal_mention:"منشن",normal_bot:"ربات",
  media_photo:"عکس",media_video:"ویدیو",media_audio:"موزیک",media_animation:"گیف",media_sticker:"استیکر",media_voice:"ویس",media_video_note:"ویدیو نوت",
  file_documents:"سند",file_archives:"فایل فشرده",file_executables:"فایل اجرایی",file_max_size:"حداکثر حجم فایل",
  links_all:"همه لینک‌ها",links_telegram:"لینک تلگرام",links_external:"لینک خارجی",links_invites:"لینک دعوت",links_username:"یوزرنیم لینک",links_phone:"شماره در لینک",
  advertising_text:"متن تبلیغاتی",advertising_links:"لینک تبلیغاتی",advertising_invites:"دعوت تبلیغاتی",advertising_phone:"شماره تبلیغاتی",advertising_username:"یوزرنیم تبلیغاتی",
  forward_all:"همه فورواردها",forward_groups:"فوروارد گروه",forward_channels:"فوروارد کانال",forward_private:"فوروارد خصوصی",
  reply_lock:"ریپلای",edit_lock:"ویرایش",hashtag_limit:"هشتگ",mention_limit:"منشن",username_lock:"یوزرنیم",phone_lock:"شماره تلفن",email_lock:"ایمیل",web_preview_lock:"پیش‌نمایش لینک",story_share_lock:"اشتراک‌گذاری استوری",
  contact_lock:"Contact",location_lock:"Location",poll_lock:"Poll",dice_lock:"Dice",game_lock:"Game",web_app_lock:"Web App",bot_join_lock:"ورود ربات",
  message_min_length:"حداقل طول پیام",message_max_length:"حداکثر طول پیام",message_rate_limit:"محدودیت پیام",
  attack_flood:"ضد فلود",attack_duplicate:"ضد پیام تکراری",attack_caps:"کنترل CAPS",attack_link_burst:"ضد حمله لینک",attack_media_burst:"ضد حمله رسانه",attack_join_flood:"ضد هجوم عضو",
  language_persian:"زبان فارسی",language_english:"زبان انگلیسی",language_arabic:"زبان عربی",language_russian:"زبان روسی",language_turkish:"زبان ترکی",language_chinese:"زبان چینی",language_japanese:"زبان ژاپنی",language_korean:"زبان کره‌ای"
};
const LOCK_ALIASES:Record<string,string>={
  "رسانه":"normal_media","رسانه‌ای":"normal_media","media":"normal_media",
  "لینک":"normal_links","لینک‌ها":"normal_links","links":"normal_links",
  "تبلیغات":"normal_ads","تبلیغ":"normal_ads","advertising":"normal_ads","ads":"normal_ads",
  "فایل":"normal_files","فایل‌ها":"normal_files","files":"normal_files",
  "فوروارد":"normal_forward","اشتراک‌گذاری":"normal_forward","forward":"normal_forward",
  "تماس":"normal_contact","contact":"normal_contact",
  "موقعیت":"normal_location","location":"normal_location",
  "نظرسنجی":"normal_poll","poll":"normal_poll",
  "تاس":"normal_dice","dice":"normal_dice",
  "بازی":"normal_game","game":"normal_game",
  "وب اپ":"normal_web_app","webapp":"normal_web_app",
  "ریپلای":"normal_reply","reply":"normal_reply",
  "ویرایش":"normal_edit","edit":"normal_edit",
  "منشن":"normal_mention","mention":"normal_mention",
  "ربات":"normal_bot","bot":"normal_bot",
  "عکس":"media_photo","photo":"media_photo","ویدیو":"media_video","video":"media_video","موزیک":"media_audio","آهنگ":"media_audio","audio":"media_audio","گیف":"media_animation","gif":"media_animation","انیمیشن":"media_animation","استیکر":"media_sticker","sticker":"media_sticker","ویس":"media_voice","voice":"media_voice","ویدیو نوت":"media_video_note","video note":"media_video_note",
  "سند":"file_documents","document":"file_documents","فایل فشرده":"file_archives","archive":"file_archives","فایل اجرایی":"file_executables","executable":"file_executables","حجم فایل":"file_max_size",
  "همه لینک‌ها":"links_all","all links":"links_all","لینک تلگرام":"links_telegram","telegram":"links_telegram","لینک خارجی":"links_external","external":"links_external","لینک دعوت":"links_invites","invite":"links_invites","یوزرنیم لینک":"links_username","شماره لینک":"links_phone",
  "متن تبلیغاتی":"advertising_text","لینک تبلیغاتی":"advertising_links","دعوت تبلیغاتی":"advertising_invites","شماره تبلیغاتی":"advertising_phone","یوزرنیم تبلیغاتی":"advertising_username",
  "همه فورواردها":"forward_all","فوروارد گروه":"forward_groups","فوروارد کانال":"forward_channels","فوروارد خصوصی":"forward_private",
  "هشتگ":"hashtag_limit","hashtag":"hashtag_limit","یوزرنیم":"username_lock","username":"username_lock","شماره تلفن":"phone_lock","phone":"phone_lock","ایمیل":"email_lock","email":"email_lock","پیش‌نمایش":"web_preview_lock","preview":"web_preview_lock","استوری":"story_share_lock","story":"story_share_lock",
  "ضد فلود":"attack_flood","flood":"attack_flood","ضد پیام تکراری":"attack_duplicate","duplicate":"attack_duplicate","caps":"attack_caps","کنترل caps":"attack_caps","ضد حمله لینک":"attack_link_burst","link burst":"attack_link_burst","ضد حمله رسانه":"attack_media_burst","media burst":"attack_media_burst","ضد هجوم عضو":"attack_join_flood","join flood":"attack_join_flood","ورود ربات":"bot_join_lock",
  "فارسی":"language_persian","زبان فارسی":"language_persian","persian":"language_persian","english":"language_english","انگلیسی":"language_english","زبان انگلیسی":"language_english","arabic":"language_arabic","عربی":"language_arabic","زبان عربی":"language_arabic","russian":"language_russian","روسی":"language_russian","زبان روسی":"language_russian","turkish":"language_turkish","ترکی":"language_turkish","زبان ترکی":"language_turkish","chinese":"language_chinese","چینی":"language_chinese","زبان چینی":"language_chinese","japanese":"language_japanese","ژاپنی":"language_japanese","زبان ژاپنی":"language_japanese","korean":"language_korean","کره‌ای":"language_korean","کره ای":"language_korean","زبان کره‌ای":"language_korean"
};
function lockNorm(v:unknown){return String(v??"").trim().toLowerCase().replace(/[يى]/g,"ی").replace(/ك/g,"ک").replace(/[‌]/g,"").replace(/\s+/g," ").trim();}
function lockKey(args:string[]){const joined=lockNorm(args.join(" "));if(!joined)return null;return LOCK_ALIASES[joined]??LOCK_ALIASES[lockNorm(joined.replace(/ـ/g,""))]??null;}
function lockFmt(v:number){return String(v).replace(/\d/g,d=>"۰۱۲۳۴۵۶۷۸۹"[Number(d)]);}
async function lockRows(pool:Pool,groupId:number){await seed(pool,groupId);return (await pool.query("SELECT rule_key,section,enabled,config FROM content_lock_rules WHERE group_id=$1 ORDER BY id",[groupId])).rows;}
function lockStateLine(enabledValue:boolean){return enabledValue?"● فعال":"○ خاموش";}
export async function ensureContentLocks(pool:Pool,groupId:number){await seed(pool,groupId);}
export function contentLockCenterKeyboard(){return glassKeyboard([
  [["قفل‌های حالت عادی","cl:normal"],["رسانه","cl:media"]],
  [["لینک‌ها","cl:links"],["تبلیغات","cl:advertising"]],
  [["فوروارد و اشتراک‌گذاری","cl:forwarding"],["فایل و سند","cl:files"]],
  [["پیام و نرخ ارسال","cl:messages"],["تعامل و هویت","cl:interactions"]],
  [["محتوای پیشرفته","cl:advanced"],["امنیت و ضد اتک","cl:anti_attack"]],
  [["استثناها و دامنه مجاز","cl:exceptions"]],
  [["قفل زبان","cl:language"]],
  [["‹ بازگشت","c:home"]]
]);}

function richEscape(value:unknown){
  return String(value??"")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}

function lockSectionRichHtml(rows:any[]){
  const names:any={normal:"قفل‌های حالت عادی",media:"رسانه",links:"لینک‌ها",advertising:"تبلیغات",forwarding:"فوروارد و اشتراک‌گذاری",files:"فایل و سند",messages:"پیام و نرخ ارسال",interactions:"تعامل و هویت",advanced:"محتوای پیشرفته",anti_attack:"امنیت و ضد اتک",language:"قفل زبان"};
  const keys=["normal","media","links","advertising","forwarding","files","messages","interactions","advanced","anti_attack","language"];
  const callbacks:any={normal:"cl:normal",media:"cl:media",links:"cl:links",advertising:"cl:advertising",forwarding:"cl:forwarding",files:"cl:files",messages:"cl:messages",interactions:"cl:interactions",advanced:"cl:advanced",anti_attack:"cl:anti_attack",language:"cl:language"};
  const total=rows.length;
  const active=rows.filter((x:any)=>x.enabled).length;
  const tableRows=keys.map(key=>{
    const section=rows.filter((x:any)=>x.section===key);
    const on=section.filter((x:any)=>x.enabled).length;
    return "<tr><td><b>"+richEscape(names[key])+"</b></td><td align=\"center\">"+lockFmt(on)+" / "+lockFmt(section.length)+"</td></tr>";
  }).join("");
  const buttonRows:string[]=[];
  for(let i=0;i<keys.length;i+=2){
    const a=keys[i],b=keys[i+1];
    let html="<tg-button-row align=\"right\"><tg-button type=\"callback_data\" style=\"primary\" data=\""+callbacks[a]+"\">› "+richEscape(names[a])+"</tg-button>";
    if(b) html+="<tg-button type=\"callback_data\" style=\"primary\" data=\""+callbacks[b]+"\">› "+richEscape(names[b])+"</tg-button>";
    html+="</tg-button-row>";
    buttonRows.push(html);
  }
  return "<h2>◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Lᴏᴄᴋ Cᴇɴᴛᴇʀ</h2>"+
    "<p><b>● سیستم قفل:</b> فعال<br><b>⛂ قوانین فعال:</b> "+lockFmt(active)+" از "+lockFmt(total)+"</p>"+
    "<hr/>"+
    "<table bordered striped compact><tr><th>بخش</th><th>فعال</th></tr>"+tableRows+"</table>"+
    "<details><summary>راهنمای کنترل</summary><p>هر بخش، فهرست قفل‌های همان حوزه را باز می‌کند. وضعیت هر قانون مستقیماً از همین مرکز قابل تغییر است.</p></details>"+
    buttonRows.join("")+
    "<tg-button-row align=\"right\"><tg-button type=\"callback_data\" data=\"c:home\">‹ بازگشت</tg-button></tg-button-row>";
}

async function richLockCenter(pool:Pool){
  const rows=await lockRows(pool,arguments.length>1?Number(arguments[1]):0);
  return lockSectionRichHtml(rows);
}

async function sendRichLockCenter(pool:Pool,chatId:number){
  const rows=await lockRows(pool,chatId);
  const rich_message={html:lockSectionRichHtml(rows),is_rtl:true};
  const rich=await telegramApi("sendRichMessage",{chat_id:chatId,rich_message});
  if(rich.ok)return rich;
  console.warn("[content-locks] sendRichMessage failed; falling back to standard keyboard:",rich.description);
  return telegramApi("sendMessage",{chat_id:chatId,text:await lockCenterText(pool,chatId),reply_markup:contentLockCenterKeyboard()});
}

export async function editRichLockCenter(pool:Pool,chatId:number,messageId:number){
  const rows=await lockRows(pool,chatId);
  const rich_message={html:lockSectionRichHtml(rows),is_rtl:true};
  const markup=contentLockCenterKeyboard();
  const rich=await telegramApi("editMessageText",{chat_id:chatId,message_id:messageId,rich_message,reply_markup:markup});
  if(rich.ok)return rich;
  console.warn("[content-locks] edit RichMessage failed; falling back to standard text:",rich.description);
  return telegramApi("editMessageText",{chat_id:chatId,message_id:messageId,text:await lockCenterText(pool,chatId),reply_markup:markup});
}

export async function sendContentLockCenter(pool:Pool,chatId:number){
  return sendRichLockCenter(pool,chatId);
}
async function lockSectionText(pool:Pool,groupId:number,section:string,title:string,limit=100){
  const rows=(await lockRows(pool,groupId)).filter((x:any)=>x.section===section);
  const active=rows.filter((x:any)=>x.enabled).length;
  const body=[
    "━━━━━━━━━━━━━━━━━━━━━━━━","◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ - "+title,"━━━━━━━━━━━━━━━━━━━━━━━━","",
    "⛂ - وضعیت بخش : "+(active?"● فعال":"○ خاموش")+"","⛂ - قوانین : "+lockFmt(rows.length),"⛂ - فعال : "+lockFmt(active),"⛂ - خاموش : "+lockFmt(Math.max(0,rows.length-active)),"",
    "─────━━───── ◈ ─────━━─────"
  ];
  for(const row of rows.slice(0,limit)) body.push("⛂ - "+(LOCK_LABELS[row.rule_key]||row.rule_key)+" : "+lockStateLine(!!row.enabled));
  return body.join("\n");
}
async function lockCenterText(pool:Pool,groupId:number){
  const rows=await lockRows(pool,groupId);
  const sections=["normal","media","links","advertising","forwarding","files","messages","interactions","advanced","anti_attack","language"];
  const names:any={normal:"قفل‌های حالت عادی",media:"رسانه",links:"لینک‌ها",advertising:"تبلیغات",forwarding:"فوروارد و اشتراک‌گذاری",files:"فایل و سند",messages:"پیام و نرخ ارسال",interactions:"تعامل و هویت",advanced:"محتوای پیشرفته",anti_attack:"امنیت و ضد اتک",language:"قفل زبان"};
  const body=["━━━━━━━━━━━━━━━━━━━━━━━━","◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ - Lᴏᴄᴋ Cᴇɴᴛᴇʀ","━━━━━━━━━━━━━━━━━━━━━━━━","",
    "⛂ - سیستم قفل : ● فعال","⛂ - مجموع قوانین : "+lockFmt(rows.length),"⛂ - قوانین فعال : "+lockFmt(rows.filter((r:any)=>r.enabled).length),"","","─────━━───── ◈ ─────━━─────"];
  for(const sec of sections){const rs=rows.filter((r:any)=>r.section===sec);body.push("⛂ - "+names[sec]+" : "+lockFmt(rs.filter((r:any)=>r.enabled).length)+" / "+lockFmt(rs.length));}
  body.push("","برای کنترل یک مورد، بنویسید: «قفل + نوع» یا «بازکردن + نوع».","مثال: قفل رسانه · قفل عکس · قفل تبلیغات");
  return body.join("\n");
}
export async function runContentLockCommand(pool:Pool,ctx:LockCommandContext,commandId:string,args:string[]):Promise<string>{
  const normalizedArgs=lockNorm(args.join(" "));
  if(commandId==="lockall"||((commandId==="lock")&&normalizedArgs==="همه")){await pool.query("UPDATE content_lock_rules SET enabled=TRUE,updated_at=NOW() WHERE group_id=$1",[ctx.chatId]);cache.delete(ctx.chatId);return "━━━━━━━━━━━━━━━━━━━━━━━━\n◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ - Lᴏᴄᴋ Aʟʟ\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n✓ همه قفل‌های سیستم فعال شدند.\n⛂ - قوانین فعال : "+lockFmt((await lockRows(pool,ctx.chatId)).length); }
  if(commandId==="unlockall"||((commandId==="unlock")&&normalizedArgs==="همه")){await pool.query("UPDATE content_lock_rules SET enabled=FALSE,updated_at=NOW() WHERE group_id=$1",[ctx.chatId]);cache.delete(ctx.chatId);return "━━━━━━━━━━━━━━━━━━━━━━━━\n◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ - Uɴʟᴏᴄᴋ Aʟʟ\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n✓ همه قفل‌های سیستم خاموش شدند."; }
  if(commandId==="lock"&&(!normalizedArgs||normalizedArgs==="وضعیت"||normalizedArgs==="status"||normalizedArgs==="ها"||normalizedArgs==="همه قفل‌ها"||normalizedArgs==="قفل‌ها"))return lockCenterText(pool,ctx.chatId);
  if(commandId==="lock"&&(normalizedArgs==="حالت عادی"||normalizedArgs==="قفل‌های حالت عادی"||normalizedArgs==="normal"||normalizedArgs==="normal locks"))return lockSectionText(pool,ctx.chatId,"normal","Nᴏʀᴍᴀʟ Lᴏᴄᴋs");
  if(commandId==="lock"&&(normalizedArgs==="زبان"||normalizedArgs==="قفل زبان"||normalizedArgs==="language"||normalizedArgs==="language locks"))return lockSectionText(pool,ctx.chatId,"language","Lᴀɴɢᴜᴀɢᴇ Lᴏᴄᴋs");
  if(commandId==="lock"&&normalizedArgs){
    const key=lockKey(args);if(!key)return "✗ نوع قفل شناخته نشد. «قفل» را ارسال کنید تا فهرست دسته‌ها نمایش داده شود.";
    const row=(await pool.query("SELECT rule_key,enabled FROM content_lock_rules WHERE group_id=$1 AND rule_key=$2",[ctx.chatId,key])).rows[0];
    if(!row)return "✗ این قفل در هسته ثبت نشده است.";
    if(row.enabled)return "⛂ - "+(LOCK_LABELS[key]||key)+" : ● قبلاً فعال است.";
    await pool.query("UPDATE content_lock_rules SET enabled=TRUE,updated_at=NOW() WHERE group_id=$1 AND rule_key=$2",[ctx.chatId,key]);cache.delete(ctx.chatId);
    return "✓ قفل «"+(LOCK_LABELS[key]||key)+"» فعال شد.\n⛂ - وضعیت : ● فعال";
  }
  if(commandId==="unlock"){
    if(!normalizedArgs)return lockCenterText(pool,ctx.chatId);
    const key=lockKey(args);if(!key)return "✗ نوع قفل شناخته نشد.";
    const row=(await pool.query("SELECT rule_key,enabled FROM content_lock_rules WHERE group_id=$1 AND rule_key=$2",[ctx.chatId,key])).rows[0];
    if(!row)return "✗ این قفل در هسته ثبت نشده است.";
    if(!row.enabled)return "⛂ - "+(LOCK_LABELS[key]||key)+" : ○ از قبل خاموش است.";
    await pool.query("UPDATE content_lock_rules SET enabled=FALSE,updated_at=NOW() WHERE group_id=$1 AND rule_key=$2",[ctx.chatId,key]);cache.delete(ctx.chatId);
    return "✓ قفل «"+(LOCK_LABELS[key]||key)+"» خاموش شد.\n⛂ - وضعیت : ○ خاموش";
  }
  return lockCenterText(pool,ctx.chatId);
}


const enforcementQueues = new Map<number, Promise<void>>();

export async function enforceContentLocks(input:Input):Promise<boolean>{
  const groupId=input.groupId;
  const previous=enforcementQueues.get(groupId)??Promise.resolve();
  const current=previous.then(()=>enforceContentLocksNow(input));
  const tail=current.then(()=>undefined,()=>undefined);
  enforcementQueues.set(groupId,tail);
  try{
    return await current;
  }finally{
    if(enforcementQueues.get(groupId)===tail) enforcementQueues.delete(groupId);
  }
}

async function enforceContentLocksNow(input:Input):Promise<boolean>{
  if(!input.pool||input.message.chat.type==="private")return false;
  const data=await load(input.pool,input.groupId);
  if(data.settings.enabled!==true)return false;
  const text=input.text||"";
  const entities=[...(input.message.entities??[]),...(input.message.caption_entities??[])];

  if(input.edited&&enabled(data,"normal_edit")&&await block(input,data,"normal_edit","edited_message","قفل ویرایش حالت عادی"))return true;
  if(input.edited&&enabled(data,"edit_lock")&&await block(input,data,"edit_lock","edited_message","پیام ویرایش‌شده"))return true;
  if(input.message.reply_to_message&&enabled(data,"normal_reply")&&await block(input,data,"normal_reply","reply","قفل ریپلای حالت عادی"))return true;
  if(input.message.reply_to_message&&await block(input,data,"reply_lock","reply","پیام ریپلای‌شده"))return true;

  const fwd=forwarded(input.message);
  if(input.message.new_chat_members?.length){
    const bots=input.message.new_chat_members.filter((u)=>u.is_bot===true);
    if(bots.length&&enabled(data,"normal_bot")&&!(await exceptionMatches(data,input,"normal","normal_bot"))){
      try{await telegramApi("deleteMessage",{chat_id:input.groupId,message_id:input.message.message_id});}catch{}
      for(const bot of bots){try{await telegramApi("banChatMember",{chat_id:input.groupId,user_id:bot.id});}catch{}}
      await log(input.pool!,input,"normal_bot","bot_join","delete_ban",{bots:bots.map((b)=>b.id)});
      return true;
    }
    if(bots.length&&enabled(data,"bot_join_lock")&&!(await exceptionMatches(data,input,"advanced","bot_join_lock"))){
      try{await telegramApi("deleteMessage",{chat_id:input.groupId,message_id:input.message.message_id});}catch{}
      for(const bot of bots){try{await telegramApi("banChatMember",{chat_id:input.groupId,user_id:bot.id});}catch{}}
      await log(input.pool!,input,"bot_join_lock","bot_join","delete_ban",{bots:bots.map((b)=>b.id)});
      return true;
    }
    if(enabled(data,"attack_join_flood")){
      const r=config(data,"attack_join_flood"),count=Number(r.count||5),win=Number(r.window_seconds||30)*1000,a=joinWindows.get(input.groupId)??[],now=Date.now();
      while(a.length&&now-a[0]>win)a.shift();
      for(const _bot of input.message.new_chat_members){a.push(now);}
      joinWindows.set(input.groupId,a);
      if(a.length>count&&await block(input,data,"attack_join_flood","attack","Join flood"))return true;
    }
  }
  if(fwd){
    const specific=fwd.kind==="channel"?"forward_channels":fwd.kind==="group"?"forward_groups":fwd.kind==="private"?"forward_private":"forward_all";
    if(enabled(data,"normal_forward")&&await block(input,data,"normal_forward","forward","قفل فوروارد حالت عادی",fwd.sourceId))return true;
    const key=enabled(data,"forward_all")?"forward_all":specific;
    if(enabled(data,key)&&await block(input,data,key,"forward","فوروارد از "+fwd.kind,fwd.sourceId))return true;
  }

  const linkList=urls(text,entities);
  if(linkList.length){
    const allowedDomains=new Set(data.domains.filter((d:Domain)=>d.enabled).map((d:Domain)=>d.domain));
    const allowed=linkList.some((u:string)=>allowedDomains.has(domainOf(u)));
    if(enabled(data,"normal_links")&&!allowed&&await block(input,data,"normal_links","link","قفل لینک حالت عادی"))return true;
    const hasTelegram=linkList.some((u:string)=>/(^|\/)(t\.me|telegram\.me)\//i.test(u));
    const invite=linkList.some((u:string)=>/(t\.me|telegram\.me)\/(\+|joinchat\/)/i.test(u));
    const key=invite&&enabled(data,"links_invites")?"links_invites":hasTelegram&&enabled(data,"links_telegram")?"links_telegram":enabled(data,"links_external")&&!hasTelegram?"links_external":enabled(data,"links_all")?"links_all":null;
    if(key&&!allowed&&await block(input,data,key,"link","لینک غیرمجاز"))return true;
  }

  const type=mediaType(input.message);
  const normalMediaTypes=new Set(["photo","video","audio","animation","sticker","voice","video_note"]);
  if(type){
    if(normalMediaTypes.has(type)&&enabled(data,"normal_media")&&await block(input,data,"normal_media",type,"قفل رسانه حالت عادی"))return true;
    if(type==="document"&&enabled(data,"normal_files")&&await block(input,data,"normal_files","file","قفل فایل حالت عادی"))return true;
    if(type==="contact"&&enabled(data,"normal_contact")&&await block(input,data,"normal_contact","contact","قفل تماس حالت عادی"))return true;
    if(type==="location"&&enabled(data,"normal_location")&&await block(input,data,"normal_location","location","قفل موقعیت حالت عادی"))return true;
    if(type==="poll"&&enabled(data,"normal_poll")&&await block(input,data,"normal_poll","poll","قفل نظرسنجی حالت عادی"))return true;
    if(type==="dice"&&enabled(data,"normal_dice")&&await block(input,data,"normal_dice","dice","قفل تاس حالت عادی"))return true;
    if(type==="game"&&enabled(data,"normal_game")&&await block(input,data,"normal_game","game","قفل بازی حالت عادی"))return true;
    if(type==="web_app"&&enabled(data,"normal_web_app")&&await block(input,data,"normal_web_app","web_app","قفل وب‌اپ حالت عادی"))return true;
    const key=type==="video_note"?"media_video_note":"media_"+type;
    const r=getRule(data,key);
    if(r?.enabled){
      const item=(input.message as any)[type] as FileLike[]|FileLike|undefined;
      const file=Array.isArray(item)?item[item.length-1]:item;
      const size=type==="photo"&&Array.isArray(item)?mb(item[item.length-1]?.file_size):mb((file as FileLike|undefined)?.file_size);
      if(r.config?.max_mb&&size!=null&&size>Number(r.config.max_mb)&&await block(input,data,key,type,"حجم "+size.toFixed(1)+"MB"))return true;
      if(Number(r.config?.max_per_minute||0)>0&&track(windows,input.groupId+":"+input.userId+":"+key,60000)>Number(r.config.max_per_minute)&&await block(input,data,key,type,"تعداد بیش از حد در دقیقه"))return true;
      if(await block(input,data,key,type,"نوع رسانه: "+type))return true;
    }
  }

  if(input.message.document){
    const f=fileInfo(input.message),docConfig=config(data,"file_documents");
    const blocked=Array.isArray(docConfig.blocked_extensions)&&docConfig.blocked_extensions.map((x:string)=>x.toLowerCase().replace(/^\./,"")).includes(f.ext);
    const allowedExt=Array.isArray(docConfig.allowed_extensions)&&docConfig.allowed_extensions.length?docConfig.allowed_extensions.map((x:string)=>x.toLowerCase().replace(/^\./,"")):null;
    const archive=["zip","rar","7z","tar","gz","bz2","xz"].includes(f.ext);
    const executable=["exe","apk","bat","cmd","com","msi","scr","ps1","sh","js","jar"].includes(f.ext);
    let key=archive?"file_archives":executable?"file_executables":"file_documents";
    if(blocked||allowedExt&&!allowedExt.includes(f.ext))key="file_documents";
    const r=getRule(data,key);
    if(r?.enabled){
      const max=Number(r.config?.max_mb||config(data,"file_max_size").max_mb||0);
      if(max&&f.size!=null&&f.size>max&&await block(input,data,key,"file","حجم "+f.size.toFixed(1)+"MB"))return true;
      if(await block(input,data,key,"file","پسوند ."+(f.ext||"unknown")))return true;
    }else if(enabled(data,"file_max_size")){
      const max=Number(config(data,"file_max_size").max_mb||0);
      if(max&&f.size!=null&&f.size>max&&await block(input,data,"file_max_size","file","حجم "+f.size.toFixed(1)+"MB"))return true;
    }
  }

  if(text){
    const detected=new Set<string>();
    const persianSpecific=(text.match(/[پچژگک]/g)||[]).length;
    const arabicChars=(text.match(/[\u0600-\u06ff]/g)||[]).length;
    if(persianSpecific>0)detected.add("language_persian");
    else if(arabicChars>=2)detected.add("language_arabic");
    if((text.match(/[\u0400-\u04ff]/g)||[]).length>=2)detected.add("language_russian");
    if((text.match(/[\u4e00-\u9fff]/g)||[]).length>=2)detected.add("language_chinese");
    if((text.match(/[\u3040-\u30ff]/g)||[]).length>=2)detected.add("language_japanese");
    if((text.match(/[\uac00-\ud7af]/g)||[]).length>=2)detected.add("language_korean");
    const lower=text.toLowerCase();
    const latin=(text.match(/[a-zA-Z]/g)||[]).length;
    if(latin>=3){
      const turkishHint=/[çğıöşüİı]/.test(text)||/\b(merhaba|nasılsın|için|değil|olan|olarak|daha|çok|gibi|ben|sen|siz|ve|bir)\b/i.test(lower);
      if(turkishHint)detected.add("language_turkish");
      if(/\b(the|and|you|your|is|are|this|that|with|from|for|to|of|in|on|hello|thanks|please|yes|no|what|how|can|will|have|has|not)\b/i.test(lower))detected.add("language_english");
    }
    for(const key of detected){
      if(enabled(data,key)&&await block(input,data,key,"language",LOCK_LABELS[key]||key))return true;
    }
  }
  const hasText=Boolean(text);
  if(hasText&&enabled(data,"message_min_length")&&text.length<Number(config(data,"message_min_length").min_chars||2)&&await block(input,data,"message_min_length","text","طول کمتر از حداقل"))return true;
  if(hasText&&enabled(data,"message_max_length")&&text.length>Number(config(data,"message_max_length").max_chars||4000)&&await block(input,data,"message_max_length","text","طول بیشتر از حداکثر"))return true;
  const rateRule=getRule(data,"message_rate_limit");
  if(rateRule?.enabled&&track(windows,input.groupId+":"+input.userId+":messages",Number(rateRule.config?.window_seconds||60)*1000)>Number(rateRule.config?.count||10)&&await block(input,data,"message_rate_limit","text","نرخ پیام"))return true;

  const hashtags=(text.match(/#[\p{L}\p{N}_-]+/gu)||[]).length;
  if(enabled(data,"normal_mention")&&/@[A-Za-z0-9_]{3,64}/.test(text)&&await block(input,data,"normal_mention","mention","قفل منشن حالت عادی"))return true;
  if(enabled(data,"hashtag_limit")&&hashtags>Number(config(data,"hashtag_limit").max_hashtags||5)&&await block(input,data,"hashtag_limit","text","تعداد هشتگ"))return true;
  const mentions=(text.match(/@[A-Za-z0-9_]{3,64}/g)||[]).length;
  if(enabled(data,"mention_limit")&&mentions>Number(config(data,"mention_limit").max_mentions||5)&&await block(input,data,"mention_limit","text","تعداد منشن"))return true;
  if(input.message.story&&await block(input,data,"story_share_lock","story","اشتراک‌گذاری Story"))return true;
  if(enabled(data,"web_preview_lock")&&input.message.link_preview_options&&await block(input,data,"web_preview_lock","web_preview","پیش‌نمایش لینک"))return true;

  if(input.message.contact&&await block(input,data,"contact_lock","contact","Contact"))return true;
  if((input.message.location||input.message.venue)&&await block(input,data,"location_lock","location","Location"))return true;
  if(input.message.poll&&await block(input,data,"poll_lock","poll","Poll"))return true;
  if(input.message.dice&&await block(input,data,"dice_lock","dice","Dice"))return true;
  if(input.message.game&&await block(input,data,"game_lock","game","Game"))return true;
  if(input.message.web_app_data&&await block(input,data,"web_app_lock","web_app","Web App"))return true;

  const phoneFound=/(?:\+?\d{1,3}[\s-]?)?(?:0?\d{8,12})/.test(text);
  const emailFound=/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text);
  const usernameFound=/(^|\s)@[A-Za-z0-9_]{3,64}\b/.test(text);
  const adHint=/(تبلیغ|تبلیغات|فروش|خرید|تخفیف|فالو|عضو(?:گیری|شو)|کسب درآمد|درآمد|promo|advertis|discount|sale|buy|join now)/i.test(text);
  if(enabled(data,"normal_ads")&&(adHint||linkList.length>0||phoneFound)&&await block(input,data,"normal_ads","advertising","قفل تبلیغات حالت عادی"))return true;
  if(enabled(data,"advertising_text")&&adHint&&await block(input,data,"advertising_text","advertising","متن تبلیغاتی"))return true;
  if(enabled(data,"advertising_links")&&linkList.length&&await block(input,data,"advertising_links","advertising","لینک تبلیغاتی"))return true;
  const inviteDetected=linkList.some((u:string)=>/(t\.me|telegram\.me)\/(\+|joinchat\/)/i.test(u));
  if(enabled(data,"advertising_invites")&&inviteDetected&&await block(input,data,"advertising_invites","advertising","دعوت تبلیغاتی"))return true;
  if(enabled(data,"advertising_phone")&&phoneFound&&await block(input,data,"advertising_phone","advertising","شماره تبلیغاتی"))return true;
  if(enabled(data,"advertising_username")&&usernameFound&&await block(input,data,"advertising_username","advertising","یوزرنیم تبلیغاتی"))return true;
  if(enabled(data,"phone_lock")&&phoneFound&&await block(input,data,"phone_lock","text","شماره تلفن"))return true;
  if(enabled(data,"email_lock")&&emailFound&&await block(input,data,"email_lock","text","ایمیل"))return true;
  if(enabled(data,"username_lock")&&usernameFound&&await block(input,data,"username_lock","text","یوزرنیم"))return true;

  const raw=text;
  const base=input.groupId+":"+input.userId;
  if(enabled(data,"attack_flood")){
    const r=config(data,"attack_flood");
    if(track(windows,base+":flood",Number(r.window_seconds||5)*1000)>Number(r.count||8)&&await block(input,data,"attack_flood","attack","Flood"))return true;
  }
  if(enabled(data,"attack_duplicate")&&hasText){
    const r=config(data,"attack_duplicate"),v=text.replace(/\s+/g," ").trim().slice(0,500);
    if(duplicateTrack(base,v,Number(r.window_seconds||30)*1000)>Number(r.count||3)&&await block(input,data,"attack_duplicate","attack","Duplicate"))return true;
  }
  if(enabled(data,"attack_caps")&&hasText){
    const r=config(data,"attack_caps"),letters=raw.match(/[a-z]/gi)||[],caps=(raw.match(/[A-Z]/g)||[]).length,pct=letters.length?caps/letters.length*100:0;
    if(letters.length>=Number(r.min_letters||20)&&pct>=Number(r.percent||90)&&await block(input,data,"attack_caps","attack","CAPS"))return true;
  }
  if(linkList.length&&enabled(data,"attack_link_burst")){
    const r=config(data,"attack_link_burst");
    if(track(windows,base+":links",Number(r.window_seconds||15)*1000)>Number(r.count||3)&&await block(input,data,"attack_link_burst","attack","Link burst"))return true;
  }
  if(type&&enabled(data,"attack_media_burst")){
    const r=config(data,"attack_media_burst");
    if(track(windows,base+":media",Number(r.window_seconds||15)*1000)>Number(r.count||5)&&await block(input,data,"attack_media_burst","attack","Media burst: "+type))return true;
  }
  return false;
}
