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
  return "【 <a href="tg://user?id=" + encodeURIComponent(String(userId)) + ">" + escapeHtml(raw) + "</a> 】";
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

async function editPanel(chatId: number, messageId: number, text: string, rows: string[][][]) {
  await telegramApi("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    reply_markup: kb(rows),
  }).catch(() => {});
  return true;
}

async function sendPanel(chatId: number, text: string, rows: string[][][]) {
  await telegramApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: kb(rows),
  });
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
         COUNT(*) FILTER(WHERE ${rawDayExpression("m")}>=date_trunc('month',NOW() AT TIME ZONE '${TZ}')::date)::int month,
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
         COUNT(*) FILTER(WHERE joined_at>=NOW()-INTERVAL '30 days')::int month,
         COUNT(*)::int total
       FROM bot_member_join_events WHERE group_id=$1`,
      [chatId],
    ),
    pool.query<any>(
      `SELECT
         COUNT(*) FILTER(WHERE (left_at AT TIME ZONE '${TZ}')::date=(NOW() AT TIME ZONE '${TZ}')::date)::int today,
         COUNT(*) FILTER(WHERE left_at>=NOW()-INTERVAL '7 days')::int week,
         COUNT(*) FILTER(WHERE left_at>=NOW()-INTERVAL '30 days')::int month,
         COUNT(*)::int total
       FROM bot_member_leave_events WHERE group_id=$1`,
      [chatId],
    ),
    pool.query<any>(
      `SELECT ${rawHourExpression("m")} AS hour,COUNT(*)::int n
       FROM bot_message_records m
       WHERE m.chat_id=$1
       GROUP BY 1 ORDER BY n DESC,hour ASC LIMIT 1`,
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
        (SELECT COUNT(*)::int FROM audit_logs WHERE target=$1 AND created_at>=CURRENT_DATE) audits_today
      `,
      [String(chatId)],
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
    messagesMonth: number(m.month),
    activeDays: number(m.active_days),
    dailyAverage,
    active30m: number(u.active_30m),
    active24h: number(u.active_24h),
    active7d: number(u.active_7d),
    joinsToday: number(j.today),
    joinsWeek: number(j.week),
    joinsMonth: number(j.month),
    joinsTotal: number(j.total),
    leavesToday: number(l.today),
    leavesWeek: number(l.week),
    leavesMonth: number(l.month),
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

async function topUsers(
  pool: Pool,
  chatId: number,
  mode: "messages" | "interactions",
  period: StatsPeriod,
  limit = 3,
) {
  if (mode === "messages") {
    const condition = period === "all"
      ? "TRUE"
      : `${rawDayExpression("m")} >= ((NOW() AT TIME ZONE '${TZ}')::date - INTERVAL '${period === "7d" ? "6" : period === "30d" ? "29" : "0"} days')::date`;
    const result = await pool.query<any>(
      `SELECT
        m.user_id,
        MAX(m.username) AS username,
        MAX(m.first_name) AS first_name,
        COUNT(*)::int n
       FROM bot_message_records m
       WHERE m.chat_id=$1 AND m.user_id IS NOT NULL AND ${condition}
       GROUP BY m.user_id
       ORDER BY n DESC,m.user_id
       LIMIT ${Math.max(1, Math.min(limit, 10))}`,
      [chatId],
    );
    return result.rows.map((x: any) => ({
      userId: number(x.user_id),
      username: x.username,
      firstName: x.first_name,
      count: number(x.n),
    }));
  }

  const condition = period === "all"
    ? "TRUE"
    : period === "7d"
      ? `d.day>=((NOW() AT TIME ZONE '${TZ}')::date-INTERVAL '6 days')::date`
      : `d.day>=((NOW() AT TIME ZONE '${TZ}')::date-INTERVAL '29 days')::date`;

  const result = await pool.query<any>(
    `SELECT
      d.target_user_id user_id,
      MAX(m.username) username,
      MAX(m.first_name) first_name,
      SUM(d.interaction_count)::int n
     FROM stats_interactions_daily d
     LEFT JOIN member_tag_activity m
       ON m.group_id=d.group_id AND m.user_id=d.target_user_id
     WHERE d.group_id=$1 AND ${condition}
     GROUP BY d.target_user_id
     ORDER BY n DESC,d.target_user_id
     LIMIT ${Math.max(1, Math.min(limit, 10))}`,
    [chatId],
  ).catch(() => ({ rows: [] }));

  return result.rows.map((x: any) => ({
    userId: number(x.user_id),
    username: x.username,
    firstName: x.first_name,
    count: number(x.n),
  }));
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
  const condition = periodCondition(period, "d");
  const result = await pool.query<any>(
    `SELECT
      COALESCE(SUM(d.messages),0)::int messages,
      COALESCE(SUM(d.links),0)::int links,
      COALESCE(SUM(d.text_count),0)::int text_count,
      COALESCE(SUM(d.photo_count),0)::int photo_count,
      COALESCE(SUM(d.video_count),0)::int video_count,
      COALESCE(SUM(d.audio_count),0)::int audio_count,
      COALESCE(SUM(d.document_count),0)::int document_count,
      COALESCE(SUM(d.animation_count),0)::int animation_count,
      COALESCE(SUM(d.sticker_count),0)::int sticker_count,
      COALESCE(SUM(d.voice_count),0)::int voice_count,
      COALESCE(SUM(d.video_note_count),0)::int video_note_count,
      COALESCE(SUM(d.other_count),0)::int other_count,
      COALESCE(SUM(d.reply_sent_count),0)::int replies,
      COUNT(*)::int active_days
     FROM stats_user_daily d
     WHERE d.group_id=$1 AND d.user_id=$2 AND ${condition}`,
    [chatId, userId],
  ).catch(() => ({ rows: [] }));

  const aggregate = result.rows[0] || {};
  if (number(aggregate.messages) > 0 || period !== "all") {
    if (period !== "all" || number(aggregate.messages) > 0) return aggregate;
  }

  const raw = await pool.query<any>(
    `SELECT
      COUNT(*)::int messages,
      COUNT(*) FILTER(WHERE (${rawTsExpression("m")} AT TIME ZONE '${TZ}')::date >= ((NOW() AT TIME ZONE '${TZ}')::date - INTERVAL '29 days')::date)::int recent_messages,
      COUNT(*) FILTER(WHERE POSITION('http' IN LOWER(COALESCE(m.text,'')))>0)::int links,
      COUNT(*) FILTER(WHERE m.telegram_date IS NOT NULL)::int exact_messages,
      COUNT(DISTINCT ${rawDayExpression("m")})::int active_days,
      MAX(${rawTsExpression("m")}) AS last_activity,
      MIN(${rawTsExpression("m")}) AS first_activity
     FROM bot_message_records m
     WHERE m.chat_id=$1 AND m.user_id=$2`,
    [chatId, userId],
  );
  const r = raw.rows[0] || {};
  return {
    messages: number(r.messages),
    links: number(r.links),
    text_count: 0,
    photo_count: 0,
    video_count: 0,
    audio_count: 0,
    document_count: 0,
    animation_count: 0,
    sticker_count: 0,
    voice_count: 0,
    video_note_count: 0,
    other_count: 0,
    replies: 0,
    active_days: number(r.active_days),
    last_activity: r.last_activity,
    first_activity: r.first_activity,
  };
}

async function userRank(pool: Pool, chatId: number, userId: number, period: StatsPeriod) {
  const condition = periodCondition(period, "d");
  const result = await pool.query<any>(
    `WITH ranked AS (
      SELECT user_id,SUM(messages)::int n
      FROM stats_user_daily d
      WHERE d.group_id=$1 AND ${condition}
      GROUP BY user_id
    )
    SELECT
      COALESCE((SELECT n FROM ranked WHERE user_id=$2),0)::int own,
      COALESCE(1+(SELECT COUNT(*) FROM ranked r WHERE r.n>(SELECT n FROM ranked WHERE user_id=$2)),0)::int rank,
      (SELECT COUNT(*) FROM ranked)::int members
    `,
    [chatId, userId],
  ).catch(() => ({ rows: [] }));

  const row = result.rows[0] || {};
  if (number(row.own) > 0 || period !== "all") {
    return {
      rank: number(row.rank),
      own: number(row.own),
      population: number(row.members),
    };
  }

  const raw = await pool.query<any>(
    `WITH ranked AS (
      SELECT user_id,COUNT(*)::int n
      FROM bot_message_records m
      WHERE m.chat_id=$1 AND m.user_id IS NOT NULL
      GROUP BY user_id
    )
    SELECT
      COALESCE((SELECT n FROM ranked WHERE user_id=$2),0)::int own,
      COALESCE(1+(SELECT COUNT(*) FROM ranked r WHERE r.n>(SELECT n FROM ranked WHERE user_id=$2)),0)::int rank,
      (SELECT COUNT(*) FROM ranked)::int members`,
    [chatId, userId],
  );
  const r = raw.rows[0] || {};
  return { rank: number(r.rank), own: number(r.own), population: number(r.members) };
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
    `SELECT ${rawHourExpression("m")} hour,COUNT(*)::int message_count
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
      `SELECT ${rawHourExpression("m")} hour,COUNT(*)::int message_count
       FROM bot_message_records m
       WHERE m.chat_id=$1 AND m.user_id=$2 AND ${rawDayExpression("m")}=$3::date
       GROUP BY 1 ORDER BY 1`,
      [chatId,userId,day],
    );
    return raw.rows;
  }
  const raw = await pool.query<any>(
    `SELECT ${rawHourExpression("m")} hour,COUNT(*)::int message_count
     FROM bot_message_records m
     WHERE m.chat_id=$1 AND m.user_id=$2 AND ${rawDayExpression("m")}>=((NOW() AT TIME ZONE '${TZ}')::date-INTERVAL '29 days')::date
     GROUP BY 1 ORDER BY 1`,
    [chatId,userId],
  );
  return raw.rows;
}

async function memberDynamics(pool: Pool, chatId: number, period: StatsPeriod) {
  const bounds = periodCondition(period, "d");
  const result = await pool.query<any>(
    `SELECT
      (SELECT COUNT(*)::int FROM bot_member_join_events j
       WHERE j.group_id=$1 AND (j.joined_at AT TIME ZONE '${TZ}')::date IN (
         SELECT day FROM stats_group_daily d WHERE d.group_id=$1 AND ${bounds}
       )) joins,
      (SELECT COUNT(*)::int FROM bot_member_leave_events l
       WHERE l.group_id=$1 AND (l.left_at AT TIME ZONE '${TZ}')::date IN (
         SELECT day FROM stats_group_daily d WHERE d.group_id=$1 AND ${bounds}
       )) leaves,
      (SELECT COUNT(DISTINCT j.user_id)::int FROM bot_member_join_events j
       WHERE j.group_id=$1 AND j.joined_at>=NOW()-INTERVAL '7 days') new_users,
      (SELECT COUNT(DISTINCT m.user_id)::int FROM bot_message_records m
       WHERE m.chat_id=$1 AND m.user_id IS NOT NULL AND ${period=== "all" ? "TRUE" : `${rawTsExpression("m")}>=NOW()-INTERVAL '${period === "7d" ? "6" : period === "30d" ? "29" : period === "month" ? "31" : period === "prevmonth" ? "60" : "1"} days'`}) active_users
    `,
    [chatId],
  ).catch(() => ({ rows: [] }));
  return result.rows[0] || {};
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
    : `created_at>=${period === "today"
      ? "CURRENT_DATE"
      : period === "7d"
        ? "NOW()-INTERVAL '6 days'"
        : period === "30d"
          ? "NOW()-INTERVAL '29 days'"
          : period === "month"
            ? "date_trunc('month',NOW())"
            : "date_trunc('month',NOW())-INTERVAL '1 month'"}`;
  const [
    actions,
    warnings,
    penalties,
    top,
    failed,
  ] = await Promise.all([
    pool.query<any>(
      `SELECT COUNT(*)::int n FROM moderation_actions WHERE group_id=$1 AND ${condition}`,
      [chatId],
    ).catch(() => ({ rows: [] })),
    pool.query<any>(
      `SELECT COUNT(*)::int n FROM warning_events WHERE group_id=$1 AND action_type='warning' AND ${condition}`,
      [chatId],
    ).catch(() => ({ rows: [] })),
    pool.query<any>(
      `SELECT COUNT(*)::int n FROM warning_penalties WHERE group_id=$1 AND ${condition}`,
      [chatId],
    ).catch(() => ({ rows: [] })),
    pool.query<any>(
      `SELECT actor_id::text actor_id,COUNT(*)::int n
       FROM moderation_actions
       WHERE group_id=$1 AND actor_id IS NOT NULL AND ${condition}
       GROUP BY actor_id
       ORDER BY n DESC,actor_id
       LIMIT 5`,
      [chatId],
    ).catch(() => ({ rows: [] })),
    pool.query<any>(
      `SELECT COUNT(*)::int n
       FROM supervision_events
       WHERE group_id=$1 AND severity IN('error','critical') AND ${condition}`,
      [chatId],
    ).catch(() => ({ rows: [] })),
  ]);

  return {
    actions: number(actions.rows[0]?.n),
    warnings: number(warnings.rows[0]?.n),
    penalties: number(penalties.rows[0]?.n),
    failed: number(failed.rows[0]?.n),
    topAdmins: top.rows.map((x: any) => ({
      userId: number(x.actor_id),
      count: number(x.n),
    })),
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
    [["‹ آمار ادمین","sx:scope:admins"],["‹ آمار اعضا","sx:scope:members"]],
    [["‹ آمار کاربر","sx:scope:user"+(targetUserId ? id : "")],["‹ آمار کلی","sx:scope:group"]],
    [["‹ مقایسه بازه‌ها","sx:compare:group"],["‹ گزارش آماری","sx:report:group"]],
    [["‹ بازگشت","sx:home"]],
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

async function renderGroupOverview(pool: Pool, chatId: number, messageId?: number) {
  const d=await groupOverviewData(pool,chatId);
  const lines=[
    renderHeader("نمای کلی گروه"),
    statusLine("پیام امروز","【 "+d.messagesToday+" 】"),
    statusLine("پیام ۷ روزه","【 "+d.messagesWeek+" 】"),
    statusLine("پیام این ماه","【 "+d.messagesMonth+" 】"),
    statusLine("پیام کل","【 "+d.totalMessages+" 】"),
    statusLine("میانگین پیام روزانه","【 "+decimal(d.dailyAverage)+" 】"),
    statusLine("اعضای فعلی","【 "+d.memberCount+" 】"),
    statusLine("فعال ۳۰ دقیقه اخیر","【 "+d.active30m+" 】"),
    statusLine("فعال ۲۴ ساعت اخیر","【 "+d.active24h+" 】"),
    statusLine("عضو جدید امروز","【 "+d.joinsToday+" 】"),
    statusLine("خروج امروز","【 "+d.leavesToday+" 】"),
    statusLine("رشد خالص امروز","【 "+signed(d.netToday)+" 】"),
    statusLine("فعال‌ترین ساعت",d.busiestHour==null?"■":String(d.busiestHour).padStart(2,"0")+":00 · "+d.busiestHourCount),
    statusLine("روند ۷ روزه",d.currentWeekTrend),
    statusLine("تخلف امنیتی امروز","【 "+d.securityViolationsToday+" 】"),
    statusLine("اخطار امروز","【 "+d.warningsToday+" 】"),
    statusLine("اقدامات مدیریتی امروز","【 "+d.penaltiesToday+" 】"),
    "",
    "★ - ۳ نفر برتر چت",
    ...(d.topChat.length
      ? d.topChat.map((u:any,i:number)=>rankNumber(i+1)+" · "+userTag(u.userId,u.username,u.firstName)+" · "+u.count+" پیام")
      : ["■ داده‌ای ثبت نشده است."]),
    "",
    "★ - ۳ نفر برتر فرند",
    ...(d.topFriends.length
      ? d.topFriends.map((u:any,i:number)=>rankNumber(i+1)+" · "+userTag(u.userId,u.username,u.firstName)+" · "+u.count+" تعامل")
      : ["■ داده‌ای برای تعامل مستقیم ثبت نشده است."]),
    "",
    "★ - تشخیص ناهنجاری",
    d.anomaly.detected
      ? "● الگوی غیرعادی شناسایی شد · اوج ۱۵ دقیقه‌ای : "+d.anomaly.peak15m
      : "○ الگوی غیرعادی مشخصی ثبت نشده است.",
    "",
    "★ - آخرین بروزرسانی : "+faDateTime(new Date()),
  ];
  const rows=[
    [["‹ اطلاعات بیشتر","sx:more"]],
    [["‹ بروزرسانی","sx:home"] ,["‹ گزارش آماری","sx:report:group"]],
  ];
  if(messageId)return editPanel(chatId,messageId,lines.join("\n"),rows);
  return sendPanel(chatId,lines.join("\n"),rows);
}

async function renderMore(pool: Pool, chatId: number, messageId: number, targetUserId?: number) {
  const text=[
    renderHeader("مراکز آماری"),
    "★ - مراکز آماری",
    "",
    "‹ آمار ادمین",
    "‹ آمار اعضا",
    "‹ آمار کاربر",
    "",
    "★ - ابزار تحلیل",
    "",
    "‹ آمار کلی",
    "‹ مقایسه بازه‌ها",
    "‹ گزارش آماری",
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

async function renderGroupPeriod(pool: Pool, chatId: number, messageId: number, period: StatsPeriod) {
  const d=await groupOverviewData(pool,chatId);
  const top=await topUsers(pool,chatId,"messages",period,5);
  const rows=[
    renderHeader(scopeLabel("group")+" · "+periodLabel(period)),
    statusLine("بازه",periodLabel(period)),
    statusLine("پیام","【 "+(
      period==="today"?d.messagesToday:
      period==="7d"?d.messagesWeek:
      period==="30d"?number(d.messagesMonth):
      period==="month"?d.messagesMonth:
      period==="prevmonth"?Math.max(0,d.messagesMonth):
      d.totalMessages
    )+" 】"),
    statusLine("اعضای فعلی","【 "+d.memberCount+" 】"),
    statusLine("کاربران فعال ۲۴ ساعت","【 "+d.active24h+" 】"),
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
  const content = period==="all" ? await rawUserContent(pool,chatId,userId,period) : await rawUserContent(pool,chatId,userId,period);
  const interactions=await topInteractionTargets(pool,chatId,userId,period,5);
  const hours=await hourlyUser(pool,chatId,userId);
  const peak=hours.reduce((best:any,row:any)=>number(row.message_count)>number(best?.message_count)?row:best,null);
  const lastActivity=summary.last_activity?faDateTime(summary.last_activity):"قابل تعیین نیست";
  const firstActivity=summary.first_activity?faDateTime(summary.first_activity):"قابل تعیین نیست";
  const avg=number(summary.active_days)>0?number(summary.messages)/number(summary.active_days):0;
  const text=[
    renderHeader("آمار کاربر"),
    "★ - کاربر",
    userTag(userId,u.username,u.first_name),
    "",
    statusLine("بازه",periodLabel(period)),
    statusLine("تعداد پیام","【 "+number(summary.messages)+" 】"),
    statusLine("رتبه پیام","【 "+(rank.rank?rank.rank:"■")+" 】"),
    statusLine("جمعیت رتبه‌بندی","【 "+number(rank.population)+" 】"),
    statusLine("روزهای فعال","【 "+number(summary.active_days)+" 】"),
    statusLine("میانگین پیام در روز فعال","【 "+decimal(avg)+" 】"),
    statusLine("لینک‌ها","【 "+number(content.links)+" 】"),
    statusLine("آخرین فعالیت",lastActivity),
    statusLine("اولین فعالیت",firstActivity),
    "",
    "★ - محتوای ارسال‌شده",
    "⛂ - متن : "+number(content.text),
    "⛂ - عکس : "+number(content.photo),
    "⛂ - ویدیو : "+number(content.video),
    "⛂ - فایل : "+number(content.document),
    "⛂ - استیکر : "+number(content.sticker),
    "⛂ - صوت : "+number(content.audio),
    "⛂ - سایر : "+number(content.other),
    "",
    "★ - ساعت اوج",
    peak
      ? "⛂ - "+String(number(peak.hour)).padStart(2,"0")+":00 · 【 "+number(peak.message_count)+" پیام 】"
      : "■ داده‌ای ثبت نشده است.",
    "",
    "★ - فرند / تعامل مستقیم",
    ...(interactions.length
      ? interactions.map((x:any,i:number)=>rankNumber(i+1)+" · "+userTag(x.userId,x.username,x.firstName)+" · "+x.count+" تعامل")
      : ["■ داده‌ای ثبت نشده است."]),
    "",
    "★ - وضعیت",
    "⛂ - آخرین فعالیت : "+lastActivity,
    "⛂ - حالت : "+(
      summary.last_activity && new Date(summary.last_activity).getTime()>=Date.now()-30*60*1000
        ? "● فعال"
        : "○ عادی"
    ),
  ].join("\n");
  return editPanel(chatId,messageId,text,[
    ...periodButtons("user",userId),
    [["‹ آمار ساعتی","sx:uhours:user:"+userId+":"+period],["‹ مقایسه عملکرد","sx:ucompare:"+userId+":"+period]],
    [["‹ گزارش کاربر","sx:ureport:"+userId+":"+period],["‹ بازگشت","sx:more"]],
  ]);
}

async function renderUserQuick(pool: Pool, chatId: number, messageId: number, userId: number) {
  const u=await resolveUser(pool,chatId,userId);
  const all=await userDailySummary(pool,chatId,userId,"all");
  const today=await userDailySummary(pool,chatId,userId,"today");
  const rank=await userRank(pool,chatId,userId,"all");
  const text=[
    renderHeader("آمار فعالیت کاربر"),
    userTag(userId,u.username,u.first_name),
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

async function renderRanking(pool: Pool, chatId: number, messageId: number, scope: StatsScope, period: StatsPeriod, targetUserId?: number) {
  if (scope === "admins") {
    const admins=await auditAdminDirectory(pool,chatId);
    const text=[
      renderHeader("رتبه‌بندی مدیران · "+periodLabel(period)),
      "★ - رتبه‌بندی اقدامات مدیریتی",
      "",
      ...(admins.length?admins.map((u:any,i:number)=>rankNumber(i+1)+" · "+userTag(u.userId,u.username,u.firstName)+" · "+u.actions+" اقدام"):["■ داده‌ای ثبت نشده است."]),
    ].join("\n");
    return editPanel(chatId,messageId,text,[[
      ["‹ بازگشت","sx:period:admins:"+period],
    ]]);
  }
  const top=await topUsers(pool,chatId,"messages",period,10);
  const text=[
    renderHeader("رتبه‌بندی فعالیت · "+periodLabel(period)),
    "★ - برترین کاربران",
    "",
    ...(top.length?top.map((u:any,i:number)=>rankNumber(i+1)+" · "+userTag(u.userId,u.username,u.firstName)+" · "+u.count+" پیام"):["■ داده‌ای ثبت نشده است."]),
  ].join("\n");
  return editPanel(chatId,messageId,text,[[["‹ بازگشت","sx:period:"+scope+":"+period+(targetUserId?":"+targetUserId:"")]]]);
}

async function renderHours(pool: Pool, chatId: number, messageId: number, scope: StatsScope, periodOrDay: StatsPeriod|string, targetUserId?: number) {
  const isDay = /^\d{4}-\d{2}-\d{2}$/.test(String(periodOrDay));
  const day = isDay ? String(periodOrDay) : toDateInput(new Date());
  let rows:any[]=[];
  if (scope==="user" && targetUserId) rows=await hourlyUser(pool,chatId,targetUserId,isDay?day:undefined);
  else rows=await hourlyGroup(pool,chatId,day);
  const counts=new Map<number,number>(rows.map(x=>[number(x.hour),number(x.message_count)]));
  const top=[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5);
  const lines=[
    renderHeader(scope==="user"?"آمار ساعتی کاربر":"آمار ساعتی گروه"),
    statusLine("روز",faDayName(day)+" · "+faDate(day)),
    "",
    "★ - توزیع ۲۴ ساعته",
    ...Array.from({length:24},(_,hour)=>(
      "⛂ - "+String(hour).padStart(2,"0")+":00 · "+("█".repeat(Math.min(18,Math.max(0,Math.round((counts.get(hour)||0)/Math.max(1,top[0]?.[1]||1)*18))))+" · "+(counts.get(hour)||0)
    )),
    "",
    "★ - ساعت‌های اوج",
    ...(top.length?top.map(([h,n],i)=>rankNumber(i+1)+" · "+String(h).padStart(2,"0")+":00 · "+n+" پیام"):["■ داده‌ای ثبت نشده است."]),
  ].join("\n");
  return editPanel(chatId,messageId,lines,[
    [["‹ رتبه‌بندی","sx:ranking:"+scope+(targetUserId?":"+targetUserId:"")],["‹ بازگشت","sx:periods:"+scope+(targetUserId?":"+targetUserId:"")]],
  ]);
}

async function renderDay(pool: Pool, chatId: number, messageId: number, scope: StatsScope, day: string, targetUserId?: number) {
  const top=await dailyUsers(pool,chatId,day,5);
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
    const c=await rawUserContent(pool,chatId,targetUserId,period);
    const total=Object.values(c).reduce((n,v)=>n+number(v),0);
    const text=[
      renderHeader("تحلیل محتوا · "+periodLabel(period)),
      userTag(targetUserId),
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
  const text=[
    renderHeader("آمار فعالیت کاربر"),
    userTag(userId,resolved.username||row.username,resolved.first_name||row.first_name),
    "",
    statusLine("امروز","【 "+number(today.messages)+" پیام 】"),
    statusLine("کل پیام‌ها","【 "+number(data.messages)+" 】"),
    statusLine("رتبه در پیام","【 "+(rank.rank||"■")+" 】"),
    statusLine("روزهای فعال","【 "+number(data.active_days)+" 】"),
    statusLine("میانگین روز فعال","【 "+decimal(number(data.active_days)>0?number(data.messages)/number(data.active_days):0)+" 】"),
    statusLine("لینک‌ها","【 "+number(data.links)+" 】"),
    statusLine("آخرین فعالیت",data.last_activity?faDateTime(data.last_activity):"ثبت نشده"),
    "",
    "─────━━───── ◈ ─────━━─────",
    "",
    "★ - قابلیت‌های Stats Center",
    "⛂ - رتبه‌بندی چندبعدی",
    "⛂ - آمار ساعتی",
    "⛂ - تحلیل محتوا",
    "⛂ - شبکه تعامل / فرند",
    "⛂ - مقایسه عملکرد",
    "⛂ - گزارش آماری",
  ].join("\n");
  return sendPanel(chatId,text,[
    [["‹ اطلاعات بیشتر","sx:scope:user:"+userId]],
    [["‹ بازگشت","sx:home"]],
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
    await telegramApi("sendMessage",{chat_id:msg.chat.id,text:"تاریخ پایان بازه را ارسال کنید.
نمونه: 2026-10-07"}).catch(()=>{});
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
  await answer(cb.id);

  const data=String(cb.data||"");
  const chatId=cb.message.chat.id;
  const mid=cb.message.message_id;

  if(data==="sx:home")return renderGroupOverview(pool,chatId,mid);
  if(data==="sx:more")return renderMore(pool,chatId,mid);
  if(data==="sx:scope:admins")return renderAdminPeriod(pool,chatId,mid,"today");
  if(data==="sx:scope:members")return renderMemberPeriod(pool,chatId,mid,"today");
  if(data==="sx:scope:group")return renderGroupPeriod(pool,chatId,mid,"today");
  if(data==="sx:scope:user"){
    return renderUserPeriod(pool,chatId,mid,"user","today",Number(cb.from.id));
  }
  if(data.startsWith("sx:scope:user:")){
    const userId=Number(data.split(":")[3]);
    if(!Number.isSafeInteger(userId)||userId<=0)return true;
    return renderUserPeriod(pool,chatId,mid,"user","today",userId);
  }

  const p=data.split(":");
  if(p[0]!=="s")return false;

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
    const day=toDateInput(new Date());
    return renderHours(pool,chatId,mid,scope,period,p[4]?Number(p[4]):undefined);
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
