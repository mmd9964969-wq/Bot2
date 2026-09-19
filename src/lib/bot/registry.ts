export type Rank = "owner" | "sudo" | "admin" | "member";
export type Lang = "fa" | "en";
export type Phase = 1 | 2;

export type CommandDef = {
  id: string;
  phase: Phase;
  minRank: Rank;
  aliasesEn: string[];
  aliasesFa: string[];
  usageEn: string;
  usageFa: string;
  descEn: string;
  descFa: string;
};

export const COMMANDS: CommandDef[] = [
  { id: "robot", phase: 1, minRank: "member", aliasesEn: ["robot"], aliasesFa: ["ربات"], usageEn: "robot", usageFa: "ربات", descEn: "Bot presence response", descFa: "پاسخ حضور و آمادگی ربات" },
  { id: "id", phase: 1, minRank: "member", aliasesEn: ["id"], aliasesFa: ["آیدی"], usageEn: "id", usageFa: "آیدی", descEn: "User identity and activity information", descFa: "اطلاعات هویتی و آماری کاربر" },
  { id: "admin", phase: 1, minRank: "member", aliasesEn: ["admin"], aliasesFa: ["ادمین"], usageEn: "admin", usageFa: "ادمین", descEn: "Check administrator access", descFa: "بررسی دسترسی مدیریتی" },
  { id: "info", phase: 1, minRank: "member", aliasesEn: ["info"], aliasesFa: ["اطلاعات"], usageEn: "info", usageFa: "اطلاعات", descEn: "Group information", descFa: "اطلاعات کامل گروه" },
  { id: "rank", phase: 1, minRank: "admin", aliasesEn: ["rank", "role"], aliasesFa: ["مقام", "اطلاعاتمقام"], usageEn: "rank", usageFa: "مقام", descEn: "Detailed role and permissions", descFa: "اطلاعات دقیق مقام و دسترسی" },
  { id: "me", phase: 1, minRank: "member", aliasesEn: ["me"], aliasesFa: ["من"], usageEn: "me", usageFa: "من", descEn: "Personal group profile", descFa: "پروفایل شخصی در گروه" },
  { id: "ping", phase: 2, minRank: "member", aliasesEn: ["ping"], aliasesFa: ["پینگ"], usageEn: "ping", usageFa: "پینگ", descEn: "Live system status and latency", descFa: "وضعیت زنده سیستم و سرعت پاسخ" },
  { id: "bot", phase: 2, minRank: "admin", aliasesEn: ["bot"], aliasesFa: ["بات"], usageEn: "bot", usageFa: "بات", descEn: "Technical bot status", descFa: "اطلاعات فنی و وضعیت ربات" },
  { id: "status", phase: 2, minRank: "member", aliasesEn: ["status"], aliasesFa: ["وضعیت"], usageEn: "status", usageFa: "وضعیت", descEn: "Live group status", descFa: "وضعیت زنده گروه" },
];

export const PHASES: { id: Phase; fa: string; en: string; blurbFa: string; blurbEn: string }[] = [
  { id: 1, fa: "هسته و اطلاعات", en: "Core & information", blurbFa: "ربات، آیدی، ادمین، اطلاعات گروه، مقام و پروفایل شخصی", blurbEn: "Robot, identity, admin access, group info, ranks and profile" },
  { id: 2, fa: "وضعیت و سیستم", en: "Status & system", blurbFa: "پینگ، وضعیت گروه و اطلاعات فنی ربات", blurbEn: "Ping, group status and technical bot status" },
];

export const RANK_ORDER: Rank[] = ["member", "admin", "sudo", "owner"];

export function rankAtLeast(have: Rank, need: Rank): boolean {
  return RANK_ORDER.indexOf(have) >= RANK_ORDER.indexOf(need);
}

export function normalizeToken(value: string): string {
  return value.trim().replace(/^[/!.]+/, "").replace(/\s+/g, "").toLowerCase();
}

export function parseDuration(value: string): number | null {
  const m = value.trim().toLowerCase().match(/^(\d+)(s|m|h|d)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] || "s";
  const mult = unit === "m" ? 60 : unit === "h" ? 3600 : unit === "d" ? 86400 : 1;
  const seconds = n * mult;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export function resolveCommand(token: string): CommandDef | null {
  const key = normalizeToken(token);
  return COMMANDS.find((command) =>
    [...command.aliasesEn, ...command.aliasesFa].some((alias) => normalizeToken(alias) === key),
  ) ?? null;
}
