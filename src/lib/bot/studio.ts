export type StudioPhaseId = 1 | 2;
export type StudioRank = "member" | "admin" | "owner";

export type StudioCapability = {
  id: string;
  phase: StudioPhaseId;
  titleFa: string;
  titleEn: string;
  descriptionFa: string;
  descriptionEn: string;
  enabled: boolean;
};

export type StudioCommand = {
  id: string;
  capabilityId: string;
  phase: StudioPhaseId;
  aliasesFa: string[];
  aliasesEn: string[];
  minRank: StudioRank;
  enabled: boolean;
  responseFa: string;
  responseEn: string;
};

export type StudioDocument = {
  version: string;
  updatedAt: string;
  activePhase: StudioPhaseId;
  settings: {
    botName: string;
    defaultLang: "fa" | "en";
    bareCommands: boolean;
    compactReplies: boolean;
  };
  capabilities: StudioCapability[];
  commands: StudioCommand[];
};

const divider = "─────━━───── ◈ ─────━━─────";

const C: StudioCapability[] = [
  { id: "core", phase: 1, titleFa: "هسته و اطلاعات", titleEn: "Core & information", descriptionFa: "هویت بات، اطلاعات کاربر و گروه، مقام‌ها.", descriptionEn: "Bot identity, user/group information and roles.", enabled: true },
  { id: "status", phase: 1, titleFa: "وضعیت سیستم", titleEn: "System status", descriptionFa: "پینگ، بات، وضعیت دیتابیس و سرویس‌ها.", descriptionEn: "Ping, bot, database and service status.", enabled: true },
  { id: "panel", phase: 2, titleFa: "پنل مدیریت", titleEn: "Management panel", descriptionFa: "پنل شخصی، نقش‌ها و دسترسی‌های ویژه.", descriptionEn: "Role-aware personal management panel.", enabled: true },
  { id: "locks", phase: 2, titleFa: "قفل‌ها", titleEn: "Locks", descriptionFa: "قفل رسانه، لینک، شناسه، اشتراک‌گذاری و رفتار.", descriptionEn: "Media, link, identity, sharing and behavior locks.", enabled: true },
  { id: "security", phase: 2, titleFa: "امنیت", titleEn: "Security", descriptionFa: "ضد اسپم، فلود، مهاجم و رفتار مشکوک.", descriptionEn: "Anti-spam, flood, attacker and suspicious behavior protection.", enabled: true },
  { id: "reports", phase: 2, titleFa: "گزارش و Audit", titleEn: "Reports & audit", descriptionFa: "گزارش تخلف، امنیت و تاریخچه عملیات.", descriptionEn: "Violation, security and audit history.", enabled: true },
  { id: "members", phase: 2, titleFa: "اعضا", titleEn: "Members", descriptionFa: "جستجو، نقش، سکوت، محدودیت و بلک‌لیست.", descriptionEn: "Search, roles, mute, restriction and blacklist.", enabled: true },
  { id: "warnings", phase: 2, titleFa: "اخطارها", titleEn: "Warnings", descriptionFa: "ثبت، حذف و سوابق اخطار؛ بدون نردبان مجازات.", descriptionEn: "Create, remove and review warnings; no punishment ladder.", enabled: true },
];

const command = (
  id: string,
  capabilityId: string,
  phase: StudioPhaseId,
  aliasesFa: string[],
  aliasesEn: string[],
  minRank: StudioRank,
  responseFa: string,
  responseEn: string,
): StudioCommand => ({
  id, capabilityId, phase, aliasesFa, aliasesEn, minRank, enabled: true, responseFa, responseEn,
});

export const STUDIO_DEFAULTS: StudioDocument = {
  version: "2.0",
  updatedAt: new Date(0).toISOString(),
  activePhase: 1,
  settings: { botName: "نظم", defaultLang: "fa", bareCommands: true, compactReplies: true },
  capabilities: C,
  commands: [
    command("robot","core",1,["ربات"],["robot"],"member","جانم من اینجا هستم حاضر و آماده در خدمت شما","Yes, I am here and ready."),
    command("id","core",1,["آیدی","ایدی"],["id"],"member","◈ اطلاعات کاربر\n\n⛂ - نام : {{user_name}}\n⛂ - شناسه : {{user_id}}\n⛂ - نام کاربری : {{username}}\n⛂ - مقام : {{rank}}","◈ User information\n\n⛂ - Name : {{user_name}}\n⛂ - ID : {{user_id}}\n⛂ - Username : {{username}}\n⛂ - Rank : {{rank}}"),
    command("admin","core",1,["ادمین","مدیر"],["admin"],"member","✓ دسترسی تأیید شد شما ادمین این گروه هستید.","✓ Access confirmed. You are an admin."),
    command("info","core",1,["اطلاعات","اینفو"],["info"],"member","◈ اطلاعات گروه\n\n⛂ - نام گروه : {{chat_title}}\n⛂ - شناسه گروه : {{chat_id}}\n⛂ - نوع گروه : {{chat_type}}\n⛂ - تعداد اعضا : {{members_count}}\n⛂ - تعداد مدیران : {{admins_count}}","◈ Group information\n\n⛂ - Group : {{chat_title}}\n⛂ - ID : {{chat_id}}\n⛂ - Type : {{chat_type}}\n⛂ - Members : {{members_count}}\n⛂ - Admins : {{admins_count}}"),
    command("rank","core",1,["مقام","اطلاعات مقام"],["rank"],"member","◈ اطلاعات مقام\n\n⛂ - نام : {{user_name}}\n⛂ - شناسه : {{user_id}}\n⛂ - مقام : {{rank}}\n⛂ - دسترسی‌ها : {{permissions}}","◈ Role information\n\n⛂ - Name : {{user_name}}\n⛂ - ID : {{user_id}}\n⛂ - Rank : {{rank}}\n⛂ - Access : {{permissions}}"),
    command("me","core",1,["من"],["me"],"member","◈ اطلاعات کاربر\n\n⛂ - نام : {{user_name}}\n⛂ - نام کاربری : {{username}}\n⛂ - شناسه : {{user_id}}\n⛂ - مقام : {{rank}}\n\n${divider}\n\n⛂ - تعداد پیام امروز : {{messages_today}}\n⛂ - تعداد پیام کل : {{messages_total}}","◈ User information\n\n⛂ - Name : {{user_name}}\n⛂ - Username : {{username}}\n⛂ - ID : {{user_id}}\n⛂ - Rank : {{rank}}"),
    command("ping","status",1,["پینگ"],["ping"],"member","◈ وضعیت سیستم\n\n⛂ - وضعیت ربات : آنلاین\n⛂ - سرعت پاسخ : {{latency_ms}}ms\n⛂ - اتصال دیتابیس : {{database_status}}\n⛂ - نسخه ربات : {{version}}\n\n${divider}\n\n★ - سیستم پایدار است","◈ System status\n\n⛂ - Bot : online\n⛂ - Response : {{latency_ms}}ms\n⛂ - Database : {{database_status}}\n⛂ - Version : {{version}}"),
    command("bot","status",1,["بات"],["bot"],"owner","◈ اطلاعات فنی ربات\n\n⛂ - نام ربات : {{bot_name}}\n⛂ - نام کاربری : {{bot_username}}\n⛂ - شناسه : {{bot_id}}\n⛂ - نسخه : {{version}}\n⛂ - وضعیت دیتابیس : {{database_status}}\n⛂ - روش اتصال : Polling","◈ Bot technical status\n\n⛂ - Name : {{bot_name}}\n⛂ - Username : {{bot_username}}\n⛂ - ID : {{bot_id}}\n⛂ - Version : {{version}}\n⛂ - Database : {{database_status}}\n⛂ - Transport : Polling"),
    command("status","status",1,["وضعیت"],["status"],"member","◈ وضعیت گروه\n\n⛂ - وضعیت ربات : ● فعال\n⛂ - وضعیت مدیریت : ● فعال\n⛂ - وضعیت دیتابیس : ● متصل\n⛂ - وضعیت ضد اسپم : ● فعال\n⛂ - وضعیت ضد فلود : ● فعال\n⛂ - وضعیت امنیت : ● فعال\n\n${divider}\n\n⛂ - تعداد اعضا : {{members_count}}\n⛂ - تعداد مدیران : {{admins_count}}\n\n★ - وضعیت کلی گروه : پایدار","◈ Group status\n\n⛂ - Bot : ● active\n⛂ - Management : ● active\n⛂ - Database : ● connected\n⛂ - Anti-spam : ● active\n⛂ - Anti-flood : ● active\n⛂ - Security : ● active\n\n⛂ - Members : {{members_count}}\n⛂ - Admins : {{admins_count}}"),
    command("panel","panel",2,["پنل"],["panel"],"member","◈ پنل مدیریت\n\n⛂ - مقام شما : {{rank}}\n⛂ - دسترسی‌های فعال : {{permissions}}\n⛂ - پنل‌های قابل دسترسی : {{panels}}\n\n★ - تنظیمات حساس نیاز به تأیید دوم دارند.","◈ Management panel\n\n⛂ - Rank : {{rank}}\n⛂ - Access : {{permissions}}\n⛂ - Panels : {{panels}}"),
    command("locks","locks",2,["قفل‌ها","قفلها"],["locks"],"admin","◈ مرکز قفل‌ها\n\n⛂ - رسانه : {{media_locks}}\n⛂ - لینک : {{link_locks}}\n⛂ - شناسه : {{identity_locks}}\n⛂ - اشتراک‌گذاری : {{sharing_locks}}\n⛂ - رفتار : {{behavior_locks}}\n\n★ - استثناهای کاربران ویژه حفظ می‌شوند.","◈ Lock center\n\n⛂ - Media : {{media_locks}}\n⛂ - Links : {{link_locks}}\n⛂ - Identity : {{identity_locks}}\n⛂ - Sharing : {{sharing_locks}}\n⛂ - Behavior : {{behavior_locks}}"),
    command("security","security",2,["امنیت"],["security"],"admin","◈ مرکز امنیت\n\n⛂ - ضد مهاجم : فعال\n⛂ - ضد فلود : فعال\n⛂ - ضد اسپم : فعال\n⛂ - ضد منشن انبوه : فعال\n⛂ - رفتار مشکوک : فعال\n\n★ - حمله → حذف پیام + سکوت دائم + ثبت گزارش امنیتی.","◈ Security center\n\n⛂ - Anti-attacker : active\n⛂ - Anti-flood : active\n⛂ - Anti-spam : active\n⛂ - Suspicious behavior : active\n\n★ - Attack → delete + permanent mute + security log."),
    command("reports","reports",2,["گزارش‌ها","گزارشها"],["reports"],"admin","◈ مرکز گزارش و Audit\n\n⛂ - گزارش تخلف : {{violation_reports}}\n⛂ - گزارش امنیتی : {{security_reports}}\n⛂ - عملیات مدیران : {{audit_count}}\n⛂ - گزارش امروز : {{today_reports}}","◈ Reports & audit\n\n⛂ - Violations : {{violation_reports}}\n⛂ - Security : {{security_reports}}\n⛂ - Audit : {{audit_count}}"),
    command("members","members",2,["اعضا"],["members"],"admin","◈ مدیریت اعضا\n\n⛂ - اعضا : {{members_count}}\n⛂ - مدیران : {{admins_count}}\n⛂ - کاربران ویژه : {{special_count}}\n⛂ - ساکت : {{muted_count}}\n⛂ - محدود : {{restricted_count}}\n⛂ - بلک‌لیست : {{blacklist_count}}","◈ Members\n\n⛂ - Members : {{members_count}}\n⛂ - Admins : {{admins_count}}\n⛂ - Special : {{special_count}}\n⛂ - Muted : {{muted_count}}\n⛂ - Restricted : {{restricted_count}}"),
    command("warn","warnings",2,["اخطار"],["warn"],"admin","◈ ثبت اخطار\n\n⛂ - کاربر : {{target}}\n⛂ - شناسه : {{target_id}}\n⛂ - دلیل : {{reason}}\n⛂ - ثبت‌کننده : {{operator}}\n⛂ - وضعیت : فعال","◈ Warning created\n\n⛂ - User : {{target}}\n⛂ - ID : {{target_id}}\n⛂ - Reason : {{reason}}\n⛂ - Operator : {{operator}}"),
    command("unwarn","warnings",2,["حذف اخطار","حذف‌اخطار"],["unwarn"],"admin","✓ اخطار حذف شد\n⛂ - کاربر : {{target}}\n⛂ - شناسه : {{target_id}}","✓ Warning removed\n⛂ - User : {{target}}\n⛂ - ID : {{target_id}}"),
    command("warns","warnings",2,["سوابق اخطار","اخطارها"],["warnings","warns"],"admin","◈ سوابق اخطار\n\n⛂ - کاربر : {{target}}\n⛂ - فعال : {{warnings_active}}\n⛂ - کل : {{warnings_total}}\n⛂ - آخرین دلیل : {{last_warning_reason}}","◈ Warning history\n\n⛂ - User : {{target}}\n⛂ - Active : {{warnings_active}}\n⛂ - Total : {{warnings_total}}\n⛂ - Last reason : {{last_warning_reason}}"),
  ],
};

export function cloneStudioDefaults(): StudioDocument {
  return structuredClone(STUDIO_DEFAULTS);
}
