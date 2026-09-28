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
  parseMode?: "HTML";
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
  resources: "منابع",
  adventure: "ماجراجویی",
  games: "سرگرمی",
  missions: "مأموریت‌ها",
  collection: "مجموعه",
  events: "رویدادها",
  ranking: "رتبه‌بندی",
  help: "راهنما",
  settings: "تنظیمات",
};

type ResourceDefinition = {
  code: string;
  name: string;
  category: string;
};

const RESOURCE_CATALOG: ResourceDefinition[] = [
  { code: "wood", name: "چوب", category: "طبیعی" },
  { code: "stone", name: "سنگ", category: "طبیعی" },
  { code: "water", name: "آب", category: "طبیعی" },
  { code: "sand", name: "شن", category: "طبیعی" },
  { code: "clay", name: "خاک رس", category: "طبیعی" },
  { code: "limestone", name: "سنگ آهک", category: "طبیعی" },
  { code: "granite", name: "گرانیت", category: "طبیعی" },
  { code: "quartz", name: "کوارتز", category: "طبیعی" },
  { code: "salt", name: "نمک", category: "طبیعی" },
  { code: "sulfur", name: "گوگرد", category: "طبیعی" },
  { code: "coal", name: "زغال سنگ", category: "انرژی" },
  { code: "oil", name: "نفت خام", category: "انرژی" },
  { code: "natural_gas", name: "گاز طبیعی", category: "انرژی" },
  { code: "iron_ore", name: "سنگ آهن", category: "معدنی" },
  { code: "copper_ore", name: "سنگ مس", category: "معدنی" },
  { code: "aluminum_ore", name: "سنگ آلومینیوم", category: "معدنی" },
  { code: "lead_ore", name: "سنگ سرب", category: "معدنی" },
  { code: "zinc_ore", name: "سنگ روی", category: "معدنی" },
  { code: "nickel_ore", name: "سنگ نیکل", category: "معدنی" },
  { code: "titanium_ore", name: "سنگ تیتانیوم", category: "معدنی" },
  { code: "gold_ore", name: "سنگ طلا", category: "معدنی" },
  { code: "silver_ore", name: "سنگ نقره", category: "معدنی" },
  { code: "diamond_ore", name: "سنگ الماس", category: "معدنی" },
  { code: "emerald_ore", name: "سنگ زمرد", category: "معدنی" },
  { code: "wheat", name: "گندم", category: "کشاورزی" },
  { code: "corn", name: "ذرت", category: "کشاورزی" },
  { code: "cotton", name: "پنبه", category: "کشاورزی" },
  { code: "sugar_cane", name: "نیشکر", category: "کشاورزی" },
  { code: "herbs", name: "گیاهان دارویی", category: "کشاورزی" },
  { code: "rubber", name: "لاستیک طبیعی", category: "کشاورزی" },
  { code: "wool", name: "پشم", category: "دامداری" },
  { code: "leather", name: "چرم خام", category: "دامداری" },
  { code: "fish", name: "ماهی", category: "آبزیان" },
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
        { text: "‹ زندگی من", callback_data: "world:section:life:" + s },
      ],
      [
        { text: "‹ شهر", callback_data: "world:section:city:" + s },
        { text: "‹ کار و حرفه", callback_data: "world:section:job:" + s },
      ],
      [
        { text: "‹ منابع", callback_data: "world:section:resources:" + s },
        { text: "‹ بازار", callback_data: "world:section:market:" + s },
      ],
      [
        { text: "‹ دارایی", callback_data: "world:section:assets:" + s },
        { text: "‹ ماجراجویی", callback_data: "world:section:adventure:" + s },
      ],
      [
        { text: "‹ سرگرمی", callback_data: "world:section:games:" + s },
        { text: "‹ مأموریت‌ها", callback_data: "world:section:missions:" + s },
      ],
      [
        { text: "‹ مجموعه", callback_data: "world:section:collection:" + s },
        { text: "‹ رویدادها", callback_data: "world:section:events:" + s },
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
    "★ - خانه، شغل، منابع، بازار و ماجراجویی کم‌کم به جهان اضافه می‌شوند.",
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
    assets: "اینجا دارایی‌ها، ابزارها و چیزهایی را که به دست می‌آوری مدیریت می‌کنی.",
    adventure: "اینجا مسیر داستان‌ها و اتفاقات جهان را دنبال می‌کنی.",
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
    descriptions[section] ?? "این بخش برای توسعه مرحله‌ای جهان آماده شده.",
    "",
    WORLD_SEPARATOR,
    "",
    "اکانتت و اطلاعات اصلی‌ات همین حالا ذخیره می‌شوند.",
  ].join("\n");
}

function unauthorizedText() {
  return [
    "◈ دنیای پرشین",
    "",
    WORLD_SEPARATOR,
    "",
    "این دکمه برای بازیکن دیگری ساخته شده.",
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
    "★ - زندگی شهری با بازیکنان آنلاین",
    "★ - زندگی مستقل با بات‌ها",
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
    "★ - کارخانه‌های فعال",
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
      (factory ? "کارخانه فعال" : "کارخانه هنوز ساخته نشده"),
    );
  }

  lines.push("");
  lines.push(WORLD_SEPARATOR);
  lines.push("");
  lines.push("برای کارخانه‌های فعال، روی خود منبع بزن تا همان لحظه سهم تولیدش برداشت شود.");
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
      return {
        text: (await centerText(ctx.pool, ctx, account)) ?? registrationText(ctx.user),
        replyMarkup: mainKeyboard(ctx.userId),
      };
    }

    await ensureStarterFactories(ctx.pool, ctx.chatId, ctx.userId);
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
          "⛂ - کارخانه : هنوز ساخته نشده",
          "",
          "این منبع در دنیای پرشین وجود دارد و بعداً می‌توانی کارخانه‌اش را راه‌اندازی کنی.",
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
