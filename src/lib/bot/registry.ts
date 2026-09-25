export type Rank = "owner" | "sudo" | "admin" | "member";
export type Lang = "fa" | "en" | "ar" | "ru" | "tr" | "zh";
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

const defs: CommandDef[] = [
  { id:"robot", phase:1, minRank:"member", aliasesEn:["robot"], aliasesFa:["ربات"], usageEn:"robot", usageFa:"ربات", descEn:"Robot response", descFa:"پاسخ ربات" },
  { id:"id", phase:1, minRank:"member", aliasesEn:["id"], aliasesFa:["آیدی"], usageEn:"id", usageFa:"آیدی", descEn:"User identity", descFa:"اطلاعات هویتی کاربر" },
  { id:"admin", phase:1, minRank:"member", aliasesEn:["admin"], aliasesFa:["ادمین"], usageEn:"admin", usageFa:"ادمین", descEn:"Check admin access", descFa:"بررسی دسترسی ادمین" },
  { id:"info", phase:1, minRank:"member", aliasesEn:["info"], aliasesFa:["اطلاعات"], usageEn:"info", usageFa:"اطلاعات", descEn:"Group information", descFa:"اطلاعات گروه" },
  { id:"rank", phase:1, minRank:"member", aliasesEn:["rank"], aliasesFa:["مقام","اطلاعات مقام"], usageEn:"rank", usageFa:"مقام", descEn:"Show user rank", descFa:"نمایش مقام کاربر" },
  { id:"me", phase:1, minRank:"member", aliasesEn:["me"], aliasesFa:["من"], usageEn:"me", usageFa:"من", descEn:"Show personal profile", descFa:"نمایش پروفایل شخصی" },
  { id:"ping", phase:2, minRank:"member", aliasesEn:["ping"], aliasesFa:["پینگ"], usageEn:"ping", usageFa:"پینگ", descEn:"System status", descFa:"وضعیت سیستم" },
  { id:"bot", phase:2, minRank:"member", aliasesEn:["bot"], aliasesFa:["بات"], usageEn:"bot", usageFa:"بات", descEn:"Technical bot information", descFa:"اطلاعات فنی ربات" },
  { id:"status", phase:2, minRank:"member", aliasesEn:["status"], aliasesFa:["وضعیت"], usageEn:"status", usageFa:"وضعیت", descEn:"Group status", descFa:"وضعیت گروه" },
  { id:"lang", phase:2, minRank:"admin", aliasesEn:["lang","language"], aliasesFa:["زبان","تغییر زبان"], usageEn:"lang [code]", usageFa:"زبان [کد]", descEn:"Change this group language", descFa:"تغییر زبان همین گروه" },
  { id:"warn", phase:2, minRank:"admin", aliasesEn:["warn","warning"], aliasesFa:["اخطار","هشدار"], usageEn:"warn [user] [reason]", usageFa:"اخطار [کاربر] [دلیل]", descEn:"Issue a warning and apply configured penalties", descFa:"صدور اخطار و اجرای جریمه‌های تنظیم‌شده" },
  { id:"mute", phase:2, minRank:"admin", aliasesEn:["mute"], aliasesFa:["سکوت","محدود"], usageEn:"mute [user] [duration]", usageFa:"سکوت [کاربر] [مدت]", descEn:"Temporarily restrict a member", descFa:"سکوت موقت یک عضو" },
  { id:"perm_mute", phase:2, minRank:"admin", aliasesEn:["permmute","permanentmute"], aliasesFa:["سکوت دائم","محدودیت دائم"], usageEn:"permmute [user]", usageFa:"سکوت دائم [کاربر]", descEn:"Permanently restrict a member", descFa:"سکوت دائمی یک عضو" },
  { id:"unmute", phase:2, minRank:"admin", aliasesEn:["unmute"], aliasesFa:["رفع سکوت","آزادسازی"], usageEn:"unmute [user]", usageFa:"رفع سکوت [کاربر]", descEn:"Restore member sending permissions", descFa:"رفع سکوت و بازگردانی دسترسی ارسال" },
  { id:"ban", phase:2, minRank:"admin", aliasesEn:["ban"], aliasesFa:["بن","مسدود"], usageEn:"ban [user] [duration]", usageFa:"بن [کاربر] [مدت]", descEn:"Ban a member permanently or temporarily", descFa:"بن دائمی یا موقت یک عضو" },
  { id:"unban", phase:2, minRank:"admin", aliasesEn:["unban"], aliasesFa:["رفع بن","آنبن","آنبن کردن"], usageEn:"unban [user]", usageFa:"رفع بن [کاربر]", descEn:"Unban a member", descFa:"رفع بن یک عضو" },
  { id:"lock", phase:2, minRank:"admin", aliasesEn:["lock","locks"], aliasesFa:["قفل","قفل‌ها","قفل ها","قفل‌ ها"], usageEn:"lock [type]", usageFa:"قفل [نوع]", descEn:"Lock center and normal/content controls", descFa:"مرکز قفل و کنترل محتوا" },
  { id:"unlock", phase:2, minRank:"admin", aliasesEn:["unlock"], aliasesFa:["بازکردن","باز کردن"], usageEn:"unlock [type]", usageFa:"بازکردن [نوع]", descEn:"Unlock a content rule", descFa:"بازکردن یک قفل" },
  { id:"lockall", phase:2, minRank:"admin", aliasesEn:["lockall"], aliasesFa:["قفل همه","قفل‌همه"], usageEn:"lockall", usageFa:"قفل همه", descEn:"Enable all lock rules", descFa:"فعال‌سازی همه قفل‌ها" },
  { id:"unlockall", phase:2, minRank:"admin", aliasesEn:["unlockall"], aliasesFa:["بازکردن همه","بازکردن‌همه"], usageEn:"unlockall", usageFa:"بازکردن همه", descEn:"Disable all lock rules", descFa:"خاموش‌کردن همه قفل‌ها" },
];

export const COMMANDS = defs;

export const PHASES = [
  { id:1 as Phase, fa:"هسته و اطلاعات", en:"Core & information", blurbFa:"ربات، آیدی، ادمین، اطلاعات گروه، مقام و پروفایل شخصی", blurbEn:"Robot, identity, admin access, group info, rank and personal profile" },
  { id:2 as Phase, fa:"وضعیت و سیستم", en:"Status & system", blurbFa:"پینگ، وضعیت گروه و اطلاعات فنی ربات", blurbEn:"Ping, group status and technical bot information" },
];

export const RANK_ORDER: Rank[] = ["member","admin","sudo","owner"];

export function rankAtLeast(have: Rank, need: Rank): boolean {
  return RANK_ORDER.indexOf(have) >= RANK_ORDER.indexOf(need);
}

export function normalizeToken(value:string){
  return value.trim().replace(/^[/!.]+/,"").replace(/\\s+/g,"").toLowerCase();
}

export function parseDuration(value:string):number|null{
  const m=value.trim().toLowerCase().match(/^(\\d+)(s|m|h|d)?$/);
  if(!m)return null;
  const n=Number(m[1]); const unit=m[2]??"s";
  const mult=unit==="m"?60:unit==="h"?3600:unit==="d"?86400:1;
  return Number.isFinite(n)&&n>0?n*mult:null;
}

export function resolveCommand(token:string):CommandDef|null{
  const key=normalizeToken(token);
  return COMMANDS.find(c=>[...c.aliasesEn,...c.aliasesFa].some(a=>normalizeToken(a)===key))??null;
}
