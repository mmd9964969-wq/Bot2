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

export type WorldResult = {
  text: string;
  replyMarkup?: Record<string, unknown>;
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
    .replace(/[\u200c\u200d]/g, " ")
    .replace(/\s+/g, " ")
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

function backKeyboard(userId: number) {
  return {
    inline_keyboard: [
      [{ text: "‹ بازگشت به جهان", callback_data: "world:home:" + String(userId) }],
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
  ].join("\n");
}

function helpText() {
  return [
    "◈ راهنمای دنیای پرشین",
    "",
    WORLD_SEPARATOR,
    "",
    "برای شروع، اکانتت را بساز.",
    "بعد از ساخت اکانت، جهان شخصی خودت را همین‌جا مدیریت می‌کنی.",
    "",
    "★ - هر بازیکن اکانت مستقل خودش را دارد.",
    "★ - اکانت به همین گروه و همین بازیکن متصل است.",
    "★ - خانه، شغل، دارایی، بازار و ماجراجویی کم‌کم به جهان اضافه می‌شوند.",
    "",
    "دستور اصلی : جهان",
    "",
    WORLD_SEPARATOR,
    "",
  ].join("\n");
}

function registrationGenderText(user: WorldUser) {
  return [
    "◈ ساخت اکانت",
    "",
    WORLD_SEPARATOR,
    "",
    "قبل از ورود، جنسیت کاراکترت را انتخاب کن.",
    "",
    "★ - بازیکن : " + displayName(user),
    "⛂ - شناسه : " + fa(user.id),
    "",
    WORLD_SEPARATOR,
    "",
    "این انتخاب فعلاً برای ساخت هویت اولیه اکانت استفاده می‌شود.",
  ].join("\n");
}

function sectionText(section: string, account: any) {
  const title = SECTION_NAMES[section] ?? "جهان";
  const descriptions: Record<string, string> = {
    city: "اینجا شهر زندگی می‌کنی؛ محله‌ها، ساختمان‌ها و اتفاقات شهری بعداً از همین بخش شکل می‌گیرند.",
    job: "اینجا مسیر کار و حرفه‌ات ساخته می‌شود؛ هر بازیکن در ادامه حرفه خودش را انتخاب می‌کند.",
    market: "اینجا بازار جهان شکل می‌گیرد؛ خرید، فروش و معامله بین بازیکنان و NPCها.",
    assets: "اینجا همه دارایی‌ها، منابع، ابزارها و چیزهایی که به دست می‌آوری نگهداری می‌شوند.",
    adventure: "اینجا مسیر رول‌پلی و داستان‌های جهان را دنبال می‌کنی.",
    games: "اینجا سرگرمی‌ها و بازی‌های داخل جهان قرار می‌گیرند.",
    missions: "اینجا مأموریت‌ها، هدف‌ها و پاداش‌هایی که برایت تعریف می‌شوند قرار می‌گیرند.",
    collection: "اینجا مجموعه چیزهایی را که در طول بازی جمع می‌کنی می‌بینی.",
    events: "اینجا رویدادهای محدود، اتفاقات ویژه و فصل‌های جهان قرار می‌گیرند.",
    ranking: "اینجا رتبه‌بندی بازیکنان همین گروه را می‌بینی.",
    help: "راهنمای جهان و روش استفاده از بخش‌ها از اینجا در دسترس است.",
    settings: "تنظیمات اکانت و انتخاب‌های شخصی جهان از اینجا مدیریت می‌شود.",
  };
  return [
    "◈ " + title,
    "",
    WORLD_SEPARATOR,
    "",
    "★ - " + account.display_name,
    "⛂ - سطح : " + fa(Number(account.level)),
    "⛂ - سکه : " + fa(Number(account.coins)),
    "",
    descriptions[section] ?? "این بخش برای توسعه مرحله‌ای جهان آماده شده و قابلیت‌هایش به مرور فعال می‌شوند.",
    "",
    WORLD_SEPARATOR,
    "",
    "این بخش هنوز در حال توسعه است؛ اما اکانتت و اطلاعات اصلی‌ات همین حالا ذخیره می‌شوند.",
  ].join("\n");
}

function unauthorizedText() {
  return [
    "◈ دنیای پرشین",
    "",
    WORLD_SEPARATOR,
    "",
    "این دکمه برای بازیکنی که آن را ساخته شده.",
    "برای ورود به جهان خودت، دستور جهان را بنویس.",
    "",
    WORLD_SEPARATOR,
    "",
  ].join("\n");
}

function inactiveText() {
  return [
    "◈ دنیای پرشین",
    "",
    WORLD_SEPARATOR,
    "",
    "اکانت بازی تو در حال حاضر فعال نیست.",
    "برای ادامه، وضعیت اکانت باید فعال باشد.",
    "",
    WORLD_SEPARATOR,
    "",
  ].join("\n");
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
  return {
    percent,
    bar: "▰".repeat(filled) + "▱".repeat(10 - filled),
    remaining: Math.max(0, next - xp),
  };
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

export async function handleWorldText(ctx: WorldContext, text: string): Promise<WorldResult | null> {
  if (!isWorldCommand(text)) return null;

  try {
    await ensureWorldSchema(ctx.pool);
  } catch (error) {
    console.error("[world] schema error:", error);
    return {
      text: "✗ فعلاً ورود به دنیای پرشین ممکن نشد. دوباره کمی بعد تلاش کن.",
    };
  }

  const account = await getAccount(ctx.pool, ctx.chatId, ctx.userId);
  if (!account) {
    return {
      text: registrationText(ctx.user),
      replyMarkup: registrationKeyboard(ctx.userId),
    };
  }

  if (account.status !== "active") {
    return {
      text: inactiveText(),
      replyMarkup: backKeyboard(ctx.userId),
    };
  }

  await ctx.pool.query(
    "UPDATE game_world_accounts SET username=$3,first_name=$4,display_name=$5,last_active_at=NOW() WHERE group_id=$1 AND user_id=$2",
    [ctx.chatId, ctx.userId, ctx.user.username ?? null, ctx.user.first_name ?? null, displayName(ctx.user)],
  );

  return {
    text: (await centerText(ctx.pool, ctx, account)) ?? registrationText(ctx.user),
    replyMarkup: mainKeyboard(ctx.userId),
  };
}

export async function handleWorldCallback(ctx: WorldContext, data: string): Promise<WorldResult | null> {
  const parts = String(data ?? "").split(":");
  if (parts[0] !== "world") return null;

  try {
    await ensureWorldSchema(ctx.pool);
  } catch (error) {
    console.error("[world] callback schema error:", error);
    return { text: "✗ فعلاً اجرای این بخش ممکن نشد. دوباره تلاش کن." };
  }

  const ownerId = Number(parts[parts.length - 1]);
  if (!Number.isSafeInteger(ownerId) || ownerId !== ctx.userId) {
    return { text: unauthorizedText(), replyMarkup: backKeyboard(ctx.userId) };
  }

  const action = parts[1];

  if (action === "register") {
    const account = await getAccount(ctx.pool, ctx.chatId, ctx.userId);
    if (account) {
      return {
        text: (await centerText(ctx.pool, ctx, account)) ?? registrationText(ctx.user),
        replyMarkup: mainKeyboard(ctx.userId),
      };
    }
    return {
      text: registrationGenderText(ctx.user),
      replyMarkup: genderKeyboard(ctx.userId),
    };
  }

  if (action === "gender") {
    const gender = String(parts[3] ?? "");
    if (!["male", "female", "unspecified"].includes(gender)) {
      return { text: "✗ انتخاب جنسیت معتبر نیست.", replyMarkup: genderKeyboard(ctx.userId) };
    }

    const existing = await getAccount(ctx.pool, ctx.chatId, ctx.userId);
    if (!existing) {
      const inserted = await ctx.pool.query<any>(
        "INSERT INTO game_world_accounts(group_id,user_id,username,first_name,display_name,gender) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(group_id,user_id) DO NOTHING RETURNING *",
        [
          ctx.chatId,
          ctx.userId,
          ctx.user.username ?? null,
          ctx.user.first_name ?? null,
          displayName(ctx.user),
          gender,
        ],
      );
      const account = inserted.rows[0] ?? await getAccount(ctx.pool, ctx.chatId, ctx.userId);
      return {
        text: (await centerText(ctx.pool, ctx, account)) ?? registrationText(ctx.user),
        replyMarkup: mainKeyboard(ctx.userId),
      };
    }

    return {
      text: (await centerText(ctx.pool, ctx, existing)) ?? registrationText(ctx.user),
      replyMarkup: mainKeyboard(ctx.userId),
    };
  }

  if (action === "cancel") {
    return {
      text: registrationText(ctx.user),
      replyMarkup: registrationKeyboard(ctx.userId),
    };
  }

  if (action === "help") {
    return {
      text: helpText(),
      replyMarkup: backKeyboard(ctx.userId),
    };
  }

  if (action === "home") {
    const account = await getAccount(ctx.pool, ctx.chatId, ctx.userId);
    if (!account) {
      return {
        text: registrationText(ctx.user),
        replyMarkup: registrationKeyboard(ctx.userId),
      };
    }
    if (account.status !== "active") {
      return { text: inactiveText(), replyMarkup: backKeyboard(ctx.userId) };
    }
    return {
      text: (await centerText(ctx.pool, ctx, account)) ?? registrationText(ctx.user),
      replyMarkup: mainKeyboard(ctx.userId),
    };
  }

  if (action === "section") {
    const section = String(parts[2] ?? "");
    const account = await getAccount(ctx.pool, ctx.chatId, ctx.userId);
    if (!account) {
      return {
        text: registrationText(ctx.user),
        replyMarkup: registrationKeyboard(ctx.userId),
      };
    }
    if (account.status !== "active") {
      return { text: inactiveText(), replyMarkup: backKeyboard(ctx.userId) };
    }

    if (section === "profile") {
      return {
        text: (await profileText(ctx.pool, ctx)) ?? registrationText(ctx.user),
        replyMarkup: backKeyboard(ctx.userId),
      };
    }

    if (section === "life") {
      return {
        text: (await lifeText(ctx.pool, ctx)) ?? registrationText(ctx.user),
        replyMarkup: backKeyboard(ctx.userId),
      };
    }

    return {
      text: sectionText(section, account),
      replyMarkup: backKeyboard(ctx.userId),
    };
  }

  return null;
}
