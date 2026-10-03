import type { Pool } from "pg";
import { telegramApi } from "../telegram/api.ts";
import { prepareRichDocument, validateRichDocument } from "./rich-message.ts";
import { glassButton, styledGlassButton } from "./panel-design.ts";
import { bindPanelMessage, touchPanelMessage } from "./panel-session.ts";
import {
  ensureGroupManagementCoreSchema,
  getGroupOverview,
  installGroup,
  reconcileGroup,
} from "./group-management-core.ts";
import {
  ensureOwnerGroupSchema,
  ownerGroupOverview,
  listOwnerGroups,
  getOwnerGroup,
  syncOwnerGroup,
  setOwnerGroupEnabled,
  leaveOwnerGroup,
  resetOwnerGroup,
  sendMessageToOwnerGroup,
  getOwnerGroupLogs,
  auditOwnerGroup,
} from "./owner-groups.ts";

type TgUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TgChat = {
  id: number;
  type: string;
  title?: string;
  username?: string;
};

type TgMessage = {
  message_id?: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  caption?: string;
};

type TgCallback = {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
};

const BUILTIN_OWNER_IDS = ["8247710529"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const inputFlows = new Map<number, { messageId: number; expires: number; mode: "group" | "message" }>();
const messageTargets = new Map<number, number>();

function clean(value: unknown) {
  const text = String(value ?? "").trim();
  return text || "ثبت نشده";
}

function numberValue(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function faDate(value: unknown) {
  if (!value) return "ثبت نشده";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "ثبت نشده";
  return new Intl.DateTimeFormat("fa-IR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tehran",
  }).format(date);
}

function stateLabel(value: unknown) {
  const state = String(value ?? "").toUpperCase();
  if (["ACTIVE", "ADMINISTRATOR", "INSTALLED", "REGISTERED", "HEALTHY"].includes(state)) return "فعال";
  if (["DISABLED", "STOPPED", "UNINSTALLED", "LEFT", "BANNED"].includes(state)) return "غیرفعال";
  if (["ERROR", "FAILED", "BLOCKED"].includes(state)) return "خطادار";
  if (["SYNCING", "INSTALLING", "PENDING", "RESETTING"].includes(state)) return "در حال پردازش";
  if (["RESTRICTED", "DEGRADED"].includes(state)) return "نیازمند بررسی";
  return clean(value);
}

function membershipLabel(value: unknown) {
  const state = String(value ?? "").toUpperCase();
  if (state === "ADMINISTRATOR") return "مدیر";
  if (state === "MEMBER") return "عضو";
  if (state === "RESTRICTED") return "محدود";
  if (state === "LEFT" || state === "BANNED") return "خارج از گروه";
  return "نامشخص";
}

function button(label: string, data: string) {
  return glassButton(label, data);
}

function colored(label: string, data: string, style: "success" | "danger" | "primary") {
  return styledGlassButton(label, data, style);
}

function back(data: string) {
  return [[colored("‹ بازگشت", data, "primary")]];
}

function keyboard(rows: any[][]) {
  return { inline_keyboard: rows };
}

function table(caption: string, rows: Array<[string, string]>) {
  return {
    type: "table",
    caption,
    is_bordered: true,
    is_striped: false,
    is_compact: true,
    cells: [
      [
        { text: "عنوان", is_header: true, align: "right", valign: "middle" },
        { text: "مقدار", is_header: true, align: "right", valign: "middle" },
      ],
      ...rows.map(([title, value]) => [
        { text: title, align: "right", valign: "middle" },
        { text: value, align: "right", valign: "middle" },
      ]),
    ],
  };
}

function rich(title: string, blocks: any[]) {
  return {
    version: 1,
    is_rtl: true,
    blocks: [
      { type: "heading", text: title, size: 1 },
      { type: "divider" },
      ...blocks,
      { type: "footer", text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · پنل مالکیت" },
    ],
  };
}

async function ensureOwnerControlSchema(db: Pool) {
  await ensureOwnerGroupSchema(db);
  await db.query(
    "ALTER TABLE owner_group_registry ADD COLUMN IF NOT EXISTS maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE",
  ).catch(() => {});
  await db.query(
    "ALTER TABLE owner_group_registry ADD COLUMN IF NOT EXISTS operations_locked BOOLEAN NOT NULL DEFAULT FALSE",
  ).catch(() => {});
}

async function isOwner(db: Pool, userId: number, ownerIds: string[]) {
  if (new Set([...BUILTIN_OWNER_IDS, ...ownerIds]).has(String(userId))) return true;
  const result = await db.query(
    "SELECT 1 FROM bot_panel_owners WHERE user_id=$1 LIMIT 1",
    [userId],
  ).catch(() => ({ rowCount: 0 }));
  return Number(result.rowCount ?? 0) > 0;
}

async function resolveTelegramGroupId(db: Pool, reference: string) {
  const value = String(reference ?? "").trim();
  if (/^-?\d+$/.test(value)) {
    const chatId = Number(value);
    return Number.isSafeInteger(chatId) ? chatId : null;
  }

  if (!UUID_RE.test(value)) return null;

  await ensureGroupManagementCoreSchema(db);
  const result = await db.query(
    "SELECT telegram_chat_id FROM gm_groups WHERE group_id=$1 LIMIT 1",
    [value],
  ).catch(() => ({ rows: [] }));

  const chatId = Number(result.rows?.[0]?.telegram_chat_id);
  return Number.isSafeInteger(chatId) ? chatId : null;
}

async function locked(db: Pool, groupId: number) {
  const result = await db.query(
    "SELECT operations_locked,maintenance_mode FROM owner_group_registry WHERE group_id=$1 LIMIT 1",
    [groupId],
  ).catch(() => ({ rows: [] }));

  return {
    operationsLocked: result.rows?.[0]?.operations_locked === true,
    maintenance: result.rows?.[0]?.maintenance_mode === true,
  };
}

async function setGroupFlag(
  db: Pool,
  ownerId: number,
  groupId: number,
  field: "maintenance_mode" | "operations_locked",
  value: boolean,
) {
  await ensureOwnerControlSchema(db);
  await db.query(
    "UPDATE owner_group_registry SET " + field + "=$2,updated_at=NOW() WHERE group_id=$1",
    [groupId, value],
  );
  await auditOwnerGroup(
    db,
    ownerId,
    groupId,
    value ? field + ":enable" : field + ":disable",
    { value },
  );
}

async function getGroup(db: Pool, reference: string) {
  const chatId = await resolveTelegramGroupId(db, reference);
  if (chatId == null) throw new Error("شناسه گروه معتبر نیست.");

  await ensureOwnerControlSchema(db);
  const group = await getOwnerGroup(db, chatId, true);
  if (!group) throw new Error("گروه در سامانه پیدا نشد.");

  return { chatId, group };
}

async function subscriptionInfo(db: Pool, groupId: number) {
  const result = await db.query(
    `
      SELECT subscription_type,status,expires_at
      FROM bot_group_subscriptions
      WHERE group_id=$1
      ORDER BY CASE WHEN status IN ('ACTIVE','EXPIRING','LIFETIME') THEN 0 ELSE 1 END,id DESC
      LIMIT 1
    `,
    [groupId],
  ).catch(() => ({ rows: [] }));

  return result.rows?.[0] ?? null;
}

async function installationInfo(db: Pool, telegramChatId: number) {
  await ensureGroupManagementCoreSchema(db);
  const result = await db.query(
    `
      SELECT i.status,i.current_version,i.target_version,i.failure_code,i.failure_message,i.updated_at
      FROM gm_group_installations i
      JOIN gm_groups g ON g.group_id=i.group_id
      WHERE g.telegram_chat_id=$1
      LIMIT 1
    `,
    [telegramChatId],
  ).catch(() => ({ rows: [] }));

  return result.rows?.[0] ?? null;
}

async function runtimeInfo(db: Pool, telegramChatId: number) {
  await ensureGroupManagementCoreSchema(db);
  const result = await db.query(
    `
      SELECT service_status,last_error_code,last_error_at,last_message_at,last_reconcile_at
      FROM gm_group_runtime rt
      JOIN gm_groups g ON g.group_id=rt.group_id
      WHERE g.telegram_chat_id=$1
      LIMIT 1
    `,
    [telegramChatId],
  ).catch(() => ({ rows: [] }));

  return result.rows?.[0] ?? null;
}

async function sendRich(
  db: Pool,
  userId: number,
  chatId: number,
  document: any,
  markup: any,
  messageId?: number,
) {
  const prepared = prepareRichDocument(document);
  const validation = validateRichDocument(prepared);

  if (!validation.ok) {
    console.error("[group-pro] rich validation failed", validation.errors);
    return null;
  }

  const payload = {
    rich_message: {
      blocks: prepared.blocks,
      is_rtl: prepared.is_rtl,
    },
    reply_markup: markup || undefined,
  };

  const result = messageId
    ? await telegramApi("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        ...payload,
      }).catch((error) => {
        console.error("[group-pro] edit failed", error);
        return null;
      })
    : await telegramApi("sendRichMessage", {
        chat_id: chatId,
        ...payload,
      }).catch((error) => {
        console.error("[group-pro] send failed", error);
        return null;
      });

  if (result?.ok) {
    if (messageId) {
      await touchPanelMessage(db, chatId, messageId, userId).catch(() => {});
    } else {
      const newMessageId = Number((result.result as any)?.message_id);
      if (Number.isSafeInteger(newMessageId) && newMessageId > 0) {
        await bindPanelMessage(db, chatId, newMessageId, userId, "owner").catch(() => {});
      }
    }
  }

  return result;
}


async function botAddButton(db: Pool, chatId: number) {
  const me = await telegramApi<any>("getMe", {}).catch(() => ({ ok: false, result: null }));
  const username = String(me.result?.username ?? "").replace(/^@/, "");
  if (!username) return button("بررسی اتصال", "g:sync:" + chatId);
  return {
    text: "افزودن دوباره ربات",
    url: "https://t.me/" + encodeURIComponent(username) + "?startgroup=true",
  };
}

async function renderGroupHome(
  db: Pool,
  userId: number,
  chatId: number,
  messageId: number,
  reference: string,
) {
  const { chatId: groupId, group } = await getGroup(db, reference);
  const subscription = await subscriptionInfo(db, groupId);
  const installation = await installationInfo(db, groupId);
  const runtime = await runtimeInfo(db, groupId);
  const flags = await locked(db, groupId);

  const document = rich("مدیریت گروه‌ها", [
    { type: "paragraph", text: clean(group.title) },
    table("وضعیت مالکیتی", [
      ["شناسه گروه", String(group.group_id)],
      ["ربات", membershipLabel(group.bot_status)],
      ["سرویس", stateLabel(group.is_enabled === false ? "DISABLED" : group.bot_status)],
      ["دسترسی ربات", membershipLabel(group.telegram_status)],
      ["نصب", stateLabel(installation?.status ?? "UNINSTALLED")],
      ["سلامت", stateLabel(runtime?.service_status ?? (group.bot_status === "ERROR" ? "ERROR" : "ACTIVE"))],
      ["آخرین همگام‌سازی", faDate(group.last_sync_at)],
      ["آخرین فعالیت", faDate(group.last_activity_at)],
    ]),
    table("ارتباطات", [
      ["مشتری", clean(group.owner_name)],
      ["سرویس", clean(subscription?.subscription_type)],
      ["لایسنس", clean(subscription?.status)],
      ["انقضا", faDate(subscription?.expires_at)],
    ]),
    { type: "divider" },
    { type: "heading", text: "کنترل مالکیتی", size: 2 },
    {
      type: "paragraph",
      text:
        "این مرکز فقط کنترل ربات، سرویس، اتصال، نصب، ریست و وضعیت مالکیتی گروه را انجام می‌دهد. مدیریت روزمره گروه در پنل مشتری باقی می‌ماند.",
    },
    { type: "paragraph", text: flags.operationsLocked ? "قفل عملیاتی: فعال" : "قفل عملیاتی: غیرفعال" },
  ]);

  const statusButton = group.bot_status === "LEFT" || group.telegram_status === "left"
    ? await botAddButton(db, groupId)
    : group.is_enabled === false || group.bot_status === "DISABLED"
      ? colored("فعال‌سازی", "g:enable:" + groupId, "success")
      : colored("غیرفعال‌سازی", "g:disable:" + groupId, "danger");

  const markup = keyboard([
    [button("نمای کلی", "g:overview:" + groupId), button("کنترل ربات", "g:control:" + groupId)],
    [button("اتصال و استقرار", "g:deploy:" + groupId), button("وابستگی‌ها", "g:relations:" + groupId)],
    [button("سلامت", "g:health:" + groupId), button("لاگ عملیات", "g:logs:" + groupId)],
    [statusButton],
    [button("‹ بازگشت به گروه‌ها", "g:list")],
  ]);

  return sendRich(db, userId, chatId, document, markup, messageId);
}

async function renderOverview(
  db: Pool,
  userId: number,
  chatId: number,
  messageId: number,
  reference: string,
) {
  const { chatId: groupId, group } = await getGroup(db, reference);

  const document = rich("نمای کلی گروه", [
    { type: "paragraph", text: clean(group.title) },
    table("هویت", [
      ["شناسه Telegram", String(group.group_id)],
      ["نوع", clean(group.chat_type)],
      ["نام کاربری", group.username ? "@" + String(group.username).replace(/^@/, "") : "ثبت نشده"],
      ["عضو", String(group.member_count ?? 0)],
      ["مدیر", String(group.admin_count ?? 0)],
      ["مالک گروه", clean(group.owner_name)],
    ]),
    table("وضعیت", [
      ["ثبت", stateLabel(group.telegram_status)],
      ["نصب", stateLabel((await installationInfo(db, groupId))?.status ?? "UNINSTALLED")],
      ["ربات", membershipLabel(group.bot_status)],
      ["سلامت", stateLabel((await runtimeInfo(db, groupId))?.service_status ?? (group.bot_status === "ERROR" ? "ERROR" : "ACTIVE"))],
      ["آخرین همگام‌سازی", faDate(group.last_sync_at)],
    ]),
  ]);

  return sendRich(
    db,
    userId,
    chatId,
    document,
    keyboard([
      [button("کنترل ربات", "g:control:" + groupId), button("اتصال و استقرار", "g:deploy:" + groupId)],
      [colored("‹ بازگشت", "g:view:" + groupId, "primary")],
    ]),
    messageId,
  );
}

async function renderControl(
  db: Pool,
  userId: number,
  chatId: number,
  messageId: number,
  reference: string,
) {
  const { chatId: groupId, group } = await getGroup(db, reference);
  const flags = await locked(db, groupId);
  const active = group.is_enabled !== false && group.bot_status !== "DISABLED";

  const document = rich("کنترل ربات", [
    { type: "paragraph", text: clean(group.title) },
    table("وضعیت کنترل", [
      ["وضعیت سرویس", active ? "فعال" : "غیرفعال"],
      ["حالت تعمیر", flags.maintenance ? "فعال" : "غیرفعال"],
      ["قفل عملیاتی", flags.operationsLocked ? "فعال" : "غیرفعال"],
      ["عضویت ربات", membershipLabel(group.telegram_status)],
    ]),
    { type: "paragraph", text: "عملیات تغییردهندهٔ وضعیت در این بخش ثبت و در گزارش عملیات ذخیره می‌شوند." },
  ]);

  const rows: any[][] = [];
  rows.push([
    active
      ? colored("غیرفعال‌سازی", "g:disable:" + groupId, "danger")
      : colored("فعال‌سازی", "g:enable:" + groupId, "success"),
  ]);

  rows.push([
    button("راه‌اندازی مجدد", "g:restart:" + groupId),
    button("همگام‌سازی", "g:sync:" + groupId),
  ]);
  rows.push([
    button("اتصال مجدد", "g:reconnect:" + groupId),
    button("بازسازی سرویس", "g:rebuild:" + groupId),
  ]);
  rows.push([
    button(flags.maintenance ? "خروج از حالت تعمیر" : "ورود به حالت تعمیر", "g:maintenance:" + groupId),
    button(flags.operationsLocked ? "بازکردن قفل عملیاتی" : "قفل عملیاتی", "g:oplock:" + groupId),
  ]);
  rows.push([
    button("مرکز ریست", "g:reset:" + groupId),
    button("ارسال پیام", "g:message:" + groupId),
  ]);
  rows.push([button("خروج ربات از گروه", "g:leave:" + groupId)]);
  rows.push([colored("‹ بازگشت", "g:view:" + groupId, "primary")]);

  return sendRich(db, userId, chatId, document, keyboard(rows), messageId);
}

async function renderDeploy(
  db: Pool,
  userId: number,
  chatId: number,
  messageId: number,
  reference: string,
) {
  const { chatId: groupId, group } = await getGroup(db, reference);
  const installation = await installationInfo(db, groupId);

  const document = rich("اتصال و استقرار", [
    { type: "paragraph", text: clean(group.title) },
    table("استقرار", [
      ["وضعیت نصب", stateLabel(installation?.status ?? "UNINSTALLED")],
      ["نسخه فعلی", clean(installation?.current_version)],
      ["نسخه هدف", clean(installation?.target_version)],
      ["کد خطا", clean(installation?.failure_code)],
      ["پیام خطا", clean(installation?.failure_message)],
      ["آخرین بروزرسانی", faDate(installation?.updated_at)],
    ]),
    { type: "paragraph", text: "نصب و بازنصب فقط چرخهٔ سرویس همان گروه را تغییر می‌دهد و داده‌های مشتری را به‌صورت خودکار حذف نمی‌کند." },
  ]);

  return sendRich(
    db,
    userId,
    chatId,
    document,
    keyboard([
      [button("نصب یا ادامه نصب", "g:install:" + groupId), button("بازنصب سرویس", "g:reinstall:" + groupId)],
      [button("بررسی و همگام‌سازی", "g:sync:" + groupId)],
      [colored("‹ بازگشت", "g:view:" + groupId, "primary")],
    ]),
    messageId,
  );
}

async function renderRelations(
  db: Pool,
  userId: number,
  chatId: number,
  messageId: number,
  reference: string,
) {
  const { chatId: groupId, group } = await getGroup(db, reference);
  const subscription = await subscriptionInfo(db, groupId);

  const document = rich("وابستگی‌های گروه", [
    { type: "paragraph", text: clean(group.title) },
    table("رابطه‌های فعلی", [
      ["مشتری", clean(group.owner_name)],
      ["سرویس", clean(subscription?.subscription_type)],
      ["وضعیت اشتراک", clean(subscription?.status)],
      ["تاریخ پایان", faDate(subscription?.expires_at)],
      ["شناسه گروه", String(groupId)],
      ["ربات", membershipLabel(group.bot_status)],
    ]),
    {
      type: "paragraph",
      text: "تغییر مشتری، سرویس و لایسنس در مدیریت‌های مستقل خود انجام می‌شود تا مالکیت داده‌ها و چرخهٔ اشتراک با کنترل گروه قاطی نشود.",
    },
  ]);

  return sendRich(
    db,
    userId,
    chatId,
    document,
    keyboard([[colored("‹ بازگشت", "g:view:" + groupId, "primary")]]),
    messageId,
  );
}

async function renderHealth(
  db: Pool,
  userId: number,
  chatId: number,
  messageId: number,
  reference: string,
) {
  const { chatId: groupId, group } = await getGroup(db, reference);
  const installation = await installationInfo(db, groupId);
  const runtime = await runtimeInfo(db, groupId);

  const document = rich("سلامت گروه", [
    { type: "paragraph", text: clean(group.title) },
    table("وضعیت", [
      ["عضویت ربات", membershipLabel(group.telegram_status)],
      ["وضعیت ربات", stateLabel(group.bot_status)],
      ["وضعیت سرویس", stateLabel(runtime?.service_status ?? "UNKNOWN")],
      ["وضعیت نصب", stateLabel(installation?.status ?? "UNINSTALLED")],
      ["تعداد اعضا", String(group.member_count ?? 0)],
      ["تعداد مدیران", String(group.admin_count ?? 0)],
      ["آخرین همگام‌سازی", faDate(group.last_sync_at)],
      ["آخرین فعالیت", faDate(group.last_activity_at)],
      ["آخرین خطا", clean(group.last_error_message)],
      ["کد خطا", clean(group.last_error_code)],
    ]),
  ]);

  return sendRich(
    db,
    userId,
    chatId,
    document,
    keyboard([
      [button("بازبینی سلامت", "g:sync:" + groupId)],
      [colored("‹ بازگشت", "g:view:" + groupId, "primary")],
    ]),
    messageId,
  );
}

async function renderLogs(
  db: Pool,
  userId: number,
  chatId: number,
  messageId: number,
  reference: string,
) {
  const { chatId: groupId, group } = await getGroup(db, reference);
  const logs = await getOwnerGroupLogs(db, groupId, 12);
  const rows: Array<[string, string]> = (logs || []).map((row: any) => [
    clean(row.action),
    clean(row.result) + " · " + faDate(row.created_at),
  ]);

  const document = rich("لاگ عملیات گروه", [
    { type: "paragraph", text: clean(group.title) },
    table("آخرین عملیات", rows.length ? rows : [["رویداد", "ثبت نشده"]]),
    { type: "paragraph", text: "این گزارش فقط عملیات مالکیتی همین گروه را نشان می‌دهد." },
  ]);

  return sendRich(
    db,
    userId,
    chatId,
    document,
    keyboard([
      [button("بروزرسانی", "g:logs:" + groupId)],
      [colored("‹ بازگشت", "g:view:" + groupId, "primary")],
    ]),
    messageId,
  );
}

async function renderReset(
  db: Pool,
  userId: number,
  chatId: number,
  messageId: number,
  reference: string,
) {
  const { chatId: groupId, group } = await getGroup(db, reference);

  const document = rich("مرکز ریست", [
    { type: "paragraph", text: clean(group.title) },
    table("سطح‌های موجود", [
      ["تنظیمات", "فقط پیکربندی گروه"],
      ["محتوا", "پیام‌ها و محتوای ذخیره‌شده"],
      ["هشدارها", "داده‌های هشدار و رویدادهای مرتبط"],
      ["مدیریت", "تنظیمات مدیریتی ذخیره‌شده"],
      ["کامل", "تمام داده‌های مدیریت‌شدهٔ گروه"],
    ]),
    { type: "paragraph", text: "ریست کامل عملیات برگشت‌پذیر خودکار ندارد و قبل از اجرا باید تأیید شود." },
  ]);

  return sendRich(
    db,
    userId,
    chatId,
    document,
    keyboard([
      [button("ریست تنظیمات", "g:reset_exec:" + groupId + ":config")],
      [button("ریست محتوا", "g:reset_exec:" + groupId + ":messages")],
      [button("ریست هشدارها", "g:reset_exec:" + groupId + ":warnings")],
      [button("ریست مدیریت", "g:reset_exec:" + groupId + ":management")],
      [button("ریست کامل", "g:reset_confirm:" + groupId)],
      [colored("‹ بازگشت", "g:control:" + groupId, "primary")],
    ]),
    messageId,
  );
}

async function renderLeaveConfirm(
  db: Pool,
  userId: number,
  chatId: number,
  messageId: number,
  reference: string,
) {
  const { chatId: groupId, group } = await getGroup(db, reference);

  const document = rich("خروج ربات از گروه", [
    { type: "paragraph", text: clean(group.title) },
    table("اثر عملیات", [
      ["ربات", "از گروه خارج می‌شود"],
      ["سابقه", "در سامانه باقی می‌ماند"],
      ["اتصال", "وضعیت آن به خروج تغییر می‌کند"],
      ["بازیابی", "برای ورود دوباره، ربات باید مجدداً به گروه اضافه شود"],
    ]),
    { type: "paragraph", text: "این عملیات مدیریت روزمره گروه را حذف نمی‌کند؛ فقط حضور ربات را قطع می‌کند." },
  ]);

  return sendRich(
    db,
    userId,
    chatId,
    document,
    keyboard([
      [button("تأیید خروج ربات", "g:leave_exec:" + groupId)],
      [colored("‹ لغو", "g:control:" + groupId, "primary")],
    ]),
    messageId,
  );
}

async function renderMessagePrompt(
  db: Pool,
  userId: number,
  chatId: number,
  messageId: number,
  reference: string,
) {
  const { chatId: groupId, group } = await getGroup(db, reference);
  inputFlows.set(userId, {
    messageId,
    expires: Date.now() + 10 * 60 * 1000,
    mode: "message",
  });
  messageTargets.set(userId, groupId);

  const document = rich("ارسال پیام به گروه", [
    { type: "paragraph", text: clean(group.title) },
    table("مقصد", [
      ["شناسه گروه", String(groupId)],
      ["وضعیت ربات", membershipLabel(group.bot_status)],
    ]),
    { type: "paragraph", text: "متن پیام را همین‌جا ارسال کنید. پیام توسط ربات به گروه فرستاده می‌شود." },
  ]);

  return sendRich(
    db,
    userId,
    chatId,
    document,
    keyboard(back("g:control:" + groupId)),
    messageId,
  );
}

async function runOwnerAction(
  db: Pool,
  userId: number,
  chatId: number,
  messageId: number,
  reference: string,
  action: string,
) {
  const { chatId: groupId, group } = await getGroup(db, reference);
  const controls = await locked(db, groupId);

  const mutationActions = new Set([
    "enable",
    "disable",
    "restart",
    "sync",
    "reconnect",
    "rebuild",
    "maintenance",
    "oplock",
    "install",
    "reinstall",
    "leave",
    "reset_exec",
  ]);

  if (controls.operationsLocked && mutationActions.has(action) && action !== "oplock") {
    return sendRich(
      db,
      userId,
      chatId,
      rich("قفل عملیاتی", [
        { type: "paragraph", text: "عملیات تغییردهنده برای این گروه قفل شده است." },
        { type: "paragraph", text: "ابتدا قفل عملیاتی را باز کنید." },
      ]),
      keyboard([[button("بازکردن قفل عملیاتی", "g:oplock:" + groupId)], ...back("g:view:" + groupId)]),
      messageId,
    );
  }

  try {
    if (action === "enable") {
      await setOwnerGroupEnabled(db, userId, groupId, true);
      await reconcileGroup(db, String((await getGroup(db, reference)).group.group_id)).catch(() => {});
      return renderGroupHome(db, userId, chatId, messageId, String(groupId));
    }

    if (action === "disable") {
      await setOwnerGroupEnabled(db, userId, groupId, false);
      return renderGroupHome(db, userId, chatId, messageId, String(groupId));
    }

    if (action === "sync") {
      await syncOwnerGroup(db, groupId);
      await reconcileGroup(db, String((await getGroup(db, reference)).group.group_id)).catch(() => {});
      return renderHealth(db, userId, chatId, messageId, String(groupId));
    }

    if (action === "reconnect") {
      await syncOwnerGroup(db, groupId);
      await setOwnerGroupEnabled(db, userId, groupId, group.is_enabled !== false);
      return renderHealth(db, userId, chatId, messageId, String(groupId));
    }

    if (action === "restart" || action === "rebuild") {
      await db.query(
        "UPDATE owner_group_registry SET bot_status='SYNCING',updated_at=NOW() WHERE group_id=$1",
        [groupId],
      );
      await syncOwnerGroup(db, groupId);
      await reconcileGroup(db, String((await getGroup(db, reference)).group.group_id)).catch(() => {});
      await auditOwnerGroup(db, userId, groupId, action, { mode: "group-context-rebuild" });
      return renderOperationResult(
        db,
        userId,
        chatId,
        messageId,
        groupId,
        action === "restart" ? "راه‌اندازی مجدد" : "بازسازی سرویس",
        "وضعیت Runtime، اتصال Telegram و Context گروه دوباره ساخته و همگام شد.",
      );
    }

    if (action === "maintenance") {
      const next = !(await locked(db, groupId)).maintenance;
      await setGroupFlag(db, userId, groupId, "maintenance_mode", next);
      return renderControl(db, userId, chatId, messageId, String(groupId));
    }

    if (action === "oplock") {
      const next = !(await locked(db, groupId)).operationsLocked;
      await setGroupFlag(db, userId, groupId, "operations_locked", next);
      return renderControl(db, userId, chatId, messageId, String(groupId));
    }

    if (action === "install" || action === "reinstall") {
      await installGroup(db, userId, String((await getGroup(db, reference)).group.group_id));
      await syncOwnerGroup(db, groupId).catch(() => {});
      return renderDeploy(db, userId, chatId, messageId, String(groupId));
    }

    if (action === "leave") {
      return renderLeaveConfirm(db, userId, chatId, messageId, String(groupId));
    }

    throw new Error("عملیات ناشناخته است.");
  } catch (error) {
    return renderOperationResult(
      db,
      userId,
      chatId,
      messageId,
      groupId,
      "خطای عملیات",
      "عملیات انجام نشد.\n\nدلیل: " + (error instanceof Error ? error.message : String(error)),
    );
  }
}

async function renderOperationResult(
  db: Pool,
  userId: number,
  chatId: number,
  messageId: number,
  groupId: number,
  title: string,
  message: string,
) {
  return sendRich(
    db,
    userId,
    chatId,
    rich(title, [
      { type: "paragraph", text: message },
      table("شناسه عملیات", [
        ["گروه", String(groupId)],
        ["زمان", faDate(new Date())],
      ]),
    ]),
    keyboard([
      [button("مشاهده گروه", "g:view:" + groupId)],
      [colored("‹ بازگشت", "g:control:" + groupId, "primary")],
    ]),
    messageId,
  );
}

async function handleAction(
  db: Pool,
  userId: number,
  chatId: number,
  messageId: number,
  data: string,
) {
  if (data === "g:home") return renderGroupHub(db, userId, chatId, messageId);

  if (data === "g:list" || data.startsWith("g:list:")) {
    const page = Math.max(1, Number(data.split(":")[2] || 1));
    return renderGroupList(db, userId, chatId, messageId, page);
  }

  if (data === "g:global") {
    inputFlows.set(userId, {
      messageId,
      expires: Date.now() + 10 * 60 * 1000,
      mode: "group",
    });
    return sendRich(
      db,
      userId,
      chatId,
      rich("شناسایی گروه", [
        { type: "paragraph", text: "شناسه گروه، نام کاربری یا لینک عمومی گروه را ارسال کنید." },
        table("نمونه ورودی", [
          ["شناسه", "-1001234567890"],
          ["نام کاربری", "@groupname"],
          ["لینک عمومی", "https://t.me/groupname"],
        ]),
      ]),
      keyboard(back("g:home")),
      messageId,
    );
  }

  if (data.startsWith("g:view:")) return renderGroupHome(db, userId, chatId, messageId, data.slice(7));
  if (data.startsWith("g:overview:")) return renderOverview(db, userId, chatId, messageId, data.slice(10));
  if (data.startsWith("g:control:")) return renderControl(db, userId, chatId, messageId, data.slice(9));
  if (data.startsWith("g:deploy:")) return renderDeploy(db, userId, chatId, messageId, data.slice(9));
  if (data.startsWith("g:relations:")) return renderRelations(db, userId, chatId, messageId, data.slice(12));
  if (data.startsWith("g:health:")) return renderHealth(db, userId, chatId, messageId, data.slice(9));
  if (data.startsWith("g:logs:")) return renderLogs(db, userId, chatId, messageId, data.slice(7));
  if (data.startsWith("g:reset:")) return renderReset(db, userId, chatId, messageId, data.slice(8));

  if (data.startsWith("g:enable:")) return runOwnerAction(db, userId, chatId, messageId, data.slice(9), "enable");
  if (data.startsWith("g:disable:")) return runOwnerAction(db, userId, chatId, messageId, data.slice(10), "disable");
  if (data.startsWith("g:restart:")) return runOwnerAction(db, userId, chatId, messageId, data.slice(10), "restart");
  if (data.startsWith("g:sync:")) return runOwnerAction(db, userId, chatId, messageId, data.slice(7), "sync");
  if (data.startsWith("g:reconnect:")) return runOwnerAction(db, userId, chatId, messageId, data.slice(12), "reconnect");
  if (data.startsWith("g:rebuild:")) return runOwnerAction(db, userId, chatId, messageId, data.slice(10), "rebuild");
  if (data.startsWith("g:maintenance:")) return runOwnerAction(db, userId, chatId, messageId, data.slice(14), "maintenance");
  if (data.startsWith("g:oplock:")) return runOwnerAction(db, userId, chatId, messageId, data.slice(9), "oplock");
  if (data.startsWith("g:install:")) return runOwnerAction(db, userId, chatId, messageId, data.slice(10), "install");
  if (data.startsWith("g:reinstall:")) return runOwnerAction(db, userId, chatId, messageId, data.slice(13), "reinstall");
  if (data.startsWith("g:leave:")) return runOwnerAction(db, userId, chatId, messageId, data.slice(8), "leave");

  if (data.startsWith("g:leave_exec:")) {
    const groupId = Number(data.slice(13));
    if (!Number.isSafeInteger(groupId)) return false;

    try {
      await leaveOwnerGroup(db, userId, groupId);
      return renderOperationResult(
        db,
        userId,
        chatId,
        messageId,
        groupId,
        "خروج ربات",
        "ربات با موفقیت از گروه خارج شد. رکورد مالکیتی گروه حفظ شده است.",
      );
    } catch (error) {
      return renderOperationResult(
        db,
        userId,
        chatId,
        messageId,
        groupId,
        "خروج ربات",
        "خروج انجام نشد.\n\nدلیل: " + (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  if (data.startsWith("g:reset_exec:")) {
    const parts = data.split(":");
    const groupId = Number(parts[2]);
    const scope = parts[3] as "config" | "messages" | "warnings" | "management" | undefined;
    if (!Number.isSafeInteger(groupId) || !scope) return false;

    const controls = await locked(db, groupId);
    if (controls.operationsLocked) {
      return sendRich(
        db,
        userId,
        chatId,
        rich("قفل عملیاتی", [{ type: "paragraph", text: "ریست گروه تا زمان بازکردن قفل عملیاتی مجاز نیست." }]),
        keyboard(back("g:reset:" + groupId)),
        messageId,
      );
    }

    try {
      await resetOwnerGroup(db, userId, groupId, scope);
      return renderOperationResult(
        db,
        userId,
        chatId,
        messageId,
        groupId,
        "ریست گروه",
        "سطح انتخاب‌شده با موفقیت اجرا شد و داده‌های خارج از همان سطح دست‌کاری نشد.",
      );
    } catch (error) {
      return renderOperationResult(
        db,
        userId,
        chatId,
        messageId,
        groupId,
        "ریست گروه",
        "ریست انجام نشد.\n\nدلیل: " + (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  if (data.startsWith("g:reset_confirm:")) {
    const groupId = Number(data.slice(16));
    if (!Number.isSafeInteger(groupId)) return false;

    return sendRich(
      db,
      userId,
      chatId,
      rich("تأیید ریست کامل", [
        { type: "paragraph", text: "این عملیات تمام داده‌های مدیریت‌شدهٔ گروه را در Scope پشتیبانی‌شده حذف می‌کند." },
        table("گروه", [["شناسه", String(groupId)]]),
      ]),
      keyboard([
        [button("تأیید ریست کامل", "g:reset_full:" + groupId)],
        [colored("‹ لغو", "g:reset:" + groupId, "primary")],
      ]),
      messageId,
    );
  }

  if (data.startsWith("g:reset_full:")) {
    const groupId = Number(data.slice(13));
    if (!Number.isSafeInteger(groupId)) return false;

    const controls = await locked(db, groupId);
    if (controls.operationsLocked) {
      return sendRich(
        db,
        userId,
        chatId,
        rich("قفل عملیاتی", [{ type: "paragraph", text: "ریست کامل تا زمان بازکردن قفل عملیاتی مجاز نیست." }]),
        keyboard(back("g:reset:" + groupId)),
        messageId,
      );
    }

    try {
      await resetOwnerGroup(db, userId, groupId, "full");
      return renderOperationResult(
        db,
        userId,
        chatId,
        messageId,
        groupId,
        "ریست کامل",
        "ریست کامل اجرا شد و رکورد مالکیتی، لایسنس و سابقه عملیات حذف نشد.",
      );
    } catch (error) {
      return renderOperationResult(
        db,
        userId,
        chatId,
        messageId,
        groupId,
        "ریست کامل",
        "ریست کامل انجام نشد.\n\nدلیل: " + (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  if (data.startsWith("g:message:")) {
    const groupId = Number(data.slice(10));
    if (!Number.isSafeInteger(groupId)) return false;
    const controls = await locked(db, groupId);
    if (controls.operationsLocked) {
      return sendRich(
        db,
        userId,
        chatId,
        rich("قفل عملیاتی", [
          { type: "paragraph", text: "ارسال پیام نیز تا زمان بازکردن قفل عملیاتی متوقف است." },
        ]),
        keyboard(back("g:control:" + groupId)),
        messageId,
      );
    }
    return renderMessagePrompt(db, userId, chatId, messageId, String(groupId));
  }

  // Compatibility with the previous group-pro callbacks:
  // all old module screens are redirected to the new owner control architecture.
  if (data.startsWith("g:module:")) {
    const parts = data.split(":");
    const groupId = parts[2];
    const module = parts.slice(3).join(":");
    if (module === "health") return renderHealth(db, userId, chatId, messageId, groupId);
    if (module === "installation") return renderDeploy(db, userId, chatId, messageId, groupId);
    if (module === "activity" || module === "audit") return renderLogs(db, userId, chatId, messageId, groupId);
    return renderOverview(db, userId, chatId, messageId, groupId);
  }

  return false;
}

async function renderGroupList(
  db: Pool,
  userId: number,
  chatId: number,
  messageId: number,
  page: number,
) {
  await ensureOwnerControlSchema(db);
  const limit = 8;
  const offset = (Math.max(1, page) - 1) * limit;
  const result = await listOwnerGroups(db, { limit, offset });
  const overview = await ownerGroupOverview(db);

  const rows = (result.rows || []).map((group: any) => [
    button(clean(group.title).slice(0, 40), "g:view:" + String(group.group_id)),
  ]);

  const navigation: any[] = [];
  if (page > 1) navigation.push(button("صفحه قبل", "g:list:" + String(page - 1)));
  if (offset + limit < Number(result.total || 0)) navigation.push(button("صفحه بعد", "g:list:" + String(page + 1)));
  if (navigation.length) rows.push(navigation);

  rows.push([colored("‹ بازگشت", "g:home", "primary")]);

  const document = rich("گروه‌های تحت مدیریت", [
    table("وضعیت مرکز", [
      ["کل گروه‌ها", String(numberValue(overview.total))],
      ["فعال", String(numberValue(overview.active))],
      ["غیرفعال", String(numberValue(overview.disabled))],
      ["خطادار", String(numberValue(overview.error))],
      ["خارج‌شده", String(numberValue(overview.left_groups))],
    ]),
    { type: "paragraph", text: "یک گروه را انتخاب کنید تا فقط کنترل مالکیتی ربات روی همان گروه باز شود." },
  ]);

  return sendRich(db, userId, chatId, document, keyboard(rows), messageId);
}

async function renderGroupHub(
  db: Pool,
  userId: number,
  chatId: number,
  messageId: number,
) {
  await ensureOwnerControlSchema(db);
  const overview = await ownerGroupOverview(db);

  const document = rich("مرکز مدیریت گروه‌ها", [
    { type: "paragraph", text: "مدیریت مالکیتی اتصال ربات به گروه‌ها" },
    table("وضعیت مرکز", [
      ["کل گروه‌ها", String(numberValue(overview.total))],
      ["فعال", String(numberValue(overview.active))],
      ["غیرفعال", String(numberValue(overview.disabled))],
      ["محدود", String(numberValue(overview.restricted))],
      ["خطادار", String(numberValue(overview.error))],
      ["خارج‌شده", String(numberValue(overview.left_groups))],
    ]),
    { type: "paragraph", text: "مدیریت اعضا، مدیران، قفل‌ها، دستورات و تنظیمات روزمره در محدودهٔ مشتری است و اینجا تکرار نمی‌شود." },
  ]);

  return sendRich(
    db,
    userId,
    chatId,
    document,
    keyboard([
      [button("فهرست گروه‌ها", "g:list"), button("شناسایی گروه", "g:global")],
      [colored("‹ بازگشت", "o:home", "primary")],
    ]),
    messageId,
  );
}

async function handleTextInput(db: Pool, message: TgMessage) {
  if (!message.from) return false;

  const userId = message.from.id;
  const active = inputFlows.get(userId);
  const text = String(message.text ?? message.caption ?? "").trim();

  if (!active) return false;
  if (active.expires < Date.now()) {
    inputFlows.delete(userId);
    messageTargets.delete(userId);
    return false;
  }
  if (!text) return false;

  if (active.mode === "group") {
    inputFlows.delete(userId);

    try {
      const resolved = /^-?\d+$/.test(text)
        ? text
        : text.replace(/^https?:\/\/(?:www\.)?t\.me\//i, "").replace(/^@/, "");

      const groupId = await resolveTelegramGroupId(db, resolved);
      if (groupId == null) {
        return !!(await sendRich(
          db,
          userId,
          message.chat.id,
          rich("شناسایی گروه", [{ type: "paragraph", text: "گروه پیدا نشد یا شناسه قابل استفاده نیست." }]),
          keyboard(back("g:home")),
          active.messageId,
        ));
      }

      return !!(await renderGroupHome(db, userId, message.chat.id, active.messageId, String(groupId)));
    } catch (error) {
      return !!(await sendRich(
        db,
        userId,
        message.chat.id,
        rich("شناسایی گروه", [
          { type: "paragraph", text: "شناسایی انجام نشد." },
          { type: "paragraph", text: "دلیل: " + (error instanceof Error ? error.message : String(error)) },
        ]),
        keyboard(back("g:home")),
        active.messageId,
      ));
    }
  }

  if (active.mode === "message") {
    const boundChatId = Number(messageTargets.get(userId));
    inputFlows.delete(userId);
    messageTargets.delete(userId);

    if (!Number.isSafeInteger(boundChatId)) {
      return !!(await sendRich(
        db,
        userId,
        message.chat.id,
        rich("ارسال پیام", [{ type: "paragraph", text: "مقصد پیام پیدا نشد." }]),
        keyboard(back("g:home")),
        active.messageId,
      ));
    }

    try {
      await sendMessageToOwnerGroup(db, userId, boundChatId, text);
      return !!(await sendRich(
        db,
        userId,
        message.chat.id,
        rich("ارسال پیام", [{ type: "paragraph", text: "پیام با موفقیت ارسال شد." }]),
        keyboard(back("g:control:" + boundChatId)),
        active.messageId,
      ));
    } catch (error) {
      return !!(await sendRich(
        db,
        userId,
        message.chat.id,
        rich("ارسال پیام", [
          { type: "paragraph", text: "ارسال پیام انجام نشد." },
          { type: "paragraph", text: "دلیل: " + (error instanceof Error ? error.message : String(error)) },
        ]),
        keyboard(back("g:control:" + boundChatId)),
        active.messageId,
      ));
    }
  }

  return false;
}

export async function groupProCallback(
  db: Pool,
  callback: TgCallback,
  ownerIds: string[],
  authenticated = true,
) {
  if (!callback.message) return false;

  const userId = callback.from.id;
  if (!(await isOwner(db, userId, ownerIds)) || !authenticated) {
    await telegramApi("editMessageText", {
      chat_id: callback.message.chat.id,
      message_id: callback.message.message_id,
      rich_message: {
        blocks: prepareRichDocument(
          rich("دسترسی مالکیتی", [
            { type: "paragraph", text: "دسترسی این مرکز برای شما فعال نیست." },
          ]),
        ).blocks,
        is_rtl: true,
      },
      reply_markup: keyboard(back("o:home")),
    }).catch(() => {});
    return true;
  }

  try {
    return (await handleAction(
      db,
      userId,
      callback.message.chat.id,
      Number(callback.message.message_id),
      String(callback.data ?? ""),
    )) ?? false;
  } catch (error) {
    console.error("[group-pro] callback failed", error);
    await sendRich(
      db,
      userId,
      callback.message.chat.id,
      rich("خطای مرکز مدیریت گروه‌ها", [
        { type: "paragraph", text: "عملیات کامل نشد." },
        { type: "paragraph", text: "دلیل: " + (error instanceof Error ? error.message : String(error)) },
      ]),
      keyboard(back("g:home")),
      Number(callback.message.message_id),
    );
    return true;
  }
}

export async function handleGroupProTextInput(db: Pool, message: TgMessage) {
  return handleTextInput(db, message);
}
