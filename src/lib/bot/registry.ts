export type Rank = "owner" | "sudo" | "admin" | "member";
export type Lang = "fa" | "en";
export type Phase = 1 | 2;

export type CommandDef = {
  id: string;
  phase: Phase;
  minRank: Rank;
  aliasesEn: string[];
  aliasesFa: string[];
  usageEn: string;
  usageFa: string;
  descEn: string;
  descFa: string;
};

const defs: Array<[string, Phase, Rank, string, string, string, string]> = [
  ["start",1,"member","start","استارت","Start bot in group","شروع ربات در گروه"],
  ["help",1,"member","help","راهنما","Show command help","نمایش راهنمای دستورات"],
  ["ping",1,"member","ping","پینگ","Live system status","وضعیت زنده سیستم"],
  ["id",1,"member","id","آیدی","User identity","اطلاعات هویتی کاربر"],
  ["info",1,"member","info","اطلاعات","Group information","اطلاعات گروه"],
  ["lang",1,"member","lang","زبان","Change group language","تغییر زبان گروه"],
  ["managers",1,"member","managers","مدیران","List group managers","فهرست مدیران گروه"],
  ["settings",1,"admin","settings","تنظیمات","Group settings","تنظیمات گروه"],
  ["ban",1,"admin","ban","بن","Ban a member","بن عضو"],
  ["unban",1,"admin","unban","آنبن","Unban a member","رفع بن عضو"],
  ["mute",1,"admin","mute","میوت","Mute a member","سکوت عضو"],
  ["unmute",1,"admin","unmute","آنمیوت","Unmute a member","رفع سکوت عضو"],
  ["kick",1,"admin","kick","کیک","Kick a member","اخراج عضو"],
  ["warn",1,"admin","warn","اخطار","Add a warning","ثبت اخطار"],
  ["unwarn",1,"admin","unwarn","حذفاخطار","Remove a warning","حذف اخطار"],
  ["warns",1,"member","warns","اخطارها","Warning history","سوابق اخطار"],
  ["tmute",1,"admin","tmute","تی‌میوت","Temporary mute","میوت موقت"],
  ["tban",1,"admin","tban","تی‌بن","Temporary ban","بن موقت"],
  ["lock",2,"admin","lock","قفل","Enable a content lock","فعال‌سازی قفل"],
  ["unlock",2,"admin","unlock","آنلاک","Disable a content lock","غیرفعال‌سازی قفل"],
  ["locks",2,"member","locks","قفلها","Show locks","نمایش قفل‌ها"],
  ["anti-flood",2,"admin","anti-flood","ضدفلود","Anti-flood settings","تنظیم ضد فلود"],
  ["anti-spam",2,"admin","anti-spam","ضداسپم","Anti-spam settings","تنظیم ضد اسپم"],
  ["night",2,"admin","night","نایت","Night mode","حالت شب"],
  ["welcome",2,"admin","welcome","خوشامد","Welcome settings","تنظیم خوشامد"],
  ["goodbye",2,"admin","goodbye","خدافظی","Goodbye settings","تنظیم خداحافظی"],
  ["rules",2,"member","rules","قوانین","Show group rules","نمایش قوانین"],
  ["set-rules",2,"admin","set-rules","تنظیم‌قوانین","Set group rules","تنظیم قوانین"],
  ["filter",2,"admin","filter","فیلتر","Manage word filters","مدیریت فیلتر کلمات"],
  ["note",2,"admin","note","نوت","Manage notes","مدیریت یادداشت‌ها"],
  ["pin",2,"admin","pin","پین","Pin replied message","پین پیام"],
  ["unpin",2,"admin","unpin","آنپین","Unpin message","برداشتن پین"],
  ["cleanup",2,"admin","cleanup","پاکسازی","Clean recent messages","پاکسازی پیام‌ها"],
  ["promote",2,"owner","promote","ارتقا","Promote a member","ارتقای عضو"],
  ["demote",2,"owner","demote","عزل","Demote a manager","عزل مدیر"],
  ["reports",2,"admin","reports","گزارش","Management reports","گزارش‌های مدیریتی"],
];

export const COMMANDS: CommandDef[] = defs.map(([id,phase,minRank,en,fa,descEn,descFa]) => ({
  id, phase, minRank, aliasesEn:[en], aliasesFa:[fa], usageEn:en, usageFa:fa, descEn, descFa
}));

export const PHASES = [
  { id:1 as Phase, fa:"هسته و مدیریت", en:"Core & management", blurbFa:"اطلاعات، مدیران و عملیات اصلی مدیریت گروه", blurbEn:"Information, managers and core moderation"},
  { id:2 as Phase, fa:"امنیت و تنظیمات", en:"Security & settings", blurbFa:"قفل‌ها، ضداسپم، محتوا، تنظیمات و گزارش‌ها", blurbEn:"Locks, anti-spam, content settings and reports"},
];

export const RANK_ORDER: Rank[] = ["member","admin","sudo","owner"];

export function rankAtLeast(have: Rank, need: Rank): boolean {
  return RANK_ORDER.indexOf(have) >= RANK_ORDER.indexOf(need);
}
export function normalizeToken(value:string){return value.trim().replace(/^[/!.]+/,"").replace(/\s+/g,"").toLowerCase();}
export function parseDuration(value:string):number|null{
  const m=value.trim().toLowerCase().match(/^(\d+)(s|m|h|d)?$/); if(!m)return null;
  const n=Number(m[1]); const unit=m[2]??"s"; const mult=unit==="m"?60:unit==="h"?3600:unit==="d"?86400:1;
  return Number.isFinite(n)&&n>0?n*mult:null;
}
export function resolveCommand(token:string):CommandDef|null{
  const key=normalizeToken(token);
  return COMMANDS.find(c=>[...c.aliasesEn,...c.aliasesFa].some(a=>normalizeToken(a)===key))??null;
}
