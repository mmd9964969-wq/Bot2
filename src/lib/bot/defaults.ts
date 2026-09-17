import type { Lang } from "./registry.ts";

/**
 * ─────────────────────────────────────────────
 *  فایل تنظیمات پایه — همین‌جا را دستی عوض کن
 *  Base config — change these before deploy
 * ─────────────────────────────────────────────
 *
 * توکن را اینجا نگذار. روی Railway:
 *   BOT_TOKEN=...
 *   OWNER_IDS=123456789,987654321
 */
export type BotConfig = {
  botName: string;
  botUsername: string;
  prefixes: string[];
  defaultLang: Lang;
  ownerIds: string[];
  sudoIds: string[];
  compactReplies: boolean;
  ignoreUnknownInGroups: boolean;
};

export const DEFAULT_CONFIG: BotConfig = {
  botName: "نظم",
  botUsername: "nizam_guard_bot",
  prefixes: ["/", "!", "."],
  defaultLang: "fa",
  ownerIds: ["1001"],
  sudoIds: [],
  compactReplies: true,
  ignoreUnknownInGroups: true,
};

export const ENV_KEYS = [
  { key: "BOT_TOKEN", need: true, fa: "توکن بات از BotFather", en: "Bot token" },
  { key: "OWNER_IDS", need: true, fa: "آیدی عددی مالک‌ها با ویرگول", en: "Owner user ids, comma-separated" },
  { key: "SUDO_IDS", need: false, fa: "آیدی سودو (اختیاری)", en: "Sudo user ids" },
  { key: "DEFAULT_LANG", need: false, fa: "fa یا en — پیش‌فرض fa", en: "fa or en" },
  { key: "PREFIXES", need: false, fa: "پیشوندها مثل /!,.", en: "Command prefixes" },
  { key: "BOT_NAME", need: false, fa: "نام نمایشی بات", en: "Display name" },
] as const;
