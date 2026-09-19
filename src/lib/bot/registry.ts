export type Rank = "owner" | "sudo" | "admin" | "member";
export type Lang = "fa" | "en";
export type Phase = 1 | 2 | 3 | 4 | 5;

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

/**
 * Dictionary of group-management terms.
 * Edit aliases here (or in the studio Commands tab) if your community
 * uses a different word than the defaults.
 *
 * Phase 1 handlers are live. Later phases are registered so you can
 * correct wording before they are implemented.
 */
export const COMMANDS: CommandDef[] = [
  {
    id: "start",
    phase: 1,
    minRank: "member",
    aliasesEn: ["start"],
    aliasesFa: ["استارت"],
    usageEn: "/start",
    usageFa: "/استارت",
    descEn: "Introduce the bot",
    descFa: "معرفی بات",
  },
  {
    id: "help",
    phase: 1,
    minRank: "member",
    aliasesEn: ["help"],
    aliasesFa: ["راهنما"],
    usageEn: "/help [command]",
    usageFa: "/راهنما [دستور]",
    descEn: "Show commands",
    descFa: "فهرست دستورات",
  },
  {
    id: "ping",
    phase: 1,
    minRank: "member",
    aliasesEn: ["ping"],
    aliasesFa: ["پینگ"],
    usageEn: "/ping",
    usageFa: "/پینگ",
    descEn: "Latency check",
    descFa: "تست پاسخ‌دهی",
  },
  {
    id: "id",
    phase: 1,
    minRank: "member",
    aliasesEn: ["id"],
    aliasesFa: ["آیدی"],
    usageEn: "/id",
    usageFa: "/آیدی",
    descEn: "User / chat id",
    descFa: "شناسه کاربر و گروه",
  },
  {
    id: "info",
    phase: 1,
    minRank: "admin",
    aliasesEn: ["info"],
    aliasesFa: ["اطلاعات"],
    usageEn: "/info",
    usageFa: "/اطلاعات",
    descEn: "Group details",
    descFa: "مشخصات گروه",
  },
  {
    id: "lang",
    phase: 1,
    minRank: "admin",
    aliasesEn: ["lang"],
    aliasesFa: ["زبان"],
    usageEn: "/lang fa|en",
    usageFa: "/زبان fa|en",
    descEn: "Group language",
    descFa: "زبان پاسخ بات در گروه",
  },
  {
    id: "staff",
    phase: 1,
    minRank: "member",
    aliasesEn: ["staff"],
    aliasesFa: ["مدیران"],
    usageEn: "/staff",
    usageFa: "/مدیران",
    descEn: "List admins",
    descFa: "لیست مدیران گروه",
  },
  {
    id: "settings",
    phase: 1,
    minRank: "admin",
    aliasesEn: ["settings"],
    aliasesFa: ["تنظیمات"],
    usageEn: "/settings",
    usageFa: "/تنظیمات",
    descEn: "Show core settings",
    descFa: "نمایش تنظیمات هسته",
  },

  {
    id: "ban",
    phase: 2,
    minRank: "admin",
    aliasesEn: ["ban"],
    aliasesFa: ["بن"],
    usageEn: "/ban [user] [reason]",
    usageFa: "/بن [کاربر] [دلیل]",
    descEn: "Ban a user",
    descFa: "بن کردن کاربر",
  },
  {
    id: "unban",
    phase: 2,
    minRank: "admin",
    aliasesEn: ["unban"],
    aliasesFa: ["آنبن"],
    usageEn: "/unban [user]",
    usageFa: "/آنبن [کاربر]",
    descEn: "Unban a user",
    descFa: "رفع بن",
  },
  {
    id: "mute",
    phase: 2,
    minRank: "admin",
    aliasesEn: ["mute"],
    aliasesFa: ["میوت"],
    usageEn: "/mute [user] [time] [reason]",
    usageFa: "/سکوت [کاربر] [زمان] [دلیل]",
    descEn: "Mute a user",
    descFa: "سکوت کاربر",
  },
  {
    id: "unmute",
    phase: 2,
    minRank: "admin",
    aliasesEn: ["unmute"],
    aliasesFa: ["آنمیوت"],
    usageEn: "/unmute [user]",
    usageFa: "/آنمیوت [کاربر]",
    descEn: "Unmute a user",
    descFa: "رفع سکوت",
  },
  {
    id: "kick",
    phase: 2,
    minRank: "admin",
    aliasesEn: ["kick"],
    aliasesFa: ["کیک"],
    usageEn: "/kick [user] [reason]",
    usageFa: "/کیک [کاربر] [دلیل]",
    descEn: "Kick a user",
    descFa: "اخراج از گروه",
  },
  {
    id: "warn",
    phase: 2,
    minRank: "admin",
    aliasesEn: ["warn"],
    aliasesFa: ["اخطار"],
    usageEn: "/warn [user] [reason]",
    usageFa: "/اخطار [کاربر] [دلیل]",
    descEn: "Warn a user",
    descFa: "ثبت اخطار",
  },
  {
    id: "unwarn",
    phase: 2,
    minRank: "admin",
    aliasesEn: ["unwarn"],
    aliasesFa: ["حذفاخطار"],
    usageEn: "/unwarn [user]",
    usageFa: "/حذف‌اخطار [کاربر]",
    descEn: "Remove a warn",
    descFa: "حذف یک اخطار",
  },
  {
    id: "warns",
    phase: 2,
    minRank: "member",
    aliasesEn: ["warns"],
    aliasesFa: ["اخطارها"],
    usageEn: "/warns [user]",
    usageFa: "/اخطارها [کاربر]",
    descEn: "Show warns",
    descFa: "مشاهده اخطارها",
  },
  {
    id: "tmute",
    phase: 2,
    minRank: "admin",
    aliasesEn: ["tmute"],
    aliasesFa: ["تیمیوت"],
    usageEn: "/tmute [user] [time]",
    usageFa: "/تی‌میوت [کاربر] [زمان]",
    descEn: "Temporary mute",
    descFa: "سکوت موقت",
  },
  {
    id: "tban",
    phase: 2,
    minRank: "admin",
    aliasesEn: ["tban"],
    aliasesFa: ["تیبن"],
    usageEn: "/tban [user] [time]",
    usageFa: "/تی‌بن [کاربر] [زمان]",
    descEn: "Temporary ban",
    descFa: "بن موقت",
  },

  {
    id: "lock",
    phase: 3,
    minRank: "admin",
    aliasesEn: ["lock"],
    aliasesFa: ["قفل"],
    usageEn: "/lock [type]",
    usageFa: "/قفل [نوع]",
    descEn: "Lock a content type",
    descFa: "قفل محتوا",
  },
  {
    id: "unlock",
    phase: 3,
    minRank: "admin",
    aliasesEn: ["unlock"],
    aliasesFa: ["آنلاک"],
    usageEn: "/unlock [type]",
    usageFa: "/آنلاک [نوع]",
    descEn: "Unlock a content type",
    descFa: "باز کردن قفل",
  },
  {
    id: "locks",
    phase: 3,
    minRank: "admin",
    aliasesEn: ["locks"],
    aliasesFa: ["قفلها"],
    usageEn: "/locks",
    usageFa: "/قفلها",
    descEn: "List locks",
    descFa: "وضعیت قفل‌ها",
  },
  {
    id: "antiflood",
    phase: 3,
    minRank: "admin",
    aliasesEn: ["antiflood"],
    aliasesFa: ["ضدفلود"],
    usageEn: "/antiflood on|off [n]",
    usageFa: "/ضدفلود on|off [n]",
    descEn: "Anti-flood",
    descFa: "ضد پیام پشت‌سرهم",
  },
  {
    id: "antispam",
    phase: 3,
    minRank: "admin",
    aliasesEn: ["antispam"],
    aliasesFa: ["ضداسپم"],
    usageEn: "/antispam on|off",
    usageFa: "/ضداسپم on|off",
    descEn: "Anti-spam",
    descFa: "ضد هرزنامه",
  },
  {
    id: "night",
    phase: 3,
    minRank: "admin",
    aliasesEn: ["night"],
    aliasesFa: ["نایت"],
    usageEn: "/night on|off",
    usageFa: "/نایت on|off",
    descEn: "Night mode",
    descFa: "حالت شب گروه",
  },

  {
    id: "welcome",
    phase: 4,
    minRank: "admin",
    aliasesEn: ["welcome"],
    aliasesFa: ["خوشامد"],
    usageEn: "/welcome [text]",
    usageFa: "/خوشامد [متن]",
    descEn: "Welcome message",
    descFa: "پیام خوشامد",
  },
  {
    id: "goodbye",
    phase: 4,
    minRank: "admin",
    aliasesEn: ["goodbye"],
    aliasesFa: ["خدافظی"],
    usageEn: "/goodbye [text]",
    usageFa: "/خدافظی [متن]",
    descEn: "Goodbye message",
    descFa: "پیام خروج",
  },
  {
    id: "rules",
    phase: 4,
    minRank: "member",
    aliasesEn: ["rules"],
    aliasesFa: ["قوانین"],
    usageEn: "/rules",
    usageFa: "/قوانین",
    descEn: "Show rules",
    descFa: "نمایش قوانین",
  },
  {
    id: "setrules",
    phase: 4,
    minRank: "admin",
    aliasesEn: ["setrules"],
    aliasesFa: ["تنظیمقوانین"],
    usageEn: "/setrules [text]",
    usageFa: "/تنظیمقوانین [متن]",
    descEn: "Set rules",
    descFa: "ثبت قوانین",
  },
  {
    id: "filter",
    phase: 4,
    minRank: "admin",
    aliasesEn: ["filter"],
    aliasesFa: ["فیلتر"],
    usageEn: "/filter [word] [reply]",
    usageFa: "/فیلتر [کلمه] [جواب]",
    descEn: "Word filter",
    descFa: "فیلتر کلمه",
  },
  {
    id: "notes",
    phase: 4,
    minRank: "member",
    aliasesEn: ["notes"],
    aliasesFa: ["نوت"],
    usageEn: "/notes [name]",
    usageFa: "/نوت [نام]",
    descEn: "Saved notes",
    descFa: "یادداشت ذخیره‌شده",
  },

  {
    id: "pin",
    phase: 5,
    minRank: "admin",
    aliasesEn: ["pin"],
    aliasesFa: ["پین"],
    usageEn: "/pin",
    usageFa: "/پین",
    descEn: "Pin a message",
    descFa: "سنجاق پیام",
  },
  {
    id: "unpin",
    phase: 5,
    minRank: "admin",
    aliasesEn: ["unpin"],
    aliasesFa: ["آنپین"],
    usageEn: "/unpin",
    usageFa: "/آنپین",
    descEn: "Unpin",
    descFa: "برداشتن سنجاق",
  },
  {
    id: "purge",
    phase: 5,
    minRank: "admin",
    aliasesEn: ["purge"],
    aliasesFa: ["پاکسازی"],
    usageEn: "/purge",
    usageFa: "/پاکسازی",
    descEn: "Delete up to reply",
    descFa: "حذف پیام‌ها تا ریپلای",
  },
  {
    id: "promote",
    phase: 5,
    minRank: "owner",
    aliasesEn: ["promote"],
    aliasesFa: ["ارتقا"],
    usageEn: "/promote [user]",
    usageFa: "/ارتقا [کاربر]",
    descEn: "Promote admin",
    descFa: "ارتقا به ادمین",
  },
  {
    id: "demote",
    phase: 5,
    minRank: "owner",
    aliasesEn: ["demote"],
    aliasesFa: ["عزل"],
    usageEn: "/demote [user]",
    usageFa: "/عزل [کاربر]",
    descEn: "Demote admin",
    descFa: "عزل ادمین",
  },
  {
    id: "report",
    phase: 5,
    minRank: "member",
    aliasesEn: ["report"],
    aliasesFa: ["گزارش"],
    usageEn: "/report",
    usageFa: "/گزارش",
    descEn: "Report to admins",
    descFa: "گزارش به مدیران",
  },
];

export const PHASES: { id: Phase; fa: string; en: string; blurbFa: string; blurbEn: string }[] = [
  { id: 1, fa: "هسته", en: "Core", blurbFa: "کانفیگ، دسترسی، دستورات پایه، زبان دوزبانه", blurbEn: "Config, ranks, core commands, bilingual engine" },
  { id: 2, fa: "مدیریت اعضا", en: "Moderation", blurbFa: "بن، سکوت، کیک، اخطار، موقت‌ها", blurbEn: "Ban, mute, kick, warns, timed actions" },
  { id: 3, fa: "قفل و ضدآسیب", en: "Locks & guard", blurbFa: "قفل محتوا، فلود، اسپم، نایت‌مد", blurbEn: "Locks, flood, spam, night mode" },
  { id: 4, fa: "پیام و محتوا", en: "Messages", blurbFa: "خوشامد، قوانین، فیلتر، نوت", blurbEn: "Welcome, rules, filters, notes" },
  { id: 5, fa: "ابزار ادمین", en: "Admin tools", blurbFa: "پین، پاکسازی، ارتقا، گزارش", blurbEn: "Pin, purge, promote, report" },
];

export const RANK_ORDER: Rank[] = ["member", "admin", "sudo", "owner"];

export function rankAtLeast(have: Rank, need: Rank): boolean {
  return RANK_ORDER.indexOf(have) >= RANK_ORDER.indexOf(need);
}



export function normalizeToken(value: string): string {
  return value.trim().replace(/^\/+/, "").replace(/\s+/g, "").toLowerCase();
}

export function parseDuration(value: string): number | null {
  const m = value.trim().toLowerCase().match(/^(\d+)(s|m|h|d)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] || "s";
  const mult = unit === "m" ? 60 : unit === "h" ? 3600 : unit === "d" ? 86400 : 1;
  const seconds = n * mult;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}


export function resolveCommand(token: string): CommandDef | null {
  const key = normalizeToken(token);
  return COMMANDS.find((command) =>
    [...command.aliasesEn, ...command.aliasesFa].some((alias) => normalizeToken(alias) === key)
  ) ?? null;
}
