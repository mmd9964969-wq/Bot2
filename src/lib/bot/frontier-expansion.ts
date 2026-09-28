import type { Pool } from "pg";

export type FrontierExpansionContext = {
  pool: Pool;
  chatId: number;
  userId: number;
  user: { id: number; first_name?: string; username?: string };
  chatTitle?: string;
};

export type FrontierExpansionResult = {
  text: string;
  replyMarkup?: Record<string, unknown>;
  parseMode?: "HTML";
};

const SEP = "─────━━───── ◈ ─────━━─────";
const fa = (x:number) => String(Math.max(0, Math.floor(Number(x)||0))).replace(/\d/g,d=>"۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
const nameOf = (ctx:FrontierExpansionContext) => ctx.user.first_name || ctx.user.username || String(ctx.userId);
const money = (x:number) => fa(x)+" سکه";
const isWoman=(a:any)=>String(a?.gender??"") === "female";
const frontierVoice=(woman:boolean)=>woman
  ? "« مرز برای کسی که راه خودش را می‌شناسد، جای کوچکی نیست.»"
  : "« مرز برای کسی که راه خودش را می‌شناسد، جای کوچکی نیست.»";

const CROPS:Record<string,{name:string;minutes:number;yield:number;seed:number}> = {
  wheat:{name:"گندم",minutes:5,yield:10,seed:35},
  corn:{name:"ذرت",minutes:7,yield:14,seed:45},
  cotton:{name:"پنبه",minutes:10,yield:9,seed:55},
  herbs:{name:"گیاهان دارویی",minutes:8,yield:6,seed:70},
};

const PROFESSIONS:Record<string,{name:string;pay:number;xp:number;cooldown:number;womenOnly?:boolean}> = {
  farmer:{name:"کشاورز",pay:90,xp:25,cooldown:20},
  miner:{name:"معدنچی",pay:120,xp:30,cooldown:25},
  lumberjack:{name:"چوب‌بُر",pay:100,xp:28,cooldown:20},
  hunter:{name:"شکارچی",pay:130,xp:32,cooldown:30},
  blacksmith:{name:"آهنگر",pay:150,xp:36,cooldown:35},
  trader:{name:"تاجر",pay:110,xp:30,cooldown:25},
  rancher:{name:"دامدار",pay:105,xp:28,cooldown:22},
  courier:{name:"پیک مرزی",pay:140,xp:34,cooldown:30},
  seamstress:{name:"خیاط و دوزنده",pay:135,xp:34,cooldown:24,womenOnly:true},
  healer:{name:"درمانگر مرزی",pay:160,xp:40,cooldown:30,womenOnly:true},
  innkeeper:{name:"مهمانخانه‌دار",pay:175,xp:42,cooldown:35,womenOnly:true},
  frontier_journalist:{name:"روزنامه‌نگار مرزی",pay:150,xp:38,cooldown:28,womenOnly:true},
  schoolteacher:{name:"معلم مدرسه مرزی",pay:145,xp:40,cooldown:32,womenOnly:true},
  saloon_keeper:{name:"صاحب سالون",pay:190,xp:45,cooldown:38,womenOnly:true},
};

const TOOLS:Record<string,{name:string;cost:number;durability:number}> = {
  axe:{name:"تبر",cost:180,durability:100},
  pickaxe:{name:"کلنگ",cost:220,durability:100},
  shovel:{name:"بیل",cost:140,durability:100},
  sickle:{name:"داس",cost:120,durability:100},
  hammer:{name:"چکش",cost:200,durability:100},
  rope:{name:"طناب",cost:90,durability:80},
};

let schemaReady:Promise<void>|null=null;

export async function ensureFrontierExpansionSchema(pool:Pool){
  if(!schemaReady){
    schemaReady=(async()=>{
      await pool.query("ALTER TABLE game_world_personal_assets ADD COLUMN IF NOT EXISTS land_level INT NOT NULL DEFAULT 1 CHECK(land_level>=1)");
      await pool.query("ALTER TABLE game_world_personal_assets ADD COLUMN IF NOT EXISTS land_value BIGINT NOT NULL DEFAULT 500 CHECK(land_value>=0)");
      await pool.query("ALTER TABLE game_world_personal_assets ADD COLUMN IF NOT EXISTS storage_level INT NOT NULL DEFAULT 1 CHECK(storage_level>=1)");
      await pool.query("ALTER TABLE game_world_personal_assets ADD COLUMN IF NOT EXISTS farm_crop TEXT");
      await pool.query("ALTER TABLE game_world_personal_assets ADD COLUMN IF NOT EXISTS farm_planted_at TIMESTAMPTZ");
      await pool.query("ALTER TABLE game_world_personal_assets ADD COLUMN IF NOT EXISTS farm_ready_at TIMESTAMPTZ");
      await pool.query("ALTER TABLE game_world_personal_assets ADD COLUMN IF NOT EXISTS farm_water INT NOT NULL DEFAULT 100 CHECK(farm_water BETWEEN 0 AND 100)");
      await pool.query("ALTER TABLE game_world_personal_assets ADD COLUMN IF NOT EXISTS farm_health INT NOT NULL DEFAULT 100 CHECK(farm_health BETWEEN 0 AND 100)");
      await pool.query("ALTER TABLE game_world_personal_assets ADD COLUMN IF NOT EXISTS horse_breed TEXT");
      await pool.query("ALTER TABLE game_world_personal_assets ADD COLUMN IF NOT EXISTS horse_health INT NOT NULL DEFAULT 100 CHECK(horse_health BETWEEN 0 AND 100)");
      await pool.query("ALTER TABLE game_world_personal_assets ADD COLUMN IF NOT EXISTS horse_speed INT NOT NULL DEFAULT 0 CHECK(horse_speed>=0)");
      await pool.query("ALTER TABLE game_world_personal_assets ADD COLUMN IF NOT EXISTS horse_stamina INT NOT NULL DEFAULT 0 CHECK(horse_stamina>=0)");

      await pool.query("CREATE TABLE IF NOT EXISTS game_world_bank_accounts(group_id BIGINT NOT NULL,user_id BIGINT NOT NULL,balance BIGINT NOT NULL DEFAULT 0 CHECK(balance>=0),debt BIGINT NOT NULL DEFAULT 0 CHECK(debt>=0),credit_score INT NOT NULL DEFAULT 600 CHECK(credit_score BETWEEN 0 AND 900),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(group_id,user_id))");
      await pool.query("CREATE TABLE IF NOT EXISTS game_world_bank_ledger(id BIGSERIAL PRIMARY KEY,group_id BIGINT NOT NULL,user_id BIGINT NOT NULL,kind TEXT NOT NULL,amount BIGINT NOT NULL CHECK(amount>0),balance_after BIGINT NOT NULL CHECK(balance_after>=0),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      await pool.query("CREATE TABLE IF NOT EXISTS game_world_economy_ledger(id BIGSERIAL PRIMARY KEY,group_id BIGINT NOT NULL,user_id BIGINT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('income','expense','transfer')),amount BIGINT NOT NULL CHECK(amount>0),balance_after BIGINT NOT NULL CHECK(balance_after>=0),source TEXT NOT NULL,reference TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_game_world_economy_user_time ON game_world_economy_ledger(group_id,user_id,created_at DESC)");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_game_world_economy_source ON game_world_economy_ledger(group_id,source,created_at DESC)");
      await pool.query("CREATE TABLE IF NOT EXISTS game_world_market_prices(group_id BIGINT NOT NULL,resource_code TEXT NOT NULL,base_price BIGINT NOT NULL CHECK(base_price>0),current_price BIGINT NOT NULL CHECK(current_price>0),supply_24h NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK(supply_24h>=0),demand_24h NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK(demand_24h>=0),trend TEXT NOT NULL DEFAULT 'stable' CHECK(trend IN ('down','stable','up')),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(group_id,resource_code))");
      await pool.query("CREATE TABLE IF NOT EXISTS game_world_market_trades(trade_id BIGSERIAL PRIMARY KEY,group_id BIGINT NOT NULL,listing_id BIGINT NOT NULL,buyer_user_id BIGINT NOT NULL,seller_user_id BIGINT NOT NULL,resource_code TEXT NOT NULL,quantity NUMERIC(20,6) NOT NULL CHECK(quantity>0),gross_amount BIGINT NOT NULL CHECK(gross_amount>0),market_fee BIGINT NOT NULL DEFAULT 0 CHECK(market_fee>=0),market_tax BIGINT NOT NULL DEFAULT 0 CHECK(market_tax>=0),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_game_world_market_trades_demand ON game_world_market_trades(group_id,resource_code,created_at DESC)");
      await pool.query("CREATE TABLE IF NOT EXISTS game_world_market_treasury(group_id BIGINT PRIMARY KEY,balance BIGINT NOT NULL DEFAULT 0 CHECK(balance>=0),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      await pool.query("CREATE TABLE IF NOT EXISTS game_world_tools(group_id BIGINT NOT NULL,user_id BIGINT NOT NULL,tool_code TEXT NOT NULL,level INT NOT NULL DEFAULT 1 CHECK(level>=1),durability INT NOT NULL DEFAULT 100 CHECK(durability>=0),quantity INT NOT NULL DEFAULT 1 CHECK(quantity>=0),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(group_id,user_id,tool_code))");
      await pool.query("CREATE TABLE IF NOT EXISTS game_world_professions(group_id BIGINT NOT NULL,user_id BIGINT NOT NULL,profession_code TEXT NOT NULL,level INT NOT NULL DEFAULT 1 CHECK(level>=1),xp BIGINT NOT NULL DEFAULT 0 CHECK(xp>=0),last_work_at TIMESTAMPTZ,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(group_id,user_id))");
      await pool.query("CREATE TABLE IF NOT EXISTS game_world_player_missions(group_id BIGINT NOT NULL,user_id BIGINT NOT NULL,code TEXT NOT NULL,title TEXT NOT NULL,target INT NOT NULL CHECK(target>0),progress INT NOT NULL DEFAULT 0 CHECK(progress>=0),reward_coins BIGINT NOT NULL DEFAULT 0 CHECK(reward_coins>=0),reward_xp BIGINT NOT NULL DEFAULT 0 CHECK(reward_xp>=0),claim_key TEXT NOT NULL,claimed BOOLEAN NOT NULL DEFAULT FALSE,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(group_id,user_id,code))");
      await pool.query("CREATE TABLE IF NOT EXISTS game_world_wanted(group_id BIGINT NOT NULL,user_id BIGINT NOT NULL,wanted_level INT NOT NULL DEFAULT 0 CHECK(wanted_level>=0),bounty BIGINT NOT NULL DEFAULT 0 CHECK(bounty>=0),last_incident_at TIMESTAMPTZ,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(group_id,user_id))");
      await pool.query("CREATE TABLE IF NOT EXISTS game_world_events(id BIGSERIAL PRIMARY KEY,scope TEXT NOT NULL CHECK(scope IN ('local','global')),group_id BIGINT,title TEXT NOT NULL,body TEXT NOT NULL,event_key TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),expires_at TIMESTAMPTZ)");
      await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_game_world_events_key ON game_world_events(scope,COALESCE(group_id,0),event_key)");
      await pool.query("CREATE TABLE IF NOT EXISTS game_world_bands(id BIGSERIAL PRIMARY KEY,group_id BIGINT NOT NULL UNIQUE,founder_id BIGINT NOT NULL,name TEXT NOT NULL,treasury BIGINT NOT NULL DEFAULT 0 CHECK(treasury>=0),law_profile TEXT NOT NULL DEFAULT 'frontier',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      await pool.query("CREATE TABLE IF NOT EXISTS game_world_band_members(band_id BIGINT NOT NULL REFERENCES game_world_bands(id) ON DELETE CASCADE,user_id BIGINT NOT NULL,role TEXT NOT NULL DEFAULT 'member',joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(band_id,user_id))");
      await pool.query("CREATE TABLE IF NOT EXISTS game_world_contracts(id BIGSERIAL PRIMARY KEY,group_id BIGINT NOT NULL,creator_id BIGINT NOT NULL,title TEXT NOT NULL,details TEXT NOT NULL,reward BIGINT NOT NULL DEFAULT 0 CHECK(reward>=0),status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','claimed','completed','cancelled')),claimed_by BIGINT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),expires_at TIMESTAMPTZ NOT NULL DEFAULT(NOW()+INTERVAL '3 days'))");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_game_world_contracts_group_status ON game_world_contracts(group_id,status,created_at DESC)");
      await pool.query("ALTER TABLE game_world_accounts ADD COLUMN IF NOT EXISTS health INT NOT NULL DEFAULT 100 CHECK(health BETWEEN 0 AND 100)");
      await pool.query("ALTER TABLE game_world_accounts ADD COLUMN IF NOT EXISTS hunger INT NOT NULL DEFAULT 100 CHECK(hunger BETWEEN 0 AND 100)");
      await pool.query("ALTER TABLE game_world_accounts ADD COLUMN IF NOT EXISTS energy INT NOT NULL DEFAULT 100 CHECK(energy BETWEEN 0 AND 100)");
      await pool.query("ALTER TABLE game_world_accounts ADD COLUMN IF NOT EXISTS location_settlement_id BIGINT");
      await pool.query("ALTER TABLE game_world_accounts ADD COLUMN IF NOT EXISTS jailed_until TIMESTAMPTZ");
      await pool.query("CREATE TABLE IF NOT EXISTS game_world_livestock(group_id BIGINT NOT NULL,user_id BIGINT NOT NULL,animal_code TEXT NOT NULL,count INT NOT NULL DEFAULT 0 CHECK(count>=0),health INT NOT NULL DEFAULT 100 CHECK(health BETWEEN 0 AND 100),feed INT NOT NULL DEFAULT 100 CHECK(feed BETWEEN 0 AND 100),last_collected_at TIMESTAMPTZ,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(group_id,user_id,animal_code))");
      await pool.query("CREATE TABLE IF NOT EXISTS game_world_businesses(id BIGSERIAL PRIMARY KEY,group_id BIGINT NOT NULL,user_id BIGINT NOT NULL,business_code TEXT NOT NULL,business_name TEXT NOT NULL,level INT NOT NULL DEFAULT 1 CHECK(level>=1),cashbox BIGINT NOT NULL DEFAULT 0 CHECK(cashbox>=0),last_income_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(group_id,user_id,business_code))");
      await pool.query("CREATE TABLE IF NOT EXISTS game_world_transport(group_id BIGINT NOT NULL,user_id BIGINT NOT NULL,transport_code TEXT NOT NULL,level INT NOT NULL DEFAULT 1 CHECK(level>=1),condition INT NOT NULL DEFAULT 100 CHECK(condition BETWEEN 0 AND 100),fuel INT NOT NULL DEFAULT 100 CHECK(fuel BETWEEN 0 AND 100),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(group_id,user_id,transport_code))");
      await pool.query("CREATE TABLE IF NOT EXISTS game_world_relationships(group_id BIGINT NOT NULL,user_id BIGINT NOT NULL,target_user_id BIGINT NOT NULL,relation TEXT NOT NULL DEFAULT 'شناسا',value INT NOT NULL DEFAULT 0 CHECK(value BETWEEN -100 AND 100),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(group_id,user_id,target_user_id))");
      await pool.query("CREATE TABLE IF NOT EXISTS game_world_career_stats(group_id BIGINT NOT NULL,user_id BIGINT NOT NULL,profession_code TEXT NOT NULL,action_count INT NOT NULL DEFAULT 0 CHECK(action_count>=0),service_count INT NOT NULL DEFAULT 0 CHECK(service_count>=0),career_revenue BIGINT NOT NULL DEFAULT 0 CHECK(career_revenue>=0),goods_stock INT NOT NULL DEFAULT 0 CHECK(goods_stock>=0),reputation_earned INT NOT NULL DEFAULT 0 CHECK(reputation_earned>=0),last_action_at TIMESTAMPTZ,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(group_id,user_id,profession_code))");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_game_world_career_stats_user ON game_world_career_stats(group_id,user_id,profession_code)");
      await pool.query("ALTER TABLE game_world_professions ADD COLUMN IF NOT EXISTS career_actions INT NOT NULL DEFAULT 0 CHECK(career_actions>=0)");
      await pool.query("ALTER TABLE game_world_professions ADD COLUMN IF NOT EXISTS career_value BIGINT NOT NULL DEFAULT 0 CHECK(career_value>=0)");
      await pool.query("ALTER TABLE game_world_professions ADD COLUMN IF NOT EXISTS career_last_action_at TIMESTAMPTZ");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_game_world_businesses_user ON game_world_businesses(group_id,user_id,status,updated_at DESC)");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_game_world_livestock_user ON game_world_livestock(group_id,user_id,animal_code)");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_game_world_transport_user ON game_world_transport(group_id,user_id,transport_code)");
    })().catch(err=>{schemaReady=null;throw err;});
  }
  return schemaReady;
}

function back(userId:number){
  return {inline_keyboard:[[{text:"‹ بازگشت",callback_data:"world:home:"+String(userId)}]]};
}

function expansionMenu(userId:number){
  const s=String(userId);
  return {inline_keyboard:[
    [{text:"‹ پول و اقتصاد",callback_data:"world:expand:cat:finance:"+s},{text:"‹ دارایی و زندگی",callback_data:"world:expand:cat:life:"+s}],
    [{text:"‹ کار و کسب‌وکار",callback_data:"world:expand:cat:work:"+s},{text:"‹ قانون و روابط",callback_data:"world:expand:cat:law:"+s}],
    [{text:"‹ نقشه و رویدادها",callback_data:"world:expand:cat:world:"+s},{text:"‹ خبر و وضعیت",callback_data:"world:expand:cat:status:"+s}],
    [{text:"‹ زنجیره تولید و مصرف",callback_data:"world:expand:supply:"+s}],
    [{text:"‹ راهنمای اقتصاد و نمادها",callback_data:"world:help:"+s}],
    [{text:"‹ بازگشت به جهان",callback_data:"world:home:"+s}],
  ]};
}

async function expansionCategoryMenu(ctx:FrontierExpansionContext,category:string){
  const s=String(ctx.userId);
  const currentAccount=await account(ctx);
  const woman=isWoman(currentAccount);
  const a:any={finance:{
    title:"◈ دفتر مرز · پول و اقتصاد",
    subtitle:"مدیریت پول، درآمد، سرمایه و کسب‌وکار",
    items:[
      ["‹ بانک و اقتصاد","world:expand:bank:"+s],
      ["‹ دفتر درآمد","world:expand:economy:"+s],
      ["‹ اقتصاد مرزی · قیمت و بازار","world:expand:dynamics:"+s],
      ["‹ زنجیره تولید و مصرف","world:expand:supply:"+s],
      ["‹ کسب‌وکار و مغازه","world:expand:business:"+s],
    ]},
    life:{
      title:"◈ دفتر مرز · دارایی و زندگی",
      subtitle:"خانه، زمین، مزرعه، اسب، ابزار و وضعیت روزمره",
      items:[
        ["‹ ملک و زمین","world:expand:property:"+s],
        ["‹ مزرعه و دامداری","world:expand:farm:"+s],
        ["‹ اسب و حمل‌ونقل","world:expand:transport:"+s],
        ["‹ انبار و ابزار","world:expand:tools:"+s],
        ["‹ وضعیت زندگی","world:expand:life:"+s],
      ]},
    work:{
      title:"◈ دفتر مرز · کار و کسب‌وکار",
      subtitle:"حرفه، مهارت، کار تخصصی و مسیر درآمدی",
      items:[
        ["‹ حرفه و مهارت","world:expand:profession:"+s],
        ...(woman?[["‹ دفتر بانوان مرز","world:expand:ladies:"+s]]:[]),
      ]},
    law:{
      title:"◈ دفتر مرز · قانون و روابط",
      subtitle:"قانون، شهرت، مأموریت، قرارداد و گروه‌های مرزی",
      items:[
        ["‹ قانون و شهرت","world:expand:law:"+s],
        ["‹ مأموریت و قرارداد","world:expand:missions:"+s],
        ["‹ باند و روابط","world:expand:band:"+s],
      ]},
    world:{
      title:"◈ دفتر مرز · نقشه و رویدادها",
      subtitle:"جابه‌جایی، مسیرها و اتفاقات زنده مرز",
      items:[
        ["‹ نقشه و سفر","world:expand:map:"+s],
        ["‹ رویدادهای زنده","world:expand:events:"+s],
      ]},
    status:{
      title:"◈ دفتر مرز · خبر و وضعیت",
      subtitle:"اخبار، شایعات و وضعیت فعلی کاراکتر",
      items:[
        ["‹ روزنامه مرزی","world:expand:newspaper:"+s],
        ["‹ وضعیت زندگی","world:expand:life:"+s],
      ]},
  }[category];
  if(!a)return null;
  return {
    text:[
      a.title,
      "",
      SEP,
      "",
      "★ - "+a.subtitle,
      "",
      ...a.items.map((x:string[])=>"⛂ - "+x[0].replace(/^‹ /,"")),
      "",
      SEP,
      "",
      frontierVoice(woman),
    ].join("\n"),
    replyMarkup:{inline_keyboard:[
      ...a.items.map((x:string[])=>[{text:x[0],callback_data:x[1]}]),
      [{text:"‹ بازگشت به دفتر مرز",callback_data:"world:expand:center:"+s}],
    ]}
  };
}
async function account(ctx:FrontierExpansionContext){
  return (await ctx.pool.query<any>("SELECT * FROM game_world_accounts WHERE group_id=$1 AND user_id=$2 LIMIT 1",[ctx.chatId,ctx.userId])).rows[0]??null;
}

async function assets(ctx:FrontierExpansionContext){
  await ctx.pool.query("INSERT INTO game_world_personal_assets(group_id,user_id) VALUES($1,$2) ON CONFLICT(group_id,user_id) DO NOTHING",[ctx.chatId,ctx.userId]);
  return (await ctx.pool.query<any>("SELECT * FROM game_world_personal_assets WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId])).rows[0];
}

async function ensureBank(ctx:FrontierExpansionContext){
  await ctx.pool.query("INSERT INTO game_world_bank_accounts(group_id,user_id) VALUES($1,$2) ON CONFLICT(group_id,user_id) DO NOTHING",[ctx.chatId,ctx.userId]);
  return (await ctx.pool.query<any>("SELECT * FROM game_world_bank_accounts WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId])).rows[0];
}

async function recordEconomy(pool:Pool,groupId:number,userId:number,kind:"income"|"expense"|"transfer",amount:number,source:string,reference?:string){
  const value=Math.floor(Number(amount)||0);
  if(value<=0)return;
  const row=(await pool.query<any>("SELECT coins FROM game_world_accounts WHERE group_id=$1 AND user_id=$2 LIMIT 1",[groupId,userId])).rows[0];
  if(!row)return;
  await pool.query(
    "INSERT INTO game_world_economy_ledger(group_id,user_id,kind,amount,balance_after,source,reference) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [groupId,userId,kind,value,Math.max(0,Math.floor(Number(row.coins)||0)),source,reference??null],
  );
}

const MARKET_BASE_PRICES:Record<string,number> = {
  wood:8,stone:10,water:5,sand:6,clay:9,limestone:12,granite:18,quartz:24,salt:14,sulfur:20,
  coal:26,oil:45,natural_gas:52,iron_ore:32,copper_ore:38,aluminum_ore:44,lead_ore:30,zinc_ore:34,
  nickel_ore:48,titanium_ore:65,gold_ore:180,silver_ore:95,diamond_ore:480,emerald_ore:360,
  wheat:18,corn:22,cotton:26,sugar_cane:20,herbs:40,rubber:28,wool:35,leather:42,fish:24
};
const MARKET_TRACKED_RESOURCES=Object.keys(MARKET_BASE_PRICES);

function marketBasePrice(resourceCode:string){
  return Math.max(1,Math.floor(Number(MARKET_BASE_PRICES[resourceCode]??10)));
}

export async function ensureDynamicMarketPrice(pool:Pool,groupId:number,resourceCode:string){
  const code=String(resourceCode);
  const base=marketBasePrice(code);
  await pool.query(
    "INSERT INTO game_world_market_prices(group_id,resource_code,base_price,current_price) VALUES($1,$2,$3,$3) ON CONFLICT(group_id,resource_code) DO NOTHING",
    [groupId,code,base],
  );
  return (await pool.query<any>(
    "SELECT * FROM game_world_market_prices WHERE group_id=$1 AND resource_code=$2",
    [groupId,code],
  )).rows[0];
}

const MARKET_DAILY_CONSUMPTION:Record<string,number> = {
  wood:10,stone:6,water:20,sand:4,clay:5,limestone:3,granite:2,quartz:1,salt:4,sulfur:1,
  coal:5,oil:3,natural_gas:2,iron_ore:4,copper_ore:3,aluminum_ore:2,lead_ore:1,zinc_ore:2,
  nickel_ore:1,titanium_ore:0.5,gold_ore:0.2,silver_ore:0.3,diamond_ore:0.05,emerald_ore:0.05,
  wheat:14,corn:10,cotton:6,sugar_cane:5,herbs:4,rubber:2,wool:3,leather:3,fish:8
};

const SUPPLY_CHAIN_RECIPES:Record<string,{inputs:string;output:string;consumers:string}> = {
  wood:{inputs:"چوب",output:"تخته و مصالح چوبی",consumers:"نجاری، ساخت‌وساز، فروشگاه مصالح"},
  stone:{inputs:"سنگ",output:"مصالح سنگی",consumers:"ساختمان، کارگاه، فروشگاه مصالح"},
  iron_ore:{inputs:"سنگ‌آهن + زغال",output:"آهن و ابزار",consumers:"آهنگری، ابزارفروشی، ساخت‌وساز"},
  wheat:{inputs:"گندم + آب",output:"آرد و نان",consumers:"نانوایی، اهالی شهر، فروشگاه غذا"},
  wool:{inputs:"پشم",output:"پارچه و پوشاک",consumers:"خیاطی، فروشگاه پوشاک"},
  leather:{inputs:"چرم",output:"پوشاک و تجهیزات",consumers:"خیاطی، تولیدکنندگان تجهیزات"},
  fish:{inputs:"ماهی",output:"غذای تازه",consumers:"بازار غذا، اهالی شهر، مهمانخانه"},
};


export async function recalculateDynamicMarketPrice(pool:Pool,groupId:number,resourceCode:string){
  const code=String(resourceCode);
  const current=await ensureDynamicMarketPrice(pool,groupId,code);
  const supply=Number((await pool.query<any>(
    "SELECT COALESCE(SUM(amount),0) supply FROM game_world_market_listings WHERE group_id=$1 AND resource_code=$2 AND status='active' AND expires_at>NOW()",
    [groupId,code],
  )).rows[0]?.supply??0);

  const tradedDemand=Number((await pool.query<any>(
    "SELECT COALESCE(SUM(quantity),0) demand FROM game_world_market_trades WHERE group_id=$1 AND resource_code=$2 AND created_at>=NOW()-INTERVAL '24 hours'",
    [groupId,code],
  )).rows[0]?.demand??0);

  const pop=Number((await pool.query<any>(
    "SELECT COALESCE(population_count,0) population FROM game_world_settlements WHERE group_id=$1 LIMIT 1",
    [groupId],
  )).rows[0]?.population??0);

  const businesses=Number((await pool.query<any>(
    "SELECT COUNT(*)::int count FROM game_world_businesses WHERE group_id=$1 AND status='open'",
    [groupId],
  )).rows[0]?.count??0);

  // NPC households create a small baseline of real consumption even before
  // players trade the resource; open businesses add additional pressure.
  const baseDaily=Number(MARKET_DAILY_CONSUMPTION[code]??2);
  const householdDemand=pop*baseDaily;
  const businessDemand=businesses*baseDaily*0.35;
  const demand=Math.max(0,tradedDemand+householdDemand+businessDemand);

  const ratio=Math.max(0.5,Math.min(2.5,(demand+5)/(supply+5)));
  const raw=marketBasePrice(code)*ratio;
  const previous=Math.max(1,Number(current.current_price)||marketBasePrice(code));
  const next=Math.max(1,Math.round(previous*0.7+raw*0.3));
  const trend=next>previous?"up":next<previous?"down":"stable";

  await pool.query(
    "UPDATE game_world_market_prices SET current_price=$3,supply_24h=$4,demand_24h=$5,trend=$6,updated_at=NOW() WHERE group_id=$1 AND resource_code=$2",
    [groupId,code,next,supply,demand,trend],
  );

  return (await pool.query<any>(
    "SELECT * FROM game_world_market_prices WHERE group_id=$1 AND resource_code=$2",
    [groupId,code],
  )).rows[0];
}

export async function marketReferencePrice(pool:Pool,groupId:number,resourceCode:string){
  return Number((await recalculateDynamicMarketPrice(pool,groupId,resourceCode)).current_price)||marketBasePrice(resourceCode);
}

async function marketTreasury(pool:Pool,groupId:number){
  await pool.query("INSERT INTO game_world_market_treasury(group_id) VALUES($1) ON CONFLICT(group_id) DO NOTHING",[groupId]);
  return (await pool.query<any>("SELECT * FROM game_world_market_treasury WHERE group_id=$1",[groupId])).rows[0];
}

async function dynamicMarketOverview(ctx:FrontierExpansionContext){
  await Promise.all(MARKET_TRACKED_RESOURCES.map(code=>recalculateDynamicMarketPrice(ctx.pool,ctx.chatId,code)));
  const rows=(await ctx.pool.query<any>(
    "SELECT * FROM game_world_market_prices WHERE group_id=$1 ORDER BY updated_at DESC LIMIT 12",
    [ctx.chatId],
  )).rows;
  const treasury=await marketTreasury(ctx.pool,ctx.chatId);
  const lines=[
    "◈ اقتصاد مرزی · قیمت‌گذاری پویا",
    "",
    SEP,
    "",
    "★ - موتور قیمت",
    "⛂ - قیمت پایه با عرضه، خریدهای واقعی و مصرف مرزی تعدیل می‌شود.",
    "⛂ - عرضه بیشتر → فشار کاهشی روی قیمت.",
    "⛂ - کمبود کالا یا تقاضای بیشتر → فشار افزایشی.",
    "⛂ - جمعیت و کسب‌وکارهای فعال، مصرف پایه بازار را می‌سازند.",
    "⛂ - قیمت‌ها با نوسان کنترل‌شده حرکت می‌کنند تا اقتصاد منفجر نشود.",
    "",
    "★ - زنجیره پول و کالا",
    "⛂ - تولیدکننده → تاجر → فروشگاه → مصرف‌کننده",
    "⛂ - کارمزد بازار : ۳٪ از خرید",
    "⛂ - مالیات معامله : ۲٪ از فروش",
    "⛂ - کارمزد و مالیات → خزانه بازار همان روستا",
    "",
    "★ - قیمت‌های مرزی",
  ];
  for(const row of rows){
    const arrow=String(row.trend)==="up"?"↑":String(row.trend)==="down"?"↓":"→";
    lines.push("⛂ - "+String(row.resource_code)+" : "+fa(+row.current_price)+" سکه "+arrow+" | عرضه "+fa(+row.supply_24h)+" | تقاضا "+fa(+row.demand_24h));
  }
  lines.push("","⛂ - خزانه بازار : "+money(+treasury.balance),"","« بازار وقتی زنده است که جنس حرکت کند و قیمت هم از حرکت جا نماند.»","",SEP);
  return lines.join("\n");
}

async function supplyChainText(ctx:FrontierExpansionContext){
  await Promise.all(Object.keys(SUPPLY_CHAIN_RECIPES).map(code=>recalculateDynamicMarketPrice(ctx.pool,ctx.chatId,code)));
  const prices=(await ctx.pool.query<any>(
    "SELECT resource_code,current_price,supply_24h,demand_24h,trend FROM game_world_market_prices WHERE group_id=$1 AND resource_code=ANY($2::text[]) ORDER BY resource_code",
    [ctx.chatId,Object.keys(SUPPLY_CHAIN_RECIPES)],
  )).rows;
  const producers=(await ctx.pool.query<any>(
    "SELECT profession_code,COUNT(*)::int count FROM game_world_professions WHERE group_id=$1 AND profession_code IN ('farmer','miner','lumberjack','blacksmith','trader') GROUP BY profession_code",
    [ctx.chatId],
  )).rows;
  const businesses=Number((await ctx.pool.query<any>(
    "SELECT COUNT(*)::int count FROM game_world_businesses WHERE group_id=$1 AND status='open'",
    [ctx.chatId],
  )).rows[0]?.count??0);
  const producerMap:Record<string,number>={};
  for(const row of producers)producerMap[String(row.profession_code)]=Number(row.count)||0;
  const professionNames:Record<string,string>={farmer:"کشاورز",miner:"معدنچی",lumberjack:"چوب‌بُر",blacksmith:"آهنگر",trader:"تاجر"};

  const lines=[
    "◈ زنجیره تولید و مصرف",
    "",
    SEP,
    "",
    "★ - جریان اصلی کالا",
    "⛂ - منبع → تولیدکننده → انبار → تاجر → فروشگاه → مصرف‌کننده",
    "⛂ - قیمت و موجودی هر حلقه از وضعیت واقعی بازار اثر می‌گیرد.",
    "",
    "★ - تولیدکنندگان فعال",
    ...Object.entries(professionNames).map(([code,name])=>"⛂ - "+name+" : "+fa(producerMap[code]??0)),
    "⛂ - کسب‌وکارهای باز : "+fa(businesses),
    "",
    "★ - مسیر کالاها",
  ];

  for(const [code,recipe] of Object.entries(SUPPLY_CHAIN_RECIPES)){
    const row=prices.find((x:any)=>String(x.resource_code)===code);
    const arrow=String(row?.trend)==="up"?"↑":String(row?.trend)==="down"?"↓":"→";
    lines.push(
      "⛂ - "+code,
      "⛂ - ورودی : "+recipe.inputs,
      "⛂ - خروجی : "+recipe.output,
      "⛂ - مصرف‌کننده : "+recipe.consumers,
      "⛂ - بازار : "+fa(Number(row?.current_price??marketBasePrice(code)))+" سکه "+arrow+" | عرضه "+fa(Number(row?.supply_24h??0))+" | تقاضا "+fa(Number(row?.demand_24h??0)),
      ""
    );
  }

  lines.push(
    SEP
  );
  return lines.join("\n");
}

async function economyText(ctx:FrontierExpansionContext){
  const a=await account(ctx); if(!a)return "✗ اکانتت هنوز ثبت نشده است.";
  const today=(await ctx.pool.query<any>(
    "SELECT COALESCE(SUM(amount) FILTER(WHERE kind='income'),0) income,COALESCE(SUM(amount) FILTER(WHERE kind='expense'),0) expense FROM game_world_economy_ledger WHERE group_id=$1 AND user_id=$2 AND created_at>=CURRENT_DATE",
    [ctx.chatId,ctx.userId],
  )).rows[0];
  const recent=(await ctx.pool.query<any>(
    "SELECT kind,amount,source,created_at FROM game_world_economy_ledger WHERE group_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 8",
    [ctx.chatId,ctx.userId],
  )).rows;
  const business=(await ctx.pool.query<any>(
    "SELECT COALESCE(SUM(cashbox),0) cashbox FROM game_world_businesses WHERE group_id=$1 AND user_id=$2 AND status='open'",
    [ctx.chatId,ctx.userId],
  )).rows[0];
  const p=(await ctx.pool.query<any>(
    "SELECT profession_code,level FROM game_world_professions WHERE group_id=$1 AND user_id=$2 LIMIT 1",
    [ctx.chatId,ctx.userId],
  )).rows[0];
  const prof=p?PROFESSIONS[String(p.profession_code)]:null;
  const lines=[
    "◈ دفتر درآمد و اقتصاد",
    "",
    SEP,
    "",
    "★ - وضعیت امروز",
    "⛂ - موجودی نقد : "+money(+a.coins),
    "⛂ - موجودی بانک : "+money(+(await ensureBank(ctx)).balance),
    "⛂ - درآمد ثبت‌شده امروز : +"+money(+today.income),
    "⛂ - هزینه ثبت‌شده امروز : -"+money(+today.expense),
    "⛂ - گردش خالص امروز : "+money(+today.income-+today.expense),
    "⛂ - پول داخل کسب‌وکارها : "+money(+business.cashbox),
    "",
    "★ - موتور درآمد فعلی",
    p&&prof ? "⛂ - "+prof.name+" · "+money(prof.pay)+" پایه در هر نوبت" : "⛂ - هنوز حرفه‌ای برای درآمد شغلی انتخاب نکرده‌ای.",
    "",
    "★ - آخرین گردش حساب",
  ];
  if(!recent.length)lines.push("⛂ - هنوز گردش مالی ثبت نشده است.");
  else for(const row of recent){
    const prefix=String(row.kind)==="income"?"+":String(row.kind)==="expense"?"-":"↔";
    lines.push("⛂ - "+prefix+money(+row.amount)+" · "+String(row.source));
  }
  lines.push("","« پول باید حرکت کند؛ درآمد می‌آید، خرج می‌شود و دوباره به بازار برمی‌گردد.»","",SEP);
  return lines.join("\n");
}

async function bankText(ctx:FrontierExpansionContext){
  const a=await account(ctx); if(!a)return "✗ اکانتت هنوز ثبت نشده است.";
  const b=await ensureBank(ctx);
  return ["◈ بانک مرزی","",SEP,"","★ - صاحب حساب : "+nameOf(ctx),"⛂ - موجودی نقد : "+money(+a.coins),"⛂ - موجودی بانک : "+money(+b.balance),"⛂ - بدهی : "+money(+b.debt),"⛂ - اعتبار بانکی : "+fa(+b.credit_score),"","‹ برای دیدن گردش کامل حساب، «دفتر درآمد» را باز کن.","","« بانک پول را نگه می‌دارد؛ بدهی را هم فراموش نمی‌کند.»","",SEP].join("\n");
}

async function propertyText(ctx:FrontierExpansionContext){
  const a=await assets(ctx);
  const houseLevel=+a.home_level, landLevel=+a.land_level, storage=+a.storage_level;
  const nextHome=(houseLevel+1)*700, nextLand=(landLevel+1)*500, nextStorage=(storage+1)*450;
  return ["◈ ملک و دارایی","",SEP,"","★ - مالک : "+nameOf(ctx),"⛂ - خانه : کلبه مرزی · سطح "+fa(houseLevel),"⛂ - زمین : قطعه مرزی · سطح "+fa(landLevel),"⛂ - ارزش زمین : "+money(+a.land_value),"⛂ - انبار : سطح "+fa(storage),"","★ - ارتقاهای بعدی","⛂ - خانه → سطح "+fa(houseLevel+1)+" · "+money(nextHome),"⛂ - زمین → سطح "+fa(landLevel+1)+" · "+money(nextLand),"⛂ - انبار → سطح "+fa(storage+1)+" · "+money(nextStorage),"", "⛂ - ظرفیت انبار : "+fa(storage*50)+" واحد","",SEP].join("\n");
}

async function farmText(ctx:FrontierExpansionContext){
  const a=await assets(ctx);
  let farm="زمین آماده کشت";
  let action:string[]=[];
  if(a.farm_crop){
    const ready=a.farm_ready_at && new Date(a.farm_ready_at).getTime()<=Date.now();
    farm=String(CROPS[String(a.farm_crop)]?.name??a.farm_crop)+(ready?" · آماده برداشت":" · در حال رشد");
    action=ready?["‹ برداشت محصول","world:expand:harvest:"+ctx.userId]:["‹ وضعیت مزرعه","world:expand:farm:"+ctx.userId];
  }else{
    farm="آماده کاشت";
  }
  const horse=a.horse_name?String(a.horse_name)+" · "+String(a.horse_breed??"اسب مرزی"):"هنوز اسب نداری";
  return ["◈ مزرعه و اسب","",SEP,"","★ - مزرعه","⛂ - وضعیت : "+farm,"⛂ - آب : "+fa(+a.farm_water)+"%","⛂ - سلامت محصول : "+fa(+a.farm_health)+"%","", "★ - اسب","⛂ - وضعیت : "+horse,"⛂ - سلامت : "+fa(+a.horse_health)+"%","⛂ - سرعت : "+fa(+a.horse_speed),"⛂ - استقامت : "+fa(+a.horse_stamina),"",SEP].join("\n");
}

async function toolsText(ctx:FrontierExpansionContext){
  const rows=await ctx.pool.query<any>("SELECT * FROM game_world_tools WHERE group_id=$1 AND user_id=$2 ORDER BY tool_code",[ctx.chatId,ctx.userId]);
  const lines=["◈ انبار و ابزار","",SEP,"","★ - ابزارهای در اختیار"];
  if(!rows.rows.length)lines.push("⛂ - هنوز ابزار شخصی نداری.");
  else for(const r of rows.rows){
    const t=TOOLS[String(r.tool_code)];
    lines.push("⛂ - "+(t?.name??String(r.tool_code))+" · سطح "+fa(+r.level)+" · دوام "+fa(+r.durability)+"% · تعداد "+fa(+r.quantity));
  }
  lines.push("","★ - خرید ابزار","⛂ - تبر · 180 سکه","⛂ - کلنگ · 220 سکه","⛂ - بیل · 140 سکه","⛂ - داس · 120 سکه","⛂ - چکش · 200 سکه","⛂ - طناب · 90 سکه","",SEP);
  return lines.join("\n");
}

async function ensureCareerStats(ctx:FrontierExpansionContext,professionCode:string){
  await ctx.pool.query("INSERT INTO game_world_career_stats(group_id,user_id,profession_code) VALUES($1,$2,$3) ON CONFLICT(group_id,user_id,profession_code) DO NOTHING",[ctx.chatId,ctx.userId,professionCode]);
  return (await ctx.pool.query<any>("SELECT * FROM game_world_career_stats WHERE group_id=$1 AND user_id=$2 AND profession_code=$3",[ctx.chatId,ctx.userId,professionCode])).rows[0];
}

function careerInstruction(professionCode:string){
  const lines:Record<string,string[]> = {
    seamstress:[
      "★ - کار ویژه : کارگاه خیاطی",
      "⛂ - دوخت لباس · 25 سکه هزینه مواد",
      "⛂ - هر دوخت یک کالای پوشیدنی به انبار حرفه‌ای اضافه می‌کند.",
      "⛂ - فروش لباس · هر قطعه 95 سکه",
      "⛂ - سفارش مستقیم دیگر بازیکنان در ادامه قابل ثبت است.",
    ],
    healer:[
      "★ - کار ویژه : درمان مرزی",
      "⛂ - «درمان» برای خودت سلامت را بازیابی می‌کند.",
      "⛂ - «درمان <شناسه کاربر>» یک بازیکن همان شهر را درمان می‌کند.",
      "⛂ - درمان دیگران هزینه دارد؛ مبلغ بین بیمار و درمانگر جابه‌جا می‌شود.",
    ],
    innkeeper:[
      "★ - کار ویژه : مهمانخانه",
      "⛂ - «اقامت» برای خودت یک نوبت استراحت ثبت می‌کند.",
      "⛂ - «اقامت <شناسه کاربر>» برای یک بازیکن دیگر اقامت ثبت می‌کند.",
      "⛂ - اقامت انرژی و گرسنگی را بهبود می‌دهد و برای مهمانخانه درآمد می‌سازد.",
    ],
    frontier_journalist:[
      "★ - کار ویژه : گزارش مرزی",
      "⛂ - هر گزارش یک خبر محلی واقعی در پرونده همان شهر ثبت می‌کند.",
      "⛂ - گزارش موفق Reputation و تجربه حرفه‌ای می‌دهد.",
      "⛂ - خبرهای تو مستقیماً در THE FRONTIER NEWS دیده می‌شوند.",
    ],
    schoolteacher:[
      "★ - کار ویژه : کلاس مرزی",
      "⛂ - «آموزش» برای خودت تجربه آموزشی ثبت می‌کند.",
      "⛂ - «آموزش <شناسه کاربر>» به یک بازیکن همان شهر تجربه می‌دهد.",
      "⛂ - آموزش دیگران هزینه دارد و سهمی برای معلم ثبت می‌کند.",
    ],
    saloon_keeper:[
      "★ - کار ویژه : شب سالون",
      "⛂ - هر نوبت یک رویداد اجتماعی محلی ثبت می‌کند.",
      "⛂ - اگر سالون شخصی داشته باشی، درآمد و Reputation بیشتری می‌گیری.",
      "⛂ - رویداد در روزنامه و پرونده رویدادهای شهر ثبت می‌شود.",
    ],
  };
  return (lines[professionCode]??["★ - کار ویژه : این حرفه هنوز دفتر اختصاصی ندارد."]).join("\n");
}

async function careerText(ctx:FrontierExpansionContext){
  const a=await account(ctx);
  if(!a)return "✗ اکانت بازی پیدا نشد.";
  const p=(await ctx.pool.query<any>("SELECT * FROM game_world_professions WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId])).rows[0];
  if(!p)return ["◈ کار ویژه","",SEP,"","⛂ - ابتدا یک حرفه انتخاب کن.","",SEP].join("\n");
  const prof=PROFESSIONS[String(p.profession_code)];
  const s=await ensureCareerStats(ctx,String(p.profession_code));
  const lines=[
    isWoman(a)?"◈ مسیر حرفه‌ای · بانوی مرز":"◈ کار ویژه · مسیر حرفه‌ای",
    "",
    SEP,
    "",
    "★ - حرفه : "+prof.name+" · سطح "+fa(+p.level),
    "⛂ - نوبت‌های ویژه انجام‌شده : "+fa(+s.action_count),
    "⛂ - خدمات به دیگران : "+fa(+s.service_count),
    "⛂ - درآمد ثبت‌شده از مسیر ویژه : "+money(+s.career_revenue),
    "⛂ - Reputation به‌دست‌آمده : "+fa(+s.reputation_earned),
  ];
  if(p.profession_code==="seamstress")lines.push("⛂ - لباس‌های آماده : "+fa(+s.goods_stock));
  lines.push("",careerInstruction(String(p.profession_code)),"","« این شغل برای اسمش حقوق نمی‌گیرد؛ برای کاری که در مرز انجام می‌دهد پول می‌گیرد.»","",SEP);
  return lines.join("\n");
}

async function professionText(ctx:FrontierExpansionContext){
  const a=await account(ctx);
  const p=(await ctx.pool.query<any>("SELECT * FROM game_world_professions WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId])).rows[0];
  const woman=isWoman(a);
  const womenJobs=Object.values(PROFESSIONS).filter(x=>x.womenOnly);
  return [
    woman ? "◈ کار و مهارت · مسیر بانوی مرز" : "◈ کار و مهارت",
    "",
    SEP,
    "",
    p
      ? "★ - حرفه فعلی : "+(PROFESSIONS[String(p.profession_code)]?.name??p.profession_code)+" · سطح "+fa(+p.level)+" · تجربه "+fa(+p.xp)
      : "★ - هنوز حرفه‌ای انتخاب نکرده‌ای.",
    "",
    woman
      ? "برای بانوان مرز، چند مسیر شغلی اختصاصی هم در دفتر ثبت شده است؛ شغل‌های عمومی هم همچنان باز هستند."
      : "هر حرفه درآمد و زمان خودش را دارد؛ مرز برای وقت تلف‌شده پول نمی‌دهد.",
    "",
    woman ? "★ - مسیرهای اختصاصی بانوان" : "★ - حرفه‌های ثبت‌شده",
    ...(woman ? womenJobs.map(x=>"⛂ - "+x.name+" · درآمد "+money(x.pay)) : []),
    "",
    frontierVoice(woman),
    "",
    SEP
  ].join("\n");
}

async function lawText(ctx:FrontierExpansionContext){
  await ctx.pool.query("INSERT INTO game_world_wanted(group_id,user_id) VALUES($1,$2) ON CONFLICT(group_id,user_id) DO NOTHING",[ctx.chatId,ctx.userId]);
  const w=(await ctx.pool.query<any>("SELECT * FROM game_world_wanted WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId])).rows[0];
  return ["◈ قانون و شهرت","",SEP,"","★ - وضعیت : "+(+w.wanted_level>0?"تحت تعقیب":"بی‌حاشیه"),"⛂ - سطح تحت تعقیب : "+fa(+w.wanted_level),"⛂ - جایزه روی سرت : "+money(+w.bounty),"⛂ - اعتبار اجتماعی : برای اکانت اصلی جداگانه ثبت می‌شود.","","« در این مرز، مردم خاطره بد را از بدهی هم بهتر به یاد می‌سپارند.»","",SEP].join("\n");
}

async function seedMissions(ctx:FrontierExpansionContext){
  const day=new Date().toISOString().slice(0,10);
  const defs=[["work_3","سه نوبت کار","3",180,70],["farm_1","یک برداشت موفق","1",150,60],["tool_1","یک ابزار بخر","1",120,45]];
  for(const d of defs)await ctx.pool.query("INSERT INTO game_world_player_missions(group_id,user_id,code,title,target,reward_coins,reward_xp,claim_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(group_id,user_id,code) DO UPDATE SET title=EXCLUDED.title,target=EXCLUDED.target,reward_coins=EXCLUDED.reward_coins,reward_xp=EXCLUDED.reward_xp,claim_key=EXCLUDED.claim_key,updated_at=NOW()",[ctx.chatId,ctx.userId,d[0],d[1],Number(d[2]),Number(d[3]),Number(d[4]),day]);
  return (await ctx.pool.query<any>("SELECT * FROM game_world_player_missions WHERE group_id=$1 AND user_id=$2 ORDER BY code",[ctx.chatId,ctx.userId])).rows;
}

async function missionText(ctx:FrontierExpansionContext){
  const rows=await seedMissions(ctx);
  return ["◈ مأموریت‌های مرزی","",SEP,"",...rows.map((r:any)=>"★ - "+r.title+" · "+fa(Math.min(+r.progress,+r.target))+" / "+fa(+r.target)+" · "+(r.claimed?"دریافت شد":"+ "+money(+r.reward_coins))),"", "« مرز برای کسی که فقط نگاه می‌کند جایزه کنار نمی‌گذارد.»","",SEP].join("\n");
}

async function mapText(ctx:FrontierExpansionContext){
  const cities=(await ctx.pool.query<any>("SELECT name,population_count,region_name FROM game_world_settlements WHERE settlement_kind='city' AND is_public=TRUE ORDER BY population_count DESC,settlement_id LIMIT 12")).rows;
  const region=["Dry Basin","Red Rock","Silver Range","Dust Prairie","Black Canyon","Copper Pass"][Math.abs(ctx.chatId)%6];
  return ["◈ نقشه مرز","",SEP,"","★ - منطقه فعلی : "+region,"⛂ - مسیر : روستاهای مرزی → شهرها → مسیرهای دوردست","⛂ - زمان سفر بر اساس فاصله و وسیله تغییر می‌کند.","","★ - شهرهای ثبت‌شده",...(cities.length?cities.map((c:any)=>"⛂ - "+c.name+" · جمعیت "+fa(+c.population_count)):["⛂ - هنوز شهر عمومی دیگری ثبت نشده است."]),"","« هر جاده‌ای که روی نقشه است، لزوماً جاده امنی نیست.»","",SEP].join("\n");
}

async function seedEvent(ctx:FrontierExpansionContext){
  const hour=new Date();
  const key=hour.toISOString().slice(0,13);
  const local=[
    ["بازار مرزی شلوغ شد","ورود کاروان تازه، خرید کالا را بیشتر کرده است."],
    ["باران روی مرز","مزرعه‌های منطقه امروز آب بیشتری در اختیار دارند."],
    ["خبر معدن","جویندگان طلا در جاده شمالی بیشتر دیده می‌شوند."],
    ["راه بسته","یک مسیر فرعی موقتاً کندتر از معمول شده است."],
  ][hour.getUTCHours()%4];
  await ctx.pool.query("INSERT INTO game_world_events(scope,group_id,title,body,event_key,expires_at) VALUES('local',$1,$2,$3,$4,NOW()+INTERVAL '1 hour') ON CONFLICT DO NOTHING",[ctx.chatId,local[0],local[1],key]);
  const globalKey="global-"+key;
  const global=[
    ["قیمت فلزات بالا رفت","بازارهای مرزی برای فلزات تقاضای بیشتری نشان می‌دهند."],
    ["قطار زودتر رسید","کاروان‌های ریلی مسیر غرب را کمی سریع‌تر طی می‌کنند."],
    ["فصل برداشت نزدیک است","کشاورزان سراسر مرز زمین‌هایشان را آماده می‌کنند."],
    ["هجوم به شهرها","شهرهای بزرگ امروز رفت‌وآمد بیشتری می‌بینند."],
  ][hour.getUTCHours()%4];
  await ctx.pool.query("INSERT INTO game_world_events(scope,group_id,title,body,event_key,expires_at) VALUES('global',NULL,$1,$2,$3,NOW()+INTERVAL '1 hour') ON CONFLICT DO NOTHING",[global[0],global[1],globalKey]);
}

async function eventsText(ctx:FrontierExpansionContext){
  await seedEvent(ctx);
  const rows=(await ctx.pool.query<any>("SELECT * FROM game_world_events WHERE (scope='local' AND group_id=$1) OR scope='global' ORDER BY created_at DESC LIMIT 8",[ctx.chatId])).rows;
  return ["◈ رویدادهای جهان","",SEP,"",...rows.map((r:any)=>"★ - "+r.title+"\n⛂ - "+r.body),"", "« مرز آرام نمی‌ماند؛ فقط گاهی صدایش را پایین می‌آورد.»","",SEP].join("\n");
}

async function bandText(ctx:FrontierExpansionContext){
  const band=(await ctx.pool.query<any>("SELECT * FROM game_world_bands WHERE group_id=$1",[ctx.chatId])).rows[0];
  const open=(await ctx.pool.query<any>("SELECT id,title,reward,status FROM game_world_contracts WHERE group_id=$1 AND status='open' AND expires_at>NOW() ORDER BY created_at DESC LIMIT 8",[ctx.chatId])).rows;
  return ["◈ باند و قرارداد","",SEP,"",band?"★ - باند : "+band.name+" · خزانه "+money(+band.treasury):"★ - هنوز باندی در این روستا ساخته نشده است.","","★ - قراردادهای باز",...(open.length?open.map((x:any)=>"⛂ - #"+fa(+x.id)+" · "+x.title+" · "+money(+x.reward)):["⛂ - قرارداد بازی فعالی وجود ندارد."]),"","« یک نفر می‌تواند کار را شروع کند؛ چند نفر می‌توانند آن را بزرگ کنند.»","",SEP].join("\n");
}

function menuResult(text:string,userId:number):FrontierExpansionResult{
  return {text,replyMarkup:expansionMenu(userId)};
}

async function upgradeHome(ctx:FrontierExpansionContext){
  const a=await account(ctx); if(!a)return {text:"✗ اکانت بازی پیدا نشد."};
  const p=await assets(ctx), next=+p.home_level+1, cost=next*700;
  const client=await ctx.pool.connect();
  try{
    await client.query("BEGIN");
    const locked=(await client.query<any>("SELECT * FROM game_world_accounts WHERE group_id=$1 AND user_id=$2 FOR UPDATE",[ctx.chatId,ctx.userId])).rows[0];
    if(+locked.coins<cost){await client.query("ROLLBACK");return {text:"✗ برای ارتقای خانه "+money(cost)+" لازم داری."};}
    await client.query("UPDATE game_world_accounts SET coins=coins-$3 WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,cost]);
    await client.query("UPDATE game_world_personal_assets SET home_level=home_level+1,land_value=land_value+$3,updated_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,cost]);
    await recordEconomy(ctx.pool,ctx.chatId,ctx.userId,"expense",cost,"ارتقای خانه","home");
    await client.query("COMMIT");
  }catch(e){await client.query("ROLLBACK").catch(()=>{});throw e;}finally{client.release();}
  return {text:"✓ خانه‌ات یک پله بالاتر رفت. مرز حالا کمی بیشتر روی نام تو حساب می‌کند.",replyMarkup:back(ctx.userId)};
}

async function upgradeLand(ctx:FrontierExpansionContext){
  const p=await assets(ctx), next=+p.land_level+1, cost=next*500;
  const a=await account(ctx); if(!a)return {text:"✗ اکانت بازی پیدا نشد.",replyMarkup:back(ctx.userId)};
  const client=await ctx.pool.connect();
  try{
    await client.query("BEGIN");
    const locked=(await client.query<any>("SELECT * FROM game_world_accounts WHERE group_id=$1 AND user_id=$2 FOR UPDATE",[ctx.chatId,ctx.userId])).rows[0];
    if(+locked.coins<cost){await client.query("ROLLBACK");return {text:"✗ برای خرید قطعه زمین بعدی "+money(cost)+" لازم داری.",replyMarkup:back(ctx.userId)};}
    await client.query("UPDATE game_world_accounts SET coins=coins-$3 WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,cost]);
    await client.query("UPDATE game_world_personal_assets SET land_level=land_level+1,land_value=land_value+$3,updated_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,cost]);
    await recordEconomy(ctx.pool,ctx.chatId,ctx.userId,"expense",cost,"توسعه زمین","land");
    await client.query("COMMIT");
  }catch(e){await client.query("ROLLBACK").catch(()=>{});throw e;}finally{client.release();}
  return {text:"✓ زمینت توسعه پیدا کرد. قطعه بعدی حالا به ملک تو اضافه شده است.",replyMarkup:back(ctx.userId)};
}

async function upgradeStorage(ctx:FrontierExpansionContext){
  const p=await assets(ctx), next=+p.storage_level+1, cost=next*450;
  const a=await account(ctx); if(!a)return {text:"✗ اکانت بازی پیدا نشد.",replyMarkup:back(ctx.userId)};
  if(+a.coins<cost)return {text:"✗ برای ارتقای انبار "+money(cost)+" لازم داری.",replyMarkup:back(ctx.userId)};
  await ctx.pool.query("UPDATE game_world_accounts SET coins=coins-$3 WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,cost]);
  await ctx.pool.query("UPDATE game_world_personal_assets SET storage_level=storage_level+1,updated_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId]);
  await recordEconomy(ctx.pool,ctx.chatId,ctx.userId,"expense",cost,"ارتقای انبار","storage");
  return {text:"✓ انبار توسعه پیدا کرد؛ حالا می‌توانی کالای بیشتری نگه داری.",replyMarkup:back(ctx.userId)};
}

async function plant(ctx:FrontierExpansionContext,code:string){
  const crop=CROPS[code], a=await assets(ctx), ac=await account(ctx);
  if(!crop)return {text:"✗ این محصول برای کشت ثبت نشده است.",replyMarkup:back(ctx.userId)};
  if(a.farm_crop)return {text:"✗ زمینت هنوز محصول قبلی را دارد.",replyMarkup:back(ctx.userId)};
  if(+ac.coins<crop.seed)return {text:"✗ بذر این محصول "+money(crop.seed)+" قیمت دارد.",replyMarkup:back(ctx.userId)};
  const ready=new Date(Date.now()+crop.minutes*60000);
  await ctx.pool.query("UPDATE game_world_accounts SET coins=coins-$3 WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,crop.seed]);
  await ctx.pool.query("UPDATE game_world_personal_assets SET farm_crop=$3,farm_planted_at=NOW(),farm_ready_at=$4,farm_water=100,farm_health=100,updated_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,code,ready]);
  await recordEconomy(ctx.pool,ctx.chatId,ctx.userId,"expense",crop.seed,"خرید بذر",code);
  return {text:["✓ کاشت انجام شد.","","⛂ - محصول : "+crop.name,"⛂ - زمان رشد : "+fa(crop.minutes)+" دقیقه","⛂ - برداشت : "+fa(crop.yield),"","« حالا باید بگذاری زمین کار خودش را بکند.»"].join("\n"),replyMarkup:back(ctx.userId)};
}

async function harvest(ctx:FrontierExpansionContext){
  const a=await assets(ctx);
  if(!a.farm_crop)return {text:"✗ محصولی برای برداشت نداری.",replyMarkup:back(ctx.userId)};
  if(!a.farm_ready_at||new Date(a.farm_ready_at).getTime()>Date.now())return {text:"⛂ - محصول هنوز آماده نیست. چند دقیقه دیگر سر بزن.",replyMarkup:back(ctx.userId)};
  const crop=CROPS[String(a.farm_crop)], yieldAmount=crop?.yield??5;
  const value=yieldAmount*10;
  await ctx.pool.query("UPDATE game_world_personal_assets SET farm_crop=NULL,farm_planted_at=NULL,farm_ready_at=NULL,farm_water=100,updated_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId]);
  await ctx.pool.query("UPDATE game_world_accounts SET coins=coins+$3,xp=xp+$4,last_active_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,value,Math.floor(yieldAmount*4)]);
  await recordEconomy(ctx.pool,ctx.chatId,ctx.userId,"income",value,"برداشت مزرعه",String(crop?.name??a.farm_crop));
  await ctx.pool.query("UPDATE game_world_player_missions SET progress=LEAST(target,progress+1),updated_at=NOW() WHERE group_id=$1 AND user_id=$2 AND code='farm_1' AND claim_key=$3",[ctx.chatId,ctx.userId,new Date().toISOString().slice(0,10)]);
  return {text:["✓ برداشت انجام شد.","","⛂ - محصول : "+(crop?.name??String(a.farm_crop)),"⛂ - مقدار : "+fa(yieldAmount),"⛂ - ارزش فروش : "+money(value),"⛂ - تجربه : +"+fa(Math.floor(yieldAmount*4)),"","« محصول خوب همیشه مشتری خودش را پیدا می‌کند.»"].join("\n"),replyMarkup:back(ctx.userId)};
}

async function buyHorse(ctx:FrontierExpansionContext){
  const a=await assets(ctx), ac=await account(ctx);
  if(a.horse_name)return {text:"⛂ - تو همین حالا اسب داری : "+String(a.horse_name),replyMarkup:back(ctx.userId)};
  const cost=700;
  if(+ac.coins<cost)return {text:"✗ اسب مرزی "+money(cost)+" قیمت دارد.",replyMarkup:back(ctx.userId)};
  await ctx.pool.query("UPDATE game_world_accounts SET coins=coins-$3 WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,cost]);
  await ctx.pool.query("UPDATE game_world_personal_assets SET horse_name=$3,horse_breed='Quarter Horse',horse_level=1,horse_health=100,horse_speed=7,horse_stamina=80,stable_level=1,updated_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,"Dusty"]);
  await recordEconomy(ctx.pool,ctx.chatId,ctx.userId,"expense",cost,"خرید اسب","horse");
  return {text:["✓ اسب خریداری شد.","","⛂ - نام : Dusty","⛂ - نژاد : Quarter Horse","⛂ - سرعت : 7","⛂ - استقامت : 80","⛂ - هزینه : "+money(cost),"","« از این به بعد بخشی از راه را چهار پا طی می‌کنی؛ خرجش هم با توست.»"].join("\n"),replyMarkup:back(ctx.userId)};
}

async function buyTool(ctx:FrontierExpansionContext,code:string){
  const t=TOOLS[code], a=await account(ctx); if(!t||!a)return {text:"✗ ابزار پیدا نشد.",replyMarkup:back(ctx.userId)};
  if(+a.coins<t.cost)return {text:"✗ برای این ابزار "+money(t.cost)+" لازم داری.",replyMarkup:back(ctx.userId)};
  await ctx.pool.query("UPDATE game_world_accounts SET coins=coins-$3 WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,t.cost]);
  await ctx.pool.query("INSERT INTO game_world_tools(group_id,user_id,tool_code,level,durability,quantity) VALUES($1,$2,$3,1,$4,1) ON CONFLICT(group_id,user_id,tool_code) DO UPDATE SET quantity=game_world_tools.quantity+1,durability=GREATEST(game_world_tools.durability,$4),updated_at=NOW()",[ctx.chatId,ctx.userId,code,t.durability]);
  await recordEconomy(ctx.pool,ctx.chatId,ctx.userId,"expense",t.cost,"خرید ابزار",t.name);
  await ctx.pool.query("UPDATE game_world_player_missions SET progress=LEAST(target,progress+1),updated_at=NOW() WHERE group_id=$1 AND user_id=$2 AND code='tool_1' AND claim_key=$3",[ctx.chatId,ctx.userId,new Date().toISOString().slice(0,10)]);
  return {text:"✓ "+t.name+" به انبارت اضافه شد.",replyMarkup:back(ctx.userId)};
}

async function chooseProfession(ctx:FrontierExpansionContext,code:string){
  const p=PROFESSIONS[code]; if(!p)return {text:"✗ این حرفه در دفتر مرز ثبت نشده است.",replyMarkup:back(ctx.userId)};
  const a=await account(ctx);
  if(p.womenOnly && !isWoman(a))return {text:"⛂ - این مسیر شغلی در دفتر بانوان مرز ثبت شده است؛ حرفه‌های عمومی برای همه باز هستند.",replyMarkup:back(ctx.userId)};
  await ctx.pool.query("INSERT INTO game_world_professions(group_id,user_id,profession_code) VALUES($1,$2,$3) ON CONFLICT(group_id,user_id) DO UPDATE SET profession_code=EXCLUDED.profession_code,updated_at=NOW()",[ctx.chatId,ctx.userId,code]);
  await ensureCareerStats(ctx,code);
  await ctx.pool.query("UPDATE game_world_accounts SET job_code=$3,last_active_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,p.name]);
  return {text:["✓ حرفه ثبت شد.","","⛂ - حرفه : "+p.name,"⛂ - درآمد پایه هر نوبت : "+money(p.pay),"⛂ - تجربه : +"+fa(p.xp),"⛂ - زمان انتظار : "+fa(p.cooldown)+" ثانیه","",isWoman(a)?"« حالا یک مهارت داری که می‌تواند نامت را در این مرز بالا ببرد.»":"« حالا یک مهارت داری که می‌تواند برایت نان بیاورد.»"].join("\n"),replyMarkup:back(ctx.userId)};
}

async function careerCooldown(ctx:FrontierExpansionContext,p:any){
  const last=p.career_last_action_at?new Date(p.career_last_action_at).getTime():0;
  const remain=Math.max(0,Math.ceil((last+45_000-Date.now())/1000));
  if(remain>0)return "⛂ - کار ویژه بعدی تا "+fa(remain)+" ثانیه دیگر آماده می‌شود.";
  return null;
}

async function touchCareer(ctx:FrontierExpansionContext,code:string,revenue:number=0,service=false,repGain=0,goodsDelta=0){
  await ctx.pool.query("INSERT INTO game_world_career_stats(group_id,user_id,profession_code) VALUES($1,$2,$3) ON CONFLICT(group_id,user_id,profession_code) DO NOTHING",[ctx.chatId,ctx.userId,code]);
  await ctx.pool.query(
    "UPDATE game_world_career_stats SET action_count=action_count+1,service_count=service_count+$4,career_revenue=career_revenue+$3,reputation_earned=reputation_earned+$5,goods_stock=GREATEST(0,goods_stock+$6),last_action_at=NOW(),updated_at=NOW() WHERE group_id=$1 AND user_id=$2 AND profession_code=$7",
    [ctx.chatId,ctx.userId,revenue,service?1:0,repGain,goodsDelta,code]
  );
  await ctx.pool.query("UPDATE game_world_professions SET career_actions=career_actions+1,career_value=career_value+$3,career_last_action_at=NOW(),updated_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,revenue]);
}

async function findTarget(ctx:FrontierExpansionContext,raw:string){
  const id=Number(raw);
  if(!Number.isInteger(id)||id<=0)return null;
  return (await ctx.pool.query<any>("SELECT * FROM game_world_accounts WHERE group_id=$1 AND user_id=$2 FOR UPDATE",[ctx.chatId,id])).rows[0]??null;
}

async function doCareerAction(ctx:FrontierExpansionContext,action:string,targetRaw?:string):Promise<FrontierExpansionResult>{
  const a=await account(ctx);
  const p=(await ctx.pool.query<any>("SELECT * FROM game_world_professions WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId])).rows[0];
  if(!a||!p)return {text:"✗ اول یک حرفه انتخاب کن.",replyMarkup:back(ctx.userId)};
  const prof=PROFESSIONS[String(p.profession_code)];
  if(!prof?.womenOnly)return {text:"⛂ - این مسیر حرفه‌ای ویژه، برای مشاغل دفتر بانوان مرز فعال است.",replyMarkup:back(ctx.userId)};
  const cd=await careerCooldown(ctx,p);
  if(cd)return {text:cd,replyMarkup:back(ctx.userId)};

  if(p.profession_code==="seamstress"){
    if(action==="sell"){
      const s=await ensureCareerStats(ctx,"seamstress");
      if(+s.goods_stock<=0)return {text:"✗ هنوز لباس آماده فروش نداری.",replyMarkup:back(ctx.userId)};
      const amount=95;
      await ctx.pool.query("UPDATE game_world_career_stats SET goods_stock=goods_stock-1,career_revenue=career_revenue+$3,updated_at=NOW() WHERE group_id=$1 AND user_id=$2 AND profession_code='seamstress' AND goods_stock>0",[ctx.chatId,ctx.userId,amount]);
      await ctx.pool.query("UPDATE game_world_accounts SET coins=coins+$3,xp=xp+18,last_active_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,amount]);
      await ctx.pool.query("UPDATE game_world_professions SET career_actions=career_actions+1,career_value=career_value+$3,career_last_action_at=NOW(),updated_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,amount]);
      await recordEconomy(ctx.pool,ctx.chatId,ctx.userId,"income",amount,"فروش لباس","seamstress");
      return {text:["✓ لباس فروخته شد.","","⛂ - قیمت فروش : "+money(amount),"⛂ - تجربه : +"+fa(18),"⛂ - موجودی لباس : "+fa(+s.goods_stock-1),"","« دوخت خوب وقتی وارد بازار شود، دیگر فقط نخ و پارچه نیست؛ کالاست.»"].join("\n"),replyMarkup:back(ctx.userId)};
    }
    const cost=25;
    if(+a.coins<cost)return {text:"✗ برای پارچه و مواد اولیه "+money(cost)+" لازم داری.",replyMarkup:back(ctx.userId)};
    await ctx.pool.query("UPDATE game_world_accounts SET coins=coins-$3,xp=xp+20,last_active_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,cost]);
    await touchCareer(ctx,"seamstress",0,false,2,1);
    await recordEconomy(ctx.pool,ctx.chatId,ctx.userId,"expense",25,"مواد اولیه خیاطی","دوخت لباس");
    return {text:["✓ یک لباس مرزی دوخته شد.","","⛂ - هزینه مواد : "+money(cost),"⛂ - محصول آماده : +1 لباس","⛂ - Reputation : +2","⛂ - تجربه : +20","",careerInstruction("seamstress")].join("\n"),replyMarkup:{inline_keyboard:[
      [{text:"‹ فروش یک لباس · 95",callback_data:"world:expand:career:sell:"+ctx.userId}],
      [{text:"‹ دفتر کار",callback_data:"world:expand:career:"+ctx.userId}]
    ]}};
  }

  if(p.profession_code==="healer"){
    const target=targetRaw?await findTarget(ctx,targetRaw):a;
    if(!target)return {text:"✗ بازیکن موردنظر در این شهر پیدا نشد.",replyMarkup:back(ctx.userId)};
    const self=+target.user_id===ctx.userId;
    const price=self?0:50;
    if(!self && +target.coins<price)return {text:"✗ این بازیکن برای درمان "+money(price)+" موجودی ندارد.",replyMarkup:back(ctx.userId)};
    const before=+target.health;
    const healed=Math.min(100,before+25)-before;
    if(healed<=0)return {text:"⛂ - سلامت این بازیکن همین حالا کامل است.",replyMarkup:back(ctx.userId)};
    const client=await ctx.pool.connect();
    try{
      await client.query("BEGIN");
      const patient=(await client.query<any>("SELECT * FROM game_world_accounts WHERE group_id=$1 AND user_id=$2 FOR UPDATE",[ctx.chatId,+target.user_id])).rows[0];
      if(!patient){await client.query("ROLLBACK");return {text:"✗ بازیکن موردنظر پیدا نشد.",replyMarkup:back(ctx.userId)};}
      if(!self&&+patient.coins<price){await client.query("ROLLBACK");return {text:"✗ موجودی بیمار برای درمان کافی نیست.",replyMarkup:back(ctx.userId)};}
      const gain=Math.min(100,+patient.health+25);
      await client.query("UPDATE game_world_accounts SET health=$3 WHERE group_id=$1 AND user_id=$2",[ctx.chatId,+target.user_id,gain]);
      if(!self)await client.query("UPDATE game_world_accounts SET coins=coins-$3 WHERE group_id=$1 AND user_id=$2",[ctx.chatId,+target.user_id,price]);
      await client.query("UPDATE game_world_accounts SET coins=coins+$3,xp=xp+24,reputation=reputation+$4,last_active_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,self?2:price,2]);
      await client.query("COMMIT");
    }catch(e){await client.query("ROLLBACK").catch(()=>{});throw e;}finally{client.release();}
    await touchCareer(ctx,"healer",self?2:price,true,3,0);
    await recordEconomy(ctx.pool,ctx.chatId,ctx.userId,"income",self?2:price,"درمان مرزی","healer");
    if(!self)await recordEconomy(ctx.pool,ctx.chatId,+target.user_id,"expense",price,"خدمات درمانی","healer");
    return {text:["✓ درمان مرزی انجام شد.","","⛂ - بیمار : "+(self?"خودت":String(target.first_name??target.username??target.user_id)),"⛂ - سلامت : "+fa(before)+"% → "+fa(before+healed)+"%","⛂ - درآمد درمانگر : +"+money(self?2:price),"⛂ - Reputation : +3","","« درمانگر خوب منتظر نمی‌ماند زخمی عمیق‌تر شود.»"].join("\n"),replyMarkup:back(ctx.userId)};
  }

  if(p.profession_code==="innkeeper"){
    const target=targetRaw?await findTarget(ctx,targetRaw):a;
    if(!target)return {text:"✗ مهمان در این شهر پیدا نشد.",replyMarkup:back(ctx.userId)};
    const self=+target.user_id===ctx.userId;
    const price=self?0:60;
    if(!self&&+target.coins<price)return {text:"✗ مهمان برای اقامت "+money(price)+" موجودی کافی ندارد.",replyMarkup:back(ctx.userId)};
    const client=await ctx.pool.connect();
    try{
      await client.query("BEGIN");
      const guest=(await client.query<any>("SELECT * FROM game_world_accounts WHERE group_id=$1 AND user_id=$2 FOR UPDATE",[ctx.chatId,+target.user_id])).rows[0];
      if(!guest){await client.query("ROLLBACK");return {text:"✗ مهمان پیدا نشد.",replyMarkup:back(ctx.userId)};}
      if(!self&&+guest.coins<price){await client.query("ROLLBACK");return {text:"✗ موجودی مهمان کافی نیست.",replyMarkup:back(ctx.userId)};}
      if(!self)await client.query("UPDATE game_world_accounts SET coins=coins-$3 WHERE group_id=$1 AND user_id=$2",[ctx.chatId,+target.user_id,price]);
      await client.query("UPDATE game_world_accounts SET energy=LEAST(100,energy+25),hunger=LEAST(100,hunger+20),last_active_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,+target.user_id]);
      await client.query("UPDATE game_world_accounts SET coins=coins+$3,xp=xp+22,reputation=reputation+$4,last_active_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,self?2:price,2]);
      await client.query("COMMIT");
    }catch(e){await client.query("ROLLBACK").catch(()=>{});throw e;}finally{client.release();}
    await touchCareer(ctx,"innkeeper",self?2:price,true,2,0);
    await recordEconomy(ctx.pool,ctx.chatId,ctx.userId,"income",self?2:price,"اقامت مرزی","innkeeper");
    if(!self)await recordEconomy(ctx.pool,ctx.chatId,+target.user_id,"expense",price,"اقامت مرزی","innkeeper");
    return {text:["✓ اقامت ثبت شد.","","⛂ - مهمان : "+(self?"خودت":String(target.first_name??target.username??target.user_id)),"⛂ - انرژی : +25","⛂ - گرسنگی : +20","⛂ - درآمد مهمانخانه : +"+money(self?2:price),"⛂ - Reputation : +2","","« مهمانخانه خوب جایی است که مسافر صبح بتواند راهش را ادامه بدهد.»"].join("\n"),replyMarkup:back(ctx.userId)};
  }

  if(p.profession_code==="frontier_journalist"){
    const seq=Date.now().toString(36).slice(-6).toUpperCase();
    const title="گزارش تازه از مرز #"+seq;
    const body="روزنامه‌نگار محلی امروز گزارشی از زندگی و رفت‌وآمد این شهر ثبت کرد.";
    await ctx.pool.query("INSERT INTO game_world_news(scope,group_id,title,body,severity) VALUES('local',$1,$2,$3,'info')",[ctx.chatId,title,body]);
    await ctx.pool.query("INSERT INTO game_world_events(scope,group_id,title,body,event_key,expires_at) VALUES('local',$1,$2,$3,$4,NOW()+INTERVAL '2 hours') ON CONFLICT DO NOTHING",[ctx.chatId,title,body,"journal-"+seq]);
    await ctx.pool.query("UPDATE game_world_accounts SET coins=coins+85,xp=xp+38,reputation=reputation+10,last_active_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId]);
    await touchCareer(ctx,"frontier_journalist",85,false,10,0);
    await recordEconomy(ctx.pool,ctx.chatId,ctx.userId,"income",85,"گزارش مرزی","journalist");
    return {text:["✓ گزارش مرزی منتشر شد.","","⛂ - عنوان : "+title,"⛂ - درآمد : +"+money(85),"⛂ - تجربه : +38","⛂ - Reputation : +10","⛂ - محل انتشار : THE FRONTIER NEWS","","« خبر وقتی ارزش دارد که مردم فردا بتوانند نتیجه‌اش را ببینند.»"].join("\n"),replyMarkup:back(ctx.userId)};
  }

  if(p.profession_code==="schoolteacher"){
    const target=targetRaw?await findTarget(ctx,targetRaw):a;
    if(!target)return {text:"✗ شاگرد موردنظر در این شهر پیدا نشد.",replyMarkup:back(ctx.userId)};
    const self=+target.user_id===ctx.userId;
    const price=self?0:40;
    if(!self&&+target.coins<price)return {text:"✗ شاگرد برای این درس "+money(price)+" موجودی کافی ندارد.",replyMarkup:back(ctx.userId)};
    const client=await ctx.pool.connect();
    try{
      await client.query("BEGIN");
      const student=(await client.query<any>("SELECT * FROM game_world_accounts WHERE group_id=$1 AND user_id=$2 FOR UPDATE",[ctx.chatId,+target.user_id])).rows[0];
      if(!student){await client.query("ROLLBACK");return {text:"✗ شاگرد پیدا نشد.",replyMarkup:back(ctx.userId)};}
      if(!self&&+student.coins<price){await client.query("ROLLBACK");return {text:"✗ موجودی شاگرد کافی نیست.",replyMarkup:back(ctx.userId)};}
      if(!self)await client.query("UPDATE game_world_accounts SET coins=coins-$3 WHERE group_id=$1 AND user_id=$2",[ctx.chatId,+target.user_id,price]);
      await client.query("UPDATE game_world_accounts SET xp=xp+35,last_active_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,+target.user_id]);
      await client.query("UPDATE game_world_accounts SET coins=coins+$3,xp=xp+30,reputation=reputation+$4,last_active_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,self?2:price,3]);
      await client.query("COMMIT");
    }catch(e){await client.query("ROLLBACK").catch(()=>{});throw e;}finally{client.release();}
    await touchCareer(ctx,"schoolteacher",self?2:price,true,3,0);
    await recordEconomy(ctx.pool,ctx.chatId,ctx.userId,"income",self?2:price,"آموزش مرزی","teacher");
    if(!self)await recordEconomy(ctx.pool,ctx.chatId,+target.user_id,"expense",price,"هزینه آموزش","teacher");
    return {text:["✓ کلاس مرزی برگزار شد.","","⛂ - شاگرد : "+(self?"خودت":String(target.first_name??target.username??target.user_id)),"⛂ - تجربه شاگرد : +35","⛂ - درآمد معلم : +"+money(self?2:price),"⛂ - Reputation : +3","","« کلاس خوب چیزی به آدم می‌دهد که فردا بتواند از آن استفاده کند.»"].join("\n"),replyMarkup:back(ctx.userId)};
  }

  if(p.profession_code==="saloon_keeper"){
    const hasSaloon=(await ctx.pool.query<any>("SELECT 1 FROM game_world_businesses WHERE group_id=$1 AND user_id=$2 AND business_code='saloon' AND status='open' LIMIT 1",[ctx.chatId,ctx.userId])).rowCount>0;
    const base=hasSaloon?180:100;
    const repGain=hasSaloon?8:4;
    const title="شب سالون · "+nameOf(ctx);
    const body="یک شب اجتماعی در سالون برگزار شد و رفت‌وآمد محلی را بیشتر کرد.";
    await ctx.pool.query("INSERT INTO game_world_events(scope,group_id,title,body,event_key,expires_at) VALUES('local',$1,$2,$3,$4,NOW()+INTERVAL '2 hours') ON CONFLICT DO NOTHING",[ctx.chatId,title,body,"saloon-"+String(ctx.userId)+"-"+Date.now().toString(36)]);
    await ctx.pool.query("INSERT INTO game_world_news(scope,group_id,title,body,severity) VALUES('local',$1,$2,$3,'info')",[ctx.chatId,title,body]);
    await ctx.pool.query("UPDATE game_world_accounts SET coins=coins+$3,xp=xp+45,reputation=reputation+$4,last_active_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,base,repGain]);
    await touchCareer(ctx,"saloon_keeper",base,false,repGain,0);
    await recordEconomy(ctx.pool,ctx.chatId,ctx.userId,"income",base,"شب سالون","saloon");
    return {text:["✓ شب سالون برگزار شد.","","⛂ - درآمد : +"+money(base),"⛂ - تجربه : +45","⛂ - Reputation : +"+fa(repGain),"⛂ - اثر کسب‌وکار : "+(hasSaloon?"سالون شخصی داری؛ پاداش کامل فعال شد.":"بدون سالون شخصی؛ پاداش پایه ثبت شد."),"","« سالون خوب فقط محل نشستن نیست؛ جایی است که خبر و پول هر دو راه می‌افتند.»"].join("\n"),replyMarkup:back(ctx.userId)};
  }

  return {text:"✗ کار ویژه این حرفه هنوز ثبت نشده است.",replyMarkup:back(ctx.userId)};
}

async function doWork(ctx:FrontierExpansionContext){
  const p=(await ctx.pool.query<any>("SELECT * FROM game_world_professions WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId])).rows[0];
  if(!p)return {text:"✗ اول یک حرفه انتخاب کن.",replyMarkup:back(ctx.userId)};
  const prof=PROFESSIONS[String(p.profession_code)];
  if(!prof)return {text:"✗ مشخصات این حرفه پیدا نشد.",replyMarkup:back(ctx.userId)};
  const last=p.last_work_at?new Date(p.last_work_at).getTime():0;
  const remain=Math.max(0,Math.ceil((last+prof.cooldown*1000-Date.now())/1000));
  if(remain>0)return {text:["⛂ - نوبت کاری قبلی هنوز در فاصله انتظار است.","⛂ - زمان باقی‌مانده : "+fa(remain)+" ثانیه","","⛂ - نوبت کاری یعنی یک بار انجام کار حرفه‌ای و دریافت مزد همان نوبت.","⛂ - برداشت جداگانه برای درآمد شغلی لازم نیست."].join("\n"),replyMarkup:back(ctx.userId)};
  const pay=prof.pay+(+p.level-1)*25;
  const xp=prof.xp;
  const nextXp=+p.xp+xp;
  const nextLevel=Math.max(1,Math.floor(Math.sqrt(nextXp/100))+1);
  await ctx.pool.query("UPDATE game_world_accounts SET coins=coins+$3,xp=xp+$4,last_active_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,pay,xp]);
  await recordEconomy(ctx.pool,ctx.chatId,ctx.userId,"income",pay,"نوبت کاری · "+prof.name,prof.name);
  await ctx.pool.query("UPDATE game_world_professions SET xp=xp+$3,level=GREATEST(level,$4),last_work_at=NOW(),updated_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,xp,nextLevel]);
  await ctx.pool.query("UPDATE game_world_player_missions SET progress=LEAST(target,progress+1),updated_at=NOW() WHERE group_id=$1 AND user_id=$2 AND code='work_3' AND claim_key=$3",[ctx.chatId,ctx.userId,new Date().toISOString().slice(0,10)]);
  return {text:["✓ نوبت کاری انجام شد.","","★ - تسویه نوبت","⛂ - حرفه : "+prof.name,"⛂ - مزد این نوبت : +"+money(pay),"⛂ - موجودی نقد : "+money(+((await account(ctx))?.coins??0)),"⛂ - تجربه : +"+fa(xp),"⛂ - سطح حرفه : "+fa(nextLevel),"","★ - وضعیت","⛂ - این درآمد مستقیماً به موجودی نقد اضافه شد.","⛂ - برداشت جداگانه لازم نیست.","⛂ - نوبت بعدی پس از "+fa(prof.cooldown)+" ثانیه فعال می‌شود.","","« یک نوبت کاری تمام شد؛ مزدش همان لحظه تسویه شد.»"].join("\n"),replyMarkup:back(ctx.userId)};
}

async function bankMovement(ctx:FrontierExpansionContext,kind:"deposit"|"withdraw",amount:number){
  const ac=await account(ctx); const b=await ensureBank(ctx); if(!ac||!b)return {text:"✗ حساب بانکی آماده نیست.",replyMarkup:back(ctx.userId)};
  const client=await ctx.pool.connect();
  try{
    await client.query("BEGIN");
    const ca=(await client.query<any>("SELECT * FROM game_world_accounts WHERE group_id=$1 AND user_id=$2 FOR UPDATE",[ctx.chatId,ctx.userId])).rows[0];
    const cb=(await client.query<any>("SELECT * FROM game_world_bank_accounts WHERE group_id=$1 AND user_id=$2 FOR UPDATE",[ctx.chatId,ctx.userId])).rows[0];
    if(kind==="deposit"){
      if(+ca.coins<amount){await client.query("ROLLBACK");return {text:"✗ موجودی نقدت کافی نیست.",replyMarkup:back(ctx.userId)};}
      await client.query("UPDATE game_world_accounts SET coins=coins-$3 WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,amount]);
      await client.query("UPDATE game_world_bank_accounts SET balance=balance+$3,credit_score=LEAST(900,credit_score+2),updated_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,amount]);
      const after=+cb.balance+amount;
      await client.query("INSERT INTO game_world_bank_ledger(group_id,user_id,kind,amount,balance_after) VALUES($1,$2,'deposit',$3,$4)",[ctx.chatId,ctx.userId,amount,after]);
    }else{
      if(+cb.balance<amount){await client.query("ROLLBACK");return {text:"✗ موجودی بانک برای این برداشت کافی نیست.",replyMarkup:back(ctx.userId)};}
      await client.query("UPDATE game_world_bank_accounts SET balance=balance-$3,credit_score=GREATEST(300,credit_score-1),updated_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,amount]);
      await client.query("UPDATE game_world_accounts SET coins=coins+$3,last_active_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,amount]);
      const after=+cb.balance-amount;
      await client.query("INSERT INTO game_world_bank_ledger(group_id,user_id,kind,amount,balance_after) VALUES($1,$2,'withdraw',$3,$4)",[ctx.chatId,ctx.userId,amount,after]);
    }
    await client.query("COMMIT");
  }catch(e){await client.query("ROLLBACK").catch(()=>{});throw e;}finally{client.release();}
  return {text:"✓ عملیات بانکی انجام شد. حساب مرزی‌ات به‌روز شد.",replyMarkup:back(ctx.userId)};
}

async function payFine(ctx:FrontierExpansionContext){
  await ctx.pool.query("INSERT INTO game_world_wanted(group_id,user_id) VALUES($1,$2) ON CONFLICT(group_id,user_id) DO NOTHING",[ctx.chatId,ctx.userId]);
  const w=(await ctx.pool.query<any>("SELECT * FROM game_world_wanted WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId])).rows[0];
  if(+w.bounty<=0)return {text:"✓ پرونده‌ات پاک است.",replyMarkup:back(ctx.userId)};
  const ac=await account(ctx);
  if(+ac.coins<+w.bounty)return {text:"✗ سکه کافی برای تسویه پرونده نداری.",replyMarkup:back(ctx.userId)};
  await ctx.pool.query("UPDATE game_world_accounts SET coins=coins-$3 WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,w.bounty]);
  await ctx.pool.query("UPDATE game_world_wanted SET wanted_level=0,bounty=0,last_incident_at=NULL,updated_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId]);
  await recordEconomy(ctx.pool,ctx.chatId,ctx.userId,"expense",+w.bounty,"تسویه جریمه","wanted");
  return {text:"✓ جریمه پرداخت شد و نامت از دفتر تحت تعقیب پاک شد.",replyMarkup:back(ctx.userId)};
}

async function claimMission(ctx:FrontierExpansionContext,code:string){
  const rows=await seedMissions(ctx), m=rows.find((x:any)=>x.code===code);
  if(!m)return {text:"✗ مأموریت پیدا نشد.",replyMarkup:back(ctx.userId)};
  if(m.claimed)return {text:"⛂ - جایزه این مأموریت قبلاً دریافت شده است.",replyMarkup:back(ctx.userId)};
  if(+m.progress<+m.target)return {text:"⛂ - مأموریت هنوز کامل نشده است.",replyMarkup:back(ctx.userId)};
  await ctx.pool.query("UPDATE game_world_accounts SET coins=coins+$3,xp=xp+$4 WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,m.reward_coins,m.reward_xp]);
  await ctx.pool.query("UPDATE game_world_player_missions SET claimed=TRUE,updated_at=NOW() WHERE group_id=$1 AND user_id=$2 AND code=$3",[ctx.chatId,ctx.userId,code]);
  await recordEconomy(ctx.pool,ctx.chatId,ctx.userId,"income",+m.reward_coins,"جایزه مأموریت",code);
  return {text:"✓ جایزه مأموریت دریافت شد: "+money(+m.reward_coins)+" · تجربه +"+fa(+m.reward_xp),replyMarkup:back(ctx.userId)};
}

async function createBand(ctx:FrontierExpansionContext,bandName:string){
  const n=bandName.trim().replace(/\s+/g," ").slice(0,32);
  if(n.length<3)return {text:"✗ نام باند باید دست‌کم 3 حرف داشته باشد.",replyMarkup:back(ctx.userId)};
  const existing=(await ctx.pool.query<any>("SELECT * FROM game_world_bands WHERE group_id=$1",[ctx.chatId])).rows[0];
  if(existing)return {text:"⛂ - این روستا همین حالا یک باند ثبت‌شده دارد.",replyMarkup:back(ctx.userId)};
  const q=await ctx.pool.query<any>("INSERT INTO game_world_bands(group_id,founder_id,name) VALUES($1,$2,$3) RETURNING id",[ctx.chatId,ctx.userId,n]);
  const id=Number(q.rows[0].id);
  await ctx.pool.query("INSERT INTO game_world_band_members(band_id,user_id,role) VALUES($1,$2,'founder')",[id,ctx.userId]);
  return {text:"✓ باند «"+n+"» در این قلمرو ثبت شد.",replyMarkup:back(ctx.userId)};
}

async function createContract(ctx:FrontierExpansionContext,title:string,reward:number){
  const t=title.trim().slice(0,60); if(t.length<3)return {text:"✗ عنوان قرارداد کوتاه است.",replyMarkup:back(ctx.userId)};
  if(!Number.isFinite(reward)||reward<=0)return {text:"✗ مبلغ قرارداد معتبر نیست.",replyMarkup:back(ctx.userId)};
  const ac=await account(ctx); if(!ac)return {text:"✗ اکانت بازی پیدا نشد.",replyMarkup:back(ctx.userId)};
  if(+ac.coins<reward)return {text:"✗ برای تضمین قرارداد باید "+money(reward)+" کنار بگذاری.",replyMarkup:back(ctx.userId)};
  const client=await ctx.pool.connect();
  try{
    await client.query("BEGIN");
    const locked=(await client.query<any>("SELECT * FROM game_world_accounts WHERE group_id=$1 AND user_id=$2 FOR UPDATE",[ctx.chatId,ctx.userId])).rows[0];
    if(+locked.coins<reward){await client.query("ROLLBACK");return {text:"✗ موجودی کافی نیست.",replyMarkup:back(ctx.userId)};}
    await client.query("UPDATE game_world_accounts SET coins=coins-$3 WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,reward]);
    await client.query("INSERT INTO game_world_contracts(group_id,creator_id,title,details,reward) VALUES($1,$2,$3,$4,$5)",[ctx.chatId,ctx.userId,t,"قرارداد مرزی ثبت‌شده توسط "+nameOf(ctx),reward]);
    await client.query("COMMIT");
  }catch(e){await client.query("ROLLBACK").catch(()=>{});throw e;}finally{client.release();}
  return {text:"✓ قرارداد ثبت شد و "+money(reward)+" از موجودی تو تا پایان قرارداد کنار گذاشته شد.",replyMarkup:back(ctx.userId)};
}

const LIVESTOCK:Record<string,{name:string;cost:number;collect:number}> = {
  cow:{name:"گاو",cost:500,collect:80},
  sheep:{name:"گوسفند",cost:350,collect:60},
  chicken:{name:"مرغ",cost:120,collect:30},
};

const BUSINESSES:Record<string,{name:string;cost:number;income:number;cooldown:number}> = {
  general_store:{name:"فروشگاه عمومی",cost:1200,income:180,cooldown:30},
  blacksmith:{name:"آهنگری",cost:1800,income:260,cooldown:40},
  saloon:{name:"سالون",cost:2400,income:340,cooldown:50},
  stable_shop:{name:"فروشگاه اصطبل",cost:2000,income:300,cooldown:45},
};

const TRANSPORTS:Record<string,{name:string;cost:number;condition:number;fuel:number}> = {
  wagon:{name:"واگن مرزی",cost:900,condition:100,fuel:100},
  stagecoach:{name:"کالسکه مسافری",cost:1800,condition:100,fuel:100},
};

async function lifeStatusText(ctx:FrontierExpansionContext){
  const a=await account(ctx); if(!a)return "✗ هنوز نامت در دفتر مرز ثبت نشده است.";
  const loc=(await ctx.pool.query<any>("SELECT name FROM game_world_settlements WHERE settlement_id=$1",[a.location_settlement_id])).rows[0];
  const woman=isWoman(a);
  return [
    woman ? "◈ وضعیت زندگی · بانوی مرز" : "◈ وضعیت زندگی",
    "",
    SEP,
    "",
    "★ - "+nameOf(ctx),
    "⛂ - سلامت : "+fa(+a.health)+"%",
    "⛂ - گرسنگی : "+fa(+a.hunger)+"%",
    "⛂ - انرژی : "+fa(+a.energy)+"%",
    "⛂ - موقعیت : "+(loc?.name??"روستای خودمان"),
    "⛂ - وضعیت زندان : "+(a.jailed_until&&new Date(a.jailed_until).getTime()>Date.now()?"بازداشت‌شده":"آزاد"),
    "",
    woman ? "« در این مرز، با وقار زندگی کن و برای خودت جا باز کن.»" : "« مرد مرزی اگر خودش را جمع نکند، مرز او را جمع می‌کند.»",
    "",
    SEP
  ].join("\n");
}

async function livestockText(ctx:FrontierExpansionContext){
  const rows=(await ctx.pool.query<any>("SELECT * FROM game_world_livestock WHERE group_id=$1 AND user_id=$2 AND count>0 ORDER BY animal_code",[ctx.chatId,ctx.userId])).rows;
  const lines=["◈ دامداری","",SEP,"","★ - دام‌های شخصی"];
  if(!rows.length)lines.push("⛂ - هنوز حیوانی نخریده‌ای.");
  for(const r of rows){
    const d=LIVESTOCK[String(r.animal_code)];
    lines.push("⛂ - "+(d?.name??String(r.animal_code))+" · تعداد "+fa(+r.count)+" · سلامت "+fa(+r.health)+"% · خوراک "+fa(+r.feed)+"%");
  }
  lines.push("","★ - خرید دام","⛂ - گاو · "+money(500),"⛂ - گوسفند · "+money(350),"⛂ - مرغ · "+money(120),"","هر نوبت جمع‌آوری، درآمد و تجربه دامداری ثبت می‌کند.","",SEP);
  return lines.join("\n");
}

async function buyLivestock(ctx:FrontierExpansionContext,code:string){
  const d=LIVESTOCK[code], a=await account(ctx);
  if(!d||!a)return {text:"✗ این دام در دفتر مرز ثبت نشده است.",replyMarkup:back(ctx.userId)};
  if(+a.coins<d.cost)return {text:"✗ برای خرید "+d.name+" "+money(d.cost)+" لازم داری.",replyMarkup:back(ctx.userId)};
  await ctx.pool.query("UPDATE game_world_accounts SET coins=coins-$3,last_active_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,d.cost]);
  await ctx.pool.query("INSERT INTO game_world_livestock(group_id,user_id,animal_code,count,health,feed) VALUES($1,$2,$3,1,100,100) ON CONFLICT(group_id,user_id,animal_code) DO UPDATE SET count=game_world_livestock.count+1,health=100,feed=100,updated_at=NOW()",[ctx.chatId,ctx.userId,code]);
  await recordEconomy(ctx.pool,ctx.chatId,ctx.userId,"expense",d.cost,"خرید دام",d.name);
  return {text:["✓ دام خریداری شد.","","⛂ - دام : "+d.name,"⛂ - هزینه : "+money(d.cost),"⛂ - سلامت اولیه : 100%","⛂ - خوراک : 100%","","« حیوان اگر خرج داشته باشد، باز هم می‌تواند برایت پول بسازد.»"].join("\n"),replyMarkup:back(ctx.userId)};
}

async function collectLivestock(ctx:FrontierExpansionContext,code:string){
  const d=LIVESTOCK[code];
  const row=(await ctx.pool.query<any>("SELECT * FROM game_world_livestock WHERE group_id=$1 AND user_id=$2 AND animal_code=$3",[ctx.chatId,ctx.userId,code])).rows[0];
  if(!d||!row||+row.count<=0)return {text:"✗ از این دام نداری.",replyMarkup:back(ctx.userId)};
  const last=row.last_collected_at?new Date(row.last_collected_at).getTime():0;
  const remain=Math.max(0,Math.ceil((last+20_000-Date.now())/1000));
  if(remain>0)return {text:"⛂ - جمع‌آوری بعدی تا "+fa(remain)+" ثانیه دیگر.",replyMarkup:back(ctx.userId)};
  const amount=d.collect*+row.count;
  await ctx.pool.query("UPDATE game_world_livestock SET last_collected_at=NOW(),feed=GREATEST(0,feed-10),updated_at=NOW() WHERE group_id=$1 AND user_id=$2 AND animal_code=$3",[ctx.chatId,ctx.userId,code]);
  await ctx.pool.query("UPDATE game_world_accounts SET coins=coins+$3,xp=xp+$4,energy=GREATEST(0,energy-3),last_active_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,amount,Math.max(5,Math.floor(amount/2))]);
  await recordEconomy(ctx.pool,ctx.chatId,ctx.userId,"income",amount,"تولید دام",d.name);
  return {text:["✓ تولید دام جمع‌آوری شد.","","⛂ - دام : "+d.name,"⛂ - درآمد : +"+money(amount),"⛂ - تجربه : +"+fa(Math.max(5,Math.floor(amount/2))),"⛂ - مصرف خوراک : 10%","","« طویله‌ای که به حال خودش رها شود، سودش را هم از دست می‌دهد.»"].join("\n"),replyMarkup:back(ctx.userId)};
}

async function transportText(ctx:FrontierExpansionContext){
  const rows=(await ctx.pool.query<any>("SELECT * FROM game_world_transport WHERE group_id=$1 AND user_id=$2 ORDER BY transport_code",[ctx.chatId,ctx.userId])).rows;
  const a=await assets(ctx);
  const lines=["◈ اسب و حمل‌ونقل","",SEP,"","★ - وسیله‌های در اختیار"];
  if(a.horse_name)lines.push("⛂ - اسب : "+a.horse_name+" · سرعت "+fa(+a.horse_speed)+" · استقامت "+fa(+a.horse_stamina)+" · سلامت "+fa(+a.horse_health)+"%");
  else lines.push("⛂ - اسب : هنوز نداری");
  if(!rows.length)lines.push("⛂ - وسیله باربری : نداری");
  for(const r of rows){
    const t=TRANSPORTS[String(r.transport_code)];
    lines.push("⛂ - "+(t?.name??r.transport_code)+" · سطح "+fa(+r.level)+" · وضعیت "+fa(+r.condition)+"% · سوخت "+fa(+r.fuel)+"%");
  }
  lines.push("","★ - خرید","⛂ - واگن مرزی · "+money(900),"⛂ - کالسکه مسافری · "+money(1800),"","« جاده با پا طی می‌شود؛ پول جدی با وسیله طی می‌شود.»","",SEP);
  return lines.join("\n");
}

async function buyTransport(ctx:FrontierExpansionContext,code:string){
  const t=TRANSPORTS[code], a=await account(ctx);
  if(!t||!a)return {text:"✗ وسیله پیدا نشد.",replyMarkup:back(ctx.userId)};
  if(+a.coins<t.cost)return {text:"✗ برای این وسیله "+money(t.cost)+" لازم داری.",replyMarkup:back(ctx.userId)};
  await ctx.pool.query("UPDATE game_world_accounts SET coins=coins-$3 WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,t.cost]);
  await ctx.pool.query("INSERT INTO game_world_transport(group_id,user_id,transport_code,level,condition,fuel) VALUES($1,$2,$3,1,$4,$5) ON CONFLICT(group_id,user_id,transport_code) DO UPDATE SET level=game_world_transport.level+1,condition=100,fuel=100,updated_at=NOW()",[ctx.chatId,ctx.userId,code,t.condition,t.fuel]);
  await recordEconomy(ctx.pool,ctx.chatId,ctx.userId,"expense",t.cost,"خرید وسیله",t.name);
  return {text:"✓ "+t.name+" به دارایی‌هایت اضافه شد؛ جاده حالا انتخاب‌های بیشتری دارد.",replyMarkup:back(ctx.userId)};
}

async function businessText(ctx:FrontierExpansionContext){
  const rows=(await ctx.pool.query<any>("SELECT * FROM game_world_businesses WHERE group_id=$1 AND user_id=$2 ORDER BY id",[ctx.chatId,ctx.userId])).rows;
  const lines=["◈ کسب‌وکار","",SEP,"","★ - کسب‌وکارهای تو"];
  if(!rows.length)lines.push("⛂ - هنوز صاحب مغازه یا کارگاه نیستی.");
  for(const r of rows){
    const b=BUSINESSES[String(r.business_code)];
    const last=new Date(r.last_income_at).getTime();
    const cycles=Math.floor(Math.max(0,Date.now()-last)/1000/(b?.cooldown??60));
    const available=cycles*(b?.income??0)*+r.level;
    lines.push("⛂ - "+(b?.name??String(r.business_name))+" · سطح "+fa(+r.level)+" · صندوق "+money(+r.cashbox)+" · درآمد آماده "+money(available));
  }
  lines.push("","★ - کسب‌وکارهای قابل خرید");
  for(const b of Object.values(BUSINESSES))lines.push("⛂ - "+b.name+" · "+money(b.cost));
  lines.push("","« مغازه‌ای که صاحبش دخل روزانه را نداند، خیلی زود حسابدار پیدا می‌کند.»","",SEP);
  return lines.join("\n");
}

async function buyBusiness(ctx:FrontierExpansionContext,code:string){
  const b=BUSINESSES[code], a=await account(ctx);
  if(!b||!a)return {text:"✗ این کسب‌وکار ثبت نشده است.",replyMarkup:back(ctx.userId)};
  const exists=(await ctx.pool.query("SELECT 1 FROM game_world_businesses WHERE group_id=$1 AND user_id=$2 AND business_code=$3",[ctx.chatId,ctx.userId,code])).rowCount;
  if(exists)return {text:"⛂ - این کسب‌وکار را همین حالا داری.",replyMarkup:back(ctx.userId)};
  if(+a.coins<b.cost)return {text:"✗ سرمایه کافی نیست؛ "+b.name+" "+money(b.cost)+" خرج دارد.",replyMarkup:back(ctx.userId)};
  await ctx.pool.query("UPDATE game_world_accounts SET coins=coins-$3 WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,b.cost]);
  await ctx.pool.query("INSERT INTO game_world_businesses(group_id,user_id,business_code,business_name) VALUES($1,$2,$3,$4)",[ctx.chatId,ctx.userId,code,b.name]);
  await recordEconomy(ctx.pool,ctx.chatId,ctx.userId,"expense",b.cost,"خرید کسب‌وکار",b.name);
  return {text:["✓ کسب‌وکار ثبت شد.","","⛂ - نام : "+b.name,"⛂ - سرمایه آغازین : "+money(b.cost),"⛂ - درآمد پایه : "+money(b.income)+" در هر چرخه","","« حالا دیگر فقط برای خودت کار نمی‌کنی؛ دخل مغازه هم هر روز حسابش را پس می‌دهد.»"].join("\n"),replyMarkup:back(ctx.userId)};
}

async function collectBusiness(ctx:FrontierExpansionContext,code:string){
  const b=BUSINESSES[code];
  const row=(await ctx.pool.query<any>("SELECT * FROM game_world_businesses WHERE group_id=$1 AND user_id=$2 AND business_code=$3",[ctx.chatId,ctx.userId,code])).rows[0];
  if(!b||!row)return {text:"✗ این کسب‌وکار را نداری.",replyMarkup:back(ctx.userId)};
  const last=new Date(row.last_income_at).getTime();
  const cycles=Math.floor(Math.max(0,Date.now()-last)/1000/(b.cooldown));
  if(cycles<1)return {text:"⛂ - دخل "+b.name+" هنوز پر نشده است.",replyMarkup:back(ctx.userId)};
  const amount=cycles*b.income*+row.level;
  await ctx.pool.query("UPDATE game_world_businesses SET cashbox=cashbox+$3,last_income_at=NOW(),updated_at=NOW() WHERE id=$1 AND group_id=$2",[row.id,ctx.chatId,amount]);
  return {text:["✓ دخل مغازه جمع شد.","","⛂ - کسب‌وکار : "+b.name,"⛂ - چرخه‌های آماده : "+fa(cycles),"⛂ - مبلغ ثبت‌شده در صندوق : +"+money(amount),"","« پولی که داخل صندوق بماند، هنوز پول تو نیست؛ صندوق را باز کن.»"].join("\n"),replyMarkup:{inline_keyboard:[
    [{text:"‹ برداشت صندوق",callback_data:"world:expand:business:withdraw:"+code+":"+ctx.userId}],
    [{text:"‹ بازگشت",callback_data:"world:expand:business:"+ctx.userId}]
  ]}};
}

async function withdrawBusiness(ctx:FrontierExpansionContext,code:string){
  const row=(await ctx.pool.query<any>("SELECT * FROM game_world_businesses WHERE group_id=$1 AND user_id=$2 AND business_code=$3",[ctx.chatId,ctx.userId,code])).rows[0];
  if(!row)return {text:"✗ کسب‌وکار پیدا نشد.",replyMarkup:back(ctx.userId)};
  const amount=+row.cashbox;
  if(amount<=0)return {text:"⛂ - صندوق خالی است.",replyMarkup:back(ctx.userId)};
  await ctx.pool.query("UPDATE game_world_businesses SET cashbox=0,updated_at=NOW() WHERE id=$1",[row.id]);
  await ctx.pool.query("UPDATE game_world_accounts SET coins=coins+$3,last_active_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,amount]);
  await recordEconomy(ctx.pool,ctx.chatId,ctx.userId,"income",amount,"برداشت سود کسب‌وکار",row.business_name);
  return {text:"✓ "+money(amount)+" از صندوق "+row.business_name+" به موجودی نقدت منتقل شد.",replyMarkup:back(ctx.userId)};
}

async function newspaperText(ctx:FrontierExpansionContext){
  const local=(await ctx.pool.query<any>("SELECT title,body FROM game_world_news WHERE scope='local' AND group_id=$1 ORDER BY created_at DESC LIMIT 3",[ctx.chatId])).rows;
  const global=(await ctx.pool.query<any>("SELECT title,body FROM game_world_news WHERE scope='global' ORDER BY created_at DESC LIMIT 3")).rows;
  const events=(await ctx.pool.query<any>("SELECT title,body FROM game_world_events WHERE (scope='local' AND group_id=$1) OR scope='global' ORDER BY created_at DESC LIMIT 4",[ctx.chatId])).rows;
  const lines=["◈ THE FRONTIER NEWS","",SEP,"","★ - اخبار محلی",...local.map((r:any)=>"⛂ - "+r.title+" — "+r.body),"","★ - اخبار جهان",...global.map((r:any)=>"⛂ - "+r.title+" — "+r.body),"","★ - آخرین رویدادها",...events.map((r:any)=>"⛂ - "+r.title+" — "+r.body),"","« خبر خوب دیر می‌رسد؛ خبر بد معمولاً راه کوتاه‌تری پیدا می‌کند.»","",SEP];
  return lines.join("\n");
}

export async function themedFrontierExpansionMenuText(ctx:FrontierExpansionContext){
  const a=await account(ctx);
  const woman=isWoman(a);
  return [
    woman?"◈ دفتر مرز · بانوی مرز":"◈ دفتر مرز",
    "",
    "مرکز مدیریت بخش‌های تخصصی زندگی و پیشرفتت در مرز.",
    "",
    SEP,
    "",
    "★ - پول و اقتصاد",
    "⛂ - بانک، درآمد و کسب‌وکار",
    "",
    "★ - دارایی و زندگی",
    "⛂ - خانه، زمین، مزرعه، اسب و ابزار",
    "",
    "★ - کار و کسب‌وکار",
    "⛂ - حرفه، مهارت و مسیرهای شغلی",
    woman?"⛂ - مسیرهای تخصصی بانوی مرز":"",
    "",
    "★ - قانون و روابط",
    "⛂ - قانون، مأموریت، قرارداد و باند",
    "",
    "★ - نقشه و رویدادها",
    "⛂ - سفر، مسیرها و اتفاقات زنده",
    "",
    "★ - خبر و وضعیت",
    "⛂ - روزنامه مرزی و وضعیت زندگی",
    "",
    SEP,
    "",
    "« اینجا دفتر کاغذی نیست؛ هر تصمیم روی پول، زمان، دارایی یا جایگاهت در مرز اثر می‌گذارد.»",
    "",
    "از دکمه‌ها، حوزه‌ای را که می‌خواهی مدیریت کنی انتخاب کن."
  ].filter(Boolean).join("\n");
}
export function frontierExpansionMenuText(){
  return [
    "◈ دفتر مرز",
    "",
    "مرکز مدیریت بخش‌های تخصصی زندگی و پیشرفتت در مرز.",
    "",
    SEP,
    "",
    "★ - پول و اقتصاد",
    "⛂ - بانک، درآمد و کسب‌وکار",
    "",
    "★ - دارایی و زندگی",
    "⛂ - خانه، زمین، مزرعه، اسب و ابزار",
    "",
    "★ - کار و کسب‌وکار",
    "⛂ - حرفه، مهارت و مسیرهای شغلی",
    "",
    "★ - قانون و روابط",
    "⛂ - قانون، مأموریت، قرارداد و باند",
    "",
    "★ - نقشه و رویدادها",
    "⛂ - سفر، مسیرها و اتفاقات زنده",
    "",
    "★ - خبر و وضعیت",
    "⛂ - روزنامه مرزی و وضعیت زندگی",
    "",
    SEP,
  ].join("\n");
}
export { recordEconomy };

function worldGuideText(){
  return [
    "◈ راهنمای اقتصاد مرزی",
    "",
    SEP,
    "",
    "★ - اقتصاد پویا",
    "⛂ - عرضه بیشتر → فشار کاهشی روی قیمت",
    "⛂ - کمیابی و تقاضای بیشتر → فشار افزایشی روی قیمت",
    "⛂ - مصرف اهالی و کسب‌وکارها بخشی از تقاضای واقعی بازار است.",
    "⛂ - خرید و فروش بازیکنان در وضعیت بازار اثر می‌گذارند.",
    "",
    "★ - هزینه‌های بازار",
    "⛂ - خرید : ۳٪ کارمزد بازار",
    "⛂ - فروش : ۲٪ مالیات معامله",
    "⛂ - مبالغ وارد خزانه بازار قلمرو می‌شوند.",
    "",
    SEP
  ].join("\n");
}

export async function handleFrontierExpansionText(ctx:FrontierExpansionContext,text:string):Promise<FrontierExpansionResult|null>{
  const n=String(text??"").trim().replace(/^[\\/!.]+/,"").replace(/\s+/g," ").toLowerCase();
  if(["توسعه مرز","مرکز توسعه","دفتر مرز","frontier expansion","frontier"].includes(n))return menuResult(await themedFrontierExpansionMenuText(ctx),ctx.userId);
  if(n==="دفتر بانوان مرز"||n==="تم بانوان مرز"||n==="frontier lady")return await handleFrontierExpansionCallback(ctx,["world","expand","ladies",String(ctx.userId)]);
  if(n==="وضعیت زندگی"||n==="زندگی من")return {text:await lifeStatusText(ctx),replyMarkup:expansionMenu(ctx.userId)};
  if(n==="دامداری"||n==="دام من")return {text:await livestockText(ctx),replyMarkup:expansionMenu(ctx.userId)};
  if(n==="حمل و نقل"||n==="حمل‌ونقل")return {text:await transportText(ctx),replyMarkup:expansionMenu(ctx.userId)};
  if(n==="کسب و کار"||n==="کسب‌وکار"||n==="مغازه من")return {text:await businessText(ctx),replyMarkup:expansionMenu(ctx.userId)};
  if(n==="روزنامه"||n==="روزنامه مرزی")return {text:await newspaperText(ctx),replyMarkup:expansionMenu(ctx.userId)};
  if(n==="بانک"||n==="بانک من")return {text:await bankText(ctx),replyMarkup:expansionMenu(ctx.userId)};
  if(n==="اقتصاد من"||n==="دفتر درآمد"||n==="درآمد من"||n==="گردش مالی")return {text:await economyText(ctx),replyMarkup:expansionMenu(ctx.userId)};
  if(n==="اقتصاد مرزی"||n==="قیمت‌های مرزی"||n==="قیمت پویا"||n==="عرضه و تقاضا")return {text:await dynamicMarketOverview(ctx),replyMarkup:expansionMenu(ctx.userId)};
  if(n==="زنجیره تولید و مصرف"||n==="زنجیره اقتصاد"||n==="جریان کالا"||n==="تولید و مصرف")return {text:await supplyChainText(ctx),replyMarkup:expansionMenu(ctx.userId)};
  if(n==="راهنمای اقتصاد"||n==="راهنمای اقتصاد و نمادها"||n==="راهنمای سرزمین پرشین")return {text:worldGuideText(),replyMarkup:expansionMenu(ctx.userId)};
  if(n==="کار امروز"||n==="کار"||n==="نوبت کاری"||n==="شروع نوبت کاری")return await doWork(ctx);
  if(n==="کار ویژه"||n==="خدمات بانوی مرز"||n==="کار تخصصی")return {text:await careerText(ctx),replyMarkup:{inline_keyboard:[[ {text:"‹ اجرای کار ویژه",callback_data:"world:expand:career:"+ctx.userId} ],[ {text:"‹ بازگشت",callback_data:"world:home:"+ctx.userId} ]]}};
  if(n==="دوخت لباس")return await doCareerAction(ctx,"craft");
  if(n==="فروش لباس")return await doCareerAction(ctx,"sell");
  if(n==="درمان")return await doCareerAction(ctx,"service",String(ctx.userId));
  if(n.startsWith("درمان "))return await doCareerAction(ctx,"service",n.slice("درمان ".length));
  if(n==="اقامت")return await doCareerAction(ctx,"service",String(ctx.userId));
  if(n.startsWith("اقامت "))return await doCareerAction(ctx,"service",n.slice("اقامت ".length));
  if(n==="آموزش")return await doCareerAction(ctx,"teach",String(ctx.userId));
  if(n.startsWith("آموزش "))return await doCareerAction(ctx,"teach",n.slice("آموزش ".length));
  if(n==="گزارش مرزی")return await doCareerAction(ctx,"report");
  if(n==="شب سالون")return await doCareerAction(ctx,"saloon");
  if(n.startsWith("واریز بانک "))return await bankMovement(ctx,"deposit",Number(n.slice("واریز بانک ".length)));
  if(n.startsWith("برداشت بانک "))return await bankMovement(ctx,"withdraw",Number(n.slice("برداشت بانک ".length)));
  if(n.startsWith("باند جدید "))return await createBand(ctx,n.slice("باند جدید ".length));
  const contract=n.match(/^قرارداد (.+) (\\d+)$/);
  if(contract)return await createContract(ctx,contract[1],Number(contract[2]));
  return null;
}

export async function handleFrontierExpansionCallback(ctx:FrontierExpansionContext,parts:string[]):Promise<FrontierExpansionResult|null>{
  if(parts[0]!=="world"||parts[1]!=="expand")return null;
  const owner=Number(parts[parts.length-1]??0);
  if(owner&&owner!==ctx.userId)return {text:"⛂ - این بخش برای بازیکن دیگری باز شده است.",replyMarkup:back(ctx.userId)};
  const sub=String(parts[2]??"");
  await ensureFrontierExpansionSchema(ctx.pool);

  if(sub==="center")return menuResult(await themedFrontierExpansionMenuText(ctx),ctx.userId);
  if(sub==="cat"){
    const result=await expansionCategoryMenu(ctx,String(parts[3]??""));
    if(result)return result;
  }
  if(sub==="bank"){
    if(parts[3]==="deposit"||parts[3]==="withdraw")return await bankMovement(ctx,parts[3],Number(parts[4]));
    return menuResult(await bankText(ctx),ctx.userId);
  }
  if(sub==="economy")return menuResult(await economyText(ctx),ctx.userId);
  if(sub==="dynamics")return menuResult(await dynamicMarketOverview(ctx),ctx.userId);
  if(sub==="supply")return menuResult(await supplyChainText(ctx),ctx.userId);
  if(sub==="property"){
    if(parts[3]==="home")return await upgradeHome(ctx);
    if(parts[3]==="land")return await upgradeLand(ctx);
    if(parts[3]==="storage")return await upgradeStorage(ctx);
    const text=await propertyText(ctx);
    return {text,replyMarkup:{inline_keyboard:[
      [{text:"‹ ارتقای خانه",callback_data:"world:expand:property:home:"+ctx.userId},{text:"‹ توسعه زمین",callback_data:"world:expand:property:land:"+ctx.userId}],
      [{text:"‹ ارتقای انبار",callback_data:"world:expand:property:storage:"+ctx.userId}],
      [{text:"‹ بازگشت",callback_data:"world:home:"+ctx.userId}]
    ]}};
  }
  if(sub==="farm"){
    const text=await farmText(ctx);
    const rows:any[]=[];
    const a=await assets(ctx);
    if(!a.farm_crop)rows.push(
      [{text:"‹ گندم · 35",callback_data:"world:expand:plant:wheat:"+ctx.userId},{text:"‹ ذرت · 45",callback_data:"world:expand:plant:corn:"+ctx.userId}],
      [{text:"‹ پنبه · 55",callback_data:"world:expand:plant:cotton:"+ctx.userId},{text:"‹ دارویی · 70",callback_data:"world:expand:plant:herbs:"+ctx.userId}]
    );
    if(a.horse_name)rows.push([{text:"‹ اصطبل و اسب",callback_data:"world:expand:horse:"+ctx.userId}]);
    else rows.push([{text:"‹ خرید اسب · 700",callback_data:"world:expand:horsebuy:"+ctx.userId}]);
    rows.push([{text:"‹ دامداری",callback_data:"world:expand:livestock:"+ctx.userId}]);
    rows.push([{text:"‹ بازگشت",callback_data:"world:home:"+ctx.userId}]);
    return {text,replyMarkup:{inline_keyboard:rows}};
  }
  if(sub==="plant")return await plant(ctx,String(parts[3]??""));
  if(sub==="harvest")return await harvest(ctx);
  if(sub==="horsebuy")return await buyHorse(ctx);
  if(sub==="horse"){
    return {text:await farmText(ctx),replyMarkup:back(ctx.userId)};
  }
  if(sub==="tools"){
    const rows:any[]=[];
    for(const [code,t] of Object.entries(TOOLS))rows.push([{text:"‹ خرید "+t.name+" · "+t.cost,callback_data:"world:expand:toolbuy:"+code+":"+ctx.userId}]);
    rows.push([{text:"‹ بازگشت",callback_data:"world:home:"+ctx.userId}]);
    return {text:await toolsText(ctx),replyMarkup:{inline_keyboard:rows}};
  }
  if(sub==="toolbuy")return await buyTool(ctx,String(parts[3]??""));
  if(sub==="ladies"){
    const a=await account(ctx);
    if(!isWoman(a))return {text:"✗ این دفتر برای حساب‌های زنانه فعال می‌شود.",replyMarkup:back(ctx.userId)};
    const rows:any[]=[];
    for(const [code,prof] of Object.entries(PROFESSIONS)){
      if(!prof.womenOnly)continue;
      rows.push([{text:"‹ "+prof.name+" · "+prof.pay+" سکه",callback_data:"world:expand:profpick:"+code+":"+ctx.userId}]);
    }
    return {
      text:[
        "◈ دفتر بانوان مرز · مسیرهای حرفه‌ای",
        "",
        SEP,
        "",
        "★ - مسیرهای شغلی",
        "⛂ - خیاط و دوزنده · 135 سکه",
        "⛂ - درمانگر مرزی · 160 سکه",
        "⛂ - مهمانخانه‌دار · 175 سکه",
        "⛂ - روزنامه‌نگار مرزی · 150 سکه",
        "⛂ - معلم مدرسه مرزی · 145 سکه",
        "⛂ - صاحب سالون · 190 سکه",
        "",
        "★ - هویت این تم",
        "⛂ - سبک : Frontier Lady · کلاسیک و مستقل",
        "⛂ - شغل‌های عمومی : باز",
        "⛂ - مسیرهای اختصاصی : فعال",
        "⛂ - کار ویژه هر شغل : فعال",
        "",
        "« این مرز فقط یک طرف جاده ندارد؛ راه خودت را بساز.»",
        "",
        SEP
      ].join("\n"),
      replyMarkup:{inline_keyboard:[...rows,[{text:"‹ میز کار حرفه‌ای",callback_data:"world:expand:career:"+ctx.userId}],[{text:"‹ بازگشت",callback_data:"world:expand:profession:"+ctx.userId}]]}
    };
  }
  if(sub==="profession"){
    const p=(await ctx.pool.query<any>("SELECT * FROM game_world_professions WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId])).rows[0];
    const a=await account(ctx);
    const rows:any[]=[];
    for(const [code,prof] of Object.entries(PROFESSIONS)){
      if(prof.womenOnly && !isWoman(a))continue;
      rows.push([{text:"‹ "+prof.name+" · "+prof.pay+" سکه",callback_data:"world:expand:profpick:"+code+":"+ctx.userId}]);
    }
    rows.push([{text:"‹ کار ویژه",callback_data:"world:expand:career:"+ctx.userId}]);
    if(isWoman(a))rows.push([{text:"‹ دفتر بانوان مرز",callback_data:"world:expand:ladies:"+ctx.userId}]);
    rows.push([{text:"‹ شروع نوبت کاری",callback_data:"world:expand:work:"+ctx.userId},{text:"‹ بازگشت",callback_data:"world:home:"+ctx.userId}]);
    return {text:await professionText(ctx)+(p?"\n\n★ - برای رفتن سر کار، «کار امروز» را بزن.":""),replyMarkup:{inline_keyboard:rows}};
  }
  if(sub==="profpick")return await chooseProfession(ctx,String(parts[3]??""));
  if(sub==="career"){
    if(parts[3]==="action"){
      const p=(await ctx.pool.query<any>("SELECT profession_code FROM game_world_professions WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId])).rows[0];
      const actionMap:Record<string,string>={seamstress:"craft",healer:"service",innkeeper:"service",frontier_journalist:"report",schoolteacher:"teach",saloon_keeper:"saloon"};
      const action=actionMap[String(p?.profession_code??"")];
      if(!action)return {text:"✗ برای این حرفه کار ویژه‌ای ثبت نشده است.",replyMarkup:back(ctx.userId)};
      return await doCareerAction(ctx,action,String(ctx.userId));
    }
    if(parts[3]==="sell"||parts[3]==="craft"||parts[3]==="service"||parts[3]==="teach"||parts[3]==="report"||parts[3]==="saloon"){
      return await doCareerAction(ctx,parts[3],parts[4]);
    }
    const p=(await ctx.pool.query<any>("SELECT profession_code FROM game_world_professions WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId])).rows[0];
    const actionMap:Record<string,string>={seamstress:"craft",healer:"service",innkeeper:"service",frontier_journalist:"report",schoolteacher:"teach",saloon_keeper:"saloon"};
    const action=actionMap[String(p?.profession_code??"")];
    const label=String(p?.profession_code??"")==="seamstress"?"دوخت لباس":String(p?.profession_code??"")==="frontier_journalist"?"گزارش مرزی":String(p?.profession_code??"")==="schoolteacher"?"آموزش":String(p?.profession_code??"")==="healer"?"درمان خود":String(p?.profession_code??"")==="innkeeper"?"اقامت خود":"شب سالون";
    return {text:await careerText(ctx),replyMarkup:{inline_keyboard:[
      [{text:"‹ "+label,callback_data:"world:expand:career:action:"+ctx.userId}],
      ...(String(p?.profession_code??"")==="seamstress"?[[{text:"‹ فروش یک لباس · 95",callback_data:"world:expand:career:sell:"+ctx.userId}]]:[]),
      [{text:"‹ بازگشت",callback_data:"world:expand:profession:"+ctx.userId}]
    ]}};
  }
  if(sub==="work")return await doWork(ctx);
  if(sub==="livestock"){
    if(parts[3]==="buy")return await buyLivestock(ctx,String(parts[4]??""));
    if(parts[3]==="collect")return await collectLivestock(ctx,String(parts[4]??""));
    const rows:any[]=[
      [{text:"‹ خرید گاو · 500",callback_data:"world:expand:livestock:buy:cow:"+ctx.userId},{text:"‹ جمع‌آوری گاو",callback_data:"world:expand:livestock:collect:cow:"+ctx.userId}],
      [{text:"‹ خرید گوسفند · 350",callback_data:"world:expand:livestock:buy:sheep:"+ctx.userId},{text:"‹ جمع‌آوری گوسفند",callback_data:"world:expand:livestock:collect:sheep:"+ctx.userId}],
      [{text:"‹ خرید مرغ · 120",callback_data:"world:expand:livestock:buy:chicken:"+ctx.userId},{text:"‹ جمع‌آوری مرغ",callback_data:"world:expand:livestock:collect:chicken:"+ctx.userId}],
      [{text:"‹ بازگشت",callback_data:"world:expand:farm:"+ctx.userId}]
    ];
    return {text:await livestockText(ctx),replyMarkup:{inline_keyboard:rows}};
  }
  if(sub==="transport"){
    if(parts[3]==="buy")return await buyTransport(ctx,String(parts[4]??""));
    return {text:await transportText(ctx),replyMarkup:{inline_keyboard:[
      [{text:"‹ خرید واگن · 900",callback_data:"world:expand:transport:buy:wagon:"+ctx.userId}],
      [{text:"‹ خرید کالسکه · 1800",callback_data:"world:expand:transport:buy:stagecoach:"+ctx.userId}],
      [{text:"‹ بازگشت",callback_data:"world:home:"+ctx.userId}]
    ]}};
  }
  if(sub==="business"){
    if(parts[3]==="buy")return await buyBusiness(ctx,String(parts[4]??""));
    if(parts[3]==="collect")return await collectBusiness(ctx,String(parts[4]??""));
    if(parts[3]==="withdraw")return await withdrawBusiness(ctx,String(parts[4]??""));
    const rows:any[]=[];
    for(const [code,b] of Object.entries(BUSINESSES)){
      rows.push([{text:"‹ خرید "+b.name+" · "+b.cost,callback_data:"world:expand:business:buy:"+code+":"+ctx.userId}]);
      rows.push([{text:"‹ جمع دخل "+b.name,callback_data:"world:expand:business:collect:"+code+":"+ctx.userId}]);
    }
    rows.push([{text:"‹ بازگشت",callback_data:"world:home:"+ctx.userId}]);
    return {text:await businessText(ctx),replyMarkup:{inline_keyboard:rows}};
  }
  if(sub==="newspaper")return {text:await newspaperText(ctx),replyMarkup:expansionMenu(ctx.userId)};
  if(sub==="life")return {text:await lifeStatusText(ctx),replyMarkup:expansionMenu(ctx.userId)};
    if(sub==="law"){
    return {text:await lawText(ctx),replyMarkup:{inline_keyboard:[
      [{text:"‹ تسویه پرونده",callback_data:"world:expand:fine:"+ctx.userId}],
      [{text:"‹ بازگشت",callback_data:"world:home:"+ctx.userId}]
    ]}};
  }
  if(sub==="fine")return await payFine(ctx);
  if(sub==="missions"){
    const rows=await seedMissions(ctx);
    const kb:any[]=rows.map((r:any)=>[{text:"‹ "+r.title,callback_data:"world:expand:missionclaim:"+r.code+":"+ctx.userId}]);
    kb.push([{text:"‹ بازگشت",callback_data:"world:home:"+ctx.userId}]);
    return {text:await missionText(ctx),replyMarkup:{inline_keyboard:kb}};
  }
  if(sub==="missionclaim")return await claimMission(ctx,String(parts[3]??""));
  if(sub==="map")return menuResult(await mapText(ctx),ctx.userId);
  if(sub==="events")return menuResult(await eventsText(ctx),ctx.userId);
  if(sub==="band")return menuResult(await bandText(ctx),ctx.userId);
  return null;
}
