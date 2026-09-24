import { COMMANDS, type Rank } from "./registry.ts";

export type StudioPhaseId = 1 | 2;
export type StudioRank = Rank;
export type StudioCapability = { id: string; phase: StudioPhaseId; titleFa: string; titleEn: string; descriptionFa: string; descriptionEn: string; enabled: boolean };
export type StudioCommand = { id: string; capabilityId: string; phase: StudioPhaseId; aliasesFa: string[]; aliasesEn: string[]; minRank: StudioRank; enabled: boolean; responseFa: string; responseEn: string };
export type StudioResponseTemplate = { id: string; phase: StudioPhaseId; titleFa: string; titleEn: string; responseFa: string; responseEn: string };
export type StudioDocument = { version: string; updatedAt: string; activePhase: StudioPhaseId; settings: { botName: string; defaultLang: "fa" | "en"; bareCommands: boolean; compactReplies: boolean }; capabilities: StudioCapability[]; commands: StudioCommand[]; responseTemplates: StudioResponseTemplate[] };

const capabilities: StudioCapability[] = [
  { id: "phase-1", phase: 1, titleFa: "هسته و اطلاعات", titleEn: "Core & information", descriptionFa: "ربات، آیدی، ادمین، اطلاعات گروه، مقام و پروفایل شخصی.", descriptionEn: "Robot, identity, admin access, group info, ranks and profile.", enabled: true },
  { id: "phase-2", phase: 2, titleFa: "وضعیت و سیستم", titleEn: "Status & system", descriptionFa: "پینگ، وضعیت گروه و اطلاعات فنی ربات.", descriptionEn: "Ping, group status and technical bot status.", enabled: true },
];

const fa: Record<string, string> = {
  robot: "{{robot_line}}",
  id: "◈ اطلاعات کاربر\n\n⛂ - نام : {{user_name}}\n⛂ - شناسه : {{user_id}}\n⛂ - نام کاربری : {{username}}\n⛂ - مقام : {{rank}}\n\n─────━━───── ◈ ─────━━─────\n\n⛂ - تعداد پیام امروز : {{messages_today}}\n⛂ - تعداد عضویت امروز : —\n⛂ - تعداد پیام کل : {{messages_total}}\n⛂ - تعداد عضویت کل : —",
  admin: "{{admin_result}}",
  info: "◈ اطلاعات گروه\n\n⛂ - نام گروه : {{chat_title}}\n⛂ - شناسه گروه : {{chat_id}}\n⛂ - نام کاربری گروه : {{chat_username}}\n⛂ - نوع گروه : {{chat_type}}\n⛂ - تعداد اعضا : {{members_count}}\n⛂ - تعداد مدیران : {{admins_count}}\n⛂ - مالک گروه : —\n\n─────━━───── ◈ ─────━━─────\n\n⛂ - پیام‌های امروز : {{messages_today}}\n⛂ - اعضای جدید امروز : —\n⛂ - پیام‌های کل : {{messages_total}}\n⛂ - اعضای فعلی : {{members_count}}\n⛂ - تعداد افراد در لیست سکوت : —\n⛂ - تعداد افراد در لیست ویژه : —\n⛂ - تعداد اخطار های فعال : —\n\n★ - تاریخ ساخت گروه : —\n★ - لینک دعوت : —\n★ - وضعیت لینک دعوت : —",
  rank: "{{rank_card}}",
  me: "{{me_card}}",
  ping: "{{ping_card}}",
  bot: "{{bot_card}}",
  status: "{{status_card}}",
  "advertising-lock": "{{live_card}}",
};



// Response-only skeleton library: 36 approved future capabilities. These are intentionally NOT registered as active commands yet.
const responseTemplates: StudioResponseTemplate[] = [
  { id: "panel", phase: 1, titleFa: "پنل مدیریت", titleEn: "Management panel", responseFa: "◈ پنل مدیریت\n\n⛂ - وضعیت : آماده\n⛂ - سطح دسترسی : {{rank}}\n⛂ - قابلیت‌ها : {{panels}}\n\n★ - اسکلت قابلیت آماده است.", responseEn: "◈ Management panel\n\n⛂ - Status : Ready\n⛂ - Access : {{rank}}\n⛂ - Capabilities : {{panels}}\n\n★ - Feature skeleton is ready." },
  { id: "locks", phase: 1, titleFa: "قفل‌ها", titleEn: "Locks", responseFa: "◈ سیستم قفل‌ها\n\n⛂ - وضعیت : آماده\n⛂ - قفل رسانه : {{media_locks}}\n⛂ - قفل لینک : {{link_locks}}\n⛂ - قفل هویت : {{identity_locks}}\n⛂ - قفل اشتراک‌گذاری : {{sharing_locks}}\n⛂ - قفل رفتار : {{behavior_locks}}", responseEn: "◈ Lock system\n\n⛂ - Status : Ready\n⛂ - Media locks : {{media_locks}}\n⛂ - Link locks : {{link_locks}}\n⛂ - Identity locks : {{identity_locks}}\n⛂ - Sharing locks : {{sharing_locks}}\n⛂ - Behavior locks : {{behavior_locks}}" },
  { id: "members", phase: 1, titleFa: "اعضا", titleEn: "Members", responseFa: "◈ مدیریت اعضا\n\n⛂ - اعضا : {{members_count}}\n⛂ - مدیران : {{admins_count}}\n⛂ - ویژه : {{special_count}}\n⛂ - سکوت : {{muted_count}}\n⛂ - محدود : {{restricted_count}}\n⛂ - سیاه : {{blacklist_count}}", responseEn: "◈ Member management\n\n⛂ - Members : {{members_count}}\n⛂ - Admins : {{admins_count}}\n⛂ - Special : {{special_count}}\n⛂ - Muted : {{muted_count}}\n⛂ - Restricted : {{restricted_count}}\n⛂ - Blacklist : {{blacklist_count}}" },
  { id: "warnings", phase: 1, titleFa: "اخطار", titleEn: "Warnings", responseFa: "◈ سیستم اخطار\n\n⛂ - اخطار فعال : {{warnings_active}}\n⛂ - مجموع اخطار : {{warnings_total}}\n⛂ - آخرین دلیل : {{last_warning_reason}}\n\n★ - اسکلت سیستم آماده است.", responseEn: "◈ Warning system\n\n⛂ - Active warnings : {{warnings_active}}\n⛂ - Total warnings : {{warnings_total}}\n⛂ - Last reason : {{last_warning_reason}}\n\n★ - Feature skeleton is ready." },
  { id: "warning-remove", phase: 1, titleFa: "حذف اخطار", titleEn: "Remove warning", responseFa: "✓ درخواست حذف اخطار ثبت شد.\n⛂ - هدف : {{target}}\n⛂ - شناسه : {{target_id}}", responseEn: "✓ Warning removal request registered.\n⛂ - Target : {{target}}\n⛂ - ID : {{target_id}}" },
  { id: "warning-history", phase: 1, titleFa: "سوابق اخطار", titleEn: "Warning history", responseFa: "◈ سوابق اخطار\n\n⛂ - هدف : {{target}}\n⛂ - شناسه : {{target_id}}\n⛂ - سوابق : آماده برای اتصال به دیتابیس", responseEn: "◈ Warning history\n\n⛂ - Target : {{target}}\n⛂ - ID : {{target_id}}\n⛂ - History : Ready for database integration" },

  { id: "media-lock", phase: 1, titleFa: "قفل رسانه", titleEn: "Media lock", responseFa: "◈ قفل رسانه\n⛂ - وضعیت : {{media_locks}}\n⛂ - حالت : حذف پیام و ثبت گزارش", responseEn: "◈ Media lock\n⛂ - Status : {{media_locks}}\n⛂ - Mode : Delete message and log report" },
  { id: "language-lock", phase: 1, titleFa: "قفل زبان", titleEn: "Language lock", responseFa: "◈ قفل زبان\n⛂ - وضعیت : آماده\n⛂ - زبان‌های هدف : قابل تنظیم از پنل", responseEn: "◈ Language lock\n⛂ - Status : Ready\n⛂ - Target languages : Configurable from panel" },
  { id: "sharing-lock", phase: 1, titleFa: "قفل اشتراک‌گذاری", titleEn: "Sharing lock", responseFa: "◈ قفل اشتراک‌گذاری\n⛂ - وضعیت : {{sharing_locks}}\n⛂ - فوروارد : کنترل‌شده\n⛂ - بازنشر : کنترل‌شده", responseEn: "◈ Sharing lock\n⛂ - Status : {{sharing_locks}}\n⛂ - Forwarding : Controlled\n⛂ - Reposting : Controlled" },
  { id: "edit-lock", phase: 1, titleFa: "قفل ویرایش", titleEn: "Edit lock", responseFa: "◈ قفل ویرایش\n⛂ - وضعیت : آماده\n⛂ - متن/کپشن/رسانه : قابل کنترل", responseEn: "◈ Edit lock\n⛂ - Status : Ready\n⛂ - Text/caption/media : Controllable" },
  { id: "identity-lock", phase: 1, titleFa: "قفل هویت", titleEn: "Identity lock", responseFa: "◈ قفل هویت\n⛂ - وضعیت : {{identity_locks}}\n⛂ - شناسه/یوزرنیم/منشن : قابل کنترل", responseEn: "◈ Identity lock\n⛂ - Status : {{identity_locks}}\n⛂ - ID/username/mention : Controllable" },
  { id: "advertising-lock", phase: 1, titleFa: "قفل تبلیغات", titleEn: "Advertising lock", responseFa: "◈ قفل تبلیغات\n⛂ - وضعیت : آماده\n⛂ - لینک تبلیغاتی : قابل تشخیص و گزارش", responseEn: "◈ Advertising lock\n⛂ - Status : Ready\n⛂ - Promotional links : Detectable and reportable" },

  { id: "security", phase: 1, titleFa: "امنیت", titleEn: "Security", responseFa: "◈ سیستم امنیت\n⛂ - ضد حمله : آماده\n⛂ - ضد فلود : فعال\n⛂ - ضد اسپم : فعال\n⛂ - گزارش امنیتی : آماده", responseEn: "◈ Security system\n⛂ - Anti-attack : Ready\n⛂ - Anti-flood : Active\n⛂ - Anti-spam : Active\n⛂ - Security reports : Ready" },
  { id: "anti-attacker", phase: 1, titleFa: "ضد حمله", titleEn: "Anti-attacker", responseFa: "◈ ضد حمله\n⛂ - تشخیص : آماده\n⛂ - واکنش : حذف + سکوت دائمی + گزارش", responseEn: "◈ Anti-attacker\n⛂ - Detection : Ready\n⛂ - Response : Delete + permanent mute + report" },
  { id: "anti-flood", phase: 1, titleFa: "ضد فلود", titleEn: "Anti-flood", responseFa: "◈ ضد فلود\n⛂ - وضعیت : فعال\n⛂ - تشخیص پیام‌های تکراری : آماده", responseEn: "◈ Anti-flood\n⛂ - Status : Active\n⛂ - Repeated-message detection : Ready" },
  { id: "anti-spam", phase: 1, titleFa: "ضد اسپم", titleEn: "Anti-spam", responseFa: "◈ ضد اسپم\n⛂ - وضعیت : فعال\n⛂ - تشخیص : آماده\n⛂ - گزارش : فعال", responseEn: "◈ Anti-spam\n⛂ - Status : Active\n⛂ - Detection : Ready\n⛂ - Reporting : Active" },
  { id: "anti-mention", phase: 1, titleFa: "ضد منشن انبوه", titleEn: "Anti-mass-mention", responseFa: "◈ ضد منشن انبوه\n⛂ - وضعیت : آماده\n⛂ - تشخیص منشن‌های غیرعادی : فعال", responseEn: "◈ Anti-mass-mention\n⛂ - Status : Ready\n⛂ - Abnormal mention detection : Active" },
  { id: "anti-link-attack", phase: 1, titleFa: "ضد حمله لینک", titleEn: "Anti-link attack", responseFa: "◈ ضد حمله لینک\n⛂ - وضعیت : آماده\n⛂ - حذف لینک مهاجم : آماده\n⛂ - گزارش : فعال", responseEn: "◈ Anti-link attack\n⛂ - Status : Ready\n⛂ - Attacker-link deletion : Ready\n⛂ - Reporting : Active" },

  { id: "reports", phase: 1, titleFa: "گزارش‌ها", titleEn: "Reports", responseFa: "◈ گزارش‌ها\n⛂ - گزارش تخلف : {{violation_reports}}\n⛂ - گزارش امنیتی : {{security_reports}}\n⛂ - گزارش امروز : {{today_reports}}", responseEn: "◈ Reports\n⛂ - Violations : {{violation_reports}}\n⛂ - Security : {{security_reports}}\n⛂ - Today : {{today_reports}}" },
  { id: "deleted-reports", phase: 1, titleFa: "گزارش حذف پیام", titleEn: "Deleted message reports", responseFa: "◈ گزارش حذف پیام\n⛂ - وضعیت : آماده\n⛂ - علت : قابل ثبت در گزارش‌ها", responseEn: "◈ Deleted message reports\n⛂ - Status : Ready\n⛂ - Reason : Ready for audit logging" },
  { id: "security-reports", phase: 1, titleFa: "گزارش امنیتی", titleEn: "Security reports", responseFa: "◈ گزارش امنیتی\n⛂ - هدف : {{target}}\n⛂ - شناسه : {{target_id}}\n⛂ - وضعیت : آماده", responseEn: "◈ Security report\n⛂ - Target : {{target}}\n⛂ - ID : {{target_id}}\n⛂ - Status : Ready" },
  { id: "audit-log", phase: 1, titleFa: "گزارش حسابرسی", titleEn: "Audit log", responseFa: "◈ گزارش حسابرسی\n⛂ - اپراتور : {{operator}}\n⛂ - عملیات : آماده ثبت\n⛂ - تعداد رویداد : {{audit_count}}", responseEn: "◈ Audit log\n⛂ - Operator : {{operator}}\n⛂ - Operation : Ready to log\n⛂ - Events : {{audit_count}}" },
  { id: "user-history", phase: 1, titleFa: "سوابق کاربر", titleEn: "User history", responseFa: "◈ سوابق کاربر\n⛂ - هدف : {{target}}\n⛂ - شناسه : {{target_id}}\n⛂ - سوابق : آماده اتصال به دیتابیس", responseEn: "◈ User history\n⛂ - Target : {{target}}\n⛂ - ID : {{target_id}}\n⛂ - History : Ready for database integration" },

  { id: "member-search", phase: 1, titleFa: "جستجوی عضو", titleEn: "Member search", responseFa: "◈ جستجوی عضو\n⛂ - ورودی : آماده\n⛂ - جستجو با شناسه، یوزرنیم یا نام : پشتیبانی می‌شود", responseEn: "◈ Member search\n⛂ - Input : Ready\n⛂ - Search by ID, username or name : Supported" },
  { id: "member-list", phase: 1, titleFa: "فهرست اعضا", titleEn: "Member list", responseFa: "◈ فهرست اعضا\n⛂ - اعضا : {{members_count}}\n⛂ - مرتب‌سازی : آماده", responseEn: "◈ Member list\n⛂ - Members : {{members_count}}\n⛂ - Sorting : Ready" },
  { id: "new-members", phase: 1, titleFa: "اعضای جدید", titleEn: "New members", responseFa: "◈ اعضای جدید\n⛂ - وضعیت : آماده\n⛂ - ثبت عضویت : آماده اتصال به دیتابیس", responseEn: "◈ New members\n⛂ - Status : Ready\n⛂ - Join tracking : Ready for database integration" },
  { id: "active-members", phase: 1, titleFa: "اعضای فعال", titleEn: "Active members", responseFa: "◈ اعضای فعال\n⛂ - وضعیت : آماده\n⛂ - مرتب‌سازی بر اساس فعالیت : آماده", responseEn: "◈ Active members\n⛂ - Status : Ready\n⛂ - Activity sorting : Ready" },
  { id: "manager-list", phase: 1, titleFa: "مدیران", titleEn: "Managers", responseFa: "◈ مدیران\n⛂ - تعداد : {{admins_count}}\n⛂ - سطح‌بندی : آماده", responseEn: "◈ Managers\n⛂ - Count : {{admins_count}}\n⛂ - Levels : Ready" },
  { id: "special-users", phase: 1, titleFa: "کاربران ویژه", titleEn: "Special users", responseFa: "◈ کاربران ویژه\n⛂ - تعداد : {{special_count}}\n⛂ - استثناها : آماده", responseEn: "◈ Special users\n⛂ - Count : {{special_count}}\n⛂ - Exceptions : Ready" },
  { id: "muted-users", phase: 1, titleFa: "لیست سکوت", titleEn: "Muted users", responseFa: "◈ لیست سکوت\n⛂ - تعداد : {{muted_count}}\n⛂ - وضعیت : آماده", responseEn: "◈ Muted users\n⛂ - Count : {{muted_count}}\n⛂ - Status : Ready" },
  { id: "restricted-users", phase: 1, titleFa: "لیست محدود", titleEn: "Restricted users", responseFa: "◈ کاربران محدود\n⛂ - تعداد : {{restricted_count}}\n⛂ - وضعیت : آماده", responseEn: "◈ Restricted users\n⛂ - Count : {{restricted_count}}\n⛂ - Status : Ready" },
  { id: "blacklist", phase: 1, titleFa: "لیست سیاه", titleEn: "Blacklist", responseFa: "◈ لیست سیاه\n⛂ - تعداد : {{blacklist_count}}\n⛂ - وضعیت : آماده", responseEn: "◈ Blacklist\n⛂ - Count : {{blacklist_count}}\n⛂ - Status : Ready" },
  { id: "bulk-members", phase: 1, titleFa: "عملیات گروهی اعضا", titleEn: "Bulk member actions", responseFa: "◈ عملیات گروهی\n⛂ - افزودن ویژه : آماده\n⛂ - سکوت : آماده\n⛂ - محدودسازی : آماده\n⛂ - لیست سیاه : آماده\n★ - تأیید دومرحله‌ای الزامی خواهد بود.", responseEn: "◈ Bulk member actions\n⛂ - Special : Ready\n⛂ - Mute : Ready\n⛂ - Restrict : Ready\n⛂ - Blacklist : Ready\n★ - Second confirmation will be required." },
  { id: "member-history", phase: 1, titleFa: "تاریخچه عضو", titleEn: "Member history", responseFa: "◈ تاریخچه عضو\n⛂ - هدف : {{target}}\n⛂ - شناسه : {{target_id}}\n⛂ - رویدادها : آماده ثبت", responseEn: "◈ Member history\n⛂ - Target : {{target}}\n⛂ - ID : {{target_id}}\n⛂ - Events : Ready to record" },
  { id: "manager-management", phase: 1, titleFa: "مدیریت مدیران", titleEn: "Manager management", responseFa: "◈ مدیریت مدیران\n⛂ - سطح‌بندی مدیران : آماده\n⛂ - دسترسی سفارشی : آماده\n⛂ - تغییر مدیر : نیازمند تأیید", responseEn: "◈ Manager management\n⛂ - Manager levels : Ready\n⛂ - Custom permissions : Ready\n⛂ - Manager changes : Confirmation required" },
  { id: "custom-permissions", phase: 1, titleFa: "دسترسی سفارشی", titleEn: "Custom permissions", responseFa: "◈ دسترسی سفارشی\n⛂ - کاربر : {{target}}\n⛂ - شناسه : {{target_id}}\n⛂ - سطح دسترسی : قابل تنظیم", responseEn: "◈ Custom permissions\n⛂ - User : {{target}}\n⛂ - ID : {{target_id}}\n⛂ - Access : Configurable" },
  { id: "lock-exceptions", phase: 1, titleFa: "استثناهای قفل", titleEn: "Lock exceptions", responseFa: "◈ استثناهای قفل\n⛂ - کاربر : {{target}}\n⛂ - شناسه : {{target_id}}\n⛂ - وضعیت : آماده", responseEn: "◈ Lock exceptions\n⛂ - User : {{target}}\n⛂ - ID : {{target_id}}\n⛂ - Status : Ready" },
  { id: "reports-search", phase: 1, titleFa: "جستجوی گزارش", titleEn: "Report search", responseFa: "◈ جستجوی گزارش\n⛂ - جستجو با شناسه، یوزرنیم، نام یا بازه زمانی : آماده", responseEn: "◈ Report search\n⛂ - Search by ID, username, name or time range : Ready" },
  { id: "today-stats", phase: 1, titleFa: "آمار امروز", titleEn: "Today statistics", responseFa: "◈ آمار امروز\n⛂ - پیام‌ها : {{messages_today}}\n⛂ - گزارش‌ها : {{today_reports}}\n⛂ - اخطارها : {{warnings_active}}", responseEn: "◈ Today statistics\n⛂ - Messages : {{messages_today}}\n⛂ - Reports : {{today_reports}}\n⛂ - Warnings : {{warnings_active}}" },
  { id: "security-history", phase: 2, titleFa: "تاریخچه امنیتی", titleEn: "Security history", responseFa: "◈ تاریخچه امنیتی\n⛂ - وضعیت : آماده\n⛂ - حملات ثبت‌شده : {{security_reports}}\n⛂ - آخرین هدف : {{target}}", responseEn: "◈ Security history\n⛂ - Status : Ready\n⛂ - Recorded attacks : {{security_reports}}\n⛂ - Last target : {{target}}" },
  { id: "system-history", phase: 2, titleFa: "تاریخچه سیستم", titleEn: "System history", responseFa: "◈ تاریخچه سیستم\n⛂ - وضعیت : آماده\n⛂ - رویدادها : {{audit_count}}\n⛂ - آخرین اپراتور : {{operator}}", responseEn: "◈ System history\n⛂ - Status : Ready\n⛂ - Events : {{audit_count}}\n⛂ - Last operator : {{operator}}" },
  { id: "group-analytics", phase: 2, titleFa: "آمار گروه", titleEn: "Group analytics", responseFa: "◈ آمار گروه\n⛂ - اعضا : {{members_count}}\n⛂ - مدیران : {{admins_count}}\n⛂ - پیام امروز : {{messages_today}}\n⛂ - گزارش امروز : {{today_reports}}", responseEn: "◈ Group analytics\n⛂ - Members : {{members_count}}\n⛂ - Admins : {{admins_count}}\n⛂ - Messages today : {{messages_today}}\n⛂ - Reports today : {{today_reports}}" },
  { id: "system-overview", phase: 2, titleFa: "نمای کلی سیستم", titleEn: "System overview", responseFa: "◈ نمای کلی سیستم\n⛂ - ربات : آنلاین\n⛂ - دیتابیس : متصل\n⛂ - امنیت : فعال\n⛂ - وضعیت گروه : پایدار", responseEn: "◈ System overview\n⛂ - Bot : Online\n⛂ - Database : Connected\n⛂ - Security : Active\n⛂ - Group : Stable" },
];

const en: Record<string, string> = {
  robot: "{{robot_line}}",
  id: "◈ User information\n\n⛂ - Name : {{user_name}}\n⛂ - ID : {{user_id}}\n⛂ - Username : {{username}}\n⛂ - Rank : {{rank}}\n\n─────━━───── ◈ ─────━━─────\n\n⛂ - Messages today : {{messages_today}}\n⛂ - Joins today : —\n⛂ - Total messages : {{messages_total}}\n⛂ - Total joins : —",
  admin: "{{admin_result}}",
  info: "◈ Group information\n\n⛂ - Group name : {{chat_title}}\n⛂ - Group ID : {{chat_id}}\n⛂ - Group username : {{chat_username}}\n⛂ - Group type : {{chat_type}}\n⛂ - Members : {{members_count}}\n⛂ - Admins : {{admins_count}}\n⛂ - Owner : —\n\n─────━━───── ◈ ─────━━─────\n\n⛂ - Messages today : {{messages_today}}\n⛂ - New members today : —\n⛂ - Total messages : {{messages_total}}\n⛂ - Current members : {{members_count}}\n⛂ - Muted users : —\n⛂ - Special users : —\n⛂ - Active warnings : —\n\n★ - Group creation date : —\n★ - Invite link : —\n★ - Invite status : —",
  rank: "{{rank_card}}",
  me: "{{me_card}}",
  ping: "{{ping_card}}",
  bot: "{{bot_card}}",
  status: "{{status_card}}",
  "advertising-lock": "{{live_card}}",
};

export { responseTemplates };

export const STUDIO_DEFAULTS: StudioDocument = {
  version: "4.0.0",
  updatedAt: new Date(0).toISOString(),
  activePhase: 2,
  settings: { botName: "نظم", defaultLang: "fa", bareCommands: true, compactReplies: false },
  capabilities,
  responseTemplates: responseTemplates.filter((x) => !["me", "bot", "status"].includes(x.id)).map((x) => ({ ...x, phase: ["start", "help", "ping", "id", "info", "lang", "staff", "settings"].includes(x.id) ? 1 : 2 })),
  commands: COMMANDS.map((c) => ({
    id: c.id,
    capabilityId: "phase-" + c.phase,
    phase: c.phase,
    aliasesFa: c.aliasesFa,
    aliasesEn: c.aliasesEn,
    minRank: c.minRank,
    enabled: true,
    responseFa: fa[c.id] ?? "",
    responseEn: en[c.id] ?? "",
  })),
};

export function cloneStudioDefaults() {
  return structuredClone(STUDIO_DEFAULTS);
}
