import { COMMANDS, type Rank } from "./registry.ts";

export type StudioPhaseId = 1 | 2;
export type StudioRank = Rank;
export type StudioCapability = { id: string; phase: StudioPhaseId; titleFa: string; titleEn: string; descriptionFa: string; descriptionEn: string; enabled: boolean };
export type StudioCommand = { id: string; capabilityId: string; phase: StudioPhaseId; aliasesFa: string[]; aliasesEn: string[]; minRank: StudioRank; enabled: boolean; responseFa: string; responseEn: string };
export type StudioDocument = { version: string; updatedAt: string; activePhase: StudioPhaseId; settings: { botName: string; defaultLang: "fa" | "en"; bareCommands: boolean; compactReplies: boolean }; capabilities: StudioCapability[]; commands: StudioCommand[] };

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
};

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
};

export const STUDIO_DEFAULTS: StudioDocument = {
  version: "4.0.0",
  updatedAt: new Date(0).toISOString(),
  activePhase: 2,
  settings: { botName: "نظم", defaultLang: "fa", bareCommands: true, compactReplies: false },
  capabilities,
  commands: COMMANDS.map((c) => ({
    id: c.id,
    capabilityId: "phase-" + c.phase,
    phase: c.phase,
    aliasesFa: c.aliasesFa,
    aliasesEn: c.aliasesEn,
    minRank: c.minRank,
    enabled: true,
    responseFa: fa[c.id] ?? "✓ دستور اجرا شد.",
    responseEn: en[c.id] ?? "✓ Command executed.",
  })),
};

export function cloneStudioDefaults() {
  return structuredClone(STUDIO_DEFAULTS);
}
