import type { Pool } from "pg";

export type BotLang = "fa" | "en" | "ar" | "ru" | "tr" | "zh";
export type SupportedLanguage = {
  code: BotLang;
  label: string;
  native: string;
};

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: "fa", label: "فارسی", native: "فارسی" },
  { code: "en", label: "انگلیسی", native: "English" },
  { code: "ar", label: "عربی", native: "العربية" },
  { code: "ru", label: "روسی", native: "Русский" },
  { code: "tr", label: "ترکی", native: "Türkçe" },
  { code: "zh", label: "چینی", native: "中文" },
];

const LANGUAGE_CODES = new Set<BotLang>(SUPPORTED_LANGUAGES.map((x) => x.code));

export function normalizeBotLang(value: unknown): BotLang | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (LANGUAGE_CODES.has(raw as BotLang)) return raw as BotLang;

  const aliases: Record<string, BotLang> = {
    فارسی: "fa", persian: "fa", "زبان فارسی": "fa",
    انگلیسی: "en", english: "en", "زبان انگلیسی": "en",
    عربی: "ar", arabic: "ar", "زبان عربی": "ar",
    روسی: "ru", russian: "ru", "زبان روسی": "ru",
    ترکی: "tr", turkish: "tr", "زبان ترکی": "tr",
    چینی: "zh", chinese: "zh", "زبان چینی": "zh",
  };
  return aliases[raw] ?? null;
}

export function languageLabel(lang: BotLang): string {
  return SUPPORTED_LANGUAGES.find((x) => x.code === lang)?.label ?? lang;
}

export function languageNative(lang: BotLang): string {
  return SUPPORTED_LANGUAGES.find((x) => x.code === lang)?.native ?? lang;
}

export function languageButtonLabel(lang: BotLang, current: BotLang): string {
  const native = languageNative(lang);
  return lang === current ? "● " + native : native;
}

export function languageChangedText(lang: BotLang): string {
  const current = languageNative(lang);
  switch (lang) {
    case "fa":
      return "⛂ - زبان گروه : فارسی\n⛂ - وضعیت : فعال";
    case "en":
      return "⛂ - Group language : English\n⛂ - Status : Active";
    case "ar":
      return "⛂ - لغة المجموعة : العربية\n⛂ - الحالة : نشطة";
    case "ru":
      return "⛂ - Язык группы : Русский\n⛂ - Статус : Активен";
    case "tr":
      return "⛂ - Grup dili : Türkçe\n⛂ - Durum : Aktif";
    case "zh":
      return "⛂ - 群组语言 : 中文\n⛂ - 状态 : 已启用";
  }
}

export function languagePickerText(lang: BotLang, chatTitle: string): string {
  switch (lang) {
    case "fa":
      return "⛂ - گروه : " + chatTitle + "\n⛂ - زبان فعلی : " + languageLabel(lang) + "\n⛂ - دامنه تنظیم : فقط همین گروه";
    case "en":
      return "⛂ - Group : " + chatTitle + "\n⛂ - Current language : " + languageNative(lang) + "\n⛂ - Scope : This group only";
    case "ar":
      return "⛂ - المجموعة : " + chatTitle + "\n⛂ - اللغة الحالية : " + languageNative(lang) + "\n⛂ - النطاق : هذه المجموعة فقط";
    case "ru":
      return "⛂ - Группа : " + chatTitle + "\n⛂ - Текущий язык : " + languageNative(lang) + "\n⛂ - Область : только эта группа";
    case "tr":
      return "⛂ - Grup : " + chatTitle + "\n⛂ - Mevcut dil : " + languageNative(lang) + "\n⛂ - Kapsam : yalnızca bu grup";
    case "zh":
      return "⛂ - 群组 : " + chatTitle + "\n⛂ - 当前语言 : " + languageNative(lang) + "\n⛂ - 作用范围 : 仅此群组";
  }
}

export async function ensureGroupLanguageSchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_group_languages (
      group_id BIGINT PRIMARY KEY,
      language_code TEXT NOT NULL DEFAULT 'fa',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT bot_group_languages_language_check
        CHECK (language_code IN ('fa','en','ar','ru','tr','zh'))
    )
  `);
}

export async function getGroupLanguage(pool: Pool, groupId: number, fallback: BotLang = "fa"): Promise<BotLang> {
  await ensureGroupLanguageSchema(pool);
  const result = await pool.query<{ language_code: string }>(
    "SELECT language_code FROM bot_group_languages WHERE group_id=$1 LIMIT 1",
    [String(groupId)],
  );
  const stored = normalizeBotLang(result.rows[0]?.language_code);
  if (stored) return stored;

  await pool.query(
    "INSERT INTO bot_group_languages(group_id,language_code) VALUES($1,$2) ON CONFLICT(group_id) DO NOTHING",
    [String(groupId), fallback],
  );
  return fallback;
}

export async function setGroupLanguage(pool: Pool, groupId: number, language: BotLang): Promise<void> {
  await ensureGroupLanguageSchema(pool);
  await pool.query(
    "INSERT INTO bot_group_languages(group_id,language_code,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(group_id) DO UPDATE SET language_code=EXCLUDED.language_code,updated_at=NOW()",
    [String(groupId), language],
  );
}
