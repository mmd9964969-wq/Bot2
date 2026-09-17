import {
  COMMANDS,
  RANK_ORDER,
  rankAtLeast,
  type CommandDef,
  type Lang,
  type Rank,
} from "./registry.ts";
import type { BotConfig } from "./defaults.ts";

export type AliasOverrides = Record<string, { en?: string[]; fa?: string[] }>;

export type ParsedCommand = {
  raw: string;
  prefix: string;
  token: string;
  command: CommandDef;
  args: string[];
  argText: string;
  target: string | null;
  durationSec: number | null;
  durationRaw: string | null;
  reason: string;
};

export type BotContext = {
  text: string;
  chatType: "private" | "group" | "supergroup";
  chatId: number;
  chatTitle: string;
  membersCount: number;
  userId: number;
  userName: string;
  userRank: Rank;
  replyToUserId?: number;
  replyToName?: string;
  lang: Lang;
  config: BotConfig;
  now: number;
  staff: { id: number; name: string; rank: Rank }[];
};

export type BotReply = {
  text: string;
  silent: boolean;
  lang?: Lang;
};

const ARABIC_YE = /ي/g;
const ARABIC_KAF = /ك/g;
const TATWEEL = /\u0640/g;
const DIACRITICS = /[\u064B-\u065F\u0670]/g;
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function normalizeToken(input: string): string {
  let s = input.trim();
  s = s.replace(DIACRITICS, "").replace(TATWEEL, "");
  s = s.replace(ARABIC_YE, "ی").replace(ARABIC_KAF, "ک");
  s = s.replace(/ة/g, "ه");
  s = s.replace(/آ|أ|إ/g, "ا");
  s = s.replace(/‌/g, "");
  let out = "";
  for (const ch of s) {
    const pi = PERSIAN_DIGITS.indexOf(ch);
    if (pi >= 0) {
      out += String(pi);
      continue;
    }
    const ai = ARABIC_DIGITS.indexOf(ch);
    if (ai >= 0) {
      out += String(ai);
      continue;
    }
    out += ch;
  }
  return out.toLowerCase();
}

function digitRunToNumber(raw: string): number | null {
  const n = normalizeToken(raw);
  if (!/^\d+$/.test(n)) return null;
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

const UNIT_SEC: Record<string, number> = {
  s: 1,
  sec: 1,
  ثانیه: 1,
  ث: 1,
  m: 60,
  min: 60,
  دقیقه: 60,
  د: 60,
  h: 3600,
  hr: 3600,
  hour: 3600,
  ساعت: 3600,
  س: 3600,
  d: 86400,
  day: 86400,
  روز: 86400,
  w: 604800,
  week: 604800,
  هفته: 604800,
};

export function parseDuration(token: string): number | null {
  const t = normalizeToken(token).replace(/\s+/g, "");
  const m = t.match(/^(\d+)([a-zآ-ی]+)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] ?? "";
  const mul = UNIT_SEC[unit];
  if (!mul || !Number.isFinite(n) || n <= 0) return null;
  return n * mul;
}

function formatDuration(sec: number, lang: Lang): string {
  const units =
    lang === "fa"
      ? [
          [86400, "روز"],
          [3600, "ساعت"],
          [60, "دقیقه"],
          [1, "ثانیه"],
        ]
      : [
          [86400, "d"],
          [3600, "h"],
          [60, "m"],
          [1, "s"],
        ];
  const parts: string[] = [];
  let rest = sec;
  for (const [size, label] of units) {
    const n = Math.floor(rest / (size as number));
    if (n <= 0) continue;
    rest -= n * (size as number);
    parts.push(lang === "fa" ? `${n} ${label}` : `${n}${label}`);
    if (parts.length === 2) break;
  }
  return parts.join(lang === "fa" ? " و " : " ") || (lang === "fa" ? "۰" : "0");
}

function allAliases(cmd: CommandDef, overrides?: AliasOverrides): string[] {
  const ov = overrides?.[cmd.id];
  const en = ov?.en ?? cmd.aliasesEn;
  const fa = ov?.fa ?? cmd.aliasesFa;
  return [...en, ...fa];
}

export function resolveCommand(
  token: string,
  overrides?: AliasOverrides,
): CommandDef | null {
  const key = normalizeToken(token);
  if (!key) return null;
  for (const cmd of COMMANDS) {
    for (const alias of allAliases(cmd, overrides)) {
      if (normalizeToken(alias) === key) return cmd;
    }
  }
  return null;
}

function looksLikeTarget(token: string): boolean {
  if (token.startsWith("@")) return token.length > 1;
  return digitRunToNumber(token) !== null;
}

export function parseCommand(
  text: string,
  config: BotConfig,
  overrides?: AliasOverrides,
): ParsedCommand | null {
  const raw = text.trim();
  if (!raw) return null;
  let rest = raw;
  let prefix = "";
  const sorted = [...config.prefixes].sort((a, b) => b.length - a.length);
  for (const p of sorted) {
    if (rest.startsWith(p)) {
      prefix = p;
      rest = rest.slice(p.length);
      break;
    }
  }
  if (!prefix) return null;
  const parts = rest.split(/\s+/).filter(Boolean);
  const token = parts.shift();
  if (!token) return null;
  const command = resolveCommand(token, overrides);
  if (!command) return null;

  let target: string | null = null;
  let durationSec: number | null = null;
  let durationRaw: string | null = null;
  const unused: string[] = [];
  for (const p of parts) {
    if (!target && looksLikeTarget(p)) {
      target = p.startsWith("@") ? p : p;
      continue;
    }
    if (durationSec === null) {
      const d = parseDuration(p);
      if (d !== null) {
        durationSec = d;
        durationRaw = p;
        continue;
      }
    }
    unused.push(p);
  }
  const reason = unused.join(" ").trim();
  return {
    raw,
    prefix: prefix || config.prefixes[0] || "/",
    token,
    command,
    args: parts,
    argText: parts.join(" "),
    target,
    durationSec,
    durationRaw,
    reason,
  };
}

function faNum(n: number): string {
  return String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)] ?? d);
}

function t(lang: Lang, fa: string, en: string): string {
  return lang === "fa" ? fa : en;
}

function lines(parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join("\n");
}

function commandTitle(cmd: CommandDef, lang: Lang): string {
  const a = lang === "fa" ? cmd.aliasesFa[0] : cmd.aliasesEn[0];
  const b = lang === "fa" ? cmd.aliasesEn[0] : cmd.aliasesFa[0];
  return `/${a} · /${b}`;
}

function helpList(lang: Lang, prefix: string, phase = 1): string {
  const live = COMMANDS.filter((c) => c.phase === phase);
  const rows = live.map((c) => {
    const a = lang === "fa" ? c.aliasesFa[0] : c.aliasesEn[0];
    const b = lang === "fa" ? c.aliasesEn[0] : c.aliasesFa[0];
    const d = lang === "fa" ? c.descFa : c.descEn;
    return `${prefix}${a} · ${prefix}${b} — ${d}`;
  });
  return rows.join("\n");
}

export function handleCommand(
  ctx: BotContext,
  overrides?: AliasOverrides,
): BotReply {
  const parsed = parseCommand(ctx.text, ctx.config, overrides);
  if (!parsed) {
    const looksPrefixed = ctx.config.prefixes.some((p) =>
      ctx.text.trim().startsWith(p),
    );
    if (!looksPrefixed) return { text: "", silent: true };
    const silent = ctx.chatType !== "private" && ctx.config.ignoreUnknownInGroups;
    if (silent) return { text: "", silent: true };
    return {
      text: t(
        ctx.lang,
        "دستور شناخته نشد. /راهنما",
        "Unknown command. /help",
      ),
      silent: false,
    };
  }

  const { command } = parsed;
  if (!rankAtLeast(ctx.userRank, command.minRank)) {
    return {
      text: t(
        ctx.lang,
        `این دستور برای ${rankLabel(command.minRank, "fa")} است.`,
        `This command needs ${rankLabel(command.minRank, "en")}.`,
      ),
      silent: false,
    };
  }

  if (command.phase > 1) {
    return {
      text: t(
        ctx.lang,
        `${commandTitle(command, "fa")}\nفاز ${faNum(command.phase)} — هنوز پیاده نشده.`,
        `${commandTitle(command, "en")}\nPhase ${command.phase} — not built yet.`,
      ),
      silent: false,
    };
  }

  switch (command.id) {
    case "start":
      return { text: startText(ctx), silent: false };
    case "help":
      return { text: helpText(ctx, parsed), silent: false };
    case "ping":
      return { text: t(ctx.lang, "پونگ", "pong"), silent: false };
    case "id":
      return { text: idText(ctx), silent: false };
    case "info":
      return { text: infoText(ctx), silent: false };
    case "lang":
      return langText(ctx, parsed);
    case "staff":
      return { text: staffText(ctx), silent: false };
    case "settings":
      return { text: settingsText(ctx), silent: false };
    default:
      return { text: t(ctx.lang, "دستور ناقص.", "Unhandled."), silent: false };
  }
}

function rankLabel(rank: Rank, lang: Lang): string {
  const map: Record<Rank, { fa: string; en: string }> = {
    owner: { fa: "مالک", en: "owner" },
    sudo: { fa: "سودو", en: "sudo" },
    admin: { fa: "ادمین", en: "admin" },
    member: { fa: "عضو", en: "member" },
  };
  return map[rank][lang];
}

function startText(ctx: BotContext): string {
  const name = ctx.config.botName;
  if (ctx.chatType === "private") {
    return lines([
      t(ctx.lang, `${name} · مدیریت گروه`, `${name} · group management`),
      t(ctx.lang, "فاز ۱ هسته فعال است.", "Phase 1 core is live."),
      t(ctx.lang, "مرا ادمین گروه کن، بعد /راهنما", "Promote me in the group, then /help"),
    ]);
  }
  return lines([
    t(ctx.lang, `${name} اینجاست.`, `${name} is here.`),
    t(ctx.lang, "/راهنما فهرست دستورات", "/help for commands"),
  ]);
}

function helpText(ctx: BotContext, parsed: ParsedCommand): string {
  const q = parsed.args[0];
  const prefix = ctx.config.prefixes[0] || "/";
  if (q) {
    const cmd = resolveCommand(q, undefined);
    if (!cmd) {
      return t(ctx.lang, "این دستور نیست.", "No such command.");
    }
    return lines([
      commandTitle(cmd, ctx.lang),
      ctx.lang === "fa" ? cmd.descFa : cmd.descEn,
      ctx.lang === "fa" ? cmd.usageFa : cmd.usageEn,
      t(ctx.lang, `فاز ${faNum(cmd.phase)}`, `Phase ${cmd.phase}`),
    ]);
  }
  return lines([
    t(
      ctx.lang,
      `${ctx.config.botName} · فاز ۱ هسته`,
      `${ctx.config.botName} · phase 1 core`,
    ),
    helpList(ctx.lang, prefix, 1),
    t(
      ctx.lang,
      "دستورات فارسی و انگلیسی هر دو کار می‌کنند.",
      "Persian and English aliases both work.",
    ),
  ]);
}

function idText(ctx: BotContext): string {
  const rows = [
    t(ctx.lang, `شما: ${ctx.userId}`, `you: ${ctx.userId}`),
    t(ctx.lang, `چت: ${ctx.chatId}`, `chat: ${ctx.chatId}`),
  ];
  if (ctx.replyToUserId) {
    rows.push(
      t(
        ctx.lang,
        `ریپلای: ${ctx.replyToUserId}${ctx.replyToName ? " · " + ctx.replyToName : ""}`,
        `reply: ${ctx.replyToUserId}${ctx.replyToName ? " · " + ctx.replyToName : ""}`,
      ),
    );
  }
  return rows.join("\n");
}

function infoText(ctx: BotContext): string {
  return lines([
    ctx.chatTitle,
    t(ctx.lang, `آیدی: ${ctx.chatId}`, `id: ${ctx.chatId}`),
    t(ctx.lang, `نوع: ${ctx.chatType}`, `type: ${ctx.chatType}`),
    t(ctx.lang, `اعضا: ${ctx.membersCount}`, `members: ${ctx.membersCount}`),
    t(ctx.lang, `زبان: ${ctx.lang}`, `lang: ${ctx.lang}`),
  ]);
}

function langText(ctx: BotContext, parsed: ParsedCommand): BotReply {
  const arg = normalizeToken(parsed.args[0] ?? "");
  if (!arg) {
    return {
      text: t(ctx.lang, `زبان فعلی: ${ctx.lang}`, `current language: ${ctx.lang}`),
      silent: false,
    };
  }
  if (arg === "fa" || arg === "فارسی" || arg === "persian") {
    return {
      text: "زبان گروه: فارسی",
      silent: false,
      lang: "fa",
    };
  }
  if (arg === "en" || arg === "english" || arg === "انگلیسی") {
    return {
      text: "Group language: English",
      silent: false,
      lang: "en",
    };
  }
  return {
    text: t(ctx.lang, "مقدار: fa یا en", "Use: fa or en"),
    silent: false,
  };
}

function staffText(ctx: BotContext): string {
  const rows = ctx.staff.map((s) => {
    const r = rankLabel(s.rank, ctx.lang);
    return `${s.name} · ${r} · ${s.id}`;
  });
  return lines([
    t(ctx.lang, "مدیران", "Staff"),
    ...rows,
  ]);
}

function settingsText(ctx: BotContext): string {
  const c = ctx.config;
  return lines([
    t(ctx.lang, `${c.botName} · تنظیمات هسته`, `${c.botName} · core settings`),
    t(ctx.lang, `پیشوند: ${c.prefixes.join(" ")}`, `prefix: ${c.prefixes.join(" ")}`),
    t(ctx.lang, `زبان: ${c.defaultLang}`, `lang: ${c.defaultLang}`),
    t(ctx.lang, `مالک: ${c.ownerIds.join(", ") || "—"}`, `owners: ${c.ownerIds.join(", ") || "—"}`),
    t(ctx.lang, `پاسخ فشرده: ${c.compactReplies ? "روشن" : "خاموش"}`, `compact: ${c.compactReplies ? "on" : "off"}`),
    t(ctx.lang, `فاز فعال: ${faNum(1)}`, `active phase: 1`),
  ]);
}

export function formatDurationForUi(sec: number, lang: Lang): string {
  return formatDuration(sec, lang);
}

export function rankIndex(rank: Rank): number {
  return RANK_ORDER.indexOf(rank);
}
