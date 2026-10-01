import type { Pool } from "pg";
import { telegramApi } from "../telegram/api.ts";
import { glassKeyboard } from "./panel-design.ts";
import type { Rank } from "./registry.ts";

const SEP = "─────━━───── ◈ ─────━━─────";
const TITLE = "◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Dᴀᴛᴇ Cᴇɴᴛᴇʀ";
const DEFAULT_TZ = "Asia/Tehran";
const COMMON_TZ = [
  "Asia/Tehran",
  "Asia/Baku",
  "Europe/Istanbul",
  "Asia/Dubai",
  "Europe/London",
  "America/New_York",
  "UTC",
];

type Lang = "fa" | "en";
type DateCtx = {
  chatId: number;
  userId: number;
  chatType: string;
  userRank: Rank;
  lang: Lang;
  userName?: string;
  chatTitle?: string;
};
type DateSettings = {
  user_id: string;
  timezone: string;
  show_lunar: boolean;
  show_week: boolean;
  show_day_of_year: boolean;
  hour_cycle: "12" | "24";
};
type DateFlow = {
  flow: "convert" | "diff" | "arithmetic" | "countdown" | "event_title" | "event_datetime" | "event_remind" | "age" | "birthday" | "timezone";
  data: Record<string, any>;
  expires: number;
};

const flows = new Map<number, DateFlow>();
const FLOW_TTL = 10 * 60 * 1000;

const MONTH_FA = ["", "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
const MONTH_EN = ["", "Farvardin", "Ordibehesht", "Khordad", "Tir", "Mordad", "Shahrivar", "Mehr", "Aban", "Azar", "Dey", "Bahman", "Esfand"];
const WEEK_FA = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];
const WEEK_EN = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function faNum(value: unknown) {
  return String(value ?? "").replace(/\d/g, d => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}
function enNum(value: unknown) {
  return String(value ?? "").replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
}
function normalizeDigits(value: unknown) {
  return enNum(String(value ?? "")).replace(/[٬٫]/g, ".");
}
function line(label: string, value: unknown) {
  const v = String(value ?? "").trim() || "—";
  return "⛂ - " + label + " : " + v;
}
function heading(value: string) {
  return "★ - " + value;
}
function parseParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "long",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(fmt.formatToParts(date).filter(x => x.type !== "literal").map(x => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday: String(p.weekday || ""),
  };
}
function civilDate(year: number, month: number, day: number, hour = 12, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
}
function weekdayIndex(year: number, month: number, day: number) {
  return (new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay() + 1) % 7;
}
function persianPartsFromUtc(date: Date) {
  const fmt = new Intl.DateTimeFormat("en-US-u-ca-persian", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const p = Object.fromEntries(fmt.formatToParts(date).filter(x => x.type !== "literal").map(x => [x.type, x.value]));
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day) };
}
function findPersianYearStart(jy: number) {
  const gy = jy + 621;
  for (let d = 19; d <= 23; d++) {
    const date = civilDate(gy, 3, d);
    const p = persianPartsFromUtc(date);
    if (p.year === jy && p.month === 1 && p.day === 1) return date;
  }
  return null;
}
function jalaliYearDays(jy: number) {
  const a = findPersianYearStart(jy);
  const b = findPersianYearStart(jy + 1);
  if (!a || !b) return 365;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
function jalaliToGregorian(jy: number, jm: number, jd: number) {
  if (!Number.isInteger(jy) || !Number.isInteger(jm) || !Number.isInteger(jd) || jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
  const start = findPersianYearStart(jy);
  const next = findPersianYearStart(jy + 1);
  if (!start || !next) return null;
  const yearDays = Math.round((next.getTime() - start.getTime()) / 86400000);
  const monthDays = jm <= 6 ? 31 : jm <= 11 ? 30 : yearDays - 336;
  if (jd > monthDays) return null;
  const offset = (jm <= 6 ? (jm - 1) * 31 : jm <= 11 ? 186 + (jm - 7) * 30 : 336) + jd - 1;
  const out = new Date(start.getTime() + offset * 86400000);
  return { year: out.getUTCFullYear(), month: out.getUTCMonth() + 1, day: out.getUTCDate() };
}
function gregorianToJalali(year: number, month: number, day: number) {
  const date = civilDate(year, month, day);
  const p = persianPartsFromUtc(date);
  return Number.isFinite(p.year) && Number.isFinite(p.month) && Number.isFinite(p.day) ? p : null;
}
function jalaliDayOfYear(jy: number, jm: number, jd: number) {
  return jm <= 6 ? (jm - 1) * 31 + jd : jm <= 11 ? 186 + (jm - 7) * 30 + jd : 336 + jd;
}
function islamicParts(date: Date) {
  const fmt = new Intl.DateTimeFormat("en-US-u-ca-islamic-umalqura", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const p = Object.fromEntries(fmt.formatToParts(date).filter(x => x.type !== "literal").map(x => [x.type, x.value]));
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day) };
}
function islamicFull(date: Date, lang: Lang) {
  return new Intl.DateTimeFormat(lang === "fa" ? "fa-IR-u-ca-islamic-umalqura" : "en-US-u-ca-islamic-umalqura", {
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}
function islamicCivilJdn(y: number, m: number, d: number) {
  return d + Math.ceil(29.5 * (m - 1)) + (y - 1) * 354 + Math.floor((3 + 11 * y) / 30) + 1948439 - 1;
}
function jdnToGregorian(jdn: number) {
  let l = jdn + 68569;
  const n = Math.floor(4 * l / 146097);
  l -= Math.floor((146097 * n + 3) / 4);
  const i = Math.floor(4000 * (l + 1) / 1461001);
  l = l - Math.floor(1461 * i / 4) + 31;
  const j = Math.floor(80 * l / 2447);
  const d = l - Math.floor(2447 * j / 80);
  l = Math.floor(j / 11);
  const m = j + 2 - 12 * l;
  const y = 100 * (n - 49) + i + l;
  return { year: y, month: m, day: d };
}
function islamicToGregorian(y: number, m: number, d: number) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) || m < 1 || m > 12 || d < 1 || d > 30) return null;
  const approx = jdnToGregorian(islamicCivilJdn(y, m, d));
  for (let delta = -5; delta <= 5; delta++) {
    const dt = civilDate(approx.year, approx.month, approx.day);
    dt.setUTCDate(dt.getUTCDate() + delta);
    const p = islamicParts(dt);
    if (p.year === y && p.month === m && p.day === d) {
      return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
    }
  }
  return approx;
}
function offsetMinutes(date: Date, timeZone: string) {
  const text = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset", hour: "2-digit" })
    .formatToParts(date).find(x => x.type === "timeZoneName")?.value || "GMT";
  const m = text.match(/^GMT([+-])(\d{2})(?::(\d{2}))?$/);
  if (!m) return 0;
  const mins = Number(m[2]) * 60 + Number(m[3] || 0);
  return (m[1] === "-" ? -1 : 1) * mins;
}
function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}
function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
  if (!isValidTimeZone(timeZone)) return null;
  const base = civilDate(year, month, day, hour, minute);
  const first = offsetMinutes(base, timeZone);
  const guess = new Date(base.getTime() - first * 60000);
  const second = offsetMinutes(guess, timeZone);
  return new Date(base.getTime() - second * 60000);
}
function formatPersian(date: Date, lang: Lang, timeZone: string) {
  return new Intl.DateTimeFormat(lang === "fa" ? "fa-IR-u-ca-persian" : "en-US-u-ca-persian", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}
function formatGregorian(date: Date, lang: Lang, timeZone: string) {
  return new Intl.DateTimeFormat(lang === "fa" ? "fa-IR" : "en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}
function isoWeek(year: number, month: number, day: number) {
  const date = civilDate(year, month, day);
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday + 3);
  const first = new Date(Date.UTC(date.getUTCFullYear(), 0, 4, 12));
  return 1 + Math.round((date.getTime() - first.getTime()) / 86400000 / 7);
}
function season(jm: number, lang: Lang) {
  if (jm <= 3) return lang === "fa" ? "بهار" : "Spring";
  if (jm <= 6) return lang === "fa" ? "تابستان" : "Summer";
  if (jm <= 9) return lang === "fa" ? "پاییز" : "Autumn";
  return lang === "fa" ? "زمستان" : "Winter";
}
function parseDateOnly(value: string) {
  const s = normalizeDigits(value).trim();
  const m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (y >= 1200 && y <= 1599) {
    const g = jalaliToGregorian(y, mo, d);
    if (!g) return null;
    return { kind: "jalali", g, j: { year: y, month: mo, day: d } };
  }
  if (y >= 1800 && y <= 2500) {
    const j = gregorianToJalali(y, mo, d);
    return j ? { kind: "gregorian", g: { year: y, month: mo, day: d }, j } : null;
  }
  const g = islamicToGregorian(y, mo, d);
  if (!g) return null;
  const j = gregorianToJalali(g.year, g.month, g.day);
  return j ? { kind: "islamic", g, j, i: { year: y, month: mo, day: d } } : null;
}
function parseDateTime(value: string, timeZone: string) {
  const s = normalizeDigits(value).trim().replace(/\s+/g, " ");
  const m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]), h = Number(m[4] || 0), mi = Number(m[5] || 0);
  if (h > 23 || mi > 59) return null;
  let g: { year: number; month: number; day: number } | null = null;
  if (y >= 1200 && y <= 1599) g = jalaliToGregorian(y, mo, d);
  else if (y >= 1800 && y <= 2500) g = { year: y, month: mo, day: d };
  if (!g) return null;
  const date = zonedToUtc(g.year, g.month, g.day, h, mi, timeZone);
  const j = gregorianToJalali(g.year, g.month, g.day);
  return date && j ? { date, g, j } : null;
}
function formatDuration(ms: number, lang: Lang) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (lang === "en") return [days ? days + "d" : "", hours ? hours + "h" : "", minutes ? minutes + "m" : "", seconds ? seconds + "s" : ""].filter(Boolean).join(" ") || "0s";
  return [days ? faNum(days) + " روز" : "", hours ? faNum(hours) + " ساعت" : "", minutes ? faNum(minutes) + " دقیقه" : "", seconds ? faNum(seconds) + " ثانیه" : ""].filter(Boolean).join(" ") || "۰ ثانیه";
}

export async function ensureDateSchema(pool: Pool) {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS bot_date_user_settings (" +
    "user_id BIGINT PRIMARY KEY, timezone TEXT NOT NULL DEFAULT 'Asia/Tehran'," +
    "show_lunar BOOLEAN NOT NULL DEFAULT TRUE, show_week BOOLEAN NOT NULL DEFAULT TRUE," +
    "show_day_of_year BOOLEAN NOT NULL DEFAULT TRUE, hour_cycle TEXT NOT NULL DEFAULT '24'," +
    "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());" +
    "CREATE TABLE IF NOT EXISTS bot_date_events (" +
    "id BIGSERIAL PRIMARY KEY, scope TEXT NOT NULL CHECK(scope IN ('group','personal'))," +
    "chat_id BIGINT NOT NULL, creator_id BIGINT NOT NULL, title TEXT NOT NULL," +
    "event_at TIMESTAMPTZ NOT NULL, timezone TEXT NOT NULL DEFAULT 'Asia/Tehran'," +
    "remind_minutes INTEGER NOT NULL DEFAULT 30, reminder_sent BOOLEAN NOT NULL DEFAULT FALSE," +
    "enabled BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());" +
    "CREATE INDEX IF NOT EXISTS idx_bot_date_events_due ON bot_date_events(enabled, reminder_sent, event_at);" +
    "CREATE INDEX IF NOT EXISTS idx_bot_date_events_scope ON bot_date_events(scope, chat_id, event_at);"
  );
}
async function getSettings(pool: Pool, userId: number) {
  const r = await pool.query<DateSettings>(
    "INSERT INTO bot_date_user_settings(user_id) VALUES($1) " +
    "ON CONFLICT(user_id) DO UPDATE SET updated_at=bot_date_user_settings.updated_at RETURNING *",
    [userId]
  );
  return r.rows[0];
}
async function setSetting(pool: Pool, userId: number, key: string, value: unknown) {
  const allowed = new Set(["timezone", "show_lunar", "show_week", "show_day_of_year", "hour_cycle"]);
  if (!allowed.has(key)) return;
  await pool.query("UPDATE bot_date_user_settings SET " + key + "=$1, updated_at=NOW() WHERE user_id=$2", [value, userId]);
}
function menuForLang(lang: Lang) {
  return lang === "en"
    ? [
        [["› Today", "date:today"], ["› Tomorrow / Yesterday", "date:relative"]],
        [["› Monthly calendar", "date:calendar"], ["› World clock", "date:world"]],
        [["› Convert date", "date:convert"], ["› Date difference", "date:diff"]],
        [["› Date calculator", "date:arithmetic"], ["› Countdown", "date:countdown"]],
        [["› Occasions", "date:occasions"], ["› Events", "date:events"]],
        [["› Age calculator", "date:age"], ["› Next birthday", "date:birthday"]],
        [["› Date settings", "date:settings"]],
        [["‹ Back", "c:home"]],
      ]
    : [
        [["› امروز", "date:today"], ["› فردا و دیروز", "date:relative"]],
        [["› تقویم ماه", "date:calendar"], ["› ساعت جهانی", "date:world"]],
        [["› تبدیل تاریخ", "date:convert"], ["› اختلاف تاریخ", "date:diff"]],
        [["› محاسبه تاریخ", "date:arithmetic"], ["› شمارش معکوس", "date:countdown"]],
        [["› مناسبت‌ها", "date:occasions"], ["› رویدادها", "date:events"]],
        [["› محاسبه سن", "date:age"], ["› تولد بعدی", "date:birthday"]],
        [["› تنظیمات تاریخ", "date:settings"]],
        [["‹ بازگشت", "c:home"]],
      ];
}
async function home(ctx: DateCtx, pool: Pool, messageId?: number) {
  const s = await getSettings(pool, ctx.userId);
  const now = new Date();
  const p = parseParts(now, s.timezone);
  const j = gregorianToJalali(p.year, p.month, p.day)!;
  const civil = civilDate(p.year, p.month, p.day);
  const days = jalaliYearDays(j.year);
  const dayOfYear = jalaliDayOfYear(j.year, j.month, j.day);
  const remaining = Math.max(0, days - dayOfYear);
  const pct = Math.round(dayOfYear * 1000 / days) / 10;
  const body = [
    line(ctx.lang === "fa" ? "شمسی" : "Persian", formatPersian(civil, ctx.lang, s.timezone)),
    line(ctx.lang === "fa" ? "میلادی" : "Gregorian", formatGregorian(civil, ctx.lang, s.timezone)),
    s.show_lunar ? line(ctx.lang === "fa" ? "قمری" : "Lunar", islamicFull(civil, ctx.lang)) : null,
    s.show_week ? line(ctx.lang === "fa" ? "هفته سال" : "Week of year", isoWeek(p.year, p.month, p.day)) : null,
    s.show_day_of_year ? line(ctx.lang === "fa" ? "روز سال" : "Day of year", faNum(dayOfYear) + " / " + faNum(days)) : null,
    s.show_day_of_year ? line(ctx.lang === "fa" ? "باقی‌مانده سال" : "Remaining year", faNum(remaining) + (ctx.lang === "fa" ? " روز" : " days")) : null,
    s.show_day_of_year ? line(ctx.lang === "fa" ? "پیشرفت سال" : "Year progress", faNum(pct) + (ctx.lang === "fa" ? "٪" : "%")) : null,
    line(ctx.lang === "fa" ? "فصل" : "Season", season(j.month, ctx.lang)),
    line(ctx.lang === "fa" ? "منطقه زمانی" : "Timezone", s.timezone + " · " + offsetMinutes(now, s.timezone) / 60),
    line(ctx.lang === "fa" ? "ساعت محلی" : "Local time", new Intl.DateTimeFormat(ctx.lang === "fa" ? "fa-IR" : "en-US", {
      timeZone: s.timezone, hour: "2-digit", minute: "2-digit", hourCycle: s.hour_cycle === "12" ? "h12" : "h23",
    }).format(now)),
  ].filter(Boolean).join("\n");
  const text = TITLE + "\n\n" + heading(ctx.lang === "fa" ? "مرکز تاریخ" : "Date Center") + "\n\n" + body + "\n\n" + SEP + "\n\n" + heading(ctx.lang === "fa" ? "ابزارها" : "Tools");
  const markup = glassKeyboard(menuForLang(ctx.lang));
  if (messageId) return editDate(ctx, messageId, text, markup);
  return telegramApi("sendMessage", { chat_id: ctx.chatId, text, reply_markup: markup });
}
async function editDate(ctx: DateCtx, messageId: number, text: string, replyMarkup: any) {
  const r = await telegramApi("editMessageText", { chat_id: ctx.chatId, message_id: messageId, text, reply_markup: replyMarkup });
  if (!r.ok) await telegramApi("sendMessage", { chat_id: ctx.chatId, text, reply_markup: replyMarkup });
  return r;
}
function backKeyboard() {
  return glassKeyboard([[["‹ بازگشت", "date:home"]]]);
}
function shiftCivil(y: number, m: number, d: number, delta: number) {
  const x = civilDate(y, m, d);
  x.setUTCDate(x.getUTCDate() + delta);
  return { year: x.getUTCFullYear(), month: x.getUTCMonth() + 1, day: x.getUTCDate() };
}
async function today(ctx: DateCtx, pool: Pool, messageId: number) {
  const s = await getSettings(pool, ctx.userId);
  const now = new Date(), p = parseParts(now, s.timezone);
  const civil = civilDate(p.year, p.month, p.day);
  const j = gregorianToJalali(p.year, p.month, p.day)!;
  const days = jalaliYearDays(j.year);
  const body = [
    line(ctx.lang === "fa" ? "شمسی" : "Persian", formatPersian(civil, ctx.lang, s.timezone)),
    line(ctx.lang === "fa" ? "میلادی" : "Gregorian", formatGregorian(civil, ctx.lang, s.timezone)),
    s.show_lunar ? line(ctx.lang === "fa" ? "قمری" : "Lunar", islamicFull(civil, ctx.lang)) : null,
    s.show_week ? line(ctx.lang === "fa" ? "شماره هفته" : "Week", isoWeek(p.year, p.month, p.day)) : null,
    s.show_day_of_year ? line(ctx.lang === "fa" ? "روز سال" : "Day of year", faNum(jalaliDayOfYear(j.year, j.month, j.day)) + " / " + faNum(days)) : null,
    line(ctx.lang === "fa" ? "فصل" : "Season", season(j.month, ctx.lang)),
    line(ctx.lang === "fa" ? "منطقه زمانی" : "Timezone", s.timezone),
    line(ctx.lang === "fa" ? "ساعت" : "Time", new Intl.DateTimeFormat(ctx.lang === "fa" ? "fa-IR" : "en-US", { timeZone: s.timezone, hour: "2-digit", minute: "2-digit", hourCycle: s.hour_cycle === "12" ? "h12" : "h23" }).format(now)),
  ].filter(Boolean).join("\n");
  const rows = ctx.lang === "fa"
    ? [[["› فردا", "date:relative:tomorrow"], ["› دیروز", "date:relative:yesterday"]], [["› تقویم", "date:calendar"], ["› ساعت جهانی", "date:world"]], [["‹ بازگشت", "date:home"]]]
    : [[["› Tomorrow", "date:relative:tomorrow"], ["› Yesterday", "date:relative:yesterday"]], [["› Calendar", "date:calendar"], ["› World clock", "date:world"]], [["‹ Back", "date:home"]]];
  return editDate(ctx, messageId, TITLE + "\n\n" + heading(ctx.lang === "fa" ? "امروز" : "Today") + "\n\n" + body + "\n\n" + SEP, glassKeyboard(rows));
}
async function relative(ctx: DateCtx, pool: Pool, messageId: number, delta: number) {
  const s = await getSettings(pool, ctx.userId), p = parseParts(new Date(), s.timezone);
  const target = shiftCivil(p.year, p.month, p.day, delta);
  const date = civilDate(target.year, target.month, target.day);
  const j = gregorianToJalali(target.year, target.month, target.day)!;
  const labelFa = delta === 1 ? "فردا" : delta === -1 ? "دیروز" : delta === 2 ? "پس‌فردا" : "پریروز";
  const labelEn = delta === 1 ? "Tomorrow" : delta === -1 ? "Yesterday" : delta === 2 ? "Day after tomorrow" : "Day before yesterday";
  const text = TITLE + "\n\n" + heading(ctx.lang === "fa" ? labelFa : labelEn) + "\n\n" +
    line(ctx.lang === "fa" ? "روز هفته" : "Weekday", ctx.lang === "fa" ? WEEK_FA[weekdayIndex(target.year, target.month, target.day)] : WEEK_EN[weekdayIndex(target.year, target.month, target.day)]) + "\n" +
    line(ctx.lang === "fa" ? "شمسی" : "Persian", formatPersian(date, ctx.lang, s.timezone)) + "\n" +
    line(ctx.lang === "fa" ? "میلادی" : "Gregorian", formatGregorian(date, ctx.lang, s.timezone)) + "\n" +
    line(ctx.lang === "fa" ? "قمری" : "Lunar", islamicFull(date, ctx.lang)) + "\n\n" + SEP;
  return editDate(ctx, messageId, text, glassKeyboard([[["‹ بازگشت", "date:today"]]]));
}
function renderCalendar(ctx: DateCtx, jy: number, jm: number) {
  const first = jalaliToGregorian(jy, jm, 1);
  if (!first) return { text: TITLE + "\n\n" + line("وضعیت", "✗ ماه نامعتبر"), markup: backKeyboard() };
  const days = jm <= 6 ? 31 : jm <= 11 ? 30 : jalaliYearDays(jy) - 336;
  const weekdayHeaders = ctx.lang === "fa" ? ["ش", "ی", "د", "س", "چ", "پ", "ج"] : ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];
  const rows: any[][] = [weekdayHeaders.map(x => ({ text: x, callback_data: "date:noop" }))];
  let week: any[] = [];
  const start = weekdayIndex(first.year, first.month, first.day);
  for (let i = 0; i < start; i++) week.push({ text: "·", callback_data: "date:noop" });
  for (let d = 1; d <= days; d++) {
    week.push({ text: faNum(d), callback_data: "date:day:" + jy + ":" + jm + ":" + d });
    if (week.length === 7) { rows.push(week); week = []; }
  }
  if (week.length) {
    while (week.length < 7) week.push({ text: "·", callback_data: "date:noop" });
    rows.push(week);
  }
  const prevJY = jm === 1 ? jy - 1 : jy, prevJM = jm === 1 ? 12 : jm - 1;
  const nextJY = jm === 12 ? jy + 1 : jy, nextJM = jm === 12 ? 1 : jm + 1;
  rows.push([
    { text: "‹ " + (ctx.lang === "fa" ? "ماه قبل" : "Previous"), callback_data: "date:cal:" + prevJY + ":" + prevJM },
    { text: ctx.lang === "fa" ? "امروز" : "Today", callback_data: "date:calendar" },
    { text: (ctx.lang === "fa" ? "ماه بعد" : "Next") + " ›", callback_data: "date:cal:" + nextJY + ":" + nextJM },
  ]);
  rows.push([{ text: ctx.lang === "fa" ? "‹ بازگشت" : "‹ Back", callback_data: "date:home", style: "primary" }]);
  const title = ctx.lang === "fa" ? MONTH_FA[jm] + " " + faNum(jy) : MONTH_EN[jm] + " " + jy;
  const text = TITLE + "\n\n" + heading(ctx.lang === "fa" ? "تقویم ماه" : "Monthly calendar") + "\n\n" +
    line(ctx.lang === "fa" ? "ماه" : "Month", title) + "\n" + line(ctx.lang === "fa" ? "تعداد روز" : "Days", days) + "\n\n" + SEP;
  return { text, markup: { inline_keyboard: rows } };
}
async function dayDetail(ctx: DateCtx, pool: Pool, messageId: number, jy: number, jm: number, jd: number) {
  const g = jalaliToGregorian(jy, jm, jd);
  if (!g) return editDate(ctx, messageId, TITLE + "\n\n" + line("وضعیت", "✗ تاریخ نامعتبر"), backKeyboard());
  const dt = civilDate(g.year, g.month, g.day);
  const s = await getSettings(pool, ctx.userId);
  const text = TITLE + "\n\n" + heading(ctx.lang === "fa" ? "جزئیات روز" : "Day details") + "\n\n" +
    line(ctx.lang === "fa" ? "روز هفته" : "Weekday", ctx.lang === "fa" ? WEEK_FA[weekdayIndex(g.year, g.month, g.day)] : WEEK_EN[weekdayIndex(g.year, g.month, g.day)]) + "\n" +
    line(ctx.lang === "fa" ? "شمسی" : "Persian", formatPersian(dt, ctx.lang, s.timezone)) + "\n" +
    line(ctx.lang === "fa" ? "میلادی" : "Gregorian", formatGregorian(dt, ctx.lang, s.timezone)) + "\n" +
    line(ctx.lang === "fa" ? "قمری" : "Lunar", islamicFull(dt, ctx.lang)) + "\n" +
    line(ctx.lang === "fa" ? "روز سال" : "Day of year", faNum(jalaliDayOfYear(jy, jm, jd))) + "\n" +
    line(ctx.lang === "fa" ? "فصل" : "Season", season(jm, ctx.lang)) + "\n\n" + SEP;
  return editDate(ctx, messageId, text, glassKeyboard([
    [[ctx.lang === "fa" ? "› تقویم ماه" : "› Monthly calendar", "date:cal:" + jy + ":" + jm]],
    [[ctx.lang === "fa" ? "‹ بازگشت" : "‹ Back", "date:calendar"]],
  ]));
}
function promptText(ctx: DateCtx, title: string, prompt: string, format: string, flow: DateFlow["flow"], data: Record<string, any>, messageId: number) {
  flows.set(ctx.userId, { flow, data: { ...data, format }, expires: Date.now() + FLOW_TTL });
  return editDate(ctx, messageId, TITLE + "\n\n" + heading(title) + "\n\n" + line("راهنما", prompt) + "\n" + line("فرمت", format) + "\n\n" + SEP, backKeyboard());
}
function parseDifference(value: string, timeZone: string) {
  const pieces = normalizeDigits(value).trim().split(/\s+(?:تا|to|→|->)\s+/i);
  if (pieces.length !== 2) return null;
  const a = parseDateTime(pieces[0], timeZone), b = parseDateTime(pieces[1], timeZone);
  if (!a || !b) return null;
  const ms = Math.abs(b.date.getTime() - a.date.getTime());
  return { a, b, ms, days: Math.floor(ms / 86400000), minutes: Math.floor(ms / 60000) };
}
function calculateDate(value: string, timeZone: string) {
  const m = normalizeDigits(value).trim().match(/^(.+?)\s*([+-])\s*(\d+)\s*(روز|day|days|هفته|week|weeks|ماه|month|months)$/i);
  if (!m) return null;
  const base = parseDateTime(m[1].trim(), timeZone);
  if (!base) return null;
  const n = Number(m[3]), unit = m[4].toLowerCase(), sign = m[2] === "+" ? 1 : -1;
  if (unit.startsWith("ماه") || unit.startsWith("month")) {
    const b = base.j;
    const idx = b.year * 12 + (b.month - 1) + sign * n;
    const y = Math.floor(idx / 12), mo = idx % 12 + 1;
    const max = mo <= 6 ? 31 : mo <= 11 ? 30 : jalaliYearDays(y) - 336;
    const g = jalaliToGregorian(y, mo, Math.min(b.day, max));
    if (!g) return null;
    const bp = parseParts(base.date, timeZone);
    const date = zonedToUtc(g.year, g.month, g.day, bp.hour, bp.minute, timeZone);
    return date ? { date } : null;
  }
  const days = sign * n * (unit.startsWith("هفته") || unit.startsWith("week") ? 7 : 1);
  const date = new Date(base.date.getTime() + days * 86400000);
  return { date };
}
function ageValue(birth: { year: number; month: number; day: number }, current: { year: number; month: number; day: number }) {
  let years = current.year - birth.year;
  if (current.month < birth.month || (current.month === birth.month && current.day < birth.day)) years--;
  let months = current.month - birth.month;
  if (months < 0) months += 12;
  if (current.day < birth.day) months = Math.max(0, months - 1);
  const prevMonth = current.month === 1 ? 12 : current.month - 1;
  const prevYear = current.month === 1 ? current.year - 1 : current.year;
  const prevDays = prevMonth <= 6 ? 31 : prevMonth <= 11 ? 30 : jalaliYearDays(prevYear) - 336;
  const days = current.day >= birth.day ? current.day - birth.day : current.day + prevDays - birth.day;
  return { years, months, days };
}
function nextBirthday(birth: { year: number; month: number; day: number }, current: { year: number; month: number; day: number }, timeZone: string) {
  let y = current.year;
  if (current.month > birth.month || (current.month === birth.month && current.day >= birth.day)) y++;
  const max = birth.month <= 6 ? 31 : birth.month <= 11 ? 30 : jalaliYearDays(y) - 336;
  const g = jalaliToGregorian(y, birth.month, Math.min(birth.day, max));
  if (!g) return null;
  return zonedToUtc(g.year, g.month, g.day, 0, 0, timeZone);
}
function fixedOccasions(g: { year: number; month: number; day: number }, j: { year: number; month: number; day: number }) {
  const global: Record<string, string> = {
    "01-01": "آغاز سال میلادی · New Year's Day",
    "02-14": "روز ولنتاین · Valentine's Day",
    "03-08": "روز جهانی زن · International Women's Day",
    "04-22": "روز زمین · Earth Day",
    "06-05": "روز جهانی محیط زیست · World Environment Day",
    "10-01": "روز جهانی سالمندان · International Day of Older Persons",
    "10-05": "روز جهانی معلم · World Teachers' Day",
    "10-24": "روز ملل متحد · United Nations Day",
    "11-20": "روز جهانی کودک · World Children's Day",
    "12-03": "روز جهانی افراد دارای معلولیت · International Day of Persons with Disabilities",
    "12-10": "روز حقوق بشر · Human Rights Day",
  };
  const fixed = global[String(g.month).padStart(2, "0") + "-" + String(g.day).padStart(2, "0")];
  const jalali: Record<string, string> = {
    "01-01": "نوروز · Nowruz",
    "01-02": "نوروز · Nowruz",
    "01-03": "نوروز · Nowruz",
    "01-04": "نوروز · Nowruz",
    "01-13": "روز طبیعت · Nature Day",
  };
  const jx = jalali[String(j.month).padStart(2, "0") + "-" + String(j.day).padStart(2, "0")];
  return [fixed, jx].filter(Boolean) as string[];
}
async function occasions(ctx: DateCtx, pool: Pool, messageId: number) {
  const s = await getSettings(pool, ctx.userId);
  const p = parseParts(new Date(), s.timezone);
  const g = { year: p.year, month: p.month, day: p.day };
  const j = gregorianToJalali(p.year, p.month, p.day)!;
  const custom = (await pool.query(
    "SELECT title,event_at,timezone FROM bot_date_events WHERE enabled=TRUE AND ((scope='group' AND chat_id=$1) OR (scope='personal' AND creator_id=$2)) AND event_at>=DATE_TRUNC('day', NOW()) AND event_at<DATE_TRUNC('day', NOW())+INTERVAL '1 day' ORDER BY event_at LIMIT 10",
    [ctx.chatType === "private" ? ctx.userId : ctx.chatId, ctx.userId]
  )).rows;
  const fixed = fixedOccasions(g, j);
  const body = [
    ...fixed.map((x, i) => line(ctx.lang === "fa" ? "مناسبت " + (i + 1) : "Occasion " + (i + 1), x)),
    ...custom.map((x: any, i: number) => line(ctx.lang === "fa" ? "رویداد " + (i + 1) : "Event " + (i + 1), x.title + " · " + new Date(x.event_at).toLocaleTimeString(ctx.lang === "fa" ? "fa-IR" : "en-US", { timeZone: x.timezone, hour: "2-digit", minute: "2-digit" }))),
  ];
  const text = TITLE + "\n\n" + heading(ctx.lang === "fa" ? "مناسبت‌های امروز" : "Today's occasions") + "\n\n" +
    (body.length ? body.join("\n") : line(ctx.lang === "fa" ? "وضعیت" : "Status", ctx.lang === "fa" ? "موردی ثبت نشده است." : "Nothing is registered.")) + "\n\n" + SEP;
  return editDate(ctx, messageId, text, glassKeyboard([
    [[ctx.lang === "fa" ? "› رویدادها" : "› Events", "date:events"], [ctx.lang === "fa" ? "› آینده" : "› Upcoming", "date:events:upcoming"]],
    [[ctx.lang === "fa" ? "‹ بازگشت" : "‹ Back", "date:home"]],
  ]));
}
async function worldClock(ctx: DateCtx, pool: Pool, messageId: number) {
  const s = await getSettings(pool, ctx.userId);
  const now = new Date();
  const zones = [...new Set([s.timezone, ...COMMON_TZ])].slice(0, 8);
  const body = zones.map(z => line(
    z,
    new Intl.DateTimeFormat(ctx.lang === "fa" ? "fa-IR" : "en-US", { timeZone: z, hour: "2-digit", minute: "2-digit", hourCycle: s.hour_cycle === "12" ? "h12" : "h23" }).format(now) +
    " · " + formatPersian(now, ctx.lang, z)
  )).join("\n");
  return editDate(ctx, messageId, TITLE + "\n\n" + heading(ctx.lang === "fa" ? "ساعت جهانی" : "World clock") + "\n\n" + body + "\n\n" + SEP, glassKeyboard([
    [[ctx.lang === "fa" ? "› تنظیم منطقه زمانی" : "› Timezone settings", "date:settings:timezone"]],
    [[ctx.lang === "fa" ? "‹ بازگشت" : "‹ Back", "date:home"]],
  ]));
}
async function settings(ctx: DateCtx, pool: Pool, messageId: number) {
  const s = await getSettings(pool, ctx.userId);
  const body = [
    line(ctx.lang === "fa" ? "منطقه زمانی" : "Timezone", s.timezone),
    line(ctx.lang === "fa" ? "نمایش قمری" : "Lunar display", s.show_lunar ? "فعال" : "خاموش"),
    line(ctx.lang === "fa" ? "نمایش هفته" : "Week display", s.show_week ? "فعال" : "خاموش"),
    line(ctx.lang === "fa" ? "نمایش روز سال" : "Day-of-year display", s.show_day_of_year ? "فعال" : "خاموش"),
    line(ctx.lang === "fa" ? "فرمت ساعت" : "Hour cycle", s.hour_cycle === "24" ? "۲۴ ساعته" : "۱۲ ساعته"),
  ].join("\n");
  return editDate(ctx, messageId, TITLE + "\n\n" + heading(ctx.lang === "fa" ? "تنظیمات تاریخ" : "Date settings") + "\n\n" + body + "\n\n" + SEP, glassKeyboard([
    [[ctx.lang === "fa" ? "› منطقه زمانی" : "› Timezone", "date:settings:timezone"]],
    [[ctx.lang === "fa" ? "› نمایش قمری" : "› Toggle lunar", "date:settings:toggle:show_lunar"], [ctx.lang === "fa" ? "› نمایش هفته" : "› Toggle week", "date:settings:toggle:show_week"]],
    [[ctx.lang === "fa" ? "› روز سال" : "› Toggle day of year", "date:settings:toggle:show_day_of_year"], [ctx.lang === "fa" ? "› فرمت ساعت" : "› 12 / 24 hours", "date:settings:toggle:hour_cycle"]],
    [[ctx.lang === "fa" ? "‹ بازگشت" : "‹ Back", "date:home"]],
  ]));
}
async function timezonePicker(ctx: DateCtx, pool: Pool, messageId: number) {
  const s = await getSettings(pool, ctx.userId);
  const rows = COMMON_TZ.map(z => [[z, "date:tz:" + encodeURIComponent(z)]]);
  rows.push([[ctx.lang === "fa" ? "› منطقه دلخواه" : "› Custom timezone", "date:settings:tzinput"]]);
  rows.push([[ctx.lang === "fa" ? "‹ بازگشت" : "‹ Back", "date:settings"]]);
  return editDate(ctx, messageId, TITLE + "\n\n" + heading(ctx.lang === "fa" ? "منطقه زمانی" : "Timezone") + "\n\n" + line(ctx.lang === "fa" ? "فعلی" : "Current", s.timezone) + "\n\n" + SEP, glassKeyboard(rows));
}
async function events(ctx: DateCtx, pool: Pool, messageId: number) {
  const groupKey = ctx.chatType === "private" ? ctx.userId : ctx.chatId;
  const groupCount = ctx.chatType === "private" ? 0 : Number((await pool.query("SELECT COUNT(*)::int AS c FROM bot_date_events WHERE scope='group' AND chat_id=$1 AND enabled=TRUE AND event_at>=NOW()", [groupKey])).rows[0]?.c || 0);
  const personalCount = Number((await pool.query("SELECT COUNT(*)::int AS c FROM bot_date_events WHERE scope='personal' AND creator_id=$1 AND enabled=TRUE AND event_at>=NOW()", [ctx.userId])).rows[0]?.c || 0);
  const todayCount = Number((await pool.query(
    "SELECT COUNT(*)::int AS c FROM bot_date_events WHERE enabled=TRUE AND ((scope='group' AND chat_id=$1) OR (scope='personal' AND creator_id=$2)) AND event_at>=DATE_TRUNC('day', NOW()) AND event_at<DATE_TRUNC('day', NOW())+INTERVAL '1 day'",
    [groupKey, ctx.userId]
  )).rows[0]?.c || 0);
  const body = [
    line(ctx.lang === "fa" ? "رویدادهای گروه" : "Group events", groupCount),
    line(ctx.lang === "fa" ? "رویدادهای شخصی" : "Personal events", personalCount),
    line(ctx.lang === "fa" ? "رویدادهای امروز" : "Today", todayCount),
    line(ctx.lang === "fa" ? "موتور یادآوری" : "Reminder engine", "فعال"),
  ].join("\n");
  const rows: string[][][] = [];
  if (ctx.chatType !== "private") rows.push([
    [ctx.lang === "fa" ? "› رویداد جدید گروه" : "› New group event", "date:event:add:group"],
    [ctx.lang === "fa" ? "› رویداد جدید شخصی" : "› New personal event", "date:event:add:personal"],
  ]);
  else rows.push([[ctx.lang === "fa" ? "› رویداد جدید شخصی" : "› New personal event", "date:event:add:personal"]]);
  rows.push([
    [ctx.lang === "fa" ? "› رویدادهای گروه" : "› Group events", "date:event:list:group"],
    [ctx.lang === "fa" ? "› رویدادهای شخصی" : "› Personal events", "date:event:list:personal"],
  ]);
  rows.push([[ctx.lang === "fa" ? "› مناسبت‌های امروز" : "› Today's occasions", "date:occasions"]]);
  rows.push([[ctx.lang === "fa" ? "‹ بازگشت" : "‹ Back", "date:home"]]);
  return editDate(ctx, messageId, TITLE + "\n\n" + heading(ctx.lang === "fa" ? "مرکز رویدادها" : "Event Center") + "\n\n" + body + "\n\n" + SEP, glassKeyboard(rows));
}
async function eventList(ctx: DateCtx, pool: Pool, messageId: number, scope: "group" | "personal") {
  const where = scope === "group" ? "scope='group' AND chat_id=$1" : "scope='personal' AND creator_id=$1";
  const params = scope === "group" ? [ctx.chatId] : [ctx.userId];
  const rows = (await pool.query("SELECT id,title,event_at,timezone,remind_minutes FROM bot_date_events WHERE " + where + " AND enabled=TRUE AND event_at>=NOW() ORDER BY event_at LIMIT 12", params)).rows;
  const body = rows.length
    ? rows.map((x: any, i: number) => line((ctx.lang === "fa" ? "رویداد " : "Event ") + (i + 1), x.title + " · " + new Date(x.event_at).toLocaleString(ctx.lang === "fa" ? "fa-IR" : "en-US", { timeZone: x.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }))).join("\n")
    : line(ctx.lang === "fa" ? "وضعیت" : "Status", ctx.lang === "fa" ? "رویداد فعالی ثبت نشده است." : "No active event.");
  const buttons: string[][][] = rows.map((x: any) => [[ctx.lang === "fa" ? "› حذف " + x.id : "› Delete " + x.id, "date:event:delete:" + x.id]]);
  buttons.push([[ctx.lang === "fa" ? "‹ بازگشت" : "‹ Back", "date:events"]]);
  return editDate(ctx, messageId, TITLE + "\n\n" + heading(scope === "group" ? (ctx.lang === "fa" ? "رویدادهای گروه" : "Group events") : (ctx.lang === "fa" ? "رویدادهای شخصی" : "Personal events")) + "\n\n" + body + "\n\n" + SEP, glassKeyboard(buttons));
}
async function isChatAdmin(ctx: DateCtx) {
  if (ctx.chatType === "private") return true;
  if (["owner", "sudo", "admin"].includes(ctx.userRank)) return true;
  const r = await telegramApi<any>("getChatMember", { chat_id: ctx.chatId, user_id: ctx.userId }).catch(() => null);
  return r?.ok && ["administrator", "creator"].includes(String(r.result?.status || ""));
}

export async function openDateCenterFromCommand(pool: Pool, ctx: DateCtx, args: string[]) {
  await ensureDateSchema(pool);
  const sub = normalizeDigits(args.join(" ").trim()).toLowerCase();
  if (!sub) return home(ctx, pool);
  if (["امروز", "today"].includes(sub)) {
    const s = await getSettings(pool, ctx.userId);
    const p = parseParts(new Date(), s.timezone);
    const c = civilDate(p.year, p.month, p.day);
    const j = gregorianToJalali(p.year, p.month, p.day)!;
    const text = TITLE + "\n\n" + heading(ctx.lang === "fa" ? "امروز" : "Today") + "\n\n" +
      line(ctx.lang === "fa" ? "شمسی" : "Persian", formatPersian(c, ctx.lang, s.timezone)) + "\n" +
      line(ctx.lang === "fa" ? "میلادی" : "Gregorian", formatGregorian(c, ctx.lang, s.timezone)) + "\n" +
      line(ctx.lang === "fa" ? "قمری" : "Lunar", islamicFull(c, ctx.lang)) + "\n" +
      line(ctx.lang === "fa" ? "روز سال" : "Day of year", faNum(jalaliDayOfYear(j.year, j.month, j.day))) + "\n\n" + SEP;
    return telegramApi("sendMessage", { chat_id: ctx.chatId, text, reply_markup: backKeyboard() });
  }
  if (["فردا", "tomorrow"].includes(sub)) {
    const s = await getSettings(pool, ctx.userId), p = parseParts(new Date(), s.timezone), t = shiftCivil(p.year, p.month, p.day, 1), c = civilDate(t.year, t.month, t.day);
    return telegramApi("sendMessage", { chat_id: ctx.chatId, text: TITLE + "\n\n" + heading(ctx.lang === "fa" ? "فردا" : "Tomorrow") + "\n\n" + line(ctx.lang === "fa" ? "شمسی" : "Persian", formatPersian(c, ctx.lang, s.timezone)) + "\n" + line(ctx.lang === "fa" ? "میلادی" : "Gregorian", formatGregorian(c, ctx.lang, s.timezone)) + "\n" + line(ctx.lang === "fa" ? "قمری" : "Lunar", islamicFull(c, ctx.lang)) + "\n\n" + SEP, reply_markup: backKeyboard() });
  }
  if (["دیروز", "yesterday"].includes(sub)) {
    const s = await getSettings(pool, ctx.userId), p = parseParts(new Date(), s.timezone), t = shiftCivil(p.year, p.month, p.day, -1), c = civilDate(t.year, t.month, t.day);
    return telegramApi("sendMessage", { chat_id: ctx.chatId, text: TITLE + "\n\n" + heading(ctx.lang === "fa" ? "دیروز" : "Yesterday") + "\n\n" + line(ctx.lang === "fa" ? "شمسی" : "Persian", formatPersian(c, ctx.lang, s.timezone)) + "\n" + line(ctx.lang === "fa" ? "میلادی" : "Gregorian", formatGregorian(c, ctx.lang, s.timezone)) + "\n" + line(ctx.lang === "fa" ? "قمری" : "Lunar", islamicFull(c, ctx.lang)) + "\n\n" + SEP, reply_markup: backKeyboard() });
  }
  if (["تقویم", "calendar"].includes(sub)) {
    const s = await getSettings(pool, ctx.userId), p = parseParts(new Date(), s.timezone), j = gregorianToJalali(p.year, p.month, p.day)!;
    const c = renderCalendar(ctx, j.year, j.month);
    return telegramApi("sendMessage", { chat_id: ctx.chatId, text: c.text, reply_markup: c.markup });
  }
  const conversion = sub.replace(/^(?:تبدیل|convert)\s+/, "");
  if (conversion !== sub || /^\d{4}[\/-]\d{1,2}[\/-]\d{1,2}$/.test(sub)) {
    const raw = conversion !== sub ? conversion : sub;
    const parsed = parseDateOnly(raw);
    if (parsed) {
      const dt = civilDate(parsed.g.year, parsed.g.month, parsed.g.day);
      const body = line("ورودی", raw) + "\n" +
        line("شمسی", faNum(parsed.j.year) + "/" + faNum(String(parsed.j.month).padStart(2, "0")) + "/" + faNum(String(parsed.j.day).padStart(2, "0"))) + "\n" +
        line("میلادی", parsed.g.year + "/" + String(parsed.g.month).padStart(2, "0") + "/" + String(parsed.g.day).padStart(2, "0")) + "\n" +
        line("قمری", parsed.kind === "islamic" ? faNum(parsed.i.year) + "/" + faNum(String(parsed.i.month).padStart(2, "0")) + "/" + faNum(String(parsed.i.day).padStart(2, "0")) : faNum(islamicParts(dt).year) + "/" + faNum(String(islamicParts(dt).month).padStart(2, "0")) + "/" + faNum(String(islamicParts(dt).day).padStart(2, "0"))) ;
      return telegramApi("sendMessage", { chat_id: ctx.chatId, text: TITLE + "\n\n" + heading(ctx.lang === "fa" ? "تبدیل تاریخ" : "Date conversion") + "\n\n" + body + "\n\n" + SEP, reply_markup: backKeyboard() });
    }
  }
  return home(ctx, pool);
}

export async function handleDateTextInput(pool: Pool, msg: any) {
  const uid = Number(msg?.from?.id || 0);
  const f = flows.get(uid);
  if (!f || f.expires < Date.now()) {
    flows.delete(uid);
    return false;
  }
  const value = String(msg?.text ?? msg?.caption ?? "").trim();
  if (!value) return false;
  const chatType = String(msg?.chat?.type || "private");
  const ctx: DateCtx = {
    chatId: Number(msg.chat.id),
    userId: uid,
    chatType,
    userRank: "admin",
    lang: "fa",
    userName: msg.from?.first_name,
    chatTitle: msg.chat?.title,
  };
  const s = await getSettings(pool, uid);

  if (f.flow === "convert") {
    flows.delete(uid);
    const p = parseDateOnly(value);
    if (!p) {
      await telegramApi("sendMessage", { chat_id: ctx.chatId, text: TITLE + "\n\n" + heading("تبدیل تاریخ") + "\n\n" + line("وضعیت", "✗ تاریخ نامعتبر است") + "\n" + line("فرمت", "۱۴۰۵/۰۷/۰۹ یا 2026/10/01") + "\n\n" + SEP, reply_markup: backKeyboard() });
      return true;
    }
    const dt = civilDate(p.g.year, p.g.month, p.g.day), ip = islamicParts(dt);
    const out = line("ورودی", value) + "\n" +
      line("شمسی", faNum(p.j.year) + "/" + faNum(String(p.j.month).padStart(2, "0")) + "/" + faNum(String(p.j.day).padStart(2, "0"))) + "\n" +
      line("میلادی", p.g.year + "/" + String(p.g.month).padStart(2, "0") + "/" + String(p.g.day).padStart(2, "0")) + "\n" +
      line("قمری", p.kind === "islamic" && p.i ? faNum(p.i.year) + "/" + faNum(String(p.i.month).padStart(2, "0")) + "/" + faNum(String(p.i.day).padStart(2, "0")) : faNum(ip.year) + "/" + faNum(String(ip.month).padStart(2, "0")) + "/" + faNum(String(ip.day).padStart(2, "0")) ) + "\n" +
      line("روز هفته", WEEK_FA[weekdayIndex(p.g.year, p.g.month, p.g.day)]);
    await telegramApi("sendMessage", { chat_id: ctx.chatId, text: TITLE + "\n\n" + heading("نتیجه تبدیل") + "\n\n" + out + "\n\n" + SEP, reply_markup: backKeyboard() });
    return true;
  }

  if (f.flow === "diff") {
    flows.delete(uid);
    const r = parseDifference(value, s.timezone);
    if (!r) {
      await telegramApi("sendMessage", { chat_id: ctx.chatId, text: TITLE + "\n\n" + heading("اختلاف تاریخ") + "\n\n" + line("وضعیت", "✗ ورودی نامعتبر") + "\n" + line("فرمت", "۱۴۰۵/۰۷/۰۱ تا ۱۴۰۵/۰۷/۳۰") + "\n\n" + SEP, reply_markup: backKeyboard() });
      return true;
    }
    await telegramApi("sendMessage", { chat_id: ctx.chatId, text: TITLE + "\n\n" + heading("اختلاف تاریخ") + "\n\n" +
      line("تاریخ اول", formatPersian(r.a.date, "fa", s.timezone)) + "\n" +
      line("تاریخ دوم", formatPersian(r.b.date, "fa", s.timezone)) + "\n" +
      line("اختلاف روز", faNum(r.days)) + "\n" +
      line("اختلاف دقیقه", faNum(r.minutes)) + "\n" +
      line("فاصله دقیق", formatDuration(r.ms, "fa")) + "\n\n" + SEP, reply_markup: backKeyboard() });
    return true;
  }

  if (f.flow === "arithmetic") {
    flows.delete(uid);
    const r = calculateDate(value, s.timezone);
    if (!r) {
      await telegramApi("sendMessage", { chat_id: ctx.chatId, text: TITLE + "\n\n" + heading("محاسبه تاریخ") + "\n\n" + line("وضعیت", "✗ قالب نامعتبر") + "\n" + line("مثال", "۱۴۰۵/۰۷/۰۹ + ۳۰ روز") + "\n\n" + SEP, reply_markup: backKeyboard() });
      return true;
    }
    await telegramApi("sendMessage", { chat_id: ctx.chatId, text: TITLE + "\n\n" + heading("نتیجه محاسبه") + "\n\n" +
      line("شمسی", formatPersian(r.date, "fa", s.timezone)) + "\n" +
      line("میلادی", formatGregorian(r.date, "fa", s.timezone)) + "\n" +
      line("قمری", islamicFull(r.date, "fa")) + "\n\n" + SEP, reply_markup: backKeyboard() });
    return true;
  }

  if (f.flow === "countdown") {
    flows.delete(uid);
    const r = parseDateTime(value, s.timezone);
    if (!r) {
      await telegramApi("sendMessage", { chat_id: ctx.chatId, text: TITLE + "\n\n" + heading("شمارش معکوس") + "\n\n" + line("وضعیت", "✗ تاریخ/ساعت نامعتبر") + "\n" + line("فرمت", "۱۴۰۵/۰۸/۰۱ ۲۰:۳۰") + "\n\n" + SEP, reply_markup: backKeyboard() });
      return true;
    }
    const diff = r.date.getTime() - Date.now();
    await telegramApi("sendMessage", { chat_id: ctx.chatId, text: TITLE + "\n\n" + heading("شمارش معکوس") + "\n\n" +
      line("مقصد", formatPersian(r.date, "fa", s.timezone)) + "\n" +
      line("باقی‌مانده", diff >= 0 ? formatDuration(diff, "fa") : "تاریخ سپری شده است") + "\n" +
      line("ثانیه باقی‌مانده", diff >= 0 ? faNum(Math.floor(diff / 1000)) : "۰") + "\n\n" + SEP, reply_markup: backKeyboard() });
    return true;
  }

  if (f.flow === "age" || f.flow === "birthday") {
    flows.delete(uid);
    const p = parseDateOnly(value);
    if (!p) {
      await telegramApi("sendMessage", { chat_id: ctx.chatId, text: TITLE + "\n\n" + heading("تاریخ تولد") + "\n\n" + line("وضعیت", "✗ تاریخ تولد نامعتبر") + "\n" + line("فرمت", "۱۳۹۰/۰۵/۱۲ یا 2011/08/03") + "\n\n" + SEP, reply_markup: backKeyboard() });
      return true;
    }
    const nowP = parseParts(new Date(), s.timezone), current = gregorianToJalali(nowP.year, nowP.month, nowP.day)!;
    if (f.flow === "age") {
      const a = ageValue(p.j, current);
      await telegramApi("sendMessage", { chat_id: ctx.chatId, text: TITLE + "\n\n" + heading("محاسبه سن") + "\n\n" +
        line("تاریخ تولد", faNum(p.j.year) + "/" + faNum(String(p.j.month).padStart(2, "0")) + "/" + faNum(String(p.j.day).padStart(2, "0"))) + "\n" +
        line("سن", faNum(a.years) + " سال و " + faNum(a.months) + " ماه و " + faNum(a.days) + " روز") + "\n\n" + SEP, reply_markup: backKeyboard() });
      return true;
    }
    const next = nextBirthday(p.j, current, s.timezone);
    await telegramApi("sendMessage", { chat_id: ctx.chatId, text: TITLE + "\n\n" + heading("تولد بعدی") + "\n\n" +
      line("تاریخ", next ? formatPersian(next, "fa", s.timezone) : "—") + "\n" +
      line("باقی‌مانده", next ? formatDuration(next.getTime() - Date.now(), "fa") : "—") + "\n\n" + SEP, reply_markup: backKeyboard() });
    return true;
  }

  if (f.flow === "timezone") {
    flows.delete(uid);
    const tz = value.trim();
    if (!isValidTimeZone(tz)) {
      await telegramApi("sendMessage", { chat_id: ctx.chatId, text: TITLE + "\n\n" + heading("منطقه زمانی") + "\n\n" + line("وضعیت", "✗ منطقه زمانی معتبر نیست") + "\n" + line("مثال", "Asia/Tehran") + "\n\n" + SEP, reply_markup: backKeyboard() });
      return true;
    }
    await setSetting(pool, uid, "timezone", tz);
    await telegramApi("sendMessage", { chat_id: ctx.chatId, text: TITLE + "\n\n" + heading("منطقه زمانی") + "\n\n" + line("وضعیت", "✓ ذخیره شد") + "\n" + line("منطقه جدید", tz) + "\n\n" + SEP, reply_markup: backKeyboard() });
    return true;
  }

  if (f.flow === "event_title") {
    f.data.title = value.slice(0, 100);
    f.flow = "event_datetime";
    f.expires = Date.now() + FLOW_TTL;
    flows.set(uid, f);
    await telegramApi("sendMessage", { chat_id: ctx.chatId, text: TITLE + "\n\n" + heading("ثبت رویداد") + "\n\n" + line("عنوان", f.data.title) + "\n" + line("مرحله بعد", "تاریخ و ساعت را وارد کنید.") + "\n" + line("فرمت", "۱۴۰۵/۰۷/۱۵ ۲۰:۳۰") + "\n\n" + SEP, reply_markup: backKeyboard() });
    return true;
  }

  if (f.flow === "event_datetime") {
    const p = parseDateTime(value, s.timezone);
    if (!p || p.date.getTime() <= Date.now()) {
      await telegramApi("sendMessage", { chat_id: ctx.chatId, text: TITLE + "\n\n" + heading("ثبت رویداد") + "\n\n" + line("وضعیت", "✗ تاریخ نامعتبر یا گذشته است") + "\n" + line("فرمت", "۱۴۰۵/۰۷/۱۵ ۲۰:۳۰") + "\n\n" + SEP });
      return true;
    }
    f.data.eventAt = p.date.toISOString();
    f.flow = "event_remind";
    f.expires = Date.now() + FLOW_TTL;
    flows.set(uid, f);
    await telegramApi("sendMessage", { chat_id: ctx.chatId, text: TITLE + "\n\n" + heading("یادآوری رویداد") + "\n\n" + line("عنوان", f.data.title) + "\n" + line("زمان", formatPersian(p.date, "fa", s.timezone)) + "\n" + line("مرحله بعد", "چند دقیقه قبل یادآوری شود؟") + "\n" + line("مثال", "۳۰ یا ۶۰ یا ۱۴۴۰") + "\n" + line("صفر", "بدون یادآوری") + "\n\n" + SEP });
    return true;
  }

  if (f.flow === "event_remind") {
    const raw = normalizeDigits(value).trim();
    if (!/^\d+$/.test(raw)) {
      await telegramApi("sendMessage", { chat_id: ctx.chatId, text: TITLE + "\n\n" + heading("یادآوری رویداد") + "\n\n" + line("وضعیت", "✗ تعداد دقیقه نامعتبر") + "\n\n" + SEP });
      return true;
    }
    const mins = Math.min(10080, Math.max(0, Number(raw)));
    const scope = f.data.scope === "group" ? "group" : "personal";
    const chatId = scope === "group" ? ctx.chatId : ctx.userId;
    await pool.query(
      "INSERT INTO bot_date_events(scope,chat_id,creator_id,title,event_at,timezone,remind_minutes) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [scope, String(chatId), ctx.userId, f.data.title, f.data.eventAt, s.timezone, mins]
    );
    flows.delete(uid);
    await telegramApi("sendMessage", { chat_id: ctx.chatId, text: TITLE + "\n\n" + heading("رویداد ثبت شد") + "\n\n" +
      line("عنوان", f.data.title) + "\n" +
      line("نوع", scope === "group" ? "گروهی" : "شخصی") + "\n" +
      line("زمان", formatPersian(new Date(f.data.eventAt), "fa", s.timezone)) + "\n" +
      line("یادآوری", mins ? faNum(mins) + " دقیقه قبل" : "خاموش") + "\n\n" + SEP, reply_markup: glassKeyboard([[["› رویدادها", "date:events"], ["‹ بازگشت", "date:home"]]]) });
    return true;
  }

  return false;
}

export async function handleDateCallback(pool: Pool, cb: any) {
  await ensureDateSchema(pool);
  const ctx: DateCtx = {
    chatId: Number(cb.message.chat.id),
    userId: Number(cb.from.id),
    chatType: String(cb.message.chat.type || "private"),
    userRank: "member",
    lang: "fa",
    userName: cb.from?.first_name,
    chatTitle: cb.message.chat?.title,
  };
  const data = String(cb.data || "");
  if (data === "date:noop") return true;
  if (data === "date:home") return home(ctx, pool, cb.message.message_id);
  if (data === "date:today") return today(ctx, pool, cb.message.message_id);
  if (data === "date:relative") {
    const s = await getSettings(pool, ctx.userId);
    return editDate(ctx, cb.message.message_id, TITLE + "\n\n" + heading("فردا و دیروز") + "\n\n" +
      line("فردا", "›") + "\n" + line("دیروز", "‹") + "\n\n" + SEP,
      glassKeyboard([[["› فردا", "date:relative:tomorrow"], ["› دیروز", "date:relative:yesterday"]], [["› پس‌فردا", "date:relative:dayafter"], ["› پریروز", "date:relative:daybefore"]], [["‹ بازگشت", "date:home"]]]));
  }
  if (data === "date:relative:tomorrow" || data === "date:relative:yesterday" || data === "date:relative:dayafter" || data === "date:relative:daybefore") {
    const delta = data.endsWith("tomorrow") ? 1 : data.endsWith("yesterday") ? -1 : data.endsWith("dayafter") ? 2 : -2;
    return relative(ctx, pool, cb.message.message_id, delta);
  }
  if (data === "date:calendar") {
    const s = await getSettings(pool, ctx.userId), p = parseParts(new Date(), s.timezone), j = gregorianToJalali(p.year, p.month, p.day)!;
    const c = renderCalendar(ctx, j.year, j.month);
    return editDate(ctx, cb.message.message_id, c.text, c.markup);
  }
  if (data.startsWith("date:cal:")) {
    const a = data.split(":");
    const c = renderCalendar(ctx, Number(a[2]), Number(a[3]));
    return editDate(ctx, cb.message.message_id, c.text, c.markup);
  }
  if (data.startsWith("date:day:")) {
    const a = data.split(":");
    return dayDetail(ctx, pool, cb.message.message_id, Number(a[2]), Number(a[3]), Number(a[4]));
  }
  if (data === "date:world") return worldClock(ctx, pool, cb.message.message_id);
  if (data === "date:convert") return promptText(ctx, "تبدیل تاریخ", "تاریخ را وارد کنید", "۱۴۰۵/۰۷/۰۹ یا 2026/10/01", "convert", {}, cb.message.message_id);
  if (data === "date:diff") return promptText(ctx, "اختلاف تاریخ", "دو تاریخ را با «تا» جدا کنید", "۱۴۰۵/۰۷/۰۱ تا ۱۴۰۵/۰۷/۳۰", "diff", {}, cb.message.message_id);
  if (data === "date:arithmetic") return promptText(ctx, "محاسبه تاریخ", "روز، هفته یا ماه را به یک تاریخ اضافه/کم کنید", "۱۴۰۵/۰۷/۰۹ + ۳۰ روز", "arithmetic", {}, cb.message.message_id);
  if (data === "date:countdown") return promptText(ctx, "شمارش معکوس", "تاریخ و ساعت مقصد را وارد کنید", "۱۴۰۵/۰۸/۰۱ ۲۰:۳۰", "countdown", {}, cb.message.message_id);
  if (data === "date:age") return promptText(ctx, "محاسبه سن", "تاریخ تولد را وارد کنید", "۱۳۹۰/۰۵/۱۲ یا 2011/08/03", "age", {}, cb.message.message_id);
  if (data === "date:birthday") return promptText(ctx, "تولد بعدی", "تاریخ تولد را وارد کنید", "۱۳۹۰/۰۵/۱۲", "birthday", {}, cb.message.message_id);
  if (data === "date:occasions") return occasions(ctx, pool, cb.message.message_id);
  if (data === "date:events") return events(ctx, pool, cb.message.message_id);
  if (data.startsWith("date:event:list:")) return eventList(ctx, pool, cb.message.message_id, data.endsWith("group") ? "group" : "personal");
  if (data === "date:event:add:group" || data === "date:event:add:personal") {
    if (data.endsWith("group") && !(await isChatAdmin(ctx))) {
      await telegramApi("answerCallbackQuery", { callback_query_id: cb.id, text: "دسترسی مدیریتی لازم است.", show_alert: true }).catch(() => {});
      return true;
    }
    flows.set(ctx.userId, { flow: "event_title", data: { scope: data.endsWith("group") ? "group" : "personal" }, expires: Date.now() + FLOW_TTL });
    return promptText(ctx, "ثبت رویداد", "عنوان رویداد را ارسال کنید", "حداکثر ۱۰۰ کاراکتر", "event_title", { scope: data.endsWith("group") ? "group" : "personal" }, cb.message.message_id);
  }
  if (data.startsWith("date:event:delete:")) {
    const id = Number(data.split(":")[3]);
    const row = (await pool.query("SELECT * FROM bot_date_events WHERE id=$1 LIMIT 1", [id])).rows[0];
    if (!row) return events(ctx, pool, cb.message.message_id);
    if (String(row.scope) === "personal" && String(row.creator_id) !== String(ctx.userId)) {
      await telegramApi("answerCallbackQuery", { callback_query_id: cb.id, text: "این رویداد متعلق به شما نیست.", show_alert: true }).catch(() => {});
      return true;
    }
    if (String(row.scope) === "group" && !(await isChatAdmin(ctx))) {
      await telegramApi("answerCallbackQuery", { callback_query_id: cb.id, text: "دسترسی مدیریتی لازم است.", show_alert: true }).catch(() => {});
      return true;
    }
    await pool.query("UPDATE bot_date_events SET enabled=FALSE WHERE id=$1", [id]);
    return events(ctx, pool, cb.message.message_id);
  }
  if (data === "date:settings") return settings(ctx, pool, cb.message.message_id);
  if (data === "date:settings:timezone") return timezonePicker(ctx, pool, cb.message.message_id);
  if (data === "date:settings:tzinput") return promptText(ctx, "منطقه زمانی", "منطقه زمانی IANA را ارسال کنید", "Asia/Tehran یا Asia/Baku", "timezone", {}, cb.message.message_id);
  if (data.startsWith("date:tz:")) {
    const tz = decodeURIComponent(data.slice("date:tz:".length));
    if (isValidTimeZone(tz)) {
      await setSetting(pool, ctx.userId, "timezone", tz);
      return settings(ctx, pool, cb.message.message_id);
    }
    return true;
  }
  if (data.startsWith("date:settings:toggle:")) {
    const key = data.slice("date:settings:toggle:".length);
    const s = await getSettings(pool, ctx.userId);
    if (key === "hour_cycle") await setSetting(pool, ctx.userId, "hour_cycle", s.hour_cycle === "24" ? "12" : "24");
    else if (["show_lunar", "show_week", "show_day_of_year"].includes(key)) await setSetting(pool, ctx.userId, key, !Boolean((s as any)[key]));
    return settings(ctx, pool, cb.message.message_id);
  }
  if (data === "date:events:upcoming") {
    const rows = (await pool.query(
      "SELECT id,title,event_at,timezone,scope FROM bot_date_events WHERE enabled=TRUE AND ((scope='group' AND chat_id=$1) OR (scope='personal' AND creator_id=$2)) AND event_at>=NOW() ORDER BY event_at LIMIT 10",
      [ctx.chatType === "private" ? ctx.userId : ctx.chatId, ctx.userId]
    )).rows;
    const body = rows.length
      ? rows.map((x: any, i: number) => line((ctx.lang === "fa" ? "رویداد " : "Event ") + (i + 1), x.title + " · " + new Date(x.event_at).toLocaleString(ctx.lang === "fa" ? "fa-IR" : "en-US", { timeZone: x.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }))).join("\n")
      : line("وضعیت", "رویداد آینده‌ای ثبت نشده است.");
    return editDate(ctx, cb.message.message_id, TITLE + "\n\n" + heading("رویدادهای آینده") + "\n\n" + body + "\n\n" + SEP, glassKeyboard([[["‹ بازگشت", "date:events"]]]));
  }
  return false;
}

export async function runDateReminders(pool: Pool) {
  await ensureDateSchema(pool);
  const rows = (await pool.query(
    "SELECT * FROM bot_date_events WHERE enabled=TRUE AND reminder_sent=FALSE AND remind_minutes>0 AND event_at>NOW() AND event_at<=NOW()+make_interval(mins=>remind_minutes) ORDER BY event_at LIMIT 50"
  )).rows;
  for (const row of rows) {
    const target = String(row.scope) === "personal" ? String(row.creator_id) : String(row.chat_id);
    const sent = await telegramApi("sendMessage", {
      chat_id: Number(target),
      text: TITLE + "\n\n" + heading("یادآوری رویداد") + "\n\n" +
        line("رویداد", row.title) + "\n" +
        line("زمان", formatPersian(new Date(row.event_at), "fa", String(row.timezone || DEFAULT_TZ))) + "\n" +
        line("یادآوری", faNum(row.remind_minutes) + " دقیقه قبل") + "\n\n" + SEP,
    });
    if (sent.ok) await pool.query("UPDATE bot_date_events SET reminder_sent=TRUE WHERE id=$1", [row.id]);
  }
}
