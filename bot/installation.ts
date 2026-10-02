import type { Pool } from "pg";
import { telegramApi } from "../src/lib/telegram/api.ts";
import {
  prepareRichDocument,
  validateRichDocument,
  richDocumentToPlainText,
  type RichDocument,
} from "../src/lib/bot/rich-message.ts";

type TgUser = {
  id: number;
  first_name?: string;
  username?: string;
};

type TgChat = {
  id: number;
  type: string;
  title?: string;
  username?: string;
};

type TgMessage = {
  message_id: number;
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

export type InstallationGateResult = "handled" | "allow" | "drop";

type ButtonStyle = "primary" | "success" | "danger";

const VERSION = process.env.NIZAM_PANEL_VERSION || "v1.0.0";
const BUILTIN_OWNER_IDS = ["8247710529"];
const PANEL_URL = String(process.env.PANEL_URL || "").replace(/\/$/, "");

let schemaReadyPromise: Promise<void> | null = null;
let botIdentityPromise: Promise<{ ok: boolean; id?: number }> | null = null;

const permissionCache = new Map<
  number,
  { expiresAt: number; result: Awaited<ReturnType<typeof permissionCheckInternal>> }
>();

const PERMISSION_CACHE_MS = 15_000;

function norm(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function plain(value: unknown) {
  return norm(value).replace(/^[/!.]+/, "").trim();
}

function authorized(userId: number, owners: string[], sudo: string[]) {
  return new Set([...BUILTIN_OWNER_IDS, ...owners, ...sudo].filter(Boolean)).has(String(userId));
}

function isInstallText(value: unknown) {
  return [
    "install",
    "نصب",
    "نصب ربات",
    "راه اندازی",
    "راه‌اندازی",
    "شروع نصب",
    "group install",
    "group installation",
  ].includes(plain(value));
}

function isUninstallText(value: unknown) {
  return [
    "uninstall",
    "حذف نصب",
    "حذف نصب ربات",
    "غیرفعال",
    "غیرفعال‌سازی",
    "غیرفعال سازی",
    "غیرفعال‌سازی ربات",
    "uninstall bot",
  ].includes(plain(value));
}

function button(text: string, callbackData: string, style?: ButtonStyle) {
  return style
    ? { text, callback_data: callbackData, style }
    : { text, callback_data: callbackData };
}

function buttons(
  items: Array<{ text: string; callback_data?: string; url?: string; style?: ButtonStyle }>,
) {
  return {
    type: "buttons",
    align: "center",
    buttons: items,
  };
}

function table(caption: string, rows: Array<[string, string]>) {
  return {
    type: "table",
    caption,
    is_bordered: true,
    is_striped: true,
    is_compact: false,
    cells: [
      [
        { text: "شاخص", is_header: true, align: "right", valign: "middle" },
        { text: "مقدار", is_header: true, align: "right", valign: "middle" },
      ],
      ...rows.map(([label, value]) => [
        { text: label, align: "right", valign: "middle" },
        { text: value, align: "right", valign: "middle" },
      ]),
    ],
  };
}

function list(items: string[]) {
  return {
    type: "list",
    items: items.map((text) => ({
      blocks: [{ type: "paragraph", text }],
    })),
  };
}

function base(title: string, subtitle: string): any[] {
  return [
    {
      type: "heading",
      text: "◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · " + title,
      size: 1,
    },
    { type: "paragraph", text: subtitle },
    { type: "divider" },
  ];
}

function doc(blocks: any[]): RichDocument {
  return prepareRichDocument({
    version: 1,
    is_rtl: true,
    blocks,
  });
}

function validate(document: RichDocument) {
  const result = validateRichDocument(document);
  if (!result.ok) {
    console.error("[installation] rich validation failed:", result.errors);
  }
  return document;
}

function richReplyMarkup(document: RichDocument) {
  const rows = document.blocks
    .filter((block: any) => block?.type === "buttons" && Array.isArray(block.buttons))
    .map((block: any) =>
      block.buttons
        .filter((item: any) => item?.callback_data || item?.url)
        .map((item: any) =>
          item?.url
            ? {
                text: String(item.text ?? "—"),
                url: String(item.url),
              }
            : {
                text: String(item.text ?? "—"),
                callback_data: String(item.callback_data),
                ...(item.style ? { style: item.style } : {}),
              },
        ),
    )
    .filter((row: any[]) => row.length > 0);

  return rows.length ? { inline_keyboard: rows } : undefined;
}

function richDocumentWithoutButtons(document: RichDocument): RichDocument {
  return {
    ...document,
    blocks: document.blocks.filter((block: any) => block?.type !== "buttons"),
  };
}

async function render(
  chatId: number,
  messageId: number | undefined,
  document: RichDocument,
) {
  const rich = validate(document);
  const reply_markup = richReplyMarkup(rich);
  const richBody = richDocumentWithoutButtons(rich);
  const plainText = richDocumentToPlainText(richBody);

  try {
    const richResult = messageId
      ? await telegramApi("editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          rich_message: richBody,
          ...(reply_markup ? { reply_markup } : {}),
        })
      : await telegramApi("sendRichMessage", {
          chat_id: chatId,
          rich_message: richBody,
          ...(reply_markup ? { reply_markup } : {}),
        });

    if ((richResult as any)?.ok === true) return richResult;
    console.warn("[installation] Rich Message render failed; using plain fallback");
  } catch (error) {
    console.warn("[installation] Rich Message render failed; using plain fallback", error);
  }

  return messageId
    ? telegramApi("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: plainText,
        ...(reply_markup ? { reply_markup } : {}),
      })
    : telegramApi("sendMessage", {
        chat_id: chatId,
        text: plainText,
        ...(reply_markup ? { reply_markup } : {}),
      });
}

async function answer(id: string, text = "") {
  return telegramApi("answerCallbackQuery", {
    callback_query_id: id,
    ...(text ? { text } : {}),
  }).catch(() => ({ ok: false }));
}

async function ensureSchemaInternal(pool: Pool) {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS bot_group_installations (" +
      "group_id BIGINT PRIMARY KEY," +
      "installed BOOLEAN NOT NULL DEFAULT FALSE," +
      "installed_at TIMESTAMPTZ," +
      "installed_by BIGINT," +
      "uninstalled_at TIMESTAMPTZ," +
      "uninstalled_by BIGINT," +
      "installation_version TEXT NOT NULL DEFAULT 'v1.0.0'," +
      "bot_permission_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb," +
      "response_policy TEXT NOT NULL DEFAULT 'standard'," +
      "member_message_policy TEXT NOT NULL DEFAULT 'silent'," +
      "command_policy TEXT NOT NULL DEFAULT 'enabled'," +
      "command_mode TEXT NOT NULL DEFAULT 'plain'," +
      "automation_enabled BOOLEAN NOT NULL DEFAULT FALSE," +
      "security_mode TEXT NOT NULL DEFAULT 'standard'," +
      "audit_enabled BOOLEAN NOT NULL DEFAULT TRUE," +
      "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()" +
      ")",
  );

  await pool.query(
    "CREATE TABLE IF NOT EXISTS bot_installation_events (" +
      "id BIGSERIAL PRIMARY KEY," +
      "group_id BIGINT NOT NULL," +
      "actor_id BIGINT NOT NULL," +
      "event_type TEXT NOT NULL," +
      "metadata JSONB NOT NULL DEFAULT '{}'::jsonb," +
      "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()" +
      ")",
  );

  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_bot_installation_events_group_time " +
      "ON bot_installation_events(group_id,created_at DESC)",
  );
}

async function ensureSchema(pool: Pool) {
  if (!schemaReadyPromise) {
    schemaReadyPromise = ensureSchemaInternal(pool).catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  await schemaReadyPromise;
}

async function ensureGroup(pool: Pool, chat: TgChat) {
  await pool.query(
    "INSERT INTO bot_groups(id,title,username,type,is_active,updated_at) " +
      "VALUES($1,$2,$3,$4,TRUE,NOW()) " +
      "ON CONFLICT(id) DO UPDATE SET " +
      "title=EXCLUDED.title,username=EXCLUDED.username,type=EXCLUDED.type," +
      "is_active=TRUE,updated_at=NOW()",
    [
      String(chat.id),
      chat.title || "",
      chat.username || null,
      chat.type || "supergroup",
    ],
  );

  await pool.query(
    "INSERT INTO bot_group_installations(group_id) VALUES($1) " +
      "ON CONFLICT(group_id) DO NOTHING",
    [String(chat.id)],
  );
}

async function state(pool: Pool, groupId: number) {
  await pool.query(
    "INSERT INTO bot_group_installations(group_id) VALUES($1) " +
      "ON CONFLICT(group_id) DO NOTHING",
    [String(groupId)],
  );

  return (
    await pool.query(
      "SELECT * FROM bot_group_installations WHERE group_id=$1 LIMIT 1",
      [String(groupId)],
    )
  ).rows[0];
}

function statusDot(value: boolean) {
  return value ? "● فعال" : "○ غیرفعال";
}

function capabilityStatus(value: boolean, enabled = "در دسترس", disabled = "نیازمند دسترسی") {
  return value ? "● " + enabled : "○ " + disabled;
}

async function permissionCheckInternal(groupId: number) {
  const me =
    botIdentityPromise ??
    (botIdentityPromise = telegramApi<any>("getMe", {})
      .then((result) => ({
        ok: Boolean(result?.ok),
        id: result?.ok ? Number(result.result?.id) : undefined,
      }))
      .catch(() => ({ ok: false as const })));

  if (!(await me).ok) {
    return {
      ok: false,
      status: "unreachable",
      missing: ["اتصال به Telegram"],
      optionalMissing: [],
      snapshot: {},
    };
  }

  const botId = Number((await me).id);
  const member = await telegramApi<any>("getChatMember", {
    chat_id: groupId,
    user_id: botId,
  });

  if (!member.ok) {
    return {
      ok: false,
      status: "unreachable",
      missing: ["دسترسی ربات به گروه"],
      optionalMissing: [],
      snapshot: { bot_id: botId },
    };
  }

  const m = member.result || {};
  if (String(m.status || "") !== "administrator") {
    return {
      ok: false,
      status: String(m.status || "unknown"),
      missing: ["administrator"],
      optionalMissing: [],
      snapshot: {
        bot_id: botId,
        status: m.status || "unknown",
        checked_at: new Date().toISOString(),
      },
    };
  }

  const required: Array<[string, string]> = [
    ["can_delete_messages", "حذف پیام"],
    ["can_restrict_members", "محدودکردن اعضا"],
  ];

  const optional: Array<[string, string]> = [
    ["can_invite_users", "دعوت اعضا"],
    ["can_pin_messages", "پین پیام"],
    ["can_promote_members", "مدیریت مدیران"],
    ["can_manage_topics", "مدیریت تاپیک‌ها"],
  ];

  const missing = required
    .filter(([key]) => m[key] !== true)
    .map(([, label]) => label);

  const optionalMissing = optional
    .filter(([key]) => m[key] !== true)
    .map(([, label]) => label);

  const snapshot = {
    bot_id: botId,
    status: String(m.status),
    can_manage_chat:
      m.can_manage_chat === undefined ? null : Boolean(m.can_manage_chat),
    can_delete_messages:
      m.can_delete_messages === undefined ? null : Boolean(m.can_delete_messages),
    can_restrict_members:
      m.can_restrict_members === undefined ? null : Boolean(m.can_restrict_members),
    can_invite_users:
      m.can_invite_users === undefined ? null : Boolean(m.can_invite_users),
    can_pin_messages:
      m.can_pin_messages === undefined ? null : Boolean(m.can_pin_messages),
    can_promote_members:
      m.can_promote_members === undefined ? null : Boolean(m.can_promote_members),
    can_manage_topics:
      m.can_manage_topics === undefined ? null : Boolean(m.can_manage_topics),
    checked_at: new Date().toISOString(),
  };

  return {
    ok: missing.length === 0,
    status: missing.length ? "partial_required" : "ready",
    missing,
    optionalMissing,
    snapshot,
  };
}

async function saveSnapshot(pool: Pool, groupId: number, snapshot: any) {
  await pool.query(
    "UPDATE bot_group_installations " +
      "SET bot_permission_snapshot=$1::jsonb,updated_at=NOW() " +
      "WHERE group_id=$2",
    [JSON.stringify(snapshot || {}), String(groupId)],
  );
}

async function permissionCheck(groupId: number, force = false) {
  const now = Date.now();
  const cached = permissionCache.get(groupId);

  if (!force && cached && cached.expiresAt > now) {
    return cached.result;
  }

  const result = await permissionCheckInternal(groupId);

  permissionCache.set(groupId, {
    expiresAt: now + PERMISSION_CACHE_MS,
    result,
  });

  return result;
}

function invalidatePermissionCache(groupId: number) {
  permissionCache.delete(groupId);
}

function actorRole(userId: number, owners: string[], sudo: string[]) {
  if (BUILTIN_OWNER_IDS.includes(String(userId)) || owners.includes(String(userId))) {
    return "مالک";
  }

  if (sudo.includes(String(userId))) return "سودو";
  return "مجاز";
}

function policyLabel(value: unknown) {
  const map: Record<string, string> = {
    silent: "بدون پاسخ خودکار",
    commands_only: "پاسخ به دستورات",
    automation: "پاسخ‌های خودکار",
    custom: "پیکربندی سفارشی",
  };

  return map[String(value || "")] || "بدون پاسخ خودکار";
}

function securityLabel(value: unknown) {
  const map: Record<string, string> = {
    standard: "استاندارد",
    strict: "سخت‌گیرانه",
    custom: "سفارشی",
  };

  return map[String(value || "")] || "استاندارد";
}

function installLandingDocument(
  chat: TgChat,
  actor: number,
  owners: string[],
  sudo: string[],
) {
  const blocks: any[] = [
    ...base(
      "Iɴsᴛᴀʟʟ Cᴇɴᴛᴇʀ",
      "این گروه هنوز برای استفاده از مدیریت پرشین بات فعال نشده است. قبل از نصب، دسترسی‌های اصلی بررسی می‌شوند و بعد تنظیمات پایه ثبت خواهد شد.",
    ),
    table("مشخصات درخواست", [
      ["گروه", chat.title || "گروه بدون نام"],
      ["درخواست‌کننده", actorRole(actor, owners, sudo)],
      ["نسخه", VERSION],
      ["وضعیت", "○ نصب نشده"],
    ]),
    { type: "divider" },
    {
      type: "heading",
      text: "قابلیت‌های پایه نصب",
      size: 2,
    },
    list([
      "مدیریت اعضا و عملیات مدیریتی پایه",
      "پردازش دستورات بدون نیاز به Slash",
      "تنظیم سیاست پاسخ‌گویی",
      "اتوماسیون قابل فعال‌سازی",
      "امنیت و ثبت رویدادهای مدیریتی",
    ]),
    {
      type: "paragraph",
      text: "نصب داده‌های قبلی گروه را پاک نمی‌کند. تنظیمات قابل تغییر هستند و بعد از نصب از همین بخش کنترل می‌شوند.",
    },
    buttons([button("نصب ربات", "inst:start", "success")]),
    buttons([button("بررسی دسترسی ربات", "inst:recheck")]),
    buttons([button("تنظیمات نصب", "inst:settings")]),
    buttons([button("‹ انصراف", "inst:cancel", "primary")]),
    {
      type: "footer",
      text: "Pᴇʀsɪᴀɴ ᴮᵒᵛ · Iɴsᴛᴀʟʟ Cᴇɴᴛᴇʀ",
    },
  ];

  return doc(blocks);
}

function permissionDocument(
  chat: TgChat,
  check: Awaited<ReturnType<typeof permissionCheck>>,
) {
  const missingRequired = check.missing || [];
  const optionalMissing = check.optionalMissing || [];

  if (!check.ok) {
    return doc([
      ...base(
        "Iɴsᴛᴀʟʟ Cʜᴇᴄᴋ",
        "برای نصب، دسترسی‌های اصلی ربات کافی نیست. موارد زیر را در نقش مدیر ربات بررسی کنید.",
      ),
      table("وضعیت دسترسی", [
        ["گروه", chat.title || "گروه بدون نام"],
        ["نقش ربات", String(check.snapshot?.status || "نامشخص")],
        ["دسترسی اصلی", "○ ناقص"],
        ["موارد لازم", missingRequired.length ? missingRequired.join("، ") : "—"],
      ]),
      {
        type: "heading",
        text: "چه چیزی باید اصلاح شود؟",
        size: 2,
      },
      list([
        "ربات باید Administrator گروه باشد.",
        "دسترسی حذف پیام لازم است.",
        "دسترسی محدودکردن اعضا لازم است.",
      ]),
      {
        type: "paragraph",
        text: "بعد از اصلاح دسترسی‌ها، «بررسی مجدد» را بزنید. نصب تا زمانی که دسترسی‌های اصلی کامل نشوند انجام نمی‌شود.",
      },
      buttons([button("بررسی مجدد", "inst:recheck")]),
      buttons([button("تنظیمات نصب", "inst:settings")]),
      buttons([button("‹ بازگشت", "inst:back", "primary")]),
      { type: "footer", text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Iɴsᴛᴀʟʟ Cᴇɴᴛᴇʀ" },
    ]);
  }

  return doc([
    ...base(
      "Iɴsᴛᴀʟʟ Rᴇᴠɪᴇᴡ",
      "دسترسی‌های لازم برای نصب تأیید شد. بعضی قابلیت‌ها ممکن است به دسترسی‌های تکمیلی خودشان وابسته باشند.",
    ),
    table("نتیجه بررسی", [
      ["گروه", chat.title || "گروه بدون نام"],
      ["دسترسی اصلی", "● کامل"],
      ["حذف پیام", capabilityStatus(check.snapshot?.can_delete_messages)],
      ["محدودکردن اعضا", capabilityStatus(check.snapshot?.can_restrict_members)],
      ["دعوت اعضا", capabilityStatus(check.snapshot?.can_invite_users)],
      ["پین پیام", capabilityStatus(check.snapshot?.can_pin_messages)],
      ["مدیریت مدیران", capabilityStatus(check.snapshot?.can_promote_members)],
      ["مدیریت تاپیک‌ها", capabilityStatus(check.snapshot?.can_manage_topics)],
    ]),
    {
      type: "details",
      summary: "دسترسی‌های تکمیلی",
      is_open: false,
      blocks: [
        {
          type: "paragraph",
          text:
            optionalMissing.length > 0
              ? "این موارد برای نصب پایه الزامی نیستند: " + optionalMissing.join("، ") + "."
              : "دسترسی‌های تکمیلی موجود هستند.",
        },
      ],
    },
    {
      type: "paragraph",
      text: "با تأیید نصب، وضعیت گروه ثبت می‌شود و تنظیمات پایه فعال می‌شوند. چیزی از اطلاعات قبلی حذف نخواهد شد.",
    },
    buttons([button("تأیید و نصب", "inst:confirm", "success")]),
    buttons([button("بررسی مجدد", "inst:recheck")]),
    buttons([button("تنظیمات نصب", "inst:settings")]),
    buttons([button("‹ بازگشت", "inst:back", "primary")]),
    { type: "footer", text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Iɴsᴛᴀʟʟ Cᴇɴᴛᴇʀ" },
  ]);
}

function installedDocument(
  chat: TgChat,
  stateRow: any,
  check: Awaited<ReturnType<typeof permissionCheck>>,
) {
  const missingOptional = check.optionalMissing || [];
  const panelButton = PANEL_URL
    ? { text: "مدیریت گروه از وب", callback_data: "inst:manage" }
    : null;

  const blocks: any[] = [
    ...base(
      "Gʀᴏᴜᴘ Mᴀɴᴀɢᴇᴍᴇɴᴛ",
      "نصب این گروه فعال است. تنظیمات اصلی، دسترسی‌ها و قابلیت‌های اجرایی از همین مرکز قابل کنترل هستند.",
    ),
    table("وضعیت نصب", [
      ["گروه", chat.title || "گروه بدون نام"],
      ["وضعیت نصب", "● فعال"],
      ["نسخه", String(stateRow?.installation_version || VERSION)],
      ["دستورات", statusDot(String(stateRow?.command_policy || "enabled") === "enabled")],
      ["پاسخ اعضا", policyLabel(stateRow?.member_message_policy)],
      ["اتوماسیون", statusDot(Boolean(stateRow?.automation_enabled))],
      ["امنیت", securityLabel(stateRow?.security_mode)],
      ["ثبت رویدادها", statusDot(Boolean(stateRow?.audit_enabled))],
    ]),
    {
      type: "heading",
      text: "وضعیت دسترسی",
      size: 2,
    },
    table("قابلیت‌های اجرایی", [
      ["حذف پیام", capabilityStatus(check.snapshot?.can_delete_messages)],
      ["محدودکردن اعضا", capabilityStatus(check.snapshot?.can_restrict_members)],
      ["دعوت اعضا", capabilityStatus(check.snapshot?.can_invite_users)],
      ["پین پیام", capabilityStatus(check.snapshot?.can_pin_messages)],
      ["مدیریت مدیران", capabilityStatus(check.snapshot?.can_promote_members)],
      ["مدیریت تاپیک‌ها", capabilityStatus(check.snapshot?.can_manage_topics)],
    ]),
  ];

  if (missingOptional.length > 0) {
    blocks.push({
      type: "paragraph",
      text:
        "دسترسی تکمیلی در این گروه کامل نیست: " +
        missingOptional.join("، ") +
        ". فقط قابلیت‌های وابسته به این دسترسی‌ها محدود می‌شوند.",
    });
  } else {
    blocks.push({
      type: "paragraph",
      text: "دسترسی‌های ثبت‌شده کامل هستند و محدودیت تکمیلی برای قابلیت‌های نصب دیده نمی‌شود.",
    });
  }

  if (panelButton) {
    blocks.push(buttons([panelButton]));
  }

  blocks.push(
    buttons([button("تنظیمات نصب", "inst:settings")]),
    buttons([button("وضعیت کامل", "inst:status")]),
    buttons([button("سیاست دستورات", "inst:commands")]),
    buttons([button("غیرفعال‌سازی", "inst:disable", "danger")]),
    buttons([button("‹ بازگشت", "inst:back", "primary")]),
    { type: "footer", text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Iɴsᴛᴀʟʟ Cᴇɴᴛᴇʀ" },
  );

  return doc(blocks);
}

function settingsDocument(stateRow: any) {
  const commandEnabled = String(stateRow?.command_policy || "enabled") === "enabled";
  const automationEnabled = Boolean(stateRow?.automation_enabled);
  const auditEnabled = Boolean(stateRow?.audit_enabled);

  return doc([
    ...base(
      "Iɴsᴛᴀʟʟ Sᴇᴛᴛɪɴɢs",
      "اینجا رفتار پیش‌فرض ربات را برای همین گروه تعیین می‌کنید. تغییرات این بخش همان لحظه ذخیره می‌شوند.",
    ),
    table("تنظیمات فعلی", [
      ["پاسخ اعضا", policyLabel(stateRow?.member_message_policy)],
      ["دستورات", commandEnabled ? "● فعال" : "○ غیرفعال"],
      ["حالت دستورات", "متن ساده؛ بدون Slash"],
      ["اتوماسیون", automationEnabled ? "● فعال" : "○ غیرفعال"],
      ["امنیت", securityLabel(stateRow?.security_mode)],
      ["ثبت رویدادها", auditEnabled ? "● فعال" : "○ غیرفعال"],
    ]),
    {
      type: "details",
      summary: "جزئیات رفتار",
      is_open: false,
      blocks: [
        {
          type: "paragraph",
          text: "«پاسخ اعضا» مشخص می‌کند ربات در برابر پیام‌های عادی چه نوع پاسخ خودکاری داشته باشد.",
        },
        {
          type: "paragraph",
          text: "«دستورات» مستقل از پاسخ‌گویی اعضا کنترل می‌شود و حالت اجرای آن در حال حاضر Plain Text است.",
        },
        {
          type: "paragraph",
          text: "«اتوماسیون» برای رویدادها و پاسخ‌های خودکار قابل فعال‌سازی است.",
        },
        {
          type: "paragraph",
          text: "«ثبت رویدادها» سابقه عملیات نصب و مدیریت را نگه می‌دارد.",
        },
      ],
    },
    buttons([button("پاسخ اعضا : " + policyLabel(stateRow?.member_message_policy), "inst:set:member")]),
    buttons([
      button(
        commandEnabled ? "دستورات : فعال" : "دستورات : غیرفعال",
        "inst:set:commands",
        commandEnabled ? "success" : "danger",
      ),
    ]),
    buttons([
      button(
        automationEnabled ? "اتوماسیون : فعال" : "اتوماسیون : غیرفعال",
        "inst:set:auto",
        automationEnabled ? "success" : "danger",
      ),
    ]),
    buttons([button("امنیت : " + securityLabel(stateRow?.security_mode), "inst:set:security")]),
    buttons([
      button(
        auditEnabled ? "ثبت رویدادها : فعال" : "ثبت رویدادها : غیرفعال",
        "inst:set:audit",
        auditEnabled ? "success" : "danger",
      ),
    ]),
    buttons([button("‹ بازگشت", "inst:complete", "primary")]),
    { type: "footer", text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Iɴsᴛᴀʟʟ Sᴇᴛᴛɪɴɢs" },
  ]);
}

function statusDocument(
  chat: TgChat,
  stateRow: any,
  check: Awaited<ReturnType<typeof permissionCheck>>,
) {
  const permissionSnapshot = stateRow?.bot_permission_snapshot || check.snapshot || {};
  const installed = Boolean(stateRow?.installed);

  return doc([
    ...base(
      "Iɴsᴛᴀʟʟ Sᴛᴀᴛᴜs",
      "وضعیت فعلی نصب، تنظیمات اجرایی و دسترسی‌های ثبت‌شده در این گروه.",
    ),
    table("وضعیت اصلی", [
      ["گروه", chat.title || "گروه بدون نام"],
      ["نصب", installed ? "● فعال" : "○ غیرفعال"],
      ["نسخه نصب", String(stateRow?.installation_version || VERSION)],
      ["نصب‌شده در", stateRow?.installed_at ? new Date(stateRow.installed_at).toLocaleString("fa-IR") : "ثبت نشده"],
      ["آخرین تغییر", stateRow?.updated_at ? new Date(stateRow.updated_at).toLocaleString("fa-IR") : "ثبت نشده"],
      ["دستورات", String(stateRow?.command_policy || "enabled") === "enabled" ? "● فعال" : "○ غیرفعال"],
      ["اتوماسیون", Boolean(stateRow?.automation_enabled) ? "● فعال" : "○ غیرفعال"],
      ["ثبت رویدادها", Boolean(stateRow?.audit_enabled) ? "● فعال" : "○ غیرفعال"],
      ["امنیت", securityLabel(stateRow?.security_mode)],
    ]),
    table("دسترسی‌های ثبت‌شده", [
      ["حذف پیام", capabilityStatus(permissionSnapshot?.can_delete_messages)],
      ["محدودکردن اعضا", capabilityStatus(permissionSnapshot?.can_restrict_members)],
      ["دعوت اعضا", capabilityStatus(permissionSnapshot?.can_invite_users)],
      ["پین پیام", capabilityStatus(permissionSnapshot?.can_pin_messages)],
      ["مدیریت مدیران", capabilityStatus(permissionSnapshot?.can_promote_members)],
      ["مدیریت تاپیک‌ها", capabilityStatus(permissionSnapshot?.can_manage_topics)],
    ]),
    {
      type: "paragraph",
      text:
        "بررسی زنده نشان می‌دهد ربات در این لحظه " +
        (check.ok ? "دسترسی‌های اصلی لازم را دارد." : "همه دسترسی‌های اصلی لازم را ندارد.") ,
    },
    buttons([button("بررسی دوباره", "inst:status")]),
    buttons([button("تنظیمات نصب", "inst:settings")]),
    buttons([
      button(
        installed ? "غیرفعال‌سازی" : "نصب ربات",
        installed ? "inst:disable" : "inst:start",
        installed ? "danger" : "success",
      ),
    ]),
    buttons([button("‹ بازگشت", installed ? "inst:complete" : "inst:back", "primary")]),
    { type: "footer", text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Iɴsᴛᴀʟʟ Cᴇɴᴛᴇʀ" },
  ]);
}

function commandPolicyDocument(stateRow: any) {
  const enabled = String(stateRow?.command_policy || "enabled") === "enabled";

  return doc([
    ...base(
      "Cᴏᴍᴍᴀɴᴅ Pᴏʟɪᴄʏ",
      "سیاست پردازش دستورات این گروه از تنظیمات نصب جدا نیست و از همین مرکز قابل کنترل است.",
    ),
    table("سیاست فعلی", [
      ["دستورات", enabled ? "● فعال" : "○ غیرفعال"],
      ["حالت اجرا", "Plain Text"],
      ["Slash", "نیاز نیست"],
      ["پیام ناشناخته", "بدون پاسخ"],
    ]),
    {
      type: "paragraph",
      text: enabled
        ? "دستورات فعال هستند و ربات بدون الزام به Slash آن‌ها را پردازش می‌کند."
        : "دستورات خاموش هستند و درخواست‌های دستوری گروه اجرا نخواهند شد.",
    },
    buttons([
      button(
        enabled ? "غیرفعال‌سازی دستورات" : "فعال‌سازی دستورات",
        "inst:set:commands",
        enabled ? "danger" : "success",
      ),
    ]),
    buttons([button("تنظیمات نصب", "inst:settings")]),
    buttons([button("‹ بازگشت", "inst:complete", "primary")]),
    { type: "footer", text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Cᴏᴍᴍᴀɴᴅ Pᴏʟɪᴄʏ" },
  ]);
}

function disableDocument(chat: TgChat, stateRow: any) {
  return doc([
    ...base(
      "Dɪsᴀʙʟᴇ Gʀᴏᴜᴘ",
      "غیرفعال‌سازی، مدیریت ربات را در این گروه متوقف می‌کند؛ اطلاعات ثبت‌شده و سابقه نصب حذف نمی‌شوند.",
    ),
    table("اثر غیرفعال‌سازی", [
      ["گروه", chat.title || "گروه بدون نام"],
      ["دستورات", "○ غیرفعال"],
      ["اتوماسیون", "○ غیرفعال"],
      ["داده‌های ثبت‌شده", "حفظ می‌شوند"],
      ["سابقه نصب", "حفظ می‌شود"],
      ["نصب مجدد", "قابل انجام است"],
    ]),
    {
      type: "paragraph",
      text: "این کار حذف داده نیست. فقط وضعیت نصب گروه خاموش می‌شود و برای استفاده دوباره باید نصب را تأیید کنید.",
    },
    buttons([button("تأیید غیرفعال‌سازی", "inst:disable:confirm", "danger")]),
    buttons([button("‹ بازگشت", "inst:complete", "primary")]),
    { type: "footer", text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Iɴsᴛᴀʟʟ Cᴇɴᴛᴇʀ" },
  ]);
}

function disabledDocument(chat: TgChat) {
  return doc([
    ...base(
      "Dɪsᴀʙʟᴇᴅ",
      "ربات از چرخه مدیریت این گروه خارج شد. اطلاعات و سابقه نصب باقی مانده‌اند و نصب دوباره از همین نقطه ممکن است.",
    ),
    table("نتیجه", [
      ["گروه", chat.title || "گروه بدون نام"],
      ["وضعیت نصب", "○ غیرفعال"],
      ["دستورات", "○ غیرفعال"],
      ["اتوماسیون", "○ غیرفعال"],
      ["داده‌های ثبت‌شده", "حفظ شده"],
      ["سابقه نصب", "حفظ شده"],
    ]),
    buttons([button("نصب دوباره", "inst:start", "success")]),
    buttons([button("بررسی دسترسی ربات", "inst:recheck")]),
    { type: "footer", text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Iɴsᴛᴀʟʟ Cᴇɴᴛᴇʀ" },
  ]);
}

async function updatePolicy(pool: Pool, groupId: number, key: string) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      "SELECT * FROM bot_group_installations WHERE group_id=$1 FOR UPDATE",
      [String(groupId)],
    );

    if (!result.rows[0]) {
      throw new Error("installation_state_missing");
    }

    const current = result.rows[0];

    if (key === "member") {
      const order = ["silent", "commands_only", "automation", "custom"];
      let index = order.indexOf(String(current.member_message_policy));
      if (index < 0) index = 0;
      const next = order[(index + 1) % order.length];

      await client.query(
        "UPDATE bot_group_installations " +
          "SET member_message_policy=$1,response_policy=$2,updated_at=NOW() " +
          "WHERE group_id=$3",
        [
          next,
          next === "silent" ? "standard" : "custom",
          String(groupId),
        ],
      );
    } else if (key === "commands") {
      await client.query(
        "UPDATE bot_group_installations " +
          "SET command_policy=$1,updated_at=NOW() " +
          "WHERE group_id=$2",
        [
          current.command_policy === "enabled" ? "disabled" : "enabled",
          String(groupId),
        ],
      );
    } else if (key === "auto") {
      const next = !Boolean(current.automation_enabled);

      await client.query(
        "UPDATE bot_group_installations " +
          "SET automation_enabled=$1," +
          "member_message_policy=CASE " +
          "WHEN $1=TRUE AND member_message_policy='silent' " +
          "THEN 'automation' ELSE member_message_policy END," +
          "updated_at=NOW() WHERE group_id=$2",
        [next, String(groupId)],
      );
    } else if (key === "security") {
      const order = ["standard", "strict", "custom"];
      let index = order.indexOf(String(current.security_mode));
      if (index < 0) index = 0;

      await client.query(
        "UPDATE bot_group_installations " +
          "SET security_mode=$1,updated_at=NOW() " +
          "WHERE group_id=$2",
        [order[(index + 1) % order.length], String(groupId)],
      );
    } else if (key === "audit") {
      await client.query(
        "UPDATE bot_group_installations " +
          "SET audit_enabled=NOT audit_enabled,updated_at=NOW() " +
          "WHERE group_id=$1",
        [String(groupId)],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function install(pool: Pool, chat: TgChat, actor: number) {
  const check = await permissionCheck(chat.id);
  await saveSnapshot(pool, chat.id, check.snapshot);

  if (!check.ok) return check;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      "SELECT installed FROM bot_group_installations WHERE group_id=$1 FOR UPDATE",
      [String(chat.id)],
    );

    if (result.rows[0]?.installed === true) {
      await client.query("COMMIT");
      return {
        ok: true,
        status: "complete",
        missing: [],
        optionalMissing: check.optionalMissing,
        snapshot: check.snapshot,
      };
    }

    await client.query(
      "UPDATE bot_group_installations SET " +
        "installed=TRUE," +
        "installed_at=NOW()," +
        "installed_by=$2," +
        "uninstalled_at=NULL," +
        "uninstalled_by=NULL," +
        "installation_version=$3," +
        "bot_permission_snapshot=$4::jsonb," +
        "response_policy='standard'," +
        "member_message_policy='silent'," +
        "command_policy='enabled'," +
        "command_mode='plain'," +
        "automation_enabled=FALSE," +
        "security_mode='standard'," +
        "audit_enabled=TRUE," +
        "updated_at=NOW() " +
        "WHERE group_id=$1",
      [
        String(chat.id),
        String(actor),
        VERSION,
        JSON.stringify(check.snapshot),
      ],
    );

    await client.query(
      "INSERT INTO bot_group_settings(group_id) VALUES($1) " +
        "ON CONFLICT(group_id) DO NOTHING",
      [String(chat.id)],
    );

    await client.query(
      "INSERT INTO warning_system_settings(group_id) VALUES($1) " +
        "ON CONFLICT(group_id) DO NOTHING",
      [String(chat.id)],
    );

    await client.query(
      "INSERT INTO content_lock_settings(group_id) VALUES($1) " +
        "ON CONFLICT(group_id) DO NOTHING",
      [String(chat.id)],
    );

    await client.query(
      "INSERT INTO bot_installation_events(group_id,actor_id,event_type,metadata) " +
        "VALUES($1,$2,'installed',$3::jsonb)",
      [
        String(chat.id),
        String(actor),
        JSON.stringify({
          version: VERSION,
          snapshot: check.snapshot,
          optional_missing: check.optionalMissing,
        }),
      ],
    );

    await client.query(
      "INSERT INTO audit_logs(actor_id,action,target,after_data,source) " +
        "VALUES($1,'group_installed',$2,$3::jsonb,'telegram_installation')",
      [
        String(actor),
        String(chat.id),
        JSON.stringify({
          version: VERSION,
          member_message_policy: "silent",
          command_mode: "plain",
          optional_missing: check.optionalMissing,
        }),
      ],
    );

    await client.query("COMMIT");

    return {
      ok: true,
      status: "complete",
      missing: [],
      optionalMissing: check.optionalMissing,
      snapshot: check.snapshot,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function uninstall(pool: Pool, chat: TgChat, actor: number) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      "SELECT installed FROM bot_group_installations WHERE group_id=$1 FOR UPDATE",
      [String(chat.id)],
    );

    if (!result.rows[0]?.installed) {
      await client.query("COMMIT");
      return false;
    }

    await client.query(
      "UPDATE bot_group_installations SET " +
        "installed=FALSE," +
        "uninstalled_at=NOW()," +
        "uninstalled_by=$2," +
        "command_policy='disabled'," +
        "automation_enabled=FALSE," +
        "updated_at=NOW() " +
        "WHERE group_id=$1",
      [String(chat.id), String(actor)],
    );

    await client.query(
      "INSERT INTO bot_installation_events(group_id,actor_id,event_type,metadata) " +
        "VALUES($1,$2,'uninstalled',$3::jsonb)",
      [
        String(chat.id),
        String(actor),
        JSON.stringify({
          retained_data: true,
          retained_history: true,
        }),
      ],
    );

    await client.query(
      "INSERT INTO audit_logs(actor_id,action,target,after_data,source) " +
        "VALUES($1,'group_uninstalled',$2,$3::jsonb,'telegram_installation')",
      [
        String(actor),
        String(chat.id),
        JSON.stringify({
          retained_data: true,
          command_policy: "disabled",
          automation_enabled: false,
        }),
      ],
    );

    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureInstallationSchema(pool: Pool) {
  await ensureSchema(pool);
}

export async function installationGate(
  pool: Pool,
  msg: TgMessage,
  owners: string[],
  sudo: string[],
  allowActions = true,
): Promise<InstallationGateResult> {
  if (!msg.from || ["private", "channel"].includes(msg.chat.type)) {
    return "drop";
  }

  await ensureSchema(pool);
  await ensureGroup(pool, msg.chat);

  const installationState = await state(pool, msg.chat.id);
  const raw = msg.text || msg.caption || "";
  const isOperator = authorized(msg.from.id, owners, sudo);

  if (allowActions && isOperator && isInstallText(raw)) {
    if (installationState.installed) {
      const check = await permissionCheck(msg.chat.id);
      await saveSnapshot(pool, msg.chat.id, check.snapshot);

      await render(
        msg.chat.id,
        undefined,
        installedDocument(msg.chat, installationState, check),
      );
      return "handled";
    }

    await render(
      msg.chat.id,
      undefined,
      installLandingDocument(msg.chat, msg.from.id, owners, sudo),
    );
    return "handled";
  }

  if (allowActions && isOperator && isUninstallText(raw)) {
    if (!installationState.installed) {
      await render(msg.chat.id, undefined, disabledDocument(msg.chat));
      return "handled";
    }

    await render(
      msg.chat.id,
      undefined,
      disableDocument(msg.chat, installationState),
    );
    return "handled";
  }

  return installationState.installed ? "allow" : "drop";
}

export async function handleInstallationCallback(
  pool: Pool,
  cb: TgCallback,
  owners: string[],
  sudo: string[],
): Promise<boolean> {
  const data = norm(cb.data);

  if (!data.startsWith("inst:")) return false;

  if (!cb.message || ["private", "channel"].includes(cb.message.chat.type)) {
    await answer(cb.id);
    return true;
  }

  if (!authorized(cb.from.id, owners, sudo)) {
    await answer(cb.id, "دسترسی کافی نیست");
    return true;
  }

  await ensureSchema(pool);
  await ensureGroup(pool, cb.message.chat);

  const chat = cb.message.chat;

  let callbackNotice = "انجام شد";

  try {
    switch (data) {
      case "inst:start": {
        const check = await permissionCheck(chat.id, true);
        await saveSnapshot(pool, chat.id, check.snapshot);

        await render(
          chat.id,
          cb.message.message_id,
          permissionDocument(chat, check),
        );
        callbackNotice = check.ok ? "دسترسی‌ها تأیید شد" : "دسترسی‌ها نیاز به بررسی دارد";
        return true;
      }

      case "inst:recheck": {
        invalidatePermissionCache(chat.id);
        const check = await permissionCheck(chat.id, true);
        await saveSnapshot(pool, chat.id, check.snapshot);

        await render(
          chat.id,
          cb.message.message_id,
          permissionDocument(chat, check),
        );

        callbackNotice = check.ok ? "بررسی دسترسی کامل شد" : "چند دسترسی نیاز به اصلاح دارد";
        return true;
      }

      case "inst:settings": {
        const fresh = await state(pool, chat.id);

        await render(
          chat.id,
          cb.message.message_id,
          settingsDocument(fresh),
        );
        return true;
      }

      case "inst:settings:save": {
        await render(
          chat.id,
          cb.message.message_id,
          settingsDocument(await state(pool, chat.id)),
        );
        return true;
      }

      case "inst:back": {
        const fresh = await state(pool, chat.id);

        if (fresh?.installed) {
          const check = await permissionCheck(chat.id);
          await saveSnapshot(pool, chat.id, check.snapshot);

          await render(
            chat.id,
            cb.message.message_id,
            installedDocument(chat, fresh, check),
          );
        } else {
          await render(
            chat.id,
            cb.message.message_id,
            installLandingDocument(
              chat,
              cb.from.id,
              owners,
              sudo,
            ),
          );
        }

        return true;
      }

      case "inst:cancel": {
        await render(
          chat.id,
          cb.message.message_id,
          doc([
            ...base(
              "Iɴsᴛᴀʟʟ Cᴀɴᴄᴇʟʟᴇᴅ",
              "درخواست نصب بسته شد. برای شروع دوباره، دستور نصب را ارسال کنید.",
            ),
            table("وضعیت", [
              ["گروه", chat.title || "گروه بدون نام"],
              ["وضعیت نصب", Boolean((await state(pool, chat.id))?.installed) ? "● فعال" : "○ نصب نشده"],
            ]),
            buttons([button("شروع دوباره", "inst:back")]),
            { type: "footer", text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Iɴsᴛᴀʟʟ Cᴇɴᴛᴇʀ" },
          ]),
        );
        return true;
      }

      case "inst:confirm": {
        const result = await install(pool, chat, cb.from.id);

        if (!result.ok) {
          await render(
            chat.id,
            cb.message.message_id,
            permissionDocument(chat, result as any),
          );
          return true;
        }

        const fresh = await state(pool, chat.id);
        const check = await permissionCheck(chat.id, true);
        await saveSnapshot(pool, chat.id, check.snapshot);

        await render(
          chat.id,
          cb.message.message_id,
          installedDocument(chat, fresh, check),
        );
        callbackNotice = "نصب با موفقیت انجام شد";
        return true;
      }

      case "inst:complete": {
        const fresh = await state(pool, chat.id);

        if (!fresh?.installed) {
          await render(
            chat.id,
            cb.message.message_id,
            installLandingDocument(chat, cb.from.id, owners, sudo),
          );
          return true;
        }

        const check = await permissionCheck(chat.id);
        await saveSnapshot(pool, chat.id, check.snapshot);

        await render(
          chat.id,
          cb.message.message_id,
          installedDocument(chat, fresh, check),
        );
        callbackNotice = "مرکز نصب آماده است";
        return true;
      }

      case "inst:status": {
        const check = await permissionCheck(chat.id, true);
        await saveSnapshot(pool, chat.id, check.snapshot);

        await render(
          chat.id,
          cb.message.message_id,
          statusDocument(chat, await state(pool, chat.id), check),
        );
        callbackNotice = "وضعیت به‌روز شد";
        return true;
      }

      case "inst:commands": {
        await render(
          chat.id,
          cb.message.message_id,
          commandPolicyDocument(await state(pool, chat.id)),
        );
        return true;
      }

      case "inst:manage": {
        const url =
          PANEL_URL ||
          "https://persian-bot-studio-panel-production.up.railway.app/";

        await render(
          chat.id,
          cb.message.message_id,
          doc([
            ...base(
              "Gʀᴏᴜᴘ Wᴇʙ Cᴏɴᴛʀᴏʟ",
              "گروه به مرکز مدیریت متصل است. مدیریت جزئی‌تر از پنل وب انجام می‌شود.",
            ),
            table("اتصال فعلی", [
              ["گروه", chat.title || "گروه بدون نام"],
              ["وضعیت نصب", "● فعال"],
              ["مرکز مدیریت", "وب‌پنل"],
            ]),
            buttons([{ text: "باز کردن پنل وب", url: url + "#dashboard" }]),
            buttons([button("تنظیمات نصب", "inst:settings")]),
            buttons([button("‹ بازگشت", "inst:complete", "primary")]),
            { type: "footer", text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Gʀᴏᴜᴘ Cᴏɴᴛʀᴏʟ" },
          ]),
        );
        return true;
      }

      case "inst:disable":
      case "inst:uninstall": {
        const fresh = await state(pool, chat.id);

        if (!fresh?.installed) {
          await render(
            chat.id,
            cb.message.message_id,
            disabledDocument(chat),
          );
          return true;
        }

        await render(
          chat.id,
          cb.message.message_id,
          disableDocument(chat, fresh),
        );
        return true;
      }

      case "inst:disable:confirm":
      case "inst:uninstall:confirm": {
        const removed = await uninstall(pool, chat, cb.from.id);

        if (!removed) {
          await render(
            chat.id,
            cb.message.message_id,
            disabledDocument(chat),
          );
          return true;
        }

        await render(
          chat.id,
          cb.message.message_id,
          disabledDocument(chat),
        );
        return true;
      }

      case "inst:set:member":
      case "inst:set:commands":
      case "inst:set:auto":
      case "inst:set:security":
      case "inst:set:audit": {
        await updatePolicy(pool, chat.id, data.slice("inst:set:".length));

        await render(
          chat.id,
          cb.message.message_id,
          settingsDocument(await state(pool, chat.id)),
        );
        callbackNotice = "تنظیمات ذخیره شد";
        return true;
      }

      default:
        callbackNotice = "این گزینه دیگر فعال نیست";
        return true;
    }
  } catch (error) {
    console.error("[installation] callback failed:", error);

    await render(
      chat.id,
      cb.message.message_id,
      doc([
        ...base(
          "Iɴsᴛᴀʟʟ Eʀʀᴏʀ",
          "این عملیات کامل نشد. وضعیت فعلی گروه حفظ شده و می‌توانید از همین پیام دوباره تلاش کنید.",
        ),
        {
          type: "paragraph",
          text: "جزئیات فنی در لاگ سرور ثبت شده است.",
        },
        buttons([button("تنظیمات نصب", "inst:settings")]),
        buttons([button("‹ بازگشت", "inst:back", "primary")]),
        { type: "footer", text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Iɴsᴛᴀʟʟ Cᴇɴᴛᴇʀ" },
      ]),
    );

    callbackNotice = "عملیات انجام نشد";
    return true;
  } finally {
    await answer(cb.id, callbackNotice);
  }
}
