import type { Pool } from "pg";
import { telegramApi } from "../src/lib/telegram/api.ts";
import {
  prepareRichDocument,
  validateRichDocument,
  richDocumentToPlainText,
  type RichDocument,
} from "../src/lib/bot/rich-message.ts";
import {
  runInstallationPreflight,
  preflightStatusLabel,
  preflightStatusSymbol,
  type PreflightReport,
} from "./installation-preflight.ts";
import {
  ensureInstallationProgressSchema,
  createInstallationProgress,
  getActiveInstallationProgress,
  getLatestInstallationProgressForGroup,
  getInstallationProgress,
  getInstallationProgressStepStatuses,
  ensureInstallationProgressSteps,
  setInstallationStepProgress,
  setInstallationPhase,
  recordInstallationProgressError,
  attachInstallationProgressMessage,
  shouldRenderInstallationProgress,
  markInstallationProgressRendered,
  startInstallationHeartbeat,
  listRecoverableInstallationProgress,
  claimInstallationProgressRecovery,
  markStaleInstallationProgress,
  installationProgressDocument,
  type InstallationProgressSnapshot,
} from "./installation-progress.ts";
import { executeInstallationOrchestration, ensureInstallationOrchestratorSchema } from "./installation-orchestrator.ts";
import { diagnoseInstallation, installationDiagnosticDocument } from "./installation-diagnostics.ts";
import {
  assertInstallationSessionTransition,
  installationOperationAllowed,
  isKnownInstallationCallback,
  type InstallationSessionStep,
  type InstallationSessionStatus,
} from "./installation-state.ts";

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
export type InstallationInputResult = "handled" | "ignored";

type ButtonStyle = "primary" | "success" | "danger";
type InstallType = "quick" | "custom";
type InstallationOperation =
  | "install"
  | "update"
  | "repair"
  | "reinstall"
  | "uninstall"
  | "report";

type SessionStep =
  | "operation"
  | "install_type"
  | "version"
  | "environment"
  | "settings"
  | "summary"
  | "confirmed"
  | "preflight"
  | "executing"
  | "verifying"
  | "completed"
  | "failed";

const VERSION = process.env.NIZAM_PANEL_VERSION || "v1.0.0";
const BUILTIN_OWNER_IDS = ["8247710529"];
const PANEL_URL = String(process.env.PANEL_URL || "").replace(/\/$/, "");
const SESSION_TTL_MS = 15 * 60 * 1000;

let schemaReadyPromise: Promise<void> | null = null;

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

function buttons(items: Array<{ text: string; callback_data?: string; url?: string; style?: ButtonStyle }>) {
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
    is_compact: true,
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

function base(title: string, subtitle?: string): any[] {
  const blocks: any[] = [
    {
      type: "heading",
      text: "◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · " + title,
      size: 1,
    },
  ];

  if (subtitle) blocks.push({ type: "paragraph", text: subtitle });
  blocks.push({ type: "divider" });
  return blocks;
}

function doc(blocks: any[]): RichDocument {
  return prepareRichDocument({
    version: 1,
    is_rtl: true,
    blocks,
  });
}

function statusText(installed: boolean) {
  return installed ? "● فعال" : "○ نصب نشده";
}

function operationLabel(operation: InstallationOperation) {
  const map: Record<InstallationOperation, string> = {
    install: "نصب اولیه",
    update: "به‌روزرسانی",
    repair: "تعمیر نصب",
    reinstall: "نصب مجدد",
    uninstall: "حذف نصب",
    report: "گزارش وضعیت",
  };
  return map[operation];
}

function installTypeLabel(type?: InstallType | null) {
  if (type === "quick") return "نصب سریع";
  if (type === "custom") return "نصب سفارشی";
  return "—";
}

function isDestructive(operation: InstallationOperation) {
  return operation === "reinstall" || operation === "uninstall";
}

function defaultSession(operation: InstallationOperation, actorId: number) {
  return {
    operation,
    actor_id: actorId,
    install_type: null as InstallType | null,
    version: null as string | null,
    environment: null as string | null,
    settings: {} as Record<string, unknown>,
    step: "operation" as SessionStep,
    status: "collecting",
    confirmed: false,
    preflight: null as PreflightReport | null,
  };
}

function validVersion(value: string) {
  const normalized = value.trim().replace(/^v/i, "");
  return /^\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?$/.test(normalized);
}

function canonicalVersion(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^latest$/i.test(trimmed) || trimmed === "آخرین نسخه" || trimmed === "جدیدترین") {
    return "latest";
  }
  if (!validVersion(trimmed)) return null;
  return "v" + trimmed.replace(/^v/i, "");
}

function parseCustomSettings(value: string): Record<string, unknown> | null {
  const raw = value.trim();
  if (!raw || raw.length > 4000) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return null;

    const entries = Object.entries(parsed);
    if (entries.length > 30) return null;

    const out: Record<string, unknown> = {};
    for (const [key, item] of entries) {
      const safeKey = String(key).trim();
      if (!safeKey || safeKey.length > 80) return null;
      if (typeof item === "string" && item.length > 500) return null;
      out[safeKey] = item;
    }
    return out;
  } catch {
    return null;
  }
}

function settingsLabel(settings: unknown) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return "استاندارد";
  const keys = Object.keys(settings as Record<string, unknown>);
  return keys.length ? `سفارشی · ${keys.length} گزینه` : "استاندارد";
}

function richReplyMarkup(document: RichDocument) {
  const rows = document.blocks
    .filter((block: any) => block?.type === "buttons" && Array.isArray(block.buttons))
    .map((block: any) =>
      block.buttons
        .filter((item: any) => item?.callback_data || item?.url)
        .map((item: any) =>
          item?.url
            ? { text: String(item.text ?? "—"), url: String(item.url) }
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

async function render(chatId: number, messageId: number | undefined, document: RichDocument) {
  const validation = validateRichDocument(document);
  if (!validation.ok) {
    console.error("[installation] Rich validation failed:", validation.errors);
  }

  const reply_markup = richReplyMarkup(document);
  const richBody = richDocumentWithoutButtons(document);
  const plainText = richDocumentToPlainText(richBody);

  try {
    const result = messageId
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

    if ((result as any)?.ok === true) return result;
  } catch (error) {
    console.warn("[installation] Rich Message render failed:", error);
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

async function renderInstallationProgressSnapshot(
  pool: Pool,
  chat: TgChat,
  snapshot: InstallationProgressSnapshot,
  detail?: string,
  force = false,
) {
  const shouldRender = await shouldRenderInstallationProgress(
    pool,
    snapshot.execution_id,
    snapshot,
    force,
  );
  if (!shouldRender) return snapshot;

  let result = await render(
    chat.id,
    snapshot.last_message_id ?? undefined,
    installationProgressDocument(chat, snapshot, detail),
  );

  if (!(result as any)?.ok && snapshot.last_message_id) {
    result = await render(
      chat.id,
      undefined,
      installationProgressDocument(chat, snapshot, detail),
    );
  }

  if ((result as any)?.ok === true) {
    const sentMessageId = Number((result as any)?.result?.message_id ?? 0);
    if (sentMessageId > 0) {
      await attachInstallationProgressMessage(
        pool,
        snapshot.execution_id,
        sentMessageId,
      );
    }
    await markInstallationProgressRendered(pool, snapshot.execution_id);
  }

  return (await getInstallationProgress(pool, snapshot.execution_id)) ?? snapshot;
}

function userFacingInstallationError(error: unknown) {
  const code = String((error as any)?.code ?? "");
  if (code === "INSTALLATION_EXECUTION_ACTIVE") {
    return "یک عملیات نصب برای این گروه در حال اجراست.";
  }

  const message = String((error as any)?.message ?? "").trim();
  const known = [
    "گروه از قبل نصب شده است.",
    "برای به‌روزرسانی، گروه باید نصب شده باشد.",
    "برای تعمیر، گروه باید نصب شده باشد.",
    "برای نصب مجدد، گروه باید نصب شده باشد.",
    "گروه از قبل حذف نصب شده است.",
  ];
  if (known.includes(message)) return message;

  if (/not enough rights|administrator|permission|دسترسی/i.test(message)) {
    return "دسترسی لازم برای اجرای عملیات در Telegram برقرار نیست.";
  }

  return "اجرای عملیات با یک خطای داخلی متوقف شد. جزئیات فنی در گزارش عملیات ثبت شده است.";
}

async async function installationEffectAlreadyApplied(
  pool: Pool,
  chatId: number,
  session: any,
  targetVersion: string,
  executionId: string,
) {
  const operation = String(session.operation) as InstallationOperation;
  const row = (
    await pool.query(
      "SELECT installed,installation_version,command_policy " +
        "FROM bot_group_installations WHERE group_id=$1 LIMIT 1",
      [String(chatId)],
    )
  ).rows[0];

  if (!row) return false;

  const runtime = (
    await pool.query(
      "SELECT status,version,execution_id FROM bot_installation_runtime WHERE group_id=$1 LIMIT 1",
      [String(chatId)],
    )
  ).rows[0];

  // Idempotency is tied to the same execution id. A fresh Update/Repair
  // therefore never becomes a decorative no-op merely because the requested
  // version already matches the installed version.
  if (String(runtime?.execution_id ?? "") !== String(executionId)) {
    return false;
  }

  if (operation === "uninstall") {
    return (
      !Boolean(row.installed) &&
      String(row.command_policy) === "disabled" &&
      String(runtime?.status ?? "") === "DETACHED"
    );
  }

  return (
    Boolean(row.installed) &&
    String(row.installation_version) === targetVersion &&
    String(runtime?.status ?? "") === "HEALTHY" &&
    String(runtime?.version ?? "") === targetVersion
  );
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

  await ensureInstallationProgressSchema(pool);
  await ensureInstallationOrchestratorSchema(pool);

  await pool.query(
    "CREATE TABLE IF NOT EXISTS bot_installation_sessions (" +
      "group_id BIGINT PRIMARY KEY," +
      "actor_id BIGINT NOT NULL," +
      "operation TEXT NOT NULL," +
      "install_type TEXT," +
      "version TEXT," +
      "environment TEXT," +
      "settings JSONB NOT NULL DEFAULT '{}'::jsonb," +
      "step TEXT NOT NULL DEFAULT 'operation'," +
      "status TEXT NOT NULL DEFAULT 'collecting'," +
      "preflight JSONB NOT NULL DEFAULT '{}'::jsonb," +
      "confirmed BOOLEAN NOT NULL DEFAULT FALSE," +
      "state_version INTEGER NOT NULL DEFAULT 1," +
      "last_action TEXT," +
      "last_error_code TEXT," +
      "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()," +
      "expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes')" +
      ")",
  );

  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_bot_installation_sessions_expires " +
      "ON bot_installation_sessions(expires_at)",
  );

  await pool.query(
    "ALTER TABLE bot_installation_sessions " +
      "ADD COLUMN IF NOT EXISTS preflight JSONB NOT NULL DEFAULT '{}'::jsonb",
  );

  await pool.query(
    "ALTER TABLE bot_installation_sessions " +
      "ADD COLUMN IF NOT EXISTS confirmed BOOLEAN NOT NULL DEFAULT FALSE",
  );

  await pool.query(
    "ALTER TABLE bot_installation_sessions " +
      "ADD COLUMN IF NOT EXISTS state_version INTEGER NOT NULL DEFAULT 1",
  );

  await pool.query(
    "ALTER TABLE bot_installation_sessions " +
      "ADD COLUMN IF NOT EXISTS last_action TEXT",
  );

  await pool.query(
    "ALTER TABLE bot_installation_sessions " +
      "ADD COLUMN IF NOT EXISTS last_error_code TEXT",
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

async function getSession(pool: Pool, groupId: number) {
  const result = await pool.query(
    "SELECT * FROM bot_installation_sessions WHERE group_id=$1 LIMIT 1",
    [String(groupId)],
  );
  const row = result.rows[0];
  if (!row) return null;

  const expired = new Date(row.expires_at).getTime() <= Date.now();
  if (expired) {
    await pool.query("DELETE FROM bot_installation_sessions WHERE group_id=$1", [String(groupId)]);
    return null;
  }

  return row;
}

async function saveSession(
  pool: Pool,
  groupId: number,
  session: ReturnType<typeof defaultSession>,
) {
  await pool.query(
    "INSERT INTO bot_installation_sessions(" +
      "group_id,actor_id,operation,install_type,version,environment,settings,step,status,preflight,confirmed,state_version,last_action,last_error_code,updated_at,expires_at" +
      ") VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::jsonb,$11,1,$8 || ':' || $9,NULL,NOW(),NOW()+INTERVAL '15 minutes') " +
      "ON CONFLICT(group_id) DO UPDATE SET " +
      "actor_id=EXCLUDED.actor_id,operation=EXCLUDED.operation,install_type=EXCLUDED.install_type," +
      "version=EXCLUDED.version,environment=EXCLUDED.environment,settings=EXCLUDED.settings," +
      "step=EXCLUDED.step,status=EXCLUDED.status,preflight=EXCLUDED.preflight,confirmed=EXCLUDED.confirmed," +
      "state_version=bot_installation_sessions.state_version+1,last_action=EXCLUDED.step || ':' || EXCLUDED.status,last_error_code=NULL,updated_at=NOW()," +
      "expires_at=NOW()+INTERVAL '15 minutes'",
    [
      String(groupId),
      String(session.actor_id),
      session.operation,
      session.install_type,
      session.version,
      session.environment,
      JSON.stringify(session.settings ?? {}),
      session.step,
      session.status,
      JSON.stringify(session.preflight ?? {}),
      Boolean(session.confirmed),
    ],
  );
}

async function clearSession(pool: Pool, groupId: number, actorId?: number) {
  if (actorId !== undefined) {
    await pool.query(
      "DELETE FROM bot_installation_sessions WHERE group_id=$1 AND actor_id=$2",
      [String(groupId), String(actorId)],
    );
    return;
  }
  await pool.query("DELETE FROM bot_installation_sessions WHERE group_id=$1", [String(groupId)]);
}

async function transitionSession(
  pool: Pool,
  groupId: number,
  actorId: number,
  nextStep: InstallationSessionStep,
  nextStatus: InstallationSessionStatus,
  patch: {
    version?: string | null;
    environment?: string | null;
    settings?: Record<string, unknown>;
    preflight?: PreflightReport | Record<string, unknown> | null;
    confirmed?: boolean;
  } = {},
) {
  const current = await getSession(pool, groupId);
  if (!current) {
    const error = new Error("نشست نصب پیدا نشد.");
    (error as any).code = "INSTALLATION_SESSION_NOT_FOUND";
    throw error;
  }
  if (Number(current.actor_id) !== actorId) {
    const error = new Error("این نشست توسط کاربر دیگری در حال استفاده است.");
    (error as any).code = "INSTALLATION_SESSION_FORBIDDEN";
    throw error;
  }

  assertInstallationSessionTransition(
    String(current.step),
    String(current.status),
    nextStep,
    nextStatus,
  );

  const sets = [
    "step=$1",
    "status=$2",
    "state_version=state_version+1",
    "last_action=$3",
    "updated_at=NOW()",
    "expires_at=NOW()+INTERVAL '15 minutes'",
  ];
  const values: unknown[] = [nextStep, nextStatus, nextStep + ":" + nextStatus];

  const addValue = (column: string, value: unknown, cast = "") => {
    values.push(value);
    sets.push(column + "=$" + values.length + cast);
  };

  if (Object.prototype.hasOwnProperty.call(patch, "version")) {
    addValue("version", patch.version ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "environment")) {
    addValue("environment", patch.environment ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "settings")) {
    addValue("settings", JSON.stringify(patch.settings ?? {}), "::jsonb");
  }
  if (Object.prototype.hasOwnProperty.call(patch, "preflight")) {
    addValue("preflight", JSON.stringify(patch.preflight ?? {}), "::jsonb");
  }
  if (Object.prototype.hasOwnProperty.call(patch, "confirmed")) {
    addValue("confirmed", Boolean(patch.confirmed));
  }

  const groupParam = values.length + 1;
  const actorParam = values.length + 2;
  const versionParam = values.length + 3;
  const result = await pool.query(
    "UPDATE bot_installation_sessions SET " +
      sets.join(",") +
      " WHERE group_id=$" +
      groupParam +
      " AND actor_id=$" +
      actorParam +
      " AND state_version=$" +
      versionParam,
    [...values, String(groupId), String(actorId), Number(current.state_version ?? 1)],
  );

  if (result.rowCount !== 1) {
    const error = new Error("نشست نصب همزمان تغییر کرده است.");
    (error as any).code = "INSTALLATION_SESSION_CONFLICT";
    throw error;
  }

  return getSession(pool, groupId);
}

async function logInstallEvent(
  pool: Pool,
  groupId: number,
  actorId: number,
  eventType: string,
  metadata: Record<string, unknown> = {},
) {
  await pool.query(
    "INSERT INTO bot_installation_events(group_id,actor_id,event_type,metadata) VALUES($1,$2,$3,$4::jsonb)",
    [String(groupId), String(actorId), eventType, JSON.stringify(metadata)],
  );
}

function mainCenterDocument(chat: TgChat, stateRow: any, session: any) {
  const installed = Boolean(stateRow?.installed);
  const sessionActive = Boolean(session);

  const blocks: any[] = [
    ...base(
      "Iɴsᴛᴀʟʟ Cᴇɴᴛᴇʀ",
      installed
        ? "مرکز نصب فعال است. وضعیت و عملیات مدیریت گروه از همین بخش کنترل می‌شوند."
        : "مرکز نصب آماده است. ابتدا عملیات و سپس نوع نصب را انتخاب کنید.",
    ),
    table("وضعیت", [
      ["گروه", chat.title || "گروه بدون نام"],
      ["وضعیت نصب", statusText(installed)],
      ["نسخه", installed ? String(stateRow?.installation_version || VERSION) : "—"],
      ["اتصال", "بررسی نشده"],
      ["تنظیمات نشست", sessionActive ? "● در حال پیکربندی" : "○ فعال نیست"],
    ]),
    { type: "divider" },
    {
      type: "heading",
      text: "★ - عملیات",
      size: 2,
    },
  ];

  if (!installed) {
    blocks.push(buttons([button("شروع نصب", "inst:operations", "success")]));
  }

  blocks.push(
    buttons([button("بررسی سیستم", "inst:check")]),
    buttons([button("مدیریت نصب", "inst:manage")]),
  );

  if (PANEL_URL && installed) {
    blocks.push(buttons([{ text: "مدیریت گروه از وب", url: PANEL_URL + "#dashboard" }]));
  }

  blocks.push(
    { type: "divider" },
    buttons([button("‹ بازگشت", "inst:cancel", "primary")]),
    {
      type: "footer",
      text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Iɴsᴛᴀʟʟ Cᴇɴᴛᴇʀ",
    },
  );

  return doc(blocks);
}

function managementDocument(chat: TgChat, stateRow: any) {
  const installed = Boolean(stateRow?.installed);
  const blocks: any[] = [
    ...base(
      "Iɴsᴛᴀʟʟ Mᴀɴᴀɢᴇᴍᴇɴᴛ",
      installed
        ? "عملیات قابل اجرا با وضعیت فعلی گروه فیلتر شده‌اند."
        : "فقط عملیات سازگار با وضعیت فعلی گروه نمایش داده می‌شوند.",
    ),
    table("وضعیت فعلی", [
      ["گروه", chat.title || "گروه بدون نام"],
      ["نصب", statusText(installed)],
      ["نسخه", installed ? String(stateRow?.installation_version || VERSION) : "—"],
    ]),
    { type: "divider" },
    {
      type: "heading",
      text: "★ - عملیات در دسترس",
      size: 2,
    },
  ];

  if (installed) {
    blocks.push(
      buttons([button("به‌روزرسانی", "inst:op:update", "success")]),
      buttons([button("تعمیر نصب", "inst:op:repair", "success")]),
      buttons([button("نصب مجدد", "inst:op:reinstall", "danger")]),
      buttons([button("حذف نصب", "inst:op:uninstall", "danger")]),
      buttons([button("گزارش وضعیت", "inst:op:report")]),
    );
  } else {
    blocks.push(
      buttons([button("نصب اولیه", "inst:op:install", "success")]),
      buttons([button("گزارش وضعیت", "inst:op:report")]),
    );
  }

  blocks.push(
    buttons([button("‹ بازگشت", "inst:home", "primary")]),
    { type: "footer", text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Iɴsᴛᴀʟʟ Mᴀɴᴀɢᴇᴍᴇɴᴛ" },
  );

  return doc(blocks);
}

function preflightReportFromSession(session: any): PreflightReport | null {
  const raw = session?.preflight;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!Array.isArray(raw.checks) || !raw.operation || !raw.overall) return null;
  return raw as PreflightReport;
}

function preflightSummaryDocument(
  chat: TgChat,
  stateRow: any,
  session: any,
  report: PreflightReport,
) {
  const statusTextValue = report.overall === "READY" ? "● آماده" : "■ مسدود";
  const canContinue =
    report.overall === "READY" &&
    ["confirmed", "preflight_ready", "preflight_blocked", "ready"].includes(String(session?.status ?? ""));

  const rows: Array<[string, string]> = report.checks.map((item) => [
    item.category,
    preflightStatusSymbol(item.status) + " " + preflightStatusLabel(item.status),
  ]);

  const issues = report.checks.filter(
    (item) => !["READY", "SKIPPED"].includes(item.status),
  );

  const blocks: any[] = [
    ...base(
      "Pʀᴇғʟɪɢʜᴛ Cʜᴇᴄᴋ",
      report.overall === "READY"
        ? "پیش‌نیازهای لازم بررسی شده‌اند. هنوز هیچ عملیات اجرایی آغاز نشده است."
        : "اجرای عملیات تا رفع موارد مسدودکننده مجاز نیست.",
    ),
    table("وضعیت کلی", [
      ["نتیجه", statusTextValue],
      ["عملیات", operationLabel(String(report.operation) as InstallationOperation)],
      ["بررسی‌ها", `${report.checkedCount} / ${report.relevantCount}`],
      ["هشدارها", String(report.warningCount)],
      ["مسدودکننده", String(report.blockerCount)],
      ["قابل رفع خودکار", String(report.autoFixableCount)],
      ["نیازمند اقدام کاربر", String(report.actionRequiredCount)],
      ["اصلاح خودکار انجام‌شده", String(report.autoFixedCount)],
    ]),
    { type: "divider" },
    table("خلاصهٔ بررسی", rows),
  ];

  const autoFixableIssues = report.checks.filter((item) => item.status === "FIXABLE");
  const actionRequiredIssues = report.checks.filter((item) => item.status === "ACTION_REQUIRED");

  if (autoFixableIssues.length) {
    blocks.push({
      type: "details",
      summary: "قابل رفع خودکار",
      is_open: false,
      blocks: autoFixableIssues.map((item) => ({
        type: "paragraph",
        text: preflightStatusSymbol(item.status) + " " + item.category + " — " + item.detail,
      })),
    });
  }

  if (actionRequiredIssues.length) {
    blocks.push({
      type: "details",
      summary: "نیازمند اقدام کاربر",
      is_open: false,
      blocks: actionRequiredIssues.map((item) => ({
        type: "paragraph",
        text:
          preflightStatusSymbol(item.status) +
          " " +
          item.category +
          " — " +
          item.detail +
          (item.action ? " اقدام: " + item.action : ""),
      })),
    });
  }

  if (issues.length) {
    blocks.push(
      {
        type: "details",
        summary: "موارد نیازمند توجه",
        is_open: false,
        blocks: [
          ...issues.map((item) => ({
            type: "paragraph",
            text:
              preflightStatusSymbol(item.status) +
              " " +
              item.category +
              " — " +
              item.detail +
              (item.action ? " اقدام: " + item.action : ""),
          })),
        ],
      },
    );
  } else {
    blocks.push({
      type: "paragraph",
      text: "تمام بررسی‌های مرتبط با این عملیات بدون مسدودکننده به پایان رسیدند.",
    });
  }

  blocks.push(
    { type: "divider" },
    buttons([button("جزئیات بررسی", "inst:preflight:details")]),
    buttons([button("بررسی مجدد", "inst:preflight:recheck")]),
  );

  if (report.autoFixableCount > 0) {
    blocks.push(buttons([button("رفع خودکار موارد", "inst:preflight:fix", "success")]));
  }

  if (canContinue) {
    blocks.push(buttons([button("ادامه", "inst:preflight:continue", "success")]));
  }

  blocks.push(
    buttons([button("‹ بازگشت", "inst:home", "primary")]),
    {
      type: "footer",
      text:
        "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Pʀᴇғʟɪɢʜᴛ" +
        (stateRow?.installed ? " · Installed" : " · Not Installed"),
    },
  );

  return doc(blocks);
}

function preflightDetailsDocument(report: PreflightReport) {
  const blocks: any[] = [
    ...base(
      "Pʀᴇғʟɪɢʜᴛ Dᴇᴛᴀɪʟs",
      "جزئیات فقط برای بررسی‌های این عملیات نمایش داده می‌شوند.",
    ),
    table(
      "شاخص‌های بررسی",
      report.checks.map((item) => [
        item.category,
        preflightStatusSymbol(item.status) + " " + preflightStatusLabel(item.status),
      ]),
    ),
  ];

  for (const item of report.checks.filter((entry) => !["READY", "SKIPPED"].includes(entry.status))) {
    blocks.push(
      {
        type: "details",
        summary: item.category + " · " + preflightStatusLabel(item.status),
        is_open: false,
        blocks: [
          {
            type: "paragraph",
            text: item.detail,
          },
          ...(item.action
            ? [{ type: "paragraph", text: "اقدام: " + item.action }]
            : []),
          ...(item.autoFixable
            ? [{ type: "paragraph", text: "این مورد امکان رفع خودکار دارد." }]
            : []),
        ],
      },
    );
  }

  blocks.push(
    { type: "divider" },
    buttons([button("بررسی مجدد", "inst:preflight:recheck")]),
    buttons([button("‹ بازگشت", "inst:preflight:summary", "primary")]),
    { type: "footer", text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Pʀᴇғʟɪɢʜᴛ Dᴇᴛᴀɪʟs" },
  );

  return doc(blocks);
}

function preflightReadyDocument(chat: TgChat, report: PreflightReport, session: any) {
  return doc([
    ...base(
      "Pʀᴇғʟɪɢʜᴛ Rᴇᴀᴅʏ",
      "مرحلهٔ بررسی پیش‌نیازها با موفقیت به وضعیت READY رسید. اجرای عملیات در این مرحله انجام نمی‌شود.",
    ),
    table("نتیجه", [
      ["گروه", chat.title || "گروه بدون نام"],
      ["عملیات", operationLabel(String(session.operation) as InstallationOperation)],
      ["وضعیت", "● آماده"],
      ["هشدارها", String(report.warningCount)],
      ["مسدودکننده", "۰"],
      ["نیازمند اقدام", String(report.actionRequiredCount)],
      ["آخرین بررسی", new Date(report.generatedAt).toLocaleString("fa-IR")],
    ]),
    {
      type: "paragraph",
      text:
        report.warningCount > 0
          ? "همهٔ پیش‌نیازهای اجباری آماده هستند؛ " +
            report.warningCount +
            " هشدار اختیاری ثبت شده است."
          : "همهٔ پیش‌نیازهای اجباری آماده هستند و هیچ مسدودکننده‌ای ثبت نشده است.",
    },
    {
      type: "paragraph",
      text: "مرز مرحلهٔ ۴ رعایت شده است: عملیات نصب، حذف، تعمیر یا به‌روزرسانی اجرا نشده است.",
    },
    { type: "divider" },
    buttons([button("بررسی مجدد", "inst:preflight:recheck")]),
    buttons([button("‹ بازگشت", "inst:home", "primary")]),
    { type: "footer", text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Pʀᴇғʟɪɢʜᴛ Rᴇᴀᴅʏ" },
  ]);
}

function reportDocument(chat: TgChat, stateRow: any, session: any) {
  const installed = Boolean(stateRow?.installed);

  return doc([
    ...base(
      "Iɴsᴛᴀʟʟ Rᴇᴘᴏʀᴛ",
      "گزارش وضعیت فعلی بدون اجرای عملیات تغییردهنده.",
    ),
    table("وضعیت فعلی", [
      ["گروه", chat.title || "گروه بدون نام"],
      ["نصب", statusText(installed)],
      ["نسخه نصب‌شده", installed ? String(stateRow?.installation_version || VERSION) : "—"],
      ["زمان نصب", stateRow?.installed_at ? new Date(stateRow.installed_at).toLocaleString("fa-IR") : "ثبت نشده"],
      ["آخرین تغییر", stateRow?.updated_at ? new Date(stateRow.updated_at).toLocaleString("fa-IR") : "ثبت نشده"],
      ["پیکربندی جاری", session ? "● نشست فعال" : "○ بدون نشست"],
      ["عملیات جاری", session ? operationLabel(String(session.operation) as InstallationOperation) : "—"],
      ["گام جاری", session ? String(session.step) : "—"],
    ]),
    {
      type: "details",
      summary: "جزئیات نشست",
      is_open: false,
      blocks: [
        {
          type: "paragraph",
          text: session
            ? "نوع نصب: " + installTypeLabel(session.install_type) +
              " · نسخه: " + String(session.version || "—") +
              " · محیط: " + String(session.environment || "—") +
              " · تنظیمات: " + settingsLabel(session.settings)
            : "نشست پیکربندی فعالی وجود ندارد.",
        },
      ],
    },
    buttons([button("بررسی سلامت نصب", "inst:health")]),
        buttons([button("‹ بازگشت", "inst:manage", "primary")]),
    { type: "footer", text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Iɴsᴛᴀʟʟ Rᴇᴘᴏʀᴛ" },
  ]);
}

function operationSelectionDocument(stateRow: any) {
  const installed = Boolean(stateRow?.installed);
  const blocks: any[] = [
    ...base(
      "Sᴇʟᴇᴄᴛ Oᴘᴇʀᴀᴛɪᴏɴ",
      "فقط عملیات سازگار با وضعیت فعلی گروه نمایش داده می‌شوند.",
    ),
    table("وضعیت", [
      ["نصب فعلی", statusText(installed)],
      ["نسخه", installed ? String(stateRow?.installation_version || VERSION) : "—"],
    ]),
    { type: "divider" },
  ];

  if (!installed) {
    blocks.push(
      buttons([button("نصب اولیه", "inst:op:install", "success")]),
      buttons([button("گزارش وضعیت", "inst:op:report")]),
    );
  } else {
    blocks.push(
      buttons([button("به‌روزرسانی", "inst:op:update", "success")]),
      buttons([button("تعمیر نصب", "inst:op:repair", "success")]),
      buttons([button("نصب مجدد", "inst:op:reinstall", "danger")]),
      buttons([button("حذف نصب", "inst:op:uninstall", "danger")]),
      buttons([button("گزارش وضعیت", "inst:op:report")]),
    );
  }

  blocks.push(
    buttons([button("‹ بازگشت", "inst:home", "primary")]),
    { type: "footer", text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Oᴘᴇʀᴀᴛɪᴏɴ Sᴇʟᴇᴄᴛ" },
  );

  return doc(blocks);
}

function installTypeDocument(operation: InstallationOperation) {
  return doc([
    ...base(
      "Iɴsᴛᴀʟʟ Tʏᴘᴇ",
      "برای این عملیات، نوع اجرای پیکربندی را انتخاب کنید.",
    ),
    table("عملیات", [
      ["عملیات", operationLabel(operation)],
      ["نوع", "هنوز انتخاب نشده"],
    ]),
    {
      type: "details",
      summary: "تفاوت دو مسیر",
      is_open: false,
      blocks: [
        {
          type: "paragraph",
          text: "نصب سریع از تنظیمات استاندارد استفاده می‌کند و ورودی فنی از شما نمی‌گیرد.",
        },
        {
          type: "paragraph",
          text: "نصب سفارشی نسخه، محیط و تنظیمات را به‌صورت جداگانه دریافت می‌کند.",
        },
      ],
    },
    buttons([button("نصب سریع", `inst:type:quick:${operation}`, "success")]),
    buttons([button("نصب سفارشی", `inst:type:custom:${operation}`, "success")]),
    buttons([button("‹ بازگشت", "inst:operations", "primary")]),
    { type: "footer", text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Iɴsᴛᴀʟʟ Tʏᴘᴇ" },
  ]);
}

function versionDocument() {
  return doc([
    ...base(
      "Sᴇʟᴇᴄᴛ Vᴇʀsɪᴏɴ",
      "نسخه را انتخاب کنید یا نسخهٔ دقیق را به‌صورت متن ارسال کنید.",
    ),
    table("ورودی فعلی", [
      ["فیلد", "نسخه"],
      ["فرمت دقیق", "v1.2.3"],
      ["آخرین نسخه", "latest"],
    ]),
    buttons([button("آخرین نسخه", "inst:version:latest", "success")]),
    buttons([button(VERSION, "inst:version:current", "success")]),
    buttons([button("ارسال نسخه دیگر", "inst:version:input")]),
    buttons([button("‹ بازگشت", "inst:type:back", "primary")]),
    {
      type: "footer",
      text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Sᴇʟᴇᴄᴛ Vᴇʀsɪᴏɴ",
    },
  ]);
}

function environmentDocument() {
  return doc([
    ...base(
      "Sᴇʟᴇᴄᴛ Eɴᴠɪʀᴏɴᴍᴇɴᴛ",
      "محیط مقصد را مشخص کنید. این انتخاب در اجرای واقعی عملیات استفاده خواهد شد.",
    ),
    table("محیط", [
      ["انتخاب فعلی", "هنوز انتخاب نشده"],
      ["گزینه‌ها", "production · staging · development"],
    ]),
    buttons([button("production", "inst:env:production", "success")]),
    buttons([button("staging", "inst:env:staging", "success")]),
    buttons([button("development", "inst:env:development", "success")]),
    buttons([button("‹ بازگشت", "inst:version", "primary")]),
    { type: "footer", text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Sᴇʟᴇᴄᴛ Eɴᴠɪʀᴏɴᴍᴇɴᴛ" },
  ]);
}

function settingsDocument() {
  return doc([
    ...base(
      "Cᴜsᴛᴏᴍ Sᴇᴛᴛɪɴɢs",
      "تنظیمات سفارشی را ارسال کنید یا تنظیمات استاندارد را انتخاب کنید.",
    ),
    table("فرمت ورودی", [
      ["استاندارد", "{}"],
      ["سفارشی", "یک JSON object معتبر"],
      ["حداکثر", "۳۰ گزینه · ۴۰۰۰ نویسه"],
    ]),
    {
      type: "code",
      text: '{ "response_policy": "standard", "security_mode": "strict" }',
      language: "json",
    },
    buttons([button("استفاده از استاندارد", "inst:settings:standard", "success")]),
    buttons([button("ارسال تنظیمات سفارشی", "inst:settings:input", "success")]),
    buttons([button("‹ بازگشت", "inst:environment", "primary")]),
    { type: "footer", text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Cᴜsᴛᴏᴍ Sᴇᴛᴛɪɴɢs" },
  ]);
}

function summaryDocument(chat: TgChat, session: any, destructive: boolean) {
  const settings = session.settings && Object.keys(session.settings).length
    ? settingsLabel(session.settings)
    : "استاندارد";

  return doc([
    ...base(
      "Cᴏɴғɪʀᴍ Oᴘᴇʀᴀᴛɪᴏɴ",
      "خلاصهٔ دقیق ورودی‌ها را بررسی کنید؛ تا این نقطه هنوز عملیات اجرایی انجام نشده است.",
    ),
    table("خلاصهٔ درخواست", [
      ["گروه", chat.title || "گروه بدون نام"],
      ["عملیات", operationLabel(String(session.operation) as InstallationOperation)],
      ["نوع نصب", installTypeLabel(session.install_type)],
      ["نسخه", String(session.version || "—")],
      ["محیط", String(session.environment || "—")],
      ["تنظیمات", settings],
      ["وضعیت", "● منتظر تأیید"],
    ]),
    {
      type: "paragraph",
      text: destructive
        ? "این عملیات می‌تواند وضعیت فعلی گروه را تغییر دهد. تأیید نهایی را فقط بعد از بررسی خلاصه انجام دهید."
        : "تأیید این صفحه فقط پیکربندی را نهایی می‌کند. بررسی پیش‌نیازها و اجرای واقعی در مراحل بعد انجام می‌شود.",
    },
    buttons([
      button(
        destructive ? "تأیید عملیات" : "تأیید و ادامه",
        "inst:confirm",
        destructive ? "danger" : "success",
      ),
    ]),
    buttons([button("‹ بازگشت", "inst:summary:back", "primary")]),
    { type: "footer", text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Cᴏɴғɪʀᴍ Oᴘᴇʀᴀᴛɪᴏɴ" },
  ]);
}

function confirmedDocument(chat: TgChat, session: any) {
  return doc([
    ...base(
      "Cᴏɴғɪʀᴍᴇᴅ",
      "پیکربندی مرحلهٔ ۳ با موفقیت ثبت شد. هنوز هیچ نصب، حذف، تعمیر یا به‌روزرسانی واقعی اجرا نشده است.",
    ),
    table("نتیجه", [
      ["گروه", chat.title || "گروه بدون نام"],
      ["عملیات", operationLabel(String(session.operation) as InstallationOperation)],
      ["نوع نصب", installTypeLabel(session.install_type)],
      ["نسخه", String(session.version || "—")],
      ["محیط", String(session.environment || "—")],
      ["تنظیمات", settingsLabel(session.settings)],
      ["وضعیت", "● آماده برای مرحلهٔ بعد"],
    ]),
    {
      type: "paragraph",
      text: "مرز مرحلهٔ ۳ رعایت شد: ورودی‌ها دریافت، اعتبارسنجی و تأیید شدند؛ بررسی پیش‌نیازها هنوز اجرا نشده است.",
    },
    buttons([button("بررسی سیستم", "inst:check")]),
    buttons([button("مدیریت نصب", "inst:manage")]),
    buttons([button("‹ بازگشت", "inst:home", "primary")]),
    { type: "footer", text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Cᴏɴғɪʀᴍᴇᴅ" },
  ]);
}

function invalidInputDocument(message: string, backCallback: string) {
  return doc([
    ...base(
      "Iɴᴠᴀʟɪᴅ Iɴᴘᴜᴛ",
      "مقدار ارسال‌شده با قرارداد این مرحله سازگار نیست.",
    ),
    table("نتیجه", [
      ["وضعیت", "○ نامعتبر"],
      ["دلیل", message],
    ]),
    buttons([button("تلاش دوباره", "inst:retry")]),
    buttons([button("‹ بازگشت", backCallback, "primary")]),
    { type: "footer", text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Iɴᴘᴜᴛ Vᴀʟɪᴅᴀᴛɪᴏɴ" },
  ]);
}

async function beginOperation(
  pool: Pool,
  chat: TgChat,
  actorId: number,
  operation: InstallationOperation,
) {
  const row = await state(pool, chat.id);
  const installed = Boolean(row?.installed);

  const activeProgress = await getActiveInstallationProgress(pool, chat.id);
  if (activeProgress) return "active_execution";

  if (!installationOperationAllowed(operation, installed)) {
    if (operation === "install" && installed) return "installed";
    if (["update", "repair", "reinstall", "uninstall"].includes(operation) && !installed) return "not_installed";
    return "not_allowed";
  }

  const existingSession = await getSession(pool, chat.id);
  if (existingSession && Number(existingSession.actor_id) !== actorId) {
    return "session_owned_by_other";
  }

  const session = defaultSession(operation, actorId);

  if (operation === "install" || operation === "reinstall") {
    session.step = "install_type";
  } else if (operation === "uninstall") {
    session.step = "summary";
  } else if (operation === "update" || operation === "repair") {
    session.version = "latest";
    session.environment = "production";
    session.install_type = "quick";
    session.settings = {};
    session.step = "summary";
  } else {
    session.step = "summary";
  }

  await saveSession(pool, chat.id, session);
  await logInstallEvent(pool, chat.id, actorId, "operation_selected", {
    operation,
  });

  return session;
}

async function applyInstallType(
  pool: Pool,
  chat: TgChat,
  actorId: number,
  type: InstallType,
  operation: InstallationOperation,
  messageId: number,
) {
  const session = defaultSession(operation, actorId);
  session.install_type = type;

  if (type === "quick") {
    session.version = "latest";
    session.environment = "production";
    session.settings = {};
    session.step = "summary";
  } else {
    session.step = "version";
  }

  await saveSession(pool, chat.id, session);
  await render(
    chat.id,
    messageId,
    type === "quick"
      ? summaryDocument(chat, session, isDestructive(operation))
      : versionDocument(),
  );
}

async function renderCurrentSession(pool: Pool, chat: TgChat, messageId: number) {
  const session = await getSession(pool, chat.id);
  if (!session) {
    await render(
      chat.id,
      messageId,
      operationSelectionDocument(await state(pool, chat.id)),
    );
    return;
  }

  const operation = String(session.operation) as InstallationOperation;
  if (session.step === "install_type") {
    await render(chat.id, messageId, installTypeDocument(operation));
  } else if (session.step === "version") {
    await render(chat.id, messageId, versionDocument());
  } else if (session.step === "environment") {
    await render(chat.id, messageId, environmentDocument());
  } else if (session.step === "settings") {
    await render(chat.id, messageId, settingsDocument());
  } else if (session.step === "preflight") {
    const report = preflightReportFromSession(session);
    if (report) {
      await render(chat.id, messageId, preflightSummaryDocument(chat, await state(pool, chat.id), session, report));
    } else {
      await runPreflightForCurrentSession(pool, chat, Number(session.actor_id), messageId, false);
    }
  } else if (session.step === "summary") {
    await render(chat.id, messageId, summaryDocument(chat, session, isDestructive(operation)));
  } else if (session.step === "confirmed") {
    await render(chat.id, messageId, confirmedDocument(chat, session));
  } else if (
    session.step === "executing" ||
    session.step === "verifying" ||
    session.step === "completed" ||
    session.step === "failed"
  ) {
    const latestProgress = await getLatestInstallationProgressForGroup(pool, chat.id);
    if (
      latestProgress &&
      latestProgress.operation === String(session.operation)
    ) {
      await render(
        chat.id,
        messageId,
        installationProgressDocument(chat, latestProgress),
      );
    } else {
      const report = preflightReportFromSession(session);
      if (report) {
        const phase =
          session.step === "executing"
            ? "EXECUTING"
            : session.step === "verifying"
              ? "VERIFYING"
              : session.step === "completed"
                ? "COMPLETED"
                : "FAILED";
        await render(
          chat.id,
          messageId,
          installationExecutionDocument(
            chat,
            String(session.operation) as InstallationOperation,
            phase,
            resolveExecutionVersion(session.version),
          ),
        );
      } else {
        await render(
          chat.id,
          messageId,
          operationSelectionDocument(await state(pool, chat.id)),
        );
      }
    }
  } else {
    await render(chat.id, messageId, operationSelectionDocument(await state(pool, chat.id)));
  }
}


type InstallationExecutionPhase = "EXECUTING" | "VERIFYING" | "COMPLETED" | "FAILED";

function resolveExecutionVersion(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "latest") return VERSION;
  return raw.startsWith("v") ? raw : "v" + raw;
}

function installationExecutionDocument(
  chat: TgChat,
  operation: InstallationOperation,
  phase: InstallationExecutionPhase,
  targetVersion?: string,
  detail?: string,
) {
  const phaseLabel: Record<InstallationExecutionPhase, string> = {
    EXECUTING: "در حال اجرا",
    VERIFYING: "در حال اعتبارسنجی",
    COMPLETED: "تکمیل شد",
    FAILED: "ناموفق",
  };

  const phaseSymbol: Record<InstallationExecutionPhase, string> = {
    EXECUTING: "●",
    VERIFYING: "●",
    COMPLETED: "●",
    FAILED: "■",
  };

  const operationAction: Record<InstallationOperation, string> = {
    install: "فعال‌سازی نصب گروه",
    update: "به‌روزرسانی تنظیمات نصب",
    repair: "ترمیم وضعیت نصب",
    reinstall: "بازسازی نصب گروه",
    uninstall: "غیرفعال‌سازی نصب گروه",
    report: "گزارش وضعیت",
  };

  const blocks: any[] = [
    ...base(
      phase === "COMPLETED"
        ? "Oᴘᴇʀᴀᴛɪᴏɴ Cᴏᴍᴘʟᴇᴛᴇᴅ"
        : phase === "FAILED"
          ? "Oᴘᴇʀᴀᴛɪᴏɴ Fᴀɪʟᴇᴅ"
          : "Oᴘᴇʀᴀᴛɪᴏɴ Exᴇᴄᴜᴛɪᴏɴ",
      phase === "EXECUTING"
        ? "عملیات تأییدشده اکنون در حال اجراست."
        : phase === "VERIFYING"
          ? "عملیات اعمال شد؛ نتیجهٔ نهایی در حال بررسی است."
          : phase === "COMPLETED"
            ? "عملیات با موفقیت اجرا و نتیجهٔ آن اعتبارسنجی شد."
            : "عملیات کامل نشد؛ وضعیت نتیجه در گزارش ثبت شده است.",
    ),
    table("وضعیت عملیات", [
      ["گروه", chat.title || "گروه بدون نام"],
      ["عملیات", operationLabel(operation)],
      ["اقدام", operationAction[operation]],
      ["مرحله", phaseSymbol[phase] + " " + phaseLabel[phase]],
      ["نسخه مقصد", targetVersion || "—"],
    ]),
  ];

  if (detail) {
    blocks.push({
      type: "paragraph",
      text: detail,
    });
  }

  if (phase === "COMPLETED") {
    blocks.push(
      { type: "divider" },
      buttons([button("گزارش وضعیت", "inst:op:report")]),
      buttons([button("بازگشت به مرکز نصب", "inst:home", "primary")]),
    );
  } else if (phase === "FAILED") {
    blocks.push(
      { type: "divider" },
      buttons([button("بررسی مجدد", "inst:preflight:recheck")]),
      buttons([button("گزارش وضعیت", "inst:op:report")]),
      buttons([button("‹ بازگشت", "inst:home", "primary")]),
    );
  }

  blocks.push({
    type: "footer",
    text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Oᴘᴇʀᴀᴛɪᴏɴ Eɴɢɪɴᴇ",
  });

  return doc(blocks);
}

function sanitizePermissionSnapshot(member: any) {
  if (!member?.result) return {};
  const result = member.result;
  return {
    status: String(result.status ?? ""),
    user_id: Number(result.user?.id ?? 0),
    can_delete_messages: result.can_delete_messages ?? null,
    can_restrict_members: result.can_restrict_members ?? null,
    can_invite_users: result.can_invite_users ?? null,
    can_pin_messages: result.can_pin_messages ?? null,
    can_manage_video_chats: result.can_manage_video_chats ?? null,
    can_change_info: result.can_change_info ?? null,
    captured_at: new Date().toISOString(),
  };
}

async function fetchBotPermissionSnapshot(chatId: number) {
  const me = await telegramApi<any>("getMe", {});
  if (!me.ok || !me.result?.id) {
    throw new Error(me.description || "دریافت شناسهٔ ربات از Telegram ناموفق بود.");
  }

  const member = await telegramApi<any>("getChatMember", {
    chat_id: chatId,
    user_id: Number(me.result.id),
  });

  if (!member.ok) {
    throw new Error(member.description || "دریافت وضعیت دسترسی ربات از Telegram ناموفق بود.");
  }

  return sanitizePermissionSnapshot(member);
}

function operationSettingsPatch(
  settings: unknown,
  reset = false,
): Record<string, unknown> {
  const source =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? settings as Record<string, unknown>
      : {};

  const allowedKeys = [
    "response_policy",
    "member_message_policy",
    "command_policy",
    "command_mode",
    "automation_enabled",
    "security_mode",
    "audit_enabled",
  ] as const;

  const patch: Record<string, unknown> = {};
  const stringKeys = [
    "response_policy",
    "member_message_policy",
    "command_policy",
    "command_mode",
    "security_mode",
  ] as const;
  for (const key of stringKeys) {
    if (source[key] !== undefined && typeof source[key] === "string") {
      patch[key] = source[key];
    }
  }
  for (const key of ["automation_enabled", "audit_enabled"] as const) {
    if (source[key] !== undefined && typeof source[key] === "boolean") {
      patch[key] = source[key];
    }
  }

  if (reset) {
    patch.response_policy = "standard";
    patch.member_message_policy = "silent";
    patch.command_policy = "enabled";
    patch.command_mode = "plain";
    patch.automation_enabled = false;
    patch.security_mode = "standard";
    patch.audit_enabled = true;
  }

  return patch;
}

async function executeInstallationOperation(
  pool: Pool,
  chat: TgChat,
  actorId: number,
  session: any,
  executionId = "",
): Promise<{ version: string; permissionSnapshot: Record<string, unknown> }> {
  const operation = String(session.operation) as InstallationOperation;
  if (operation === "report") {
    throw new Error("این عملیات در موتور اجرای نصب پشتیبانی نمی‌شود.");
  }
  const orchestratorOperation =
    operation as Exclude<InstallationOperation, "report">;
  const targetVersion = resolveExecutionVersion(session.version);

  const permissionSnapshot =
    operation === "uninstall"
      ? {}
      : await fetchBotPermissionSnapshot(chat.id);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      ["installation:" + String(chat.id)],
    );

    const result = await executeInstallationOrchestration(client, {
      groupId: chat.id,
      actorId,
      operation: orchestratorOperation,
      targetVersion,
      permissionSnapshot,
      session,
      executionId,
    });

    await client.query("COMMIT");

    return {
      version: result.version,
      permissionSnapshot: result.permissionSnapshot,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function verifyInstallationOperation(
  pool: Pool,
  chat: TgChat,
  session: any,
  targetVersion: string,
) {
  const operation = String(session.operation) as InstallationOperation;
  const row = (
    await pool.query(
      "SELECT installed,installation_version,bot_permission_snapshot,command_policy,automation_enabled,updated_at " +
        "FROM bot_group_installations WHERE group_id=$1 LIMIT 1",
      [String(chat.id)],
    )
  ).rows[0];

  if (!row) {
    return {
      ok: false,
      detail: "رکورد نصب گروه پس از اجرا پیدا نشد.",
    };
  }

  const installed = Boolean(row.installed);

  if (operation === "uninstall") {
    if (installed) {
      return {
        ok: false,
        detail: "حذف نصب در پایگاه داده تأیید نشد.",
      };
    }

    if (String(row.command_policy) !== "disabled") {
      return {
        ok: false,
        detail: "سیاست دستورها پس از حذف نصب هنوز غیرفعال نشده است.",
      };
    }

    return {
      ok: true,
      detail: "وضعیت حذف نصب و غیرفعال‌شدن سیاست دستورها تأیید شد.",
    };
  }

  if (!installed) {
    return {
      ok: false,
      detail: "گروه پس از عملیات هنوز فعال نیست.",
    };
  }

  if (String(row.installation_version) !== targetVersion) {
    return {
      ok: false,
      detail:
        "نسخهٔ ثبت‌شده با نسخهٔ هدف یکسان نیست: " +
        String(row.installation_version || "—") +
        " / " +
        targetVersion,
    };
  }

  let permissionNote = "دسترسی ربات دوباره بررسی نشد.";
  if (operation !== "uninstall") {
    try {
      const snapshot = await fetchBotPermissionSnapshot(chat.id);
      const status = String(snapshot.status ?? "");
      if (!["administrator", "creator"].includes(status)) {
        return {
          ok: false,
          detail: "پس از اجرا، ربات دیگر در وضعیت مدیریتی گروه نیست.",
        };
      }
      permissionNote = "دسترسی مدیریتی ربات نیز تأیید شد.";
    } catch (error) {
      return {
        ok: false,
        detail:
          "اعتبارسنجی نهایی دسترسی ربات ناموفق بود: " +
          String((error as any)?.message ?? error),
      };
    }
  }

  return {
    ok: true,
    detail:
      "وضعیت نصب، نسخهٔ هدف و یکپارچگی دسترسی ربات تأیید شد. " +
      permissionNote,
  };
}

async function executeConfirmedInstallationOperation(
  pool: Pool,
  chat: TgChat,
  actorId: number,
  messageId: number,
  existingExecutionId?: string,
) {
  const session = await getSession(pool, chat.id);
  if (!session || Number(session.actor_id) !== actorId) {
    await render(
      chat.id,
      messageId,
      operationSelectionDocument(await state(pool, chat.id)),
    );
    return { ok: false, reason: "invalid_session" as const };
  }

  const recovery = Boolean(existingExecutionId);
  const report = preflightReportFromSession(session);

  if (!recovery) {
    const activeProgress = await getActiveInstallationProgress(pool, chat.id);
    if (activeProgress) {
      await renderInstallationProgressSnapshot(
        pool,
        chat,
        activeProgress,
        "یک اجرای فعال برای این گروه وجود دارد؛ اجرای دوم شروع نشد.",
        true,
      );
      return { ok: false, reason: "active_execution" as const };
    }
  }

  if (!recovery && (!report || report.overall !== "READY")) {
    await render(
      chat.id,
      messageId,
      report
        ? preflightSummaryDocument(chat, await state(pool, chat.id), session, report)
        : operationSelectionDocument(await state(pool, chat.id)),
    );
    return { ok: false, reason: "preflight_blocked" as const };
  }

  const allowedStatuses = recovery
    ? ["confirmed", "preflight_ready", "preflight_blocked", "ready", "checking", "executing", "verifying"]
    : ["preflight_ready", "ready"];

  if (!allowedStatuses.includes(String(session.status))) {
    await render(
      chat.id,
      messageId,
      report
        ? preflightSummaryDocument(chat, await state(pool, chat.id), session, report)
        : operationSelectionDocument(await state(pool, chat.id)),
    );
    return { ok: false, reason: "preflight_not_confirmed" as const };
  }

  const operation = String(session.operation) as InstallationOperation;
  if (!["install", "update", "repair", "reinstall", "uninstall"].includes(operation)) {
    return { ok: false, reason: "unsupported_operation" as const };
  }

  const targetVersion = resolveExecutionVersion(session.version);

  let progress: InstallationProgressSnapshot;
  try {
    if (existingExecutionId) {
      progress = (await getInstallationProgress(pool, existingExecutionId))!;
      if (!progress) {
        return { ok: false, reason: "execution_not_found" as const };
      }
    } else {
      progress = await createInstallationProgress(pool, {
        groupId: chat.id,
        actorId,
        operation,
        messageId,
        metadata: {
          target_version: targetVersion,
          environment: session.environment,
          install_type: session.install_type,
        },
      });
    }
  } catch (error) {
    if (String((error as any)?.code ?? "") === "INSTALLATION_EXECUTION_ACTIVE") {
      const active =
        (await getActiveInstallationProgress(pool, chat.id)) ??
        (String((error as any)?.executionId ?? "")
          ? await getInstallationProgress(pool, String((error as any).executionId))
          : null);

      if (active) {
        await renderInstallationProgressSnapshot(
          pool,
          chat,
          active,
          "یک اجرای فعال برای این گروه وجود دارد؛ اجرای دوم شروع نشد.",
          true,
        );
      }
      return { ok: false, reason: "active_execution" as const };
    }
    throw error;
  }

  let executionStage = "execution_initialized";
  let stopHeartbeat: (() => void) | null = null;
  try {
    if (!progress.last_message_id && messageId > 0) {
      executionStage = "progress_message_attach";
      try {
        await attachInstallationProgressMessage(pool, progress.execution_id, messageId);
        progress =
          (await getInstallationProgress(pool, progress.execution_id)) ?? progress;
      } catch (error) {
        console.error("[installation] progress message attach failed:", {
          execution_id: progress.execution_id,
          error: String((error as any)?.message ?? error),
        });
      }
    }

    stopHeartbeat = startInstallationHeartbeat(pool, progress.execution_id);
    if (
      String(session.step) === "confirmed" ||
      String(session.step) === "preflight"
    ) {
      executionStage = "session_update";
      await transitionSession(
        pool,
        chat.id,
        actorId,
        "executing",
        "executing",
      );
    } else if (!["executing", "verifying"].includes(String(session.step))) {
      throw new Error("وضعیت نشست برای اجرای عملیات معتبر نیست.");
    }

    if (!existingExecutionId) {
      executionStage = "operation_event";
      await logInstallEvent(pool, chat.id, actorId, "operation_executing", {
        operation,
        target_version: targetVersion,
        execution_id: progress.execution_id,
      }).catch((error) => {
        console.error("[installation] operation event log failed:", {
          execution_id: progress.execution_id,
          error: String((error as any)?.message ?? error),
        });
      });
    }

    // Progress schema is prepared during startup/preflight. Do not run DDL
    // in the critical execution path; only read the prepared step records.
    executionStage = "progress_steps_read";
    let steps;
    try {
      steps = await getInstallationProgressStepStatuses(
        pool,
        progress.execution_id,
      );
    } catch (progressReadError) {
      console.error("[installation] progress step read failed; repairing:", {
        execution_id: progress.execution_id,
        error: String((progressReadError as any)?.message ?? progressReadError),
      });
      executionStage = "progress_steps_repair";
      await ensureInstallationProgressSchema(pool);
      steps = await ensureInstallationProgressSteps(
        pool,
        progress.execution_id,
        operation,
      );
    }
    const completed = new Set(
      steps.filter((item) => item.status === "COMPLETED").map((item) => item.step_id),
    );

    const runStep = async (
      stepId: string,
      stepProgress: number,
      status?: "RUNNING" | "COMPLETED" | "FAILED",
      detail?: string,
    ) => {
      const result = await setInstallationStepProgress(
        pool,
        progress.execution_id,
        stepId,
        stepProgress,
        status,
      );
      progress = await renderInstallationProgressSnapshot(
        pool,
        chat,
        result.snapshot,
        detail,
        false,
      );
      return result;
    };

    if (!["verify", "finalize"].includes(String(progress.current_step))) {
      if (!completed.has("prepare")) {
        await runStep("prepare", 0, "RUNNING", "مرحلهٔ آماده‌سازی آغاز شد.");
        await runStep("prepare", 100, "COMPLETED", "آماده‌سازی با موفقیت انجام شد.");
        completed.add("prepare");
      }

      if (!completed.has("apply")) {
        await runStep("apply", 0, "RUNNING", "اجرای عملیات اصلی آغاز شد.");

        const alreadyApplied = await installationEffectAlreadyApplied(
          pool,
          chat.id,
          session,
          targetVersion,
          progress.execution_id,
        );

        if (!alreadyApplied) {
          const execution = await executeInstallationOperation(
            pool,
            chat,
            actorId,
            session,
            progress.execution_id,
          );
          if (execution.version !== targetVersion) {
            throw new Error("نسخهٔ هدف پس از اجرا با درخواست نشست یکسان نیست.");
          }
        } else {
          await logInstallEvent(pool, chat.id, actorId, "operation_recovered_without_reexecution", {
            operation,
            execution_id: progress.execution_id,
          });
        }

        await runStep("apply", 100, "COMPLETED", "عملیات اصلی با موفقیت انجام شد.");
        completed.add("apply");
      }

      if (!completed.has("persist")) {
        await runStep("persist", 100, "COMPLETED", "وضعیت اجرای عملیات در پایگاه داده ثبت شد.");
        completed.add("persist");
      }
    }

    await transitionSession(
      pool,
      chat.id,
      actorId,
      "verifying",
      "verifying",
    );

    progress =
      (await setInstallationPhase(
        pool,
        progress.execution_id,
        "VERIFYING",
        "VERIFYING",
        { operation, target_version: targetVersion },
      )) ?? progress;

    if (!completed.has("verify")) {
      if (String(session.step) === "confirmed" || String(session.step) === "preflight") {
        throw new Error("نشست قبل از اعتبارسنجی به مرحلهٔ اجرا منتقل نشد.");
      }
      await runStep("verify", 10, "RUNNING", "اعتبارسنجی نهایی آغاز شد.");

      const verification = await verifyInstallationOperation(
        pool,
        chat,
        session,
        targetVersion,
      );

      if (!verification.ok) {
        const friendly = verification.detail || "اعتبارسنجی نهایی موفق نبود.";
        await setInstallationStepProgress(
          pool,
          progress.execution_id,
          "verify",
          progress.progress,
          "FAILED",
          { detail: friendly },
        );
        progress = (await recordInstallationProgressError(
          pool,
          progress.execution_id,
          "VERIFICATION_FAILED",
          friendly,
          { technical_detail: verification.detail },
        )) ?? progress;

        await transitionSession(
          pool,
          chat.id,
          actorId,
          "failed",
          "failed",
        );

        await logInstallEvent(pool, chat.id, actorId, "operation_verification_failed", {
          operation,
          target_version: targetVersion,
          detail: verification.detail,
          execution_id: progress.execution_id,
        });

        await renderInstallationProgressSnapshot(
          pool,
          chat,
          progress,
          friendly + " اجرای عملیات تا رفع این مشکل متوقف شد.",
          true,
        );

        return { ok: false, reason: "verification_failed" as const };
      }

      await runStep(
        "verify",
        100,
        "COMPLETED",
        verification.detail,
      );
      completed.add("verify");
    }

    if (!completed.has("finalize")) {
      await runStep("finalize", 0, "RUNNING", "نهایی‌سازی نتیجهٔ عملیات آغاز شد.");

      await transitionSession(
        pool,
        chat.id,
        actorId,
        "completed",
        "completed",
      );

      await runStep("finalize", 100, "COMPLETED", "نتیجهٔ عملیات ثبت و نهایی شد.");
      completed.add("finalize");
    }

    progress =
      (await setInstallationPhase(
        pool,
        progress.execution_id,
        "COMPLETED",
        "COMPLETED",
        {
          operation,
          target_version: targetVersion,
          verification: "ok",
        },
      )) ?? progress;

    await logInstallEvent(pool, chat.id, actorId, "operation_completed", {
      operation,
      target_version: targetVersion,
      execution_id: progress.execution_id,
      progress: progress.progress,
    });

    await renderInstallationProgressSnapshot(
      pool,
      chat,
      progress,
      "عملیات با موفقیت اجرا و اعتبارسنجی شد.",
      true,
    );

    return { ok: true, reason: "completed" as const };
  } catch (error) {
    const technicalDetail = String(
      (error as any)?.message ?? error ?? "Unknown installation error",
    );
    const friendly = userFacingInstallationError(error);
    const errorCode =
      String((error as any)?.code ?? "INSTALLATION_FAILED").slice(0, 80) ||
      "INSTALLATION_FAILED";

    await transitionSession(
      pool,
      chat.id,
      actorId,
      "failed",
      "failed",
    ).catch((sessionError) => {
      console.error("[installation] failed-session update error:", sessionError);
    });

    progress = (await recordInstallationProgressError(
      pool,
      progress.execution_id,
      errorCode,
      technicalDetail,
      {
        operation,
        target_version: targetVersion,
        execution_stage: executionStage,
        technical_detail: technicalDetail,
        user_message: friendly,
      },
    )) ?? progress;

    await logInstallEvent(pool, chat.id, actorId, "operation_failed", {
      operation,
      target_version: targetVersion,
      execution_id: progress.execution_id,
      error_code: errorCode,
      error_message: technicalDetail,
      execution_stage: executionStage,
      detail: technicalDetail,
      user_message: friendly,
    }).catch((logError) => {
      console.error("[installation] failure event log error:", logError);
    });

    await renderInstallationProgressSnapshot(
      pool,
      chat,
      progress,
      friendly,
      true,
    );

    return { ok: false, reason: "execution_failed" as const };
  } finally {
    stopHeartbeat?.();
  }
}

export async function resumeActiveInstallationExecutions(pool: Pool) {
  await ensureInstallationProgressSchema(pool);
  const candidates = await listRecoverableInstallationProgress(pool);

  for (const candidate of candidates) {
    try {
      const claimed = await claimInstallationProgressRecovery(
        pool,
        candidate.execution_id,
      );
      if (!claimed) continue;

      const session = await getSession(pool, Number(claimed.group_id));
      if (!session) {
        await recordInstallationProgressError(
          pool,
          claimed.execution_id,
          "SESSION_MISSING",
          "نشست اجرای عملیات پس از راه‌اندازی مجدد پیدا نشد.",
          { recovery: true },
        );
        continue;
      }

      const telegramChat = await telegramApi<any>("getChat", {
        chat_id: Number(claimed.group_id),
      });

      if (!telegramChat.ok || !telegramChat.result?.id) {
        await recordInstallationProgressError(
          pool,
          claimed.execution_id,
          "CHAT_RECOVERY_FAILED",
          "دریافت اطلاعات گروه برای بازیابی عملیات انجام نشد.",
          { recovery: true, telegram_detail: telegramChat.description ?? null },
        );
        continue;
      }

      const chat: TgChat = {
        id: Number(telegramChat.result.id),
        type: String(telegramChat.result.type ?? "supergroup"),
        title: telegramChat.result.title ?? undefined,
        username: telegramChat.result.username ?? undefined,
      };

      let messageId = Number(claimed.last_message_id ?? 0);
      if (messageId <= 0) {
        const sent = await render(
          chat.id,
          undefined,
          installationProgressDocument(
            chat,
            claimed,
            "عملیات ناتمام پس از راه‌اندازی مجدد شناسایی شد؛ بازیابی ادامه دارد.",
          ),
        );
        messageId = Number((sent as any)?.result?.message_id ?? 0);
        if (messageId > 0) {
          await attachInstallationProgressMessage(
            pool,
            claimed.execution_id,
            messageId,
          );
        }
      }

      await logInstallEvent(
        pool,
        chat.id,
        Number(session.actor_id),
        "operation_recovery_started",
        {
          execution_id: claimed.execution_id,
          operation: claimed.operation,
          previous_status: candidate.status,
          current_step: candidate.current_step,
        },
      ).catch(() => {});

      await executeConfirmedInstallationOperation(
        pool,
        chat,
        Number(session.actor_id),
        messageId,
        claimed.execution_id,
      );
    } catch (error) {
      console.error(
        "[installation-progress] recovery failed:",
        candidate.execution_id,
        error,
      );
    }
  }
}

async function runPreflightForCurrentSession(
  pool: Pool,
  chat: TgChat,
  actorId: number,
  messageId: number,
  autoFix = false,
) {
  let session = await getSession(pool, chat.id);

  if (!session) {
    const currentState = await state(pool, chat.id);
    const operation: InstallationOperation = currentState?.installed ? "report" : "install";
    const temporary = defaultSession(operation, actorId);
    if (operation === "install") {
      temporary.install_type = "quick";
      temporary.version = "latest";
      temporary.environment = "production";
    }
    temporary.step = "preflight";
    temporary.status = "preflight_report";
    await saveSession(pool, chat.id, temporary);
    session = await getSession(pool, chat.id);
  }

  if (!session || Number(session.actor_id) !== actorId) {
    await render(
      chat.id,
      messageId,
      operationSelectionDocument(await state(pool, chat.id)),
    );
    return null;
  }

  const installationState = await state(pool, chat.id);
  const operation = String(session.operation) as InstallationOperation;

  await transitionSession(
    pool,
    chat.id,
    actorId,
    "preflight",
    "checking",
  );

  const report = await runInstallationPreflight({
    pool,
    chatId: chat.id,
    actorId,
    operation,
    installed: Boolean(installationState?.installed),
    version: session.version,
    environment: session.environment,
    settings: session.settings,
    sessionConfirmed: Boolean(session.confirmed),
    autoFix,
    ensureSchema: () => ensureSchema(pool),
  });

  const nextStatus =
    report.overall === "READY" ? "preflight_ready" : "preflight_blocked";

  await transitionSession(
    pool,
    chat.id,
    actorId,
    "preflight",
    nextStatus,
    { preflight: report },
  );

  await logInstallEvent(pool, chat.id, actorId, "preflight_completed", {
    operation,
    overall: report.overall,
    warning_count: report.warningCount,
    blocker_count: report.blockerCount,
    auto_fixable_count: report.autoFixableCount,
    auto_fixed_count: report.autoFixedCount,
    auto_fix_requested: autoFix,
  });

  const fresh = await getSession(pool, chat.id);
  if (fresh) {
    await render(
      chat.id,
      messageId,
      preflightSummaryDocument(chat, installationState, fresh, report),
    );
  }

  return report;
}

export function isInstallationCommandText(value: unknown) {
  return isInstallText(value) || isUninstallText(value);
}

export function installationInputValidation(value: string, mode: "version" | "settings") {
  if (mode === "version") {
    const version = canonicalVersion(value);
    return version ? { ok: true as const, value: version } : { ok: false as const };
  }

  const settings = parseCustomSettings(value);
  return settings ? { ok: true as const, value: settings } : { ok: false as const };
}

export async function handleInstallationInput(
  pool: Pool,
  msg: TgMessage,
  owners: string[],
  sudo: string[],
): Promise<InstallationInputResult> {
  if (!msg.from || ["private", "channel"].includes(msg.chat.type)) return "ignored";
  if (!authorized(msg.from.id, owners, sudo)) return "ignored";

  await ensureSchema(pool);

  const session = await getSession(pool, msg.chat.id);
  if (!session) return "ignored";
  if (Number(session.actor_id) !== msg.from.id) return "ignored";

  const text = msg.text || msg.caption || "";
  if (!String(text).trim()) return "handled";

  const value = String(text).trim();

  if (["لغو", "لغو نصب", "cancel", "انصراف"].includes(plain(value))) {
    await clearSession(pool, msg.chat.id, msg.from.id);
    await render(
      msg.chat.id,
      undefined,
      mainCenterDocument(msg.chat, await state(pool, msg.chat.id), null),
    );
    return "handled";
  }

  if (session.step === "version") {
    const result = installationInputValidation(value, "version");
    if (!result.ok) {
      await render(
        msg.chat.id,
        undefined,
        invalidInputDocument(
          "فرمت نسخه معتبر نیست. نمونه: v1.2.3 یا latest",
          "inst:version",
        ),
      );
      return "handled";
    }

    await transitionSession(
      pool,
      msg.chat.id,
      msg.from.id,
      "environment",
      "collecting",
      { version: result.value },
    );
    const fresh = await getSession(pool, msg.chat.id);
    await render(msg.chat.id, undefined, environmentDocument());
    if (fresh) {
      await logInstallEvent(pool, msg.chat.id, msg.from.id, "input_version_saved", {
        version: result.value,
      });
    }
    return "handled";
  }

  if (session.step === "settings") {
    const result = installationInputValidation(value, "settings");
    if (!result.ok) {
      await render(
        msg.chat.id,
        undefined,
        invalidInputDocument(
          "تنظیمات باید یک JSON object معتبر و حداکثر ۳۰ گزینه باشد.",
          "inst:settings",
        ),
      );
      return "handled";
    }

    await transitionSession(
      pool,
      msg.chat.id,
      msg.from.id,
      "summary",
      "collecting",
      { settings: result.value },
    );
    const fresh = await getSession(pool, msg.chat.id);
    if (fresh) {
      await logInstallEvent(pool, msg.chat.id, msg.from.id, "input_settings_saved", {
        keys: Object.keys(result.value),
      });
      await render(
        msg.chat.id,
        undefined,
        summaryDocument(msg.chat, fresh, isDestructive(String(fresh.operation) as InstallationOperation)),
      );
    }
    return "handled";
  }

  return "ignored";
}

export async function sweepExpiredInstallationSessions(pool: Pool) {
  const result = await pool.query(
    "DELETE FROM bot_installation_sessions s " +
      "WHERE s.expires_at <= NOW() " +
      "AND NOT EXISTS (" +
        "SELECT 1 FROM bot_installation_progress p " +
        "WHERE p.group_id=s.group_id " +
        "AND p.status IN ('PENDING','RUNNING','VERIFYING','RECOVERING','STALE')" +
      ") " +
      "RETURNING group_id,actor_id,operation",
  );
  for (const row of result.rows) {
    await logInstallEvent(
      pool,
      Number(row.group_id),
      Number(row.actor_id),
      "session_expired",
      { operation: String(row.operation) },
    ).catch(() => {});
  }
  return result.rowCount ?? 0;
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
  if (!msg.from || ["private", "channel"].includes(msg.chat.type)) return "drop";

  await ensureSchema(pool);
  await ensureGroup(pool, msg.chat);

  const installationState = await state(pool, msg.chat.id);
  const raw = msg.text || msg.caption || "";
  const isOperator = authorized(msg.from.id, owners, sudo);

  if (allowActions && isOperator && isInstallText(raw)) {
    const session = await getSession(pool, msg.chat.id);
    await render(
      msg.chat.id,
      undefined,
      mainCenterDocument(msg.chat, installationState, session),
    );
    return "handled";
  }

  if (allowActions && isOperator && isUninstallText(raw)) {
    await render(
      msg.chat.id,
      undefined,
      mainCenterDocument(msg.chat, installationState, await getSession(pool, msg.chat.id)),
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

  if (!isKnownInstallationCallback(data)) {
    await answer(cb.id, "این گزینه دیگر فعال نیست");
    return true;
  }

  await ensureSchema(pool);
  await ensureGroup(pool, cb.message.chat);

  const chat = cb.message.chat;
  let notice = "انجام شد";

  try {
    if (data === "inst:home" || data === "inst:cancel") {
      const activeProgress = await getActiveInstallationProgress(pool, chat.id);
      if (activeProgress) {
        await renderInstallationProgressSnapshot(
          pool,
          chat,
          activeProgress,
          "تا پایان عملیات فعال، نشست اجرا قابل بستن نیست.",
          true,
        );
        notice = "یک عملیات فعال برای این گروه وجود دارد";
        return true;
      }

      const activeSession = await getSession(pool, chat.id);
      if (activeSession && Number(activeSession.actor_id) !== cb.from.id) {
        notice = "این نشست توسط کاربر دیگری در حال استفاده است";
        await renderCurrentSession(pool, chat, cb.message.message_id);
        return true;
      }

      await clearSession(pool, chat.id, cb.from.id);
      await render(
        chat.id,
        cb.message.message_id,
        mainCenterDocument(chat, await state(pool, chat.id), null),
      );
      if (data === "inst:cancel") notice = "مرکز نصب بسته شد";
      return true;
    }

    if (data === "inst:operations") {
      const session = await getSession(pool, chat.id);
      if (session && Number(session.actor_id) !== cb.from.id) {
        notice = "نشست نصب این گروه توسط کاربر دیگری در حال استفاده است";
        await renderCurrentSession(pool, chat, cb.message.message_id);
        return true;
      }
      if (session) await clearSession(pool, chat.id, cb.from.id);
      await render(
        chat.id,
        cb.message.message_id,
        operationSelectionDocument(await state(pool, chat.id)),
      );
      return true;
    }

    if (data === "inst:health") {
      const diagnostic = await diagnoseInstallation(pool, chat.id);
      await render(
        chat.id,
        cb.message.message_id,
        installationDiagnosticDocument(chat.title || "گروه بدون نام", diagnostic),
      );
      notice = diagnostic.health.ok ? "سلامت نصب تأیید شد" : "نصب نیازمند بررسی است";
      return true;
    }

    if (data === "inst:manage") {
      const activeSession = await getSession(pool, chat.id);
      if (activeSession && Number(activeSession.actor_id) !== cb.from.id) {
        notice = "این نشست توسط کاربر دیگری در حال استفاده است";
        await renderCurrentSession(pool, chat, cb.message.message_id);
        return true;
      }

      await clearSession(pool, chat.id, cb.from.id);
      await render(
        chat.id,
        cb.message.message_id,
        managementDocument(chat, await state(pool, chat.id)),
      );
      return true;
    }

    if (data === "inst:check") {
      await runPreflightForCurrentSession(
        pool,
        chat,
        cb.from.id,
        cb.message.message_id,
        false,
      );
      return true;
    }

    if (data.startsWith("inst:op:")) {
      const operation = data.slice("inst:op:".length) as InstallationOperation;
      if (!["install", "update", "repair", "reinstall", "uninstall", "report"].includes(operation)) {
        notice = "عملیات نامعتبر است";
        return true;
      }

      if (operation === "report") {
        await render(
          chat.id,
          cb.message.message_id,
          reportDocument(
            chat,
            await state(pool, chat.id),
            await getSession(pool, chat.id),
          ),
        );
        return true;
      }

      const result = await beginOperation(pool, chat, cb.from.id, operation);

      if (result === "installed") {
        await render(
          chat.id,
          cb.message.message_id,
          mainCenterDocument(chat, await state(pool, chat.id), null),
        );
        notice = "این گروه از قبل نصب شده است";
        return true;
      }

      if (result === "not_installed") {
        await render(
          chat.id,
          cb.message.message_id,
          operationSelectionDocument(await state(pool, chat.id)),
        );
        notice = "این عملیات برای وضعیت فعلی قابل اجرا نیست";
        return true;
      }

      if (result === "session_owned_by_other") {
        notice = "نشست نصب این گروه توسط کاربر دیگری در حال استفاده است";
        return true;
      }

      if (result === "active_execution") {
        const activeProgress = await getActiveInstallationProgress(pool, chat.id);
        if (activeProgress) {
          await renderInstallationProgressSnapshot(
            pool,
            chat,
            activeProgress,
            "اجرای دوم مجاز نیست؛ عملیات فعال همین‌جا دنبال می‌شود.",
            true,
          );
        }
        notice = "یک عملیات فعال برای این گروه وجود دارد";
        return true;
      }

      await renderCurrentSession(pool, chat, cb.message.message_id);
      return true;
    }

    if (data.startsWith("inst:type:")) {
      const parts = data.split(":");
      const type = parts[2] as InstallType;
      const operation = parts[3] as InstallationOperation;
      const session = await getSession(pool, chat.id);

      if (!["quick", "custom"].includes(type)) {
        notice = "نوع نصب نامعتبر است";
        return true;
      }

      if (!["install", "reinstall"].includes(operation)) {
        notice = "این نوع نصب برای عملیات فعلی مجاز نیست";
        return true;
      }

      if (
        !session ||
        Number(session.actor_id) !== cb.from.id ||
        String(session.step) !== "install_type" ||
        String(session.operation) !== operation
      ) {
        notice = "این دکمه مربوط به نشست فعلی نیست";
        return true;
      }

      await applyInstallType(
        pool,
        chat,
        cb.from.id,
        type,
        operation,
        cb.message.message_id,
      );
      return true;
    }

    if (data === "inst:type:back") {
      const session = await getSession(pool, chat.id);
      if (
        session &&
        Number(session.actor_id) === cb.from.id &&
        String(session.step) === "version"
      ) {
        await transitionSession(pool, chat.id, cb.from.id, "install_type", "collecting");
      }
      await render(
        chat.id,
        cb.message.message_id,
        session?.operation && ["install", "reinstall"].includes(String(session.operation))
          ? installTypeDocument(String(session.operation) as InstallationOperation)
          : operationSelectionDocument(await state(pool, chat.id)),
      );
      return true;
    }

    if (data === "inst:version:back") {
      const session = await getSession(pool, chat.id);
      if (!session || Number(session.actor_id) !== cb.from.id || String(session.step) !== "version") {
        notice = "نشست نسخه معتبر نیست";
        return true;
      }
      await transitionSession(pool, chat.id, cb.from.id, "install_type", "collecting");
      await render(chat.id, cb.message.message_id, installTypeDocument(String(session.operation) as InstallationOperation));
      return true;
    }

    if (data === "inst:version:latest" || data === "inst:version:current") {
      const session = await getSession(pool, chat.id);
      if (
        !session ||
        Number(session.actor_id) !== cb.from.id ||
        String(session.step) !== "version" ||
        !["install", "reinstall"].includes(String(session.operation))
      ) {
        notice = "انتخاب نسخه مربوط به نشست فعلی نیست";
        return true;
      }
      const version = data.endsWith(":current") ? VERSION : "latest";
      await transitionSession(
        pool,
        chat.id,
        cb.from.id,
        "environment",
        "collecting",
        { version },
      );
      await render(chat.id, cb.message.message_id, environmentDocument());
      return true;
    }

    if (data === "inst:version:input") {
      const session = await getSession(pool, chat.id);
      if (
        !session ||
        Number(session.actor_id) !== cb.from.id ||
        String(session.step) !== "version" ||
        !["install", "reinstall"].includes(String(session.operation))
      ) {
        notice = "ورودی نسخه مربوط به نشست فعلی نیست";
        return true;
      }
      await transitionSession(
        pool,
        chat.id,
        cb.from.id,
        "version",
        String(session.status) as InstallationSessionStatus,
      );
      await render(
        chat.id,
        cb.message.message_id,
        doc([
          ...base(
            "Vᴇʀsɪᴏɴ Iɴᴘᴜᴛ",
            "نسخهٔ دقیق را در پیام بعدی ارسال کنید.",
          ),
          table("فرمت", [
            ["نمونه", "v1.2.3"],
            ["آخرین نسخه", "latest"],
          ]),
          buttons([button("‹ بازگشت", "inst:version:back", "primary")]),
          { type: "footer", text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Vᴇʀsɪᴏɴ Iɴᴘᴜᴛ" },
        ]),
      );
      return true;
    }

    if (data === "inst:version") {
      const session = await getSession(pool, chat.id);
      if (session && Number(session.actor_id) === cb.from.id && String(session.step) === "environment") {
        await transitionSession(pool, chat.id, cb.from.id, "version", "collecting");
      }
      await render(chat.id, cb.message.message_id, versionDocument());
      return true;
    }

    if (data.startsWith("inst:env:")) {
      const environment = data.slice("inst:env:".length);
      const session = await getSession(pool, chat.id);
      if (!["production", "staging", "development"].includes(environment)) {
        notice = "محیط نامعتبر است";
        return true;
      }
      if (
        !session ||
        Number(session.actor_id) !== cb.from.id ||
        String(session.step) !== "environment" ||
        !["install", "reinstall"].includes(String(session.operation))
      ) {
        notice = "انتخاب محیط مربوط به نشست فعلی نیست";
        return true;
      }

      await transitionSession(
        pool,
        chat.id,
        cb.from.id,
        "settings",
        "collecting",
        { environment },
      );
      await render(chat.id, cb.message.message_id, settingsDocument());
      return true;
    }

    if (data === "inst:environment") {
      const session = await getSession(pool, chat.id);
      if (session && Number(session.actor_id) === cb.from.id && String(session.step) === "settings") {
        await transitionSession(pool, chat.id, cb.from.id, "environment", "collecting");
      }
      await render(chat.id, cb.message.message_id, environmentDocument());
      return true;
    }

    if (data === "inst:settings:standard") {
      const session = await getSession(pool, chat.id);
      if (
        !session ||
        Number(session.actor_id) !== cb.from.id ||
        String(session.step) !== "settings" ||
        !["install", "reinstall"].includes(String(session.operation))
      ) {
        notice = "تنظیمات مربوط به نشست فعلی نیست";
        return true;
      }
      await transitionSession(
        pool,
        chat.id,
        cb.from.id,
        "summary",
        "collecting",
        { settings: {} },
      );
      const session = await getSession(pool, chat.id);
      if (session) {
        await render(
          chat.id,
          cb.message.message_id,
          summaryDocument(chat, session, isDestructive(String(session.operation) as InstallationOperation)),
        );
      }
      return true;
    }

    if (data === "inst:settings:input") {
      const session = await getSession(pool, chat.id);
      if (
        !session ||
        Number(session.actor_id) !== cb.from.id ||
        String(session.step) !== "settings" ||
        !["install", "reinstall"].includes(String(session.operation))
      ) {
        notice = "ورودی تنظیمات مربوط به نشست فعلی نیست";
        return true;
      }
      await transitionSession(
        pool,
        chat.id,
        cb.from.id,
        "settings",
        String(session.status) as InstallationSessionStatus,
      );
      await render(
        chat.id,
        cb.message.message_id,
        doc([
          ...base(
            "Sᴇᴛᴛɪɴɢ Iɴᴘᴜᴛ",
            "تنظیمات سفارشی را به‌صورت یک JSON object در پیام بعدی ارسال کنید.",
          ),
          {
            type: "code",
            text: '{ "response_policy": "standard", "security_mode": "strict" }',
            language: "json",
          },
          buttons([button("‹ بازگشت", "inst:settings:back", "primary")]),
          { type: "footer", text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Sᴇᴛᴛɪɴɢ Iɴᴘᴜᴛ" },
        ]),
      );
      return true;
    }

    if (data === "inst:settings:back") {
      const session = await getSession(pool, chat.id);
      if (!session || Number(session.actor_id) !== cb.from.id || String(session.step) !== "settings") {
        notice = "نشست تنظیمات معتبر نیست";
        return true;
      }
      await transitionSession(pool, chat.id, cb.from.id, "environment", "collecting");
      await render(chat.id, cb.message.message_id, environmentDocument());
      return true;
    }

    if (data === "inst:settings") {
      const session = await getSession(pool, chat.id);
      if (session && Number(session.actor_id) === cb.from.id && String(session.step) === "summary" && ["install", "reinstall"].includes(String(session.operation))) {
        await transitionSession(pool, chat.id, cb.from.id, "settings", "collecting");
      }
      await render(chat.id, cb.message.message_id, settingsDocument());
      return true;
    }

    if (data === "inst:summary:back") {
      const session = await getSession(pool, chat.id);
      if (!session || Number(session.actor_id) !== cb.from.id || String(session.step) !== "summary") {
        notice = "نشست خلاصه معتبر نیست";
        return true;
      }

      const operation = String(session.operation) as InstallationOperation;
      if (["install", "reinstall"].includes(operation)) {
        const previousStep = session.install_type === "custom" ? "settings" : "install_type";
        await transitionSession(
          pool,
          chat.id,
          cb.from.id,
          previousStep as InstallationSessionStep,
          "collecting",
        );
        await renderCurrentSession(pool, chat, cb.message.message_id);
        return true;
      }

      await clearSession(pool, chat.id, cb.from.id);
      await render(
        chat.id,
        cb.message.message_id,
        operationSelectionDocument(await state(pool, chat.id)),
      );
      return true;
    }

    if (data === "inst:retry") {
      await renderCurrentSession(pool, chat, cb.message.message_id);
      return true;
    }

    if (data === "inst:preflight:details") {
      const session = await getSession(pool, chat.id);
      if (!session || Number(session.actor_id) !== cb.from.id || String(session.step) !== "preflight") {
        notice = "نشست بررسی معتبر نیست";
        return true;
      }
      const report = preflightReportFromSession(session);
      if (!report) {
        await runPreflightForCurrentSession(pool, chat, cb.from.id, cb.message.message_id, false);
        return true;
      }
      await render(chat.id, cb.message.message_id, preflightDetailsDocument(report));
      return true;
    }

    if (data === "inst:preflight:summary") {
      const session = await getSession(pool, chat.id);
      if (!session || Number(session.actor_id) !== cb.from.id || String(session.step) !== "preflight") {
        notice = "نشست بررسی معتبر نیست";
        return true;
      }
      const report = preflightReportFromSession(session);
      if (!session || !report) {
        await runPreflightForCurrentSession(pool, chat, cb.from.id, cb.message.message_id, false);
        return true;
      }
      await render(
        chat.id,
        cb.message.message_id,
        preflightSummaryDocument(chat, await state(pool, chat.id), session, report),
      );
      return true;
    }

    if (data === "inst:preflight:recheck") {
      const session = await getSession(pool, chat.id);
      if (!session || Number(session.actor_id) !== cb.from.id) {
        notice = "نشست بررسی معتبر نیست";
        return true;
      }

      if (String(session.step) === "failed" && String(session.status) === "failed") {
        await transitionSession(pool, chat.id, cb.from.id, "preflight", "checking");
      } else if (String(session.step) !== "preflight") {
        notice = "بررسی مجدد فقط در نشست بررسی یا پس از خطا مجاز است";
        return true;
      }

      await runPreflightForCurrentSession(
        pool,
        chat,
        cb.from.id,
        cb.message.message_id,
        false,
      );
      return true;
    }

    if (data === "inst:preflight:fix") {
      await runPreflightForCurrentSession(
        pool,
        chat,
        cb.from.id,
        cb.message.message_id,
        true,
      );
      return true;
    }

    if (data === "inst:preflight:continue") {
      const session = await getSession(pool, chat.id);
      const report = preflightReportFromSession(session);

      if (!session || Number(session.actor_id) !== cb.from.id || String(session.step) !== "preflight" || !report) {
        notice = "گزارش بررسی معتبر نیست";
        await runPreflightForCurrentSession(pool, chat, cb.from.id, cb.message.message_id, false);
        return true;
      }

      const activeProgress = await getActiveInstallationProgress(pool, chat.id);
      if (activeProgress) {
        await renderInstallationProgressSnapshot(
          pool,
          chat,
          activeProgress,
          "این عملیات قبلاً شروع شده است؛ اجرای دوم انجام نمی‌شود.",
          true,
        );
        notice = "یک عملیات فعال برای این گروه وجود دارد";
        return true;
      }

      if (report.overall !== "READY") {
        notice = "ابتدا موارد مسدودکننده را برطرف کنید";
        await render(
          chat.id,
          cb.message.message_id,
          preflightSummaryDocument(chat, await state(pool, chat.id), session, report),
        );
        return true;
      }

      if (!["preflight_ready", "ready"].includes(String(session.status ?? ""))) {
        notice = "این نشست هنوز برای اجرای عملیات آماده نیست";
        await render(
          chat.id,
          cb.message.message_id,
          preflightSummaryDocument(chat, await state(pool, chat.id), session, report),
        );
        return true;
      }

      const result = await executeConfirmedInstallationOperation(
        pool,
        chat,
        cb.from.id,
        cb.message.message_id,
      );

      notice = result.ok
        ? "عملیات با موفقیت اجرا و اعتبارسنجی شد"
        : "اجرای عملیات کامل نشد";
      return true;
    }

    if (data === "inst:confirm") {
      const session = await getSession(pool, chat.id);

      if (!session || Number(session.actor_id) !== cb.from.id || session.step !== "summary") {
        notice = "نشست تأیید معتبر نیست";
        await renderCurrentSession(pool, chat, cb.message.message_id);
        return true;
      }

      await transitionSession(
        pool,
        chat.id,
        cb.from.id,
        "confirmed",
        "confirmed",
        { confirmed: true, preflight: {} },
      );

      await logInstallEvent(pool, chat.id, cb.from.id, "stage3_confirmed", {
        operation: String(session.operation),
        install_type: session.install_type,
        version: session.version,
        environment: session.environment,
        settings: session.settings,
      });

      const confirmed = await getSession(pool, chat.id);
      if (confirmed) {
        await render(
          chat.id,
          cb.message.message_id,
          confirmedDocument(chat, confirmed),
        );
      }
      notice = "پیکربندی مرحلهٔ ۳ ثبت شد";
      return true;
    }

    notice = "این گزینه دیگر فعال نیست";
    return true;
  } catch (error) {
    console.error("[installation] callback failed:", error);

    await render(
      chat.id,
      cb.message.message_id,
      doc([
        ...base(
          "Iɴsᴛᴀʟʟ Eʀʀᴏʀ",
          "عملیات رابط نصب کامل نشد؛ وضعیت قبلی گروه حفظ شده است.",
        ),
        {
          type: "paragraph",
          text: "جزئیات فنی در لاگ سرور ثبت شده است.",
        },
        buttons([button("مدیریت نصب", "inst:manage")]),
        buttons([button("‹ بازگشت", "inst:home", "primary")]),
        { type: "footer", text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Iɴsᴛᴀʟʟ Eʀʀᴏʀ" },
      ]),
    );

    notice = "عملیات انجام نشد";
    return true;
  } finally {
    await answer(cb.id, notice);
  }
}
