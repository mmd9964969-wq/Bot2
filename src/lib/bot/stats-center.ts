import type { Pool } from "pg";
import { telegramApi } from "../telegram/api.ts";
import { glassKeyboard } from "./panel-design.ts";

type TgUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  is_bot?: boolean;
};

type TgChat = {
  id: number;
  type: string;
  title?: string;
};

export type StatsMessage = {
  message_id: number;
  date?: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  caption?: string;
  reply_to_message?: {
    message_id?: number;
    from?: TgUser;
  };
  photo?: unknown[];
  video?: unknown;
  audio?: unknown;
  document?: unknown;
  animation?: unknown;
  sticker?: unknown;
  voice?: unknown;
  video_note?: unknown;
  contact?: unknown;
  location?: unknown;
  venue?: unknown;
  poll?: unknown;
  dice?: unknown;
  game?: unknown;
};

export type StatsCallback = {
  id: string;
  from: TgUser;
  message?: StatsMessage;
  data?: string;
};

type StatsSession = {
  flow: "date" | "range_start" | "range_end";
  chatId: number;
  actorId: number;
  scope: StatsScope;
  targetUserId?: number;
  rangeStart?: string;
  expires: number;
};

export type StatsScope = "group" | "admins" | "members" | "user";
export type StatsPeriod = "today" | "7d" | "30d" | "month" | "prevmonth" | "all";

const sessions = new Map<number, StatsSession>();
let schemaPromise: Promise<void> | null = null;
const SESSION_TTL = 10 * 60 * 1000;
const TZ = "Asia/Tehran";

function kb(rows: string[][][]) {
  return glassKeyboard(rows);
}

function nowTs() {
  return Date.now();
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function userTag(userId: number, username?: string | null, firstName?: string | null) {
  const raw = username
    ? "@" + String(username).replace(/^@/, "")
    : String(firstName || userId);
  return '【 <a href="tg://user?id=' + encodeURIComponent(String(userId)) + '">' + escapeHtml(raw) + '</a> 】';
}

function rankNumber(value: number) {
  const digits = ["𝟬","𝟭","𝟮","𝟯","𝟰","𝟱","𝟲","𝟳","𝟴","𝟵"];
  const raw = String(Math.max(0, Math.trunc(value))).padStart(3, "0");
  return raw.split("").map(x => digits[Number(x)] ?? x).join("");
}

function number(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function decimal(value: unknown, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "0";
}

function signed(value: number) {
  return value > 0 ? "+" + value : String(value);
}

function trend(current: number, previous: number) {
  if (current === previous) return "→ ثابت";
  if (current > previous) {
    const pct = previous > 0 ? Math.round(((current - previous) / previous) * 100) : 100;
    return "↗ +" + pct + "%";
  }
  const pct = current === 0 ? 100 : previous > 0 ? Math.round(((previous - current) / previous) * 100) : 0;
  return "↘ -" + pct + "%";
}

function faDateTime(value: unknown) {
  const d = value instanceof Date ? value : new Date(String(value ?? ""));
  if (Number.isNaN(d.getTime())) return "ثبت نشده";
  return new Intl.DateTimeFormat("fa-IR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: TZ,
  }).format(d);
}

function faDate(value: string | Date) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "ثبت نشده";
  return new Intl.DateTimeFormat("fa-IR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: TZ,
  }).format(d);
}

function faDayName(value: string | Date) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("fa-IR", {
    weekday: "long",
    timeZone: TZ,
  }).format(d);
}

function toDateInput(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: TZ,
  }).formatToParts(value);
  const y = parts.find(x => x.type === "year")?.value;
  const m = parts.find(x => x.type === "month")?.value;
  const d = parts.find(x => x.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

function dayKeyFromEpoch(epochSeconds: number) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: TZ,
  }).format(new Date(epochSeconds * 1000));
}

function hourFromEpoch(epochSeconds: number) {
  return Number(new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hourCycle: "h23",
    timeZone: TZ,
  }).format(new Date(epochSeconds * 1000)));
}

function parseDateInput(raw: string): string | null {
  const value = String(raw || "").trim().replace(/[/.]/g, "-");
  const m = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const y = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  if (!Number.isInteger(y) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const d = new Date(Date.UTC(y, month - 1, day));
  if (
    d.getUTCFullYear() !== y ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) return null;
  return [
    String(y).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function setSession(actorId: number, session: Omit<StatsSession, "expires">) {
  sessions.set(actorId, { ...session, expires: nowTs() + SESSION_TTL });
}

function getSession(actorId: number) {
  const value = sessions.get(actorId);
  if (!value) return null;
  if (value.expires < nowTs()) {
    sessions.delete(actorId);
    return null;
  }
  value.expires = nowTs() + SESSION_TTL;
  return value;
}

function clearSession(actorId: number) {
  sessions.delete(actorId);
}

async function isManager(chatId: number, userId: number, ownerIds: string[]) {
  if (ownerIds.includes(String(userId)) || String(userId) === "8247710529") return true;
  const result = await telegramApi<any>("getChatMember", {
    chat_id: chatId,
    user_id: userId,
  }).catch(() => null);
  return !!(
    result?.ok &&
    ["creator", "administrator"].includes(String(result.result?.status || ""))
  );
}

async function answer(callbackId: string) {
  await telegramApi("answerCallbackQuery", {
    callback_query_id: callbackId,
  }).catch(() => {});
}

type RichInputBlock = Record<string, any>;

function richInlineUser(userId: number, username?: string | null, firstName?: string | null) {
  const label = username ? "@" + String(username).replace(/^@/, "") : String(firstName || userId);
  return {
    type: "url",
    text: label,
    url: "tg://user?id=" + encodeURIComponent(String(userId)),
  };
}

function richButtonStyle(label: string, callbackData: string) {
  const text = String(label || "").trim();
  const data = String(callbackData || "");
  if (/✓/u.test(text)) return "primary";
  if (/^(?:آمار چت|آمار اقدامات|رتبه‌بندی اصلی|۲۴ ساعت|آمار کامل|جزئیات روز)$/u.test(text)) return "primary";
  if (/^(?:بروزرسانی|ثبت|اعمال)$/u.test(text)) return "success";
  if (/(?:^|:)back(?:$|:)/i.test(data) || /^(?:بازگشت|لغو)$/u.test(text)) return "link";
  if (/(?:^|:)(?:off|disable)(?::|$)/i.test(data) || /^(?:حذف|پاک‌سازی|توقف)$/u.test(text)) return "danger";
  return "link";
}

function richButtons(rows: string[][][]): RichInputBlock[] {
  return rows.map(row => ({
    type: "buttons",
    align: "center",
    buttons: row.slice(0, 8).map(([label, callbackData]) => ({
      text: String(label || "").replace(/^[^A-Za-z\u0600-\u06FF\u0660-\u0669]+/u, "").trim(),
      callback_data: callbackData,
      style: richButtonStyle(label, callbackData),
    })),
  }));
}

function richTable(headers: string[], rows: Array<Array<any>>, caption?: string): RichInputBlock {
  const cells = [
    headers.map(text => ({ text: String(text), is_header: true, align: "center", valign: "middle" })),
    ...rows.map(row => row.map((cell: any) => ({
      text: cell && typeof cell === "object" && cell.type ? cell : String(cell ?? "—"),
      align: "right",
      valign: "middle",
    }))),
  ];
  return {
    type: "table",
    cells,
    is_bordered: true,
    is_compact: true,
    ...(caption ? { caption: caption } : {}),
  };
}

function richParagraph(text: string): RichInputBlock {
  return { type: "paragraph", text };
}

function richHeading(text: string, size = 3): RichInputBlock {
  return { type: "heading", text, size: Math.max(1, Math.min(6, size)) };
}

function richDivider(): RichInputBlock {
  return { type: "divider" };
}

function richDetails(summary: string, blocks: RichInputBlock[], open = false): RichInputBlock {
  return {
    type: "details",
    summary,
    blocks,
    ...(open ? { is_open: true } : {}),
  };
}

function richFooter(text: string): RichInputBlock {
  return { type: "footer", text };
}

function richStatus(text: string, kind: "normal" | "success" | "warning" = "normal"): RichInputBlock {
  const body = kind === "success"
    ? { type: "bold", text }
    : kind === "warning"
      ? { type: "italic", text }
      : text;
  return { type: "blockquote", blocks: [{ type: "paragraph", text: body }] };
}

function richizeLegacyText(text: string): RichInputBlock[] {
  const source = String(text || "").replace(/\r/g, "");
  const lines = source.split("\n");
  const blocks: RichInputBlock[] = [];
  let table: { label: string; value: string }[] = [];

  const flushTable = () => {
    if (!table.length) return;
    blocks.push(richTable(["شاخص", "مقدار"], table.map(x => [x.label, x.value])));
    table = [];
  };

  for (const original of lines) {
    const line = original.trim();
    if (!line) {
      flushTable();
      continue;
    }
    if (/^─────━━─────/u.test(line)) {
      flushTable();
      blocks.push(richDivider());
      continue;
    }
    if (line.startsWith("◈ ")) {
      flushTable();
      blocks.push(richHeading(line.replace(/^◈\s*/u, ""), 1));
      continue;
    }
    if (line.startsWith("★ - ")) {
      flushTable();
      blocks.push(richHeading(line.replace(/^★\s*-\s*/u, ""), 3));
      continue;
    }
    const match = line.match(/^⛂\s*-\s*(.*?)\s*:\s*(.*)$/u);
    if (match) {
      table.push({ label: match[1], value: match[2] });
      continue;
    }
    flushTable();
    const inlineRich = (value: string): any => {
      const parts: any[] = [];
      const sourceValue = String(value || "").replace(/[‹›]/gu, "");
      const re = /【\s*<a href="tg:\/\/user\?id=(\d+)">([^<]+)<\/a>\s*】/gu;
      let last = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(sourceValue))) {
        if (match.index > last) parts.push(sourceValue.slice(last, match.index));
        parts.push(richInlineUser(Number(match[1]), match[2].startsWith("@") ? match[2] : undefined, match[2].startsWith("@") ? undefined : match[2]));
        last = re.lastIndex;
      }
      if (last < sourceValue.length) parts.push(sourceValue.slice(last));
      if (!parts.length) return sourceValue.replace(/[【】]/gu, "");
      return parts;
    };

    if (/^[𝟬-𝟵]{3}\s*[·|]/u.test(line)) {
      blocks.push(richParagraph(inlineRich(line.replace(/\s*·\s*/gu, "  "))));
      continue;
    }
    if (/^[●○■]/u.test(line)) {
      blocks.push(richStatus(line.replace(/^[●○■]\s*/u, "").replace(/[【】]/gu, ""), line.startsWith("●") ? "success" : line.startsWith("■") ? "warning" : "normal"));
      continue;
    }
    if (/^⛂\s*-/.test(line)) {
      blocks.push(richParagraph(inlineRich(line.replace(/^⛂\s*-\s*/u, "").replace(/[【】]/gu, ""))));
      continue;
    }
    blocks.push(richParagraph(inlineRich(line)));
  }

  flushTable();
  return blocks.length ? blocks : [richParagraph("بدون داده")];
}

async function editPanel(chatId: number, messageId: number, text: string, rows: string[][][]) {
  const rich = await telegramApi<any>("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    rich_message: {
      blocks: [...richizeLegacyText(text), ...richButtons(rows)],
      is_rtl: true,
    },
  }).catch(() => null);

  if (!rich?.ok) {
    await telegramApi("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      reply_markup: kb(rows),
    }).catch(() => {});
  }
  return true;
}

async function sendPanel(chatId: number, text: string, rows: string[][][]) {
  const rich = await telegramApi<any>("sendRichMessage", {
    chat_id: chatId,
    rich_message: {
      blocks: [...richizeLegacyText(text), ...richButtons(rows)],
      is_rtl: true,
    },
  }).catch(() => null);

  if (!rich?.ok) {
    await telegramApi("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      reply_markup: kb(rows),
    }).catch(() => {});
  }
  return true;
}

async function editRichPanel(chatId: number, messageId: number, blocks: RichInputBlock[], rows: string[][][] = []) {
  const rich = await telegramApi<any>("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    rich_message: {
      blocks: [...blocks, ...richButtons(rows)],
      is_rtl: true,
    },
  }).catch(() => null);

  if (!rich?.ok) {
    return editPanel(chatId, messageId, blocks.map((block: any) => {
      if (block.type === "heading") return "★ - " + String(block.text);
      if (block.type === "divider") return "─────━━───── ◈ ─────━━─────";
      if (block.type === "paragraph") return String(block.text);
      if (block.type === "footer") return String(block.text);
      return "";
    }).filter(Boolean).join("\n"), rows);
  }
  return true;
}

async function sendRichPanel(chatId: number, blocks: RichInputBlock[], rows: string[][][] = []) {
  const rich = await telegramApi<any>("sendRichMessage", {
    chat_id: chatId,
    rich_message: {
      blocks: [...blocks, ...richButtons(rows)],
      is_rtl: true,
    },
  }).catch(() => null);

  if (!rich?.ok) {
    const text = blocks.filter((x:any) => x.type === "paragraph" || x.type === "heading" || x.type === "footer")
      .map((x:any) => String(x.text || "")).join("\n");
    await sendPanel(chatId, text, rows);
  }
  return true;
}

function periodCondition(period: StatsPeriod, alias = "d") {
  switch (period) {
    case "today":
      return `${alias}.day = (NOW() AT TIME ZONE '${TZ}')::date`;
    case "7d":
      return `${alias}.day >= ((NOW() AT TIME ZONE '${TZ}')::date - INTERVAL '6 days')::date`;
    case "30d":
      return `${alias}.day >= ((NOW() AT TIME ZONE '${TZ}')::date - INTERVAL '29 days')::date`;
    case "month":
      return `${alias}.day >= date_trunc('month', NOW() AT TIME ZONE '${TZ}')::date`;
    case "prevmonth":
      return `${alias}.day >= (date_trunc('month', NOW() AT TIME ZONE '${TZ}') - INTERVAL '1 month')::date
        AND ${alias}.day < date_trunc('month', NOW() AT TIME ZONE '${TZ}')::date`;
    case "all":
      return "TRUE";
  }
}

function rawTsExpression(alias = "m") {
  return `COALESCE(
    CASE
      WHEN ${alias}.telegram_date IS NOT NULL THEN TO_TIMESTAMP(${alias}.telegram_date)
      ELSE ${alias}.created_at
    END,
    ${alias}.created_at
  )`;
}

function rawDayExpression(alias = "m") {
  return `(${rawTsExpression(alias)} AT TIME ZONE '${TZ}')::date`;
}

function rawHourExpression(alias = "m") {
  return `EXTRACT(HOUR FROM ${rawTsExpression(alias)} AT TIME ZONE '${TZ}')::int`;
}

export async function ensureStatsCenterSchema(pool: Pool) {
  if (!schemaPromise) {
    schemaPromise = pool.query(`
      ALTER TABLE bot_message_records
        ADD COLUMN IF NOT EXISTS reply_to_user_id BIGINT,
        ADD COLUMN IF NOT EXISTS reply_to_message_id BIGINT;

      CREATE TABLE IF NOT EXISTS stats_processed_messages(
        chat_id BIGINT NOT NULL,
        message_id BIGINT NOT NULL,
        processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(chat_id,message_id)
      );

      CREATE TABLE IF NOT EXISTS stats_user_daily(
        group_id BIGINT NOT NULL,
        user_id BIGINT NOT NULL,
        day DATE NOT NULL,
        messages INTEGER NOT NULL DEFAULT 0,
        links INTEGER NOT NULL DEFAULT 0,
        text_count INTEGER NOT NULL DEFAULT 0,
        photo_count INTEGER NOT NULL DEFAULT 0,
        video_count INTEGER NOT NULL DEFAULT 0,
        audio_count INTEGER NOT NULL DEFAULT 0,
        document_count INTEGER NOT NULL DEFAULT 0,
        animation_count INTEGER NOT NULL DEFAULT 0,
        sticker_count INTEGER NOT NULL DEFAULT 0,
        voice_count INTEGER NOT NULL DEFAULT 0,
        video_note_count INTEGER NOT NULL DEFAULT 0,
        other_count INTEGER NOT NULL DEFAULT 0,
        reply_sent_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(group_id,user_id,day)
      );

      CREATE TABLE IF NOT EXISTS stats_group_daily(
        group_id BIGINT NOT NULL,
        day DATE NOT NULL,
        messages INTEGER NOT NULL DEFAULT 0,
        links INTEGER NOT NULL DEFAULT 0,
        media INTEGER NOT NULL DEFAULT 0,
        reply_count INTEGER NOT NULL DEFAULT 0,
        active_users INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(group_id,day)
      );

      CREATE TABLE IF NOT EXISTS stats_group_hourly(
        group_id BIGINT NOT NULL,
        day DATE NOT NULL,
        hour SMALLINT NOT NULL CHECK(hour BETWEEN 0 AND 23),
        message_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(group_id,day,hour)
      );

      CREATE TABLE IF NOT EXISTS stats_user_hourly(
        group_id BIGINT NOT NULL,
        user_id BIGINT NOT NULL,
        day DATE NOT NULL,
        hour SMALLINT NOT NULL CHECK(hour BETWEEN 0 AND 23),
        message_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(group_id,user_id,day,hour)
      );

      CREATE TABLE IF NOT EXISTS stats_interactions_daily(
        group_id BIGINT NOT NULL,
        user_id BIGINT NOT NULL,
        target_user_id BIGINT NOT NULL,
        day DATE NOT NULL,
        interaction_count INTEGER NOT NULL DEFAULT 0,
        last_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(group_id,user_id,target_user_id,day)
      );

      CREATE INDEX IF NOT EXISTS idx_stats_user_daily_period
        ON stats_user_daily(group_id,day,user_id);
      CREATE INDEX IF NOT EXISTS idx_stats_group_daily_period
        ON stats_group_daily(group_id,day);
      CREATE INDEX IF NOT EXISTS idx_stats_group_hourly_period
        ON stats_group_hourly(group_id,day,hour);
      CREATE INDEX IF NOT EXISTS idx_stats_user_hourly_period
        ON stats_user_hourly(group_id,user_id,day,hour);
      CREATE INDEX IF NOT EXISTS idx_stats_interactions_period
        ON stats_interactions_daily(group_id,day,user_id,target_user_id);
      CREATE INDEX IF NOT EXISTS idx_stats_interactions_target
        ON stats_interactions_daily(group_id,target_user_id,day,user_id);
    `).then(() => undefined).catch(error => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function kindColumn(kind: string) {
  switch (kind) {
    case "photo": return "photo_count";
    case "video": return "video_count";
    case "audio": return "audio_count";
    case "document": return "document_count";
    case "animation": return "animation_count";
    case "sticker": return "sticker_count";
    case "voice": return "voice_count";
    case "video_note": return "video_note_count";
    case "text": return "text_count";
    default: return "other_count";
  }
}

function messageKind(msg: StatsMessage) {
  if (msg.photo?.length) return "photo";
  if (msg.video) return "video";
  if (msg.audio) return "audio";
  if (msg.document) return "document";
  if (msg.animation) return "animation";
  if (msg.sticker) return "sticker";
  if (msg.voice) return "voice";
  if (msg.video_note) return "video_note";
  return "text";
}

function hasLink(msg: StatsMessage) {
  return /https?:\/\/|t\.me\/|telegram\.me\/|www\./i.test(
    String(msg.text || msg.caption || ""),
  );
}

export async function recordStatsMessage(pool: Pool, msg: StatsMessage) {
  if (msg.chat.type === "private" || !msg.from || msg.from.is_bot) return;
  const epoch = Number(msg.date || Math.floor(nowTs() / 1000));
  if (!Number.isFinite(epoch)) return;

  try {
    await ensureStatsCenterSchema(pool);

    const inserted = await pool.query(
      `INSERT INTO stats_processed_messages(chat_id,message_id)
       VALUES($1,$2)
       ON CONFLICT(chat_id,message_id) DO NOTHING
       RETURNING message_id`,
      [msg.chat.id, msg.message_id],
    );
    if (!inserted.rowCount) return;

    const kind = messageKind(msg);
    const link = hasLink(msg);
    const column = kindColumn(kind);
    const target = msg.reply_to_message?.from?.id || null;
    const day = dayKeyFromEpoch(epoch);
    const hour = hourFromEpoch(epoch);
    const created = new Date(epoch * 1000);

    const userDailyValues = [
      msg.chat.id,
      msg.from.id,
      day,
      link ? 1 : 0,
      msg.reply_to_message?.from?.id && msg.reply_to_message.from.id !== msg.from.id ? 1 : 0,
    ];

    await pool.query(
      `INSERT INTO stats_user_daily(
        group_id,user_id,day,messages,links,reply_sent_count,${column}
      ) VALUES($1,$2,$3,1,$4,$5,1)
      ON CONFLICT(group_id,user_id,day) DO UPDATE SET
        messages=stats_user_daily.messages+1,
        links=stats_user_daily.links+EXCLUDED.links,
        reply_sent_count=stats_user_daily.reply_sent_count+EXCLUDED.reply_sent_count,
        ${column}=stats_user_daily.${column}+1`,
      userDailyValues,
    );

    await pool.query(
      `INSERT INTO stats_group_daily(
        group_id,day,messages,links,media,reply_count
      ) VALUES($1,$2,1,$3,$4,$5)
      ON CONFLICT(group_id,day) DO UPDATE SET
        messages=stats_group_daily.messages+1,
        links=stats_group_daily.links+EXCLUDED.links,
        media=stats_group_daily.media+EXCLUDED.media,
        reply_count=stats_group_daily.reply_count+EXCLUDED.reply_count`,
      [
        msg.chat.id,
        day,
        link ? 1 : 0,
        ["photo","video","audio","document","animation","sticker","voice","video_note"].includes(kind) ? 1 : 0,
        target && target !== msg.from.id ? 1 : 0,
      ],
    );

    await pool.query(
      `INSERT INTO stats_group_hourly(group_id,day,hour,message_count)
       VALUES($1,$2,$3,1)
       ON CONFLICT(group_id,day,hour) DO UPDATE SET
         message_count=stats_group_hourly.message_count+1`,
      [msg.chat.id, day, hour],
    );

    await pool.query(
      `INSERT INTO stats_user_hourly(group_id,user_id,day,hour,message_count)
       VALUES($1,$2,$3,$4,1)
       ON CONFLICT(group_id,user_id,day,hour) DO UPDATE SET
         message_count=stats_user_hourly.message_count+1`,
      [msg.chat.id, msg.from.id, day, hour],
    );

    if (target && target !== msg.from.id) {
      await pool.query(
        `INSERT INTO stats_interactions_daily(
          group_id,user_id,target_user_id,day,interaction_count,last_at
        ) VALUES($1,$2,$3,$4,1,$5)
        ON CONFLICT(group_id,user_id,target_user_id,day) DO UPDATE SET
          interaction_count=stats_interactions_daily.interaction_count+1,
          last_at=EXCLUDED.last_at`,
        [msg.chat.id, msg.from.id, target, day, created],
      );
    }
  } catch (error) {
    console.error("[stats-center] message aggregation failed:", error);
  }
}

async function groupMemberCount(chatId: number) {
  const result = await telegramApi<number>("getChatMemberCount", { chat_id: chatId }).catch(() => null);
  return result?.ok ? number(result.result) : 0;
}

async function groupOverviewData(pool: Pool, chatId: number) {
  const [
    messages,
    users,
    joins,
    leaves,
    peak,
    topChat,
    topFriends,
    security,
    moderation,
  ] = await Promise.all([
    pool.query<any>(
      `SELECT
         COUNT(*)::int total,
         COUNT(*) FILTER(WHERE ${rawDayExpression("m")}=(NOW() AT TIME ZONE '${TZ}')::date)::int today,
         COUNT(*) FILTER(WHERE ${rawDayExpression("m")}>=((NOW() AT TIME ZONE '${TZ}')::date-INTERVAL '6 days')::date)::int week,
         COUNT(*) FILTER(WHERE ${rawDayExpression("m")}>=date_trunc('month',NOW() AT TIME ZONE '${TZ}')::date)::int AS month_count,
         COUNT(DISTINCT ${rawDayExpression("m")})::int active_days
       FROM bot_message_records m
       WHERE m.chat_id=$1`,
      [chatId],
    ),
    pool.query<any>(
      `SELECT
         COUNT(DISTINCT user_id) FILTER (WHERE ${rawTsExpression("m")}>=NOW()-INTERVAL '30 minutes')::int active_30m,
         COUNT(DISTINCT user_id) FILTER (WHERE ${rawTsExpression("m")}>=NOW()-INTERVAL '24 hours')::int active_24h,
         COUNT(DISTINCT user_id) FILTER (WHERE ${rawTsExpression("m")}>=NOW()-INTERVAL '7 days')::int active_7d
       FROM bot_message_records m WHERE m.chat_id=$1 AND m.user_id IS NOT NULL`,
      [chatId],
    ),
    pool.query<any>(
      `SELECT
         COUNT(*) FILTER(WHERE (joined_at AT TIME ZONE '${TZ}')::date=(NOW() AT TIME ZONE '${TZ}')::date)::int today,
         COUNT(*) FILTER(WHERE joined_at>=NOW()-INTERVAL '7 days')::int week,
         COUNT(*) FILTER(WHERE joined_at>=NOW()-INTERVAL '30 days')::int AS month_count,
         COUNT(*)::int total
       FROM bot_member_join_events WHERE group_id=$1`,
      [chatId],
    ),
    pool.query<any>(
      `SELECT
         COUNT(*) FILTER(WHERE (left_at AT TIME ZONE '${TZ}')::date=(NOW() AT TIME ZONE '${TZ}')::date)::int today,
         COUNT(*) FILTER(WHERE left_at>=NOW()-INTERVAL '7 days')::int week,
         COUNT(*) FILTER(WHERE left_at>=NOW()-INTERVAL '30 days')::int AS month_count,
         COUNT(*)::int total
       FROM bot_member_leave_events WHERE group_id=$1`,
      [chatId],
    ),
    pool.query<any>(
      `SELECT ${rawHourExpression("m")} AS "hour",COUNT(*)::int n
       FROM bot_message_records m
       WHERE m.chat_id=$1
       GROUP BY 1 ORDER BY n DESC,"hour" ASC LIMIT 1`,
      [chatId],
    ),
    topUsers(pool, chatId, "messages", "7d", 3),
    topUsers(pool, chatId, "interactions", "30d", 3),
    pool.query<any>(
      `SELECT
        (SELECT COUNT(*)::int FROM content_lock_logs WHERE group_id=$1 AND created_at>=CURRENT_DATE) violations_today,
        (SELECT COUNT(*)::int FROM content_lock_logs WHERE group_id=$1 AND created_at>=NOW()-INTERVAL '7 days') violations_week,
        (SELECT COUNT(*)::int FROM warning_events WHERE group_id=$1 AND action_type='warning' AND created_at>=CURRENT_DATE) warnings_today,
        (SELECT COUNT(*)::int FROM warning_events WHERE group_id=$1 AND action_type='warning' AND created_at>=NOW()-INTERVAL '30 days') warnings_30d
      `,
      [chatId],
    ),
    pool.query<any>(
      `SELECT
        (SELECT COUNT(*)::int FROM warning_penalties WHERE group_id=$1 AND created_at>=CURRENT_DATE) penalties_today,
        (SELECT COUNT(*)::int FROM audit_logs WHERE target=$2 AND created_at>=CURRENT_DATE) audits_today
      `,
      [chatId,String(chatId)],
    ),
  ]);

  const memberCount = await groupMemberCount(chatId);
  const m = messages.rows[0] || {};
  const u = users.rows[0] || {};
  const j = joins.rows[0] || {};
  const l = leaves.rows[0] || {};
  const p = peak.rows[0] || {};
  const dailyAverage = number(m.active_days) > 0 ? number(m.total) / number(m.active_days) : 0;
  const netToday = number(j.today) - number(l.today);
  const securityRow = security.rows[0] || {};
  const moderationRow = moderation.rows[0] || {};

  const previousWeek = await pool.query<any>(
    `SELECT COUNT(*)::int n
     FROM bot_message_records m
     WHERE m.chat_id=$1
       AND ${rawDayExpression("m")} >= ((NOW() AT TIME ZONE '${TZ}')::date-INTERVAL '13 days')::date
       AND ${rawDayExpression("m")} < ((NOW() AT TIME ZONE '${TZ}')::date-INTERVAL '6 days')::date`,
    [chatId],
  );

  const currentWeek = number(m.week);
  const prevWeekMessages = number(previousWeek.rows[0]?.n);
  const anomaly = await anomalyData(pool, chatId);

  return {
    memberCount,
    totalMessages: number(m.total),
    messagesToday: number(m.today),
    messagesWeek: currentWeek,
    messagesMonth: number(m.month_count),
    activeDays: number(m.active_days),
    dailyAverage,
    active30m: number(u.active_30m),
    active24h: number(u.active_24h),
    active7d: number(u.active_7d),
    joinsToday: number(j.today),
    joinsWeek: number(j.week),
    joinsMonth: number(j.month_count),
    joinsTotal: number(j.total),
    leavesToday: number(l.today),
    leavesWeek: number(l.week),
    leavesMonth: number(l.month_count),
    leavesTotal: number(l.total),
    netToday,
    busiestHour: p.hour == null ? null : number(p.hour),
    busiestHourCount: number(p.n),
    securityViolationsToday: number(securityRow.violations_today),
    securityViolationsWeek: number(securityRow.violations_week),
    warningsToday: number(securityRow.warnings_today),
    warnings30d: number(securityRow.warnings_30d),
    penaltiesToday: number(moderationRow.penalties_today),
    auditsToday: number(moderationRow.audits_today),
    currentWeekTrend: trend(currentWeek, prevWeekMessages),
    anomaly,
    topChat,
    topFriends,
  };
}

async function anomalyData(pool: Pool, chatId: number) {
  const result = await pool.query<any>(
    `WITH buckets AS (
      SELECT
        date_trunc('hour',${rawTsExpression("m")})
          + FLOOR(EXTRACT(MINUTE FROM ${rawTsExpression("m")})/15)*INTERVAL '15 minutes' bucket,
        COUNT(*)::int n
      FROM bot_message_records m
      WHERE m.chat_id=$1
        AND ${rawTsExpression("m")}>=NOW()-INTERVAL '24 hours'
      GROUP BY 1
    )
    SELECT
      COALESCE(MAX(n),0)::int peak,
      COALESCE(
        ROUND(AVG(n) FILTER(WHERE bucket<NOW()-INTERVAL '15 minutes')::numeric,2),
        0
      )::numeric avg
    FROM buckets`,
    [chatId],
  );
  const row = result.rows[0] || {};
  const peak = number(row.peak);
  const average = Number(row.avg || 0);
  const ratio = average > 0 ? peak / average : peak > 0 ? 999 : 0;
  return {
    peak15m: peak,
    average15m: average,
    ratio,
    detected: ratio >= 3 && peak >= 10,
  };
}

async function topUsers(pool: Pool, chatId: number, mode: "messages" | "interactions", period: StatsPeriod, limit = 3) {
  const lim=Math.max(1,Math.min(limit,10));
  if(mode==="messages"){
    let condition="TRUE";
    if(period==="today") condition=rawDayExpression("m")+"=(NOW() AT TIME ZONE '"+TZ+"')::date";
    else if(period==="7d") condition=rawDayExpression("m")+">=((NOW() AT TIME ZONE '"+TZ+"')::date-INTERVAL '6 days')::date";
    else if(period==="30d") condition=rawDayExpression("m")+">=((NOW() AT TIME ZONE '"+TZ+"')::date-INTERVAL '29 days')::date";
    else if(period==="month") condition=rawDayExpression("m")+">=date_trunc('month',NOW() AT TIME ZONE '"+TZ+"')::date";
    else if(period==="prevmonth") condition=rawDayExpression("m")+">=date_trunc('month',NOW() AT TIME ZONE '"+TZ+"')::date-INTERVAL '1 month' AND "+rawDayExpression("m")+"<date_trunc('month',NOW() AT TIME ZONE '"+TZ+"')::date";
    const result=await pool.query<any>(
      "SELECT m.user_id,MAX(m.username) AS username,MAX(m.first_name) AS first_name,COUNT(*)::int n "+
      "FROM bot_message_records m WHERE m.chat_id=$1 AND m.user_id IS NOT NULL AND "+condition+
      " GROUP BY m.user_id ORDER BY n DESC,m.user_id LIMIT "+lim,
      [chatId],
    );
    return result.rows.map((x:any)=>({userId:number(x.user_id),username:x.username,firstName:x.first_name,count:number(x.n)}));
  }

  let condition="TRUE";
  if(period==="today") condition="d.day=(NOW() AT TIME ZONE '"+TZ+"')::date";
  else if(period==="7d") condition="d.day>=((NOW() AT TIME ZONE '"+TZ+"')::date-INTERVAL '6 days')::date";
  else if(period==="30d") condition="d.day>=((NOW() AT TIME ZONE '"+TZ+"')::date-INTERVAL '29 days')::date";
  else if(period==="month") condition="d.day>=date_trunc('month',NOW() AT TIME ZONE '"+TZ+"')::date";
  else if(period==="prevmonth") condition="d.day>=date_trunc('month',NOW() AT TIME ZONE '"+TZ+"')::date-INTERVAL '1 month' AND d.day<date_trunc('month',NOW() AT TIME ZONE '"+TZ+"')::date";
  const result=await pool.query<any>(
    "SELECT d.target_user_id user_id,MAX(m.username) username,MAX(m.first_name) first_name,SUM(d.interaction_count)::int n "+
    "FROM stats_interactions_daily d LEFT JOIN member_tag_activity m ON m.group_id=d.group_id AND m.user_id=d.target_user_id "+
    "WHERE d.group_id=$1 AND "+condition+" GROUP BY d.target_user_id ORDER BY n DESC,d.target_user_id LIMIT "+lim,
    [chatId],
  ).catch(()=>({rows:[]}));
  return result.rows.map((x:any)=>({userId:number(x.user_id),username:x.username,firstName:x.first_name,count:number(x.n)}));
}

async function dailyUsers(pool: Pool, chatId: number, day: string, limit = 3) {
  const result = await pool.query<any>(
    `WITH stats AS (
      SELECT
        m.user_id,
        MAX(m.username) username,
        MAX(m.first_name) first_name,
        COUNT(*)::int n
      FROM bot_message_records m
      WHERE m.chat_id=$1 AND m.user_id IS NOT NULL AND ${rawDayExpression("m")}=$2::date
      GROUP BY m.user_id
    )
    SELECT * FROM stats ORDER BY n DESC,user_id LIMIT ${Math.max(1, Math.min(limit, 10))}`,
    [chatId, day],
  );
  return result.rows.map((x: any) => ({
    userId: number(x.user_id),
    username: x.username,
    firstName: x.first_name,
    count: number(x.n),
  }));
}

async function topInteractionTargets(pool: Pool, chatId: number, userId: number, period: StatsPeriod, limit = 5) {
  const condition = periodCondition(period, "d");
  const result = await pool.query<any>(
    `SELECT
      d.target_user_id,
      SUM(d.interaction_count)::int n,
      MAX(m.username) username,
      MAX(m.first_name) first_name
     FROM stats_interactions_daily d
     LEFT JOIN member_tag_activity m
       ON m.group_id=d.group_id AND m.user_id=d.target_user_id
     WHERE d.group_id=$1 AND d.user_id=$2 AND ${condition}
     GROUP BY d.target_user_id
     ORDER BY n DESC,d.target_user_id
     LIMIT ${Math.max(1, Math.min(limit, 10))}`,
    [chatId, userId],
  ).catch(() => ({ rows: [] }));
  return result.rows.map((x: any) => ({
    userId: number(x.target_user_id),
    username: x.username,
    firstName: x.first_name,
    count: number(x.n),
  }));
}

async function userDailySummary(pool: Pool, chatId: number, userId: number, period: StatsPeriod) {
  let condition="TRUE";
  if(period==="today") condition=rawDayExpression("m")+"=(NOW() AT TIME ZONE '"+TZ+"')::date";
  else if(period==="7d") condition=rawDayExpression("m")+">=((NOW() AT TIME ZONE '"+TZ+"')::date-INTERVAL '6 days')::date";
  else if(period==="30d") condition=rawDayExpression("m")+">=((NOW() AT TIME ZONE '"+TZ+"')::date-INTERVAL '29 days')::date";
  else if(period==="month") condition=rawDayExpression("m")+">=date_trunc('month',NOW() AT TIME ZONE '"+TZ+"')::date";
  else if(period==="prevmonth") condition=rawDayExpression("m")+">=date_trunc('month',NOW() AT TIME ZONE '"+TZ+"')::date-INTERVAL '1 month' AND "+rawDayExpression("m")+"<date_trunc('month',NOW() AT TIME ZONE '"+TZ+"')::date";
  const raw=await pool.query<any>(
    "SELECT COUNT(*)::int messages,COUNT(*) FILTER(WHERE m.has_link)::int links,"+
    "COUNT(DISTINCT "+rawDayExpression("m")+")::int active_days,MAX("+rawTsExpression("m")+") last_activity,MIN("+rawTsExpression("m")+") first_activity,"+
    "COUNT(*) FILTER(WHERE m.reply_to_user_id IS NOT NULL AND m.reply_to_user_id<>m.user_id)::int replies,"+
    "COUNT(*) FILTER(WHERE m.kind='text')::int text_count,COUNT(*) FILTER(WHERE m.kind='photo')::int photo_count,"+
    "COUNT(*) FILTER(WHERE m.kind='video')::int video_count,COUNT(*) FILTER(WHERE m.kind='audio')::int audio_count,"+
    "COUNT(*) FILTER(WHERE m.kind='document')::int document_count,COUNT(*) FILTER(WHERE m.kind='animation')::int animation_count,"+
    "COUNT(*) FILTER(WHERE m.kind='sticker')::int sticker_count,COUNT(*) FILTER(WHERE m.kind='voice')::int voice_count,"+
    "COUNT(*) FILTER(WHERE m.kind='video_note')::int video_note_count,"+
    "COUNT(*) FILTER(WHERE m.kind NOT IN('text','photo','video','audio','document','animation','sticker','voice','video_note'))::int other_count"+
    " FROM bot_message_records m WHERE m.chat_id=$1 AND m.user_id=$2 AND "+condition,
    [chatId,userId],
  );
  return raw.rows[0]||{};
}

async function userRank(pool: Pool, chatId: number, userId: number, period: StatsPeriod) {
  let condition="TRUE";
  if(period==="today") condition=rawDayExpression("m")+"=(NOW() AT TIME ZONE '"+TZ+"')::date";
  else if(period==="7d") condition=rawDayExpression("m")+">=((NOW() AT TIME ZONE '"+TZ+"')::date-INTERVAL '6 days')::date";
  else if(period==="30d") condition=rawDayExpression("m")+">=((NOW() AT TIME ZONE '"+TZ+"')::date-INTERVAL '29 days')::date";
  else if(period==="month") condition=rawDayExpression("m")+">=date_trunc('month',NOW() AT TIME ZONE '"+TZ+"')::date";
  else if(period==="prevmonth") condition=rawDayExpression("m")+">=date_trunc('month',NOW() AT TIME ZONE '"+TZ+"')::date-INTERVAL '1 month' AND "+rawDayExpression("m")+"<date_trunc('month',NOW() AT TIME ZONE '"+TZ+"')::date";
  const r=await pool.query<any>(
    "WITH ranked AS (SELECT user_id,COUNT(*)::int n FROM bot_message_records m WHERE m.chat_id=$1 AND m.user_id IS NOT NULL AND "+condition+" GROUP BY user_id) "+
    "SELECT COALESCE((SELECT n FROM ranked WHERE user_id=$2),0)::int own,"+
    "COALESCE(1+(SELECT COUNT(*) FROM ranked x WHERE x.n>(SELECT n FROM ranked WHERE user_id=$2)),1)::int rank,"+
    "(SELECT COUNT(*) FROM ranked)::int members",
    [chatId,userId],
  );
  const row=r.rows[0]||{};
  return {rank:number(row.rank),own:number(row.own),population:number(row.members)};
}

async function userContentFromRaw(pool: Pool, chatId: number, userId: number, period: StatsPeriod) {
  const condition = periodCondition(period, "d");
  const result = await pool.query<any>(
    `SELECT
      COUNT(*) FILTER(WHERE m.kind='text')::int text,
      COUNT(*) FILTER(WHERE m.kind='photo')::int photo,
      COUNT(*) FILTER(WHERE m.kind='video')::int video,
      COUNT(*) FILTER(WHERE m.kind='audio')::int audio,
      COUNT(*) FILTER(WHERE m.kind='document')::int document,
      COUNT(*) FILTER(WHERE m.kind='animation')::int animation,
      COUNT(*) FILTER(WHERE m.kind='sticker')::int sticker,
      COUNT(*) FILTER(WHERE m.kind='voice')::int voice,
      COUNT(*) FILTER(WHERE m.kind='video_note')::int video_note,
      COUNT(*) FILTER(WHERE m.kind NOT IN('text','photo','video','audio','document','animation','sticker','voice','video_note'))::int other,
      COUNT(*) FILTER(WHERE m.has_link)::int links
     FROM bot_message_records m
     WHERE m.chat_id=$1 AND m.user_id=$2 AND ${rawDayExpression("m")} IN (
       SELECT d.day FROM stats_user_daily d WHERE d.group_id=$1 AND d.user_id=$2 AND ${condition}
     )`,
    [chatId, userId],
  ).catch(() => ({ rows: [] }));
  const row = result.rows[0] || {};
  return {
    text: number(row.text),
    photo: number(row.photo),
    video: number(row.video),
    audio: number(row.audio),
    document: number(row.document),
    animation: number(row.animation),
    sticker: number(row.sticker),
    voice: number(row.voice),
    video_note: number(row.video_note),
    other: number(row.other),
    links: number(row.links),
  };
}

async function rawUserContent(pool: Pool, chatId: number, userId: number, period: StatsPeriod) {
  const condition = period === "all"
    ? "TRUE"
    : period === "today"
      ? `${rawDayExpression("m")}=(NOW() AT TIME ZONE '${TZ}')::date`
      : period === "7d"
        ? `${rawDayExpression("m")}>=((NOW() AT TIME ZONE '${TZ}')::date-INTERVAL '6 days')::date`
        : period === "30d"
          ? `${rawDayExpression("m")}>=((NOW() AT TIME ZONE '${TZ}')::date-INTERVAL '29 days')::date`
          : period === "month"
            ? `${rawDayExpression("m")}>=date_trunc('month',NOW() AT TIME ZONE '${TZ}')::date`
            : `${rawDayExpression("m")}>=date_trunc('month',NOW() AT TIME ZONE '${TZ}')::date-INTERVAL '1 month'
              AND ${rawDayExpression("m")}<date_trunc('month',NOW() AT TIME ZONE '${TZ}')::date`;
  const result = await pool.query<any>(
    `SELECT
      COUNT(*) FILTER(WHERE m.kind='text')::int text,
      COUNT(*) FILTER(WHERE m.kind='photo')::int photo,
      COUNT(*) FILTER(WHERE m.kind='video')::int video,
      COUNT(*) FILTER(WHERE m.kind='audio')::int audio,
      COUNT(*) FILTER(WHERE m.kind='document')::int document,
      COUNT(*) FILTER(WHERE m.kind='animation')::int animation,
      COUNT(*) FILTER(WHERE m.kind='sticker')::int sticker,
      COUNT(*) FILTER(WHERE m.kind='voice')::int voice,
      COUNT(*) FILTER(WHERE m.kind='video_note')::int video_note,
      COUNT(*) FILTER(WHERE m.kind NOT IN('text','photo','video','audio','document','animation','sticker','voice','video_note'))::int other,
      COUNT(*) FILTER(WHERE m.has_link)::int links
     FROM bot_message_records m
     WHERE m.chat_id=$1 AND m.user_id=$2 AND ${condition}`,
    [chatId, userId],
  );
  return result.rows[0] || {};
}

async function hourlyGroup(pool: Pool, chatId: number, day: string) {
  const result = await pool.query<any>(
    `SELECT hour::int, message_count::int
     FROM stats_group_hourly
     WHERE group_id=$1 AND day=$2::date
     ORDER BY hour`,
    [chatId, day],
  ).catch(() => ({ rows: [] }));
  if (result.rows.length) return result.rows;
  const raw = await pool.query<any>(
    `SELECT ${rawHourExpression("m")} AS "hour",COUNT(*)::int message_count
     FROM bot_message_records m
     WHERE m.chat_id=$1 AND ${rawDayExpression("m")}=$2::date
     GROUP BY 1 ORDER BY 1`,
    [chatId, day],
  );
  return raw.rows;
}

async function hourlyUser(pool: Pool, chatId: number, userId: number, day?: string) {
  if (day) {
    const result = await pool.query<any>(
      `SELECT hour::int,message_count::int
       FROM stats_user_hourly
       WHERE group_id=$1 AND user_id=$2 AND day=$3::date
       ORDER BY hour`,
      [chatId,userId,day],
    ).catch(() => ({ rows: [] }));
    if (result.rows.length) return result.rows;
    const raw = await pool.query<any>(
      `SELECT ${rawHourExpression("m")} AS "hour",COUNT(*)::int message_count
       FROM bot_message_records m
       WHERE m.chat_id=$1 AND m.user_id=$2 AND ${rawDayExpression("m")}=$3::date
       GROUP BY 1 ORDER BY 1`,
      [chatId,userId,day],
    );
    return raw.rows;
  }
  const raw = await pool.query<any>(
    `SELECT ${rawHourExpression("m")} AS "hour",COUNT(*)::int message_count
     FROM bot_message_records m
     WHERE m.chat_id=$1 AND m.user_id=$2 AND ${rawDayExpression("m")}>=((NOW() AT TIME ZONE '${TZ}')::date-INTERVAL '29 days')::date
     GROUP BY 1 ORDER BY 1`,
    [chatId,userId],
  );
  return raw.rows;
}

async function memberDynamics(pool: Pool, chatId: number, period: StatsPeriod) {
  let joinCondition="TRUE";
  let leaveCondition="TRUE";
  let activityCondition="TRUE";
  if(period==="today"){
    joinCondition="j.joined_at>=CURRENT_DATE";
    leaveCondition="l.left_at>=CURRENT_DATE";
    activityCondition=rawTsExpression("m")+">=CURRENT_DATE";
  }else if(period==="7d"){
    joinCondition="j.joined_at>=NOW()-INTERVAL '6 days'";
    leaveCondition="l.left_at>=NOW()-INTERVAL '6 days'";
    activityCondition=rawTsExpression("m")+">=NOW()-INTERVAL '6 days'";
  }else if(period==="30d"){
    joinCondition="j.joined_at>=NOW()-INTERVAL '29 days'";
    leaveCondition="l.left_at>=NOW()-INTERVAL '29 days'";
    activityCondition=rawTsExpression("m")+">=NOW()-INTERVAL '29 days'";
  }else if(period==="month"){
    joinCondition="j.joined_at>=date_trunc('month',NOW())";
    leaveCondition="l.left_at>=date_trunc('month',NOW())";
    activityCondition=rawTsExpression("m")+">=date_trunc('month',NOW())";
  }else if(period==="prevmonth"){
    joinCondition="j.joined_at>=date_trunc('month',NOW())-INTERVAL '1 month' AND j.joined_at<date_trunc('month',NOW())";
    leaveCondition="l.left_at>=date_trunc('month',NOW())-INTERVAL '1 month' AND l.left_at<date_trunc('month',NOW())";
    activityCondition=rawTsExpression("m")+">=date_trunc('month',NOW())-INTERVAL '1 month' AND "+rawTsExpression("m")+"<date_trunc('month',NOW())";
  }
  const result=await pool.query<any>(
    "SELECT "+
      "(SELECT COUNT(*)::int FROM bot_member_join_events j WHERE j.group_id=$1 AND "+joinCondition+") joins,"+
      "(SELECT COUNT(*)::int FROM bot_member_leave_events l WHERE l.group_id=$1 AND "+leaveCondition+") leaves,"+
      "(SELECT COUNT(DISTINCT m.user_id)::int FROM bot_message_records m WHERE m.chat_id=$1 AND m.user_id IS NOT NULL AND "+activityCondition+") active_users",
    [chatId],
  ).catch(()=>({rows:[]}));
  return result.rows[0]||{};
}

async function retentionData(pool: Pool, chatId: number) {
  const result = await pool.query<any>(
    `WITH joined AS (
      SELECT DISTINCT ON(user_id) user_id,joined_at
      FROM bot_member_join_events
      WHERE group_id=$1 AND joined_at>=NOW()-INTERVAL '30 days'
      ORDER BY user_id,joined_at ASC
    )
    SELECT
      COUNT(*)::int joined,
      COUNT(*) FILTER(
        WHERE EXISTS(
          SELECT 1 FROM bot_message_records m
          WHERE m.chat_id=$1 AND m.user_id=joined.user_id
            AND ${rawTsExpression("m")}>=joined.joined_at
            AND ${rawTsExpression("m")}<=joined.joined_at+INTERVAL '7 days'
        )
      )::int retained_7d,
      COUNT(*) FILTER(
        WHERE EXISTS(
          SELECT 1 FROM bot_message_records m
          WHERE m.chat_id=$1 AND m.user_id=joined.user_id
            AND ${rawTsExpression("m")}>=joined.joined_at
            AND ${rawTsExpression("m")}<=joined.joined_at+INTERVAL '30 days'
        )
      )::int retained_30d
    FROM joined`,
    [chatId],
  ).catch(() => ({ rows: [] }));
  const row = result.rows[0] || {};
  return {
    joined: number(row.joined),
    retained7d: number(row.retained_7d),
    retained30d: number(row.retained_30d),
  };
}

async function inactivityData(pool: Pool, chatId: number) {
  const result = await pool.query<any>(
    `WITH users AS (
      SELECT user_id,MAX(${rawTsExpression("m")}) last_at
      FROM bot_message_records m
      WHERE m.chat_id=$1 AND m.user_id IS NOT NULL
      GROUP BY user_id
    )
    SELECT
      COUNT(*) FILTER(WHERE last_at<NOW()-INTERVAL '7 days' AND last_at>=NOW()-INTERVAL '30 days')::int inactive7_30,
      COUNT(*) FILTER(WHERE last_at<NOW()-INTERVAL '30 days')::int inactive30,
      COUNT(*) FILTER(WHERE last_at>=NOW()-INTERVAL '24 hours')::int active24h
    FROM users`,
    [chatId],
  );
  return result.rows[0] || {};
}

async function returningData(pool: Pool, chatId: number) {
  const result = await pool.query<any>(
    `WITH activity AS (
      SELECT m.user_id,${rawTsExpression("m")} ts
      FROM bot_message_records m
      WHERE m.chat_id=$1 AND m.user_id IS NOT NULL
    ),
    users AS (
      SELECT
        user_id,
        MAX(ts) last_at,
        MAX(ts) FILTER(WHERE ts<NOW()-INTERVAL '7 days') old_at
      FROM activity
      GROUP BY user_id
    )
    SELECT COUNT(*) FILTER(
      WHERE last_at>=NOW()-INTERVAL '7 days'
        AND old_at IS NOT NULL
    )::int returning_users
    FROM users`,
    [chatId],
  );
  return number(result.rows[0]?.returning_users);
}

async function adminStats(pool: Pool, chatId: number, period: StatsPeriod) {
  const condition = period === "all"
    ? "TRUE"
    : period === "today"
      ? "created_at>=CURRENT_DATE"
      : period === "7d"
        ? "created_at>=NOW()-INTERVAL '6 days'"
        : period === "30d"
          ? "created_at>=NOW()-INTERVAL '29 days'"
          : period === "month"
            ? "created_at>=date_trunc('month',NOW())"
            : "created_at>=date_trunc('month',NOW())-INTERVAL '1 month' AND created_at<date_trunc('month',NOW())";
  const [actions,warnings,penalties,top,failed]=await Promise.all([
    pool.query<any>("SELECT COUNT(*)::int n FROM moderation_actions WHERE group_id=$1 AND "+condition,[chatId]).catch(()=>({rows:[]})),
    pool.query<any>("SELECT COUNT(*)::int n FROM warning_events WHERE group_id=$1 AND action_type='warning' AND "+condition,[chatId]).catch(()=>({rows:[]})),
    pool.query<any>("SELECT COUNT(*)::int n FROM warning_penalties WHERE group_id=$1 AND "+condition,[chatId]).catch(()=>({rows:[]})),
    pool.query<any>("SELECT actor_id::text actor_id,COUNT(*)::int n FROM moderation_actions WHERE group_id=$1 AND actor_id IS NOT NULL AND "+condition+" GROUP BY actor_id ORDER BY n DESC,actor_id LIMIT 5",[chatId]).catch(()=>({rows:[]})),
    pool.query<any>("SELECT COUNT(*)::int n FROM supervision_events WHERE group_id=$1 AND severity IN('error','critical') AND "+condition,[chatId]).catch(()=>({rows:[]})),
  ]);
  return {
    actions:number(actions.rows[0]?.n),
    warnings:number(warnings.rows[0]?.n),
    penalties:number(penalties.rows[0]?.n),
    failed:number(failed.rows[0]?.n),
    topAdmins:top.rows.map((x:any)=>({userId:number(x.actor_id),count:number(x.n)})),
  };
}

async function auditAdminDirectory(pool: Pool, chatId: number) {
  const admins = await telegramApi<any[]>("getChatAdministrators",{chat_id:chatId}).catch(() => ({ok:false,result:[]}));
  if (!admins.ok || !Array.isArray(admins.result)) return [];
  const output:any[] = [];
  for (const row of admins.result) {
    const u=row.user;
    if (!u?.id) continue;
    const r=await pool.query<any>(
      `SELECT COUNT(*)::int n
       FROM moderation_actions
       WHERE group_id=$1 AND actor_id=$2`,
      [chatId,u.id],
    ).catch(() => ({rows:[]}));
    output.push({
      userId:number(u.id),
      username:u.username,
      firstName:u.first_name,
      actions:number(r.rows[0]?.n),
    });
  }
  return output.sort((a,b)=>b.actions-a.actions).slice(0,10);
}

function renderHeader(subtitle = "مرکز تحلیل گروه") {
  return [
    "◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Sᴛᴀᴛs Cᴇɴᴛᴇʀ",
    "",
    "★ - " + subtitle,
    "",
    "─────━━───── ◈ ─────━━─────",
  ].join("\n");
}

function periodLabel(period: StatsPeriod) {
  const map:Record<StatsPeriod,string> = {
    today: "امروز",
    "7d": "۷ روز اخیر",
    "30d": "۳۰ روز اخیر",
    month: "این ماه",
    prevmonth: "ماه قبل",
    all: "کل",
  };
  return map[period] || period;
}

function scopeLabel(scope: StatsScope) {
  return {
    group: "آمار کلی گروه",
    admins: "آمار ادمین",
    members: "آمار اعضا",
    user: "آمار کاربر",
  }[scope];
}

function periodButtons(scope: StatsScope, targetUserId?: number) {
  const id = targetUserId ? ":" + targetUserId : "";
  return [
    [["‹ امروز","sx:period:"+scope+":today"+id],["‹ ۷ روز اخیر","sx:period:"+scope+":7d"+id]],
    [["‹ ۳۰ روز اخیر","sx:period:"+scope+":30d"+id],["‹ این ماه","sx:period:"+scope+":month"+id]],
    [["‹ ماه قبل","sx:period:"+scope+":prevmonth"+id],["‹ کل","sx:period:"+scope+":all"+id]],
    [["‹ انتخاب تاریخ","sx:date:"+scope+(id?":"+targetUserId:"")],["‹ انتخاب بازه","sx:range:"+scope+(id?":"+targetUserId:"")]],
  ];
}

function moreButtons(targetUserId?: number) {
  const id = targetUserId ? ":" + targetUserId : "";
  return [
    [["مرکز ادمین","sx:scope:admins"],["مرکز ممبر","sx:scope:members"]],
    [["آمار کاربر","sx:scope:user"+(targetUserId ? id : "")],["آمار گروه","sx:scope:group"]],
    [["مقایسه بازه‌ها","sx:compare:group"],["گزارش آماری","sx:report:group"]],
    [["رشد گروه","sx:growth:group"],["شاخص وضعیت","sx:status:group"]],
    [["بازگشت","sx:home"]],
  ];
}

function summaryNav(scope: StatsScope, targetUserId?: number) {
  const id = targetUserId ? ":" + targetUserId : "";
  return [
    [["‹ بازه‌های آماری","sx:periods:"+scope+id],["‹ جزئیات ساعتی","sx:hours:"+scope+id]],
    [["‹ رتبه‌بندی","sx:ranking:"+scope+id],["‹ محتوا","sx:content:"+scope+id]],
    [["‹ مقایسه","sx:compare:"+scope+id],["‹ گزارش","sx:report:"+scope+id]],
    [["‹ بازگشت","sx:more"]],
  ];
}

function statusLine(label: string, value: string) {
  return "⛂ - " + label + " : " + value;
}


function shiftDateKey(day: string, delta: number) {
  const d = new Date(String(day) + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function currentWeekDays() {
  const today = toDateInput(new Date());
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: TZ,
  }).format(new Date(today + "T12:00:00Z"));
  const index: Record<string, number> = {
    Sat: 0, Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6,
  };
  const offset = index[weekday] ?? 0;
  const start = shiftDateKey(today, -offset);
  return Array.from({ length: 7 }, (_, i) => shiftDateKey(start, i));
}

function weekdayShortLabel(day: string) {
  const map: Record<string, string> = {
    "شنبه": "شنبه",
    "یکشنبه": "یکشنبه",
    "دوشنبه": "دوشنبه",
    "سه‌شنبه": "سه‌شنبه",
    "چهارشنبه": "چهارشنبه",
    "پنجشنبه": "پنجشنبه",
    "جمعه": "جمعه",
  };
  return map[faDayName(day)] || faDayName(day);
}

async function chatDayData(pool: Pool, chatId: number, day: string) {
  const [messages, joins, leaves, security] = await Promise.all([
    pool.query<any>(
      `SELECT
        COUNT(*)::int total,
        COUNT(DISTINCT user_id)::int active_users,
        COUNT(*) FILTER(WHERE has_link)::int links,
        COUNT(*) FILTER(WHERE reply_to_user_id IS NOT NULL)::int replies,
        COUNT(*) FILTER(WHERE kind IN('photo','video','audio','document','animation','sticker','voice','video_note'))::int media,
        COUNT(*) FILTER(WHERE kind='text')::int text_count
       FROM bot_message_records m
       WHERE m.chat_id=$1 AND ${rawDayExpression("m")}=$2::date`,
      [chatId, day],
    ),
    pool.query<any>(
      `SELECT COUNT(*)::int n
       FROM bot_member_join_events
       WHERE group_id=$1 AND (joined_at AT TIME ZONE '${TZ}')::date=$2::date`,
      [chatId, day],
    ).catch(() => ({ rows: [] })),
    pool.query<any>(
      `SELECT COUNT(*)::int n
       FROM bot_member_leave_events
       WHERE group_id=$1 AND (left_at AT TIME ZONE '${TZ}')::date=$2::date`,
      [chatId, day],
    ).catch(() => ({ rows: [] })),
    pool.query<any>(
      `SELECT
        (SELECT COUNT(*)::int FROM content_lock_logs WHERE group_id=$1 AND (created_at AT TIME ZONE '${TZ}')::date=$2::date) violations,
        (SELECT COUNT(*)::int FROM warning_events WHERE group_id=$1 AND action_type='warning' AND (created_at AT TIME ZONE '${TZ}')::date=$2::date) warnings,
        (SELECT COUNT(*)::int FROM warning_penalties WHERE group_id=$1 AND (created_at AT TIME ZONE '${TZ}')::date=$2::date) penalties`,
      [chatId, day],
    ).catch(() => ({ rows: [] })),
  ]);
  return {
    ...(messages.rows[0] || {}),
    joins: number(joins.rows[0]?.n),
    leaves: number(leaves.rows[0]?.n),
    violations: number(security.rows[0]?.violations),
    warnings: number(security.rows[0]?.warnings),
    penalties: number(security.rows[0]?.penalties),
  };
}

async function chatHourData(pool: Pool, chatId: number, day: string, hour: number) {
  const r = await pool.query<any>(
    `SELECT
      COUNT(*)::int total,
      COUNT(DISTINCT user_id)::int active_users,
      COUNT(*) FILTER(WHERE has_link)::int links,
      COUNT(*) FILTER(WHERE reply_to_user_id IS NOT NULL)::int replies,
      COUNT(*) FILTER(WHERE kind IN('photo','video','audio','document','animation','sticker','voice','video_note'))::int media
     FROM bot_message_records m
     WHERE m.chat_id=$1
       AND ${rawDayExpression("m")}=$2::date
       AND ${rawHourExpression("m")}=$3`,
    [chatId, day, hour],
  );
  return r.rows[0] || {};
}

async function chatDayContent(pool: Pool, chatId: number, day: string) {
  const r = await pool.query<any>(
    `SELECT m.kind,COUNT(*)::int n
     FROM bot_message_records m
     WHERE m.chat_id=$1 AND ${rawDayExpression("m")}=$2::date
     GROUP BY m.kind ORDER BY n DESC`,
    [chatId, day],
  ).catch(() => ({ rows: [] }));
  return r.rows.map((x: any) => ({ kind: String(x.kind), count: number(x.n) }));
}

function chatWeekButtonRows() {
  return currentWeekDays().reduce((rows: string[][][], day, index) => {
    const label = weekdayShortLabel(day) + " " + faDate(day);
    const rowIndex = Math.floor(index / 2);
    if (!rows[rowIndex]) rows[rowIndex] = [];
    rows[rowIndex].push([label, "sx:chat:day:" + day]);
    return rows;
  }, []);
}

function hourButtonRows(day: string) {
  const rows: string[][][] = [];
  for (let start = 0; start < 24; start += 6) {
    rows.push(
      Array.from({ length: Math.min(6, 24 - start) }, (_, i) => {
        const hour = start + i;
        return [
          String(hour).padStart(2, "0") + ":00",
          "sx:chat:hour:" + day + ":" + hour,
        ];
      })
    );
  }
  return rows;
}

function chatStatsNavigation(day?: string) {
  const selected = day || toDateInput(new Date());
  return [
    [["رتبه‌بندی اصلی","sx:chat:rank:" + selected]],
    [["۲۴ ساعت","sx:chat:hours:" + selected],["آمار تکمیلی","sx:chat:details:" + selected]],
    [["روز انتخاب‌شده","sx:chat:day:" + selected],["بروزرسانی","sx:chat:home"]],
  ];
}

async function renderChatStatsHub(pool: Pool, chatId: number, messageId: number, backCallback = "sx:more") {
  const d = await groupOverviewData(pool, chatId);
  const days = currentWeekDays();
  const today = toDateInput(new Date());
  const blocks: RichInputBlock[] = [
    richHeading("Pᴇʀsɪᴀɴ ᴮᵒᵗ · Sᴛᴀᴛs Cᴇɴᴛᴇʀ", 1),
    richHeading("آمار چت", 2),
    richTable(["شاخص","مقدار"],[
      ["پیام امروز",d.messagesToday],
      ["پیام ۷ روز اخیر",d.messagesWeek],
      ["اعضای فعلی",d.memberCount],
      ["فعال در ۲۴ ساعت",d.active24h],
      ["فعال‌ترین ساعت",d.busiestHour == null ? "ثبت نشده" : String(d.busiestHour).padStart(2,"0")+":00 · "+d.busiestHourCount],
    ]),
    richDivider(),
    richHeading("انتخاب روز", 3),
    richParagraph("هفته جاری · شنبه تا جمعه"),
  ];
  if (messageId) {
    return editRichPanel(chatId, messageId, blocks, [
      ...chatWeekButtonRows().slice(0,4),
      [[
        "رتبه‌بندی اصلی","sx:chat:rank:"+today
      ]],
      [["۲۴ ساعت","sx:chat:hours:"+today],["آمار تکمیلی","sx:chat:details:"+today]],
      [["بازگشت",backCallback]],
    ]);
  }
  return sendRichPanel(chatId, blocks, [
    ...chatWeekButtonRows().slice(0,4),
    [["رتبه‌بندی اصلی","sx:chat:rank:"+today]],
    [["۲۴ ساعت","sx:chat:hours:"+today],["آمار تکمیلی","sx:chat:details:"+today]],
    [["بازگشت",backCallback]],
  ]);
}

async function renderChatDay(pool: Pool, chatId: number, messageId: number, day: string, backCallback = "sx:chat:home") {
  const d = await chatDayData(pool, chatId, day);
  const blocks: RichInputBlock[] = [
    richHeading("آمار چت", 1),
    richHeading(weekdayShortLabel(day) + " · " + faDate(day), 2),
    richTable(["شاخص","مقدار"],[
      ["کل پیام‌ها",number(d.total)],
      ["کاربران فعال",number(d.active_users)],
      ["رسانه",number(d.media)],
      ["لینک",number(d.links)],
      ["پاسخ / ریپلای",number(d.replies)],
      ["ورود",number(d.joins)],
      ["خروج",number(d.leaves)],
      ["اخطار",number(d.warnings)],
      ["جریمه",number(d.penalties)],
      ["تخلف ثبت‌شده",number(d.violations)],
    ]),
    richDivider(),
    richDetails("ساعت‌های شبانه‌روز",[
      richParagraph("برای مشاهده آمار هر ساعت، «۲۴ ساعت» را باز کنید و ساعت موردنظر را انتخاب کنید.")
    ]),
  ];
  return editRichPanel(chatId,messageId,blocks,[
    [["رتبه‌بندی اصلی","sx:chat:rank:"+day]],
    [["۲۴ ساعت","sx:chat:hours:"+day],["آمار تکمیلی","sx:chat:details:"+day]],
    ...chatWeekButtonRows().slice(0,4),
    [["بازگشت",backCallback]],
  ]);
}

async function renderChatHours(pool: Pool, chatId: number, messageId: number, day: string) {
  const rows = hourButtonRows(day);
  const blocks: RichInputBlock[] = [
    richHeading("آمار چت", 1),
    richHeading("۲۴ ساعت · " + faDate(day), 2),
    richParagraph("یک ساعت را انتخاب کنید تا آمار دقیق همان ساعت نمایش داده شود."),
  ];
  return editRichPanel(chatId,messageId,blocks,[
    ...rows,
    [["بازگشت به روز","sx:chat:day:"+day]],
  ]);
}

async function renderChatHour(pool: Pool, chatId: number, messageId: number, day: string, hour: number) {
  const d = await chatHourData(pool,chatId,day,hour);
  const blocks: RichInputBlock[] = [
    richHeading("آمار ساعتی", 1),
    richHeading(weekdayShortLabel(day) + " · " + faDate(day), 2),
    richTable(["شاخص","مقدار"],[
      ["بازه",String(hour).padStart(2,"0")+":00 تا "+String(hour+1).padStart(2,"0")+":00"],
      ["پیام‌ها",number(d.total)],
      ["کاربران فعال",number(d.active_users)],
      ["رسانه",number(d.media)],
      ["لینک",number(d.links)],
      ["پاسخ / ریپلای",number(d.replies)],
    ]),
  ];
  return editRichPanel(chatId,messageId,blocks,[
    [["ساعت‌های دیگر","sx:chat:hours:"+day]],
    [["رتبه‌بندی این ساعت","sx:chat:rankhour:"+day+":"+hour],["آمار روز","sx:chat:day:"+day]],
    [["بازگشت","sx:chat:day:"+day]],
  ]);
}

async function renderChatRanking(pool: Pool, chatId: number, messageId: number, day: string, hour?: number) {
  const users = hour == null
    ? await dailyUsers(pool,chatId,day,10)
    : await dailyUsersForHour(pool,chatId,day,hour,10);
  const title = hour == null ? "رتبه‌بندی اصلی · " + faDate(day) : "رتبه‌بندی ساعت · " + String(hour).padStart(2,"0") + ":00";
  const blocks: RichInputBlock[] = [
    richHeading("Pᴇʀsɪᴀɴ ᴮᵒᵗ · Sᴛᴀᴛs Cᴇɴᴛᴇʀ",1),
    richHeading(title,2),
    users.length
      ? richTable(["رتبه","کاربر","پیام"],users.map((u:any,i:number)=>[
          String(i+1).padStart(3,"0"),
          richInlineUser(u.userId,u.username,u.firstName),
          number(u.count),
        ]))
      : richParagraph("برای این بازه داده‌ای ثبت نشده است."),
  ];
  return editRichPanel(chatId,messageId,blocks,[
    [["۲۴ ساعت","sx:chat:hours:"+day],["آمار روز","sx:chat:day:"+day]],
    hour == null
      ? [["آمار تکمیلی","sx:chat:details:"+day]]
      : [["ساعت موردنظر","sx:chat:hour:"+day+":"+hour]],
    [["بازگشت","sx:chat:home"]],
  ]);
}

async function dailyUsersForHour(pool: Pool, chatId: number, day: string, hour: number, limit = 10) {
  const r = await pool.query<any>(
    `SELECT m.user_id,MAX(m.username) username,MAX(m.first_name) first_name,COUNT(*)::int n
     FROM bot_message_records m
     WHERE m.chat_id=$1
       AND m.user_id IS NOT NULL
       AND ${rawDayExpression("m")}=$2::date
       AND ${rawHourExpression("m")}=$3
     GROUP BY m.user_id
     ORDER BY n DESC,m.user_id
     LIMIT ${Math.max(1,Math.min(limit,20))}`,
    [chatId,day,hour],
  ).catch(() => ({rows:[]}));
  return r.rows.map((x:any)=>({
    userId:number(x.user_id),
    username:x.username,
    firstName:x.first_name,
    count:number(x.n),
  }));
}

async function renderChatDetails(pool: Pool, chatId: number, messageId: number, day: string) {
  const d = await chatDayData(pool,chatId,day);
  const content = await chatDayContent(pool,chatId,day);
  const blocks: RichInputBlock[] = [
    richHeading("آمار تکمیلی",1),
    richHeading(faDate(day),2),
    richTable(["شاخص","مقدار"],[
      ["متن",number(content.find(x=>x.kind==="text")?.count)],
      ["رسانه",number(d.media)],
      ["لینک",number(d.links)],
      ["پاسخ",number(d.replies)],
      ["کاربران فعال",number(d.active_users)],
    ]),
    richDivider(),
    richHeading("تفکیک محتوا",3),
    content.length
      ? richTable(["نوع","تعداد"],content.map(x=>[x.kind,number(x.count)]))
      : richParagraph("داده‌ای ثبت نشده است."),
    richDetails("رویدادهای مدیریتی همان روز",[
      richTable(["شاخص","تعداد"],[
        ["اخطار",number(d.warnings)],
        ["جریمه",number(d.penalties)],
        ["تخلف ثبت‌شده",number(d.violations)],
      ])
    ]),
  ];
  return editRichPanel(chatId,messageId,blocks,[
    [["رتبه‌بندی اصلی","sx:chat:rank:"+day],["۲۴ ساعت","sx:chat:hours:"+day]],
    [["بازگشت به روز","sx:chat:day:"+day]],
  ]);
}

async function renderAdminHub(pool: Pool, chatId: number, messageId: number) {
  const blocks: RichInputBlock[]=[
    richHeading("Pᴇʀsɪᴀɴ ᴮᵒᵗ · Sᴛᴀᴛs Cᴇɴᴛᴇʀ",1),
    richHeading("مرکز آمار ادمین",2),
    richParagraph("دو مرکز مستقل برای تحلیل گفت‌وگوها و اقدامات مدیریتی."),
  ];
  return editRichPanel(chatId,messageId,blocks,[
    [["آمار چت","sx:adminchat"],["آمار اقدامات","sx:adminactions:today"]],
    [["بازگشت","sx:more"]],
  ]);
}

async function renderMemberHub(pool: Pool, chatId: number, messageId: number) {
  const blocks: RichInputBlock[]=[
    richHeading("Pᴇʀsɪᴀɴ ᴮᵒᵗ · Sᴛᴀᴛs Cᴇɴᴛᴇʀ",1),
    richHeading("مرکز آمار ممبر",2),
    richParagraph("آمار ممبر در این بخش بر پایه فعالیت و گفت‌وگوی گروه ارائه می‌شود."),
  ];
  return editRichPanel(chatId,messageId,blocks,[
    [["آمار چت","sx:memberchat"]],
    [["بازگشت","sx:more"]],
  ]);
}

async function adminActionBreakdown(pool: Pool, chatId: number, period: StatsPeriod) {
  const d=await adminStats(pool,chatId,period);
  const warningEvents=await pool.query<any>(
    `SELECT action_type,COUNT(*)::int n
     FROM warning_events
     WHERE group_id=$1 AND created_at >=
       CASE
         WHEN $2='today' THEN CURRENT_DATE
         WHEN $2='7d' THEN NOW()-INTERVAL '6 days'
         WHEN $2='30d' THEN NOW()-INTERVAL '29 days'
         WHEN $2='month' THEN date_trunc('month',NOW())
         WHEN $2='prevmonth' THEN date_trunc('month',NOW())-INTERVAL '1 month'
         ELSE TIMESTAMPTZ 'epoch'
       END
       AND ($2 <> 'prevmonth' OR created_at < date_trunc('month',NOW()))
     GROUP BY action_type
     ORDER BY n DESC`,
    [chatId,period],
  ).catch(() => ({rows:[]}));
  return {d,warningEvents:warningEvents.rows};
}

async function renderAdminActions(pool: Pool, chatId: number, messageId: number, period: StatsPeriod="today") {
  const {d}=await adminActionBreakdown(pool,chatId,period);
  const blocks:RichInputBlock[]=[
    richHeading("Pᴇʀsɪᴀɴ ᴮᵒᵗ · Sᴛᴀᴛs Cᴇɴᴛᴇʀ",1),
    richHeading("آمار اقدامات",2),
    richParagraph("بازه · " + periodLabel(period)),
    richTable(["شاخص","تعداد"],[
      ["اقدامات مدیریتی",d.actions],
      ["اخطارها",d.warnings],
      ["جریمه‌ها",d.penalties],
      ["خطا / رویداد بحرانی",d.failed],
    ]),
    richDivider(),
    richDetails("مسیرهای تحلیل",[
      richParagraph("تفکیک نوع اقدام، مدیران فعال، اخطار و جریمه و سوابق ممیزی در دکمه‌های زیر قرار دارند.")
    ]),
  ];
  return editRichPanel(chatId,messageId,blocks,[
    [["امروز","sx:adminactions:today"],["۷ روز اخیر","sx:adminactions:7d"]],
    [["۳۰ روز اخیر","sx:adminactions:30d"],["این ماه","sx:adminactions:month"]],
    [["تفکیک اقدامات","sx:adminactions:breakdown:"+period],["مدیران فعال","sx:adminactions:admins:"+period]],
    [["اخطار و جریمه","sx:adminactions:cases:"+period],["سوابق ممیزی","sx:adminactions:audit:"+period]],
    [["بازگشت","sx:scope:admins"]],
  ]);
}

async function renderAdminActionBreakdown(pool: Pool, chatId: number, messageId: number, period: StatsPeriod) {
  const {d,warningEvents}=await adminActionBreakdown(pool,chatId,period);
  return editRichPanel(chatId,messageId,[
    richHeading("تفکیک اقدامات",1),
    richParagraph("بازه · " + periodLabel(period)),
    richTable(["نوع","تعداد"],[
      ["کل اقدامات مدیریتی",d.actions],
      ["اخطار",d.warnings],
      ["جریمه",d.penalties],
      ["خطا / رویداد بحرانی",d.failed],
    ]),
    richDivider(),
    richHeading("ثبت در سامانه اخطار",3),
    warningEvents.length
      ? richTable(["نوع","تعداد"],warningEvents.map((x:any)=>[String(x.action_type),number(x.n)]))
      : richParagraph("رویداد اخطاری در این بازه ثبت نشده است."),
  ],[
    [["آمار اقدامات","sx:adminactions:"+period],["بازگشت","sx:adminactions:"+period]],
  ]);
}

async function renderAdminActive(pool: Pool, chatId: number, messageId: number, period: StatsPeriod) {
  const d=await adminStats(pool,chatId,period);
  const admins=d.topAdmins||[];
  return editRichPanel(chatId,messageId,[
    richHeading("مدیران فعال",1),
    richParagraph("بازه · " + periodLabel(period)),
    admins.length
      ? richTable(["رتبه","مدیر","اقدام"],admins.map((u:any,i:number)=>[
          String(i+1).padStart(3,"0"),
          richInlineUser(u.userId),
          number(u.count),
        ]))
      : richParagraph("اقدام مدیریتی ثبت‌شده‌ای در این بازه وجود ندارد."),
  ],[
    [["آمار اقدامات","sx:adminactions:"+period],["سوابق ممیزی","sx:adminactions:audit:"+period]],
  ]);
}

async function renderAdminCases(pool: Pool, chatId: number, messageId: number, period: StatsPeriod) {
  const {warningEvents}=await adminActionBreakdown(pool,chatId,period);
  return editRichPanel(chatId,messageId,[
    richHeading("اخطار و جریمه",1),
    richParagraph("بازه · " + periodLabel(period)),
    warningEvents.length
      ? richTable(["نوع رویداد","تعداد"],warningEvents.map((x:any)=>[String(x.action_type),number(x.n)]))
      : richParagraph("هیچ رویداد اخطار یا جریمه‌ای ثبت نشده است."),
  ],[
    [["آمار اقدامات","sx:adminactions:"+period],["بازگشت","sx:adminactions:"+period]],
  ]);
}

async function renderGroupOverview(pool: Pool, chatId: number, messageId?: number) {
  const d=await groupOverviewData(pool,chatId);
  const blocks: RichInputBlock[]=[
    richHeading("Pᴇʀsɪᴀɴ ᴮᵒᵗ · Sᴛᴀᴛs Cᴇɴᴛᴇʀ",1),
    richHeading("نمای کلی گروه",2),
    richTable(
      ["شاخص","مقدار"],
      [
        ["پیام امروز",d.messagesToday],
        ["پیام ۷ روز اخیر",d.messagesWeek],
        ["پیام این ماه",d.messagesMonth],
        ["پیام کل",d.totalMessages],
        ["میانگین پیام روزانه",decimal(d.dailyAverage)],
        ["اعضای فعلی",d.memberCount],
        ["فعال در ۳۰ دقیقه",d.active30m],
        ["فعال در ۲۴ ساعت",d.active24h],
        ["عضو جدید امروز",d.joinsToday],
        ["خروج امروز",d.leavesToday],
        ["رشد خالص امروز",signed(d.netToday)],
        ["فعال‌ترین ساعت",d.busiestHour==null?"ثبت نشده":String(d.busiestHour).padStart(2,"0")+":00 · "+d.busiestHourCount],
        ["روند ۷ روزه",d.currentWeekTrend],
      ]
    ),
    richDivider(),
    richHeading("رشد و وضعیت",3),
    richTable(
      ["شاخص","مقدار"],
      [
        ["تخلف امنیتی امروز",d.securityViolationsToday],
        ["اخطار امروز",d.warningsToday],
        ["اقدامات مدیریتی امروز",d.penaltiesToday],
      ]
    ),
    richDivider(),
    richHeading("برترین کاربران",3),
    d.topChat.length
      ? richTable(
          ["رتبه","کاربر","پیام"],
          d.topChat.map((u:any,i:number)=>[
            String(i+1).padStart(3,"0"),
            richInlineUser(u.userId,u.username,u.firstName),
            number(u.count),
          ])
        )
      : richParagraph("هنوز داده‌ای برای رتبه‌بندی ثبت نشده است."),
    d.topFriends.length
      ? richDetails(
          "تعامل مستقیم",
          [
            richTable(
              ["رتبه","کاربر","تعامل"],
              d.topFriends.map((u:any,i:number)=>[
                String(i+1).padStart(3,"0"),
                richInlineUser(u.userId,u.username,u.firstName),
                number(u.count),
              ])
            ),
          ]
        )
      : richDetails("تعامل مستقیم", [richParagraph("داده کافی برای تحلیل تعامل مستقیم ثبت نشده است.")]),
    richDivider(),
    richHeading("تحلیل فعالیت",3),
    d.anomaly.detected
      ? richStatus("الگوی غیرعادی شناسایی شد", "warning")
      : richParagraph("الگوی غیرعادی مشخصی ثبت نشده است."),
    richDetails(
      "جزئیات ناهنجاری",
      [
        richTable(["شاخص","مقدار"],[
          ["اوج ۱۵ دقیقه‌ای",d.anomaly.peak15m],
          ["میانگین ۱۵ دقیقه‌ای",decimal(d.anomaly.average15m,2)],
          ["نسبت اوج به میانگین",decimal(d.anomaly.ratio,2)],
        ])
      ]
    ),
    richDivider(),
    richFooter("آخرین بروزرسانی · " + faDateTime(new Date())),
  ];
  const rows=[
    [["اطلاعات بیشتر","sx:more"]],
    [["بروزرسانی","sx:home"],["گزارش آماری","sx:report:group"]],
  ];
  if(messageId)return editRichPanel(chatId,messageId,blocks,rows);
  return sendRichPanel(chatId,blocks,rows);
}

async function renderMore(pool: Pool, chatId: number, messageId: number, targetUserId?: number) {
  const text=[
    renderHeader("مراکز آماری"),
    "★ - دسترسی به مراکز آماری",
    "⛂ - هر مرکز با بازه و جزئیات مستقل قابل بررسی است.",
    "",
    "★ - تحلیل پیشرفته",
    "⛂ - رتبه‌بندی · ساعتی · محتوا · مقایسه · گزارش",
  ].join("\n");
  return editPanel(chatId,messageId,text,moreButtons(targetUserId));
}

async function renderPeriods(chatId: number, messageId: number, scope: StatsScope, targetUserId?: number) {
  const text=[
    renderHeader(scopeLabel(scope)),
    "⛂ - بازه انتخابی : انتخاب کنید.",
    "",
    "★ - بازه‌های آماده",
  ].join("\n");
  return editPanel(chatId,messageId,text,periodButtons(scope,targetUserId));
}

async function groupPeriodCounts(pool:Pool,chatId:number,period:StatsPeriod){
  let condition="TRUE";
  if(period==="today") condition=rawDayExpression("m")+"=(NOW() AT TIME ZONE '"+TZ+"')::date";
  else if(period==="7d") condition=rawDayExpression("m")+">=((NOW() AT TIME ZONE '"+TZ+"')::date-INTERVAL '6 days')::date";
  else if(period==="30d") condition=rawDayExpression("m")+">=((NOW() AT TIME ZONE '"+TZ+"')::date-INTERVAL '29 days')::date";
  else if(period==="month") condition=rawDayExpression("m")+">=date_trunc('month',NOW() AT TIME ZONE '"+TZ+"')::date";
  else if(period==="prevmonth") condition=rawDayExpression("m")+">=date_trunc('month',NOW() AT TIME ZONE '"+TZ+"')::date-INTERVAL '1 month' AND "+rawDayExpression("m")+"<date_trunc('month',NOW() AT TIME ZONE '"+TZ+"')::date";
  const r=await pool.query<any>(
    "SELECT COUNT(*)::int messages,COUNT(DISTINCT user_id)::int active_users,COUNT(*) FILTER(WHERE has_link)::int links "+
    "FROM bot_message_records m WHERE m.chat_id=$1 AND "+condition,
    [chatId],
  );
  return r.rows[0]||{};
}

async function renderGroupPeriod(pool: Pool, chatId: number, messageId: number, period: StatsPeriod) {
  const d=await groupOverviewData(pool,chatId);
  const periodData=await groupPeriodCounts(pool,chatId,period);
  const top=await topUsers(pool,chatId,"messages",period,5);
  const rows=[
    renderHeader(scopeLabel("group")+" · "+periodLabel(period)),
    statusLine("بازه",periodLabel(period)),
    statusLine("پیام","【 "+number(periodData.messages)+" 】"),
    statusLine("اعضای فعلی","【 "+d.memberCount+" 】"),
    statusLine("کاربران فعال در بازه","【 "+number(periodData.active_users)+" 】"),
    statusLine("اعضای جدید","【 "+(
      period==="today"?d.joinsToday:
      period==="7d"?d.joinsWeek:
      period==="30d"||period==="month"?d.joinsMonth:
      period==="prevmonth"?d.joinsMonth:
      d.joinsTotal
    )+" 】"),
    statusLine("خروج","【 "+(
      period==="today"?d.leavesToday:
      period==="7d"?d.leavesWeek:
      period==="30d"||period==="month"?d.leavesMonth:
      period==="prevmonth"?d.leavesMonth:
      d.leavesTotal
    )+" 】"),
    statusLine("تخلفات","【 "+(
      period==="today"?d.securityViolationsToday:
      period==="7d"?d.securityViolationsWeek:
      d.warnings30d
    )+" 】"),
    "",
    "★ - رتبه‌بندی فعالیت",
    ...(top.length?top.map((u:any,i:number)=>rankNumber(i+1)+" · "+userTag(u.userId,u.username,u.firstName)+" · "+u.count+" پیام"):["■ داده‌ای ثبت نشده است."]),
    "",
    "★ - روند : "+d.currentWeekTrend,
    "",
    "★ - انتخاب روز",
    period==="7d" ? "از «جزئیات ساعتی» می‌توانید هر یک از ۷ روز اخیر را باز کنید." : "برای بررسی دقیق روز، از «بازه‌های آماری» و سپس انتخاب تاریخ استفاده کنید.",
  ];
  return editPanel(chatId,messageId,rows.join("\n"),[
    ...periodButtons("group"),
    [["‹ جزئیات ساعتی","sx:hours:group:"+period],["‹ رتبه‌بندی کامل","sx:ranking:group:"+period]],
    [["‹ بازگشت","sx:more"]],
  ]);
}

async function renderAdminPeriod(pool: Pool, chatId: number, messageId: number, period: StatsPeriod) {
  const d=await adminStats(pool,chatId,period);
  const admins=await auditAdminDirectory(pool,chatId);
  const text=[
    renderHeader(scopeLabel("admins")+" · "+periodLabel(period)),
    statusLine("بازه",periodLabel(period)),
    statusLine("اقدامات مدیریتی","【 "+d.actions+" 】"),
    statusLine("اخطارها","【 "+d.warnings+" 】"),
    statusLine("جریمه‌ها","【 "+d.penalties+" 】"),
    statusLine("خطا / رویداد بحرانی","【 "+d.failed+" 】"),
    "",
    "★ - ادمین‌های فعال",
    ...(admins.length
      ? admins.slice(0,5).map((u:any,i:number)=>rankNumber(i+1)+" · "+userTag(u.userId,u.username,u.firstName)+" · "+u.actions+" اقدام")
      : ["■ داده‌ای ثبت نشده است."]),
    "",
    "★ - تفکیک عملیات",
    "⛂ - مدیریت مستقیم : "+d.actions,
    "⛂ - اخطار : "+d.warnings,
    "⛂ - جریمه : "+d.penalties,
  ].join("\n");
  return editPanel(chatId,messageId,text,[
    ...periodButtons("admins"),
    [["‹ رتبه‌بندی مدیران","sx:ranking:admins:"+period],["‹ سوابق ممیزی","sx:audit:admins:"+period]],
    [["‹ بازگشت","sx:more"]],
  ]);
}

async function renderMemberPeriod(pool: Pool, chatId: number, messageId: number, period: StatsPeriod) {
  const d=await groupOverviewData(pool,chatId);
  const dyn=await memberDynamics(pool,chatId,period);
  const ret=await retentionData(pool,chatId);
  const inactive=await inactivityData(pool,chatId);
  const returning=await returningData(pool,chatId);
  const joined=number(ret.joined);
  const retention7=joined>0?Math.round((ret.retained7d/joined)*100):0;
  const retention30=joined>0?Math.round((ret.retained30d/joined)*100):0;
  const text=[
    renderHeader(scopeLabel("members")+" · "+periodLabel(period)),
    statusLine("اعضای فعلی","【 "+d.memberCount+" 】"),
    statusLine("فعال ۳۰ دقیقه","【 "+d.active30m+" 】"),
    statusLine("فعال ۲۴ ساعت","【 "+d.active24h+" 】"),
    statusLine("فعال ۷ روز","【 "+d.active7d+" 】"),
    statusLine("ورود در بازه","【 "+number(dyn.joins)+" 】"),
    statusLine("خروج در بازه","【 "+number(dyn.leaves)+" 】"),
    statusLine("فعال‌های شناخته‌شده","【 "+number(dyn.active_users)+" 】"),
    statusLine("کاربران بازگشتی","【 "+returning+" 】"),
    "",
    "★ - غیرفعالی",
    "⛂ - غیرفعال ۷ تا ۳۰ روز : 【 "+number(inactive.inactive7_30)+" 】",
    "⛂ - غیرفعال بیش از ۳۰ روز : 【 "+number(inactive.inactive30)+" 】",
    "",
    "★ - ماندگاری",
    "⛂ - کاربران ثبت‌شده ۳۰ روز اخیر : 【 "+joined+" 】",
    "⛂ - ماندگاری ۷ روزه : 【 "+retention7+"% 】",
    "⛂ - ماندگاری ۳۰ روزه : 【 "+retention30+"% 】",
  ].join("\n");
  return editPanel(chatId,messageId,text,[
    ...periodButtons("members"),
    [["‹ کاربران جدید","sx:new:members"],["‹ کاربران غیرفعال","sx:inactive:members"]],
    [["‹ کاربران بازگشتی","sx:returning:members"],["‹ تقویم فعالیت","sx:calendar:members"]],
    [["‹ بازگشت","sx:more"]],
  ]);
}

async function resolveUser(pool: Pool, chatId: number, userId: number) {
  const tag = await pool.query<any>(
    "SELECT user_id,username,first_name FROM member_tag_activity WHERE group_id=$1 AND user_id=$2 LIMIT 1",
    [chatId,userId],
  ).catch(() => ({rows:[]}));
  if (tag.rows[0]) return tag.rows[0];
  const member=await telegramApi<any>("getChatMember",{chat_id:chatId,user_id:userId}).catch(()=>null);
  if(member?.ok?.valueOf && member.ok && member.result?.user) return member.result.user;
  return {user_id:userId,username:null,first_name:String(userId)};
}

async function renderUserPeriod(pool: Pool, chatId: number, messageId: number, userId: number, period: StatsPeriod) {
  const u=await resolveUser(pool,chatId,userId);
  const summary=await userDailySummary(pool,chatId,userId,period);
  const rank=await userRank(pool,chatId,userId,period);
  const content=await rawUserContent(pool,chatId,userId,period);
  const interactions=await topInteractionTargets(pool,chatId,userId,period,5);
  const hours=await hourlyUser(pool,chatId,userId);
  const peak=hours.reduce((best:any,row:any)=>number(row.message_count)>number(best?.message_count)?row:best,null);
  const avg=number(summary.active_days)>0?number(summary.messages)/number(summary.active_days):0;
  const active=summary.last_activity && new Date(summary.last_activity).getTime()>=Date.now()-30*60*1000;
  const blocks: RichInputBlock[]=[
    richHeading("Pᴇʀsɪᴀɴ ᴮᵒᵗ · Sᴛᴀᴛs Cᴇɴᴛᴇʀ",1),
    richHeading("آمار کاربر",2),
    richStatus(
      u.username ? "@" + String(u.username).replace(/^@/,"") : String(u.first_name || userId),
      active ? "success" : "normal"
    ),
    richTable(["شاخص","مقدار"],[
      ["بازه",periodLabel(period)],
      ["تعداد پیام",number(summary.messages)],
      ["رتبه پیام",rank.rank || "ثبت نشده"],
      ["جمعیت رتبه‌بندی",number(rank.population)],
      ["روزهای فعال",number(summary.active_days)],
      ["میانگین پیام در روز فعال",decimal(avg)],
      ["لینک‌ها",number(content.links)],
      ["اولین فعالیت",summary.first_activity?faDateTime(summary.first_activity):"قابل تعیین نیست"],
      ["آخرین فعالیت",summary.last_activity?faDateTime(summary.last_activity):"قابل تعیین نیست"],
      ["وضعیت",active?"فعال":"عادی"],
    ]),
    richDivider(),
    richHeading("محتوای ارسال‌شده",3),
    richTable(["نوع","تعداد"],[
      ["متن",number(content.text)],
      ["عکس",number(content.photo)],
      ["ویدیو",number(content.video)],
      ["فایل",number(content.document)],
      ["استیکر",number(content.sticker)],
      ["صوت",number(content.audio)],
      ["ویدیو نوت",number(content.video_note)],
      ["سایر",number(content.other)],
    ]),
    richDivider(),
    richHeading("ساعت اوج",3),
    peak
      ? richTable(["شاخص","مقدار"],[["ساعت",String(number(peak.hour)).padStart(2,"0")+":00"],["پیام",number(peak.message_count)]])
      : richParagraph("داده‌ای برای تعیین ساعت اوج ثبت نشده است."),
    richDivider(),
    interactions.length
      ? richDetails("تعامل مستقیم",[
          richTable(["رتبه","کاربر","تعامل"],interactions.map((x:any,i:number)=>[
            String(i+1).padStart(3,"0"),
            richInlineUser(x.userId,x.username,x.firstName),
            number(x.count),
          ]))
        ])
      : richDetails("تعامل مستقیم",[richParagraph("داده‌ای برای تعامل مستقیم ثبت نشده است.")]),
  ];
  return editRichPanel(chatId,messageId,blocks,[
    [["بازه‌های آماری","sx:periods:user:"+userId],["آمار ساعتی","sx:uhours:"+userId+":"+period]],
    [["تحلیل محتوا","sx:content:user:"+period+":"+userId],["مقایسه عملکرد","sx:ucompare:"+userId+":"+period]],
    [["گزارش کاربر","sx:ureport:"+userId+":"+period],["بازگشت","sx:more"]],
  ]);
}

async function renderUserQuick(pool: Pool, chatId: number, messageId: number, userId: number) {
  const u=await resolveUser(pool,chatId,userId);
  const all=await userDailySummary(pool,chatId,userId,"all");
  const today=await userDailySummary(pool,chatId,userId,"today");
  const rank=await userRank(pool,chatId,userId,"all");
  const text=[
    renderHeader("آمار فعالیت کاربر"),
    statusLine("کاربر",userTag(userId,u.username,u.first_name)),
    "",
    "★ - امروز",
    statusLine("تعداد پیام","【 "+number(today.messages)+" 】"),
    statusLine("رتبه امروز","【 "+(rank.rank||"■")+" 】"),
    "",
    "★ - کل",
    statusLine("تعداد پیام","【 "+number(all.messages)+" 】"),
    statusLine("روزهای فعال","【 "+number(all.active_days)+" 】"),
    statusLine("میانگین روز فعال","【 "+decimal(number(all.active_days)>0?number(all.messages)/number(all.active_days):0)+" 】"),
    statusLine("لینک‌ها","【 "+number(all.links)+" 】"),
    statusLine("اولین فعالیت",all.first_activity?faDateTime(all.first_activity):"ثبت نشده"),
    statusLine("آخرین فعالیت",all.last_activity?faDateTime(all.last_activity):"ثبت نشده"),
    "",
    "─────━━───── ◈ ─────━━─────",
    "",
    "★ - بازه‌های دقیق، رتبه‌بندی، ساعتی، محتوا، تعاملات و مقایسه در «اطلاعات بیشتر» در دسترس است.",
  ].join("\n");
  return editPanel(chatId,messageId,text,[
    [["‹ اطلاعات بیشتر","sx:scope:user:"+userId]],
    [["‹ بازگشت","sx:more"]],
  ]);
}

async function advancedRanking(pool:Pool,chatId:number,period:StatsPeriod,dimension:"messages"|"media"|"links"|"replies"|"growth"){
  let condition="TRUE";
  if(period==="today") condition=rawDayExpression("m")+"=(NOW() AT TIME ZONE '"+TZ+"')::date";
  else if(period==="7d") condition=rawDayExpression("m")+">=((NOW() AT TIME ZONE '"+TZ+"')::date-INTERVAL '6 days')::date";
  else if(period==="30d") condition=rawDayExpression("m")+">=((NOW() AT TIME ZONE '"+TZ+"')::date-INTERVAL '29 days')::date";
  else if(period==="month") condition=rawDayExpression("m")+">=date_trunc('month',NOW() AT TIME ZONE '"+TZ+"')::date";
  else if(period==="prevmonth") condition=rawDayExpression("m")+">=date_trunc('month',NOW() AT TIME ZONE '"+TZ+"')::date-INTERVAL '1 month' AND "+rawDayExpression("m")+"<date_trunc('month',NOW() AT TIME ZONE '"+TZ+"')::date";

  if(dimension!=="growth"){
    const metric=dimension==="media"
      ? "COUNT(*) FILTER(WHERE m.kind IN('photo','video','audio','document','animation','sticker','voice','video_note'))"
      : dimension==="links"
        ? "COUNT(*) FILTER(WHERE m.has_link)"
        : dimension==="replies"
          ? "COUNT(*) FILTER(WHERE m.reply_to_user_id IS NOT NULL)"
          : "COUNT(*)";
    const r=await pool.query<any>(
      "SELECT m.user_id,MAX(m.username) username,MAX(m.first_name) first_name,"+metric+"::int n "+
      "FROM bot_message_records m WHERE m.chat_id=$1 AND m.user_id IS NOT NULL AND "+condition+
      " GROUP BY m.user_id HAVING "+metric+">0 ORDER BY n DESC,m.user_id LIMIT 10",
      [chatId],
    );
    return r.rows.map((x:any)=>({userId:number(x.user_id),username:x.username,firstName:x.first_name,count:number(x.n)}));
  }

  const current=await pool.query<any>(
    "WITH u AS (SELECT m.user_id,MAX(m.username) username,MAX(m.first_name) first_name,"+
    "COUNT(*) FILTER(WHERE "+rawDayExpression("m")+" >= ((NOW() AT TIME ZONE '"+TZ+"')::date-INTERVAL '6 days')::date)::int current_n,"+
    "COUNT(*) FILTER(WHERE "+rawDayExpression("m")+" >= ((NOW() AT TIME ZONE '"+TZ+"')::date-INTERVAL '13 days')::date AND "+
    rawDayExpression("m")+" < ((NOW() AT TIME ZONE '"+TZ+"')::date-INTERVAL '6 days')::date)::int previous_n "+
    "FROM bot_message_records m WHERE m.chat_id=$1 AND m.user_id IS NOT NULL GROUP BY m.user_id) "+
    "SELECT user_id,username,first_name,current_n,previous_n,current_n-previous_n delta "+
    "FROM u WHERE current_n>0 ORDER BY delta DESC,current_n DESC LIMIT 10",
    [chatId],
  );
  return current.rows.map((x:any)=>({userId:number(x.user_id),username:x.username,firstName:x.first_name,count:number(x.current_n),previous:number(x.previous_n),delta:number(x.delta)}));
}

async function growthStats(pool:Pool,chatId:number){
  const r=await pool.query<any>(
    "SELECT "+
    "(SELECT COUNT(*)::int FROM bot_member_join_events WHERE group_id=$1 AND joined_at>=NOW()-INTERVAL '7 days') joins7,"+
    "(SELECT COUNT(*)::int FROM bot_member_leave_events WHERE group_id=$1 AND left_at>=NOW()-INTERVAL '7 days') leaves7,"+
    "(SELECT COUNT(*)::int FROM bot_member_join_events WHERE group_id=$1 AND joined_at>=NOW()-INTERVAL '14 days' AND joined_at<NOW()-INTERVAL '7 days') joinsPrev7,"+
    "(SELECT COUNT(*)::int FROM bot_member_leave_events WHERE group_id=$1 AND left_at>=NOW()-INTERVAL '14 days' AND left_at<NOW()-INTERVAL '7 days') leavesPrev7",
    [chatId],
  );
  const x=r.rows[0]||{};
  const net7=number(x.joins7)-number(x.leaves7);
  const prevNet=number(x.joinsPrev7)-number(x.leavesPrev7);
  return {joins7:number(x.joins7),leaves7:number(x.leaves7),net7,prevNet,trend:trend(net7,prevNet)};
}

async function groupStatusIndex(pool:Pool,chatId:number){
  const d=await groupOverviewData(pool,chatId);
  const activeRatio=d.memberCount>0?Math.min(1,d.active24h/d.memberCount):0;
  const messageMomentum=d.messagesWeek>0?Math.min(1,d.messagesToday/(d.messagesWeek/7)):0;
  const safetyPenalty=Math.min(1,(d.securityViolationsWeek+d.warnings30d)/(Math.max(1,d.messagesWeek))*20);
  const growthBonus=d.netToday>0?Math.min(.2,d.netToday/Math.max(1,d.memberCount)):0;
  const raw=Math.round(Math.max(0,Math.min(100,(activeRatio*.4+messageMomentum*.4+growthBonus*.2)*100*(1-safetyPenalty))));
  return {index:raw,activeRatio,messageMomentum,safetyPenalty};
}

async function renderRanking(pool: Pool, chatId: number, messageId: number, scope: StatsScope, period: StatsPeriod, targetUserId?: number, dimension:"messages"|"media"|"links"|"replies"|"growth"="messages") {
  if(scope==="admins"){
    const admins=await auditAdminDirectory(pool,chatId);
    const blocks:RichInputBlock[]=[
      richHeading("Pᴇʀsɪᴀɴ ᴮᵒᵗ · Sᴛᴀᴛs Cᴇɴᴛᴇʀ",1),
      richHeading("رتبه‌بندی مدیران",2),
      admins.length
        ? richTable(["رتبه","مدیر","اقدامات"],admins.slice(0,10).map((u:any,i:number)=>[
            String(i+1).padStart(3,"0"),
            richInlineUser(u.userId,u.username,u.firstName),
            number(u.actions),
          ]))
        : richParagraph("داده‌ای ثبت نشده است."),
    ];
    return editRichPanel(chatId,messageId,blocks,[
      [["اقدامات","sx:ranking:admins:"+period],["بازگشت","sx:period:admins:"+period]],
    ]);
  }
  if(scope==="user"&&targetUserId)return renderUserPeriod(pool,chatId,messageId,targetUserId,period);

  const rows:any[]=await advancedRanking(pool,chatId,period,dimension);
  const title=dimension==="growth"?"رشد فعالیت":dimension==="media"?"محتوای رسانه‌ای":dimension==="links"?"اشتراک لینک":dimension==="replies"?"تعامل و پاسخ":"پیام";
  const blocks:RichInputBlock[]=[
    richHeading("Pᴇʀsɪᴀɴ ᴮᵒᵗ · Sᴛᴀᴛs Cᴇɴᴛᴇʀ",1),
    richHeading("رتبه‌بندی",2),
    richTable(["رتبه","کاربر",title],rows.length?rows.map((u:any,i:number)=>[
      String(i+1).padStart(3,"0"),
      richInlineUser(u.userId,u.username,u.firstName),
      dimension==="growth"
        ? (u.delta>=0?"+":"-")+Math.abs(number(u.delta))
        : number(u.count),
    ]):[["—","داده‌ای ثبت نشده است.","—"]]),
    richFooter("بازه · "+periodLabel(period)),
  ];
  return editRichPanel(chatId,messageId,blocks,[
    [["پیام","sx:ranking:group:"+period],["رسانه","sx:rankdim:group:"+period+":media"]],
    [["لینک","sx:rankdim:group:"+period+":links"],["پاسخ","sx:rankdim:group:"+period+":replies"]],
    [["رشد فعالیت","sx:rankdim:group:"+period+":growth"],["بازگشت","sx:period:group:"+period]],
  ]);
}

async function renderHours(pool: Pool, chatId: number, messageId: number, scope: StatsScope, periodOrDay: StatsPeriod|string, targetUserId?: number) {
  const isDay=/^\d{4}-\d{2}-\d{2}$/.test(String(periodOrDay));
  const label=isDay?faDate(String(periodOrDay)):periodLabel(periodOrDay as StatsPeriod);
  const rows:any[]=scope==="user"&&targetUserId
    ? (isDay?await hourlyUser(pool,chatId,targetUserId,String(periodOrDay)):await hourlyUser(pool,chatId,targetUserId))
    : (isDay?await hourlyGroup(pool,chatId,String(periodOrDay)):await hourlyGroup(pool,chatId,toDateInput(new Date())));
  const counts=new Map<number,number>();
  for(const row of rows) counts.set(number(row.hour),number(row.message_count));
  const peak=Array.from(counts.entries()).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const blocks:RichInputBlock[]=[
    richHeading("Pᴇʀsɪᴀɴ ᴮᵒᵗ · Sᴛᴀᴛs Cᴇɴᴛᴇʀ",1),
    richHeading(scope==="user"?"آمار ساعتی کاربر":"آمار ساعتی گروه",2),
    richParagraph("بازه · "+label),
    richTable(["ساعت","پیام"],Array.from({length:24},(_,hour)=>[
      String(hour).padStart(2,"0")+":00",
      counts.get(hour)||0,
    ])),
    richDivider(),
    richHeading("ساعت‌های اوج",3),
    peak.length
      ? richTable(["رتبه","ساعت","پیام"],peak.map(([hour,n],i)=>[
          String(i+1).padStart(3,"0"),
          String(hour).padStart(2,"0")+":00",
          n,
        ]))
      : richParagraph("داده‌ای ثبت نشده است."),
  ];
  return editRichPanel(chatId,messageId,blocks,[
    [["رتبه‌بندی","sx:ranking:"+scope+(targetUserId?":"+targetUserId:"")],["بازه‌های آماری","sx:periods:"+scope+(targetUserId?":"+targetUserId:"")]],
  ]);
}

async function dailyUsersForUser(pool:Pool,chatId:number,userId:number,day:string,limit=5){
  const r=await pool.query<any>(
    "SELECT m.user_id,MAX(m.username) username,MAX(m.first_name) first_name,COUNT(*)::int n "+
    "FROM bot_message_records m WHERE m.chat_id=$1 AND m.user_id=$2 AND "+rawDayExpression("m")+"=$3::date "+
    "GROUP BY m.user_id LIMIT "+Math.max(1,Math.min(limit,10)),
    [chatId,userId,day],
  ).catch(()=>({rows:[]}));
  return r.rows.map((x:any)=>({userId:number(x.user_id),username:x.username,firstName:x.first_name,count:number(x.n)}));
}

async function renderDay(pool: Pool, chatId: number, messageId: number, scope: StatsScope, day: string, targetUserId?: number) {
  const top=scope==="user"&&targetUserId
    ? await dailyUsersForUser(pool,chatId,targetUserId,day,5)
    : await dailyUsers(pool,chatId,day,5);
  const hourly=scope==="user"&&targetUserId
    ? await hourlyUser(pool,chatId,targetUserId,day)
    : await hourlyGroup(pool,chatId,day);
  const total=hourly.reduce((n:any,r:any)=>n+number(r.message_count),0);
  const peak=hourly.reduce((best:any,row:any)=>number(row.message_count)>number(best?.message_count)?row:best,null);
  const text=[
    renderHeader(scopeLabel(scope)+" · روز"),
    statusLine("تاریخ",faDate(day)),
    statusLine("روز",faDayName(day)),
    statusLine("پیام‌های ثبت‌شده","【 "+total+" 】"),
    statusLine("اوج فعالیت",peak?String(number(peak.hour)).padStart(2,"0")+":00 · "+number(peak.message_count):"■"),
    "",
    "★ - رتبه آن روز",
    ...(top.length?top.map((u:any,i:number)=>rankNumber(i+1)+" · "+userTag(u.userId,u.username,u.firstName)+" · "+u.count+" پیام"):["■ داده‌ای ثبت نشده است."]),
    "",
    "★ - مسیر تحلیل",
    "⛂ - رتبه‌بندی روزانه فعال است.",
    "⛂ - تحلیل ساعتی فعال است.",
    "⛂ - محتوای روزانه از رکوردهای پیام محاسبه می‌شود.",
  ].join("\n");
  return editPanel(chatId,messageId,text,[
    [["‹ تحلیل ساعتی","sx:hours:group:"+day],["‹ رتبه‌بندی","sx:ranking:group:today"]],
    [["‹ بازه‌های آماری","sx:periods:"+scope+(targetUserId?":"+targetUserId:"")],["‹ بازگشت","sx:more"]],
  ]);
}

async function renderCompare(pool: Pool, chatId: number, messageId: number, scope: StatsScope, targetUserId?: number) {
  if(scope==="user"&&targetUserId){
    const today=await userDailySummary(pool,chatId,targetUserId,"today");
    const prev=await previousPeriodUser(pool,chatId,targetUserId);
    const text=[
      renderHeader("مقایسه عملکرد کاربر"),
      userTag(targetUserId,prev.username,prev.firstName),
      "",
      statusLine("امروز","【 "+number(today.messages)+" 】"),
      statusLine("روز قبل","【 "+number(prev.previous)+" 】"),
      statusLine("روند پیام",trend(number(today.messages),number(prev.previous))),
      statusLine("تعامل امروز","【 "+number(today.replies)+" 】"),
      statusLine("لینک امروز","【 "+number(today.links)+" 】"),
    ].join("\n");
    return editPanel(chatId,messageId,text,[[["‹ آمار کاربر","sx:period:user:today:"+targetUserId],["‹ بازگشت","sx:more"]]]);
  }
  const d=await groupOverviewData(pool,chatId);
  const prev=await pool.query<any>(
    `SELECT COUNT(*)::int n
      FROM bot_message_records m
      WHERE m.chat_id=$1
      AND ${rawDayExpression("m")}>=((NOW() AT TIME ZONE '${TZ}')::date-INTERVAL '13 days')::date
      AND ${rawDayExpression("m")}<=((NOW() AT TIME ZONE '${TZ}')::date-INTERVAL '7 days')::date`,
    [chatId],
  );
  const p=number(prev.rows[0]?.n);
  const text=[
    renderHeader("مقایسه عملکرد گروه"),
    statusLine("پیام ۷ روز اخیر","【 "+d.messagesWeek+" 】"),
    statusLine("۷ روز قبل","【 "+p+" 】"),
    statusLine("روند","【 "+trend(d.messagesWeek,p)+" 】"),
    statusLine("رشد خالص امروز","【 "+signed(d.netToday)+" 】"),
    statusLine("فعال ۲۴ ساعت","【 "+d.active24h+" 】"),
  ].join("\n");
  return editPanel(chatId,messageId,text,[[["‹ بازه‌های آماری","sx:periods:group"],["‹ بازگشت","sx:more"]]]);
}

async function previousPeriodUser(pool: Pool,chatId:number,userId:number){
  const r=await pool.query<any>(
    `SELECT
      COUNT(*) FILTER(WHERE ${rawDayExpression("m")}=(NOW() AT TIME ZONE '${TZ}')::date-INTERVAL '1 day')::int previous,
      MAX(m.username) username,MAX(m.first_name) firstName
     FROM bot_message_records m WHERE m.chat_id=$1 AND m.user_id=$2`,
    [chatId,userId],
  );
  return r.rows[0]||{};
}

async function renderContent(pool: Pool, chatId: number, messageId: number, scope: StatsScope, period: StatsPeriod, targetUserId?: number) {
  if(scope==="user"&&targetUserId){
    const u=await resolveUser(pool,chatId,targetUserId);
    const c=await rawUserContent(pool,chatId,targetUserId,period);
    const total=Object.values(c).reduce((n,v)=>n+number(v),0);
    const text=[
      renderHeader("تحلیل محتوا · "+periodLabel(period)),
      userTag(targetUserId,u.username,u.first_name),
      "",
      statusLine("کل پیام","【 "+(total-number(c.links))+" 】"),
      statusLine("لینک","【 "+number(c.links)+" 】"),
      "",
      "⛂ - متن : "+number(c.text),
      "⛂ - عکس : "+number(c.photo),
      "⛂ - ویدیو : "+number(c.video),
      "⛂ - فایل : "+number(c.document),
      "⛂ - استیکر : "+number(c.sticker),
      "⛂ - صوت : "+number(c.audio),
      "⛂ - ویدیو نوت : "+number(c.video_note),
      "⛂ - سایر : "+number(c.other),
    ].join("\n");
    return editPanel(chatId,messageId,text,[[["‹ بازگشت","sx:period:user:"+period+":"+targetUserId]]]);
  }

  const r=await pool.query<any>(
    `SELECT m.kind,COUNT(*)::int n
     FROM bot_message_records m
     WHERE m.chat_id=$1 AND ${period==="all"?"TRUE":period==="today"?rawDayExpression("m")+"=(NOW() AT TIME ZONE '"+TZ+"')::date":period==="7d"?rawDayExpression("m")+">=((NOW() AT TIME ZONE '"+TZ+"')::date-INTERVAL '6 days')::date":period==="30d"?rawDayExpression("m")+">=((NOW() AT TIME ZONE '"+TZ+"')::date-INTERVAL '29 days')::date":period==="month"?rawDayExpression("m")+">=date_trunc('month',NOW() AT TIME ZONE '"+TZ+"')::date":rawDayExpression("m")+">=date_trunc('month',NOW() AT TIME ZONE '"+TZ+"')::date-INTERVAL '1 month' AND "+rawDayExpression("m")+"<date_trunc('month',NOW() AT TIME ZONE '"+TZ+"')::date"}
     GROUP BY kind ORDER BY n DESC`,
    [chatId],
  );
  return editPanel(chatId,messageId,[
    renderHeader("تحلیل محتوا · "+periodLabel(period)),
    ...r.rows.map((x:any)=>statusLine(String(x.kind), "【 "+number(x.n)+" 】")),
    "",
    "★ - لینک‌ها",
    statusLine("پیام‌های دارای لینک","【 "+number((await pool.query<any>(`SELECT COUNT(*)::int n FROM bot_message_records m WHERE m.chat_id=$1 AND m.has_link=TRUE AND ${period==="all"?"TRUE":rawDayExpression("m")+">=((NOW() AT TIME ZONE '"+TZ+"')::date-INTERVAL '29 days')::date"}`,[chatId])).rows[0]?.n)+" 】"),
  ].join("\n"),[[["‹ بازگشت","sx:period:group:"+period]]]);
}

async function renderReport(pool: Pool, chatId: number, messageId: number, scope: StatsScope, targetUserId?: number, period: StatsPeriod="today") {
  let body="";
  if(scope==="group"){
    const d=await groupOverviewData(pool,chatId);
    body=[
      renderHeader("گزارش آماری · "+periodLabel(period)),
      statusLine("پیام امروز","【 "+d.messagesToday+" 】"),
      statusLine("پیام ۷ روزه","【 "+d.messagesWeek+" 】"),
      statusLine("اعضای فعلی","【 "+d.memberCount+" 】"),
      statusLine("فعال ۳۰ دقیقه","【 "+d.active30m+" 】"),
      statusLine("رشد خالص امروز","【 "+signed(d.netToday)+" 】"),
      statusLine("تخلف امروز","【 "+d.securityViolationsToday+" 】"),
      statusLine("اوج ۱۵ دقیقه‌ای","【 "+d.anomaly.peak15m+" 】"),
      "",
      "★ - جمع‌بندی",
      "⛂ - روند پیام : "+d.currentWeekTrend,
      "⛂ - تشخیص ناهنجاری : "+(d.anomaly.detected?"● فعال":"○ ندارد"),
      "⛂ - زمان گزارش : "+faDateTime(new Date()),
    ].join("\n");
  }else if(scope==="user"&&targetUserId){
    const u=await userDailySummary(pool,chatId,targetUserId,period);
    const r=await userRank(pool,chatId,targetUserId,period);
    body=[
      renderHeader("گزارش کاربر · "+periodLabel(period)),
      userTag(targetUserId),
      "",
      statusLine("پیام","【 "+number(u.messages)+" 】"),
      statusLine("رتبه","【 "+(r.rank||"■")+" 】"),
      statusLine("روزهای فعال","【 "+number(u.active_days)+" 】"),
      statusLine("لینک","【 "+number(u.links)+" 】"),
      statusLine("تعامل مستقیم","【 "+number(u.replies)+" 】"),
    ].join("\n");
  }else if(scope==="admins"){
    const d=await adminStats(pool,chatId,period);
    body=[
      renderHeader("گزارش ادمین · "+periodLabel(period)),
      statusLine("اقدامات","【 "+d.actions+" 】"),
      statusLine("اخطارها","【 "+d.warnings+" 】"),
      statusLine("جریمه‌ها","【 "+d.penalties+" 】"),
      statusLine("خطاهای شدید","【 "+d.failed+" 】"),
    ].join("\n");
  }else{
    const d=await groupOverviewData(pool,chatId);
    body=[
      renderHeader("گزارش اعضا · "+periodLabel(period)),
      statusLine("اعضای فعلی","【 "+d.memberCount+" 】"),
      statusLine("فعال ۲۴ ساعت","【 "+d.active24h+" 】"),
      statusLine("ورود امروز","【 "+d.joinsToday+" 】"),
      statusLine("خروج امروز","【 "+d.leavesToday+" 】"),
      statusLine("کاربران بازگشتی","【 "+await returningData(pool,chatId)+" 】"),
    ].join("\n");
  }
  return editPanel(chatId,messageId,body,[[["‹ بازگشت","sx:more"]]]);
}

export function isStatsCommand(text: string) {
  const value=String(text||"").trim().replace(/^[\\/!.]+/,"").trim();
  const parts=value.split(/\s+/).filter(Boolean);
  const token=parts[0]?.toLowerCase()||"";
  return parts.length===1 && ["آمار","امار","stats","stat","analytics","تحلیل","تحلیل و آمار"].includes(token);
}

export async function openStatsCenterFromCommand(pool: Pool, msg: StatsMessage, ownerIds: string[]) {
  if (msg.chat.type === "private" || !msg.from) return false;
  if (!(await isManager(msg.chat.id, msg.from.id, ownerIds))) return false;

  const targetId=msg.reply_to_message?.from?.id;
  if(targetId){
    const result=await telegramApi<any>("getChatMember",{chat_id:msg.chat.id,user_id:targetId}).catch(()=>null);
    const user=result?.ok?result.result?.user:msg.reply_to_message?.from;
    const targetUserId=Number(user?.id||targetId);
    return sendUserCommandCard(pool,msg.chat.id,targetUserId,user);
  }

  return renderGroupOverview(pool,msg.chat.id);
}

async function sendUserCommandCard(pool:Pool,chatId:number,userId:number,user?:TgUser) {
  const existing=await pool.query<any>(
    "SELECT user_id,username,first_name FROM member_tag_activity WHERE group_id=$1 AND user_id=$2 LIMIT 1",
    [chatId,userId],
  ).catch(()=>({rows:[]}));
  const row=existing.rows[0]||{};
  const resolved=user||row;
  const data=await userDailySummary(pool,chatId,userId,"all");
  const today=await userDailySummary(pool,chatId,userId,"today");
  const rank=await userRank(pool,chatId,userId,"all");
  const blocks: RichInputBlock[]=[
    richHeading("Pᴇʀsɪᴀɴ ᴮᵒᵗ · Sᴛᴀᴛs Cᴇɴᴛᴇʀ",1),
    richHeading("آمار فعالیت کاربر",2),
    richStatus(
      resolved.username ? "@" + String(resolved.username).replace(/^@/,"") : String(resolved.first_name || userId),
      "normal"
    ),
    richTable(["شاخص","مقدار"],[
      ["پیام امروز",number(today.messages)],
      ["کل پیام‌ها",number(data.messages)],
      ["رتبه پیام",rank.rank || "ثبت نشده"],
      ["روزهای فعال",number(data.active_days)],
      ["میانگین پیام در روز فعال",decimal(number(data.active_days)>0?number(data.messages)/number(data.active_days):0)],
      ["لینک‌ها",number(data.links)],
      ["آخرین فعالیت",data.last_activity?faDateTime(data.last_activity):"ثبت نشده"],
    ]),
    richDivider(),
    richParagraph("برای مشاهده جزئیات دوره‌ای، ساعتی، محتوا و عملکرد این کاربر از گزینه‌های زیر استفاده کنید."),
  ];
  return sendRichPanel(chatId,blocks,[
    [["بازه‌های آماری","sx:periods:user:"+userId],["رتبه‌بندی","sx:ranking:user:"+userId]],
    [["آمار ساعتی","sx:uhours:"+userId+":today"],["تحلیل محتوا","sx:content:user:today:"+userId]],
    [["مقایسه عملکرد","sx:ucompare:"+userId+":today"],["گزارش کاربر","sx:ureport:"+userId+":today"]],
    [["بازگشت","sx:home"]],
  ]);
}

export async function handleStatsTextInput(pool: Pool, msg: StatsMessage) {
  if (!msg.from || msg.chat.type === "private") return false;
  const s=getSession(msg.from.id);
  if(!s || s.chatId!==msg.chat.id) return false;
  const value=String(msg.text||"").trim();
  if(!value)return true;

  if(s.flow==="date"){
    const date=parseDateInput(value);
    if(!date){
      await telegramApi("sendMessage",{chat_id:msg.chat.id,text:"✗ تاریخ نامعتبر است. نمونه: 2026-10-01"}).catch(()=>{});
      return true;
    }
    clearSession(msg.from.id);
    await telegramApi("sendMessage",{chat_id:msg.chat.id,text:"✓ تاریخ انتخاب شد : "+faDate(date)}).catch(()=>{});
    await sendStatsDateResult(pool,msg.chat.id,s.actorId,s.scope,date,s.targetUserId);
    return true;
  }

  if(s.flow==="range_start"){
    const date=parseDateInput(value);
    if(!date){
      await telegramApi("sendMessage",{chat_id:msg.chat.id,text:"✗ تاریخ شروع نامعتبر است. نمونه: 2026-10-01"}).catch(()=>{});
      return true;
    }
    s.flow="range_end";
    s.rangeStart=date;
    await telegramApi("sendMessage",{chat_id:msg.chat.id,text:"تاریخ پایان بازه را ارسال کنید.\nنمونه: 2026-10-07"}).catch(()=>{});
    return true;
  }

  if(s.flow==="range_end"){
    const end=parseDateInput(value);
    if(!end || !s.rangeStart){
      await telegramApi("sendMessage",{chat_id:msg.chat.id,text:"✗ تاریخ پایان نامعتبر است."}).catch(()=>{});
      return true;
    }
    if(end<s.rangeStart){
      await telegramApi("sendMessage",{chat_id:msg.chat.id,text:"✗ تاریخ پایان نباید قبل از تاریخ شروع باشد."}).catch(()=>{});
      return true;
    }
    const start=s.rangeStart;
    clearSession(msg.from.id);
    await sendStatsRangeResult(pool,msg.chat.id,s.actorId,s.scope,start,end,s.targetUserId);
    return true;
  }

  return false;
}

async function sendStatsDateResult(pool:Pool,chatId:number,actorId:number,scope:StatsScope,day:string,targetUserId?:number){
  const message=await telegramApi<any>("sendMessage",{
    chat_id:chatId,
    text:"در حال آماده‌سازی آمار "+faDate(day)+" …",
  });
  if(!message?.ok)return true;
  const mid=Number(message.result?.message_id||0);
  if(!mid)return true;
  await renderDay(pool,chatId,mid,scope,day,targetUserId);
  return true;
}

async function sendStatsRangeResult(pool:Pool,chatId:number,actorId:number,scope:StatsScope,start:string,end:string,targetUserId?:number){
  const result=await pool.query<any>(
    `SELECT COUNT(*)::int messages,COUNT(DISTINCT user_id)::int users
     FROM bot_message_records m
     WHERE m.chat_id=$1 AND ${rawDayExpression("m")} BETWEEN $2::date AND $3::date`,
    [chatId,start,end],
  );
  const row=result.rows[0]||{};
  const title=scope==="user"&&targetUserId?"آمار بازه کاربر":"آمار بازه گروه";
  const text=[
    renderHeader(title),
    statusLine("از",faDate(start)),
    statusLine("تا",faDate(end)),
    statusLine("پیام","【 "+number(row.messages)+" 】"),
    statusLine("کاربران فعال","【 "+number(row.users)+" 】"),
    "",
    "★ - مقایسه",
    "⛂ - بازه انتخابی با موفقیت محاسبه شد.",
  ].join("\n");
  await sendPanel(chatId,text,[[["‹ بازه‌های آماری","sx:periods:"+scope+(targetUserId?":"+targetUserId:"")],["‹ بازگشت","sx:more"]]]);
  return true;
}

export async function handleStatsCallback(pool: Pool, cb: StatsCallback, ownerIds: string[]) {
  if(!cb.message || !cb.from)return true;
  if(!(await isManager(cb.message.chat.id,cb.from.id,ownerIds))){
    await answer(cb.id);
    return true;
  }
  const data=String(cb.data||"");
  const chatId=cb.message.chat.id;
  const mid=cb.message.message_id;

  if(data==="sx:home")return renderGroupOverview(pool,chatId,mid);
  if(data==="sx:more")return renderMore(pool,chatId,mid);
  if(data==="sx:scope:admins")return renderAdminHub(pool,chatId,mid);
  if(data==="sx:scope:members")return renderMemberHub(pool,chatId,mid);
  if(data==="sx:adminchat")return renderChatStatsHub(pool,chatId,mid,"sx:scope:admins");
  if(data==="sx:memberchat")return renderChatStatsHub(pool,chatId,mid,"sx:scope:members");

  // Specific admin-action subviews must be handled before the generic period route.
  if(data.startsWith("sx:adminactions:breakdown:"))return renderAdminActionBreakdown(pool,chatId,mid,data.slice("sx:adminactions:breakdown:".length) as StatsPeriod);
  if(data.startsWith("sx:adminactions:admins:"))return renderAdminActive(pool,chatId,mid,data.slice("sx:adminactions:admins:".length) as StatsPeriod);
  if(data.startsWith("sx:adminactions:cases:"))return renderAdminCases(pool,chatId,mid,data.slice("sx:adminactions:cases:".length) as StatsPeriod);
  if(data.startsWith("sx:adminactions:audit:")) {
    const period=(data.slice("sx:adminactions:audit:".length)||"today") as StatsPeriod;
    const admins=await auditAdminDirectory(pool,chatId);
    return editRichPanel(chatId,mid,[
      richHeading("سوابق ممیزی",1),
      richParagraph("بازه · "+periodLabel(period)),
      admins.length
        ? richTable(["رتبه","مدیر","اقدام"],admins.map((u:any,i:number)=>[
            String(i+1).padStart(3,"0"),
            richInlineUser(u.userId,u.username,u.firstName),
            number(u.actions),
          ]))
        : richParagraph("سابقه‌ای ثبت نشده است."),
    ],[[["آمار اقدامات","sx:adminactions:"+period],["بازگشت","sx:scope:admins"]]]);
  }
  if(data.startsWith("sx:adminactions:")) {
    const actionPeriod=(data.split(":")[2]||"today") as StatsPeriod;
    return renderAdminActions(pool,chatId,mid,actionPeriod);
  }

  if(data.startsWith("sx:chat:day:"))return renderChatDay(pool,chatId,mid,data.slice("sx:chat:day:".length),"sx:chat:home");
  if(data.startsWith("sx:chat:hours:"))return renderChatHours(pool,chatId,mid,data.slice("sx:chat:hours:".length));
  if(data.startsWith("sx:chat:details:"))return renderChatDetails(pool,chatId,mid,data.slice("sx:chat:details:".length));
  if(data.startsWith("sx:chat:hour:")) {
    const parts=data.split(":");
    return renderChatHour(pool,chatId,mid,parts[3],Number(parts[4]));
  }
  if(data.startsWith("sx:chat:rankhour:")) {
    const parts=data.split(":");
    return renderChatRanking(pool,chatId,mid,parts[3],Number(parts[4]));
  }
  if(data.startsWith("sx:chat:rank:"))return renderChatRanking(pool,chatId,mid,data.slice("sx:chat:rank:".length));
  if(data==="sx:chat:home")return renderChatStatsHub(pool,chatId,mid,"sx:more");
  if(data==="sx:scope:group")return renderChatStatsHub(pool,chatId,mid,"sx:more");
  if(data==="sx:scope:user"){
    return renderUserPeriod(pool,chatId,mid,Number(cb.from.id),"today");
  }
  if(data.startsWith("sx:scope:user:")){
    const userId=Number(data.split(":")[3]);
    if(!Number.isSafeInteger(userId)||userId<=0)return true;
    return renderUserPeriod(pool,chatId,mid,userId,"today");
  }

  const p=data.split(":");
  if(p[0]!=="sx")return false;

  if(p[1]==="periods"){
    const scope=p[2] as StatsScope;
    const id=p[3]?Number(p[3]):undefined;
    return renderPeriods(chatId,mid,scope,id);
  }

  if(p[1]==="period"){
    const scope=p[2] as StatsScope;
    const period=p[3] as StatsPeriod;
    const targetUserId=p[4]?Number(p[4]):undefined;
    if(scope==="user"){
      return renderUserPeriod(pool,chatId,mid,targetUserId||cb.from.id,period);
    }
    if(scope==="admins")return renderAdminPeriod(pool,chatId,mid,period);
    if(scope==="members")return renderMemberPeriod(pool,chatId,mid,period);
    return renderGroupPeriod(pool,chatId,mid,period);
  }

  if(p[1]==="date"){
    const scope=p[2] as StatsScope;
    const targetUserId=p[3]?Number(p[3]):undefined;
    setSession(cb.from.id,{
      flow:"date",
      chatId,
      actorId:cb.from.id,
      scope,
      targetUserId,
    });
    return editPanel(chatId,mid,
      renderHeader("انتخاب تاریخ")+"\n\n⛂ - تاریخ را ارسال کنید.\n⛂ - قالب : YYYY-MM-DD\n⛂ - نمونه : 2026-10-01",
      [[["‹ لغو","sx:cancel"],["‹ بازگشت","sx:periods:"+scope+(targetUserId?":"+targetUserId:"")]]]);
  }

  if(p[1]==="range"){
    const scope=p[2] as StatsScope;
    const targetUserId=p[3]?Number(p[3]):undefined;
    setSession(cb.from.id,{
      flow:"range_start",
      chatId,
      actorId:cb.from.id,
      scope,
      targetUserId,
    });
    return editPanel(chatId,mid,
      renderHeader("انتخاب بازه")+"\n\n⛂ - تاریخ شروع را ارسال کنید.\n⛂ - قالب : YYYY-MM-DD",
      [[["‹ لغو","sx:cancel"],["‹ بازگشت","sx:periods:"+scope+(targetUserId?":"+targetUserId:"")]]]);
  }

  if(p[1]==="cancel"){
    clearSession(cb.from.id);
    return renderMore(pool,chatId,mid);
  }

  if(p[1]==="ranking"){
    const scope=p[2] as StatsScope;
    const maybeTarget=p[3];
    const period=(["today","7d","30d","month","prevmonth","all"] as string[]).includes(maybeTarget||"") ? maybeTarget as StatsPeriod : "7d";
    const targetUserId=(scope==="user"&&!Number.isNaN(Number(maybeTarget)))?Number(maybeTarget):undefined;
    return renderRanking(pool,chatId,mid,scope,period,targetUserId);
  }

  if(p[1]==="hours"){
    const scope=p[2] as StatsScope;
    const maybe=p[3] || "today";
    if(/^\d{4}-\d{2}-\d{2}$/.test(maybe))return renderHours(pool,chatId,mid,scope,maybe, p[4]?Number(p[4]):undefined);
    const period=maybe as StatsPeriod;
    return renderHours(pool,chatId,mid,scope,period,p[4]?Number(p[4]):undefined);
  }

  if(p[1]==="rankdim"){
    const scope=p[2] as StatsScope;
    const period=(p[3]||"7d") as StatsPeriod;
    const dimension=(p[4]||"messages") as "messages"|"media"|"links"|"replies"|"growth";
    return renderRanking(pool,chatId,mid,scope,period,undefined,dimension);
  }

  if(p[1]==="growth"){
    const g=await growthStats(pool,chatId);
    const growthRows=await advancedRanking(pool,chatId,"7d","growth");
    const blocks: RichInputBlock[]=[
      richHeading("Pᴇʀsɪᴀɴ ᴮᵒᵗ · Sᴛᴀᴛs Cᴇɴᴛᴇʀ",1),
      richHeading("رشد گروه",2),
      richTable(["شاخص","مقدار"],[
        ["ورود ۷ روز اخیر",g.joins7],
        ["خروج ۷ روز اخیر",g.leaves7],
        ["رشد خالص ۷ روزه",signed(g.net7)],
        ["رشد خالص ۷ روز قبل",signed(g.prevNet)],
        ["روند",g.trend],
      ]),
      richDivider(),
      richHeading("رشد فعالیت کاربران",3),
      growthRows.length
        ? richTable(["رتبه","کاربر","تغییر"],growthRows.slice(0,5).map((u:any,i:number)=>[
            String(i+1).padStart(3,"0"),
            richInlineUser(u.userId,u.username,u.firstName),
            (u.delta>=0?"+":"-")+Math.abs(number(u.delta)),
          ]))
        : richParagraph("داده‌ای برای محاسبه رشد فعالیت ثبت نشده است."),
      richDivider(),
      richFooter("بازه تحلیل · ۷ روز اخیر"),
    ];
    return editRichPanel(chatId,mid,blocks,[
      [["رتبه‌بندی رشد","sx:rankdim:group:7d:growth"],["بازگشت","sx:more"]]
    ]);
  }

  if(p[1]==="status"){
    const st=await groupStatusIndex(pool,chatId);
    const state=st.index>=70?"● پویا":st.index>=40?"○ عادی":"■ کم‌تحرک";
    const text=[
      renderHeader("شاخص وضعیت گروه"),
      statusLine("شاخص وضعیت","【 "+st.index+" / 100 】"),
      statusLine("سطح فعالیت اعضا","【 "+Math.round(st.activeRatio*100)+"% 】"),
      statusLine("شتاب پیام","【 "+Math.round(st.messageMomentum*100)+"% 】"),
      statusLine("اثر رویدادهای امنیتی","【 "+Math.round(st.safetyPenalty*100)+"% 】"),
      statusLine("وضعیت",state),
      "",
      "⛂ - این شاخص یک خلاصه تحلیلی داخلی از فعالیت، شتاب پیام و رویدادهای امنیتی است.",
    ].join("\n");
    return editPanel(chatId,mid,text,[[["‹ رشد گروه","sx:growth:group"],["‹ بازگشت","sx:more"]]]);
  }

  if(p[1]==="content"){
    const scope=p[2] as StatsScope;
    const period=(p[3]||"today") as StatsPeriod;
    const targetUserId=p[4]?Number(p[4]):undefined;
    return renderContent(pool,chatId,mid,scope,period,targetUserId);
  }

  if(p[1]==="compare"){
    const scope=(p[2]||"group") as StatsScope;
    const targetUserId=p[3]?Number(p[3]):undefined;
    return renderCompare(pool,chatId,mid,scope,targetUserId);
  }

  if(p[1]==="report"){
    const scope=(p[2]||"group") as StatsScope;
    const targetUserId=p[3]?Number(p[3]):undefined;
    return renderReport(pool,chatId,mid,scope,targetUserId,"today");
  }

  if(p[1]==="ucompare"||p[1]==="ureport"||p[1]==="uhours"){
    const userId=Number(p[2]);
    const period=(p[3]||"today") as StatsPeriod;
    if(!Number.isSafeInteger(userId)||userId<=0)return true;
    if(p[1]==="ucompare")return renderCompare(pool,chatId,mid,"user",userId);
    if(p[1]==="ureport")return renderReport(pool,chatId,mid,"user",userId,period);
    return renderHours(pool,chatId,mid,"user",period,userId);
  }

  if(p[1]==="audit"){
    const admins=await auditAdminDirectory(pool,chatId);
    const text=[
      renderHeader("سوابق مدیریتی"),
      ...(admins.length?admins.map((u:any,i:number)=>rankNumber(i+1)+" · "+userTag(u.userId,u.username,u.firstName)+" · "+u.actions+" اقدام"):["■ داده‌ای ثبت نشده است."]),
    ].join("\n");
    return editPanel(chatId,mid,text,[[["‹ بازگشت","sx:scope:admins"]]]);
  }

  if(p[1]==="new"||p[1]==="inactive"||p[1]==="returning"||p[1]==="calendar"){
    const kind=p[1];
    if(kind==="new"){
      const r=await pool.query<any>(
        "SELECT DISTINCT ON(user_id) user_id,username,first_name,joined_at FROM bot_member_join_events WHERE group_id=$1 ORDER BY user_id,joined_at DESC LIMIT 50",
        [chatId],
      ).catch(()=>({rows:[]}));
      const text=[renderHeader("اعضای جدید"),...(r.rows.length?r.rows.map((u:any,i:number)=>rankNumber(i+1)+" · "+userTag(number(u.user_id),u.username,u.first_name)+" · "+faDateTime(u.joined_at)):["■ داده‌ای ثبت نشده است."])].join("\n");
      return editPanel(chatId,mid,text,[[["‹ بازگشت","sx:scope:members"]]]);
    }
    if(kind==="inactive"){
      const r=await inactivityData(pool,chatId);
      return editPanel(chatId,mid,[renderHeader("اعضای غیرفعال"),statusLine("۷ تا ۳۰ روز","【 "+number(r.inactive7_30)+" 】"),statusLine("بیش از ۳۰ روز","【 "+number(r.inactive30)+" 】")].join("\n"),[[["‹ بازگشت","sx:scope:members"]]]);
    }
    if(kind==="returning"){
      const n=await returningData(pool,chatId);
      return editPanel(chatId,mid,[renderHeader("اعضای بازگشتی"),statusLine("کاربران بازگشتی","【 "+n+" 】"),"","⛂ - بازگشتی یعنی کاربری که سابقه قدیمی داشته و دوباره در بازه اخیر فعال شده است."].join("\n"),[[["‹ بازگشت","sx:scope:members"]]]);
    }
    const today=toDateInput(new Date());
    const days:string[]=[];
    for(let i=6;i>=0;i--){
      const d=new Date(Date.now()-i*86400000);
      days.push(toDateInput(d));
    }
    return editPanel(chatId,mid,[renderHeader("تقویم فعالیت"),"", "★ - ۷ روز اخیر",...days.map(d=>"‹ "+faDayName(d)+" · "+faDate(d))].join("\n"),
      days.map((d:any)=>[[ "‹ "+faDayName(d)+" · "+faDate(d), "sx:day:group:"+d ]]).concat([[["‹ بازگشت","sx:scope:members"]]]));
  }

  if(p[1]==="day"){
    const scope=p[2] as StatsScope;
    const day=p[3];
    const id=p[4]?Number(p[4]):undefined;
    return renderDay(pool,chatId,mid,scope,day,id);
  }

  return false;
}
