import type { Pool } from "pg";

export type WorldUser = {
  id: number;
  first_name?: string;
  username?: string;
};

export type WorldContext = {
  pool: Pool;
  chatId: number;
  userId: number;
  user: WorldUser;
};

export const WORLD_SEPARATOR = "                     ─────━━───── ◈ ─────━━─────";

const WORLD_COMMANDS = [
  "جهان",
  "دنیای من",
  "جهان من",
  "world",
  "my world",
  "persian world",
];

const SECTION_NAMES: Record<string, string> = {
  profile: "پروفایل",
  life: "زندگی من",
  city: "شهر",
  job: "کار و حرفه",
  market: "بازار",
  assets: "دارایی",
  adventure: "ماجراجویی",
  games: "سرگرمی",
  missions: "مأموریت‌ها",
  collection: "مجموعه",
  events: "رویدادها",
  ranking: "رتبه‌بندی",
  help: "راهنما",
  settings: "تنظیمات",
};

function norm(value: string) {
  return String(value ?? "")
    .trim()
    .replace(/^[\\/!.]+/, "")
    .replace(/[\\u200c\\u200d]/g, " ")
    .replace(/\\s+/g, " ")
    .toLowerCase();
}

const fa = (x: number) => String(x);

function displayName(user: WorldUser) {
  return user.first_name || user.username || String(user.id);
}

export function isWorldCommand(text: string) {
  return WORLD_COMMANDS.includes(norm(text));
}

export async function ensureWorldSchema(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_world_accounts(
      account_id BIGSERIAL PRIMARY KEY,
      group_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      username TEXT,
      first_name TEXT,
      display_name TEXT NOT NULL,
      gender TEXT NOT NULL CHECK(gender IN ('male','female','unspecified')),
      level INT NOT NULL DEFAULT 1 CHECK(level>=1),
      xp BIGINT NOT NULL DEFAULT 0 CHECK(xp>=0),
      coins BIGINT NOT NULL DEFAULT 1000 CHECK(coins>=0),
      reputation INT NOT NULL DEFAULT 100 CHECK(reputation>=0),
      job_code TEXT,
      home_code TEXT NOT NULL DEFAULT 'starter_home',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','closed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(group_id,user_id)
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS idx_game_world_accounts_group_level ON game_world_accounts(group_id,level DESC,coins DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_game_world_accounts_group_activity ON game_world_accounts(group_id,last_active_at DESC)");
}

async function getAccount(pool: Pool, groupId: number, userId: number) {
  const result = await pool.query<any>(
    "SELECT * FROM game_world_accounts WHERE group_id=$1 AND user_id=$2 LIMIT 1",
    [groupId, userId],
  );
  return result.rows[0] ?? null;
}

function registrationKeyboard(userId: number) {
  const s = String(userId);
  return {
    inline_keyboard: [
      [{ text: "‹ ساخت اکانت", callback_data: "world:register:" + s }],
      [{ text: "‹ راهنما", callback_data: "world:help:" + s }],
    ],
  };
}

function genderKeyboard(userId: number) {
  const s = String(userId);
  return {
    inline_keyboard: [
      [
        { text: "‹ مرد", callback_data: "world:gender:" + s + ":male" },
        { text: "‹ زن", callback_data: "world:gender:" + s + ":female" },
      ],
      [{ text: "‹ بدون تعیین", callback_data: "world:gender:" + s + ":unspecified" }],
      [{ text: "‹ انصراف", callback_data: "world:cancel:" + s }],
    ],
  };
}

function mainKeyboard(userId: number) {
  const s = String(userId);
  return {
    inline_keyboard: [
      [
        { text: "‹ پروفایل", callback_data: "world:section:profile:" + s },
        { text: "‹ زندگی من", callback_data: "world:section:life:" + s },
      ],
      [
        { text: "‹ شهر", callback_data: "world:section:city:" + s },
        { text: "‹ کار و حرفه", callback_data: "world:section:job:" + s },
      ],
      [
        { text: "‹ بازار", callback_data: "world:section:market:" + s },
        { text: "‹ دارایی", callback_data: "world:section:assets:" + s },
      ],
      [
        { text: "‹ ماجراجویی", callback_data: "world:section:adventure:" + s },
        { text: "‹ سرگرمی", callback_data: "world:section:games:" + s },
      ],
      [
        { text: "‹ مأموریت‌ها", callback_data: "world:section:missions:" + s },
        { text: "‹ مجموعه", callback_data: "world:section:collection:" + s },
      ],
      [
        { text: "‹ رویدادها", callback_data: "world:section:events:" + s },
        { text: "‹ رتبه‌بندی", callback_data: "world:section:ranking:" + s },
      ],
      [
        { text: "‹ راهنما", callback_data: "world:section:help:" + s },
        { text: "‹ تنظیمات", callback_data: "world:section:settings:" + s },
      ],
    ],
  };
}

function registrationText(user: WorldUser) {
  return [
    "◈ Pᴇʀsɪᴀɴ Wᴏʀʟᴅ",
    "",
    WORLD_SEPARATOR,
    "",
    "دنیای پرشین یک بازی متنی اجتماعی هست.",
    "اینجا هر بازیکن یک اکانت مستقل در همین گروه داره",
    "",
    "برای ورود ابتدا باید اکانت بازی خودت را بسازی.",
    "",
    "★ - بازیکن : " + displayName(user),
    "⛂ - شناسه : " + fa(user.id),
    "⛂ - وضعیت اکانت : ثبت‌نشده",
    "",
    WORLD_SEPARATOR,
    "",
  ].join("\\n");
}

async function levelRequired(level: number) {
  return level * level * 100;
}

function progressBar(xp: number, level: number) {
  const previous = levelRequired(Math.max(0, level - 1));
  const next = levelRequired(level);
  const span = Math.max(1, next - previous);
  const percent = Math.max(0, Math.min(100, Math.floor(((xp - previous) / span) * 100)));
  const filled = Math.floor(percent / 10);
  return { percent, bar: "▰".repeat(filled) + "▱".repeat(10 - filled), remaining: Math.max(0, next - xp) };
}

async function centerText(pool: Pool, ctx: WorldContext, account?: any) {
  const a = account ?? await getAccount(pool, ctx.chatId, ctx.userId);
  if (!a) return null;
  const gender =
    a.gender === "male" ? "مرد" :
    a.gender === "female" ? "زن" :
    "بدون تعیین";
  return [
    "◈ Pᴇʀsɪᴀɴ Wᴏʀʟᴅ",
    "",
    "★ - " + a.display_name,
    "⛂ - اکانت : #" + fa(Number(a.account_id)),
    "⛂ - سطح : " + fa(Number(a.level)),
    "⛂ - تجربه : " + fa(Number(a.xp)) + " XP",
    "⛂ - سکه : " + fa(Number(a.coins)),
    "⛂ - اعتبار : " + fa(Number(a.reputation)),
    "⛂ - جنسیت : " + gender,
    "",
    WORLD_SEPARATOR,
    "",
    "⛂ - خانه : " + (a.home_code === "starter_home" ? "خانه آغازین" : a.home_code),
    "⛂ - شغل : " + (a.job_code ? a.job_code : "هنوز انتخاب نشده"),
    "⛂ - وضعیت : " + (a.status === "active" ? "فعال" : a.status),
    "",
    WORLD_SEPARATOR,
    "",
    "★ - رول‌پلی و ماجراجویی داستان‌محور",
    "★ - زندگی شهری و حرفه بازیکنان",
    "",
    "هر چیزی که بعداً به دست می‌آوری، از همین اکانت و همین گروه شروع می‌شود.",
  ].join("\n");
}

async function profileText(pool: Pool, ctx: WorldContext) {
  const a = await getAccount(pool, ctx.chatId, ctx.userId);
  if (!a) return null;
  const p = progressBar(Number(a.xp), Number(a.level));
  const gender =
    a.gender === "male" ? "مرد" :
    a.gender === "female" ? "زن" :
    "بدون تعیین";
  return [
    "◈ پروفایل",
    "",
    WORLD_SEPARATOR,
    "",
    "★ - " + a.display_name,
    "⛂ - شناسه : " + fa(Number(a.user_id)),
    "⛂ - اکانت : #" + fa(Number(a.account_id)),
    "⛂ - جنسیت : " + gender,
    "",
    WORLD_SEPARATOR,
    "",
    "⛂ - سطح : " + fa(Number(a.level)),
    "⛂ - تجربه : " + fa(Number(a.xp)) + " XP",
    "[" + p.bar + "] " + fa(p.percent) + "%",
    "⛂ - تا سطح بعد : " + fa(p.remaining) + " XP",
    "",
    "⛂ - سکه : " + fa(Number(a.coins)),
    "⛂ - اعتبار : " + fa(Number(a.reputation)),
    "",
    WORLD_SEPARATOR,
    "",
    "⛂ - خانه : " + (a.home_code === "starter_home" ? "خانه آغازین" : a.home_code),
    "⛂ - شغل : " + (a.job_code ? a.job_code : "انتخاب نشده"),
  ].join("\n");
}

async function lifeText(pool: Pool, ctx: WorldContext) {
  const a = await getAccount(pool, ctx.chatId, ctx.userId);
  if (!a) return null;
  return [
    "◈ زندگی من",
    "",
    WORLD_SEPARATOR,
    "",
    "★ - " + a.display_name,
    "⛂ - خانه : خانه آغازین",
    "⛂ - سطح خانه : 1",
    "⛂ - ظرفیت انبار : 10",
    "⛂ - ویترین : آماده نشده",
    "",
    "⛂ - شغل : " + (a.job_code ? a.job_code : "هنوز انتخاب نشده"),
    "⛂ - درآمد : هنوز شروع نشده",
    "",
    WORLD_SEPARATOR,
    "",
    "زندگی از همین‌جا شروع می‌شود.",
    "خانه و شغل بعداً قابل توسعه هستند و انتخاب‌هایت مسیر اکانتت را شکل می‌دهند.",
  ].join("\n");
}


