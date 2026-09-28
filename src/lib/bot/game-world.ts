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
  chatTitle?: string;
  userRank?: string;
};

export type WorldResult = {
  text: string;
  replyMarkup?: Record<string, unknown>;
  parseMode?: "HTML";
};

export const WORLD_SEPARATOR = "                     ─────━━───── ◈ ─────━━─────";

const WORLD_COMMANDS = [
  "ورود به جهان",
  "دنیای من",
  "جهان من",
  "world",
  "my world",
  "enter world",
  "persian world",
  "جهان",
];

const SECTION_NAMES: Record<string, string> = {
  profile: "پروفایل",
  life: "زندگی شخصی",
  city: "شهر و سفر",
  job: "کار و حرفه",
  market: "بازار مرزی",
  assets: "ملک و دارایی",
  resources: "منابع و استخراج",
  adventure: "ماجرا",
  games: "سرگرمی‌های سالون",
  missions: "کار و مأموریت",
  collection: "مجموعه",
  events: "رویدادهای مرزی",
  ranking: "رتبه‌بندی",
  help: "راهنما",
  settings: "تنظیمات",
  news: "اخبار",
};

const FRONTIER_LOCAL_BOT = "کلانتر محلی";
const FRONTIER_CITY_BOT = "مارشال شهر";

const WESTERN_SETTLEMENT_PREFIXES = [
  "Dust",
  "Red",
  "Black",
  "Silver",
  "Dry",
  "Dead",
  "Copper",
  "Golden",
  "Wild",
  "Broken",
  "High",
  "Rust",
];

const WESTERN_SETTLEMENT_SUFFIXES = [
  "Creek",
  "Ridge",
  "Hollow",
  "Gulch",
  "Mesa",
  "Crossing",
  "Canyon",
  "Pines",
  "Springs",
  "Prairie",
  "Pass",
  "Rock",
];

type ResourceDefinition = {
  code: string;
  name: string;
  category: string;
};

const RESOURCE_CATALOG: ResourceDefinition[] = [
  { code: "wood", name: "چوب جنگلی", category: "چوب و مصالح" },
  { code: "stone", name: "سنگ ساختمانی", category: "چوب و مصالح" },
  { code: "water", name: "آب چاه", category: "آب و بقا" },
  { code: "sand", name: "شن رودخانه", category: "چوب و مصالح" },
  { code: "clay", name: "خاک رس", category: "چوب و مصالح" },
  { code: "limestone", name: "سنگ آهک", category: "چوب و مصالح" },
  { code: "granite", name: "گرانیت", category: "چوب و مصالح" },
  { code: "quartz", name: "کوارتز", category: "معدنی" },
  { code: "salt", name: "نمک", category: "معدنی" },
  { code: "sulfur", name: "گوگرد", category: "معدنی" },
  { code: "coal", name: "زغال سنگ", category: "انرژی" },
  { code: "oil", name: "نفت خام", category: "انرژی" },
  { code: "natural_gas", name: "گاز طبیعی", category: "انرژی" },
  { code: "iron_ore", name: "سنگ آهن", category: "معدنی" },
  { code: "copper_ore", name: "سنگ مس", category: "معدنی" },
  { code: "aluminum_ore", name: "سنگ فلز سبک", category: "معدنی" },
  { code: "lead_ore", name: "سنگ سرب", category: "معدنی" },
  { code: "zinc_ore", name: "سنگ روی", category: "معدنی" },
  { code: "nickel_ore", name: "سنگ قلع", category: "معدنی" },
  { code: "titanium_ore", name: "سنگ آنتیموان", category: "معدنی" },
  { code: "gold_ore", name: "سنگ طلا", category: "معدنی" },
  { code: "silver_ore", name: "سنگ نقره", category: "معدنی" },
  { code: "diamond_ore", name: "سنگ فیروزه", category: "معدنی" },
  { code: "emerald_ore", name: "سنگ عقیق", category: "معدنی" },
  { code: "wheat", name: "گندم", category: "کشاورزی" },
  { code: "corn", name: "ذرت", category: "کشاورزی" },
  { code: "cotton", name: "پنبه", category: "کشاورزی" },
  { code: "sugar_cane", name: "نیشکر", category: "کشاورزی" },
  { code: "herbs", name: "گیاهان دارویی", category: "طبیعت" },
  { code: "rubber", name: "صمغ درختی", category: "طبیعت" },
  { code: "wool", name: "پشم گوسفند", category: "دامداری" },
  { code: "leather", name: "پوست و چرم خام", category: "شکار و دامداری" },
  { code: "fish", name: "ماهی رودخانه", category: "شکار و بقا" },
];

type StarterFactory = {
  code: string;
  level: number;
  rateAmount: number;
  intervalSeconds: number;
  capacity: number;
};

const STARTER_FACTORIES: StarterFactory[] = [
  { code: "wood", level: 1, rateAmount: 1, intervalSeconds: 60, capacity: 30 },
  { code: "stone", level: 1, rateAmount: 1, intervalSeconds: 90, capacity: 30 },
  { code: "water", level: 1, rateAmount: 2, intervalSeconds: 60, capacity: 60 },
  { code: "wheat", level: 1, rateAmount: 1, intervalSeconds: 120, capacity: 30 },
];

const RESOURCE_PAGE_SIZE = 10;

function norm(value: string) {
  return String(value ?? "")
    .trim()
    .replace(/^[\\/!.]+/, "")
    .replace(/[\u200c\u200d]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const fa = (x: number) => String(Math.max(0, Math.floor(x)));

function displayName(user: WorldUser) {
  return user.first_name || user.username || String(user.id);
}

function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mentionHtml(user: WorldUser) {
  return '<a href="tg://user?id=' + fa(user.id) + '">' + escapeHtml(displayName(user)) + "</a>";
}

function resourceByCode(code: string) {
  return RESOURCE_CATALOG.find((x) => x.code === code) ?? null;
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_world_settlements(
      settlement_id BIGSERIAL PRIMARY KEY,
      group_id BIGINT NOT NULL UNIQUE,
      chat_title TEXT,
      name TEXT NOT NULL,
      settlement_kind TEXT NOT NULL DEFAULT 'village' CHECK(settlement_kind IN ('village','city')),
      is_public BOOLEAN NOT NULL DEFAULT FALSE,
      region_name TEXT NOT NULL DEFAULT 'The Frontier',
      population_count INT NOT NULL DEFAULT 0 CHECK(population_count>=0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_world_personal_assets(
      asset_id BIGSERIAL PRIMARY KEY,
      group_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      home_code TEXT NOT NULL DEFAULT 'frontier_cabin',
      home_level INT NOT NULL DEFAULT 1 CHECK(home_level>=1),
      farm_level INT NOT NULL DEFAULT 1 CHECK(farm_level>=0),
      stable_level INT NOT NULL DEFAULT 0 CHECK(stable_level>=0),
      horse_name TEXT,
      horse_level INT NOT NULL DEFAULT 0 CHECK(horse_level>=0),
      horse_energy INT NOT NULL DEFAULT 100 CHECK(horse_energy BETWEEN 0 AND 100),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(group_id,user_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_world_travels(
      travel_id BIGSERIAL PRIMARY KEY,
      group_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      from_settlement_id BIGINT NOT NULL,
      to_settlement_id BIGINT NOT NULL,
      departure_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      arrival_at TIMESTAMPTZ NOT NULL,
      cost_coins BIGINT NOT NULL DEFAULT 0 CHECK(cost_coins>=0),
      status TEXT NOT NULL DEFAULT 'travelling' CHECK(status IN ('travelling','arrived','cancelled'))
    )
  `);

  await pool.query("CREATE TABLE IF NOT EXISTS game_world_news( news_id BIGSERIAL PRIMARY KEY, scope TEXT NOT NULL CHECK(scope IN ('local','global')), group_id BIGINT, title TEXT NOT NULL, body TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'info' CHECK(severity IN ('info','notice','warning','event')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ )");

  await pool.query("CREATE TABLE IF NOT EXISTS game_world_market_listings( listing_id BIGSERIAL PRIMARY KEY, group_id BIGINT NOT NULL, seller_user_id BIGINT NOT NULL, resource_code TEXT NOT NULL, amount NUMERIC(20,6) NOT NULL CHECK(amount>0), min_purchase NUMERIC(20,6) NOT NULL DEFAULT 1 CHECK(min_purchase>0), unit_price BIGINT NOT NULL CHECK(unit_price>=0), status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','sold','cancelled','expired')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days') )");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_world_resource_factories(
      factory_id BIGSERIAL PRIMARY KEY,
      group_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      resource_code TEXT NOT NULL,
      level INT NOT NULL DEFAULT 1 CHECK(level>=1),
      rate_amount NUMERIC(20,6) NOT NULL DEFAULT 1 CHECK(rate_amount>0),
      interval_seconds INT NOT NULL DEFAULT 60 CHECK(interval_seconds>0),
      capacity NUMERIC(20,6) NOT NULL DEFAULT 30 CHECK(capacity>0),
      stored_amount NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK(stored_amount>=0),
      last_production_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      UNIQUE(group_id,user_id,resource_code)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_world_resource_inventory(
      inventory_id BIGSERIAL PRIMARY KEY,
      group_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      resource_code TEXT NOT NULL,
      amount NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK(amount>=0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(group_id,user_id,resource_code)
    )
  `);

  await pool.query("CREATE INDEX IF NOT EXISTS idx_game_world_accounts_group_level ON game_world_accounts(group_id,level DESC,coins DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_game_world_accounts_group_activity ON game_world_accounts(group_id,last_active_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_game_world_settlements_public_kind ON game_world_settlements(is_public,settlement_kind)");
  await pool.query("ALTER TABLE game_world_settlements ADD COLUMN IF NOT EXISTS market_active BOOLEAN NOT NULL DEFAULT TRUE");
  await pool.query("ALTER TABLE game_world_settlements ADD COLUMN IF NOT EXISTS bank_active BOOLEAN NOT NULL DEFAULT TRUE");
  await pool.query("ALTER TABLE game_world_settlements ADD COLUMN IF NOT EXISTS saloon_active BOOLEAN NOT NULL DEFAULT TRUE");
  await pool.query("ALTER TABLE game_world_settlements ADD COLUMN IF NOT EXISTS train_station_active BOOLEAN NOT NULL DEFAULT TRUE");
  await pool.query("ALTER TABLE game_world_settlements ADD COLUMN IF NOT EXISTS mine_active BOOLEAN NOT NULL DEFAULT TRUE");
  await pool.query("ALTER TABLE game_world_settlements ADD COLUMN IF NOT EXISTS jobs_active BOOLEAN NOT NULL DEFAULT TRUE");
  await pool.query("ALTER TABLE game_world_settlements ADD COLUMN IF NOT EXISTS laws_profile TEXT NOT NULL DEFAULT 'frontier'");
  await pool.query("ALTER TABLE game_world_settlements ADD COLUMN IF NOT EXISTS local_bot_name TEXT NOT NULL DEFAULT 'کلانتر محلی'");
  await pool.query("ALTER TABLE game_world_settlements ADD COLUMN IF NOT EXISTS city_bot_name TEXT NOT NULL DEFAULT 'مارشال شهر'");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_game_world_travels_user_status ON game_world_travels(group_id,user_id,status,arrival_at)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_game_world_news_scope_group_created ON game_world_news(scope,group_id,created_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_game_world_market_group_status ON game_world_market_listings(group_id,status,created_at DESC)");

  await pool.query("CREATE INDEX IF NOT EXISTS idx_game_world_resource_factories_group_user ON game_world_resource_factories(group_id,user_id,active)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_game_world_resource_inventory_group_user ON game_world_resource_inventory(group_id,user_id)");
}

async function getAccount(pool: Pool, groupId: number, userId: number) {
  const result = await pool.query<any>(
    "SELECT * FROM game_world_accounts WHERE group_id=$1 AND user_id=$2 LIMIT 1",
    [groupId, userId],
  );
  return result.rows[0] ?? null;
}

async function ensureSettlement(pool: Pool, groupId: number, chatTitle?: string) {
  const existing = await pool.query<any>(
    "SELECT * FROM game_world_settlements WHERE group_id=$1 LIMIT 1",
    [groupId],
  );
  if (existing.rows[0]) {
    await pool.query(
      "UPDATE game_world_settlements SET chat_title=COALESCE($2,chat_title),updated_at=NOW() WHERE group_id=$1",
      [groupId, chatTitle ?? null],
    );
    return (await pool.query<any>(
      "SELECT * FROM game_world_settlements WHERE group_id=$1 LIMIT 1",
      [groupId],
    )).rows[0];
  }

  const inserted = await pool.query<any>(
    `INSERT INTO game_world_settlements(group_id,chat_title,name,settlement_kind,is_public,region_name)
     VALUES($1,$2,'Frontier Post','village',FALSE,'The Frontier')
     RETURNING *`,
    [groupId, chatTitle ?? null],
  );
  const row = inserted.rows[0];
  const id = Number(row.settlement_id);
  const prefix = WESTERN_SETTLEMENT_PREFIXES[id % WESTERN_SETTLEMENT_PREFIXES.length];
  const suffix = WESTERN_SETTLEMENT_SUFFIXES[id % WESTERN_SETTLEMENT_SUFFIXES.length];
  const generatedName = prefix + " " + suffix + " #" + id;

  await pool.query(
    "UPDATE game_world_settlements SET name=$2,updated_at=NOW() WHERE settlement_id=$1",
    [row.settlement_id, generatedName],
  );

  return (await pool.query<any>(
    "SELECT * FROM game_world_settlements WHERE settlement_id=$1 LIMIT 1",
    [row.settlement_id],
  )).rows[0];
}

async function ensurePersonalAssets(pool: Pool, groupId: number, userId: number) {
  await pool.query(
    `INSERT INTO game_world_personal_assets(group_id,user_id)
     VALUES($1,$2)
     ON CONFLICT(group_id,user_id) DO NOTHING`,
    [groupId, userId],
  );
  return (await pool.query<any>(
    "SELECT * FROM game_world_personal_assets WHERE group_id=$1 AND user_id=$2 LIMIT 1",
    [groupId, userId],
  )).rows[0] ?? null;
}

function westernLine(section: string) {
  const lines: Record<string, string[]> = {
    city: [
      "« این جاده برای کسی که عجله دارد ساخته نشده. مقصد داری؛ راهش هم هزینه دارد.»",
      "« نام شهری را که واردش می‌شوی به خاطر بسپار. هر شهر قانون خودش را دارد.»",
    ],
    job: [
      "« این سرزمین برای اسم قشنگ پول نمی‌دهد. حرفه‌ای یاد بگیر که به درد کسی بخورد.»",
      "« دست خالی تا آخر مرز دوام نمی‌آوری. ابزار بردار و کاری بلد شو.»",
    ],
    market: [
      "« قیمت را بازار تعیین می‌کند. جنس خوب، مشتری خودش را پیدا می‌کند.»",
      "« حرف خریدار نمی‌آورد؛ کالای سالم و قیمت درست می‌آورد.»",
    ],
    resources: [
      "« معدن مال تو نیست، رفیق. چیزی که از زمین می‌گیری، ابزار و سهم خودش را دارد.»",
      "« کلنگ داری، راه معدن باز است. کلنگ نداری، وقتت را تلف نکن.»",
    ],
    life: [
      "« خانه فقط سقف نیست. زمین، وسایل و اسبت از همین‌جا شروع می‌شوند.»",
      "« مزرعه با زمین شروع می‌شود. اسب هم تا وقتی خرجش را بدهی، کنار تو می‌ماند.»",
    ],
    adventure: [
      "« جاده مجانی نیست؛ یک روز زمان می‌گیرد، یک روز پول و گاهی هر دو.»",
      "« هر ردپایی که روی خاک می‌بینی، دلیل نمی‌شود دنبالش بروی.»",
    ],
    news: [
      "« خبر خوب زود راه می‌افتد. خبر بد از آن هم سریع‌تر.»",
      "« در مرز، یک اتفاق کوچک می‌تواند قیمت یک شهر را عوض کند.»",
    ],
    default: [
      "« اینجا کسی زندگی آماده تحویل نمی‌دهد. جای خودت را باید خودت بسازی.»",
      "« مرز به آدم فرصت می‌دهد؛ تضمین نمی‌دهد.»",
    ],
  };
  const pool = lines[section] ?? lines.default;
  return pool[Math.floor(Date.now() / 60000) % pool.length];
}
async function ensureStarterFactories(pool: Pool, groupId: number, userId: number) {
  for (const factory of STARTER_FACTORIES) {
    await pool.query(
      `INSERT INTO game_world_resource_factories
        (group_id,user_id,resource_code,level,rate_amount,interval_seconds,capacity)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(group_id,user_id,resource_code) DO NOTHING`,
      [groupId, userId, factory.code, factory.level, factory.rateAmount, factory.intervalSeconds, factory.capacity],
    );
  }
}

function registrationKeyboard(userId: number) {
  const s = String(userId);
  return {
    inline_keyboard: [
      [{ text: "‹ ثبت هویت", callback_data: "world:register:" + s }],
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

function resourcesKeyboard(userId: number, page: number) {
  const s = String(userId);
  const start = page * RESOURCE_PAGE_SIZE;
  const visible = RESOURCE_CATALOG.slice(start, start + RESOURCE_PAGE_SIZE);
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];

  for (let i = 0; i < visible.length; i += 2) {
    const pair = visible.slice(i, i + 2);
    rows.push(pair.map((resource) => ({
      text: "‹ " + resource.name,
      callback_data: "world:resource:" + resource.code + ":" + s,
    })));
  }

  const totalPages = Math.max(1, Math.ceil(RESOURCE_CATALOG.length / RESOURCE_PAGE_SIZE));
  const nav: Array<{ text: string; callback_data: string }> = [];
  if (page > 0) nav.push({ text: "‹ قبلی", callback_data: "world:resources:" + String(page - 1) + ":" + s });
  if (page < totalPages - 1) nav.push({ text: "› بعدی", callback_data: "world:resources:" + String(page + 1) + ":" + s });
  if (nav.length) rows.push(nav);

  rows.push([{ text: "‹ برداشت همه منابع", callback_data: "world:claimall:" + s }]);
  rows.push([{ text: "‹ بازگشت به جهان", callback_data: "world:home:" + s }]);
  return { inline_keyboard: rows };
}

function mainKeyboard(userId: number) {
  const s = String(userId);
  return {
    inline_keyboard: [
      [
        { text: "‹ پروفایل", callback_data: "world:section:profile:" + s },
        { text: "‹ زندگی شخصی", callback_data: "world:section:life:" + s },
      ],
      [
        { text: "‹ شهر و سفر", callback_data: "world:section:city:" + s },
        { text: "‹ کار و حرفه", callback_data: "world:section:job:" + s },
      ],
      [
        { text: "‹ منابع و استخراج", callback_data: "world:section:resources:" + s },
        { text: "‹ بازار مرزی", callback_data: "world:section:market:" + s },
      ],
      [
        { text: "‹ ملک و دارایی", callback_data: "world:section:assets:" + s },
        { text: "‹ ماجرا", callback_data: "world:section:adventure:" + s },
      ],
      [
        { text: "‹ سالون", callback_data: "world:section:games:" + s },
        { text: "‹ کار و مأموریت", callback_data: "world:section:missions:" + s },
      ],
      [
        { text: "‹ مجموعه", callback_data: "world:section:collection:" + s },
        { text: "‹ رویدادهای مرزی", callback_data: "world:section:events:" + s },
      ],
      [
        { text: "‹ رتبه‌بندی", callback_data: "world:section:ranking:" + s },
        { text: "‹ راهنما", callback_data: "world:section:help:" + s },
      ],
      [
        { text: "‹ تنظیمات", callback_data: "world:section:settings:" + s },
      ],
    ],
  };
}

function registrationText(user: WorldUser) {
  return [
    "◈ Pᴇʀsɪᴀɴ Wᴏʀʟᴅ · Fʀᴏɴᴛɪᴇʀ",
    "",
    WORLD_SEPARATOR,
    "",
    "شهر هنوز اسمت رو نمی‌شناسه.",
    "برای شروع زندگی تو این سرزمین، باید هویتت رو ثبت کنی.",
    "",
    "این شهر برای تازه‌واردها جای راحتی نیست.",
    "از صفر شروع می‌کنی؛ بقیه‌اش دست خودته.",
    "",
    "★ - تازه‌وارد : " + displayName(user),
    "⛂ - شناسه : " + fa(user.id),
    "⛂ - وضعیت هویت : ثبت‌نشده",
    "",
    WORLD_SEPARATOR,
    "",
  ].join("\n");
}
function helpText() {
  return [
    "◈ راهنمای سرزمین پرشین",
    "",
    WORLD_SEPARATOR,
    "",
    "برای شروع، هویتت را ثبت کن.",
    "هر گپ در این جهان یک قلمرو دارد؛ روستای شخصی، شهر همگانی یا مقصدی که بعداً به آن سفر می‌کنی.",
    "",
    "★ - خانه، مزرعه، اصطبل و اسب متعلق به اکانت خودت هستند.",
    "★ - منابع در زمین و کارگاه‌های خودت تولید می‌شوند.",
    "★ - سفر بین شهرها زمان می‌برد و هزینه دارد.",
    "★ - اهالی شهر و شخصیت‌های محلی در جهان زنده‌اند.",
    "",
    "ربات محلی : " + FRONTIER_LOCAL_BOT,
    "ربات شهری : " + FRONTIER_CITY_BOT,
    "",
    "دستور ورود : ورود به جهان",
    "",
    WORLD_SEPARATOR,
    "",
  ].join("\n");
}

function registrationGenderText(user: WorldUser) {
  return [
    "◈ ثبت هویت",
    "",
    WORLD_SEPARATOR,
    "",
    "این سرزمین قبل از هر چیز، اسم و هویتت رو می‌خواد.",
    "یک انتخاب اولیه برای کاراکترت ثبت کن.",
    "",
    "★ - تازه‌وارد : " + displayName(user),
    "⛂ - شناسه : " + fa(user.id),
    "",
    WORLD_SEPARATOR,
    "",
    "بعد از ثبت هویت، روستای شخصی‌ات برایت ساخته می‌شود.",
  ].join("\n");
}

function sectionText(section: string, account: any) {
  const title = SECTION_NAMES[section] ?? "سرزمین";
  const descriptions: Record<string, string> = {
    city: "روستای شخصی، شهرهای همگانی و مسیرهایی که بینشان طی می‌کنی از همین‌جا مدیریت می‌شوند.",
    job: "حرفه‌ات باید چیزی به این مرزها اضافه کند؛ معدن، مزرعه، چوب‌بری، آهنگری، شکار، تجارت و کارهای دیگر.",
    market: "بازار مرزی با قیمت، عرضه و تقاضای واقعی بین بازیکنان و اهالی شهر شکل می‌گیرد.",
    assets: "خانه، مزرعه، اصطبل، اسب، ابزار و دارایی‌های شخصی‌ات اینجاست.",
    adventure: "ردپای آدم‌ها، جاده‌های خطرناک، سفرها و داستان‌هایی که در مرز باز می‌شوند.",
    games: "سالون محل بازی، دورهمی و سرگرمی‌های داخل جهان است.",
    missions: "کارهایی که شهر، اهالی یا مسیر زندگی خودت پیش پایت می‌گذارند.",
    collection: "چیزهایی که در سفر، شکار، معدن و معامله جمع کرده‌ای.",
    events: "اتفاقات محدود، حوادث شهر و رویدادهایی که می‌توانند مسیر یک شهر را عوض کنند.",
    ranking: "مقایسه وضعیت و پیشرفت بازیکنان همین قلمرو.",
    help: "قوانین مرز و راه استفاده از بخش‌های مختلف جهان.",
    settings: "تنظیمات اکانت و انتخاب‌های شخصی‌ات در جهان.",
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
    westernLine(section),
    "",
    descriptions[section] ?? "این بخش هنوز قفل توسعه دارد، اما از همین حالا جزئی از ساختار جهان است.",
    "",
    WORLD_SEPARATOR,
    "",
    "اهالی این سرزمین حرف خودشان را می‌زنند؛ لازم نیست هر چیزی را از ربات بپرسی.",
  ].join("\n");
}
function unauthorizedText() {
  return [
    "◈ Pᴇʀsɪᴀɴ Wᴏʀʟᴅ · Fʀᴏɴᴛɪᴇʀ",
    "",
    WORLD_SEPARATOR,
    "",
    "این دکمه برای بازیکن دیگری ساخته شده.",
    "برای ورود به جهان خودت، بنویس: ورود به جهان",
    "",
    WORLD_SEPARATOR,
    "",
  ].join("\n");
}

function inactiveText() {
  return [
    "◈ Pᴇʀsɪᴀɴ Wᴏʀʟᴅ · Fʀᴏɴᴛɪᴇʀ",
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

function levelRequired(level: number) {
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
  const settlement = await ensureSettlement(pool, ctx.chatId, ctx.chatTitle);
  const assets = await ensurePersonalAssets(pool, ctx.chatId, ctx.userId);
  const gender =
    a.gender === "male" ? "مرد" :
    a.gender === "female" ? "زن" :
    "بدون تعیین";
  const homeName = assets?.home_code === "frontier_cabin" ? "کلبه مرزی" : String(assets?.home_code ?? "کلبه مرزی");
  return [
    "◈ Pᴇʀsɪᴀɴ Wᴏʀʟᴅ · Fʀᴏɴᴛɪᴇʀ",
    "",
    "★ - " + a.display_name + " | " + (settlement?.name ?? "Frontier"),
    "⛂ - اکانت : #" + fa(Number(a.account_id)),
    "⛂ - سطح : " + fa(Number(a.level)),
    "⛂ - تجربه : " + fa(Number(a.xp)) + " XP",
    "⛂ - سکه : " + fa(Number(a.coins)),
    "⛂ - اعتبار : " + fa(Number(a.reputation)),
    "⛂ - جنسیت : " + gender,
    "",
    WORLD_SEPARATOR,
    "",
    "⛂ - روستای من : " + (settlement?.name ?? "Frontier"),
    "⛂ - خانه : " + homeName,
    "⛂ - مزرعه : " + (assets && Number(assets.farm_level) > 0 ? "فعال" : "ندارد"),
    "⛂ - اسب : " + (assets?.horse_name ? String(assets.horse_name) : "هنوز نداری"),
    "⛂ - حرفه : " + (a.job_code ? a.job_code : "هنوز انتخاب نشده"),
    "",
    WORLD_SEPARATOR,
    "",
    "⛂ - ربات محلی : " + FRONTIER_LOCAL_BOT,
    "⛂ - ربات شهری : " + FRONTIER_CITY_BOT,
    "⛂ - وضعیت : " + (a.status === "active" ? "فعال" : a.status),
    "",
    "★ - اینجا از صفر شروع می‌کنی.",
    "★ - هر چیزی که می‌سازی، خرج می‌کنی یا به دست می‌آری به همین اکانت تعلق دارد.",
  ].join("\n");
}
async function profileText(pool: Pool, ctx: WorldContext) {
  const a = await getAccount(pool, ctx.chatId, ctx.userId);
  if (!a) return null;
  const p = progressBar(Number(a.xp), Number(a.level));
  const assets = await ensurePersonalAssets(pool, ctx.chatId, ctx.userId);
  const settlement = await ensureSettlement(pool, ctx.chatId, ctx.chatTitle);
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
    "⛂ - قلمرو : " + (settlement?.name ?? "Frontier"),
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
    "⛂ - خانه : " + (assets?.home_code === "frontier_cabin" ? "کلبه مرزی" : String(assets?.home_code ?? "کلبه مرزی")),
    "⛂ - مزرعه : " + (assets && Number(assets.farm_level) > 0 ? "فعال" : "ندارد"),
    "⛂ - اسب : " + (assets?.horse_name ? String(assets.horse_name) : "هنوز نداری"),
    "⛂ - حرفه : " + (a.job_code ? a.job_code : "انتخاب نشده"),
  ].join("\n");
}

async function lifeText(pool: Pool, ctx: WorldContext) {
  const a = await getAccount(pool, ctx.chatId, ctx.userId);
  if (!a) return null;
  const assets = await ensurePersonalAssets(pool, ctx.chatId, ctx.userId);
  return [
    "◈ زندگی شخصی",
    "",
    WORLD_SEPARATOR,
    "",
    "★ - " + a.display_name,
    "⛂ - خانه : " + (assets?.home_code === "frontier_cabin" ? "کلبه مرزی" : String(assets?.home_code ?? "کلبه مرزی")),
    "⛂ - سطح خانه : " + fa(Number(assets?.home_level ?? 1)),
    "⛂ - مزرعه شخصی : " + (assets && Number(assets.farm_level) > 0 ? "فعال | سطح " + fa(Number(assets.farm_level)) : "ندارد"),
    "⛂ - اصطبل : " + (assets && Number(assets.stable_level) > 0 ? "فعال | سطح " + fa(Number(assets.stable_level)) : "ساخته نشده"),
    "⛂ - اسب شخصی : " + (assets?.horse_name ? String(assets.horse_name) : "هنوز اسبی نداری"),
    "",
    "⛂ - حرفه : " + (a.job_code ? a.job_code : "هنوز انتخاب نشده"),
    "⛂ - درآمد : هنوز شروع نشده",
    "",
    WORLD_SEPARATOR,
    "",
    westernLine("life"),
    "",
    "خانه، زمین، اسب و ابزارها از دارایی‌های واقعی اکانتت هستند؛ هر کدام بعداً قابلیت توسعه و هزینه نگهداری خواهند داشت.",
  ].join("\n");
}
async function cityText(pool: Pool, ctx: WorldContext) {
  const settlement = await ensureSettlement(pool, ctx.chatId, ctx.chatTitle);
  if (!settlement) return null;

  const publicCities = (await pool.query<any>(
    `SELECT settlement_id,name,group_id,region_name
     FROM game_world_settlements
     WHERE is_public=TRUE AND settlement_kind='city' AND group_id<>$1
     ORDER BY population_count DESC,settlement_id
     LIMIT 5`,
    [ctx.chatId],
  )).rows;

  const travel = (await pool.query<any>(
    `SELECT t.*, s.name AS destination_name
     FROM game_world_travels t
     LEFT JOIN game_world_settlements s ON s.settlement_id=t.to_settlement_id
     WHERE t.group_id=$1 AND t.user_id=$2 AND t.status='travelling'
     ORDER BY t.arrival_at ASC
     LIMIT 1`,
    [ctx.chatId, ctx.userId],
  )).rows[0];

  const lines = [
    "◈ شهر و سفر",
    "",
    WORLD_SEPARATOR,
    "",
    "★ - قلمرو فعلی",
    "⛂ - نام : " + String(settlement.name),
    "⛂ - نوع : روستای شخصی گروه",
    "⛂ - گپ : " + (ctx.chatTitle || "بدون نام"),
    "⛂ - منطقه : " + String(settlement.region_name),
    "",
    "★ - ساختار مرزی",
    "⛂ - گپ خودمان : روستای شخصی",
    "⛂ - گپ‌های همگانی : شهرهای بزرگ",
    "⛂ - سفر : وابسته به زمان و هزینه",
    "",
  ];

  if (travel) {
    lines.push("★ - در راهی");
    lines.push("⛂ - مقصد : " + String(travel.destination_name ?? "شهر مقصد"));
    lines.push("⛂ - زمان رسیدن : " + new Date(travel.arrival_at).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC");
    lines.push("⛂ - هزینه سفر : " + fa(Number(travel.cost_coins)) + " سکه");
  } else if (!publicCities.length) {
    lines.push("★ - شهرهای همگانی");
    lines.push("⛂ - فعلاً شهری برای سفر ثبت نشده.");
    lines.push("⛂ - وقتی شهرهای همگانی فعال شوند، مقصد، زمان سفر و هزینه هر مسیر اینجا نشان داده می‌شود.");
  } else {
    lines.push("★ - شهرهای همگانی");
    for (const city of publicCities) {
      lines.push("⛂ - " + String(city.name) + " | مقصد آماده سفر");
    }
  }

  lines.push("");
  lines.push(westernLine("city"));
  lines.push("");
  lines.push(WORLD_SEPARATOR);
  return lines.join("\n");
}

async function personalAssetsText(pool: Pool, ctx: WorldContext) {
  const assets = await ensurePersonalAssets(pool, ctx.chatId, ctx.userId);
  if (!assets) return null;
  const homeName = assets.home_code === "frontier_cabin" ? "کلبه مرزی" : String(assets.home_code);
  const farm = Number(assets.farm_level);
  const stable = Number(assets.stable_level);
  const horse = assets.horse_name ? String(assets.horse_name) : "هنوز اسبی نداری";

  return [
    "◈ ملک و دارایی شخصی",
    "",
    WORLD_SEPARATOR,
    "",
    "★ - صاحب ملک : " + displayName(ctx.user),
    "⛂ - خانه : " + homeName,
    "⛂ - سطح خانه : " + fa(Number(assets.home_level)),
    "⛂ - مزرعه شخصی : " + (farm > 0 ? "فعال | سطح " + fa(farm) : "ساخته نشده"),
    "⛂ - اصطبل : " + (stable > 0 ? "فعال | سطح " + fa(stable) : "ساخته نشده"),
    "⛂ - اسب : " + horse,
    "⛂ - سطح اسب : " + fa(Number(assets.horse_level)),
    "⛂ - آمادگی اسب : " + fa(Number(assets.horse_energy)) + "%",
    "",
    WORLD_SEPARATOR,
    "",
    "« اینجا چیزهایی ثبت می‌شن که واقعاً مال خودت باشن؛ خانه، زمین، اسب و دارایی‌های شخصی.»",
  ].join("\n");
}

async function resourceSnapshot(pool: Pool, groupId: number, userId: number) {
  await ensureStarterFactories(pool, groupId, userId);
  const factories = (await pool.query<any>(
    `SELECT * FROM game_world_resource_factories
     WHERE group_id=$1 AND user_id=$2 AND active=TRUE
     ORDER BY factory_id`,
    [groupId, userId],
  )).rows;

  const inventory = (await pool.query<any>(
    `SELECT resource_code,amount FROM game_world_resource_inventory
     WHERE group_id=$1 AND user_id=$2`,
    [groupId, userId],
  )).rows;

  const inventoryMap = new Map<string, number>();
  for (const row of inventory) inventoryMap.set(String(row.resource_code), Number(row.amount));

  const now = Date.now();
  return factories.map((factory) => {
    const interval = Number(factory.interval_seconds);
    const rate = Number(factory.rate_amount);
    const cap = Number(factory.capacity);
    const stored = Number(factory.stored_amount);
    const last = new Date(factory.last_production_at).getTime();
    const cycles = Number.isFinite(last) && last > 0 ? Math.max(0, Math.floor((now - last) / 1000 / interval)) : 0;
    const ready = Math.min(cap, stored + cycles * rate);
    return {
      ...factory,
      definition: resourceByCode(String(factory.resource_code)),
      ready: Math.floor(ready),
      owned: Math.floor(inventoryMap.get(String(factory.resource_code)) ?? 0),
      nextInSeconds: Math.max(0, interval - Math.floor(((now - last) / 1000) % interval)),
    };
  });
}

async function resourcesText(pool: Pool, ctx: WorldContext, page = 0) {
  const factories = await resourceSnapshot(pool, ctx.chatId, ctx.userId);
  const totalPages = Math.max(1, Math.ceil(RESOURCE_CATALOG.length / RESOURCE_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(totalPages - 1, Math.floor(page)));
  const start = safePage * RESOURCE_PAGE_SIZE;
  const visible = RESOURCE_CATALOG.slice(start, start + RESOURCE_PAGE_SIZE);
  const active = new Map(factories.map((x) => [String(x.resource_code), x]));

  const lines = [
    "◈ منابع جهان",
    "",
    WORLD_SEPARATOR,
    "",
    "★ - کارگاه‌ها و منابع فعال",
  ];

  for (const factory of factories) {
    const name = factory.definition?.name ?? String(factory.resource_code);
    const unit = factory.interval_seconds < 60 ? "ثانیه" : "دقیقه";
    const interval = factory.interval_seconds < 60 ? factory.interval_seconds : Math.floor(factory.interval_seconds / 60);
    lines.push("⛂ - " + name + " | سطح " + fa(Number(factory.level)) + " | " + fa(factory.rateAmount ?? factory.rate_amount) + " / " + fa(interval) + " " + unit);
    lines.push("⛂ - آماده برداشت : " + fa(factory.ready) + " | انبار : " + fa(factory.owned));
  }

  lines.push("");
  lines.push(WORLD_SEPARATOR);
  lines.push("");
  lines.push("⛂ - منابع شناخته‌شده : " + fa(RESOURCE_CATALOG.length));
  lines.push("⛂ - صفحه : " + fa(safePage + 1) + " / " + fa(totalPages));
  lines.push("");

  for (const resource of visible) {
    const factory = active.get(resource.code);
    lines.push(
      "⛂ - " + resource.name + " : " +
      (factory ? "محل تولید فعال" : "محل تولید هنوز ساخته نشده"),
    );
  }

  lines.push("");
  lines.push(WORLD_SEPARATOR);
  lines.push("");
  lines.push("برای منبع فعال، روی همان مورد بزن تا سهم تولیدش را همان لحظه برداشت کنی.");
  return lines.join("\n");
}

async function claimFactory(pool: Pool, groupId: number, userId: number, resourceCode: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const factory = (await client.query<any>(
      `SELECT * FROM game_world_resource_factories
       WHERE group_id=$1 AND user_id=$2 AND resource_code=$3 AND active=TRUE
       FOR UPDATE`,
      [groupId, userId, resourceCode],
    )).rows[0];

    if (!factory) {
      await client.query("ROLLBACK");
      return { amount: 0, resource: resourceByCode(resourceCode), active: false };
    }

    const now = Date.now();
    const last = new Date(factory.last_production_at).getTime();
    const interval = Number(factory.interval_seconds);
    const rate = Number(factory.rate_amount);
    const capacity = Number(factory.capacity);
    const stored = Number(factory.stored_amount);
    const elapsedSeconds = Math.max(0, Math.floor((now - last) / 1000));
    const cycles = Math.floor(elapsedSeconds / interval);
    const produced = cycles * rate;
    const ready = Math.min(capacity, stored + produced);
    const amount = Math.floor(ready);

    await client.query(
      `UPDATE game_world_resource_factories
       SET stored_amount=0,last_production_at=NOW()
       WHERE factory_id=$1`,
      [factory.factory_id],
    );

    if (amount > 0) {
      await client.query(
        `INSERT INTO game_world_resource_inventory(group_id,user_id,resource_code,amount)
         VALUES($1,$2,$3,$4)
         ON CONFLICT(group_id,user_id,resource_code)
         DO UPDATE SET amount=game_world_resource_inventory.amount+EXCLUDED.amount,updated_at=NOW()`,
        [groupId, userId, resourceCode, amount],
      );
    }

    await client.query("COMMIT");
    return { amount, resource: resourceByCode(resourceCode), active: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function claimAllFactories(pool: Pool, groupId: number, userId: number) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const factories = (await client.query<any>(
      `SELECT * FROM game_world_resource_factories
       WHERE group_id=$1 AND user_id=$2 AND active=TRUE
       FOR UPDATE`,
      [groupId, userId],
    )).rows;

    const claimed: Array<{ code: string; name: string; amount: number }> = [];
    const now = Date.now();

    for (const factory of factories) {
      const last = new Date(factory.last_production_at).getTime();
      const interval = Number(factory.interval_seconds);
      const rate = Number(factory.rate_amount);
      const capacity = Number(factory.capacity);
      const stored = Number(factory.stored_amount);
      const elapsedSeconds = Math.max(0, Math.floor((now - last) / 1000));
      const cycles = Math.floor(elapsedSeconds / interval);
      const amount = Math.floor(Math.min(capacity, stored + cycles * rate));

      await client.query(
        "UPDATE game_world_resource_factories SET stored_amount=0,last_production_at=NOW() WHERE factory_id=$1",
        [factory.factory_id],
      );

      if (amount > 0) {
        const resource = resourceByCode(String(factory.resource_code));
        await client.query(
          `INSERT INTO game_world_resource_inventory(group_id,user_id,resource_code,amount)
           VALUES($1,$2,$3,$4)
           ON CONFLICT(group_id,user_id,resource_code)
           DO UPDATE SET amount=game_world_resource_inventory.amount+EXCLUDED.amount,updated_at=NOW()`,
          [groupId, userId, String(factory.resource_code), amount],
        );
        claimed.push({
          code: String(factory.resource_code),
          name: resource?.name ?? String(factory.resource_code),
          amount,
        });
      }
    }

    await client.query("COMMIT");
    return claimed;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function claimText(user: WorldUser, claimed: Array<{ name: string; amount: number }>) {
  const lines = [
    "◈ برداشت منابع",
    "",
    WORLD_SEPARATOR,
    "",
    "★ - " + mentionHtml(user),
    "",
  ];

  if (!claimed.length) {
    lines.push("⛂ - فعلاً منبع آماده برداشتی نداری.");
  } else {
    lines.push("★ - منابعی که همین الان گرفتی :");
    for (const item of claimed) {
      lines.push("⛂ - " + escapeHtml(item.name) + " : +" + fa(item.amount));
    }
    lines.push("");
    lines.push("منابع به انبار اکانتت اضافه شدند.");
  }

  lines.push("");
  lines.push(WORLD_SEPARATOR);
  return lines.join("\n");
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

  await ensureSettlement(ctx.pool, ctx.chatId, ctx.chatTitle);
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

  await ensureStarterFactories(ctx.pool, ctx.chatId, ctx.userId);
  await ensurePersonalAssets(ctx.pool, ctx.chatId, ctx.userId);

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

  const action = parts[1];
  const callbackUserId = action === "gender" ? Number(parts[2]) : Number(parts[parts.length - 1]);

  if (!Number.isSafeInteger(callbackUserId) || callbackUserId !== ctx.userId) {
    return { text: unauthorizedText(), replyMarkup: backKeyboard(ctx.userId) };
  }

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
      await ensureStarterFactories(ctx.pool, ctx.chatId, ctx.userId);
      await ensurePersonalAssets(ctx.pool, ctx.chatId, ctx.userId);
      await ensureSettlement(ctx.pool, ctx.chatId, ctx.chatTitle);
      return {
        text: (await centerText(ctx.pool, ctx, account)) ?? registrationText(ctx.user),
        replyMarkup: mainKeyboard(ctx.userId),
      };
    }

    await ensureStarterFactories(ctx.pool, ctx.chatId, ctx.userId);
    await ensurePersonalAssets(ctx.pool, ctx.chatId, ctx.userId);
    await ensureSettlement(ctx.pool, ctx.chatId, ctx.chatTitle);
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

  if (action === "resources") {
    const account = await getAccount(ctx.pool, ctx.chatId, ctx.userId);
    if (!account) return { text: registrationText(ctx.user), replyMarkup: registrationKeyboard(ctx.userId) };
    if (account.status !== "active") return { text: inactiveText(), replyMarkup: backKeyboard(ctx.userId) };
    const page = Number(parts[2] ?? 0);
    return {
      text: await resourcesText(ctx.pool, ctx, Number.isFinite(page) ? page : 0),
      replyMarkup: resourcesKeyboard(ctx.userId, Number.isFinite(page) ? page : 0),
    };
  }

  if (action === "resource") {
    const resourceCode = String(parts[2] ?? "");
    const resource = resourceByCode(resourceCode);
    if (!resource) return { text: "✗ این منبع شناخته‌شده نیست.", replyMarkup: backKeyboard(ctx.userId) };

    const account = await getAccount(ctx.pool, ctx.chatId, ctx.userId);
    if (!account) return { text: registrationText(ctx.user), replyMarkup: registrationKeyboard(ctx.userId) };
    if (account.status !== "active") return { text: inactiveText(), replyMarkup: backKeyboard(ctx.userId) };

    const result = await claimFactory(ctx.pool, ctx.chatId, ctx.userId, resourceCode);
    if (!result.active) {
      return {
        text: [
          "◈ " + resource.name,
          "",
          WORLD_SEPARATOR,
          "",
          "⛂ - دسته : " + resource.category,
          "⛂ - محل تولید : هنوز ساخته نشده",
          "",
          "این منبع در مرز وجود دارد و بعداً می‌توانی محل استخراج یا تولیدش را راه‌اندازی کنی.",
          "",
          WORLD_SEPARATOR,
        ].join("\n"),
        replyMarkup: backKeyboard(ctx.userId),
      };
    }

    return {
      text: claimText(ctx.user, [{ name: result.resource?.name ?? resource.name, amount: result.amount }]),
      replyMarkup: {
        inline_keyboard: [
          [{ text: "‹ بازگشت به منابع", callback_data: "world:resources:0:" + String(ctx.userId) }],
          [{ text: "‹ برداشت همه منابع", callback_data: "world:claimall:" + String(ctx.userId) }],
        ],
      },
      parseMode: "HTML",
    };
  }

  if (action === "claimall") {
    const account = await getAccount(ctx.pool, ctx.chatId, ctx.userId);
    if (!account) return { text: registrationText(ctx.user), replyMarkup: registrationKeyboard(ctx.userId) };
    if (account.status !== "active") return { text: inactiveText(), replyMarkup: backKeyboard(ctx.userId) };

    const claimed = await claimAllFactories(ctx.pool, ctx.chatId, ctx.userId);
    return {
      text: claimText(ctx.user, claimed),
      replyMarkup: {
        inline_keyboard: [
          [{ text: "‹ بازگشت به منابع", callback_data: "world:resources:0:" + String(ctx.userId) }],
          [{ text: "‹ بازگشت به جهان", callback_data: "world:home:" + String(ctx.userId) }],
        ],
      },
      parseMode: "HTML",
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

    if (section === "city") {
      return {
        text: (await cityText(ctx.pool, ctx)) ?? registrationText(ctx.user),
        replyMarkup: backKeyboard(ctx.userId),
      };
    }

    if (section === "assets") {
      return {
        text: (await personalAssetsText(ctx.pool, ctx)) ?? registrationText(ctx.user),
        replyMarkup: backKeyboard(ctx.userId),
      };
    }

    if (section === "resources") {
      return {
        text: await resourcesText(ctx.pool, ctx, 0),
        replyMarkup: resourcesKeyboard(ctx.userId, 0),
      };
    }

    return {
      text: sectionText(section, account),
      replyMarkup: backKeyboard(ctx.userId),
    };
  }

  return null;
}
