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

const fa = (x: number) => String(x).replace(/\\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)] ?? d);

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
    "دنیای پرشین یک بازی متنی اجتماعی است.",
    "اینجا هر بازیکن یک اکانت مستقل در همین گروه دارد.",
    "",
    "برای ورود، ابتدا باید اکانت بازی خودت را بسازی.",
    "تا قبل از ثبت‌نام، هیچ پیشرفت، دارایی، شغل یا تراکنشی برای تو ثبت نمی‌شود.",
    "",
    WORLD_SEPARATOR,
    "",
    "★ - بازیکن : " + displayName(user),
    "⛂ - شناسه : " + fa(user.id),
    "⛂ - وضعیت اکانت : ثبت‌نشده",
    "",
    "با ساخت اکانت، اطلاعات بازی برای همین گروه ایجاد می‌شود.",
  ].join("\n");
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
    "⛂ - تجربه : " + fa(Number(a.xp)),
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
    "این شهر همه‌کاره است؛ مسیر، شغل، دارایی و سبک زندگی را خودت می‌سازی.",
    "دو مسیر اصلی جهان در ساختار بازی قرار دارد:",
    "★ - رول‌پلی و ماجراجویی داستان‌محور",
    "★ - زندگی شهری و حرفه بازیکنان",
    "",
    "برای ادامه، یکی از بخش‌ها را انتخاب کن.",
  ].join("\n");
}

async function registerAccount(pool: Pool, ctx: WorldContext, gender: string) {
  await ensureWorldSchema(pool);
  const existing = await getAccount(pool, ctx.chatId, ctx.userId);
  if (existing) return { text: await centerText(pool, ctx, existing)!, replyMarkup: mainKeyboard(ctx.userId) };

  if (!["male", "female", "unspecified"].includes(gender)) {
    return { text: "✗ انتخاب جنسیت معتبر نیست.", replyMarkup: genderKeyboard(ctx.userId) };
  }

  const name = displayName(ctx.user);
  const result = await pool.query<any>(
    `INSERT INTO game_world_accounts(group_id,user_id,username,first_name,display_name,gender)
     VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(group_id,user_id) DO UPDATE SET
       username=EXCLUDED.username,
       first_name=EXCLUDED.first_name,
       display_name=EXCLUDED.display_name,
       last_active_at=NOW()
     RETURNING *`,
    [ctx.chatId, ctx.userId, ctx.user.username ?? null, ctx.user.first_name ?? null, name, gender],
  );

  const account = result.rows[0];
  return {
    text: [
      "◈ اکانت ساخته شد",
      "",
      WORLD_SEPARATOR,
      "",
      "★ - خوش آمدی، " + account.display_name,
      "⛂ - شماره اکانت : #" + fa(Number(account.account_id)),
      "⛂ - سطح شروع : " + fa(1),
      "⛂ - سرمایه شروع : " + fa(1000) + " سکه",
      "⛂ - خانه : خانه آغازین",
      "⛂ - شغل : انتخاب نشده",
      "",
      WORLD_SEPARATOR,
      "",
      "از این لحظه پیشرفت تو در این گروه ذخیره می‌شود.",
      "هیچ شغل یا مسیر از قبل برای تو قفل نشده؛ خودت زندگی‌ات را می‌سازی.",
      "",
      "‹ مرکز جهان را باز کن.",
    ].join("\n"),
    replyMarkup: mainKeyboard(ctx.userId),
  };
}

async function sectionText(pool: Pool, ctx: WorldContext, section: string) {
  const a = await getAccount(pool, ctx.chatId, ctx.userId);
  if (!a) return null;
  const name = SECTION_NAMES[section] ?? "بخش";
  const descriptions: Record<string, string> = {
    profile: "اطلاعات، پیشرفت، آمار و هویت اکانت در این بخش مدیریت می‌شود.",
    life: "خانه، سبک زندگی، وسایل شخصی و مسیر روزمره بازیکن در این بخش قرار می‌گیرد.",
    city: "شهر مشترک گروه، ساختمان‌ها، شهروندان و رشد شهری در این بخش قرار می‌گیرد.",
    job: "هر بازیکن یک حرفه اصلی خواهد داشت و کسب‌وکار اختصاصی خودش را از صفر می‌سازد.",
    market: "خرید، فروش، سفارش، قیمت کالاها و بازار بازیکنان در این بخش قرار می‌گیرد.",
    assets: "پول، منابع، ابزار، خانه و دارایی‌های قابل مالکیت در این بخش قرار می‌گیرند.",
    adventure: "مسیر رول‌پلی داستان‌محور و نقشه ماجراجویی در این بخش قرار می‌گیرد.",
    games: "سرگرمی‌ها و بازی‌های سبک در کنار جهان اصلی در این بخش قرار می‌گیرند.",
    missions: "مأموریت‌های روزانه، هفتگی، داستانی و گروهی در این بخش قرار می‌گیرند.",
    collection: "مجموعه، آیتم‌های کمیاب، نشان‌ها و دارایی‌های نمایشی در این بخش قرار می‌گیرند.",
    events: "رویدادهای محدود، فصل‌ها و اتفاقات زنده جهان در این بخش قرار می‌گیرند.",
    ranking: "رتبه بازیکنان، ثروت، اعتبار، تجارت، ماجراجویی و رقابت‌های گروهی در این بخش قرار می‌گیرند.",
    help: "راهنمای کامل جهان و قوانین آن از این بخش در دسترس خواهد بود.",
    settings: "تنظیمات تجربه بازی، اعلان‌ها و نمایش اطلاعات در این بخش مدیریت می‌شود.",
  };
  return [
    "◈ Pᴇʀsɪᴀɴ Wᴏʀʟᴅ · " + name,
    "",
    WORLD_SEPARATOR,
    "",
    "★ - وضعیت : آماده‌سازی هسته",
    "⛂ - اکانت : #" + fa(Number(a.account_id)),
    "",
    descriptions[section] ?? "ساختار این بخش ثبت شده و قابلیت‌های آن در مراحل بعدی توسعه می‌یابد.",
    "",
    "این بخش هنوز قابلیت عملیاتی کامل ندارد و عمداً در این مرحله فعال نشده است.",
  ].join("\n");
}

export async function handleWorldText(ctx: WorldContext, text: string) {
  const raw = String(text ?? "").trim();
  if (!isWorldCommand(raw)) return null;
  await ensureWorldSchema(ctx.pool);
  const existing = await getAccount(ctx.pool, ctx.chatId, ctx.userId);
  if (!existing) {
    return {
      text: registrationText(ctx.user),
      replyMarkup: registrationKeyboard(ctx.userId),
    };
  }
  await ctx.pool.query(
    "UPDATE game_world_accounts SET username=$3,first_name=$4,display_name=$5,last_active_at=NOW() WHERE group_id=$1 AND user_id=$2",
    [ctx.chatId, ctx.userId, ctx.user.username ?? null, ctx.user.first_name ?? null, displayName(ctx.user)],
  );
  return { text: await centerText(ctx.pool, ctx)!, replyMarkup: mainKeyboard(ctx.userId) };
}

export async function handleWorldCallback(ctx: WorldContext, data: string) {
  const parts = String(data ?? "").split(":");
  if (parts[0] !== "world") return null;
  await ensureWorldSchema(ctx.pool);

  const action = parts[1] ?? "";
  const owner = Number(parts[2] ?? 0);
  if (owner && owner !== ctx.userId) {
    return { text: "⛂ - این پنل متعلق به بازیکن دیگری است.", replyMarkup: { inline_keyboard: [] } };
  }

  const account = await getAccount(ctx.pool, ctx.chatId, ctx.userId);

  if (action === "help") {
    return {
      text: [
        "◈ راهنمای Pᴇʀsɪᴀɴ Wᴏʀʟᴅ",
        "",
        WORLD_SEPARATOR,
        "",
        "دستور اصلی : جهان",
        "English : world",
        "دنیای من : my world",
        "",
        "اولین بار که این دستور را در یک گروه استفاده کنی، باید اکانت بسازی.",
        "پس از ثبت‌نام، منوی کامل جهان برای اکانتت باز می‌شود.",
      ].join("\n"),
      replyMarkup: account ? mainKeyboard(ctx.userId) : registrationKeyboard(ctx.userId),
    };
  }

  if (action === "cancel") {
    return {
      text: account ? await centerText(ctx.pool, ctx)! : "⛂ - ساخت اکانت لغو شد. برای شروع دوباره، دستور «جهان» را ارسال کن.",
      replyMarkup: account ? mainKeyboard(ctx.userId) : registrationKeyboard(ctx.userId),
    };
  }

  if (action === "register") {
    if (account) return { text: await centerText(ctx.pool, ctx)!, replyMarkup: mainKeyboard(ctx.userId) };
    return {
      text: [
        "◈ ساخت اکانت",
        "",
        WORLD_SEPARATOR,
        "",
        "نام نمایشی تو از اطلاعات تلگرام گرفته می‌شود.",
        "اکانت برای همین گروه ساخته می‌شود و پیشرفتت در گروه دیگر مشترک نیست.",
        "",
        "جنسیت شخصیتت را انتخاب کن:",
      ].join("\n"),
      replyMarkup: genderKeyboard(ctx.userId),
    };
  }

  if (action === "gender") {
    if (account) return { text: await centerText(ctx.pool, ctx)!, replyMarkup: mainKeyboard(ctx.userId) };
    const gender = parts[3] ?? "unspecified";
    return await registerAccount(ctx.pool, ctx, gender);
  }

  if (action === "section") {
    if (!account) {
      return { text: registrationText(ctx.user), replyMarkup: registrationKeyboard(ctx.userId) };
    }
    const section = parts[2] ?? "";
    if (!SECTION_NAMES[section]) return { text: "✗ این بخش پیدا نشد.", replyMarkup: mainKeyboard(ctx.userId) };
    if (section === "profile") {
      return { text: await centerText(ctx.pool, ctx)!, replyMarkup: mainKeyboard(ctx.userId) };
    }
    return {
      text: await sectionText(ctx.pool, ctx, section),
      replyMarkup: mainKeyboard(ctx.userId),
    };
  }

  return null;
}
