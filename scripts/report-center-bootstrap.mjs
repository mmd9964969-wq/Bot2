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

const chatId = String(process.env.REPORT_CENTER_CHAT_ID ?? "").trim();
const token = String(process.env.BOT_TOKEN ?? "").trim();
const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();

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

const pool = new Pool({ connectionString: databaseUrl, max: 2 });

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
      UNIQUE(chat_id, topic_key),
      UNIQUE(chat_id, message_thread_id)
    );

    CREATE INDEX IF NOT EXISTS idx_report_center_topics_chat
      ON report_center_topics(chat_id);
  `);

  const chat = await api("getChat", { chat_id: chatId });
  if (!chat.ok || !chat.result) {
    throw new Error(chat.description || "Telegram getChat failed");
  }
  if (![ "group", "supergroup" ].includes(String(chat.result.type))) {
    throw new Error("Report Center target is not a Telegram group");
  }
  if (chat.result.is_forum !== true) {
    throw new Error("Report Center target is not a Forum/Topics group");
  }

  const me = await api("getMe");
  if (!me.ok || !me.result?.id) {
    throw new Error(me.description || "Telegram getMe failed");
  }

  const botMember = await api("getChatMember", {
    chat_id: chatId,
    user_id: me.result.id,
  });
  if (!botMember.ok || !botMember.result) {
    throw new Error(botMember.description || "Telegram getChatMember failed");
  }

  const status = String(botMember.result.status || "");
  if (![ "administrator", "creator" ].includes(status)) {
    throw new Error("Bot is not an administrator in Report Center");
  }
  if (botMember.result.can_manage_topics !== true && status !== "creator") {
    throw new Error("Bot does not have Manage Topics permission");
  }

  await pool.query(
    `INSERT INTO report_centers(chat_id,title,enabled,last_health_check)
     VALUES($1,$2,TRUE,NOW())
     ON CONFLICT(chat_id) DO UPDATE SET
       title=EXCLUDED.title,
       enabled=TRUE,
       last_health_check=NOW()`,
    [chatId, String(chat.result.title || "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Report Center")],
  );

  const results = [];

  for (const [key, title] of TOPICS) {
    const existing = await pool.query(
      `SELECT message_thread_id
         FROM report_center_topics
        WHERE chat_id=$1 AND topic_key=$2
        LIMIT 1`,
      [chatId, key],
    );

    let threadId = Number(existing.rows[0]?.message_thread_id || 0);
    if (!threadId) {
      const created = await api("createForumTopic", {
        chat_id: chatId,
        name: title,
      });
      if (!created.ok || !created.result?.message_thread_id) {
        throw new Error(`createForumTopic failed for ${title}: ${created.description || "unknown error"}`);
      }
      threadId = Number(created.result.message_thread_id);
      results.push(`+ ${title} [${threadId}]`);
    } else {
      results.push(`= ${title} [${threadId}]`);
    }

    await pool.query(
      `INSERT INTO report_center_topics(chat_id,topic_key,title,message_thread_id,enabled,updated_at)
       VALUES($1,$2,$3,$4,TRUE,NOW())
       ON CONFLICT(chat_id,topic_key) DO UPDATE SET
         title=EXCLUDED.title,
         message_thread_id=EXCLUDED.message_thread_id,
         enabled=TRUE,
         updated_at=NOW()`,
      [chatId, key, title, threadId],
    );
  }

  console.log(`[report-center] ready: chat=${chatId} topics=${TOPICS.length}`);
  for (const row of results) console.log("[report-center]", row);
}

try {
  await bootstrap();
} catch (error) {
  console.error("[report-center] bootstrap failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
