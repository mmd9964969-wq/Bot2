import type { Pool } from "pg";

export type SudoLevel = "low" | "medium" | "pro";

export type SudoRecord = {
  user_id: string;
  level: SudoLevel;
  security_enabled: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const cache = new Map<number, SudoRecord>();

const LEVEL_RANK: Record<SudoLevel, number> = {
  low: 1,
  medium: 2,
  pro: 3,
};

const LEVEL_LABEL: Record<SudoLevel, string> = {
  low: "سودو پایین",
  medium: "سودو متوسط",
  pro: "سودو حرفه‌ای",
};

const LOW_COMMANDS = new Set([
  "robot","id","admin","info","rank","ping","bot","status",
  "stats","date","lock","unlock","link","special","special_list",
]);

const MEDIUM_COMMANDS = new Set([
  ...LOW_COMMANDS,
  "warn","mute","unmute","ban","unban","lockall","unlockall",
]);

export async function ensureSudoSchema(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_sudo_access (
      user_id BIGINT PRIMARY KEY,
      level TEXT NOT NULL DEFAULT 'low'
        CHECK (level IN ('low','medium','pro')),
      security_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_by BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_bot_sudo_access_level ON bot_sudo_access(level)"
  );
}

export async function loadSudoCache(pool: Pool) {
  await ensureSudoSchema(pool);
  const rows = await pool.query<SudoRecord>(
    "SELECT user_id,level,security_enabled,created_by,created_at,updated_at FROM bot_sudo_access ORDER BY created_at ASC"
  );
  cache.clear();
  for (const row of rows.rows) {
    const id = Number(row.user_id);
    if (Number.isSafeInteger(id) && id > 0) cache.set(id, row);
  }
}

export function isManagedSudo(userId: number) {
  return cache.has(userId);
}

export function getCachedSudo(userId: number): SudoRecord | null {
  return cache.get(userId) ?? null;
}

export async function getSudo(pool: Pool, userId: number) {
  const cached = cache.get(userId);
  if (cached) return cached;
  await ensureSudoSchema(pool).catch(() => {});
  const row = (await pool.query<SudoRecord>(
    "SELECT user_id,level,security_enabled,created_by,created_at,updated_at FROM bot_sudo_access WHERE user_id=$1 LIMIT 1",
    [String(userId)]
  )).rows[0] ?? null;
  if (row) cache.set(userId, row);
  return row;
}

export async function upsertSudo(
  pool: Pool,
  userId: number,
  level: SudoLevel,
  createdBy: number,
  ownerIds: string[],
) {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return { ok: false as const, reason: "invalid_user" };
  }
  if (ownerIds.includes(String(userId)) || String(userId) === "8247710529") {
    return { ok: false as const, reason: "owner_protected" };
  }
  await ensureSudoSchema(pool);
  const row = (await pool.query<SudoRecord>(
    `INSERT INTO bot_sudo_access(user_id,level,security_enabled,created_by,created_at,updated_at)
     VALUES($1,$2,TRUE,$3,NOW(),NOW())
     ON CONFLICT(user_id) DO UPDATE SET
       level=EXCLUDED.level,
       security_enabled=TRUE,
       updated_at=NOW()
     RETURNING user_id,level,security_enabled,created_by,created_at,updated_at`,
    [String(userId), level, String(createdBy)]
  )).rows[0];
  cache.set(userId, row);
  return { ok: true as const, row };
}

export async function removeSudo(pool: Pool, userId: number) {
  await ensureSudoSchema(pool);
  const result = await pool.query("DELETE FROM bot_sudo_access WHERE user_id=$1", [String(userId)]);
  cache.delete(userId);
  return result.rowCount > 0;
}

export async function listSudos(pool: Pool) {
  await ensureSudoSchema(pool);
  const rows = await pool.query<SudoRecord>(
    "SELECT user_id,level,security_enabled,created_by,created_at,updated_at FROM bot_sudo_access ORDER BY CASE level WHEN 'pro' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, user_id ASC"
  );
  for (const row of rows.rows) {
    const id = Number(row.user_id);
    if (Number.isSafeInteger(id) && id > 0) cache.set(id, row);
  }
  return rows.rows;
}

export function sudoLevelLabel(level: SudoLevel) {
  return LEVEL_LABEL[level];
}

export function sudoLevelRank(level: SudoLevel) {
  return LEVEL_RANK[level];
}

export function sudoAllowsCommand(level: SudoLevel, commandId: string) {
  const id = String(commandId || "").trim();
  if (level === "pro") return true;
  if (level === "medium") return MEDIUM_COMMANDS.has(id);
  return LOW_COMMANDS.has(id);
}

export function sudoCapabilities(level: SudoLevel) {
  if (level === "pro") {
    return [
      "اطلاعات و وضعیت",
      "آمار و تاریخ",
      "قفل و بازکردن قفل",
      "مدیریت لینک و کاربران ویژه",
      "اخطار، سکوت و رفع سکوت",
      "بن و رفع بن",
      "قفل کامل و بازکردن کامل",
      "تمام دستورات عملیاتی مرحله دوم",
    ];
  }
  if (level === "medium") {
    return [
      "اطلاعات و وضعیت",
      "آمار و تاریخ",
      "قفل و بازکردن قفل",
      "مدیریت لینک و کاربران ویژه",
      "اخطار، سکوت و رفع سکوت",
      "بن و رفع بن",
      "قفل کامل و بازکردن کامل",
    ];
  }
  return [
    "اطلاعات و وضعیت",
    "آمار و تاریخ",
    "قفل و بازکردن قفل",
    "مدیریت لینک و کاربران ویژه",
  ];
}

export function sudoSecurityRules() {
  return [
    "مالک قابل اخطار، سکوت، بن یا رفع محدودیت توسط سودو نیست.",
    "سودو نمی‌تواند خودش را مالک کند.",
    "سودو نمی‌تواند سطح سودوی کاربر دیگری را از پنل مالک تغییر دهد.",
    "تمام افزودن، تغییر سطح و حذف سودو در ممیزی ثبت می‌شود.",
    "امنیت سودو هنگام ثبت همیشه فعال است.",
  ];
}
