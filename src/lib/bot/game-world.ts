import type { Pool } from "pg";
import { handleFrontierExpansionText, handleFrontierExpansionCallback, ensureFrontierExpansionSchema, recordEconomy } from "./frontier-expansion.ts";

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
  await ensureFrontierExpansionSchema(pool);
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
      [{ text: "‹ آشنایی با بازی", callback_data: "world:hub:guide:" + s }],
      [{ text: "‹ شخصیت و زندگی", callback_data: "world:hub:character:" + s }],
      [{ text: "‹ اقتصاد و کسب‌وکار", callback_data: "world:hub:economy:" + s }],
      [{ text: "‹ زمین و تولید", callback_data: "world:hub:production:" + s }],
      [{ text: "‹ شهر و سفر", callback_data: "world:hub:city:" + s }],
      [{ text: "‹ قانون و ماجرا", callback_data: "world:hub:adventure:" + s }],
      [{ text: "‹ روابط و اجتماع", callback_data: "world:hub:social:" + s }],
      [{ text: "‹ اخبار و مجموعه", callback_data: "world:hub:world:" + s }],
      [{ text: "‹ تنظیمات", callback_data: "world:hub:settings:" + s }],
    ],
  };
}

function hubKeyboard(userId:number,hub:string){
  const s=String(userId);
  const map:Record<string,string[][]>={
    guide:[["‹ ثبت و هویت","world:section:profile:" + s],["‹ وضعیت زندگی","world:section:life:" + s],["‹ راهنمای بخش‌ها","world:section:help:" + s]],
    character:[["‹ پروفایل","world:section:profile:" + s],["‹ زندگی شخصی","world:section:life:" + s],["‹ ملک و دارایی","world:section:assets:" + s],["‹ مزرعه و اسب","world:expand:farm:" + s]],
    economy:[["‹ بانک و پول","world:expand:bank:" + s],["‹ دفتر درآمد","world:expand:economy:" + s],["‹ بازار مرزی","world:section:market:" + s],["‹ کسب‌وکار","world:expand:business:" + s],["‹ کار و حرفه","world:section:job:" + s]],
    production:[["‹ منابع و استخراج","world:section:resources:" + s],["‹ انبار و ابزار","world:expand:tools:" + s],["‹ مزرعه و دامداری","world:expand:farm:" + s],["‹ حرفه و مهارت","world:expand:profession:" + s]],
    city:[["‹ شهرها","world:section:city:" + s],["‹ نقشه و سفر","world:expand:map:" + s],["‹ حمل‌ونقل","world:expand:transport:" + s],["‹ قراردادهای شهر","world:expand:missions:" + s]],
    adventure:[["‹ ماجرا","world:section:adventure:" + s],["‹ مأموریت‌ها","world:section:missions:" + s],["‹ قانون و شهرت","world:expand:law:" + s],["‹ رویدادهای مرزی","world:section:events:" + s],["‹ سالون","world:section:games:" + s]],
    social:[["‹ باند و روابط","world:expand:band:" + s],["‹ رتبه‌بندی","world:section:ranking:" + s],["‹ قراردادها","world:expand:missions:" + s],["‹ شهر و اهالی","world:section:city:" + s]],
    world:[["‹ اخبار","world:section:news:" + s],["‹ روزنامه مرزی","world:expand:newspaper:" + s],["‹ رویدادهای مرزی","world:section:events:" + s],["‹ مجموعه","world:section:collection:" + s]],
    settings:[["‹ تنظیمات اکانت","world:section:settings:" + s],["‹ راهنما","world:section:help:" + s]],
  };
  const rows=(map[hub]??map.guide).map(([text,callback_data])=>[{text,callback_data}]);
  rows.push([{text:"‹ بازگشت به جهان",callback_data:"world:home:"+s}]);
  return {inline_keyboard:rows};
}

function hubText(hub:string,woman:boolean){
  const common:Record<string,string>={
    guide:"اینجا نقطه شروع توست. هویتت را ثبت کن، زندگی‌ات را بساز و بعد سراغ پول، کار و جاده برو.",
    character:"این بخش مربوط به خود توست؛ نام، وضعیت زندگی، خانه، زمین و دارایی‌هایی که کم‌کم به دست می‌آوری.",
    economy:"اینجا پول مرز حرکت می‌کند؛ درآمد می‌سازی، خرج می‌کنی، معامله می‌کنی و کسب‌وکارت را بزرگ می‌کنی.",
    production:"هر چیزی که می‌فروشی یا مصرف می‌کنی از جایی می‌آید؛ مزرعه، معدن، منابع، ابزار و مهارت اینجا به هم می‌رسند.",
    city:"مرز فقط روستا نیست. شهرها، جاده‌ها و وسیله‌های حمل‌ونقل راه تو را به قلمروهای دیگر باز می‌کنند.",
    adventure:"اینجا بخش آرام مرز تمام می‌شود؛ مأموریت، قانون، شهرت، رویداد و سالون می‌توانند مسیرت را عوض کنند.",
    social:"هیچ آدمی در مرز تنها بزرگ نمی‌شود؛ باند، قرارداد، اهالی و رتبه‌ات جای تو را میان دیگران مشخص می‌کنند.",
    world:"اتفاقات مرز می‌مانند. خبر، روزنامه، رویداد و چیزهایی که جمع کرده‌ای تاریخ زندگی تو را می‌سازند.",
    settings:"انتخاب‌های شخصی و تنظیمات اکانتت از اینجا مدیریت می‌شوند.",
  };
  const women:Record<string,string>={
    guide:"این بخش نقشه راه توست؛ اول هویتت را ثبت کن و بعد با خیال راحت سراغ زندگی، حرفه و اقتصاد برو.",
    character:"خانه، زمین، سلامت، مزرعه و دارایی‌های شخصی تو در این بخش دنبال می‌شوند؛ زندگی مرزی را به سبک خودت بساز.",
    economy:"پول فقط برای خرج‌کردن نیست؛ درآمد، پس‌انداز، معامله و کسب‌وکار پایه استقلال مالی تو در مرز است.",
    production:"از زمین و مزرعه تا ابزار و مهارت؛ اینجا چیزهایی ساخته می‌شوند که بعداً می‌توانند وارد بازار و کار حرفه‌ای تو شوند.",
    city:"شهرها فرصت‌های تازه دارند؛ سفر، حمل‌ونقل و ارتباط با شهرهای دیگر مسیرهای بیشتری جلوی پایت می‌گذارند.",
    adventure:"مأموریت، شهرت، قانون و رویدادهای مرز همیشه خشن نیستند؛ انتخاب درست می‌تواند مسیر حرفه‌ای و اجتماعی تو را بهتر کند.",
    social:"روابط، باندها و جایگاه اجتماعی بخشی از زندگی تو هستند؛ نامت در مرز با رفتار و همکاری‌ات شناخته می‌شود.",
    world:"اخبار، روزنامه و مجموعه، ردپای زندگی تو را در مرز نگه می‌دارند؛ چیزی که امروز کوچک است، شاید فردا خبر شود.",
    settings:"تنظیمات شخصی و شیوه مدیریت اکانتت را از اینجا کنترل کن.",
  };
  const title:Record<string,string>={
    guide:"◈ آشنایی با بازی",
    character:"◈ شخصیت و زندگی",
    economy:"◈ اقتصاد و کسب‌وکار",
    production:"◈ زمین و تولید",
    city:"◈ شهر و سفر",
    adventure:"◈ قانون و ماجرا",
    social:"◈ روابط و اجتماع",
    world:"◈ اخبار و مجموعه",
    settings:"◈ تنظیمات",
  };
  return [
    title[hub]??title.guide,
    "",
    WORLD_SEPARATOR,
    "",
    common[hub]??common.guide,
    "",
    woman && women[hub] ? women[hub] : "",
    woman && women[hub] ? "" : null,
    "★ - از گزینه‌های زیر وارد بخش موردنظر شو.",
    "",
    WORLD_SEPARATOR,
  ].filter(x=>x!==null).join("\n");
}

function newsKeyboard(userId: number) {
  const s=String(userId);
  return {
    inline_keyboard:[
      [
        { text:"‹ اخبار محلی",callback_data:"world:news:local:"+s },
        { text:"‹ اخبار جهانی",callback_data:"world:news:global:"+s }
      ],
      [{ text:"‹ بازگشت به جهان",callback_data:"world:home:"+s }]
    ]
  };
}

function marketKeyboard(userId: number) {
  const s=String(userId);
  return {
    inline_keyboard:[
      [{ text:"‹ فروش کالا",callback_data:"world:market:sell:"+s }],
      [
        { text:"‹ بازار روستا",callback_data:"world:market:local:"+s },
        { text:"‹ فروش‌های من",callback_data:"world:market:mine:"+s }
      ],
      [{ text:"‹ راهنمای بازار",callback_data:"world:market:help:"+s }],
      [{ text:"‹ بازگشت به جهان",callback_data:"world:home:"+s }]
    ]
  };
}

function marketBuyKeyboard(userId:number,listingId:number,available:number){
  const s=String(userId);
  const qty=Math.max(1,Math.floor(available));
  const rows:any[]=[[{text:"‹ خرید ۱",callback_data:"world:market:buyqty:"+listingId+":1:"+s}]];
  if(qty>=5) rows[0].push({text:"‹ خرید ۵",callback_data:"world:market:buyqty:"+listingId+":5:"+s});
  rows.push([{text:"‹ خرید همه · "+qty,callback_data:"world:market:buyqty:"+listingId+":"+qty+":"+s}]);
  rows.push([{text:"‹ بازگشت به بازار",callback_data:"world:market:local:"+s}]);
  return {inline_keyboard:rows};
}

function marketLocalKeyboard(userId:number,rows:Array<{listing_id:number;amount:number}>){
  const s=String(userId);
  const kb:any[]=[];
  for(const row of rows){
    kb.push([{text:"‹ آگهی #"+fa(Number(row.listing_id))+" · خرید",callback_data:"world:market:buy:"+Number(row.listing_id)+":"+s}]);
  }
  kb.push([{text:"‹ فروش کالا",callback_data:"world:market:sell:"+s},{text:"‹ فروش‌های من",callback_data:"world:market:mine:"+s}]);
  kb.push([{text:"‹ راهنمای بازار",callback_data:"world:market:help:"+s}]);
  kb.push([{text:"‹ بازگشت به جهان",callback_data:"world:home:"+s}]);
  return {inline_keyboard:kb};
}

function cityOverviewKeyboard(userId:number,cities:Array<{settlement_id:number;name:string}>,canPromote:boolean) {
  const s=String(userId);
  const rows:Array<Array<{text:string;callback_data:string}>>=[];
  for(const city of cities){
    rows.push([{text:"‹ "+String(city.name),callback_data:"world:city:"+String(city.settlement_id)+":"+s}]);
  }
  rows.push([{text:"‹ اخبار محلی",callback_data:"world:news:local:"+s},{text:"‹ اخبار جهانی",callback_data:"world:news:global:"+s}]);
  rows.push([{text:"‹ بازار روستا",callback_data:"world:market:local:"+s}]);
  if(canPromote) rows.push([{text:"‹ ثبت این روستا به‌عنوان شهر",callback_data:"world:promotecity:"+s}]);
  rows.push([{text:"‹ بازگشت به جهان",callback_data:"world:home:"+s}]);
  return {inline_keyboard:rows};
}

function cityDetailKeyboard(userId:number,settlementId:number) {
  const s=String(userId);
  return {inline_keyboard:[
    [{text:"‹ بازار",callback_data:"world:citymarket:"+settlementId+":"+s},{text:"‹ بانک",callback_data:"world:citybank:"+settlementId+":"+s}],
    [{text:"‹ سالون",callback_data:"world:citysaloon:"+settlementId+":"+s},{text:"‹ معدن",callback_data:"world:citymine:"+settlementId+":"+s}],
    [{text:"‹ مشاغل شهر",callback_data:"world:cityjobs:"+settlementId+":"+s},{text:"‹ قوانین",callback_data:"world:citylaws:"+settlementId+":"+s}],
    [{text:"‹ شروع سفر",callback_data:"world:travel:"+settlementId+":"+s}],
    [{text:"‹ بازگشت",callback_data:"world:section:city:"+s}]
  ]};
}

async function ensureNewsSeed(pool:Pool,groupId:number,settlementName:string) {
  const local=await pool.query<any>("SELECT news_id FROM game_world_news WHERE scope='local' AND group_id=$1 LIMIT 1",[groupId]);
  if(!local.rows.length){
    await pool.query("INSERT INTO game_world_news(scope,group_id,title,body,severity) VALUES('local',$1,$2,$3,'info')",
      [groupId,"خبر تازه "+settlementName,"روستا آرام است؛ اما مرز برای مدت زیادی آرام نمی‌ماند."]);
  }
  const global=await pool.query<any>("SELECT news_id FROM game_world_news WHERE scope='global' LIMIT 1");
  if(!global.rows.length){
    await pool.query("INSERT INTO game_world_news(scope,title,body,severity) VALUES('global',$1,$2,'notice')",
      ["خبر مرز","مسیرهای تجاری دوباره فعال شده‌اند و بازارهای مرزی کم‌کم واکنش نشان می‌دهند."]);
  }
}





function normalizeResourceInput(value:string) {
  const n=norm(value);
  return RESOURCE_CATALOG.find(x=>norm(x.code)===n||norm(x.name)===n)??null;
}

async function newsText(pool:Pool,ctx:WorldContext,scope:"local"|"global") {
  const settlement=await ensureSettlement(pool,ctx.chatId,ctx.chatTitle);
  await ensureNewsSeed(pool,ctx.chatId,String(settlement.name));
  const rows=scope==="local"
    ? (await pool.query<any>("SELECT * FROM game_world_news WHERE scope='local' AND group_id=$1 AND (expires_at IS NULL OR expires_at>NOW()) ORDER BY created_at DESC LIMIT 12",[ctx.chatId])).rows
    : (await pool.query<any>("SELECT * FROM game_world_news WHERE scope='global' AND (expires_at IS NULL OR expires_at>NOW()) ORDER BY created_at DESC LIMIT 12")).rows;
  const lines=["◈ "+(scope==="local"?"اخبار محلی":"اخبار جهان"),"",WORLD_SEPARATOR,""];
  if(!rows.length) lines.push("⛂ - فعلاً خبری ثبت نشده است.");
  for(const row of rows){
    lines.push("★ - "+String(row.title));
    lines.push("⛂ - "+String(row.body));
    lines.push("");
  }
  lines.push(westernLine("news"),"",WORLD_SEPARATOR);
  return lines.join("\n");
}

async function marketSellText(pool:Pool,ctx:WorldContext) {
  const rows=(await pool.query<any>(
    "SELECT resource_code, amount FROM game_world_resource_inventory WHERE group_id=$1 AND user_id=$2 AND amount>0 ORDER BY resource_code ASC",
    [ctx.chatId,ctx.userId],
  )).rows;
  const lines=[
    "◈ فروش کالا",
    "",
    WORLD_SEPARATOR,
    "",
    "★ - موجودی قابل فروش",
    "",
  ];
  if(!rows.length){
    lines.push("⛂ - فعلاً کالایی در انبارت برای فروش وجود ندارد.");
    lines.push("");
    lines.push("ابتدا منابع تولیدشده را برداشت کن.");
  } else {
    for(const row of rows){
      const resource=resourceByCode(String(row.resource_code));
      lines.push("⛂ - "+(resource?.name??String(row.resource_code))+" : "+fa(Number(row.amount)));
    }
    lines.push("");
    lines.push("★ - ثبت آگهی");
    lines.push("نام کالا، تعداد و قیمت واحد را مشخص کن.");
    lines.push("فرمت : فروش <نام کالا> <تعداد> <قیمت واحد>");
    lines.push("نمونه : فروش چوب جنگلی 10 8");
  }
  lines.push("",westernLine("market"),"",WORLD_SEPARATOR);
  return lines.join("\n");
}

function marketSellKeyboard(userId:number,rows:Array<{resource_code:string;amount:number}>){
  const s=String(userId);
  const kb:any[]=[];
  for(const row of rows){
    const resource=resourceByCode(String(row.resource_code));
    kb.push([{text:"‹ "+(resource?.name??String(row.resource_code))+" · "+fa(Number(row.amount)),callback_data:"world:market:sellitem:"+String(row.resource_code)+":"+s}]);
  }
  kb.push([{text:"‹ راهنمای ثبت آگهی",callback_data:"world:market:help:"+s}]);
  kb.push([{text:"‹ بازگشت",callback_data:"world:market:local:"+s}]);
  return {inline_keyboard:kb};
}

async function marketSellItemText(pool:Pool,ctx:WorldContext,resourceCode:string){
  const resource=resourceByCode(resourceCode);
  if(!resource)return {text:"✗ این کالا شناخته‌شده نیست.",replyMarkup:marketKeyboard(ctx.userId)};
  const row=(await pool.query<any>(
    "SELECT amount FROM game_world_resource_inventory WHERE group_id=$1 AND user_id=$2 AND resource_code=$3 LIMIT 1",
    [ctx.chatId,ctx.userId,resourceCode],
  )).rows[0];
  const amount=Math.floor(Number(row?.amount??0));
  if(amount<=0)return {text:"« از این کالا چیزی برای فروش در انبارت نیست.»",replyMarkup:marketKeyboard(ctx.userId)};
  return {
    text:[
      "◈ ثبت آگهی فروش",
      "",
      WORLD_SEPARATOR,
      "",
      "★ - کالا : "+resource.name,
      "⛂ - موجودی : "+fa(amount),
      "",
      "حالا مقدار و قیمت واحد را مشخص کن.",
      "فرمت : فروش "+resource.name+" <تعداد> <قیمت واحد>",
      "نمونه : فروش "+resource.name+" 10 8",
      "",
      "برای ثبت نهایی، همین دستور را در چت بفرست.",
      "",
      westernLine("market"),
      "",
      WORLD_SEPARATOR
    ].join("\n"),
    replyMarkup:marketKeyboard(ctx.userId)
  };
}

async function marketText(pool:Pool,ctx:WorldContext,mode:"local"|"mine"|"help") {
  if(mode==="help"){
    return [
      "◈ راهنمای بازار",
      "",
      WORLD_SEPARATOR,
      "",
      "★ - فروش کالا",
      "فرمت : فروش <نام کالا> <تعداد> <قیمت واحد>",
      "نمونه : فروش چوب جنگلی 10 8",
      "",
      "★ - خرید کالا",
      "فرمت : خرید <شناسه آگهی> <تعداد>",
      "یا از داخل بازار، روی «خرید» بزن.",
      "",
      "★ - معامله",
      "خریدار سکه را می‌پردازد و کالا مستقیم وارد انبارش می‌شود.",
      "فروشنده همان لحظه سکه معامله را دریافت می‌کند.",
      "",
      "★ - قانون بازار",
      "خرید از خود، موجودی ناکافی و آگهی منقضی‌شده مجاز نیست.",
      "",
      westernLine("market"),
      "",
      WORLD_SEPARATOR
    ].join("\n");
  }

  const where=mode==="mine"
    ? "group_id=$1 AND seller_user_id=$2"
    : "group_id=$1 AND status='active' AND expires_at>NOW() AND amount>0";
  const params=mode==="mine"?[ctx.chatId,ctx.userId]:[ctx.chatId];
  const rows=(await pool.query<any>(
    "SELECT * FROM game_world_market_listings WHERE "+where+" ORDER BY created_at DESC LIMIT 20",
    params,
  )).rows;
  const lines=["◈ "+(mode==="mine"?"فروش‌های من":"بازار روستا"),"",WORLD_SEPARATOR,""];
  if(!rows.length)lines.push("⛂ - فعلاً آگهی فعالی وجود ندارد.");
  for(const row of rows){
    const resource=resourceByCode(String(row.resource_code));
    lines.push("★ - آگهی #"+fa(Number(row.listing_id)));
    lines.push("⛂ - کالا : "+(resource?.name??String(row.resource_code)));
    lines.push("⛂ - مقدار : "+fa(Number(row.amount)));
    lines.push("⛂ - قیمت هر واحد : "+fa(Number(row.unit_price))+" سکه");
    lines.push("⛂ - فروشنده : "+fa(Number(row.seller_user_id)));
    if(mode==="local")lines.push("‹ برای خرید، آگهی را از دکمه‌های زیر انتخاب کن.");
    lines.push("");
  }
  lines.push(westernLine("market"),"",WORLD_SEPARATOR);
  return lines.join("\n");
}

async function createMarketListingFromText(pool:Pool,ctx:WorldContext,rawText:string) {
  const parts=rawText.trim().replace(/^[\\/!.]+/,"").split(/\s+/);
  if(parts.length<4||!["فروش","sell"].includes(norm(parts[0])))return null;
  const amount=Number(parts[parts.length-2]);
  const unitPrice=Number(parts[parts.length-1]);
  const itemName=parts.slice(1,-2).join(" ").trim();
  if(!itemName||!Number.isSafeInteger(amount)||amount<=0||!Number.isSafeInteger(unitPrice)||unitPrice<0){
    return {text:["◈ بازار","",WORLD_SEPARATOR,"","⛂ - فرمت درست : فروش <نام کالا> <تعداد> <قیمت واحد>","⛂ - نمونه : فروش چوب جنگلی 10 8"].join("\n"),replyMarkup:marketKeyboard(ctx.userId)};
  }
  const resource=normalizeResourceInput(itemName);
  if(!resource)return {text:"« این کالا در فهرست منابع شناخته‌شده نیست.»",replyMarkup:marketKeyboard(ctx.userId)};

  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const inv=(await client.query<any>("SELECT amount FROM game_world_resource_inventory WHERE group_id=$1 AND user_id=$2 AND resource_code=$3 FOR UPDATE",[ctx.chatId,ctx.userId,resource.code])).rows[0];
    const owned=Math.floor(Number(inv?.amount??0));
    if(owned<amount){
      await client.query("ROLLBACK");
      return {text:"« موجودی کافی نیست. ابتدا سهم تولید را برداشت کن.»",replyMarkup:marketKeyboard(ctx.userId)};
    }
    await client.query("UPDATE game_world_resource_inventory SET amount=amount-$4,updated_at=NOW() WHERE group_id=$1 AND user_id=$2 AND resource_code=$3",[ctx.chatId,ctx.userId,resource.code,amount]);
    const listing=(await client.query<any>("INSERT INTO game_world_market_listings(group_id,seller_user_id,resource_code,amount,min_purchase,unit_price) VALUES($1,$2,$3,$4,1,$5) RETURNING listing_id",[ctx.chatId,ctx.userId,resource.code,amount,unitPrice])).rows[0];
    await client.query("INSERT INTO game_world_news(scope,group_id,title,body,severity) VALUES('local',$1,$2,$3,'notice')",[ctx.chatId,"کالای تازه در بازار","آگهی #"+Number(listing.listing_id)+" برای "+resource.name+" ثبت شد."]);
    await client.query("COMMIT");
    return {text:["◈ آگهی ثبت شد","",WORLD_SEPARATOR,"","★ - "+mentionHtml(ctx.user),"⛂ - شناسه آگهی : #"+fa(Number(listing.listing_id)),"⛂ - کالا : "+resource.name,"⛂ - مقدار : "+fa(amount),"⛂ - قیمت واحد : "+fa(unitPrice)+" سکه","","« کالا در بازار قرار گرفت؛ قیمت را خودت تعیین کردی.»","",WORLD_SEPARATOR].join("\n"),replyMarkup:marketKeyboard(ctx.userId),parseMode:"HTML" as const};
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}
  finally{client.release();}
}

async function buyMarketListingFromText(pool:Pool,ctx:WorldContext,rawText:string) {
  const parts=rawText.trim().replace(/^[\\/!.]+/,"").split(/\s+/);
  if(parts.length<3||!["خرید","buy"].includes(norm(parts[0])))return null;
  const listingId=Number(parts[1]),qty=Number(parts[2]);
  if(!Number.isSafeInteger(listingId)||!Number.isSafeInteger(qty)||qty<=0)return {text:"« فرمت درست : خرید <شناسه آگهی> <تعداد> »",replyMarkup:marketKeyboard(ctx.userId)};
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const listing=(await client.query<any>("SELECT * FROM game_world_market_listings WHERE listing_id=$1 AND group_id=$2 AND status='active' AND expires_at>NOW() FOR UPDATE",[listingId,ctx.chatId])).rows[0];
    if(!listing){await client.query("ROLLBACK");return {text:"« این آگهی دیگر فعال نیست.»",replyMarkup:marketKeyboard(ctx.userId)};}
    if(Number(listing.seller_user_id)===ctx.userId){await client.query("ROLLBACK");return {text:"« خرید از خودت معامله نیست.»",replyMarkup:marketKeyboard(ctx.userId)};}
    if(qty<Number(listing.min_purchase)||qty>Math.floor(Number(listing.amount))){await client.query("ROLLBACK");return {text:"« مقدار خرید با این آگهی سازگار نیست.»",replyMarkup:marketKeyboard(ctx.userId)};}
    const total=qty*Number(listing.unit_price);
    const buyer=(await client.query<any>("SELECT * FROM game_world_accounts WHERE group_id=$1 AND user_id=$2 FOR UPDATE",[ctx.chatId,ctx.userId])).rows[0];
    const seller=(await client.query<any>("SELECT * FROM game_world_accounts WHERE group_id=$1 AND user_id=$2 FOR UPDATE",[ctx.chatId,Number(listing.seller_user_id)])).rows[0];
    if(!buyer||!seller||Number(buyer.coins)<total){await client.query("ROLLBACK");return {text:"« موجودی سکه برای این معامله کافی نیست.»",replyMarkup:marketKeyboard(ctx.userId)};}
    await client.query("UPDATE game_world_accounts SET coins=coins-$3 WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,total]);
    await client.query("UPDATE game_world_accounts SET coins=coins+$3 WHERE group_id=$1 AND user_id=$2",[ctx.chatId,Number(listing.seller_user_id),total]);
    await client.query("INSERT INTO game_world_resource_inventory(group_id,user_id,resource_code,amount) VALUES($1,$2,$3,$4) ON CONFLICT(group_id,user_id,resource_code) DO UPDATE SET amount=game_world_resource_inventory.amount+EXCLUDED.amount,updated_at=NOW()",[ctx.chatId,ctx.userId,String(listing.resource_code),qty]);
    const remaining=Math.floor(Number(listing.amount)-qty);
    await client.query("UPDATE game_world_market_listings SET amount=$2,status=$3 WHERE listing_id=$1",[listingId,remaining,remaining<=0?"sold":"active"]);
    await client.query("INSERT INTO game_world_news(scope,group_id,title,body,severity) VALUES('local',$1,$2,$3,'notice')",[ctx.chatId,"معامله جدید در بازار","آگهی #"+listingId+" با مبلغ "+total+" سکه معامله شد."]);
    await client.query("COMMIT");
    await recordEconomy(ctx.pool,ctx.chatId,ctx.userId,"expense",total,"خرید از بازار","#"+listingId);
    await recordEconomy(ctx.pool,ctx.chatId,Number(listing.seller_user_id),"income",total,"فروش در بازار","#"+listingId);
    return {text:["◈ معامله انجام شد","",WORLD_SEPARATOR,"","★ - خریدار : "+mentionHtml(ctx.user),"⛂ - کالا : "+(resourceByCode(String(listing.resource_code))?.name??String(listing.resource_code)),"⛂ - مقدار : "+fa(qty),"⛂ - مبلغ : "+fa(total)+" سکه","","« معامله ثبت شد و کالا به انبارت اضافه شد.»","",WORLD_SEPARATOR].join("\n"),replyMarkup:marketKeyboard(ctx.userId),parseMode:"HTML" as const};
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}
  finally{client.release();}
}

function registrationText(user: WorldUser) {
  return [
    "◈ Pᴇʀsɪᴀɴ Wᴏʀʟᴅ · Fʀᴏɴᴛɪᴇʀ",
    "",
    WORLD_SEPARATOR,
    "",
    "شهر هنوز نامت را نمی‌شناسد.",
    "برای شروع زندگی در این سرزمین، باید هویتت را ثبت کنی.",
    "",
    "این شهر برای تازه‌واردها جای راحتی نیست.",
    "از صفر شروع می‌کنی؛ بقیه‌اش با خودت است.",
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
  await ensureNewsSeed(pool, ctx.chatId, String(settlement.name));
  const publicCities = (await pool.query<any>(
    "SELECT * FROM game_world_settlements WHERE is_public=TRUE AND settlement_kind='city' AND group_id<>$1 ORDER BY population_count DESC,settlement_id LIMIT 12",
    [ctx.chatId],
  )).rows;
  const playerCount = Number((await pool.query<any>(
    "SELECT COUNT(*)::int AS count FROM game_world_accounts WHERE group_id=$1 AND status='active'",
    [ctx.chatId],
  )).rows[0]?.count ?? 0);
  const travel = (await pool.query<any>(
    "SELECT t.*,s.name AS destination_name FROM game_world_travels t LEFT JOIN game_world_settlements s ON s.settlement_id=t.to_settlement_id WHERE t.group_id=$1 AND t.user_id=$2 AND t.status='travelling' AND t.arrival_at>NOW() ORDER BY t.arrival_at LIMIT 1",
    [ctx.chatId,ctx.userId],
  )).rows[0];
  const lines = [
    "◈ شهر و سفر",
    "",
    WORLD_SEPARATOR,
    "",
    "★ - روستای خودمان",
    "⛂ - نام : " + String(settlement.name),
    "⛂ - نوع : روستای شخصی",
    "⛂ - جمعیت بازیکنان : " + fa(playerCount),
    "⛂ - زمین‌های شخصی : فعال",
    "⛂ - خانه‌ها : فعال",
    "⛂ - مزرعه‌ها : فعال",
    "⛂ - منابع : فعال",
    "⛂ - کارگاه‌ها : فعال",
    "⛂ - بازارچه : فعال",
    "⛂ - ربات محلی : " + String(settlement.local_bot_name),
    "⛂ - اتفاقات محلی : فعال",
    "",
    WORLD_SEPARATOR,
    "",
    "★ - شهرهای همگانی",
  ];
  if(travel){
    lines.push("⛂ - سفر در جریان : " + String(travel.destination_name ?? "مقصد"));
    lines.push("⛂ - زمان رسیدن : " + new Date(travel.arrival_at).toLocaleString("en-GB",{timeZone:"UTC"}) + " UTC");
    lines.push("⛂ - هزینه پرداخت‌شده : " + fa(Number(travel.cost_coins)) + " سکه");
    lines.push("");
  }
  if(!publicCities.length){
    lines.push("⛂ - هنوز شهر همگانی ثبت نشده است.");
  } else {
    for(const city of publicCities){
      lines.push("⛂ - " + String(city.name) + " | جمعیت " + fa(Number(city.population_count)) + " | بازار " + (city.market_active?"فعال":"بسته") + " | قطار " + (city.train_station_active?"فعال":"بسته"));
    }
  }
  lines.push("",westernLine("city"),"",WORLD_SEPARATOR);
  return lines.join("\n");
}

async function cityDetailText(pool: Pool, ctx: WorldContext, settlementId: number) {
  const city = (await pool.query<any>("SELECT * FROM game_world_settlements WHERE settlement_id=$1 LIMIT 1",[settlementId])).rows[0];
  if(!city) return null;
  return [
    "◈ " + String(city.name),
    "",
    WORLD_SEPARATOR,
    "",
    "★ - " + (city.is_public && city.settlement_kind==="city" ? "شهر بزرگ" : "روستا"),
    "⛂ - جمعیت : " + fa(Number(city.population_count)),
    "⛂ - بازار : " + (city.market_active ? "فعال" : "بسته"),
    "⛂ - بانک : " + (city.bank_active ? "فعال" : "بسته"),
    "⛂ - سالون : " + (city.saloon_active ? "فعال" : "بسته"),
    "⛂ - ایستگاه قطار : " + (city.train_station_active ? "فعال" : "بسته"),
    "⛂ - معدن : " + (city.mine_active ? "فعال" : "بسته"),
    "⛂ - مشاغل شهری : " + (city.jobs_active ? "فعال" : "بسته"),
    "⛂ - ربات شهری : " + String(city.city_bot_name),
    "⛂ - قوانین : " + String(city.laws_profile),
    "",
    "★ - خدمات قلمرو",
    "⛂ - بازار، بانک، سالون، قطار، معدن و مشاغل مستقل هستند.",
    "⛂ - اخبار و اتفاقات شهر در سامانه محلی ثبت می‌شوند.",
    "",
    westernLine("city"),
    "",
    WORLD_SEPARATOR,
  ].join("\n");
}

async function startTravel(pool: Pool, ctx: WorldContext, destinationId: number) {
  const source = await ensureSettlement(pool, ctx.chatId, ctx.chatTitle);
  const destination = (await pool.query<any>(
    "SELECT * FROM game_world_settlements WHERE settlement_id=$1 AND is_public=TRUE AND settlement_kind='city' LIMIT 1",
    [destinationId],
  )).rows[0];
  if(!destination) return {ok:false,text:"« این شهر مقصد در دسترس نیست.»"};
  if(Number(destination.group_id)===ctx.chatId) return {ok:false,text:"« مقصدت همین‌جاست. نیازی به سفر نیست.»"};
  const active = (await pool.query<any>(
    "SELECT travel_id FROM game_world_travels WHERE group_id=$1 AND user_id=$2 AND status='travelling' AND arrival_at>NOW() LIMIT 1",
    [ctx.chatId,ctx.userId],
  )).rows[0];
  if(active) return {ok:false,text:"« هنوز در راهی. سفر بعدی بعد از رسیدن باز می‌شود.»"};
  const account = await getAccount(pool,ctx.chatId,ctx.userId);
  if(!account) return {ok:false,text:registrationText(ctx.user)};
  const distance = Math.max(1,Math.abs(Number(destination.settlement_id)-Number(source.settlement_id))+1);
  const duration = 5 + distance*3;
  const cost = 20 + distance*25;
  if(Number(account.coins)<cost) return {ok:false,text:"« هزینه این مسیر "+fa(cost)+" سکه است؛ موجودی تو کافی نیست.»"};
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const locked=(await client.query<any>("SELECT * FROM game_world_accounts WHERE group_id=$1 AND user_id=$2 FOR UPDATE",[ctx.chatId,ctx.userId])).rows[0];
    if(!locked||Number(locked.coins)<cost){await client.query("ROLLBACK");return {ok:false,text:"« هزینه سفر دیگر کامل نیست.»"};}
    await client.query("UPDATE game_world_accounts SET coins=coins-$3,last_active_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,cost]);
    await client.query("INSERT INTO game_world_travels(group_id,user_id,from_settlement_id,to_settlement_id,arrival_at,cost_coins) VALUES($1,$2,$3,$4,NOW()+($5 || ' minutes')::interval,$6)",[ctx.chatId,ctx.userId,source.settlement_id,destination.settlement_id,duration,cost]);
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}finally{client.release();}
  return {ok:true,text:["◈ آغاز سفر","","",WORLD_SEPARATOR,"","★ - مقصد : "+String(destination.name),"⛂ - مدت سفر : "+fa(duration)+" دقیقه","⛂ - هزینه : "+fa(cost)+" سکه","⛂ - وسیله : اسب و مسیر مرزی","","« راه افتادی. تا رسیدن، مقصد منتظر توست.»","",WORLD_SEPARATOR].join("\n")};
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
  const n=norm(text);
  const auxiliary=n.startsWith("فروش ")||n.startsWith("خرید ")||n.startsWith("sell ")||n.startsWith("buy ");
  if(!isWorldCommand(text)&&!auxiliary)return null;

  try {
    await ensureWorldSchema(ctx.pool);
  } catch (error) {
    console.error("[world] schema error:", error);
    return {
      text: "✗ فعلاً ورود به دنیای پرشین ممکن نشد. دوباره کمی بعد تلاش کن.",
    };
  }

  const settlement=await ensureSettlement(ctx.pool, ctx.chatId, ctx.chatTitle);
  await ctx.pool.query(
    "UPDATE game_world_settlements SET population_count=(SELECT COUNT(*) FROM game_world_accounts WHERE group_id=$1 AND status='active'),updated_at=NOW() WHERE group_id=$1",
    [ctx.chatId],
  );
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

  const frontierExpansion=await handleFrontierExpansionText(ctx,text);
  if(frontierExpansion!==null)return frontierExpansion;

  if(auxiliary){
    const sold=await createMarketListingFromText(ctx.pool,ctx,text);
    if(sold!==null)return sold;
    const bought=await buyMarketListingFromText(ctx.pool,ctx,text);
    if(bought!==null)return bought;
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

  const frontierExpansion=await handleFrontierExpansionCallback(ctx,parts);
  if(frontierExpansion!==null)return frontierExpansion;

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

  if (action === "news") {
    const scope=String(parts[2]??"local")==="global"?"global":"local";
    return {text:await newsText(ctx.pool,ctx,scope),replyMarkup:newsKeyboard(ctx.userId)};
  }

  if (action === "market") {
    const mode=String(parts[2]??"local");
    if(mode==="sell"){
      const rows=(await ctx.pool.query<any>(
        "SELECT resource_code, amount FROM game_world_resource_inventory WHERE group_id=$1 AND user_id=$2 AND amount>0 ORDER BY resource_code ASC",
        [ctx.chatId,ctx.userId],
      )).rows;
      return {
        text:await marketSellText(ctx.pool,ctx),
        replyMarkup:marketSellKeyboard(ctx.userId,rows.map((row:any)=>({resource_code:String(row.resource_code),amount:Number(row.amount)}))),
      };
    }
    if(mode==="sellitem"){
      return await marketSellItemText(ctx.pool,ctx,String(parts[3]??""));
    }
    if(mode==="buy"){
      const listingId=Number(parts[3]??0);
      const row=(await ctx.pool.query<any>(
        "SELECT * FROM game_world_market_listings WHERE listing_id=$1 AND group_id=$2 AND status='active' AND expires_at>NOW() AND amount>0 LIMIT 1",
        [listingId,ctx.chatId],
      )).rows[0];
      if(!row)return {text:"« این آگهی دیگر فعال نیست.»",replyMarkup:marketKeyboard(ctx.userId)};
      const resource=resourceByCode(String(row.resource_code));
      const total=Math.floor(Number(row.amount))*Number(row.unit_price);
      return {text:["◈ خرید از بازار","","WORLD_SEPARATOR","","★ - آگهی #"+fa(listingId),"⛂ - کالا : "+(resource?.name??String(row.resource_code)),"⛂ - موجودی آگهی : "+fa(Number(row.amount)),"⛂ - قیمت واحد : "+fa(Number(row.unit_price))+" سکه","⛂ - ارزش خرید همه : "+fa(total)+" سکه","⛂ - فروشنده : "+fa(Number(row.seller_user_id)),"","یک مقدار را انتخاب کن.","",westernLine("market"),"",WORLD_SEPARATOR].join("\n"),replyMarkup:marketBuyKeyboard(ctx.userId,listingId,Number(row.amount))};
    }
    if(mode==="buyqty"){
      const listingId=Number(parts[3]??0);
      const qty=Number(parts[4]??0);
      const result=await buyMarketListingFromText(ctx.pool,ctx,"خرید "+listingId+" "+qty);
      return {...result,replyMarkup:marketKeyboard(ctx.userId)};
    }
    if(mode==="local"){
      const rows=(await ctx.pool.query<any>("SELECT listing_id,amount FROM game_world_market_listings WHERE group_id=$1 AND status='active' AND expires_at>NOW() AND amount>0 ORDER BY created_at DESC LIMIT 20",[ctx.chatId])).rows;
      return {text:await marketText(ctx.pool,ctx,"local"),replyMarkup:marketLocalKeyboard(ctx.userId,rows)};
    }
    return {text:await marketText(ctx.pool,ctx,mode==="mine"?"mine":"help"),replyMarkup:marketKeyboard(ctx.userId)};
  }

  if (action === "city") {
    const settlementId=Number(parts[2]);
    const detail=await cityDetailText(ctx.pool,ctx,settlementId);
    if(!detail)return {text:"« این شهر پیدا نشد.»",replyMarkup:backKeyboard(ctx.userId)};
    return {text:detail,replyMarkup:cityDetailKeyboard(ctx.userId,settlementId)};
  }

  if (["citymarket","citybank","citysaloon","citymine","cityjobs","citylaws"].includes(action)) {
    const settlementId=Number(parts[2]);
    const detail=await cityDetailText(ctx.pool,ctx,settlementId);
    if(!detail)return {text:"« این شهر پیدا نشد.»",replyMarkup:backKeyboard(ctx.userId)};
    const labels:Record<string,string>={citymarket:"بازار",citybank:"بانک",citysaloon:"سالون",citymine:"معدن",cityjobs:"مشاغل شهر",citylaws:"قوانین شهر"};
    return {text:detail+"\n\n★ - بخش : "+labels[action],replyMarkup:cityDetailKeyboard(ctx.userId,settlementId)};
  }

  if (action === "promotecity") {
    if(!["owner","admin"].includes(String(ctx.userRank))){
      return {text:"« ثبت شهر دست هر کسی نیست. مدیر یا مالک باید این کار را انجام دهد.»",replyMarkup:backKeyboard(ctx.userId)};
    }
    const settlement=await ensureSettlement(ctx.pool,ctx.chatId,ctx.chatTitle);
    await ctx.pool.query(
      "UPDATE game_world_settlements SET settlement_kind='city',is_public=TRUE,market_active=TRUE,bank_active=TRUE,saloon_active=TRUE,train_station_active=TRUE,mine_active=TRUE,jobs_active=TRUE,population_count=GREATEST(population_count,1),updated_at=NOW() WHERE settlement_id=$1",
      [settlement.settlement_id],
    );
    await ctx.pool.query(
      "INSERT INTO game_world_news(scope,group_id,title,body,severity) VALUES('local',$1,$2,$3,'event')",
      [ctx.chatId,"ثبت شهر جدید",String(settlement.name)+" اکنون یک شهر همگانی است."],
    );
    return {text:["◈ "+String(settlement.name),"",WORLD_SEPARATOR,"","★ - این قلمرو به‌عنوان شهر همگانی ثبت شد.","⛂ - بازار : فعال","⛂ - بانک : فعال","⛂ - سالون : فعال","⛂ - ایستگاه قطار : فعال","⛂ - معدن : فعال","⛂ - مشاغل شهری : فعال","","« از امروز اینجا فقط یک آبادی نیست.»","",WORLD_SEPARATOR].join("\n"),replyMarkup:backKeyboard(ctx.userId)};
  }

  if (action === "travel") {
    const result=await startTravel(ctx.pool,ctx,Number(parts[2]));
    return {text:result.text,replyMarkup:backKeyboard(ctx.userId)};
  }

  if (action === "hub") {
    const hub=String(parts[2]??"guide");
    return {text:hubText(hub,account?.gender==="female"),replyMarkup:hubKeyboard(ctx.userId,hub)};
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
      const textValue=(await cityText(ctx.pool,ctx)) ?? registrationText(ctx.user);
      const cities=(await ctx.pool.query<any>(
        "SELECT settlement_id,name FROM game_world_settlements WHERE is_public=TRUE AND settlement_kind='city' AND group_id<>$1 ORDER BY population_count DESC,settlement_id LIMIT 12",
        [ctx.chatId],
      )).rows;
      return {
        text:textValue,
        replyMarkup:cityOverviewKeyboard(ctx.userId,cities,["owner","admin"].includes(String(ctx.userRank))),
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

    if (section === "market") {
      return {
        text: await marketText(ctx.pool,ctx,"local"),
        replyMarkup: marketKeyboard(ctx.userId),
      };
    }

    if (section === "news") {
      return {
        text: await newsText(ctx.pool,ctx,"local"),
        replyMarkup: newsKeyboard(ctx.userId),
      };
    }

    return {
      text: sectionText(section, account),
      replyMarkup: backKeyboard(ctx.userId),
    };
  }

  return null;
}
