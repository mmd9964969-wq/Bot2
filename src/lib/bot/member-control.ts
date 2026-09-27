import type { Pool } from "pg";
import type { BotContext } from "./engine.ts";
import { telegramApi } from "../telegram/api.ts";
import { glassKeyboard } from "./panel-design.ts";
import { runModerationCommand } from "./moderation.ts";
import { ensureSpecialUsersSchema, sweepSpecialUsers } from "./special-users.ts";
import { bindPanelMessage, touchPanelMessage } from "./panel-session.ts";

type TgUser = { id: number; first_name?: string; username?: string };
type TgMessage = { message_id: number; chat: { id: number; type: string; title?: string }; from?: TgUser; text?: string; caption?: string; reply_to_message?: { from?: TgUser } };
type TgCallback = { id: string; from: TgUser; message?: TgMessage; data?: string };

type MemberSession = {
  flow: "warning_reason" | "mute_custom" | "ban_custom" | "special_custom" | "note_add" | "admin_title";
  groupId: number;
  targetId: number;
  actorId: number;
  expires: number;
};

const sessions = new Map<number, MemberSession>();
const TTL = 10 * 60 * 1000;

const ALL_PERMISSIONS = {
  can_send_messages: true,
  can_send_audios: true,
  can_send_documents: true,
  can_send_photos: true,
  can_send_videos: true,
  can_send_video_notes: true,
  can_send_voice_notes: true,
  can_send_polls: true,
  can_send_other_messages: true,
  can_add_web_page_previews: true,
};

const MUTED_PERMISSIONS = {
  can_send_messages: false,
  can_send_audios: false,
  can_send_documents: false,
  can_send_photos: false,
  can_send_videos: false,
  can_send_video_notes: false,
  can_send_voice_notes: false,
  can_send_polls: false,
  can_send_other_messages: false,
  can_add_web_page_previews: false,
};

const ADMIN_PERMISSION_LABELS: Record<string, string> = {
  can_delete_messages: "حذف پیام‌ها",
  can_restrict_members: "محدودیت / بن",
  can_invite_users: "دعوت کاربران",
  can_pin_messages: "پین پیام",
  can_manage_topics: "مدیریت Topics",
  can_change_info: "تغییر اطلاعات گروه",
  can_manage_video_chats: "مدیریت تماس‌ها",
  can_manage_tags: "مدیریت برچسب اعضا",
};

const ADMIN_PERMISSION_KEYS = Object.keys(ADMIN_PERMISSION_LABELS);

function kbd(rows: string[][][]) {
  return glassKeyboard(rows);
}

function panel(title: string, body: string) {
  return `◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · ${title}\n\n${body}`;
}

function value(value: unknown, fallback = "—") {
  const s = String(value ?? "").trim();
  return s || fallback;
}

function roleLabel(status: string) {
  if (status === "creator") return "مالک";
  if (status === "administrator") return "مدیر";
  if (status === "restricted") return "محدود";
  if (status === "left") return "خارج‌شده";
  if (status === "kicked") return "بن‌شده";
  return "عضو";
}

function durationLabel(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  if (s % 604800 === 0 && s) return Math.floor(s / 604800) + " هفته";
  if (s % 86400 === 0 && s) return Math.floor(s / 86400) + " روز";
  if (s % 3600 === 0 && s) return Math.floor(s / 3600) + " ساعت";
  if (s % 60 === 0 && s) return Math.floor(s / 60) + " دقیقه";
  return s + " ثانیه";
}

function parseDuration(raw: string): number | null {
  const t = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (/^(دائمی|همیشگی|permanent|forever|بدونانقضا|unlimited)$/.test(t)) return 0;
  const m = t.match(/^(\d+)(ثانیه|second|seconds|s|دقیقه|minute|minutes|min|m|ساعت|hour|hours|hr|h|روز|day|days|d|هفته|week|weeks|w)$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  const u = m[2];
  const factor =
    ["ثانیه", "second", "seconds", "s"].includes(u) ? 1 :
    ["دقیقه", "minute", "minutes", "min", "m"].includes(u) ? 60 :
    ["ساعت", "hour", "hours", "hr", "h"].includes(u) ? 3600 :
    ["روز", "day", "days", "d"].includes(u) ? 86400 : 604800;
  return n * factor;
}

function remaining(expiresAt: unknown) {
  if (!expiresAt) return null;
  const ms = new Date(String(expiresAt)).getTime() - Date.now();
  return ms <= 0 ? 0 : Math.floor(ms / 1000);
}

async function ensureSchema(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS member_control_notes (
      id BIGSERIAL PRIMARY KEY,
      group_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      actor_id BIGINT NOT NULL,
      note TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_member_control_notes_target ON member_control_notes(group_id,user_id,created_at DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS member_control_exceptions (
      group_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      exception_key TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      actor_id BIGINT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(group_id,user_id,exception_key)
    )
  `);
  await ensureSpecialUsersSchema(pool).catch(() => {});
}

function setSession(userId: number, session: Omit<MemberSession, "expires">) {
  sessions.set(userId, { ...session, expires: Date.now() + TTL });
}

function getSession(userId: number) {
  const s = sessions.get(userId);
  if (!s) return null;
  if (s.expires <= Date.now()) {
    sessions.delete(userId);
    return null;
  }
  return s;
}

function clearSession(userId: number) {
  sessions.delete(userId);
}

async function authorized(pool: Pool, groupId: number, actorId: number, ownerIds: string[]) {
  if (ownerIds.includes(String(actorId))) return true;
  const member = await telegramApi<any>("getChatMember", { chat_id: groupId, user_id: actorId });
  return !!(member.ok && ["administrator", "creator"].includes(String(member.result?.status ?? "")));
}

async function target(pool: Pool, groupId: number, targetId: number) {
  const r = await telegramApi<any>("getChatMember", { chat_id: groupId, user_id: targetId });
  if (!r.ok || !r.result) return { ok: false, error: r.description || "کاربر در گروه پیدا نشد." } as const;
  const member = r.result;
  const status = String(member.status ?? "");
  const user = member.user ?? {};
  const name = user.username ? "@" + user.username : value(user.first_name, String(targetId));
  return { ok: true, member, status, user, name } as const;
}

async function warningCount(pool: Pool, groupId: number, userId: number) {
  const r = await pool.query(
    "SELECT COUNT(*)::int AS n FROM warning_events WHERE group_id=$1 AND user_id=$2 AND action_type='warning' AND status='active'",
    [String(groupId), String(userId)],
  ).catch(() => ({ rows: [{ n: 0 }] }));
  return Number(r.rows[0]?.n ?? 0);
}

async function specialRow(pool: Pool, groupId: number, userId: number) {
  await sweepSpecialUsers(pool).catch(() => {});
  const r = await pool.query(
    "SELECT * FROM special_users WHERE group_id=$1 AND user_id=$2 ORDER BY id DESC LIMIT 1",
    [groupId, userId],
  ).catch(() => ({ rows: [] as any[] }));
  const row = r.rows[0];
  const active = !!row && row.status === "active" && (!row.expires_at || new Date(row.expires_at).getTime() > Date.now());
  return { row, active };
}

async function sendPanel(pool: Pool, chatId: number, actorId: number, text: string, rows: string[][][]) {
  const r = await telegramApi("sendMessage", { chat_id: chatId, text, reply_markup: kbd(rows) });
  if (r.ok) {
    const id = Number((r.result as any)?.message_id);
    if (Number.isSafeInteger(id) && id > 0) {
      await bindPanelMessage(pool, chatId, id, actorId, "panel").catch(() => {});
    }
  }
  return r;
}

async function editPanel(pool: Pool, cb: TgCallback, text: string, rows: string[][][]) {
  const r = await telegramApi("editMessageText", {
    chat_id: cb.message!.chat.id,
    message_id: cb.message!.message_id,
    text,
    reply_markup: kbd(rows),
  });
  if (r.ok) await touchPanelMessage(pool, cb.message!.chat.id, cb.message!.message_id, cb.from.id).catch(() => {});
  return r;
}

async function renderMain(pool: Pool, chatId: number, actorId: number, targetId: number, edit?: TgCallback) {
  await ensureSchema(pool);
  const t = await target(pool, chatId, targetId);
  if (!t.ok) {
    const text = panel("Mᴇᴍʙᴇʀ Cᴏɴᴛʀᴏʟ", "✗ " + t.error);
    if (edit?.message) return editPanel(pool, edit, text, [[["‹ بازگشت", "c:members"]]]);
    return sendPanel(pool, chatId, actorId, text, [[["‹ بازگشت", "c:members"]]]);
  }
  const warnings = await warningCount(pool, chatId, targetId);
  const special = await specialRow(pool, chatId, targetId);
  const muted = t.status === "restricted" && t.member.permissions && t.member.permissions.can_send_messages === false;
  const banned = t.status === "kicked";
  const name = t.name;
  const first = t.status === "creator" ? "› مالک گروه" : t.status === "administrator" ? "› مدیریت ادمین" : "› افزودن ادمین";
  const body = [
    "⛂ - نام : " + name,
    "⛂ - @username : " + (t.user.username ? "@" + t.user.username : "—"),
    "⛂ - شناسه : " + targetId,
    "",
    "⛂ - نقش : " + roleLabel(t.status),
    "⛂ - وضعیت : ● فعال",
    "⛂ - ویژه : " + (special.active ? "● فعال" : "○ غیرفعال"),
    "⛂ - اخطار : " + warnings,
    "⛂ - سکوت : " + (muted ? "● فعال" : "○ خاموش"),
    "⛂ - بن : " + (banned ? "● فعال" : "○ خاموش"),
    "",
    "─────━━───── ◈ ─────━━─────",
    "",
  ].join("\n");
  const rows: string[][][] = [
    [[first, t.status === "creator" ? `mc:protected:${targetId}` : t.status === "administrator" ? `mc:admin:${targetId}` : `mc:addadmin:${targetId}`]],
    [["› مدیریت مجازات", `mc:punish:${targetId}`], ["› مدیریت ویژه", `mc:special:${targetId}`]],
    [["› نقش و دسترسی", `mc:roles:${targetId}`], ["› محدودیت‌های عضو", `mc:restrict:${targetId}`]],
    [["› امنیت عضو", `mc:security:${targetId}`], ["› پروفایل و اطلاعات", `mc:profile:${targetId}`]],
    [["› سوابق و رویدادها", `mc:history:${targetId}:0`], ["› پرونده و یادداشت", `mc:file:${targetId}`]],
    [["› استثناهای سیستم", `mc:exceptions:${targetId}`], ["› ابزارهای عضو", `mc:tools:${targetId}`]],
    [["› وضعیت فعلی", `mc:status:${targetId}`], ["› اقدامات سریع", `mc:quick:${targetId}`]],
    [["‹ بازگشت", "c:members"]],
  ];
  const text = panel("Mᴇᴍʙᴇʀ Cᴏɴᴛʀᴏʟ", body);
  if (edit?.message) return editPanel(pool, edit, text, rows);
  return sendPanel(pool, chatId, actorId, text, rows);
}

async function renderPunish(pool: Pool, cb: TgCallback, targetId: number) {
  const t = await target(pool, cb.message!.chat.id, targetId);
  if (!t.ok) return editPanel(pool, cb, panel("Pᴇɴᴀʟᴛʏ Cᴇɴᴛᴇʀ", "✗ " + t.error), [[["‹ بازگشت", `mc:center:${targetId}`]]]);
  const warnings = await warningCount(pool, cb.message!.chat.id, targetId);
  const muted = t.status === "restricted" && t.member.permissions?.can_send_messages === false;
  const banned = t.status === "kicked";
  return editPanel(pool, cb, panel("Pᴇɴᴀʟᴛʏ Cᴇɴᴛᴇʀ", [
    "⛂ - کاربر : " + t.name,
    "⛂ - شناسه : " + targetId,
    "⛂ - نقش : " + roleLabel(t.status),
    "⛂ - اخطار : " + warnings,
    "⛂ - سکوت : " + (muted ? "● فعال" : "○ خاموش"),
    "⛂ - بن : " + (banned ? "● فعال" : "○ خاموش"),
    "",
    "─────━━───── ◈ ─────━━─────",
    "",
    "⛂ - این مرکز برای همین عضو است؛ انتخاب هر نوع مجازات وارد پنل تخصصی خودش می‌شود.",
  ].join("\n")), [
    [["› اخطار", `mc:warn:${targetId}`], ["› سکوت", `mc:mute:${targetId}`]],
    [["› بن", `mc:ban:${targetId}`], ["› کیک", `mc:kick:${targetId}`]],
    [["› وضعیت مجازات", `mc:status:${targetId}`], ["› تاریخچه مجازات", `mc:history:${targetId}:0`]],
    [["‹ بازگشت", `mc:center:${targetId}`]],
  ]);
}

async function warningPanel(pool: Pool, cb: TgCallback, targetId: number) {
  const groupId = cb.message!.chat.id;
  const t = await target(pool, groupId, targetId);
  if (!t.ok) return editPanel(pool, cb, panel("Wᴀʀɴɪɴɢ Cᴇɴᴛᴇʀ", "✗ " + t.error), [[["‹ بازگشت", `mc:punish:${targetId}`]]]);
  const count = await warningCount(pool, groupId, targetId);
  const setting = await pool.query("SELECT permanent_threshold FROM warning_system_settings WHERE group_id=$1 LIMIT 1", [String(groupId)]).catch(() => ({ rows: [] as any[] }));
  const threshold = Number(setting.rows[0]?.permanent_threshold ?? 5);
  return editPanel(pool, cb, panel("Wᴀʀɴɪɴɢ Cᴇɴᴛᴇʀ", [
    "⛂ - کاربر : " + t.name,
    "⛂ - شناسه : " + targetId,
    "⛂ - اخطار فعال : " + count,
    "⛂ - آستانه ثبت‌شده : " + threshold,
    "⛂ - وضعیت : " + (count ? "● تحت اخطار" : "○ بدون اخطار فعال"),
    "",
    "─────━━───── ◈ ─────━━─────",
    "",
    "⛂ - هر اخطار از موتور رسمی سیستم اخطار عبور می‌کند.",
  ].join("\n")), [
    [["› اخطار +۱", `mc:warn_issue:${targetId}`], ["› اخطار با دلیل", `mc:warn_reason:${targetId}`]],
    [["› کاهش یک اخطار", `mc:warn_reduce:${targetId}`], ["› پاک‌سازی اخطار", `mc:warn_clear:${targetId}`]],
    [["› تاریخچه اخطار", `mc:warn_history:${targetId}:0`], ["› بروزرسانی", `mc:warn:${targetId}`]],
    [["‹ بازگشت", `mc:punish:${targetId}`]],
  ]);
}

async function mutePanel(pool: Pool, cb: TgCallback, targetId: number) {
  const t = await target(pool, cb.message!.chat.id, targetId);
  if (!t.ok) return editPanel(pool, cb, panel("Mᴜᴛᴇ Cᴇɴᴛᴇʀ", "✗ " + t.error), [[["‹ بازگشت", `mc:punish:${targetId}`]]]);
  const restricted = t.status === "restricted" && t.member.permissions?.can_send_messages === false;
  return editPanel(pool, cb, panel("Mᴜᴛᴇ Cᴇɴᴛᴇʀ", [
    "⛂ - کاربر : " + t.name,
    "⛂ - شناسه : " + targetId,
    "⛂ - وضعیت : " + (restricted ? "● سکوت فعال" : "○ بدون سکوت"),
    "⛂ - مدت انتخابی : —",
    "",
    "─────━━───── ◈ ─────━━─────",
    "",
    "⛂ - محدودیت سکوت روی پیام، رسانه، نظرسنجی و سایر پیام‌های قابل‌ارسال اعمال می‌شود.",
  ].join("\n")), [
    [["› ۱ ساعت", `mc:mute_apply:${targetId}:3600`], ["› ۶ ساعت", `mc:mute_apply:${targetId}:21600`]],
    [["› ۱۲ ساعت", `mc:mute_apply:${targetId}:43200`], ["› ۱ روز", `mc:mute_apply:${targetId}:86400`]],
    [["› مدت سفارشی", `mc:mute_custom:${targetId}`], ["› سکوت دائمی", `mc:mute_apply:${targetId}:0`]],
    [["› رفع سکوت", `mc:unmute:${targetId}`]],
    [["‹ بازگشت", `mc:punish:${targetId}`]],
  ]);
}

async function banPanel(pool: Pool, cb: TgCallback, targetId: number) {
  const t = await target(pool, cb.message!.chat.id, targetId);
  if (!t.ok) return editPanel(pool, cb, panel("Bᴀɴ Cᴇɴᴛᴇʀ", "✗ " + t.error), [[["‹ بازگشت", `mc:punish:${targetId}`]]]);
  const banned = t.status === "kicked";
  return editPanel(pool, cb, panel("Bᴀɴ Cᴇɴᴛᴇʀ", [
    "⛂ - کاربر : " + t.name,
    "⛂ - شناسه : " + targetId,
    "⛂ - وضعیت : " + (banned ? "● بن فعال" : "○ بدون بن"),
    "⛂ - نوع اقدام : —",
    "",
    "─────━━───── ◈ ─────━━─────",
    "",
    "⛂ - بن موقت با تاریخ پایان یا بن دائمی قابل انتخاب است.",
  ].join("\n")), [
    [["› بن ۱ روزه", `mc:ban_apply:${targetId}:86400`], ["› بن ۷ روزه", `mc:ban_apply:${targetId}:604800`]],
    [["› بن موقت سفارشی", `mc:ban_custom:${targetId}`], ["› بن دائمی", `mc:ban_apply:${targetId}:0`]],
    [["› حذف بن", `mc:unban:${targetId}`], ["› سوابق بن", `mc:history:${targetId}:0`]],
    [["‹ بازگشت", `mc:punish:${targetId}`]],
  ]);
}

async function kickPanel(pool: Pool, cb: TgCallback, targetId: number) {
  const t = await target(pool, cb.message!.chat.id, targetId);
  if (!t.ok) return editPanel(pool, cb, panel("Kɪᴄᴋ Cᴇɴᴛᴇʀ", "✗ " + t.error), [[["‹ بازگشت", `mc:punish:${targetId}`]]]);
  return editPanel(pool, cb, panel("Kɪᴄᴋ Cᴇɴᴛᴇʀ", [
    "⛂ - کاربر : " + t.name,
    "⛂ - شناسه : " + targetId,
    "⛂ - نقش : " + roleLabel(t.status),
    "",
    "─────━━───── ◈ ─────━━─────",
    "",
    "⛂ - کیک کاربر را از گروه خارج می‌کند و برای جلوگیری از اجرای اشتباه نیازمند تأیید است.",
  ].join("\n")), [
    [["› تأیید کیک", `mc:kick_yes:${targetId}`]],
    [["‹ بازگشت", `mc:punish:${targetId}`]],
  ]);
}

async function renderAdmin(pool: Pool, cb: TgCallback, targetId: number) {
  const groupId = cb.message!.chat.id;
  const t = await target(pool, groupId, targetId);
  if (!t.ok) return editPanel(pool, cb, panel("Aᴅᴍɪɴ Cᴇɴᴛᴇʀ", "✗ " + t.error), [[["‹ بازگشت", `mc:center:${targetId}`]]]);
  if (t.status !== "administrator") {
    return editPanel(pool, cb, panel("Aᴅᴅ Aᴅᴍɪɴ", [
      "⛂ - کاربر : " + t.name,
      "⛂ - شناسه : " + targetId,
      "⛂ - نقش فعلی : " + roleLabel(t.status),
      "",
      "⛂ - ادمین جدید با مجموعه‌ای محدود از دسترسی‌های مدیریتی اضافه می‌شود.",
      "⛂ - بعد از افزودن، دسترسی‌ها از همین پنل قابل ویرایش است.",
    ].join("\n")), [
      [["› تأیید افزودن ادمین", `mc:addadmin_yes:${targetId}`]],
      [["‹ بازگشت", `mc:center:${targetId}`]],
    ]);
  }
  const canEdit = t.member.can_be_edited !== false;
  const rights = ADMIN_PERMISSION_KEYS.map((key) => {
    const active = !!t.member[key];
    return [[`› ${active ? "●" : "○"} ${ADMIN_PERMISSION_LABELS[key]}`, `mc:right:${targetId}:${key}`]];
  });
  const rows: string[][][] = [
    [["› اطلاعات ادمین", `mc:admininfo:${targetId}`]],
    ...rights,
    [["› عنوان سفارشی", `mc:admintitle:${targetId}`]],
    [["› حذف مقام ادمین", `mc:demote:${targetId}`]],
    [["‹ بازگشت", `mc:center:${targetId}`]],
  ];
  return editPanel(pool, cb, panel("Aᴅᴍɪɴ Cᴇɴᴛᴇʀ", [
    "⛂ - کاربر : " + t.name,
    "⛂ - شناسه : " + targetId,
    "⛂ - وضعیت : ● مدیر",
    "⛂ - قابلیت ویرایش : " + (canEdit ? "● بله" : "○ خیر"),
    "⛂ - عنوان فعلی : " + value(t.member.custom_title),
    "",
    "─────━━───── ◈ ─────━━─────",
    "",
    "⛂ - برای تغییر هر دسترسی، وضعیت فعلی دوباره از Telegram خوانده می‌شود.",
  ].join("\n")), rows);
}

async function adminInfo(pool: Pool, cb: TgCallback, targetId: number) {
  const t = await target(pool, cb.message!.chat.id, targetId);
  if (!t.ok) return editPanel(pool, cb, panel("Aᴅᴍɪɴ Iɴғᴏ", "✗ " + t.error), [[["‹ بازگشت", `mc:admin:${targetId}`]]]);
  const lines = [
    "⛂ - کاربر : " + t.name,
    "⛂ - شناسه : " + targetId,
    "⛂ - عنوان : " + value(t.member.custom_title),
    "⛂ - قابل ویرایش توسط ربات : " + (t.member.can_be_edited !== false ? "● بله" : "○ خیر"),
    "",
  ];
  for (const key of ADMIN_PERMISSION_KEYS) lines.push("⛂ - " + ADMIN_PERMISSION_LABELS[key] + " : " + (t.member[key] ? "● فعال" : "○ خاموش"));
  return editPanel(pool, cb, panel("Aᴅᴍɪɴ Iɴғᴏ", lines.join("\n")), [[["‹ بازگشت", `mc:admin:${targetId}`]]]);
}

function adminRightsFrom(member: any) {
  return {
    is_anonymous: !!member.is_anonymous,
    can_manage_chat: !!member.can_manage_chat,
    can_delete_messages: !!member.can_delete_messages,
    can_manage_video_chats: !!member.can_manage_video_chats,
    can_restrict_members: !!member.can_restrict_members,
    can_promote_members: !!member.can_promote_members,
    can_change_info: !!member.can_change_info,
    can_invite_users: !!member.can_invite_users,
    can_post_stories: !!member.can_post_stories,
    can_edit_stories: !!member.can_edit_stories,
    can_delete_stories: !!member.can_delete_stories,
    can_pin_messages: !!member.can_pin_messages,
    can_manage_topics: !!member.can_manage_topics,
    can_manage_direct_messages: !!member.can_manage_direct_messages,
    can_manage_tags: !!member.can_manage_tags,
    can_send_welcome_messages: !!member.can_send_welcome_messages,
  };
}

async function rolesPanel(pool: Pool, cb: TgCallback, targetId: number) {
  const t = await target(pool, cb.message!.chat.id, targetId);
  if (!t.ok) return editPanel(pool, cb, panel("Rᴏʟᴇ & Pᴇʀᴍɪssɪᴏɴ", "✗ " + t.error), [[["‹ بازگشت", `mc:center:${targetId}`]]]);
  const body = [
    "⛂ - نقش فعلی : " + roleLabel(t.status),
    "⛂ - شناسه : " + targetId,
    "",
    "⛂ - این بخش فقط دسترسی‌های Telegram را نمایش می‌دهد؛ رتبه داخلی جداگانه‌ای به کاربر تحمیل نمی‌شود.",
  ].join("\n");
  if (t.status === "administrator") {
    return editPanel(pool, cb, panel("Rᴏʟᴇ & Pᴇʀᴍɪssɪᴏɴ", body), [
      [["› مدیریت ادمین", `mc:admin:${targetId}`]],
      [["‹ بازگشت", `mc:center:${targetId}`]],
    ]);
  }
  return editPanel(pool, cb, panel("Rᴏʟᴇ & Pᴇʀᴍɪssɪᴏɴ", body), [
    [["› افزودن ادمین", `mc:addadmin:${targetId}`]],
    [["‹ بازگشت", `mc:center:${targetId}`]],
  ]);
}

async function restrictionsPanel(pool: Pool, cb: TgCallback, targetId: number) {
  const t = await target(pool, cb.message!.chat.id, targetId);
  if (!t.ok) return editPanel(pool, cb, panel("Rᴇsᴛʀɪᴄᴛɪᴏɴ Cᴇɴᴛᴇʀ", "✗ " + t.error), [[["‹ بازگشت", `mc:center:${targetId}`]]]);
  const restricted = t.status === "restricted";
  return editPanel(pool, cb, panel("Rᴇsᴛʀɪᴄᴛɪᴏɴ Cᴇɴᴛᴇʀ", [
    "⛂ - کاربر : " + t.name,
    "⛂ - وضعیت : " + (restricted ? "● محدودیت فعال" : "○ بدون محدودیت"),
    "⛂ - وضعیت متن : " + (t.member.permissions?.can_send_messages === false ? "○ خاموش" : "● مجاز"),
    "⛂ - رسانه : " + (t.member.permissions?.can_send_photos === false ? "○ خاموش" : "● مجاز"),
    "⛂ - نظرسنجی : " + (t.member.permissions?.can_send_polls === false ? "○ خاموش" : "● مجاز"),
    "⛂ - استیکر/GIF/بازی : " + (t.member.permissions?.can_send_other_messages === false ? "○ خاموش" : "● مجاز"),
    "⛂ - پیش‌نمایش لینک : " + (t.member.permissions?.can_add_web_page_previews === false ? "○ خاموش" : "● مجاز"),
    "",
    "⛂ - محدودیت‌ها با ChatPermissions واقعی Telegram اعمال می‌شوند.",
  ].join("\n")), [
    [["› محدودیت متن", `mc:restrict_apply:${targetId}:text`], ["› محدودیت رسانه", `mc:restrict_apply:${targetId}:media`]],
    [["› محدودیت استیکر/GIF", `mc:restrict_apply:${targetId}:other`], ["› محدودیت نظرسنجی", `mc:restrict_apply:${targetId}:polls`]],
    [["› محدودیت پیش‌نمایش لینک", `mc:restrict_apply:${targetId}:preview`]],
    [["› رفع تمام محدودیت‌ها", `mc:restrict_clear:${targetId}`]],
    [["‹ بازگشت", `mc:center:${targetId}`]],
  ]);
}

function permissionPreset(preset: string) {
  const p = { ...ALL_PERMISSIONS };
  if (preset === "text") p.can_send_messages = false;
  if (preset === "media") {
    p.can_send_audios = false;
    p.can_send_documents = false;
    p.can_send_photos = false;
    p.can_send_videos = false;
    p.can_send_video_notes = false;
    p.can_send_voice_notes = false;
  }
  if (preset === "other") p.can_send_other_messages = false;
  if (preset === "polls") p.can_send_polls = false;
  if (preset === "preview") p.can_add_web_page_previews = false;
  return p;
}

async function applyRestriction(pool: Pool, cb: TgCallback, targetId: number, preset: string) {
  const t = await target(pool, cb.message!.chat.id, targetId);
  if (!t.ok) return editPanel(pool, cb, panel("Rᴇsᴛʀɪᴄᴛɪᴏɴ", "✗ " + t.error), [[["‹ بازگشت", `mc:restrict:${targetId}`]]]);
  if (["administrator", "creator"].includes(t.status)) {
    return editPanel(pool, cb, panel("Rᴇsᴛʀɪᴄᴛɪᴏɴ", "✗ کاربر مدیر/مالک است و محدودیت عضو روی او اجرا نمی‌شود."), [[["‹ بازگشت", `mc:restrict:${targetId}`]]]);
  }
  const r = await telegramApi("restrictChatMember", {
    chat_id: cb.message!.chat.id,
    user_id: targetId,
    permissions: permissionPreset(preset),
    use_independent_chat_permissions: true,
  });
  await pool.query(
    "INSERT INTO moderation_actions(group_id,actor_id,target_id,action_type,duration_seconds,reason,status) VALUES($1,$2,$3,$4,NULL,$5,$6)",
    [cb.message!.chat.id, cb.from.id, targetId, "restrict", "محدودیت عضو: " + preset, r.ok ? "success" : "failed"],
  ).catch(() => {});
  return r.ok
    ? restrictionsPanel(pool, cb, targetId)
    : editPanel(pool, cb, panel("Rᴇsᴛʀɪᴄᴛɪᴏɴ", "✗ عملیات ناموفق بود: " + value(r.description, "Telegram error")), [[["‹ بازگشت", `mc:restrict:${targetId}`]]]);
}

async function clearRestrictions(pool: Pool, cb: TgCallback, targetId: number) {
  const r = await telegramApi("restrictChatMember", {
    chat_id: cb.message!.chat.id,
    user_id: targetId,
    permissions: ALL_PERMISSIONS,
    use_independent_chat_permissions: true,
  });
  await pool.query(
    "INSERT INTO moderation_actions(group_id,actor_id,target_id,action_type,duration_seconds,reason,status) VALUES($1,$2,$3,'unmute',NULL,'رفع تمام محدودیت‌ها از پنل عضو',$4)",
    [cb.message!.chat.id, cb.from.id, targetId, r.ok ? "success" : "failed"],
  ).catch(() => {});
  return r.ok
    ? restrictionsPanel(pool, cb, targetId)
    : editPanel(pool, cb, panel("Rᴇsᴛʀɪᴄᴛɪᴏɴ", "✗ عملیات ناموفق بود: " + value(r.description, "Telegram error")), [[["‹ بازگشت", `mc:restrict:${targetId}`]]]);
}

async function securityPanel(pool: Pool, cb: TgCallback, targetId: number) {
  const [events, exceptions] = await Promise.all([
    pool.query("SELECT COUNT(*)::int AS n FROM supervision_events WHERE group_id=$1 AND target_id=$2", [cb.message!.chat.id, targetId]).catch(() => ({ rows: [{ n: 0 }] })),
    pool.query("SELECT COUNT(*)::int AS n FROM member_control_exceptions WHERE group_id=$1 AND user_id=$2 AND enabled=TRUE", [cb.message!.chat.id, targetId]).catch(() => ({ rows: [{ n: 0 }] })),
  ]);
  return editPanel(pool, cb, panel("Sᴇᴄᴜʀɪᴛʏ Cᴇɴᴛᴇʀ", [
    "⛂ - کاربر : " + targetId,
    "⛂ - رویدادهای نظارتی ثبت‌شده : " + Number(events.rows[0]?.n ?? 0),
    "⛂ - استثناهای فعال ثبت‌شده : " + Number(exceptions.rows[0]?.n ?? 0),
    "",
    "⛂ - این مرکز «سطح ریسک» ساختگی تولید نمی‌کند؛ فقط داده‌های ثبت‌شده را نمایش می‌دهد.",
  ].join("\n")), [
    [["› رویدادهای نظارتی", `mc:history:${targetId}:0`], ["› استثناهای عضو", `mc:exceptions:${targetId}`]],
    [["› قرنطینه ۱ ساعت", `mc:quarantine:${targetId}:3600`]],
    [["‹ بازگشت", `mc:center:${targetId}`]],
  ]);
}

async function profilePanel(pool: Pool, cb: TgCallback, targetId: number) {
  const t = await target(pool, cb.message!.chat.id, targetId);
  if (!t.ok) return editPanel(pool, cb, panel("Mᴇᴍʙᴇʀ Pʀᴏғɪʟᴇ", "✗ " + t.error), [[["‹ بازگشت", `mc:center:${targetId}`]]]);
  const photos = await telegramApi<any>("getUserProfilePhotos", { user_id: targetId, offset: 0, max: 1 }).catch(() => ({ ok: false, result: null }));
  const special = await specialRow(pool, cb.message!.chat.id, targetId);
  return editPanel(pool, cb, panel("Mᴇᴍʙᴇʀ Pʀᴏғɪʟᴇ", [
    "⛂ - نام : " + value(t.user.first_name),
    "⛂ - نام کاربری : " + (t.user.username ? "@" + t.user.username : "—"),
    "⛂ - شناسه : " + targetId,
    "⛂ - وضعیت عضویت : " + roleLabel(t.status),
    "⛂ - عکس پروفایل : " + (photos.ok ? Number(photos.result?.total_count ?? 0) : 0),
    "⛂ - ویژه : " + (special.active ? "● فعال" : "○ غیرفعال"),
  ].join("\n")), [
    [["› بروزرسانی", `mc:profile:${targetId}`], ["› لینک پروفایل", `mc:link:${targetId}`]],
    [["‹ بازگشت", `mc:center:${targetId}`]],
  ]);
}

async function historyPanel(pool: Pool, cb: TgCallback, targetId: number, page: number) {
  const offset = Math.max(0, page) * 8;
  const rows = await pool.query(
    "SELECT action_type,reason,status,created_at FROM moderation_actions WHERE group_id=$1 AND target_id=$2 ORDER BY created_at DESC LIMIT 8 OFFSET $3",
    [cb.message!.chat.id, targetId, offset],
  ).catch(() => ({ rows: [] as any[] }));
  const notes = await pool.query(
    "SELECT note,actor_id,created_at FROM member_control_notes WHERE group_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 4",
    [cb.message!.chat.id, targetId],
  ).catch(() => ({ rows: [] as any[] }));
  const lines = rows.rows.map((x: any, i: number) => (
    `${String(i + 1).padStart(2, "0")} · ${value(x.action_type)} · ${value(x.status)}\n   └ ${value(x.reason)} · ${new Date(x.created_at).toLocaleString("fa-IR")}`
  ));
  if (notes.rows.length) {
    lines.push("— یادداشت‌های اخیر —");
    for (const n of notes.rows) lines.push("⛂ - یادداشت : " + value(n.note).slice(0, 240));
  }
  const body = [
    "⛂ - کاربر : " + targetId,
    "⛂ - صفحه : " + (Math.max(0, page) + 1),
    "",
    lines.length ? lines.join("\n\n") : "⛂ - سابقه‌ای برای این عضو ثبت نشده است.",
  ].join("\n");
  const nav: string[][] = [];
  if (page > 0) nav.push(["‹ صفحه قبل", `mc:history:${targetId}:${page - 1}`]);
  if (page > 0 && rows.rows.length === 8) nav.push(["صفحه " + (page + 1), `mc:history:${targetId}:${page + 1}`]);
  else if (page === 0 && rows.rows.length === 8) nav.push(["صفحه ۲", `mc:history:${targetId}:1`]);
  const keyboard: string[][][] = [];
  if (nav.length === 2) keyboard.push(nav);
  else if (nav.length === 1) keyboard.push([nav[0]]);
  keyboard.push([["› بروزرسانی", `mc:history:${targetId}:${page}`]]);
  keyboard.push([["‹ بازگشت", `mc:center:${targetId}`]]);
  return editPanel(pool, cb, panel("Mᴇᴍʙᴇʀ Hɪsᴛᴏʀʏ", body), keyboard);
}

async function filePanel(pool: Pool, cb: TgCallback, targetId: number) {
  const notes = await pool.query(
    "SELECT id,note,actor_id,created_at FROM member_control_notes WHERE group_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 8",
    [cb.message!.chat.id, targetId],
  ).catch(() => ({ rows: [] as any[] }));
  return editPanel(pool, cb, panel("Mᴇᴍʙᴇʀ Fɪʟᴇ", [
    "⛂ - شناسه : " + targetId,
    "⛂ - یادداشت‌ها : " + notes.rows.length,
    "",
    notes.rows.length
      ? notes.rows.map((x: any, i: number) => (i + 1) + " · " + value(x.note).slice(0, 260)).join("\n")
      : "⛂ - هنوز یادداشتی ثبت نشده است.",
  ].join("\n")), [
    [["› افزودن یادداشت", `mc:note_add:${targetId}`], ["› پاک‌سازی یادداشت‌ها", `mc:note_clear:${targetId}`]],
    [["› بروزرسانی", `mc:file:${targetId}`]],
    [["‹ بازگشت", `mc:center:${targetId}`]],
  ]);
}

async function exceptionsPanel(pool: Pool, cb: TgCallback, targetId: number) {
  const rows = await pool.query(
    "SELECT exception_key,enabled FROM member_control_exceptions WHERE group_id=$1 AND user_id=$2 ORDER BY exception_key",
    [cb.message!.chat.id, targetId],
  ).catch(() => ({ rows: [] as any[] }));
  const map = new Map(rows.rows.map((x: any) => [String(x.exception_key), !!x.enabled]));
  const keys = [
    ["anti_spam", "Anti-Spam"],
    ["anti_bot", "Anti-Bot"],
    ["anti_link", "Anti-Link"],
    ["media_lock", "Media Lock"],
    ["flood_control", "Flood Control"],
    ["warning_system", "Warning System"],
  ];
  const body = [
    "⛂ - کاربر : " + targetId,
    "⛂ - وضعیت : استثناهای ثبت‌شده برای همین عضو",
    "",
    "⛂ - توجه : این رجیستری داخلی است و فقط در موتورهایی اثر می‌گذارد که آن را مصرف کنند.",
  ].join("\n");
  const buttonRows = keys.map(([key, label]) => [[`› ${map.get(key) ? "●" : "○"} ${label}`, `mc:exception_toggle:${targetId}:${key}`]]);
  buttonRows.push([["‹ بازگشت", `mc:center:${targetId}`]]);
  return editPanel(pool, cb, panel("E xᴄᴇᴘᴛɪᴏɴ Cᴇɴᴛᴇʀ", body), buttonRows as string[][][]);
}

async function toolsPanel(pool: Pool, cb: TgCallback, targetId: number) {
  const t = await target(pool, cb.message!.chat.id, targetId);
  if (!t.ok) return editPanel(pool, cb, panel("Mᴇᴍʙᴇʀ Tᴏᴏʟs", "✗ " + t.error), [[["‹ بازگشت", `mc:center:${targetId}`]]]);
  return editPanel(pool, cb, panel("Mᴇᴍʙᴇʀ Tᴏᴏʟs", [
    "⛂ - کاربر : " + t.name,
    "⛂ - شناسه : " + targetId,
    "",
    "⛂ - ابزارها روی همین عضو اعمال می‌شوند؛ حذف انبوه تاریخچه پیام‌ها ادعا نمی‌شود.",
  ].join("\n")), [
    [["› کپی ID", `mc:id:${targetId}`], ["› لینک پروفایل", `mc:link:${targetId}`]],
    [["› عکس پروفایل", `mc:photo:${targetId}`], ["› بروزرسانی", `mc:tools:${targetId}`]],
    [["‹ بازگشت", `mc:center:${targetId}`]],
  ]);
}

async function statusPanel(pool: Pool, cb: TgCallback, targetId: number) {
  const t = await target(pool, cb.message!.chat.id, targetId);
  if (!t.ok) return editPanel(pool, cb, panel("Mᴇᴍʙᴇʀ Sᴛᴀᴛᴜs", "✗ " + t.error), [[["‹ بازگشت", `mc:center:${targetId}`]]]);
  const warnings = await warningCount(pool, cb.message!.chat.id, targetId);
  const special = await specialRow(pool, cb.message!.chat.id, targetId);
  const muted = t.status === "restricted" && t.member.permissions?.can_send_messages === false;
  const banned = t.status === "kicked";
  const exceptionCount = Number((await pool.query(
    "SELECT COUNT(*)::int AS n FROM member_control_exceptions WHERE group_id=$1 AND user_id=$2 AND enabled=TRUE",
    [cb.message!.chat.id, targetId],
  ).catch(() => ({ rows: [{ n: 0 }] }))).rows[0]?.n ?? 0);
  return editPanel(pool, cb, panel("Mᴇᴍʙᴇʀ Sᴛᴀᴛᴜs", [
    "⛂ - نقش : " + roleLabel(t.status),
    "⛂ - ویژه : " + (special.active ? "● فعال" : "○ خاموش"),
    "⛂ - اخطار : " + warnings,
    "⛂ - سکوت : " + (muted ? "● فعال" : "○ خاموش"),
    "⛂ - بن : " + (banned ? "● فعال" : "○ خاموش"),
    "⛂ - استثنای ثبت‌شده : " + exceptionCount,
  ].join("\n")), [
    [["› بروزرسانی", `mc:status:${targetId}`], ["› پروفایل", `mc:profile:${targetId}`]],
    [["‹ بازگشت", `mc:center:${targetId}`]],
  ]);
}

async function specialPanel(pool: Pool, cb: TgCallback, targetId: number) {
  const groupId = cb.message!.chat.id;
  const t = await target(pool, groupId, targetId);
  if (!t.ok) return editPanel(pool, cb, panel("Sᴘᴇᴄɪᴀʟ Cᴇɴᴛᴇʀ", "✗ " + t.error), [[["‹ بازگشت", `mc:center:${targetId}`]]]);
  const s = await specialRow(pool, groupId, targetId);
  const expires = s.active && s.row?.expires_at ? remaining(s.row.expires_at) : null;
  return editPanel(pool, cb, panel("Sᴘᴇᴄɪᴀʟ Cᴇɴᴛᴇʀ", [
    "⛂ - کاربر : " + t.name,
    "⛂ - شناسه : " + targetId,
    "⛂ - وضعیت ویژه : " + (s.active ? "● فعال" : "○ غیرفعال"),
    "⛂ - مدت باقی‌مانده : " + (s.active ? (expires === null ? "بدون انقضا" : durationLabel(expires)) : "—"),
  ].join("\n")), [
    [["› ۱ ساعت", `mc:special_set:${targetId}:3600`], ["› ۳ ساعت", `mc:special_set:${targetId}:10800`]],
    [["› ۶ ساعت", `mc:special_set:${targetId}:21600`], ["› ۱۲ ساعت", `mc:special_set:${targetId}:43200`]],
    [["› ۱ روز", `mc:special_set:${targetId}:86400`], ["› ۷ روز", `mc:special_set:${targetId}:604800`]],
    [["› ۳۰ روز", `mc:special_set:${targetId}:2592000`], ["› بدون انقضا", `mc:special_set:${targetId}:0`]],
    [["› افزایش +۱ ساعت", `mc:special_ext:${targetId}:3600`], ["› کاهش ۱ ساعت", `mc:special_red:${targetId}:3600`]],
    [["› مدت سفارشی", `mc:special_custom:${targetId}`], ["› حذف ویژه", `mc:special_remove:${targetId}`]],
    [["› سابقه ویژه", `mc:special_history:${targetId}`]],
    [["‹ بازگشت", `mc:center:${targetId}`]],
  ]);
}

async function specialApply(pool: Pool, cb: TgCallback, targetId: number, seconds: number, mode: "set" | "extend" | "reduce") {
  const groupId = cb.message!.chat.id;
  const t = await target(pool, groupId, targetId);
  if (!t.ok) return editPanel(pool, cb, panel("Sᴘᴇᴄɪᴀʟ Cᴇɴᴛᴇʀ", "✗ " + t.error), [[["‹ بازگشت", `mc:center:${targetId}`]]]);
  const cur = await specialRow(pool, groupId, targetId);
  const previous = cur.row?.expires_at ?? null;
  const now = Date.now();
  let next: Date | null = null;
  if (mode === "set") next = seconds === 0 ? null : new Date(now + seconds * 1000);
  if (mode === "extend") next = previous && new Date(String(previous)).getTime() > now ? new Date(new Date(String(previous)).getTime() + seconds * 1000) : new Date(now + seconds * 1000);
  if (mode === "reduce") {
    if (!cur.active) return editPanel(pool, cb, panel("Sᴘᴇᴄɪᴀʟ Cᴇɴᴛᴇʀ", "✗ ویژه فعالی برای کاهش مدت وجود ندارد."), [[["‹ بازگشت", `mc:special:${targetId}`]]]);
    if (!previous) return editPanel(pool, cb, panel("Sᴘᴇᴄɪᴀʟ Cᴇɴᴛᴇʀ", "✗ ویژه بدون انقضا قابل کاهش زمان نیست."), [[["‹ بازگشت", `mc:special:${targetId}`]]]);
    const tms = new Date(String(previous)).getTime() - seconds * 1000;
    next = tms <= now ? new Date(now) : new Date(tms);
  }
  await pool.query(
    "INSERT INTO special_users(group_id,user_id,first_name,username,status,starts_at,expires_at,created_by,updated_by,reason) VALUES($1,$2,$3,$4,'active',NOW(),$5,$6,$6,$7) ON CONFLICT (group_id,user_id) DO UPDATE SET first_name=EXCLUDED.first_name,username=EXCLUDED.username,status='active',expires_at=EXCLUDED.expires_at,updated_by=EXCLUDED.updated_by,updated_at=NOW(),reason=EXCLUDED.reason",
    [groupId, targetId, t.user.first_name ?? null, t.user.username ?? null, next, cb.from.id, "مدیریت ویژه از پنل عضو"],
  );
  await pool.query(
    "INSERT INTO special_user_events(group_id,user_id,action_type,duration_seconds,previous_expires_at,new_expires_at,actor_id,actor_name,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [groupId, targetId, mode, seconds, previous, next, cb.from.id, cb.from.username ?? cb.from.first_name ?? String(cb.from.id), "پنل متمرکز عضو"],
  ).catch(() => {});
  return specialPanel(pool, cb, targetId);
}

async function specialRemove(pool: Pool, cb: TgCallback, targetId: number) {
  const groupId = cb.message!.chat.id;
  const cur = await specialRow(pool, groupId, targetId);
  if (!cur.active) return specialPanel(pool, cb, targetId);
  await pool.query("UPDATE special_users SET status='removed',expires_at=NULL,updated_by=$3,updated_at=NOW() WHERE group_id=$1 AND user_id=$2", [groupId, targetId, cb.from.id]);
  await pool.query(
    "INSERT INTO special_user_events(group_id,user_id,action_type,duration_seconds,previous_expires_at,new_expires_at,actor_id,actor_name,reason) VALUES($1,$2,'remove',NULL,$3,NULL,$4,$5,'حذف از پنل عضو')",
    [groupId, targetId, cur.row?.expires_at ?? null, cb.from.id, cb.from.username ?? cb.from.first_name ?? String(cb.from.id)],
  ).catch(() => {});
  return specialPanel(pool, cb, targetId);
}

async function quickPanel(pool: Pool, cb: TgCallback, targetId: number) {
  return editPanel(pool, cb, panel("Qᴜɪᴄᴋ Aᴄᴛɪᴏɴs", [
    "⛂ - کاربر : " + targetId,
    "⛂ - عملیات سریع فقط شامل اقدامات برگشت‌پذیر یا کوتاه است.",
  ].join("\n")), [
    [["› اخطار +۱", `mc:warn_issue:${targetId}`], ["› سکوت ۱ ساعت", `mc:mute_apply:${targetId}:3600`]],
    [["› ویژه ۱ روز", `mc:special_set:${targetId}:86400`], ["› رفع سکوت", `mc:unmute:${targetId}`]],
    [["› رفع محدودیت", `mc:restrict_clear:${targetId}`], ["› وضعیت فعلی", `mc:status:${targetId}`]],
    [["‹ بازگشت", `mc:center:${targetId}`]],
  ]);
}

async function recordModeration(pool: Pool, cb: TgCallback, targetId: number, action: string, duration: number | null, reason: string, ok: boolean) {
  await pool.query(
    "INSERT INTO moderation_actions(group_id,actor_id,target_id,action_type,duration_seconds,reason,status) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [cb.message!.chat.id, cb.from.id, targetId, action, duration, reason, ok ? "success" : "failed"],
  ).catch(() => {});
}

async function applyMute(pool: Pool, cb: TgCallback, targetId: number, seconds: number) {
  const t = await target(pool, cb.message!.chat.id, targetId);
  if (!t.ok) return editPanel(pool, cb, panel("Mᴜᴛᴇ Cᴇɴᴛᴇʀ", "✗ " + t.error), [[["‹ بازگشت", `mc:mute:${targetId}`]]]);
  if (["administrator", "creator"].includes(t.status)) return editPanel(pool, cb, panel("Mᴜᴛᴇ Cᴇɴᴛᴇʀ", "✗ این کاربر مدیر/مالک است و قابل سکوت نیست."), [[["‹ بازگشت", `mc:punish:${targetId}`]]]);
  const body: Record<string, unknown> = {
    chat_id: cb.message!.chat.id,
    user_id: targetId,
    permissions: MUTED_PERMISSIONS,
    use_independent_chat_permissions: true,
  };
  if (seconds > 0) body.until_date = Math.floor(Date.now() / 1000) + Math.max(30, seconds);
  const r = await telegramApi("restrictChatMember", body);
  await recordModeration(pool, cb, targetId, "mute", seconds > 0 ? seconds : null, seconds > 0 ? "سکوت موقت از پنل عضو" : "سکوت دائمی از پنل عضو", r.ok);
  return r.ok
    ? mutePanel(pool, cb, targetId)
    : editPanel(pool, cb, panel("Mᴜᴛᴇ Cᴇɴᴛᴇʀ", "✗ سکوت ناموفق بود: " + value(r.description, "Telegram error")), [[["‹ بازگشت", `mc:punish:${targetId}`]]]);
}

async function applyBan(pool: Pool, cb: TgCallback, targetId: number, seconds: number) {
  const t = await target(pool, cb.message!.chat.id, targetId);
  if (!t.ok) return editPanel(pool, cb, panel("Bᴀɴ Cᴇɴᴛᴇʀ", "✗ " + t.error), [[["‹ بازگشت", `mc:ban:${targetId}`]]]);
  if (["administrator", "creator"].includes(t.status)) return editPanel(pool, cb, panel("Bᴀɴ Cᴇɴᴛᴇʀ", "✗ این کاربر مدیر/مالک است و قابل بن نیست."), [[["‹ بازگشت", `mc:punish:${targetId}`]]]);
  const body: Record<string, unknown> = {
    chat_id: cb.message!.chat.id,
    user_id: targetId,
    revoke_messages: true,
  };
  if (seconds > 0) body.until_date = Math.floor(Date.now() / 1000) + Math.max(30, seconds);
  const r = await telegramApi("banChatMember", body);
  await recordModeration(pool, cb, targetId, "ban", seconds > 0 ? seconds : null, seconds > 0 ? "بن موقت از پنل عضو" : "بن دائمی از پنل عضو", r.ok);
  return r.ok
    ? banPanel(pool, cb, targetId)
    : editPanel(pool, cb, panel("Bᴀɴ Cᴇɴᴛᴇʀ", "✗ بن ناموفق بود: " + value(r.description, "Telegram error")), [[["‹ بازگشت", `mc:punish:${targetId}`]]]);
}

async function applyKick(pool: Pool, cb: TgCallback, targetId: number) {
  const t = await target(pool, cb.message!.chat.id, targetId);
  if (!t.ok) return editPanel(pool, cb, panel("Kɪᴄᴋ Cᴇɴᴛᴇʀ", "✗ " + t.error), [[["‹ بازگشت", `mc:punish:${targetId}`]]]);
  if (["administrator", "creator"].includes(t.status)) return editPanel(pool, cb, panel("Kɪᴄᴋ Cᴇɴᴛᴇʀ", "✗ این کاربر مدیر/مالک است و قابل کیک نیست."), [[["‹ بازگشت", `mc:punish:${targetId}`]]]);
  const r = await telegramApi("banChatMember", {
    chat_id: cb.message!.chat.id,
    user_id: targetId,
    revoke_messages: true,
    until_date: Math.floor(Date.now() / 1000) + 60,
  });
  await recordModeration(pool, cb, targetId, "kick", 60, "کیک از پنل عضو", r.ok);
  return r.ok
    ? editPanel(pool, cb, panel("Kɪᴄᴋ Cᴇɴᴛᴇʀ", "✓ کاربر با عملیات کیک خارج شد.\n⛂ - شناسه : " + targetId), [[["‹ بازگشت", `mc:punish:${targetId}`]]])
    : editPanel(pool, cb, panel("Kɪᴄᴋ Cᴇɴᴛᴇʀ", "✗ کیک ناموفق بود: " + value(r.description, "Telegram error")), [[["‹ بازگشت", `mc:punish:${targetId}`]]]);
}

async function updateWarningCount(pool: Pool, groupId: number, userId: number) {
  const count = await warningCount(pool, groupId, userId);
  const level = Number((await pool.query(
    "SELECT COALESCE(MAX(level_no),0)::int AS level_no FROM warning_events WHERE group_id=$1 AND user_id=$2 AND action_type='warning' AND status='active'",
    [String(groupId), String(userId)],
  ).catch(() => ({ rows: [{ level_no: 0 }] }))).rows[0]?.level_no ?? 0);
  await pool.query(
    "UPDATE warning_cases SET warning_count=$3,current_level=$4,status=$5,updated_at=NOW() WHERE group_id=$1 AND user_id=$2",
    [String(groupId), String(userId), count, level, count ? "active" : "cleared"],
  ).catch(() => {});
}

async function issueWarning(pool: Pool, cb: TgCallback, targetId: number, reason?: string) {
  const t = await target(pool, cb.message!.chat.id, targetId);
  if (!t.ok) return warningPanel(pool, cb, targetId);
  if (["administrator", "creator"].includes(t.status)) {
    return editPanel(pool, cb, panel("Wᴀʀɴɪɴɢ Cᴇɴᴛᴇʀ", "✗ این کاربر مدیر/مالک است و قابل اخطار نیست."), [[["‹ بازگشت", `mc:punish:${targetId}`]]]);
  }
  const ctx: BotContext = {
    text: reason ?? "تخلف از قوانین گروه",
    chatType: cb.message!.chat.type === "group" ? "group" : "supergroup",
    chatId: cb.message!.chat.id,
    chatTitle: cb.message!.chat.title || "group",
    chatUsername: undefined,
    membersCount: 0,
    userId: cb.from.id,
    userName: cb.from.username || cb.from.first_name || String(cb.from.id),
    userRank: "admin",
    replyToUserId: targetId,
    replyToName: t.user.username ? "@" + t.user.username : t.user.first_name,
    lang: "fa",
    config: {} as any,
    now: Date.now(),
    staff: [],
  };
  const result = await runModerationCommand(pool, ctx, "warn", reason ? [reason] : []);
  return editPanel(pool, cb, panel("Wᴀʀɴɪɴɢ Cᴇɴᴛᴇʀ", result), [
    [["› بروزرسانی", `mc:warn:${targetId}`], ["‹ بازگشت", `mc:punish:${targetId}`]],
  ]);
}

async function reduceWarning(pool: Pool, cb: TgCallback, targetId: number, clearAll = false) {
  const groupId = cb.message!.chat.id;
  if (clearAll) {
    await pool.query(
      "UPDATE warning_events SET status='expired',result='manual_clear',expires_at=NOW() WHERE group_id=$1 AND user_id=$2 AND action_type='warning' AND status='active'",
      [String(groupId), String(targetId)],
    ).catch(() => {});
  } else {
    await pool.query(
      "UPDATE warning_events SET status='expired',result='manual_decrease',expires_at=NOW() WHERE id=(SELECT id FROM warning_events WHERE group_id=$1 AND user_id=$2 AND action_type='warning' AND status='active' ORDER BY id DESC LIMIT 1)",
      [String(groupId), String(targetId)],
    ).catch(() => {});
  }
  await updateWarningCount(pool, groupId, targetId);
  return warningPanel(pool, cb, targetId);
}

async function warningHistory(pool: Pool, cb: TgCallback, targetId: number, page: number) {
  const rows = await pool.query(
    "SELECT action_type,violation_type,custom_violation,level_no,status,created_at FROM warning_events WHERE group_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 8 OFFSET $3",
    [String(cb.message!.chat.id), String(targetId), Math.max(0, page) * 8],
  ).catch(() => ({ rows: [] as any[] }));
  const body = rows.rows.length
    ? rows.rows.map((x: any, i: number) => `${String(i + 1).padStart(2, "0")} · ${value(x.action_type)} · سطح ${value(x.level_no, "0")} · ${value(x.status)}\n   └ ${value(x.custom_violation || x.violation_type)} · ${new Date(x.created_at).toLocaleString("fa-IR")}`).join("\n\n")
    : "⛂ - سابقه اخطار ثبت نشده است.";
  return editPanel(pool, cb, panel("Wᴀʀɴɪɴɢ Hɪsᴛᴏʀʏ", "⛂ - کاربر : " + targetId + "\n\n" + body), [
    [["› بروزرسانی", `mc:warn_history:${targetId}:${page}`]],
    [["‹ بازگشت", `mc:warn:${targetId}`]],
  ]);
}

async function specialHistory(pool: Pool, cb: TgCallback, targetId: number) {
  const rows = await pool.query(
    "SELECT action_type,duration_seconds,previous_expires_at,new_expires_at,actor_name,created_at FROM special_user_events WHERE group_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 10",
    [cb.message!.chat.id, targetId],
  ).catch(() => ({ rows: [] as any[] }));
  const body = rows.rows.length
    ? rows.rows.map((x: any, i: number) => `${String(i + 1).padStart(2, "0")} · ${value(x.action_type)} · ${x.duration_seconds ? durationLabel(Number(x.duration_seconds)) : "—"}\n   └ ${value(x.actor_name)} · ${new Date(x.created_at).toLocaleString("fa-IR")}`).join("\n\n")
    : "⛂ - سابقه ویژه ثبت نشده است.";
  return editPanel(pool, cb, panel("Sᴘᴇᴄɪᴀʟ Hɪsᴛᴏʀʏ", "⛂ - کاربر : " + targetId + "\n\n" + body), [[["‹ بازگشت", `mc:special:${targetId}`]]]);
}

async function toggleException(pool: Pool, cb: TgCallback, targetId: number, key: string) {
  const current = await pool.query(
    "SELECT enabled FROM member_control_exceptions WHERE group_id=$1 AND user_id=$2 AND exception_key=$3 LIMIT 1",
    [cb.message!.chat.id, targetId, key],
  ).catch(() => ({ rows: [] as any[] }));
  const next = !Boolean(current.rows[0]?.enabled);
  await pool.query(
    "INSERT INTO member_control_exceptions(group_id,user_id,exception_key,enabled,actor_id,updated_at) VALUES($1,$2,$3,$4,$5,NOW()) ON CONFLICT(group_id,user_id,exception_key) DO UPDATE SET enabled=EXCLUDED.enabled,actor_id=EXCLUDED.actor_id,updated_at=NOW()",
    [cb.message!.chat.id, targetId, key, next, cb.from.id],
  );
  return exceptionsPanel(pool, cb, targetId);
}

async function botCanPromoteMembers(groupId: number) {
  const me = await telegramApi<any>("getMe");
  if (!me.ok || !me.result?.id) return { ok: false, error: me.description || "شناسه ربات قابل دریافت نیست." };
  const botMember = await telegramApi<any>("getChatMember", { chat_id: groupId, user_id: me.result.id });
  if (!botMember.ok || !botMember.result) return { ok: false, error: botMember.description || "وضعیت ربات در گروه قابل دریافت نیست." };
  if (!["administrator", "creator"].includes(String(botMember.result.status || ""))) {
    return { ok: false, error: "ربات در این گروه مدیر نیست." };
  }
  if (botMember.result.status === "administrator" && botMember.result.can_promote_members !== true) {
    return { ok: false, error: "ربات مجوز «افزودن/مدیریت ادمین‌ها» را ندارد." };
  }
  return { ok: true, error: "" };
}

async function promoteAdmin(pool: Pool, cb: TgCallback, targetId: number) {
  const t = await target(pool, cb.message!.chat.id, targetId);
  if (!t.ok) return renderMain(pool, cb.message!.chat.id, cb.from.id, targetId, cb);
  if (t.status === "creator") return editPanel(pool, cb, panel("Aᴅᴅ Aᴅᴍɪɴ", "✗ مالک گروه قابل ارتقا نیست."), [[["‹ بازگشت", `mc:center:${targetId}`]]]);
  if (t.status === "administrator") return renderAdmin(pool, cb, targetId);
  const capability = await botCanPromoteMembers(cb.message!.chat.id);
  if (!capability.ok) {
    return editPanel(pool, cb, panel("Aᴅᴅ Aᴅᴍɪɴ", [
      "⛂ - وضعیت : ✗ قابل اجرا نیست",
      "⛂ - علت : " + capability.error,
      "",
      "─────━━───── ◈ ─────━━─────",
      "",
      "⛂ - در تنظیمات ادمین گروه، مجوز «افزودن مدیران» را برای ربات فعال کنید.",
    ].join("\n")), [[["‹ بازگشت", `mc:center:${targetId}`]]]);
  }
  const r = await telegramApi("promoteChatMember", {
    chat_id: cb.message!.chat.id,
    user_id: targetId,
    can_delete_messages: true,
    can_restrict_members: true,
    can_invite_users: true,
    can_pin_messages: true,
    can_manage_topics: false,
    can_change_info: false,
    can_promote_members: false,
    can_manage_video_chats: false,
    can_manage_tags: false,
    is_anonymous: false,
  });
  if (!r.ok) {
    return editPanel(pool, cb, panel("Aᴅᴅ Aᴅᴍɪɴ", "✗ افزودن ادمین ناموفق بود: " + value(r.description, "Telegram error")), [[["‹ بازگشت", `mc:center:${targetId}`]]]);
  }
  await recordModeration(pool, cb, targetId, "promote", null, "افزودن ادمین از پنل عضو", true);
  await pool.query(
    "INSERT INTO audit_logs(actor_id,action,target,after_data,source) VALUES($1,'member_admin_added',$2,$3::jsonb,'telegram_member_control')",
    [String(cb.from.id), String(targetId), JSON.stringify({ group_id: cb.message!.chat.id })],
  ).catch(() => {});
  return renderAdmin(pool, cb, targetId);
}

async function toggleAdminRight(pool: Pool, cb: TgCallback, targetId: number, key: string) {
  if (!ADMIN_PERMISSION_KEYS.includes(key)) return;
  const capability = await botCanPromoteMembers(cb.message!.chat.id);
  if (!capability.ok) {
    return editPanel(pool, cb, panel("Aᴅᴍɪɴ Cᴇɴᴛᴇʀ", [
      "⛂ - وضعیت : ✗ ویرایش دسترسی ممکن نیست",
      "⛂ - علت : " + capability.error,
      "",
      "⛂ - برای ویرایش دسترسی ادمین، ربات باید مجوز «افزودن مدیران» داشته باشد.",
    ].join("\n")), [[["‹ بازگشت", `mc:admin:${targetId}`]]]);
  }
  const t = await target(pool, cb.message!.chat.id, targetId);
  if (!t.ok) return renderMain(pool, cb.message!.chat.id, cb.from.id, targetId, cb);
  if (t.status !== "administrator" || t.member.can_be_edited === false) {
    return editPanel(pool, cb, panel("Aᴅᴍɪɴ Cᴇɴᴛᴇʀ", "✗ این ادمین توسط ربات قابل ویرایش نیست."), [[["‹ بازگشت", `mc:admin:${targetId}`]]]);
  }
  const rights = adminRightsFrom(t.member);
  (rights as any)[key] = !(rights as any)[key];
  const payload: Record<string, unknown> = { chat_id: cb.message!.chat.id, user_id: targetId, ...rights };
  const r = await telegramApi("promoteChatMember", payload);
  if (!r.ok) {
    return editPanel(pool, cb, panel("Aᴅᴍɪɴ Cᴇɴᴛᴇʀ", "✗ تغییر دسترسی ناموفق بود: " + value(r.description, "Telegram error")), [[["‹ بازگشت", `mc:admin:${targetId}`]]]);
  }
  await recordModeration(pool, cb, targetId, "admin_permission", null, ADMIN_PERMISSION_LABELS[key] + " → " + ((rights as any)[key] ? "فعال" : "خاموش"), true);
  return renderAdmin(pool, cb, targetId);
}

async function demoteAdmin(pool: Pool, cb: TgCallback, targetId: number) {
  const t = await target(pool, cb.message!.chat.id, targetId);
  if (!t.ok) return renderMain(pool, cb.message!.chat.id, cb.from.id, targetId, cb);
  if (t.status !== "administrator" || t.member.can_be_edited === false) {
    return editPanel(pool, cb, panel("Aᴅᴍɪɴ Cᴇɴᴛᴇʀ", "✗ این ادمین قابل حذف مقام توسط ربات نیست."), [[["‹ بازگشت", `mc:admin:${targetId}`]]]);
  }
  const r = await telegramApi("promoteChatMember", {
    chat_id: cb.message!.chat.id,
    user_id: targetId,
    is_anonymous: false,
    can_manage_chat: false,
    can_delete_messages: false,
    can_manage_video_chats: false,
    can_restrict_members: false,
    can_promote_members: false,
    can_change_info: false,
    can_invite_users: false,
    can_post_stories: false,
    can_edit_stories: false,
    can_delete_stories: false,
    can_pin_messages: false,
    can_manage_topics: false,
    can_manage_direct_messages: false,
    can_manage_tags: false,
    can_send_welcome_messages: false,
  });
  if (!r.ok) return editPanel(pool, cb, panel("Aᴅᴍɪɴ Cᴇɴᴛᴇʀ", "✗ حذف مقام ناموفق بود: " + value(r.description, "Telegram error")), [[["‹ بازگشت", `mc:admin:${targetId}`]]]);
  await recordModeration(pool, cb, targetId, "demote", null, "حذف مقام ادمین از پنل عضو", true);
  return renderMain(pool, cb.message!.chat.id, cb.from.id, targetId, cb);
}

async function quarantine(pool: Pool, cb: TgCallback, targetId: number, seconds: number) {
  const t = await target(pool, cb.message!.chat.id, targetId);
  if (!t.ok) return securityPanel(pool, cb, targetId);
  if (["administrator", "creator"].includes(t.status)) {
    return editPanel(pool, cb, panel("Sᴇᴄᴜʀɪᴛʏ Cᴇɴᴛᴇʀ", "✗ قرنطینه فقط برای عضو عادی قابل اجراست."), [[["‹ بازگشت", `mc:security:${targetId}`]]]);
  }
  const r = await telegramApi("restrictChatMember", {
    chat_id: cb.message!.chat.id,
    user_id: targetId,
    permissions: MUTED_PERMISSIONS,
    use_independent_chat_permissions: true,
    until_date: Math.floor(Date.now() / 1000) + Math.max(30, seconds),
  });
  await recordModeration(pool, cb, targetId, "quarantine", seconds, "قرنطینه امنیتی", r.ok);
  return r.ok ? securityPanel(pool, cb, targetId) : editPanel(pool, cb, panel("Sᴇᴄᴜʀɪᴛʏ Cᴇɴᴛᴇʀ", "✗ قرنطینه ناموفق بود: " + value(r.description, "Telegram error")), [[["‹ بازگشت", `mc:security:${targetId}`]]]);
}

async function publishPhoto(pool: Pool, cb: TgCallback, targetId: number) {
  const photos = await telegramApi<any>("getUserProfilePhotos", { user_id: targetId, offset: 0, max: 1 });
  if (!photos.ok || !photos.result?.photos?.[0]?.length) {
    return editPanel(pool, cb, panel("Mᴇᴍʙᴇʀ Tᴏᴏʟs", "⛂ - عکس پروفایل در دسترس نیست."), [[["‹ بازگشت", `mc:tools:${targetId}`]]]);
  }
  const sizes = photos.result.photos[0];
  const fileId = sizes[sizes.length - 1]?.file_id;
  if (!fileId) return editPanel(pool, cb, panel("Mᴇᴍʙᴇʀ Tᴏᴏʟs", "⛂ - عکس پروفایل در دسترس نیست."), [[["‹ بازگشت", `mc:tools:${targetId}`]]]);
  const sent = await telegramApi("sendPhoto", {
    chat_id: cb.message!.chat.id,
    photo: fileId,
    caption: "⛂ - شناسه کاربر : " + targetId,
  });
  return sent;
}

async function customTitleInput(pool: Pool, msg: TgMessage, session: MemberSession) {
  const raw = String(msg.text || msg.caption || "").trim();
  if (!raw || raw.length > 16 || /[\p{Extended_Pictographic}]/u.test(raw)) {
    await telegramApi("sendMessage", { chat_id: msg.chat.id, text: "✗ عنوان باید بین ۱ تا ۱۶ کاراکتر و بدون emoji باشد." });
    return true;
  }
  const r = await telegramApi("setChatAdministratorCustomTitle", {
    chat_id: msg.chat.id,
    user_id: session.targetId,
    custom_title: raw,
  });
  clearSession(msg.from!.id);
  await telegramApi("sendMessage", { chat_id: msg.chat.id, text: r.ok ? "✓ عنوان ادمین بروزرسانی شد." : "✗ تغییر عنوان ناموفق بود: " + value(r.description, "Telegram error") });
  return true;
}

export async function renderMemberControl(pool: Pool, chatId: number, actorId: number, targetId: number) {
  await ensureSchema(pool);
  return renderMain(pool, chatId, actorId, targetId);
}

export async function handleMemberControlTextInput(pool: Pool, msg: TgMessage) {
  if (!msg.from || msg.chat.type === "private") return false;
  const s = getSession(msg.from.id);
  if (!s || s.groupId !== msg.chat.id) return false;
  const raw = String(msg.text || msg.caption || "").trim();
  if (!raw) return true;
  if (s.flow === "admin_title") return customTitleInput(pool, msg, s);
  if (s.flow === "note_add") {
    await pool.query(
      "INSERT INTO member_control_notes(group_id,user_id,actor_id,note) VALUES($1,$2,$3,$4)",
      [msg.chat.id, s.targetId, s.actorId, raw],
    );
    clearSession(msg.from.id);
    await telegramApi("sendMessage", { chat_id: msg.chat.id, text: "✓ یادداشت عضو ثبت شد.\n⛂ - شناسه : " + s.targetId });
    return true;
  }
  let sec: number | null = null;
  if (["mute_custom", "ban_custom", "special_custom"].includes(s.flow)) sec = parseDuration(raw);
  if (sec === null && ["mute_custom", "ban_custom", "special_custom"].includes(s.flow)) {
    await telegramApi("sendMessage", { chat_id: msg.chat.id, text: "✗ مدت نامعتبر است. نمونه: 90 دقیقه، 3 ساعت، 7 روز یا دائمی." });
    return true;
  }
  const fake: TgCallback = { id: "text", from: msg.from, message: msg };
  if (s.flow === "warning_reason") {
    clearSession(msg.from.id);
    return issueWarning(pool, fake, s.targetId, raw).then(() => true);
  }
  clearSession(msg.from.id);
  if (s.flow === "mute_custom") {
    return (await applyMute(pool, fake, s.targetId, sec as number), true);
  }
  if (s.flow === "ban_custom") {
    return (await applyBan(pool, fake, s.targetId, sec as number), true);
  }
  if (s.flow === "special_custom") {
    const r = await specialApply(pool, fake, s.targetId, sec as number, "set");
    return !!r || true;
  }
  return false;
}

export async function handleMemberControlCallback(pool: Pool, cb: TgCallback, ownerIds: string[]) {
  if (!cb.message || !String(cb.data || "").startsWith("mc:")) return false;
  const groupId = cb.message.chat.id;
  if (!(await authorized(pool, groupId, cb.from.id, ownerIds))) return true;
  await ensureSchema(pool);
  const p = String(cb.data).split(":");
  const action = p[1];
  const targetId = Number(p[2]);
  if (!Number.isSafeInteger(targetId) || targetId <= 0) return true;

  if (action === "center") return renderMain(pool, groupId, cb.from.id, targetId, cb);
  if (action === "protected") return editPanel(pool, cb, panel("Mᴇᴍʙᴇʀ Cᴏɴᴛʀᴏʟ", "⛂ - این حساب مالک گروه است و عملیات مدیریتی روی آن توسط ربات محدود شده است."), [[["‹ بازگشت", `mc:center:${targetId}`]]]);
  if (action === "addadmin") return renderAdmin(pool, cb, targetId);
  if (action === "addadmin_yes") return promoteAdmin(pool, cb, targetId);
  if (action === "admin") return renderAdmin(pool, cb, targetId);
  if (action === "admininfo") return adminInfo(pool, cb, targetId);
  if (action === "right") return toggleAdminRight(pool, cb, targetId, p[3] || "");
  if (action === "demote") return editPanel(pool, cb, panel("Aᴅᴍɪɴ Cᴇɴᴛᴇʀ", "⚠️ حذف مقام ادمین یک عملیات حساس است."), [
    [["› تأیید حذف مقام", `mc:demote_yes:${targetId}`]],
    [["‹ بازگشت", `mc:admin:${targetId}`]],
  ]);
  if (action === "demote_yes") return demoteAdmin(pool, cb, targetId);
  if (action === "admintitle") {
    setSession(cb.from.id, { flow: "admin_title", groupId, targetId, actorId: cb.from.id });
    return editPanel(pool, cb, panel("Aᴅᴍɪɴ Tɪᴛʟᴇ", "⛂ - عنوان جدید را ارسال کنید.\n⛂ - حداکثر ۱۶ کاراکتر و بدون emoji."), [[["‹ بازگشت", `mc:admin:${targetId}`]]]);
  }

  if (action === "punish") return renderPunish(pool, cb, targetId);
  if (action === "warn") return warningPanel(pool, cb, targetId);
  if (action === "warn_issue") return issueWarning(pool, cb, targetId);
  if (action === "warn_reason") {
    setSession(cb.from.id, { flow: "warning_reason", groupId, targetId, actorId: cb.from.id });
    return editPanel(pool, cb, panel("Wᴀʀɴɪɴɢ Cᴇɴᴛᴇʀ", "⛂ - دلیل اخطار را ارسال کنید."), [[["‹ بازگشت", `mc:warn:${targetId}`]]]);
  }
  if (action === "warn_reduce") return reduceWarning(pool, cb, targetId, false);
  if (action === "warn_clear") return reduceWarning(pool, cb, targetId, true);
  if (action === "warn_history") return warningHistory(pool, cb, targetId, Number(p[3] || 0));
  if (action === "mute") return mutePanel(pool, cb, targetId);
  if (action === "mute_apply") return applyMute(pool, cb, targetId, Math.max(0, Number(p[3] || 0)));
  if (action === "mute_custom") {
    setSession(cb.from.id, { flow: "mute_custom", groupId, targetId, actorId: cb.from.id });
    return editPanel(pool, cb, panel("Mᴜᴛᴇ Cᴇɴᴛᴇʀ", "⛂ - مدت سکوت را ارسال کنید.\n⛂ - نمونه: 90 دقیقه، 3 ساعت، 1 روز یا دائمی."), [[["‹ بازگشت", `mc:mute:${targetId}`]]]);
  }
  if (action === "unmute") {
    const r = await telegramApi("restrictChatMember", {
      chat_id: groupId,
      user_id: targetId,
      permissions: ALL_PERMISSIONS,
      use_independent_chat_permissions: true,
    });
    await recordModeration(pool, cb, targetId, "unmute", null, "رفع سکوت از پنل عضو", r.ok);
    return r.ok ? mutePanel(pool, cb, targetId) : editPanel(pool, cb, panel("Mᴜᴛᴇ Cᴇɴᴛᴇʀ", "✗ رفع سکوت ناموفق بود: " + value(r.description, "Telegram error")), [[["‹ بازگشت", `mc:punish:${targetId}`]]]);
  }
  if (action === "ban") return banPanel(pool, cb, targetId);
  if (action === "ban_apply") {
    const sec = Math.max(0, Number(p[3] || 0));
    return applyBan(pool, cb, targetId, sec);
  }
  if (action === "ban_custom") {
    setSession(cb.from.id, { flow: "ban_custom", groupId, targetId, actorId: cb.from.id });
    return editPanel(pool, cb, panel("Bᴀɴ Cᴇɴᴛᴇʀ", "⛂ - مدت بن را ارسال کنید.\n⛂ - نمونه: 2 روز، 7 روز یا دائمی."), [[["‹ بازگشت", `mc:ban:${targetId}`]]]);
  }
  if (action === "unban") {
    const r = await telegramApi("unbanChatMember", { chat_id: groupId, user_id: targetId, only_if_banned: true });
    await recordModeration(pool, cb, targetId, "unban", null, "رفع بن از پنل عضو", r.ok);
    return r.ok ? banPanel(pool, cb, targetId) : editPanel(pool, cb, panel("Bᴀɴ Cᴇɴᴛᴇʀ", "✗ رفع بن ناموفق بود: " + value(r.description, "Telegram error")), [[["‹ بازگشت", `mc:punish:${targetId}`]]]);
  }
  if (action === "kick") return kickPanel(pool, cb, targetId);
  if (action === "kick_yes") return applyKick(pool, cb, targetId);

  if (action === "special") return specialPanel(pool, cb, targetId);
  if (action === "special_set" || action === "special_ext" || action === "special_red") {
    const sec = Math.max(0, Number(p[3] || 0));
    return specialApply(pool, cb, targetId, sec, action === "special_set" ? "set" : action === "special_ext" ? "extend" : "reduce");
  }
  if (action === "special_custom") {
    setSession(cb.from.id, { flow: "special_custom", groupId, targetId, actorId: cb.from.id });
    return editPanel(pool, cb, panel("Sᴘᴇᴄɪᴀʟ Cᴇɴᴛᴇʀ", "⛂ - مدت ویژه را ارسال کنید.\n⛂ - نمونه: 3 ساعت، 1 روز یا بدون انقضا."), [[["‹ بازگشت", `mc:special:${targetId}`]]]);
  }
  if (action === "special_remove") return specialRemove(pool, cb, targetId);
  if (action === "special_history") return specialHistory(pool, cb, targetId);

  if (action === "roles") return rolesPanel(pool, cb, targetId);
  if (action === "restrict") return restrictionsPanel(pool, cb, targetId);
  if (action === "restrict_apply") return applyRestriction(pool, cb, targetId, p[3] || "text");
  if (action === "restrict_clear") return clearRestrictions(pool, cb, targetId);
  if (action === "security") return securityPanel(pool, cb, targetId);
  if (action === "quarantine") {
    const sec = Math.max(30, Number(p[3] || 3600));
    return quarantine(pool, cb, targetId, sec);
  }
  if (action === "profile") return profilePanel(pool, cb, targetId);
  if (action === "history") return historyPanel(pool, cb, targetId, Number(p[3] || 0));
  if (action === "file") return filePanel(pool, cb, targetId);
  if (action === "note_add") {
    setSession(cb.from.id, { flow: "note_add", groupId, targetId, actorId: cb.from.id });
    return editPanel(pool, cb, panel("Mᴇᴍʙᴇʀ Fɪʟᴇ", "⛂ - متن یادداشت را ارسال کنید."), [[["‹ بازگشت", `mc:file:${targetId}`]]]);
  }
  if (action === "note_clear") {
    await pool.query("DELETE FROM member_control_notes WHERE group_id=$1 AND user_id=$2", [groupId, targetId]);
    return filePanel(pool, cb, targetId);
  }
  if (action === "exceptions") return exceptionsPanel(pool, cb, targetId);
  if (action === "exception_toggle") return toggleException(pool, cb, targetId, p[3] || "");
  if (action === "tools") return toolsPanel(pool, cb, targetId);
  if (action === "id") return editPanel(pool, cb, panel("Mᴇᴍʙᴇʀ TᴏᴏʟS", "⛂ - شناسه کاربر : " + targetId), [[["‹ بازگشت", `mc:tools:${targetId}`]]]);
  if (action === "link") return editPanel(pool, cb, panel("Mᴇᴍʙᴇʀ TᴏᴏʟS", "⛂ - لینک پروفایل : tg://user?id=" + targetId), [[["‹ بازگشت", `mc:tools:${targetId}`]]]);
  if (action === "photo") return publishPhoto(pool, cb, targetId);
  if (action === "status") return statusPanel(pool, cb, targetId);
  if (action === "quick") return quickPanel(pool, cb, targetId);

  return true;
}
