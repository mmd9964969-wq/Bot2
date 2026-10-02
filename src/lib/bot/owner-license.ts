import type { Pool } from "pg";
import {
  prepareRichDocument,
  validateRichDocument,
  richDocumentToPlainText,
  type RichDocument,
} from "./rich-message.ts";
import { telegramApi } from "../telegram/api.ts";

type SudoOwnerIds = string[];

type PendingLicense = {
  flow: string;
  data: Record<string, any>;
  expires: number;
};

type LicenseRow = {
  id: number;
  code: string;
  customer_id: number;
  license_type: string;
  group_limit: number | null;
  price: number | null;
  starts_at: string | null;
  expires_at: string | null;
  status: string;
  name: string | null;
  internal_id: string | null;
  owner_id: number | null;
  plan_key: string | null;
  is_trial: boolean;
  locked: boolean;
  auto_renew: boolean;
  group_id: number | null;
  group_title: string | null;
  features: Record<string, boolean>;
  limits: Record<string, any>;
  security: Record<string, boolean>;
  metadata: Record<string, any>;
  deleted_at: string | null;
};

const pending = new Map<number, PendingLicense>();

const LICENSE_PLANS = [
  { key: "free", name: "رایگان", price: 0, days: null },
  { key: "trial", name: "آزمایشی", price: 0, days: 7 },
  { key: "basic", name: "پایه", price: 100000, days: 30 },
  { key: "standard", name: "استاندارد", price: 250000, days: 90 },
  { key: "pro", name: "حرفه‌ای", price: 600000, days: 180 },
  { key: "special", name: "ویژه", price: 1200000, days: 365 },
  { key: "enterprise", name: "سازمانی", price: 0, days: 365 },
  { key: "exclusive", name: "اختصاصی", price: 0, days: 365 },
  { key: "lifetime", name: "دائمی", price: 5000000, days: null },
  { key: "custom", name: "سفارشی", price: 0, days: 30 },
] as const;

const FEATURE_GROUPS: Record<string, { title: string; keys: string[] }> = {
  members: {
    title: "مدیریت اعضا",
    keys: ["member_manage", "member_kick", "member_ban", "member_unban", "member_mute"],
  },
  content: {
    title: "مدیریت محتوا",
    keys: ["message_delete", "cleanup", "filter_words", "custom_commands"],
  },
  protection: {
    title: "محافظت",
    keys: ["anti_spam", "anti_advertising", "anti_link", "anti_bot", "anti_flood"],
  },
  locks: {
    title: "قفل‌ها",
    keys: ["lock_media", "lock_links", "lock_files", "lock_stickers", "lock_gif", "lock_audio", "lock_video"],
  },
  automation: {
    title: "اتوماسیون",
    keys: ["welcome", "goodbye", "rules", "auto_warning", "auto_moderation"],
  },
  analytics: {
    title: "آمار و گزارش",
    keys: ["group_stats", "member_stats", "management_reports", "audit_logs"],
  },
  economy: {
    title: "اقتصاد",
    keys: ["economy", "ranking", "points"],
  },
};

const LIMIT_KEYS = [
  ["group_limit", "سقف اعضای متصل"],
  ["admin_limit", "سقف مدیران"],
  ["message_limit", "سقف پیام"],
  ["request_limit", "سقف درخواست"],
  ["command_limit", "سقف فرمان"],
  ["report_limit", "سقف گزارش"],
  ["cleanup_limit", "سقف پاکسازی"],
  ["operation_limit", "سقف عملیات مدیریتی"],
  ["daily_limit", "سقف مصرف روزانه"],
  ["monthly_limit", "سقف مصرف ماهانه"],
  ["device_limit", "سقف دستگاه"],
  ["account_limit", "سقف حساب"],
] as const;

function faNumber(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "۰";
  return new Intl.NumberFormat("fa-IR").format(n);
}

function dateFa(value: unknown) {
  if (value == null || String(value).trim() === "") return "ثبت نشده";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return "ثبت نشده";
  return new Intl.DateTimeFormat("fa-IR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tehran",
  }).format(d);
}

function statusFa(status: string, expiresAt?: unknown) {
  const s = String(status || "").toLowerCase();
  if (s === "deleted") return "حذف‌شده";
  if (s === "cancelled" || s === "canceled") return "لغوشده";
  if (s === "suspended") return "تعلیق‌شده";
  if (s === "disabled") return "غیرفعال";
  if (s === "active" && expiresAt && new Date(String(expiresAt)).getTime() <= Date.now()) return "منقضی";
  if (s === "active") return "فعال";
  if (s === "locked") return "قفل‌شده";
  return status || "نامشخص";
}

function button(
  text: string,
  callback_data: string,
  style: "primary" | "success" | "danger" | "link" = autoButtonStyle(callback_data),
) {
  return { text, callback_data, style };
}

function autoButtonStyle(callback_data: string): "primary" | "success" | "danger" | "link" {
  const data = String(callback_data || "");
  if (/delete|cancel|suspend|lock|emergency|stop_all|revoke|disconnect|unbind/i.test(data)) return "danger";
  if (/activate|restore|create|confirm|renew:set|plan:create|save|apply/i.test(data)) return "success";
  if (/center$|^o:home$|back|بازگشت/i.test(data)) return "link";
  return "primary";
}

function buttons(items: Array<{ text: string; callback_data: string }>) {
  return { type: "buttons", align: "center", buttons: items };
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
    items: items.map((item) => ({
      blocks: [{ type: "paragraph", text: item }],
    })),
  };
}

function doc(blocks: any[]): RichDocument {
  const value = prepareRichDocument({
    version: 1,
    is_rtl: true,
    blocks,
  });
  const validation = validateRichDocument(value);
  if (!validation.ok) {
    console.error("[owner-license] rich validation failed:", validation.errors);
  }
  return value;
}

function footer() {
  return { type: "footer", text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Lɪᴄᴇɴsᴇ Cᴇɴᴛᴇʀ · Pʀᴏ" };
}

function base(title: string, subtitle: string) {
  return [
    { type: "heading", text: "◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · " + title, size: 1 },
    { type: "paragraph", text: subtitle },
    { type: "divider" },
  ];
}

function buttonsToReplyMarkup(rich: RichDocument) {
  const rows = rich.blocks
    .filter((block: any) => block?.type === "buttons" && Array.isArray(block.buttons))
    .map((block: any) =>
      block.buttons
        .filter((x: any) => x?.callback_data)
        .map((x: any) => ({
          text: String(x.text ?? "—"),
          callback_data: String(x.callback_data),
        })),
    )
    .filter((row: any[]) => row.length > 0);
  return rows.length ? { inline_keyboard: rows } : undefined;
}

async function render(chatId: number, messageId: number | undefined, rich: RichDocument) {
  const plain = richDocumentToPlainText(rich);
  const reply_markup = buttonsToReplyMarkup(rich);

  try {
    const result = messageId
      ? await telegramApi("editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          rich_message: rich,
        })
      : await telegramApi("sendRichMessage", {
          chat_id: chatId,
          rich_message: rich,
        });

    if (result?.ok) return result;
  } catch (error) {
    console.error("[owner-license] Rich Message failed:", error);
  }

  return messageId
    ? telegramApi("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: plain,
        ...(reply_markup ? { reply_markup } : {}),
      })
    : telegramApi("sendMessage", {
        chat_id: chatId,
        text: plain,
        ...(reply_markup ? { reply_markup } : {}),
      });
}

function setPending(userId: number, flow: string, data: Record<string, any> = {}) {
  pending.set(userId, {
    flow,
    data,
    expires: Date.now() + 10 * 60 * 1000,
  });
}

function getPending(userId: number) {
  const row = pending.get(userId);
  if (!row) return null;
  if (row.expires <= Date.now()) {
    pending.delete(userId);
    return null;
  }
  return row;
}

function clearPending(userId: number) {
  pending.delete(userId);
}

async function audit(
  pool: Pool,
  actorId: number,
  licenseId: number | null,
  action: string,
  beforeData: any = {},
  afterData: any = {},
  meta: any = {},
) {
  await pool
    .query(
      "INSERT INTO bot_license_events(license_id,actor_id,action,before_data,after_data,meta) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)",
      [licenseId, actorId, action, JSON.stringify(beforeData), JSON.stringify(afterData), JSON.stringify(meta)],
    )
    .catch((error) => console.error("[owner-license] audit failed:", error));
}

async function ensureOwnerLicenseSchema(pool: Pool) {
  await pool.query(
    "ALTER TABLE bot_licenses ADD COLUMN IF NOT EXISTS name TEXT; " +
      "ALTER TABLE bot_licenses ADD COLUMN IF NOT EXISTS internal_id TEXT; " +
      "ALTER TABLE bot_licenses ADD COLUMN IF NOT EXISTS owner_id BIGINT; " +
      "ALTER TABLE bot_licenses ADD COLUMN IF NOT EXISTS plan_key TEXT; " +
      "ALTER TABLE bot_licenses ADD COLUMN IF NOT EXISTS is_trial BOOLEAN NOT NULL DEFAULT FALSE; " +
      "ALTER TABLE bot_licenses ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT FALSE; " +
      "ALTER TABLE bot_licenses ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN NOT NULL DEFAULT FALSE; " +
      "ALTER TABLE bot_licenses ADD COLUMN IF NOT EXISTS group_id BIGINT; " +
      "ALTER TABLE bot_licenses ADD COLUMN IF NOT EXISTS group_title TEXT; " +
      "ALTER TABLE bot_licenses ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '{}'::jsonb; " +
      "ALTER TABLE bot_licenses ADD COLUMN IF NOT EXISTS limits JSONB NOT NULL DEFAULT '{}'::jsonb; " +
      "ALTER TABLE bot_licenses ADD COLUMN IF NOT EXISTS security JSONB NOT NULL DEFAULT '{}'::jsonb; " +
      "ALTER TABLE bot_licenses ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb; " +
      "ALTER TABLE bot_licenses ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ; " +
      "ALTER TABLE bot_licenses ADD COLUMN IF NOT EXISTS deleted_by BIGINT;",
  );

  await pool.query(
    "CREATE TABLE IF NOT EXISTS bot_license_plans (" +
      "key TEXT PRIMARY KEY, " +
      "name TEXT NOT NULL, " +
      "price NUMERIC(14,2) NOT NULL DEFAULT 0, " +
      "duration_days INTEGER, " +
      "features JSONB NOT NULL DEFAULT '{}'::jsonb, " +
      "limits JSONB NOT NULL DEFAULT '{}'::jsonb, " +
      "capacity INTEGER NOT NULL DEFAULT 1, " +
      "auto_renew BOOLEAN NOT NULL DEFAULT FALSE, " +
      "active BOOLEAN NOT NULL DEFAULT TRUE, " +
      "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), " +
      "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()" +
    ")",
  );

  await pool.query(
    "CREATE TABLE IF NOT EXISTS bot_license_group_bindings (" +
      "id BIGSERIAL PRIMARY KEY, " +
      "license_id BIGINT NOT NULL REFERENCES bot_licenses(id) ON DELETE CASCADE, " +
      "group_id BIGINT NOT NULL, " +
      "group_title TEXT NOT NULL DEFAULT '', " +
      "status TEXT NOT NULL DEFAULT 'active', " +
      "connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), " +
      "disconnected_at TIMESTAMPTZ, " +
      "UNIQUE(license_id,group_id)" +
    ")",
  );

  await pool.query(
    "CREATE TABLE IF NOT EXISTS bot_license_events (" +
      "id BIGSERIAL PRIMARY KEY, " +
      "license_id BIGINT, " +
      "actor_id BIGINT NOT NULL, " +
      "action TEXT NOT NULL, " +
      "before_data JSONB NOT NULL DEFAULT '{}'::jsonb, " +
      "after_data JSONB NOT NULL DEFAULT '{}'::jsonb, " +
      "meta JSONB NOT NULL DEFAULT '{}'::jsonb, " +
      "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()" +
    ")",
  );

  await pool.query(
    "CREATE TABLE IF NOT EXISTS bot_license_controls (" +
      "key TEXT PRIMARY KEY, " +
      "value BOOLEAN NOT NULL DEFAULT FALSE, " +
      "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), " +
      "updated_by BIGINT" +
    ")",
  );

  const defaultFeatures: Record<string, boolean> = {};
  for (const group of Object.values(FEATURE_GROUPS)) {
    for (const key of group.keys) defaultFeatures[key] = true;
  }
  const defaultLimits = Object.fromEntries(
    LIMIT_KEYS.map(([key]) => [key, key === "group_limit" ? 1 : 0]),
  );

  for (const plan of LICENSE_PLANS) {
    await pool.query(
      "INSERT INTO bot_license_plans(key,name,price,duration_days,features,limits) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb) " +
        "ON CONFLICT(key) DO NOTHING",
      [
        plan.key,
        plan.name,
        plan.price,
        plan.days,
        JSON.stringify(defaultFeatures),
        JSON.stringify(defaultLimits),
      ],
    );
  }
}

async function fetchLicense(pool: Pool, idOrCode: string) {
  const value = String(idOrCode || "").trim();
  if (!value) return null;
  const result = await pool.query(
    "SELECT id,code,customer_id,license_type,group_limit,price,starts_at,expires_at,status," +
      "name,internal_id,owner_id,plan_key,is_trial,locked,auto_renew,group_id,group_title,features,limits,security,metadata,deleted_at " +
      "FROM bot_licenses WHERE (id::text=$1 OR code=$1 OR internal_id=$1) LIMIT 1",
    [value],
  );
  return (result.rows[0] ?? null) as LicenseRow | null;
}

async function fetchLicenseById(pool: Pool, id: number) {
  return fetchLicense(pool, String(id));
}

async function resolveCustomerId(pool: Pool, value: string) {
  const clean = String(value || "").trim();
  if (/^\d{5,20}$/.test(clean)) return Number(clean);
  const username = clean.replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) return null;
  const result = await pool.query(
    "SELECT user_id FROM bot_customers WHERE LOWER(username)=LOWER($1) LIMIT 1",
    [username],
  );
  return result.rows[0] ? Number(result.rows[0].user_id) : null;
}

function planName(key: string | null, type: string | null) {
  const known = LICENSE_PLANS.find((x) => x.key === key);
  return known?.name ?? (type || "سفارشی");
}

function featureDefaults() {
  const result: Record<string, boolean> = {};
  for (const group of Object.values(FEATURE_GROUPS)) {
    for (const key of group.keys) result[key] = true;
  }
  return result;
}

function limitDefaults(groupLimit = 1) {
  const result: Record<string, any> = {};
  for (const [key] of LIMIT_KEYS) result[key] = key === "group_limit" ? groupLimit : 0;
  return result;
}

function securityDefaults() {
  return {
    anti_transfer: false,
    anti_copy: true,
    anti_abuse: true,
    connection_limit: true,
    owner_verified: true,
    transfer_verified: false,
    emergency_lock: false,
  };
}

async function createLicense(
  pool: Pool,
  actor: number,
  data: {
    customerId: number;
    planKey: string;
    name?: string;
    internalId?: string;
    groupLimit?: number;
    ownerId?: number | null;
    groupId?: number | null;
  },
) {
  const plan = LICENSE_PLANS.find((x) => x.key === data.planKey) ?? LICENSE_PLANS.find((x) => x.key === "basic")!;
  const start = new Date();
  const expires = plan.days == null ? null : new Date(start.getTime() + plan.days * 86400000);
  const code = "PBS-" + Math.random().toString(36).slice(2, 10).toUpperCase();
  const name = String(data.name || plan.name + " · " + code).slice(0, 120);
  const internalId = String(data.internalId || "LIC-" + Date.now().toString(36).toUpperCase()).slice(0, 80);
  const groupLimit = Math.max(0, Math.floor(Number(data.groupLimit ?? 1)));

  const defaultFeatures = featureDefaults();
  const defaultLimits = limitDefaults(groupLimit);
  if (plan.key !== "custom") {
    const planRow = await pool.query(
      "SELECT features,limits FROM bot_license_plans WHERE key=$1 LIMIT 1",
      [plan.key],
    );
    if (planRow.rows[0]) {
      Object.assign(defaultFeatures, planRow.rows[0].features || {});
      Object.assign(defaultLimits, planRow.rows[0].limits || {});
      defaultLimits.group_limit = groupLimit;
    }
  }

  const result = await pool.query(
    "INSERT INTO bot_licenses(code,customer_id,license_type,group_limit,price,expires_at,starts_at,status," +
      "name,internal_id,owner_id,plan_key,is_trial,locked,auto_renew,group_id,group_title,features,limits,security,metadata) " +
      "VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,$10,$11,$12,FALSE,FALSE,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb) RETURNING *",
    [
      code,
      data.customerId,
      plan.key,
      groupLimit,
      plan.price,
      expires,
      start,
      name,
      internalId,
      data.ownerId ?? data.customerId,
      plan.key,
      plan.key === "trial",
      false,
      data.groupId ?? null,
      null,
      JSON.stringify(defaultFeatures),
      JSON.stringify(defaultLimits),
      JSON.stringify(securityDefaults()),
      JSON.stringify({ created_via: "owner_license_center" }),
    ],
  );

  const row = result.rows[0];
  await audit(pool, actor, Number(row.id), "create", {}, row, { source: "owner_license_center" });
  return row as LicenseRow;
}

function licenseSummaryRows(row: LicenseRow) {
  return [
    ["شناسه داخلی", String(row.internal_id || row.id)],
    ["کد لایسنس", row.code],
    ["نام لایسنس", String(row.name || "بدون نام")],
    ["نوع", planName(row.plan_key, row.license_type)],
    ["مشتری", String(row.customer_id)],
    ["مالک", String(row.owner_id ?? row.customer_id)],
    ["وضعیت", statusFa(row.status, row.expires_at) + (row.locked ? " · قفل" : "")],
    ["شروع", dateFa(row.starts_at)],
    ["انقضا", row.expires_at ? dateFa(row.expires_at) : "دائمی"],
    ["سقف گروه", faNumber(row.group_limit)],
    ["گروه متصل", row.group_id ? String(row.group_id) : "بدون اتصال"],
    ["تمدید خودکار", row.auto_renew ? "فعال" : "غیرفعال"],
  ] as Array<[string, string]>;
}

function licenseView(row: LicenseRow) {
  return doc([
    ...base("Lɪᴄᴇɴsᴇ", "نمای کامل این لایسنس و عملیات مدیریتی آن."),
    table("اطلاعات لایسنس", licenseSummaryRows(row)),
    { type: "divider" },
    buttons([
      button("ویرایش", "lic:edit:" + row.id),
      button("تمدید", "lic:renew:" + row.id),
      button("تغییر مالک", "lic:owner:" + row.id),
      button("اتصال گروه", "lic:group:" + row.id),
    ]),
    buttons([
      button("امکانات", "lic:features:" + row.id),
      button("محدودیت‌ها", "lic:limits:" + row.id),
      button("امنیت", "lic:security:" + row.id),
      button("لاگ عملیات", "lic:logs:" + row.id),
    ]),
    buttons([
      button("فعال‌سازی", "lic:activate:" + row.id),
      button("تعلیق", "lic:suspend:" + row.id),
      button("لغو", "lic:cancel:" + row.id),
      button("قفل", "lic:lock:" + row.id),
    ]),
    buttons([
      button("بازکردن قفل", "lic:unlock:" + row.id),
      button("حذف", "lic:delete:confirm:" + row.id, "danger"),
      button("مرکز لایسنس", "lic:center"),
    ]),
    footer(),
  ]);
}

export async function sendOwnerLicenseCenter(pool: Pool, chatId: number, messageId?: number) {
  await ensureOwnerLicenseSchema(pool);

  const [stats] = await Promise.all([
    Promise.all([
      pool.query("SELECT COUNT(*)::int n FROM bot_licenses"),
      pool.query("SELECT COUNT(*)::int n FROM bot_licenses WHERE status='active' AND (expires_at IS NULL OR expires_at>NOW())"),
      pool.query("SELECT COUNT(*)::int n FROM bot_licenses WHERE expires_at IS NOT NULL AND expires_at<=NOW() AND status NOT IN ('deleted','cancelled')"),
      pool.query("SELECT COUNT(*)::int n FROM bot_licenses WHERE status='suspended'"),
      pool.query("SELECT COUNT(*)::int n FROM bot_licenses WHERE status='cancelled' OR status='canceled'"),
      pool.query("SELECT COUNT(*)::int n FROM bot_licenses WHERE is_trial=TRUE"),
      pool.query("SELECT COUNT(DISTINCT group_id)::int n FROM bot_license_group_bindings WHERE status='active'"),
      pool.query("SELECT COALESCE(SUM(price),0)::numeric n FROM bot_licenses WHERE status<>'deleted'"),
    ]),
  ]);

  const s = stats;
  const docValue = doc([
    ...base("Lɪᴄᴇɴsᴇ Cᴇɴᴛᴇʀ", "مرکز کامل مدیریت چرخه لایسنس، پلن، گروه، امکانات، محدودیت، امنیت، مالی و ممیزی."),
    table("داشبورد لحظه‌ای", [
      ["تعداد کل لایسنس", faNumber(s[0].rows[0]?.n)],
      ["لایسنس‌های فعال", faNumber(s[1].rows[0]?.n)],
      ["لایسنس‌های منقضی", faNumber(s[2].rows[0]?.n)],
      ["لایسنس‌های تعلیق‌شده", faNumber(s[3].rows[0]?.n)],
      ["لایسنس‌های لغوشده", faNumber(s[4].rows[0]?.n)],
      ["لایسنس‌های آزمایشی", faNumber(s[5].rows[0]?.n)],
      ["گروه‌های دارای لایسنس", faNumber(s[6].rows[0]?.n)],
      ["درآمد ثبت‌شده", faNumber(s[7].rows[0]?.n) + " تومان"],
    ]),
    { type: "divider" },
    { type: "heading", text: "مدیریت اصلی", size: 2 },
    buttons([
      button("همه", "lic:list:all"),
      button("جستجو", "lic:search"),
      button("مشاهده", "lic:select:view"),
      button("ایجاد جدید", "lic:create", "success"),
    ]),
    buttons([
      button("ویرایش", "lic:select:edit"),
      button("تمدید", "lic:select:renew"),
      button("تعلیق", "lic:select:suspend", "danger"),
      button("فعال‌سازی", "lic:select:activate", "success"),
    ]),
    buttons([
      button("لغو", "lic:select:cancel", "danger"),
      button("حذف", "lic:select:delete", "danger"),
      button("بازیابی", "lic:list:deleted", "success"),
      button("تغییر مالک", "lic:select:owner", "primary"),
    ]),
    buttons([
      button("انتقال", "lic:select:transfer"),
      button("قفل", "lic:select:lock", "danger"),
      button("بازکردن قفل", "lic:select:unlock", "success"),
      button("نزدیک به انقضا", "lic:list:expiring"),
    ]),
    { type: "divider" },
    { type: "heading", text: "مدیریت پلن و ساخت", size: 2 },
    buttons([
      button("مشاهده پلن‌ها", "lic:plans"),
      button("ساخت پلن", "lic:plan:create"),
      button("ساخت سریع", "lic:create:quick"),
      button("ساخت حرفه‌ای", "lic:create:pro"),
    ]),
    { type: "divider" },
    { type: "heading", text: "امکانات و محدودیت‌ها", size: 2 },
    buttons([
      button("مرکز امکانات", "lic:feature_center"),
      button("مرکز محدودیت‌ها", "lic:limit_center"),
      button("گروه‌های متصل", "lic:groups"),
      button("امنیت لایسنس", "lic:security_center"),
    ]),
    { type: "divider" },
    { type: "heading", text: "گزارش و کنترل", size: 2 },
    buttons([
      button("لاگ عملیات", "lic:logs"),
      button("تاریخچه", "lic:history"),
      button("گزارش‌ها", "lic:reports"),
      button("کنترل اضطراری", "lic:emergency"),
    ]),
    buttons([
      button("تنظیمات", "lic:settings"),
      button("تازه‌سازی", "lic:center"),
      button("بازگشت", "o:home"),
    ]),
    footer(),
  ]);

  return render(chatId, messageId, docValue);
}

async function listLicenses(pool: Pool, mode: string, page = 0) {
  const offset = page * 20;
  let where = "TRUE";
  if (mode === "active") where = "status='active' AND (expires_at IS NULL OR expires_at>NOW())";
  if (mode === "expired") where = "expires_at IS NOT NULL AND expires_at<=NOW() AND status NOT IN ('deleted','cancelled')";
  if (mode === "deleted") where = "status='deleted'";
  if (mode === "suspended") where = "status='suspended'";
  if (mode === "cancelled") where = "status IN ('cancelled','canceled')";
  if (mode === "expiring") where = "status='active' AND expires_at>NOW() AND expires_at<=NOW()+INTERVAL '7 days'";

  const result = await pool.query(
    "SELECT id,code,customer_id,license_type,expires_at,status,name,plan_key,locked " +
      "FROM bot_licenses WHERE " +
      where +
      " ORDER BY id DESC LIMIT 20 OFFSET $1",
    [offset],
  );
  const blocks: any[] = [
    ...base("فهرست لایسنس‌ها", "فهرست زنده با تفکیک وضعیت و امکان ورود مستقیم به جزئیات."),
  ];

  if (!result.rows.length) {
    blocks.push({ type: "paragraph", text: "موردی برای نمایش پیدا نشد." });
  } else {
    for (const row of result.rows) {
      blocks.push(
        table("لایسنس", [
          ["شناسه", String(row.id)],
          ["کد", String(row.code)],
          ["نام", String(row.name || "بدون نام")],
          ["مشتری", String(row.customer_id)],
          ["پلن", planName(row.plan_key, row.license_type)],
          ["وضعیت", statusFa(row.status, row.expires_at) + (row.locked ? " · قفل" : "")],
          ["انقضا", row.expires_at ? dateFa(row.expires_at) : "دائمی"],
        ]),
      );
      blocks.push(buttons([
        button("مشاهده", "lic:view:" + row.id),
        button("بازگشت به مرکز", "lic:center"),
      ]));
      blocks.push({ type: "divider" });
    }
    blocks.pop();
  }

  blocks.push(buttons([
    button("قبلی", "lic:list:" + mode + ":" + Math.max(0, page - 1)),
    button("بعدی", "lic:list:" + mode + ":" + (page + 1)),
    button("مرکز لایسنس", "lic:center"),
  ]));
  blocks.push(footer());
  return doc(blocks);
}

function searchPage() {
  return doc([
    ...base("جستجوی لایسنس", "کد، شناسه داخلی، شناسه عددی لایسنس یا نام لایسنس را ارسال کنید."),
    buttons([button("بازگشت", "lic:center")]),
    footer(),
  ]);
}

function createModePage(mode: "quick" | "pro") {
  return doc([
    ...base(mode === "pro" ? "ساخت حرفه‌ای" : "ساخت سریع", "ابتدا پلن لایسنس را انتخاب کنید."),
    buttons(LICENSE_PLANS.slice(0, 8).map((plan) => button(plan.name, "lic:create:plan:" + mode + ":" + plan.key))),
    buttons([
      button("پلن‌های بیشتر", "lic:plans"),
      button("بازگشت", "lic:center"),
    ]),
    footer(),
  ]);
}

async function planCenter(pool: Pool) {
  const rows = await pool.query(
    "SELECT key,name,price,duration_days,capacity,auto_renew,active FROM bot_license_plans ORDER BY active DESC,key ASC",
  );
  const blocks: any[] = [
    ...base("مدیریت پلن", "ساخت، مشاهده و ویرایش پلن‌های قابل تخصیص به لایسنس."),
  ];
  if (rows.rows.length) {
    blocks.push(table("پلن‌ها", rows.rows.map((row: any) => [
      String(row.name),
      faNumber(row.price) + " تومان · " +
        (row.duration_days == null ? "دائمی" : faNumber(row.duration_days) + " روز") +
        " · ظرفیت " + faNumber(row.capacity) +
        " · " + (row.active ? "فعال" : "غیرفعال"),
    ])));
    blocks.push(buttons(rows.rows.slice(0, 8).map((row: any) => button(String(row.name), "lic:plan:view:" + row.key))));
  } else {
    blocks.push({ type: "paragraph", text: "پلنی ثبت نشده است." });
  }
  blocks.push(buttons([
    button("ساخت پلن", "lic:plan:create"),
    button("بازگشت", "lic:center"),
  ]));
  blocks.push(footer());
  return doc(blocks);
}

async function planView(pool: Pool, key: string) {
  const row = (await pool.query("SELECT * FROM bot_license_plans WHERE key=$1 LIMIT 1", [key])).rows[0];
  if (!row) return doc([
    ...base("پلن", "پلن موردنظر پیدا نشد."),
    buttons([button("مدیریت پلن", "lic:plans")]),
    footer(),
  ]);

  return doc([
    ...base("پلن · " + row.name, "تنظیم قیمت، مدت، ظرفیت، امکانات و وضعیت پلن."),
    table("اطلاعات پلن", [
      ["کلید", String(row.key)],
      ["نام", String(row.name)],
      ["قیمت", faNumber(row.price) + " تومان"],
      ["مدت", row.duration_days == null ? "دائمی" : faNumber(row.duration_days) + " روز"],
      ["ظرفیت", faNumber(row.capacity)],
      ["تمدید خودکار", row.auto_renew ? "فعال" : "غیرفعال"],
      ["وضعیت", row.active ? "فعال" : "غیرفعال"],
    ]),
    buttons([
      button("تغییر قیمت", "lic:plan:price:" + row.key),
      button("تغییر مدت", "lic:plan:days:" + row.key),
      button("ظرفیت", "lic:plan:capacity:" + row.key),
      button(row.active ? "غیرفعال‌سازی" : "فعال‌سازی", "lic:plan:toggle:" + row.key),
    ]),
    buttons([
      button("امکانات پلن", "lic:plan:features:" + row.key),
      button("محدودیت پلن", "lic:plan:limits:" + row.key),
      button("مدیریت پلن", "lic:plans"),
    ]),
    footer(),
  ]);
}

async function featureCenter(pool: Pool, licenseId?: number) {
  if (!licenseId) {
    return doc([
      ...base("مرکز امکانات", "امکانات لایسنس از این بخش به‌صورت گروهی مدیریت می‌شوند."),
      table("دسته‌های امکانات", Object.entries(FEATURE_GROUPS).map(([key, group]) => [group.title, faNumber(group.keys.length) + " قابلیت"])),
      buttons([
        button("انتخاب لایسنس", "lic:select:features"),
        button("بازگشت", "lic:center"),
      ]),
      footer(),
    ]);
  }

  const row = await fetchLicenseById(pool, licenseId);
  if (!row) return doc([
    ...base("امکانات لایسنس", "لایسنس پیدا نشد."),
    buttons([button("مرکز لایسنس", "lic:center")]),
    footer(),
  ]);

  const features = { ...featureDefaults(), ...(row.features || {}) };
  const blocks: any[] = [
    ...base("امکانات لایسنس", "فعال یا غیرفعال‌سازی قابلیت‌های همین لایسنس."),
    table("وضعیت امکانات", Object.values(FEATURE_GROUPS).map((group) => {
      const active = group.keys.filter((key) => features[key]).length;
      return [group.title, faNumber(active) + " از " + faNumber(group.keys.length) + " فعال"];
    })),
  ];

  for (const [groupKey, group] of Object.entries(FEATURE_GROUPS)) {
    blocks.push(buttons([
      button(group.title, "lic:features:group:" + licenseId + ":" + groupKey),
    ]));
  }

  blocks.push(buttons([
    button("نمایش لایسنس", "lic:view:" + licenseId),
    button("بازگشت", "lic:center"),
  ]));
  blocks.push(footer());
  return doc(blocks);
}

async function featureGroupPage(pool: Pool, licenseId: number, groupKey: string) {
  const row = await fetchLicenseById(pool, licenseId);
  const group = FEATURE_GROUPS[groupKey];
  if (!row || !group) return featureCenter(pool, licenseId);

  const features = { ...featureDefaults(), ...(row.features || {}) };
  return doc([
    ...base(group.title, "وضعیت هر قابلیت را برای این لایسنس کنترل کنید."),
    ...group.keys.map((key) =>
      buttons([
        button((features[key] ? "غیرفعال‌سازی " : "فعال‌سازی ") + key, "lic:feature:toggle:" + licenseId + ":" + key),
      ]),
    ),
    buttons([
      button("مرکز امکانات", "lic:features:" + licenseId),
      button("مشاهده لایسنس", "lic:view:" + licenseId),
    ]),
    footer(),
  ]);
}

async function limitsPage(pool: Pool, licenseId?: number) {
  if (!licenseId) {
    return doc([
      ...base("مرکز محدودیت‌ها", "محدودیت‌های لایسنس در سطح گروه، پیام، فرمان، گزارش و مصرف."),
      table("محدودیت‌های قابل تنظیم", LIMIT_KEYS.map(([key, title]) => [title, key])),
      buttons([button("انتخاب لایسنس", "lic:select:limits"), button("بازگشت", "lic:center")]),
      footer(),
    ]);
  }

  const row = await fetchLicenseById(pool, licenseId);
  if (!row) return doc([
    ...base("محدودیت‌ها", "لایسنس پیدا نشد."),
    buttons([button("مرکز لایسنس", "lic:center")]),
    footer(),
  ]);

  const limits = { ...limitDefaults(Number(row.group_limit || 0)), ...(row.limits || {}) };
  const blocks: any[] = [
    ...base("محدودیت لایسنس", "مقادیر عددی این لایسنس را تنظیم کنید."),
    table("محدودیت‌های فعلی", LIMIT_KEYS.map(([key, title]) => [title, faNumber(limits[key] ?? 0)])),
    buttons([button("تنظیم سقف گروه", "lic:limit:set:" + licenseId + ":group_limit")]),
    buttons([button("تنظیم سقف پیام", "lic:limit:set:" + licenseId + ":message_limit")]),
    buttons([button("تنظیم سقف درخواست", "lic:limit:set:" + licenseId + ":request_limit")]),
    buttons([button("تنظیم سقف فرمان", "lic:limit:set:" + licenseId + ":command_limit")]),
    buttons([button("تنظیم سقف گزارش", "lic:limit:set:" + licenseId + ":report_limit")]),
    buttons([button("تنظیم سقف روزانه", "lic:limit:set:" + licenseId + ":daily_limit")]),
    buttons([button("تنظیم سقف ماهانه", "lic:limit:set:" + licenseId + ":monthly_limit")]),
    buttons([
      button("مشاهده لایسنس", "lic:view:" + licenseId),
      button("مرکز محدودیت‌ها", "lic:limit_center"),
    ]),
    footer(),
  ];
  return doc(blocks);
}

async function securityCenter(pool: Pool, licenseId?: number) {
  if (!licenseId) {
    const rows = await pool.query(
      "SELECT key,value,updated_at FROM bot_license_controls ORDER BY key",
    );
    return doc([
      ...base("امنیت لایسنس", "لایه ضدانتقال، ضدکپی، ضدسوءاستفاده، تأیید مالک و قفل اضطراری."),
      table("کنترل‌های سراسری", rows.rows.length ? rows.rows.map((x: any) => [String(x.key), x.value ? "فعال" : "غیرفعال"]) : [["وضعیت", "تنظیم نشده"]]),
      buttons([
        button("قفل اضطراری انتقال", "lic:security:control:transfers"),
        button("قفل اضطراری اتصال", "lic:security:control:connections"),
      ]),
      buttons([
        button("انتخاب لایسنس", "lic:select:security"),
        button("بازگشت", "lic:center"),
      ]),
      footer(),
    ]);
  }

  const row = await fetchLicenseById(pool, licenseId);
  if (!row) return securityCenter(pool);

  const security = { ...securityDefaults(), ...(row.security || {}) };
  return doc([
    ...base("امنیت لایسنس", "تنظیمات امنیتی مستقل این لایسنس."),
    table("وضعیت امنیتی", Object.entries(security).map(([key, value]) => [key, value ? "فعال" : "غیرفعال"])),
    buttons([
      button("ضدانتقال", "lic:security:toggle:" + licenseId + ":anti_transfer"),
      button("ضدکپی", "lic:security:toggle:" + licenseId + ":anti_copy"),
      button("ضدسوءاستفاده", "lic:security:toggle:" + licenseId + ":anti_abuse"),
      button("تأیید مالک", "lic:security:toggle:" + licenseId + ":owner_verified"),
    ]),
    buttons([
      button("محدودیت اتصال", "lic:security:toggle:" + licenseId + ":connection_limit"),
      button("تأیید انتقال", "lic:security:toggle:" + licenseId + ":transfer_verified"),
      button("قفل اضطراری", "lic:security:toggle:" + licenseId + ":emergency_lock"),
    ]),
    buttons([
      button("مشاهده لایسنس", "lic:view:" + licenseId),
      button("مرکز امنیت", "lic:security_center"),
    ]),
    footer(),
  ]);
}

async function groupsPage(pool: Pool) {
  const result = await pool.query(
    "SELECT b.id,b.license_id,b.group_id,b.group_title,b.status,b.connected_at,l.code,l.customer_id " +
      "FROM bot_license_group_bindings b JOIN bot_licenses l ON l.id=b.license_id " +
      "WHERE b.status='active' ORDER BY b.connected_at DESC LIMIT 30",
  );
  const blocks: any[] = [
    ...base("گروه‌های متصل", "فهرست گروه‌های فعال متصل به لایسنس‌ها."),
  ];
  if (!result.rows.length) {
    blocks.push({ type: "paragraph", text: "هیچ اتصال فعالی ثبت نشده است." });
  } else {
    for (const row of result.rows) {
      blocks.push(table("اتصال", [
        ["شناسه لایسنس", String(row.license_id)],
        ["کد", String(row.code)],
        ["شناسه گروه", String(row.group_id)],
        ["نام گروه", String(row.group_title || "بدون نام")],
        ["مشتری", String(row.customer_id)],
        ["تاریخ اتصال", dateFa(row.connected_at)],
      ]));
      blocks.push(buttons([
        button("مشاهده لایسنس", "lic:view:" + row.license_id),
        button("قطع اتصال", "lic:group:unbind:" + row.id),
      ]));
      blocks.push({ type: "divider" });
    }
    blocks.pop();
  }
  blocks.push(buttons([
    button("انتخاب لایسنس", "lic:select:group"),
    button("مرکز لایسنس", "lic:center"),
  ]));
  blocks.push(footer());
  return doc(blocks);
}

async function logsPage(pool: Pool, licenseId?: number) {
  const where = licenseId ? "WHERE license_id=$1" : "";
  const args = licenseId ? [licenseId] : [];
  const result = await pool.query(
    "SELECT id,license_id,actor_id,action,created_at,meta FROM bot_license_events " +
      where + " ORDER BY id DESC LIMIT 40",
    args,
  );
  const blocks: any[] = [
    ...base("لاگ عملیات", licenseId ? "سوابق عملیاتی این لایسنس." : "سوابق عملیاتی کل سیستم لایسنس."),
  ];
  if (!result.rows.length) blocks.push({ type: "paragraph", text: "لاگی ثبت نشده است." });
  else {
    blocks.push(table("رویدادها", result.rows.map((x: any) => [
      "#" + String(x.id),
      "لایسنس " + String(x.license_id ?? "سیستم") + " · " + String(x.action) + " · " + dateFa(x.created_at),
    ])));
  }
  blocks.push(buttons([
    button("مرکز لایسنس", "lic:center"),
    licenseId ? button("مشاهده لایسنس", "lic:view:" + licenseId) : button("تاریخچه", "lic:history"),
  ]));
  blocks.push(footer());
  return doc(blocks);
}

async function reportsPage(pool: Pool) {
  const [byType, byPlan, recent] = await Promise.all([
    pool.query("SELECT license_type,COUNT(*)::int n FROM bot_licenses GROUP BY license_type ORDER BY n DESC"),
    pool.query("SELECT COALESCE(plan_key,license_type) key,COUNT(*)::int n FROM bot_licenses GROUP BY COALESCE(plan_key,license_type) ORDER BY n DESC"),
    pool.query("SELECT COUNT(*)::int n FROM bot_license_events WHERE created_at>=NOW()-INTERVAL '24 hours'"),
  ]);
  return doc([
    ...base("گزارش‌های لایسنس", "گزارش مدیریتی از نوع، پلن و فعالیت اخیر."),
    table("گزارش روزانه", [
      ["رویدادهای ۲۴ ساعت اخیر", faNumber(recent.rows[0]?.n)],
      ["تعداد نوع‌های ثبت‌شده", faNumber(byType.rows.length)],
      ["تعداد پلن‌های درحال استفاده", faNumber(byPlan.rows.length)],
    ]),
    table("بر اساس نوع", byType.rows.map((x: any) => [String(x.license_type), faNumber(x.n)])),
    table("بر اساس پلن", byPlan.rows.map((x: any) => [planName(String(x.key), String(x.key)), faNumber(x.n)])),
    buttons([button("مرکز لایسنس", "lic:center")]),
    footer(),
  ]);
}

async function historyPage(pool: Pool, mode = "all") {
  const where =
    mode === "today"
      ? "created_at>=NOW()-INTERVAL '1 day'"
      : mode === "week"
        ? "created_at>=NOW()-INTERVAL '7 day'"
        : mode === "month"
          ? "created_at>=NOW()-INTERVAL '30 day'"
          : "TRUE";
  const result = await pool.query(
    "SELECT action,COUNT(*)::int n FROM bot_license_events WHERE " + where + " GROUP BY action ORDER BY n DESC LIMIT 30",
  );
  return doc([
    ...base("تاریخچه", "خلاصه تغییرات لایسنس بر اساس بازه زمانی."),
    table("عملیات", result.rows.map((x: any) => [String(x.action), faNumber(x.n)])),
    buttons([
      button("امروز", "lic:history:today"),
      button("هفته", "lic:history:week"),
      button("ماه", "lic:history:month"),
      button("کل", "lic:history:all"),
    ]),
    buttons([button("مرکز لایسنس", "lic:center")]),
    footer(),
  ]);
}

async function emergencyPage(pool: Pool) {
  const result = await pool.query(
    "SELECT key,value FROM bot_license_controls ORDER BY key",
  );
  const controls = Object.fromEntries(result.rows.map((x: any) => [String(x.key), Boolean(x.value)]));
  return doc([
    ...base("کنترل اضطراری", "توقف یا بازگردانی عملیات سراسری لایسنس."),
    table("وضعیت کنترل", [
      ["توقف همه لایسنس‌ها", controls.stop_all ? "فعال" : "غیرفعال"],
      ["قفل همه انتقال‌ها", controls.lock_transfers ? "فعال" : "غیرفعال"],
      ["قفل همه اتصال‌ها", controls.lock_connections ? "فعال" : "غیرفعال"],
      ["توقف تمدید خودکار", controls.stop_auto_renew ? "فعال" : "غیرفعال"],
    ]),
    buttons([
      button(controls.stop_all ? "بازگردانی همه لایسنس‌ها" : "توقف همه لایسنس‌ها", "lic:emergency:stop_all"),
      button(controls.lock_transfers ? "بازکردن همه انتقال‌ها" : "قفل همه انتقال‌ها", "lic:emergency:lock_transfers"),
    ]),
    buttons([
      button(controls.lock_connections ? "بازکردن همه اتصال‌ها" : "قفل همه اتصال‌ها", "lic:emergency:lock_connections"),
      button(controls.stop_auto_renew ? "فعال‌سازی تمدید خودکار" : "توقف تمدید خودکار", "lic:emergency:stop_auto_renew"),
    ]),
    buttons([button("بازگشت", "lic:center")]),
    footer(),
  ]);
}

async function settingsPage(pool: Pool) {
  const result = await pool.query(
    "SELECT key,value,updated_by,updated_at FROM bot_license_controls ORDER BY key",
  );
  return doc([
    ...base("تنظیمات", "کنترل‌های عمومی مرکز لایسنس."),
    table("کنترل‌ها", result.rows.length
      ? result.rows.map((x: any) => [String(x.key), (x.value ? "فعال" : "غیرفعال") + " · " + dateFa(x.updated_at)])
      : [["وضعیت", "تنظیم نشده"]]),
    buttons([
      button("کنترل اضطراری", "lic:emergency"),
      button("امنیت", "lic:security_center"),
      button("مرکز لایسنس", "lic:center"),
    ]),
    footer(),
  ]);
}

function licenseActionLabel(action: string) {
  const labels: Record<string, string> = {
    view: "مشاهده",
    edit: "ویرایش",
    renew: "تمدید",
    owner: "تغییر مالک",
    transfer: "انتقال",
    activate: "فعال‌سازی",
    suspend: "تعلیق",
    cancel: "لغو",
    delete: "حذف",
    restore: "بازیابی",
    lock: "قفل",
    unlock: "بازکردن قفل",
    features: "امکانات",
    limits: "محدودیت‌ها",
    security: "امنیت",
    group: "اتصال گروه",
  };
  return labels[action] || action;
}

function actionMethodPage(action: string) {
  const label = licenseActionLabel(action);
  return doc([
    ...base("مدیریت لایسنس · " + label, "روش انتخاب لایسنس را مشخص کنید."),
    table("روش انتخاب", [
      ["روش اول", "با آیدی کاربری / شناسه"],
      ["روش دوم", "انتخاب مستقیم از لایسنس‌های موجود"],
    ]),
    buttons([
      button("با آیدی کاربری / شناسه", "lic:input:" + action),
      button("انتخاب از موجودها", "lic:pick:" + action),
    ]),
    buttons([button("بازگشت", "lic:center")]),
    footer(),
  ]);
}

async function pickLicensePage(pool: Pool, action: string, page = 0) {
  const offset = Math.max(0, page) * 12;
  const result = await pool.query(
    "SELECT id,code,customer_id,license_type,expires_at,status,name,plan_key,locked " +
      "FROM bot_licenses WHERE status <> 'deleted' ORDER BY id DESC LIMIT 12 OFFSET $1",
    [offset],
  );

  const blocks: any[] = [
    ...base("انتخاب لایسنس · " + licenseActionLabel(action), "یک لایسنس موجود را انتخاب کنید؛ نیازی به ارسال آیدی یا شناسه نیست."),
  ];

  if (!result.rows.length) {
    blocks.push({ type: "paragraph", text: "لایسنسی برای انتخاب وجود ندارد." });
  } else {
    for (const row of result.rows) {
      blocks.push(table(String(row.name || ("لایسنس #" + row.id)), [
        ["شناسه", String(row.id)],
        ["کد", String(row.code)],
        ["مشتری", String(row.customer_id)],
        ["نوع", planName(row.plan_key, row.license_type)],
        ["وضعیت", statusFa(row.status, row.expires_at) + (row.locked ? " · قفل" : "")],
      ]));
      blocks.push(buttons([
        button("انتخاب این لایسنس", "lic:apply:" + action + ":" + row.id),
      ]));
    }
  }

  const nav: any[] = [];
  if (page > 0) nav.push(button("قبلی", "lic:pick:" + action + ":" + (page - 1)));
  if (result.rows.length === 12) nav.push(button("بعدی", "lic:pick:" + action + ":" + (page + 1)));
  nav.push(button("بازگشت", "lic:method:" + action));
  blocks.push(buttons(nav));
  blocks.push(footer());
  return doc(blocks);
}

async function resolveLicenseTargets(pool: Pool, value: string) {
  const clean = String(value || "").trim();
  if (!clean) return [] as LicenseRow[];

  const result = await pool.query(
    "SELECT id,code,customer_id,license_type,group_limit,price,starts_at,expires_at,status," +
      "name,internal_id,owner_id,plan_key,is_trial,locked,auto_renew,group_id,group_title,features,limits,security,metadata,deleted_at " +
      "FROM bot_licenses " +
      "WHERE id::text=$1 OR code=$1 OR internal_id=$1 OR customer_id::text=$1 " +
      "ORDER BY CASE WHEN id::text=$1 THEN 0 WHEN customer_id::text=$1 THEN 1 ELSE 2 END, id DESC LIMIT 20",
    [clean],
  );
  return result.rows as LicenseRow[];
}

async function selectPrompt(action: string) {
  return doc([
    ...base("شناسه لایسنس", "آیدی کاربری، شناسه لایسنس، کد یا شناسه داخلی را ارسال کنید."),
    { type: "paragraph", text: "عملیات: " + licenseActionLabel(action) },
    { type: "paragraph", text: "برای اجرای همین عملیات بدون ورود شناسه، از «انتخاب از موجودها» استفاده کنید." },
    buttons([button("انتخاب از موجودها", "lic:pick:" + action)]),
    buttons([button("بازگشت", "lic:method:" + action)]),
    footer(),
  ]);
}

async function executeLicenseAction(
  pool: Pool,
  actor: number,
  licenseId: number,
  action: string,
  extra: Record<string, any> = {},
  ownerIds: SudoOwnerIds = [],
) {
  const row = await fetchLicenseById(pool, licenseId);
  if (!row) return { ok: false, message: "لایسنس پیدا نشد." };

  const before = { ...row };
  if (["owner", "transfer"].includes(action) && extra.targetOwner) {
    const target = Number(extra.targetOwner);
    if (!Number.isSafeInteger(target) || target <= 0) return { ok: false, message: "شناسه مالک معتبر نیست." };
    if (ownerIds.includes(String(target))) return { ok: false, message: "مالک سامانه نمی‌تواند به‌عنوان مالک انتقالی ثبت شود." };
    await pool.query("UPDATE bot_licenses SET owner_id=$1,customer_id=$1 WHERE id=$2", [target, licenseId]);
  } else if (action === "activate") {
    await pool.query("UPDATE bot_licenses SET status='active',starts_at=COALESCE(starts_at,NOW()),deleted_at=NULL WHERE id=$1", [licenseId]);
  } else if (action === "suspend") {
    await pool.query("UPDATE bot_licenses SET status='suspended' WHERE id=$1", [licenseId]);
  } else if (action === "cancel") {
    await pool.query("UPDATE bot_licenses SET status='cancelled' WHERE id=$1", [licenseId]);
  } else if (action === "delete") {
    await pool.query("UPDATE bot_licenses SET status='deleted',deleted_at=NOW(),deleted_by=$1 WHERE id=$2", [actor, licenseId]);
  } else if (action === "restore") {
    await pool.query("UPDATE bot_licenses SET status='disabled',deleted_at=NULL,deleted_by=NULL WHERE id=$1", [licenseId]);
  } else if (action === "lock") {
    await pool.query("UPDATE bot_licenses SET locked=TRUE WHERE id=$1", [licenseId]);
  } else if (action === "unlock") {
    await pool.query("UPDATE bot_licenses SET locked=FALSE WHERE id=$1", [licenseId]);
  } else {
    return { ok: false, message: "عملیات پشتیبانی نمی‌شود." };
  }

  const after = await fetchLicenseById(pool, licenseId);
  await audit(pool, actor, licenseId, action, before, after, extra);
  return { ok: true, row: after };
}

async function bindLicenseGroup(pool: Pool, actor: number, licenseId: number, groupId: number) {
  const row = await fetchLicenseById(pool, licenseId);
  if (!row) return { ok: false, message: "لایسنس پیدا نشد." };

  const count = await pool.query(
    "SELECT COUNT(*)::int n FROM bot_license_group_bindings WHERE license_id=$1 AND status='active'",
    [licenseId],
  );
  const current = Number(count.rows[0]?.n || 0);
  if (Number(row.group_limit || 0) > 0 && current >= Number(row.group_limit)) {
    return { ok: false, message: "سقف اتصال گروه این لایسنس تکمیل شده است." };
  }

  const group = (await pool.query(
    "SELECT group_id,title FROM bot_customer_groups WHERE group_id=$1 ORDER BY last_seen_at DESC LIMIT 1",
    [groupId],
  )).rows[0];

  const title = String(group?.title || "گروه " + groupId);
  const locked = Boolean((row.security || {}).connection_limit);
  if (locked) {
    const global = (await pool.query("SELECT value FROM bot_license_controls WHERE key='lock_connections' LIMIT 1")).rows[0];
    if (global?.value) return { ok: false, message: "اتصال گروه‌ها به‌صورت سراسری قفل شده است." };
  }

  await pool.query(
    "INSERT INTO bot_license_group_bindings(license_id,group_id,group_title,status) VALUES($1,$2,$3,'active') " +
      "ON CONFLICT(license_id,group_id) DO UPDATE SET status='active',group_title=EXCLUDED.group_title,disconnected_at=NULL",
    [licenseId, groupId, title],
  );
  await pool.query("UPDATE bot_licenses SET group_id=$1,group_title=$2 WHERE id=$3", [groupId, title, licenseId]);
  await audit(pool, actor, licenseId, "group_bind", {}, { groupId, title });
  return { ok: true };
}

export async function ownerLicenseCallback(
  pool: Pool,
  chatId: number,
  messageId: number,
  actor: number,
  rawData: string,
  ownerIds: string[],
) {
  await ensureOwnerLicenseSchema(pool);

  let data = String(rawData || "");
  const legacyMap: Record<string, string> = {
    "o:licenses": "lic:center",
    "o:lic_create": "lic:create:quick",
    "o:lic_active": "lic:list:active",
    "o:lic_expiring": "lic:list:expiring",
    "o:lic_expired": "lic:list:expired",
    "o:lic_limits": "lic:limit_center",
  };
  data = legacyMap[data] || data;

  if (data === "lic:center") return sendOwnerLicenseCenter(pool, chatId, messageId);
  if (data === "lic:search") {
    setPending(actor, "search");
    return render(chatId, messageId, searchPage());
  }
  if (data === "lic:create" || data === "lic:create:quick") {
    return render(chatId, messageId, createModePage("quick"));
  }
  if (data === "lic:create:pro") {
    return render(chatId, messageId, createModePage("pro"));
  }
  if (data.startsWith("lic:create:plan:")) {
    const parts = data.split(":");
    const mode = parts[3] as "quick" | "pro";
    const planKey = parts[4];
    if (!LICENSE_PLANS.some((x) => x.key === planKey)) return;
    if (mode === "pro") {
      setPending(actor, "create_pro_name", { planKey });
      return render(chatId, messageId, doc([
        ...base("ساخت حرفه‌ای", "نام لایسنس را ارسال کنید."),
        { type: "paragraph", text: "پس از آن شناسه مشتری و سقف گروه دریافت می‌شود." },
        buttons([button("بازگشت", "lic:create:pro")]),
        footer(),
      ]));
    }
    setPending(actor, "create_customer", { planKey });
    return render(chatId, messageId, doc([
      ...base("ساخت سریع", "شناسه عددی یا @username مشتری را ارسال کنید."),
      buttons([button("بازگشت", "lic:create:quick")]),
      footer(),
    ]));
  }

  if (data.startsWith("lic:view:")) {
    const id = Number(data.slice("lic:view:".length));
    const row = await fetchLicenseById(pool, id);
    if (!row) return render(chatId, messageId, doc([
      ...base("لایسنس", "این لایسنس پیدا نشد."),
      buttons([button("مرکز لایسنس", "lic:center")]),
      footer(),
    ]));
    return render(chatId, messageId, licenseView(row));
  }

  if (data.startsWith("lic:list:")) {
    const parts = data.split(":");
    const mode = parts[2];
    const page = Number(parts[3] || 0);
    if (!["all", "active", "expired", "deleted", "suspended", "cancelled", "expiring"].includes(mode)) return;
    return render(chatId, messageId, await listLicenses(pool, mode, Number.isSafeInteger(page) ? Math.max(0, page) : 0));
  }

  if (data.startsWith("lic:select:")) {
    const action = data.slice("lic:select:".length);
    return render(chatId, messageId, actionMethodPage(action));
  }

  if (data.startsWith("lic:method:")) {
    const action = data.slice("lic:method:".length);
    return render(chatId, messageId, actionMethodPage(action));
  }

  if (data.startsWith("lic:input:")) {
    const action = data.slice("lic:input:".length);
    setPending(actor, "select_action", { action });
    return render(chatId, messageId, selectPrompt(action));
  }

  if (data.startsWith("lic:pick:")) {
    const parts = data.split(":");
    const action = parts[2];
    const page = Number(parts[3] || 0);
    return render(chatId, messageId, await pickLicensePage(pool, action, Number.isSafeInteger(page) ? Math.max(0, page) : 0));
  }

  if (data.startsWith("lic:apply:")) {
    const parts = data.split(":");
    const action = parts[2];
    const licenseId = Number(parts[3]);
    if (!Number.isSafeInteger(licenseId) || !action) return;

    const license = await fetchLicenseById(pool, licenseId);
    if (!license) {
      return render(chatId, messageId, doc([
        ...base("عملیات لایسنس", "لایسنس انتخاب‌شده پیدا نشد."),
        buttons([button("بازگشت", "lic:pick:" + action)]),
        footer(),
      ]));
    }

    if (action === "delete") {
      return render(chatId, messageId, doc([
        ...base("تأیید حذف لایسنس", "لایسنس انتخاب‌شده آماده حذف است."),
        table("لایسنس انتخابی", licenseSummaryRows(license)),
        { type: "paragraph", text: "حذف، وضعیت لایسنس را به «حذف‌شده» تغییر می‌دهد. برای ادامه، حذف نهایی را بزنید." },
        buttons([
          button("حذف نهایی", "lic:delete:confirm:" + license.id, "danger"),
          button("انصراف", "lic:view:" + license.id, "link"),
        ]),
        footer(),
      ]));
    }

    if (["activate", "suspend", "cancel", "restore", "lock", "unlock"].includes(action)) {
      const result = await executeLicenseAction(pool, actor, licenseId, action, {}, ownerIds);
      return render(chatId, messageId, doc([
        ...base(result.ok ? "عملیات ثبت شد" : "عملیات انجام نشد", result.ok ? "لایسنس انتخاب‌شده مستقیماً به‌روزرسانی شد." : result.message),
        result.ok ? table("نتیجه", licenseSummaryRows(result.row)) : { type: "paragraph", text: result.message },
        buttons([
          button("مشاهده لایسنس", result.ok ? "lic:view:" + result.row.id : "lic:center"),
          button("بازگشت", "lic:center", "link"),
        ]),
        footer(),
      ]));
    }

    if (action === "view") return render(chatId, messageId, licenseView(license));
    if (action === "features") return render(chatId, messageId, await featureCenter(pool, licenseId));
    if (action === "limits") return render(chatId, messageId, await limitsPage(pool, licenseId));
    if (action === "security") return render(chatId, messageId, await securityCenter(pool, licenseId));
    if (action === "edit") {
      setPending(actor, "edit_name", { licenseId });
      return render(chatId, messageId, doc([
        ...base("ویرایش لایسنس", "نام جدید لایسنس را ارسال کنید."),
        table("لایسنس انتخابی", licenseSummaryRows(license)),
        buttons([button("بازگشت", "lic:view:" + licenseId)]),
        footer(),
      ]));
    }
    if (action === "renew") {
      return render(chatId, messageId, doc([
        ...base("تمدید لایسنس", "مدت تمدید لایسنس انتخاب‌شده را انتخاب کنید."),
        buttons([
          button("یک ماه", "lic:renew:set:" + licenseId + ":30"),
          button("سه ماه", "lic:renew:set:" + licenseId + ":90"),
          button("شش ماه", "lic:renew:set:" + licenseId + ":180"),
          button("یک سال", "lic:renew:set:" + licenseId + ":365"),
        ]),
        buttons([
          button("تمدید دائمی", "lic:renew:set:" + licenseId + ":lifetime"),
          button("بازگشت", "lic:method:renew"),
        ]),
        footer(),
      ]));
    }
    if (action === "owner" || action === "transfer") {
      setPending(actor, "owner_change", { licenseId, action });
      return render(chatId, messageId, doc([
        ...base("تغییر مالک لایسنس", "شناسه عددی مالک جدید را ارسال کنید."),
        table("لایسنس انتخابی", licenseSummaryRows(license)),
        buttons([button("بازگشت", "lic:view:" + licenseId)]),
        footer(),
      ]));
    }
    if (action === "group") {
      setPending(actor, "group_bind", { licenseId });
      return render(chatId, messageId, doc([
        ...base("اتصال گروه", "شناسه عددی گروه را ارسال کنید."),
        table("لایسنس انتخابی", licenseSummaryRows(license)),
        buttons([button("بازگشت", "lic:view:" + licenseId)]),
        footer(),
      ]));
    }
  }

  if (data.startsWith("lic:delete:confirm:")) {
    const id = Number(data.slice("lic:delete:confirm:".length));
    if (!Number.isSafeInteger(id) || id <= 0) return;
    const license = await fetchLicenseById(pool, id);
    if (!license) {
      return render(chatId, messageId, doc([
        ...base("حذف لایسنس", "لایسنس موردنظر دیگر پیدا نشد."),
        buttons([button("مرکز لایسنس", "lic:center", "link")]),
        footer(),
      ]));
    }
    const result = await executeLicenseAction(pool, actor, id, "delete", {}, ownerIds);
    return render(chatId, messageId, doc([
      ...base(result.ok ? "حذف انجام شد" : "حذف انجام نشد", result.ok
        ? "لایسنس انتخاب‌شده با موفقیت حذف شد."
        : result.message),
      result.ok
        ? table("نتیجه", licenseSummaryRows(result.row))
        : { type: "paragraph", text: result.message },
      buttons([
        button("فهرست حذف‌شده‌ها", "lic:list:deleted", "primary"),
        button("مرکز لایسنس", "lic:center", "link"),
      ]),
      footer(),
    ]));
  }

  if (data.startsWith("lic:activate:") || data.startsWith("lic:suspend:") || data.startsWith("lic:cancel:") ||
      data.startsWith("lic:delete:") || data.startsWith("lic:restore:") || data.startsWith("lic:lock:") ||
      data.startsWith("lic:unlock:")) {
    const match = data.match(/^lic:(activate|suspend|cancel|delete|restore|lock|unlock):(\d+)$/);
    if (!match) return;
    const result = await executeLicenseAction(pool, actor, Number(match[2]), match[1], {}, ownerIds);
    return render(chatId, messageId, doc([
      ...base(result.ok ? "عملیات ثبت شد" : "عملیات انجام نشد", result.ok ? "تغییر وضعیت لایسنس ثبت شد." : result.message),
      result.ok
        ? table("نتیجه", licenseSummaryRows(result.row))
        : { type: "paragraph", text: result.message },
      buttons([
        button("مشاهده لایسنس", result.ok ? "lic:view:" + result.row.id : "lic:center"),
        button("مرکز لایسنس", "lic:center"),
      ]),
      footer(),
    ]));
  }

  if (data.startsWith("lic:edit:")) {
    const id = Number(data.slice("lic:edit:".length));
    const row = await fetchLicenseById(pool, id);
    if (!row) return;
    setPending(actor, "edit_name", { licenseId: id });
    return render(chatId, messageId, doc([
      ...base("ویرایش لایسنس", "نام جدید لایسنس را ارسال کنید."),
      table("لایسنس انتخابی", licenseSummaryRows(row)),
      buttons([button("بازگشت", "lic:view:" + id)]),
      footer(),
    ]));
  }

  if (data.startsWith("lic:renew:")) {
    const id = Number(data.slice("lic:renew:".length));
    const row = await fetchLicenseById(pool, id);
    if (!row) return;
    return render(chatId, messageId, doc([
      ...base("تمدید لایسنس", "مدت تمدید را انتخاب کنید."),
      buttons([
        button("یک ماه", "lic:renew:set:" + id + ":30"),
        button("سه ماه", "lic:renew:set:" + id + ":90"),
        button("شش ماه", "lic:renew:set:" + id + ":180"),
        button("یک سال", "lic:renew:set:" + id + ":365"),
      ]),
      buttons([
        button("تمدید دائمی", "lic:renew:set:" + id + ":lifetime"),
        button("بازگشت", "lic:view:" + id),
      ]),
      footer(),
    ]));
  }

  if (data.startsWith("lic:renew:set:")) {
    const parts = data.split(":");
    const id = Number(parts[3]);
    const daysRaw = parts[4];
    const row = await fetchLicenseById(pool, id);
    if (!row) return;
    let next: Date | null;
    if (daysRaw === "lifetime") next = null;
    else {
      const days = Number(daysRaw);
      if (!Number.isSafeInteger(days) || days <= 0) return;
      const baseDate = row.expires_at && new Date(String(row.expires_at)).getTime() > Date.now()
        ? new Date(String(row.expires_at))
        : new Date();
      next = new Date(baseDate.getTime() + days * 86400000);
    }
    const before = { ...row };
    await pool.query("UPDATE bot_licenses SET expires_at=$1,status='active' WHERE id=$2", [next, id]);
    const after = await fetchLicenseById(pool, id);
    await audit(pool, actor, id, "renew", before, after, { days: daysRaw });
    return render(chatId, messageId, doc([
      ...base("تمدید ثبت شد", "تاریخ پایان لایسنس به‌روزرسانی شد."),
      table("نتیجه", licenseSummaryRows(after!)),
      buttons([button("مشاهده لایسنس", "lic:view:" + id), button("مرکز لایسنس", "lic:center")]),
      footer(),
    ]));
  }

  if (data.startsWith("lic:owner:") || data.startsWith("lic:transfer:")) {
    const parts = data.split(":");
    const id = Number(parts[2]);
    if (!Number.isSafeInteger(id)) return;
    setPending(actor, "owner_change", { licenseId: id, action: parts[1] });
    return render(chatId, messageId, doc([
      ...base("تغییر مالک لایسنس", "شناسه عددی مالک جدید را ارسال کنید."),
      { type: "paragraph", text: "برای امنیت، مالک سامانه قابل انتقال به این روش نیست." },
      buttons([button("بازگشت", "lic:view:" + id)]),
      footer(),
    ]));
  }

  if (data.startsWith("lic:group:") && !data.startsWith("lic:group:unbind:")) {
    const id = Number(data.slice("lic:group:".length));
    if (!Number.isSafeInteger(id)) return;
    setPending(actor, "group_bind", { licenseId: id });
    return render(chatId, messageId, doc([
      ...base("اتصال گروه", "شناسه عددی گروه را ارسال کنید."),
      { type: "paragraph", text: "گروه باید قبلاً توسط ربات شناسایی شده باشد." },
      buttons([button("بازگشت", "lic:view:" + id)]),
      footer(),
    ]));
  }

  if (data.startsWith("lic:group:unbind:")) {
    const bindingId = Number(data.slice("lic:group:unbind:".length));
    if (!Number.isSafeInteger(bindingId)) return;
    const binding = (await pool.query(
      "SELECT * FROM bot_license_group_bindings WHERE id=$1 LIMIT 1",
      [bindingId],
    )).rows[0];
    if (!binding) return;
    await pool.query(
      "UPDATE bot_license_group_bindings SET status='inactive',disconnected_at=NOW() WHERE id=$1",
      [bindingId],
    );
    await pool.query("UPDATE bot_licenses SET group_id=NULL,group_title=NULL WHERE id=$1 AND group_id=$2", [
      binding.license_id,
      binding.group_id,
    ]);
    await audit(pool, actor, Number(binding.license_id), "group_unbind", binding, {});
    return render(chatId, messageId, await groupsPage(pool));
  }

  if (data.startsWith("lic:features:group:")) {
    const parts = data.split(":");
    return render(chatId, messageId, await featureGroupPage(pool, Number(parts[3]), parts[4]));
  }

  if (data.startsWith("lic:features:")) {
    const id = Number(data.slice("lic:features:".length));
    return render(chatId, messageId, await featureCenter(pool, id));
  }

  if (data.startsWith("lic:feature:toggle:")) {
    const parts = data.split(":");
    const id = Number(parts[3]);
    const key = parts.slice(4).join(":");
    const row = await fetchLicenseById(pool, id);
    if (!row) return;
    const features = { ...featureDefaults(), ...(row.features || {}) };
    features[key] = !Boolean(features[key]);
    await pool.query("UPDATE bot_licenses SET features=$1::jsonb WHERE id=$2", [JSON.stringify(features), id]);
    await audit(pool, actor, id, "feature_toggle", row.features, features, { key });
    return render(chatId, messageId, await featureGroupPage(pool, id, Object.entries(FEATURE_GROUPS).find(([, group]) => group.keys.includes(key))?.[0] || "members"));
  }

  if (data === "lic:feature_center") return render(chatId, messageId, await featureCenter(pool));
  if (data === "lic:limit_center") return render(chatId, messageId, await limitsPage(pool));
  if (data.startsWith("lic:limits:")) return render(chatId, messageId, await limitsPage(pool, Number(data.slice("lic:limits:".length))));
  if (data.startsWith("lic:limit:set:")) {
    const parts = data.split(":");
    const id = Number(parts[3]);
    const key = parts[4];
    if (!Number.isSafeInteger(id) || !LIMIT_KEYS.some(([k]) => k === key)) return;
    setPending(actor, "limit_set", { licenseId: id, key });
    return render(chatId, messageId, doc([
      ...base("تنظیم محدودیت", "مقدار عددی جدید را ارسال کنید."),
      { type: "paragraph", text: "شاخص: " + key },
      buttons([button("بازگشت", "lic:limits:" + id)]),
      footer(),
    ]));
  }

  if (data === "lic:security_center") return render(chatId, messageId, await securityCenter(pool));
  if (data.startsWith("lic:security:toggle:")) {
    const parts = data.split(":");
    const id = Number(parts[3]);
    const key = parts[4];
    const row = await fetchLicenseById(pool, id);
    if (!row) return;
    const security = { ...securityDefaults(), ...(row.security || {}) };
    if (!(key in security)) return;
    security[key] = !Boolean(security[key]);
    await pool.query("UPDATE bot_licenses SET security=$1::jsonb WHERE id=$2", [JSON.stringify(security), id]);
    await audit(pool, actor, id, "security_toggle", row.security, security, { key });
    return render(chatId, messageId, await securityCenter(pool, id));
  }

  if (data.startsWith("lic:security:control:")) {
    const key = data.endsWith("transfers") ? "lock_transfers" : "lock_connections";
    const current = (await pool.query("SELECT value FROM bot_license_controls WHERE key=$1", [key])).rows[0]?.value === true;
    await pool.query(
      "INSERT INTO bot_license_controls(key,value,updated_at,updated_by) VALUES($1,$2,NOW(),$3) " +
        "ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW(),updated_by=EXCLUDED.updated_by",
      [key, !current, actor],
    );
    return render(chatId, messageId, await securityCenter(pool));
  }

  if (data === "lic:plans") return render(chatId, messageId, await planCenter(pool));
  if (data === "lic:plan:create") {
    setPending(actor, "plan_create_key");
    return render(chatId, messageId, doc([
      ...base("ساخت پلن", "یک کلید انگلیسی کوتاه برای پلن ارسال کنید."),
      { type: "paragraph", text: "نمونه: custom_pro" },
      buttons([button("بازگشت", "lic:plans")]),
      footer(),
    ]));
  }

  if (data.startsWith("lic:plan:view:")) return render(chatId, messageId, await planView(pool, data.slice("lic:plan:view:".length)));
  if (data.startsWith("lic:plan:price:")) {
    setPending(actor, "plan_price", { key: data.slice("lic:plan:price:".length) });
    return render(chatId, messageId, doc([
      ...base("تغییر قیمت پلن", "قیمت جدید را فقط به‌صورت عددی ارسال کنید."),
      buttons([button("بازگشت", "lic:plans")]),
      footer(),
    ]));
  }
  if (data.startsWith("lic:plan:days:")) {
    setPending(actor, "plan_days", { key: data.slice("lic:plan:days:".length) });
    return render(chatId, messageId, doc([
      ...base("تغییر مدت پلن", "تعداد روز را ارسال کنید؛ برای دائمی عدد ۰ را بفرستید."),
      buttons([button("بازگشت", "lic:plans")]),
      footer(),
    ]));
  }
  if (data.startsWith("lic:plan:capacity:")) {
    setPending(actor, "plan_capacity", { key: data.slice("lic:plan:capacity:".length) });
    return render(chatId, messageId, doc([
      ...base("تغییر ظرفیت پلن", "ظرفیت گروه را به‌صورت عددی ارسال کنید."),
      buttons([button("بازگشت", "lic:plans")]),
      footer(),
    ]));
  }
  if (data.startsWith("lic:plan:toggle:")) {
    const key = data.slice("lic:plan:toggle:".length);
    const row = (await pool.query("SELECT active FROM bot_license_plans WHERE key=$1 LIMIT 1", [key])).rows[0];
    if (!row) return;
    await pool.query("UPDATE bot_license_plans SET active=$1,updated_at=NOW() WHERE key=$2", [!row.active, key]);
    return render(chatId, messageId, await planView(pool, key));
  }
  if (data.startsWith("lic:plan:features:") || data.startsWith("lic:plan:limits:")) {
    const key = data.split(":")[3];
    const field = data.startsWith("lic:plan:features:") ? "features" : "limits";
    const row = (await pool.query("SELECT " + field + " FROM bot_license_plans WHERE key=$1 LIMIT 1", [key])).rows[0];
    if (!row) return;
    const values = row[field] || {};
    return render(chatId, messageId, doc([
      ...base(field === "features" ? "امکانات پلن" : "محدودیت پلن", "نمایش تنظیمات ذخیره‌شده پلن."),
      table(field === "features" ? "امکانات" : "محدودیت‌ها", Object.entries(values).slice(0, 30).map(([k, v]) => [k, String(v)])),
      buttons([button("مشاهده پلن", "lic:plan:view:" + key), button("مدیریت پلن", "lic:plans")]),
      footer(),
    ]));
  }

  if (data === "lic:groups") return render(chatId, messageId, await groupsPage(pool));
  if (data === "lic:history") return render(chatId, messageId, await historyPage(pool));
  if (data.startsWith("lic:history:")) return render(chatId, messageId, await historyPage(pool, data.slice("lic:history:".length)));
  if (data === "lic:logs") return render(chatId, messageId, await logsPage(pool));
  if (data.startsWith("lic:logs:")) return render(chatId, messageId, await logsPage(pool, Number(data.slice("lic:logs:".length))));
  if (data === "lic:reports") return render(chatId, messageId, await reportsPage(pool));
  if (data === "lic:emergency") return render(chatId, messageId, await emergencyPage(pool));
  if (data.startsWith("lic:emergency:")) {
    const key = data.slice("lic:emergency:".length);
    const current = (await pool.query("SELECT value FROM bot_license_controls WHERE key=$1", [key])).rows[0]?.value === true;
    const next = !current;

    await pool.query(
      "INSERT INTO bot_license_controls(key,value,updated_at,updated_by) VALUES($1,$2,NOW(),$3) " +
        "ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW(),updated_by=EXCLUDED.updated_by",
      [key, next, actor],
    );

    if (key === "stop_all") {
      await pool.query(
        "UPDATE bot_licenses SET status=$1 WHERE status IN ('active','suspended')",
        [next ? "suspended" : "active"],
      );
      await audit(pool, actor, null, next ? "emergency_stop_all" : "emergency_restore_all", {}, { enabled: next });
    }

    return render(chatId, messageId, await emergencyPage(pool));
  }
  if (data === "lic:settings") return render(chatId, messageId, await settingsPage(pool));

  return;
}

export async function handleOwnerLicenseTextInput(
  pool: Pool,
  actor: number,
  chatId: number,
  text: string,
  ownerIds: string[],
) {
  const row = getPending(actor);
  if (!row) return false;

  const value = String(text || "").trim();

  try {
    if (row.flow === "search") {
      clearPending(actor);
      const result = await pool.query(
        "SELECT id,code,customer_id,license_type,expires_at,status,name,plan_key,locked " +
          "FROM bot_licenses WHERE code ILIKE $1 OR internal_id ILIKE $1 OR id::text=$2 OR customer_id::text=$2 OR name ILIKE $1 " +
          "ORDER BY id DESC LIMIT 20",
        ["%" + value + "%", value],
      );

      const blocks: any[] = [
        ...base("نتیجه جستجو", "نتایج جستجوی لایسنس."),
      ];
      if (!result.rows.length) {
        blocks.push({ type: "paragraph", text: "موردی پیدا نشد." });
      } else {
        for (const license of result.rows) {
          blocks.push(table("لایسنس", [
            ["شناسه", String(license.id)],
            ["کد", String(license.code)],
            ["نام", String(license.name || "بدون نام")],
            ["مشتری", String(license.customer_id)],
            ["وضعیت", statusFa(license.status, license.expires_at)],
          ]));
          blocks.push(buttons([button("مشاهده", "lic:view:" + license.id)]));
        }
      }
      blocks.push(buttons([button("مرکز لایسنس", "lic:center")]));
      blocks.push(footer());
      await render(chatId, undefined, doc(blocks));
      return true;
    }

    if (row.flow === "select_action") {
      const action = String(row.data.action);
      const targets = await resolveLicenseTargets(pool, value);

      if (!targets.length) {
        await render(chatId, undefined, doc([
          ...base("لایسنس پیدا نشد", "هیچ لایسنس فعالی با این آیدی یا شناسه پیدا نشد."),
          { type: "paragraph", text: "می‌توانید آیدی کاربری، شناسه لایسنس، کد یا شناسه داخلی را ارسال کنید." },
          buttons([
            button("انتخاب از موجودها", "lic:pick:" + action),
            button("بازگشت", "lic:method:" + action),
          ]),
          footer(),
        ]));
        return true;
      }

      clearPending(actor);

      if (targets.length === 1) {
        return ownerLicenseCallback(pool, chatId, 0, actor, "lic:apply:" + action + ":" + targets[0].id, ownerIds);
      }

      const blocks: any[] = [
        ...base("انتخاب لایسنس", "برای این آیدی چند لایسنس پیدا شد؛ مورد موردنظر را انتخاب کنید."),
      ];
      for (const license of targets) {
        blocks.push(table("لایسنس", licenseSummaryRows(license)));
        blocks.push(buttons([
          button("انتخاب این لایسنس", "lic:apply:" + action + ":" + license.id),
        ]));
      }
      blocks.push(buttons([
        button("بازگشت", "lic:method:" + action),
      ]));
      blocks.push(footer());
      await render(chatId, undefined, doc(blocks));
      return true;
    }

    if (row.flow === "create_customer") {
      const customerId = await resolveCustomerId(pool, value);
      if (!customerId) {
        await render(chatId, undefined, doc([
          ...base("ساخت لایسنس", "مشتری پیدا نشد."),
          { type: "paragraph", text: "آیدی عددی یا @username معتبر یک مشتری ثبت‌شده را ارسال کنید." },
          buttons([button("لغو", "lic:center")]),
          footer(),
        ]));
        return true;
      }
      row.flow = "create_group_limit";
      row.data.customerId = customerId;
      pending.set(actor, row);
      await render(chatId, undefined, doc([
        ...base("ساخت لایسنس", "سقف تعداد گروه‌های متصل را به‌صورت عددی ارسال کنید."),
        table("انتخاب فعلی", [
          ["مشتری", String(customerId)],
          ["پلن", planName(row.data.planKey, row.data.planKey)],
        ]),
        buttons([button("لغو", "lic:center")]),
        footer(),
      ]));
      return true;
    }

    if (row.flow === "create_pro_name") {
      row.data.name = value.slice(0, 120);
      row.flow = "create_customer_pro";
      pending.set(actor, row);
      await render(chatId, undefined, doc([
        ...base("ساخت حرفه‌ای", "شناسه عددی یا @username مشتری را ارسال کنید."),
        table("اطلاعات فعلی", [["نام لایسنس", row.data.name], ["پلن", planName(row.data.planKey, row.data.planKey)]]),
        buttons([button("لغو", "lic:center")]),
        footer(),
      ]));
      return true;
    }

    if (row.flow === "create_customer_pro") {
      const customerId = await resolveCustomerId(pool, value);
      if (!customerId) {
        await render(chatId, undefined, doc([
          ...base("ساخت حرفه‌ای", "مشتری پیدا نشد."),
          buttons([button("لغو", "lic:center")]),
          footer(),
        ]));
        return true;
      }
      row.data.customerId = customerId;
      row.flow = "create_group_limit_pro";
      pending.set(actor, row);
      await render(chatId, undefined, doc([
        ...base("ساخت حرفه‌ای", "سقف تعداد گروه را به‌صورت عددی ارسال کنید."),
        buttons([button("لغو", "lic:center")]),
        footer(),
      ]));
      return true;
    }

    if (row.flow === "create_group_limit" || row.flow === "create_group_limit_pro") {
      const groupLimit = Number(value);
      if (!Number.isSafeInteger(groupLimit) || groupLimit < 0 || groupLimit > 100000) {
        await render(chatId, undefined, doc([
          ...base("ساخت لایسنس", "سقف گروه نامعتبر است."),
          { type: "paragraph", text: "یک عدد صحیح بین ۰ تا ۱۰۰۰۰۰ ارسال کنید." },
          buttons([button("لغو", "lic:center")]),
          footer(),
        ]));
        return true;
      }
      const license = await createLicense(pool, actor, {
        customerId: Number(row.data.customerId),
        planKey: String(row.data.planKey),
        name: row.data.name,
        groupLimit,
        ownerId: Number(row.data.customerId),
      });
      clearPending(actor);
      return render(chatId, undefined, licenseView(license));
    }

    if (row.flow === "edit_name") {
      const licenseId = Number(row.data.licenseId);
      const current = await fetchLicenseById(pool, licenseId);
      if (!current) return false;
      await pool.query("UPDATE bot_licenses SET name=$1 WHERE id=$2", [value.slice(0, 120), licenseId]);
      const after = await fetchLicenseById(pool, licenseId);
      await audit(pool, actor, licenseId, "rename", current, after);
      clearPending(actor);
      return render(chatId, undefined, licenseView(after!));
    }

    if (row.flow === "owner_change") {
      const licenseId = Number(row.data.licenseId);
      const target = Number(value);
      if (!Number.isSafeInteger(target) || target <= 0 || ownerIds.includes(String(target))) {
        await render(chatId, undefined, doc([
          ...base("تغییر مالک", "شناسه مالک جدید معتبر نیست."),
          buttons([button("لغو", "lic:view:" + licenseId)]),
          footer(),
        ]));
        return true;
      }
      const result = await executeLicenseAction(pool, actor, licenseId, String(row.data.action || "owner"), { targetOwner: target }, ownerIds);
      clearPending(actor);
      return render(chatId, undefined, result.ok ? licenseView(result.row) : doc([
        ...base("تغییر مالک", result.message),
        buttons([button("بازگشت", "lic:view:" + licenseId)]),
        footer(),
      ]));
    }

    if (row.flow === "group_bind") {
      const licenseId = Number(row.data.licenseId);
      const groupId = Number(value);
      if (!Number.isSafeInteger(groupId) || groupId === 0) {
        await render(chatId, undefined, doc([
          ...base("اتصال گروه", "شناسه گروه معتبر نیست."),
          buttons([button("بازگشت", "lic:view:" + licenseId)]),
          footer(),
        ]));
        return true;
      }
      const result = await bindLicenseGroup(pool, actor, licenseId, groupId);
      clearPending(actor);
      if (!result.ok) {
        return render(chatId, undefined, doc([
          ...base("اتصال گروه انجام نشد", result.message),
          buttons([button("بازگشت", "lic:view:" + licenseId)]),
          footer(),
        ]));
      }
      const after = await fetchLicenseById(pool, licenseId);
      return render(chatId, undefined, licenseView(after!));
    }

    if (row.flow === "limit_set") {
      const licenseId = Number(row.data.licenseId);
      const key = String(row.data.key);
      const number = Number(value);
      if (!Number.isSafeInteger(number) || number < 0 || number > 1000000000) {
        await render(chatId, undefined, doc([
          ...base("تنظیم محدودیت", "مقدار نامعتبر است."),
          buttons([button("بازگشت", "lic:limits:" + licenseId)]),
          footer(),
        ]));
        return true;
      }
      const current = await fetchLicenseById(pool, licenseId);
      if (!current) return true;
      const limits = { ...limitDefaults(Number(current.group_limit || 0)), ...(current.limits || {}) };
      limits[key] = number;
      if (key === "group_limit") {
        await pool.query("UPDATE bot_licenses SET group_limit=$1,limits=$2::jsonb WHERE id=$3", [number, JSON.stringify(limits), licenseId]);
      } else {
        await pool.query("UPDATE bot_licenses SET limits=$1::jsonb WHERE id=$2", [JSON.stringify(limits), licenseId]);
      }
      const after = await fetchLicenseById(pool, licenseId);
      await audit(pool, actor, licenseId, "limit_update", current.limits, limits, { key, value: number });
      clearPending(actor);
      return render(chatId, undefined, await limitsPage(pool, licenseId));
    }

    if (row.flow === "plan_create_key") {
      const key = value.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
      if (!key) {
        await render(chatId, undefined, doc([
          ...base("ساخت پلن", "کلید نامعتبر است."),
          buttons([button("لغو", "lic:plans")]),
          footer(),
        ]));
        return true;
      }
      const exists = (await pool.query("SELECT 1 FROM bot_license_plans WHERE key=$1 LIMIT 1", [key])).rowCount;
      if (exists) {
        await render(chatId, undefined, doc([
          ...base("ساخت پلن", "این کلید قبلاً ثبت شده است."),
          buttons([button("مدیریت پلن", "lic:plans")]),
          footer(),
        ]));
        return true;
      }
      row.flow = "plan_create_name";
      row.data.key = key;
      pending.set(actor, row);
      await render(chatId, undefined, doc([
        ...base("ساخت پلن", "نام نمایشی پلن را ارسال کنید."),
        buttons([button("لغو", "lic:plans")]),
        footer(),
      ]));
      return true;
    }

    if (row.flow === "plan_create_name") {
      row.flow = "plan_create_price";
      row.data.name = value.slice(0, 80);
      pending.set(actor, row);
      await render(chatId, undefined, doc([
        ...base("ساخت پلن", "قیمت پلن را به تومان ارسال کنید."),
        buttons([button("لغو", "lic:plans")]),
        footer(),
      ]));
      return true;
    }

    if (row.flow === "plan_create_price") {
      const price = Number(value);
      if (!Number.isFinite(price) || price < 0) {
        await render(chatId, undefined, doc([
          ...base("ساخت پلن", "قیمت نامعتبر است."),
          buttons([button("لغو", "lic:plans")]),
          footer(),
        ]));
        return true;
      }
      row.flow = "plan_create_days";
      row.data.price = price;
      pending.set(actor, row);
      await render(chatId, undefined, doc([
        ...base("ساخت پلن", "مدت اعتبار را به روز ارسال کنید؛ برای دائمی ۰."),
        buttons([button("لغو", "lic:plans")]),
        footer(),
      ]));
      return true;
    }

    if (row.flow === "plan_create_days") {
      const days = Number(value);
      if (!Number.isSafeInteger(days) || days < 0 || days > 36500) {
        await render(chatId, undefined, doc([
          ...base("ساخت پلن", "مدت نامعتبر است."),
          buttons([button("لغو", "lic:plans")]),
          footer(),
        ]));
        return true;
      }
      await pool.query(
        "INSERT INTO bot_license_plans(key,name,price,duration_days,features,limits) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)",
        [String(row.data.key), String(row.data.name), Number(row.data.price), days === 0 ? null : days, JSON.stringify(featureDefaults()), JSON.stringify(limitDefaults(1))],
      );
      clearPending(actor);
      return render(chatId, undefined, await planCenter(pool));
    }

    if (row.flow === "plan_price" || row.flow === "plan_days" || row.flow === "plan_capacity") {
      const key = String(row.data.key);
      const number = Number(value);
      if (!Number.isSafeInteger(number) || number < 0) {
        await render(chatId, undefined, doc([
          ...base("تنظیم پلن", "مقدار نامعتبر است."),
          buttons([button("بازگشت", "lic:plan:view:" + key)]),
          footer(),
        ]));
        return true;
      }

      if (row.flow === "plan_price") {
        await pool.query("UPDATE bot_license_plans SET price=$1,updated_at=NOW() WHERE key=$2", [number, key]);
      } else if (row.flow === "plan_days") {
        await pool.query("UPDATE bot_license_plans SET duration_days=$1,updated_at=NOW() WHERE key=$2", [number === 0 ? null : number, key]);
      } else {
        await pool.query("UPDATE bot_license_plans SET capacity=$1,updated_at=NOW() WHERE key=$2", [number, key]);
      }
      clearPending(actor);
      return render(chatId, undefined, await planView(pool, key));
    }

    return false;
  } catch (error) {
    console.error("[owner-license] text input failed:", error);
    await render(chatId, undefined, doc([
      ...base("خطای عملیات", "در اجرای عملیات لایسنس خطایی رخ داد."),
      { type: "paragraph", text: "لاگ فنی در سرور ثبت شده است." },
      buttons([button("مرکز لایسنس", "lic:center")]),
      footer(),
    ]));
    clearPending(actor);
    return true;
  }
}
