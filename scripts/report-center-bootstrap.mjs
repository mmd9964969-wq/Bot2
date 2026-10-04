import pg from "pg";

const { Pool } = pg;

const TOPICS = [
  ["startup", "راه‌اندازی ربات"],
  ["system_status", "وضعیت سیستم"],
  ["deployment", "استقرار و بروزرسانی"],
  ["groups", "گروه‌ها"],
  ["installation", "نصب و اتصال"],
  ["members", "اعضا"],
  ["admins", "مدیران"],
  ["moderation", "اقدامات مدیریتی"],
  ["commands", "دستورات"],
  ["security", "امنیت"],
  ["locks", "قفل‌ها"],
  ["health", "نظارت و سلامت"],
  ["errors", "خطاها"],
  ["database", "پایگاه داده"],
  ["queue", "صف و پردازش"],
  ["scheduler", "وظایف زمان‌بندی‌شده"],
  ["analytics", "آمار و تحلیل"],
  ["bots", "ربات‌ها"],
  ["customers", "مشتریان"],
  ["licenses", "لایسنس‌ها"],
  ["finance", "مالی"],
  ["ownership", "مالکیت"],
  ["web_panel", "Web Panel"],
  ["api_services", "API و سرویس‌ها"],
  ["support", "پشتیبانی"],
  ["customer_reports", "گزارش مشتریان"],
  ["notifications", "اعلان‌ها"],
  ["configuration", "تنظیمات و پیکربندی"],
  ["performance", "عملکرد"],
  ["backup_recovery", "پشتیبان‌گیری و بازیابی"],
  ["audit", "Audit"],
  ["critical", "وضعیت بحرانی"],
];


const TOPIC_ICON_CACHE = new Map();

async function getAllowedTopicIconIds() {
  if (TOPIC_ICON_CACHE.has(chatId)) return TOPIC_ICON_CACHE.get(chatId);

  const result = await api("getForumTopicIconStickers");
  if (!result.ok || !Array.isArray(result.result)) {
    throw new Error(`getForumTopicIconStickers failed: ${result.description || "unknown error"}`);
  }

  const ids = result.result
    .map((sticker) => String(sticker?.custom_emoji_id || ""))
    .filter(Boolean);

  if (!ids.length) {
    throw new Error("Telegram returned no allowed custom emoji IDs for forum topic icons");
  }

  TOPIC_ICON_CACHE.set(chatId, ids);
  console.log(`[report-center] loaded ${ids.length} Telegram-native topic custom emoji icons`);
  return ids;
}

async function getTopicIconId(topicIndex) {
  const ids = await getAllowedTopicIconIds();
  return ids[topicIndex % ids.length];
}



const TOPIC_INTROS = {
  startup: {
    label: "راه‌اندازی ربات",
    purpose: "مرکز ثبت رخدادهای شروع، توقف و آماده‌به‌کار شدن Bot Core.",
    events: "Startup، Shutdown، Restart، Health Ready و تغییر وضعیت اولیه سرویس.",
    notes: "این Topic مرجع تشخیص زمان بالا آمدن ربات و وضعیت اولیه سرویس است.",
  },
  system_status: {
    label: "وضعیت سیستم",
    purpose: "نمایش وضعیت کلی سرویس‌ها و اجزای اصلی Persian Bot.",
    events: "وضعیت Bot Core، Web Panel، Telegram API، Database و سرویس‌های وابسته.",
    notes: "برای بررسی سریع سلامت عمومی سیستم استفاده می‌شود.",
  },
  deployment: {
    label: "استقرار و بروزرسانی",
    purpose: "ثبت تمام رویدادهای Deploy و بروزرسانی نسخه‌های تولیدی.",
    events: "Build، Deploy، Restart، Release، Rollback و تغییر نسخه.",
    notes: "هر تغییر مهم در محیط Production باید قابل ردیابی باشد.",
  },
  groups: {
    label: "گروه‌ها",
    purpose: "مرکز رخدادهای مرتبط با گروه‌های تحت مدیریت ربات.",
    events: "ثبت گروه، بروزرسانی مشخصات، فعال/غیرفعال شدن و تغییر وضعیت سرویس گروه.",
    notes: "منبع اصلی تاریخچه تغییرات مدیریتی گروه‌هاست.",
  },
  installation: {
    label: "نصب و اتصال",
    purpose: "ثبت نصب، اتصال و قطع اتصال ربات از گروه‌ها.",
    events: "Installation، Verification، Connection، Uninstallation و خطاهای نصب.",
    notes: "برای بررسی چرخه کامل نصب و اتصال استفاده می‌شود.",
  },
  members: {
    label: "اعضا",
    purpose: "ثبت رخدادهای مهم مربوط به اعضای گروه‌ها.",
    events: "ورود، خروج، تغییر وضعیت عضویت و تغییرات مهم پروفایل عضویت.",
    notes: "گزارش‌های روتین چت در این بخش قرار نمی‌گیرند.",
  },
  admins: {
    label: "مدیران",
    purpose: "ثبت تغییرات و رخدادهای مرتبط با مدیران گروه.",
    events: "ارتقا، تنزل، تغییر دسترسی و بررسی وضعیت مدیران.",
    notes: "برای Audit دسترسی‌های مدیریتی استفاده می‌شود.",
  },
  moderation: {
    label: "اقدامات مدیریتی",
    purpose: "مرکز ثبت اقدامات Moderation انجام‌شده توسط مدیران یا سیستم.",
    events: "Warn، Mute، Ban، Kick، Unmute و سایر اقدامات مدیریتی.",
    notes: "برای هر اقدام، عامل اجراکننده و نتیجه عملیات ثبت می‌شود.",
  },
  commands: {
    label: "دستورات",
    purpose: "ثبت اجرای دستورات و رخدادهای مرتبط با Command System.",
    events: "اجرای دستور، رد دسترسی، خطای دستور و تغییر تنظیمات دستورات.",
    notes: "برای تحلیل رفتار Commandها و تشخیص خطاهای اجرایی است.",
  },
  security: {
    label: "امنیت",
    purpose: "ثبت رخدادهای امنیتی و تلاش‌های مشکوک.",
    events: "Permission Denied، Anti-Spam، رفتار مشکوک و رخدادهای امنیتی.",
    notes: "رویدادهای مهم امنیتی باید با Severity مشخص ثبت شوند.",
  },
  locks: {
    label: "قفل‌ها",
    purpose: "ثبت تغییر وضعیت Lock Center و قفل‌های گروه.",
    events: "فعال‌سازی، غیرفعال‌سازی، تغییر تنظیمات و خطاهای Lock System.",
    notes: "هر تغییر قفل باید مشخص کند چه کسی و کدام قفل را تغییر داده است.",
  },
  health: {
    label: "نظارت و سلامت",
    purpose: "ثبت Health Check و پایش مداوم سرویس‌ها.",
    events: "Health Check، Latency، Dependency Check و Recovery.",
    notes: "برای تشخیص سریع افت سلامت سرویس استفاده می‌شود.",
  },
  errors: {
    label: "خطاها",
    purpose: "مرکز خطاهای قابل توجه سیستم و سرویس‌ها.",
    events: "Runtime Error، API Error، Query Error و خطاهای پردازشی.",
    notes: "خطاهای بحرانی باید علاوه بر این Topic در Critical نیز ارجاع شوند.",
  },
  database: {
    label: "پایگاه داده",
    purpose: "ثبت رخدادهای مهم PostgreSQL و لایه داده.",
    events: "Connection، Migration، Query Failure، Transaction و Schema Change.",
    notes: "اطلاعات حساس اتصال یا Credential هرگز در گزارش ثبت نشود.",
  },
  queue: {
    label: "صف و پردازش",
    purpose: "ثبت وضعیت Queue و عملیات پردازشی.",
    events: "Enqueue، Dequeue، Retry، Failure، Delay و Overflow.",
    notes: "برای تشخیص صف‌های معطل و پردازش‌های ناموفق استفاده می‌شود.",
  },
  scheduler: {
    label: "وظایف زمان‌بندی‌شده",
    purpose: "ثبت اجرای Jobها و Taskهای زمان‌بندی‌شده.",
    events: "شروع، موفقیت، تأخیر، Retry و شکست Scheduler Jobها.",
    notes: "وظایف خودکار مانند گزارش روزانه باید در این بخش دیده شوند.",
  },
  analytics: {
    label: "آمار و تحلیل",
    purpose: "مرکز رخدادهای تحلیلی و تولید آمار.",
    events: "محاسبه آمار، Ranking، Metrics، Aggregation و گزارش‌های دوره‌ای.",
    notes: "داده خام حساس نباید در گزارش عمومی این Topic قرار بگیرد.",
  },
  bots: {
    label: "ربات‌ها",
    purpose: "مدیریت و پایش ربات‌های متصل به سامانه.",
    events: "ثبت ربات، اتصال، فعال/غیرفعال شدن و تغییر وضعیت ربات.",
    notes: "هر Bot باید با شناسه داخلی یا شناسه امن قابل ردیابی باشد.",
  },
  customers: {
    label: "مشتریان",
    purpose: "ثبت رخدادهای مربوط به Customer Management.",
    events: "ثبت مشتری، تغییر وضعیت، تمدید، تعلیق و رخدادهای مرتبط.",
    notes: "اطلاعات شخصی و محرمانه مشتری نباید در گزارش درج شود.",
  },
  licenses: {
    label: "لایسنس‌ها",
    purpose: "مرکز رخدادهای ایجاد و مدیریت Licenseها.",
    events: "Create، Activate، Extend، Suspend، Revoke و مصرف License.",
    notes: "کلید یا Secret واقعی لایسنس هرگز در گزارش نمایش داده نشود.",
  },
  finance: {
    label: "مالی",
    purpose: "ثبت رخدادهای مالی و تغییرات قابل حسابرسی.",
    events: "Invoice، Payment، Refund، Charge و تغییرات مالی.",
    notes: "اطلاعات پرداخت حساس باید Mask یا حذف شود.",
  },
  ownership: {
    label: "مالکیت",
    purpose: "مرکز رخدادهای مالکیت و تغییرات سطح دسترسی مالک.",
    events: "افزودن/حذف Owner، تغییر Sudo و تغییرات سطح مالکیت.",
    notes: "این Topic فقط برای رخدادهای حساس مدیریتی سامانه است.",
  },
  web_panel: {
    label: "Web Panel",
    purpose: "ثبت رخدادهای پنل وب مالکیت و مدیریت.",
    events: "Login، Logout، Permission، تغییر تنظیمات و عملیات پنل.",
    notes: "اطلاعات احراز هویت و Token هرگز ثبت نمی‌شود.",
  },
  api_services: {
    label: "API و سرویس‌ها",
    purpose: "ثبت وضعیت و رخدادهای سرویس‌های API و وابستگی‌ها.",
    events: "Request Failure، Timeout، Rate Limit، Service Down و Recovery.",
    notes: "برای شناسایی سرویس معیوب یا Dependency ناپایدار استفاده می‌شود.",
  },
  support: {
    label: "پشتیبانی",
    purpose: "مرکز رخدادها و تیکت‌های مرتبط با پشتیبانی.",
    events: "ایجاد، تغییر وضعیت و بسته شدن درخواست‌های پشتیبانی.",
    notes: "اطلاعات حساس کاربر باید قبل از گزارش‌کردن حذف شود.",
  },
  customer_reports: {
    label: "گزارش مشتریان",
    purpose: "ثبت گزارش‌ها و رویدادهای قابل مشاهده برای مشتریان.",
    events: "Customer Report، وضعیت سرویس مشتری و رخدادهای قابل ارائه.",
    notes: "این بخش باید فقط داده مناسب سطح دسترسی مشتری را شامل شود.",
  },
  notifications: {
    label: "اعلان‌ها",
    purpose: "ثبت اعلان‌های سیستمی و مدیریتی ارسال‌شده.",
    events: "ارسال، موفقیت، شکست، Retry و اولویت اعلان‌ها.",
    notes: "برای ردیابی چرخه کامل Notification استفاده می‌شود.",
  },
  configuration: {
    label: "تنظیمات و پیکربندی",
    purpose: "ثبت تغییرات مهم Configuration سامانه.",
    events: "تغییر تنظیمات، Feature Flag، Environment Mapping و Policy.",
    notes: "مقادیر Secret و Token هرگز در این Topic ثبت نشوند.",
  },
  performance: {
    label: "عملکرد",
    purpose: "ثبت Metrics مربوط به کارایی و مصرف منابع.",
    events: "Latency، Memory، CPU، Slow Operation و Performance Degradation.",
    notes: "افزایش غیرعادی مصرف منابع باید با Severity مناسب ثبت شود.",
  },
  backup_recovery: {
    label: "پشتیبان‌گیری و بازیابی",
    purpose: "ثبت عملیات Backup و Recovery.",
    events: "Backup Start، Backup Success، Restore، Failure و Verification.",
    notes: "برای اطمینان از قابل بازیابی بودن داده‌ها استفاده می‌شود.",
  },
  audit: {
    label: "Audit",
    purpose: "ثبت رخدادهای حساس قابل حسابرسی در سطح سامانه.",
    events: "تغییر دسترسی، تغییر مالکیت، عملیات مدیریتی مهم و تنظیمات حساس.",
    notes: "این Topic باید تاریخچه دقیق عامل، عملیات و نتیجه را حفظ کند.",
  },
  critical: {
    label: "وضعیت بحرانی",
    purpose: "مرکز هشدارهای CRITICAL که نیازمند توجه فوری هستند.",
    events: "Service Down، Data Failure، Security Critical، Recovery Failure و رخدادهای اضطراری.",
    notes: "این Topic اولویت بالای رسیدگی دارد و باید کم‌حجم و عملیاتی باقی بماند.",
  },
};

function richBold(text) {
  return { type: "bold", text };
}

function buildTopicIntro(key, title) {
  const info = TOPIC_INTROS[key] ?? {
    label: title,
    purpose: "ثبت رخدادهای مرتبط با این بخش از سامانه.",
    events: "رویدادهای عملیاتی و مدیریتی مرتبط.",
    notes: "گزارش‌ها باید خلاصه، دقیق و قابل پیگیری باشند.",
  };

  return {
    is_rtl: true,
    blocks: [
      {
        type: "heading",
        size: 2,
        text: [
          richBold("◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Rᴇᴘᴏʀᴛ Cᴇɴᴛᴇʀ"),
        ],
      },
      {
        type: "heading",
        size: 3,
        text: [richBold(`★ - ${info.label}`)],
      },
      { type: "divider" },
      {
        type: "table",
        is_bordered: true,
        is_striped: true,
        is_compact: true,
        caption: richBold("مشخصات Topic"),
        cells: [
          [
            { text: richBold("بخش"), is_header: true, align: "center", valign: "middle" },
            { text: richBold("توضیح"), is_header: true, align: "center", valign: "middle" },
          ],
          [
            { text: "کاربرد", align: "right", valign: "middle" },
            { text: info.purpose, align: "right", valign: "middle" },
          ],
          [
            { text: "گزارش‌ها", align: "right", valign: "middle" },
            { text: info.events, align: "right", valign: "middle" },
          ],
          [
            { text: "وضعیت", align: "right", valign: "middle" },
            { text: "● فعال", align: "right", valign: "middle" },
          ],
        ],
      },
      {
        type: "details",
        summary: richBold("◂ راهنمای استفاده"),
        is_open: true,
        blocks: [
          {
            type: "paragraph",
            text: info.notes,
          },
          {
            type: "list",
            items: [
              {
                label: "۱",
                blocks: [{ type: "paragraph", text: "این پیام، راهنمای ثابت Topic است." }],
              },
              {
                label: "۲",
                blocks: [{ type: "paragraph", text: "گزارش‌های واقعی سیستم بعد از این پیام ثبت می‌شوند." }],
              },
              {
                label: "۳",
                blocks: [{ type: "paragraph", text: "این پیام توسط ربات ایجاد و Pin می‌شود." }],
              },
            ],
          },
        ],
      },
      { type: "divider" },
      {
        type: "footer",
        text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Rᴇᴘᴏʀᴛ Cᴇɴᴛᴇʀ",
      },
    ],
  };
}

const chatId = String(process.env.REPORT_CENTER_CHAT_ID ?? "").trim();
const token = String(process.env.BOT_TOKEN ?? "").trim();
const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
const cleanupIds = String(process.env.REPORT_CENTER_CLEANUP_TOPIC_IDS ?? "")
  .split(",").map((x) => Number(x.trim())).filter(Number.isInteger);

if (!chatId) {
  console.log("[report-center] REPORT_CENTER_CHAT_ID is not configured; bootstrap skipped");
  process.exit(0);
}
if (!token || !databaseUrl) {
  console.error("[report-center] BOT_TOKEN or DATABASE_URL is missing");
  process.exit(1);
}

const api = async (method, body = {}) => {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pool = new Pool({ connectionString: databaseUrl, max: 2 });

async function createTopicWithRetry(title, iconCustomEmojiId) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const created = await api("createForumTopic", { chat_id: chatId, name: title, icon_custom_emoji_id: iconCustomEmojiId });
    if (created.ok && created.result?.message_thread_id) return created;

    const retryAfter = Number(created.parameters?.retry_after || 0);
    if (String(created.error_code || "") === "429" && retryAfter > 0) {
      const delay = Math.max(retryAfter, 1) * 1000 + 1500;
      console.warn(`[report-center] Telegram rate limit for "${title}"; retrying in ${Math.ceil(delay / 1000)}s`);
      await sleep(delay);
      continue;
    }
    throw new Error(`createForumTopic failed for ${title}: ${created.description || "unknown error"}`);
  }
  throw new Error(`createForumTopic retries exhausted for ${title}`);
}

async function editTopicIconWithRetry(threadId, iconCustomEmojiId) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const result = await api("editForumTopic", {
      chat_id: chatId,
      message_thread_id: threadId,
      icon_custom_emoji_id: String(iconCustomEmojiId),
    });
    if (result.ok) return true;
    const retryAfter = Number(result.parameters?.retry_after || 0);
    if (String(result.error_code || "") === "429" && retryAfter > 0) {
      await sleep(Math.max(retryAfter, 1) * 1000 + 1500);
      continue;
    }
    if (Number(result.error_code) === 400 && /not modified/i.test(String(result.description || ""))) return true;
    throw new Error(`editForumTopic failed for [${threadId}]: ${result.description || "unknown error"}`);
  }
  throw new Error(`editForumTopic retries exhausted for topic [${threadId}]`);
}

async function deleteTopicWithRetry(threadId) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const result = await api("deleteForumTopic", { chat_id: chatId, message_thread_id: threadId });
    if (result.ok) return true;

    const retryAfter = Number(result.parameters?.retry_after || 0);
    if (String(result.error_code || "") === "429" && retryAfter > 0) {
      await sleep(Math.max(retryAfter, 1) * 1000 + 1500);
      continue;
    }

    // Already deleted / unknown topic: do not block the report center bootstrap.
    if (Number(result.error_code) === 400) {
      console.warn(`[report-center] cleanup topic ${threadId}: ${result.description || "already absent"}`);
      return false;
    }
    throw new Error(`deleteForumTopic failed for ${threadId}: ${result.description || "unknown error"}`);
  }
  throw new Error(`deleteForumTopic retries exhausted for ${threadId}`);
}


async function sendRichMessageWithRetry(threadId, richMessage) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const result = await api("sendRichMessage", {
      chat_id: chatId,
      message_thread_id: threadId,
      rich_message: richMessage,
      disable_notification: true,
    });
    if (result.ok && result.result?.message_id && result.result?.rich_message) return result;

    const retryAfter = Number(result.parameters?.retry_after || 0);
    if (String(result.error_code || "") === "429" && retryAfter > 0) {
      const delay = Math.max(retryAfter, 1) * 1000 + 1500;
      console.warn(`[report-center] sendRichMessage rate limit for [${threadId}]; retrying in ${Math.ceil(delay / 1000)}s`);
      await sleep(delay);
      continue;
    }

    throw new Error(`sendRichMessage failed for topic [${threadId}]: ${result.description || "unknown error"}`);
  }

  throw new Error(`sendRichMessage retries exhausted for topic [${threadId}]`);
}


async function deleteMessageWithRetry(threadId, messageId) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const result = await api("deleteMessage", {
      chat_id: chatId,
      message_id: messageId,
    });
    if (result.ok) return true;

    const retryAfter = Number(result.parameters?.retry_after || 0);
    if (String(result.error_code || "") === "429" && retryAfter > 0) {
      await sleep(Math.max(retryAfter, 1) * 1000 + 1500);
      continue;
    }

    if (Number(result.error_code) === 400) {
      console.warn(`[report-center] old intro [${messageId}] on topic [${threadId}] is already absent`);
      return false;
    }

    throw new Error(`deleteMessage failed for [${messageId}]: ${result.description || "unknown error"}`);
  }

  throw new Error(`deleteMessage retries exhausted for [${messageId}]`);
}

async function pinMessageWithRetry(threadId, messageId) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const result = await api("pinChatMessage", {
      chat_id: chatId,
      message_id: messageId,
      disable_notification: true,
    });
    if (result.ok) return true;

    const retryAfter = Number(result.parameters?.retry_after || 0);
    if (String(result.error_code || "") === "429" && retryAfter > 0) {
      const delay = Math.max(retryAfter, 1) * 1000 + 1500;
      console.warn(`[report-center] pin rate limit for [${threadId}]; retrying in ${Math.ceil(delay / 1000)}s`);
      await sleep(delay);
      continue;
    }
    throw new Error(`pinChatMessage failed for topic [${threadId}]: ${result.description || "unknown error"}`);
  }
  throw new Error(`pinChatMessage retries exhausted for topic [${threadId}]`);
}

async function bootstrap() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS report_centers (
      id BIGSERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      configured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_health_check TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS report_center_topics (
      id BIGSERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      topic_key TEXT NOT NULL,
      title TEXT NOT NULL,
      message_thread_id INTEGER NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      intro_message_id BIGINT,
      intro_pinned_at TIMESTAMPTZ,
      intro_format TEXT NOT NULL DEFAULT 'legacy',
      UNIQUE(chat_id, topic_key),
      UNIQUE(chat_id, message_thread_id)
    );
    CREATE INDEX IF NOT EXISTS idx_report_center_topics_chat ON report_center_topics(chat_id);
    ALTER TABLE report_center_topics ADD COLUMN IF NOT EXISTS intro_message_id BIGINT;
    ALTER TABLE report_center_topics ADD COLUMN IF NOT EXISTS intro_pinned_at TIMESTAMPTZ;
    ALTER TABLE report_center_topics ADD COLUMN IF NOT EXISTS intro_format TEXT NOT NULL DEFAULT 'legacy';
  `);

  const lock = await pool.connect();
  try {
    const lockResult = await lock.query(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [`report-center-bootstrap:${chatId}`],
    );
    if (!lockResult.rows[0]?.locked) {
      console.log("[report-center] another bootstrap instance is active; this instance will exit");
      return;
    }

    const chat = await api("getChat", { chat_id: chatId });
    if (!chat.ok || !chat.result) throw new Error(chat.description || "Telegram getChat failed");
    if (![ "group", "supergroup" ].includes(String(chat.result.type))) throw new Error("Report Center target is not a Telegram group");
    if (chat.result.is_forum !== true) throw new Error("Report Center target is not a Forum/Topics group");

    const me = await api("getMe");
    if (!me.ok || !me.result?.id) throw new Error(me.description || "Telegram getMe failed");

    const botMember = await api("getChatMember", { chat_id: chatId, user_id: me.result.id });
    if (!botMember.ok || !botMember.result) throw new Error(botMember.description || "Telegram getChatMember failed");

    const status = String(botMember.result.status || "");
    if (![ "administrator", "creator" ].includes(status)) throw new Error("Bot is not an administrator in Report Center");
    if (botMember.result.can_manage_topics !== true && status !== "creator") throw new Error("Bot does not have Manage Topics permission");
    if (botMember.result.can_pin_messages !== true && status !== "creator") throw new Error("Bot does not have Pin Messages permission");

    if (cleanupIds.length) {
      console.log(`[report-center] cleanup requested: ${cleanupIds.join(",")}`);
      for (const threadId of cleanupIds) {
        if (await deleteTopicWithRetry(threadId)) {
          console.log(`[report-center] deleted duplicate topic [${threadId}]`);
        }
        await sleep(3000);
      }
    }

    await lock.query(
      `INSERT INTO report_centers(chat_id,title,enabled,last_health_check)
       VALUES($1,$2,TRUE,NOW())
       ON CONFLICT(chat_id) DO UPDATE SET title=EXCLUDED.title, enabled=TRUE, last_health_check=NOW()`,
      [chatId, String(chat.result.title || "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Report Center")],
    );

    const results = [];
    let createdCount = 0;

    const allowedTopicIconIds = await getAllowedTopicIconIds();
    if (!allowedTopicIconIds.length) throw new Error("No Telegram-native topic custom emoji icons available");

    for (const [topicIndex, [key, title]] of TOPICS.entries()) {
      const existing = await lock.query(
        `SELECT message_thread_id FROM report_center_topics WHERE chat_id=$1 AND topic_key=$2 LIMIT 1`,
        [chatId, key],
      );

      let threadId = Number(existing.rows[0]?.message_thread_id || 0);
      if (!threadId) {
        const iconCustomEmojiId = allowedTopicIconIds[topicIndex % allowedTopicIconIds.length];
        const created = await createTopicWithRetry(title, iconCustomEmojiId);
        threadId = Number(created.result.message_thread_id);
        createdCount += 1;
        results.push(`+ ${title} [${threadId}]`);
        await sleep(5000);
      } else {
        results.push(`= ${title} [${threadId}]`);
      }

      const iconCustomEmojiId = allowedTopicIconIds[topicIndex % allowedTopicIconIds.length];

      // Existing topics keep their thread IDs; synchronize only the native Telegram topic icon.
      await editTopicIconWithRetry(threadId, iconCustomEmojiId);

      await lock.query(
        `INSERT INTO report_center_topics(chat_id,topic_key,title,message_thread_id,enabled,updated_at)
         VALUES($1,$2,$3,$4,TRUE,NOW())
         ON CONFLICT(chat_id,topic_key) DO UPDATE SET title=EXCLUDED.title,message_thread_id=EXCLUDED.message_thread_id,enabled=TRUE,updated_at=NOW()`,
        [chatId, key, title, threadId],
      );

      const introRow = await lock.query(
        `SELECT intro_message_id, intro_format
         FROM report_center_topics
         WHERE chat_id=$1 AND topic_key=$2
         LIMIT 1`,
        [chatId, key],
      );
      let introMessageId = Number(introRow.rows[0]?.intro_message_id || 0);
      const introFormat = String(introRow.rows[0]?.intro_format || "legacy");

      if (introFormat !== "rich_v1") {
        if (introMessageId) {
          await deleteMessageWithRetry(threadId, introMessageId);
          await sleep(1000);
        }

        const intro = await sendRichMessageWithRetry(threadId, buildTopicIntro(key, title));
        introMessageId = Number(intro.result.message_id);
        if (!intro.result.rich_message) {
          throw new Error(`Telegram did not return a RichMessage payload for topic [${threadId}]`);
        }

        await pinMessageWithRetry(threadId, introMessageId);
        await lock.query(
          `UPDATE report_center_topics
           SET intro_message_id=$1,
               intro_pinned_at=NOW(),
               intro_format='rich_v1',
               updated_at=NOW()
           WHERE chat_id=$2 AND topic_key=$3`,
          [introMessageId, chatId, key],
        );

        console.log(`[report-center] rich intro pinned: ${key} [${threadId}] message=[${introMessageId}]`);
        await sleep(2000);
      } else {
        results.push(`intro=${introMessageId}:rich_v1`);
      }
    }

    console.log(`[report-center] ready: chat=${chatId} topics=${TOPICS.length} created=${createdCount}`);
    for (const row of results) console.log("[report-center]", row);
  } finally {
    await lock.query("SELECT pg_advisory_unlock(hashtext($1))", [`report-center-bootstrap:${chatId}`]).catch(() => {});
    lock.release();
  }
}

try {
  await bootstrap();
} catch (error) {
  console.error("[report-center] bootstrap failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
