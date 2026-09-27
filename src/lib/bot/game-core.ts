import type { Pool } from "pg";

export type GameUser={id:number;username?:string;firstName?:string};
export type GameContext={pool:Pool;chatId:number;userId:number;user:GameUser;isAdmin:boolean;replyToUserId?:number;replyToName?:string};
type QuizSession={answer:number;question:string;expires:number};
const quiz=new Map<string,QuizSession>();
let schema:Promise<void>|null=null;

const MISSIONS=[
  ["play_3","۳ بازی انجام بده","daily",3,60,90],["win_1","یک برد کسب کن","daily",1,80,120],
  ["earn_100","۱۰۰ جم به‌دست بیاور","daily",100,100,160],["quiz_3","۳ کوییز انجام بده","daily",3,80,150],
  ["play_15","۱۵ بازی انجام بده","weekly",15,300,500],["win_8","۸ برد کسب کن","weekly",8,450,750],
  ["earn_500","۵۰۰ جم به‌دست بیاور","weekly",500,500,900],
] as const;
const ACH=[
  ["first_game","First Game","اولین بازی","اولین بازی کامل",0],["first_win","First Win","اولین برد","اولین برد",80],
  ["ten_wins","Ten Wins","۱۰ برد","۱۰ برد کسب کن",250],["fifty_wins","Fifty Wins","۵۰ برد","۵۰ برد کسب کن",700],
  ["hundred_games","100 Games","صد بازی","۱۰۰ بازی انجام بده",900],["quiz_master","Quiz Master","استاد کوییز","۱۰ برد در کوییز",500],
] as const;
const SHOP=[
  ["gold_frame","قاب طلایی","ظاهر","ظاهر پروفایل",800],["champion_title","عنوان قهرمان","عنوان","عنوان نمایشی",1200],
  ["veteran_badge","نشان کهنه‌کار","نشان","نشان کهنه‌کار",1600],["diamond_title","عنوان الماس","عنوان","عنوان الماس",2500],
] as const;
const QUESTIONS=[
  {q:"کدام سیاره به خورشید نزدیک‌تر است؟",o:["عطارد","زمین","مریخ","زهره"],a:0},
  {q:"بزرگ‌ترین اقیانوس جهان کدام است؟",o:["اطلس","هند","آرام","منجمد شمالی"],a:2},
  {q:"عدد ۱۲ × ۸ چند است؟",o:["۸۶","۹۶","۱۰۶","۱۱۶"],a:1},
  {q:"پایتخت ژاپن کدام است؟",o:["سئول","توکیو","پکن","اوساکا"],a:1},
  {q:"کدام عنصر نماد O دارد؟",o:["طلا","اکسیژن","آهن","هیدروژن"],a:1},
  {q:"۲ به توان ۵ چند است؟",o:["۱۶","۲۴","۳۲","۶۴"],a:2},
] as const;

const key=(g:number,u:number)=>g+":"+u;
const norm=(s:string)=>String(s??"").trim().replace(/[\u200c\u200d]/g," ").replace(/\s+/g," ").toLowerCase();
const fa=(x:number)=>String(x).replace(/\d/g,d=>"۰۱۲۳۴۵۶۷۸۹"[+d]??d);
const league=(r:number)=>r>=2600?"افسانه":r>=2300?"استاد بزرگ":r>=2000?"استاد":r>=1750?"الماس":r>=1500?"پلاتینیوم":r>=1250?"طلا":r>=1000?"نقره":"برنز";
const gameTitle=(code:string)=>({dice:"تاس",quiz:"کوییز",speed:"بازی سرعتی",guess:"حدس عدد",rps:"سنگ، کاغذ، قیچی",duel:"دوئل"} as Record<string,string>)[code]??code;
const resultTitle=(value:string)=>value==="win"?"برد":value==="loss"?"باخت":value==="draw"?"مساوی":value;
const reasonTitle=(value:string)=>({
  "Game reward":"پاداش بازی",
  "Achievement reward":"پاداش دستاورد",
  "Mission reward":"پاداش مأموریت",
  "Daily reward":"پاداش روزانه",
  "Shop purchase":"خرید از فروشگاه",
  "Admin grant":"اعطای جم توسط مدیر",
  "Admin remove":"کسر جم توسط مدیر"
} as Record<string,string>)[value]??value;
const lvl=(x:number)=>Math.max(1,Math.floor(Math.sqrt(Math.max(0,x)/100))+1);
const req=(l:number)=>l*l*100;
const bar=(x:number,l:number)=>{const p=Math.max(0,Math.min(100,Math.floor(((x-req(l-1))/Math.max(1,req(l)-req(l-1)))*100)));return "█".repeat(Math.floor(p/10))+"░".repeat(10-Math.floor(p/10));};
const period=(p:string)=>{const d=new Date();return p==="daily"?d.toISOString().slice(0,10):d.getUTCFullYear()+"-"+String(d.getUTCMonth()+1).padStart(2,"0")+"-W"+Math.ceil(d.getUTCDate()/7);};

export function isGameCenterCommand(text:string){
  const z=norm(String(text??"").trim().replace(/^[/!.]+/,""));
  return ["بازی","game","game center","مرکز بازی"].includes(z);
}

export function gameCenterKeyboard(){
  return {inline_keyboard:[
    [{text:"‹ بازی کردن",callback_data:"game:play"},{text:"‹ پروفایل",callback_data:"game:profile"}],
    [{text:"‹ موجودی",callback_data:"game:wallet"},{text:"‹ فروشگاه",callback_data:"game:shop"}],
    [{text:"‹ مأموریت‌ها",callback_data:"game:missions"},{text:"‹ رتبه‌بندی",callback_data:"game:leaderboard"}],
    [{text:"‹ جوایز",callback_data:"game:rewards"},{text:"‹ تاریخچه",callback_data:"game:history"}],
    [{text:"‹ راهنما",callback_data:"game:help"},{text:"‹ تنظیمات",callback_data:"game:settings"}],
  ]};
}


export async function ensureGameSchema(pool:Pool){
  if(!schema)schema=pool.query([
    "CREATE TABLE IF NOT EXISTS game_players(group_id BIGINT NOT NULL,user_id BIGINT NOT NULL,username TEXT,first_name TEXT,level INT NOT NULL DEFAULT 1,xp BIGINT NOT NULL DEFAULT 0,gems BIGINT NOT NULL DEFAULT 0 CHECK(gems>=0),rating INT NOT NULL DEFAULT 1000,high_score INT NOT NULL DEFAULT 1000,total_games INT NOT NULL DEFAULT 0,wins INT NOT NULL DEFAULT 0,losses INT NOT NULL DEFAULT 0,current_streak INT NOT NULL DEFAULT 0,best_streak INT NOT NULL DEFAULT 0,quiz_wins INT NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(group_id,user_id));",
    "ALTER TABLE game_players ADD COLUMN IF NOT EXISTS high_score INT NOT NULL DEFAULT 1000;",
    "CREATE INDEX IF NOT EXISTS idx_game_players_rank ON game_players(group_id,rating DESC);",
    "CREATE TABLE IF NOT EXISTS game_group_settings(group_id BIGINT PRIMARY KEY,enabled BOOLEAN NOT NULL DEFAULT TRUE,daily_reward BIGINT NOT NULL DEFAULT 50,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());",
    "CREATE TABLE IF NOT EXISTS game_wallet_ledger(id BIGSERIAL PRIMARY KEY,group_id BIGINT NOT NULL,user_id BIGINT NOT NULL,delta BIGINT NOT NULL,balance_after BIGINT NOT NULL CHECK(balance_after>=0),reason TEXT NOT NULL,game_code TEXT,metadata JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());",
    "CREATE INDEX IF NOT EXISTS idx_game_wallet_user ON game_wallet_ledger(group_id,user_id,created_at DESC);",
    "CREATE TABLE IF NOT EXISTS game_match_history(id BIGSERIAL PRIMARY KEY,group_id BIGINT NOT NULL,user_id BIGINT NOT NULL,game_code TEXT NOT NULL,result TEXT NOT NULL,xp_earned BIGINT NOT NULL DEFAULT 0,gems_earned BIGINT NOT NULL DEFAULT 0,rating_delta INT NOT NULL DEFAULT 0,metadata JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());",
    "CREATE TABLE IF NOT EXISTS game_missions(group_id BIGINT NOT NULL,code TEXT NOT NULL,title TEXT NOT NULL,period TEXT NOT NULL,target BIGINT NOT NULL,reward_gems BIGINT NOT NULL DEFAULT 0,reward_xp BIGINT NOT NULL DEFAULT 0,enabled BOOLEAN NOT NULL DEFAULT TRUE,PRIMARY KEY(group_id,code));",
    "CREATE TABLE IF NOT EXISTS game_mission_progress(group_id BIGINT NOT NULL,user_id BIGINT NOT NULL,code TEXT NOT NULL,progress BIGINT NOT NULL DEFAULT 0,claim_key TEXT,claimed BOOLEAN NOT NULL DEFAULT FALSE,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(group_id,user_id,code));",
    "CREATE TABLE IF NOT EXISTS game_achievements(group_id BIGINT NOT NULL,code TEXT NOT NULL,name TEXT NOT NULL,name_fa TEXT NOT NULL,description TEXT NOT NULL,reward_gems BIGINT NOT NULL DEFAULT 0,enabled BOOLEAN NOT NULL DEFAULT TRUE,PRIMARY KEY(group_id,code));",
    "CREATE TABLE IF NOT EXISTS game_player_achievements(group_id BIGINT NOT NULL,user_id BIGINT NOT NULL,code TEXT NOT NULL,unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(group_id,user_id,code));",
    "CREATE TABLE IF NOT EXISTS game_shop_items(group_id BIGINT NOT NULL,code TEXT NOT NULL,name TEXT NOT NULL,item_type TEXT NOT NULL,description TEXT NOT NULL,price BIGINT NOT NULL CHECK(price>=0),enabled BOOLEAN NOT NULL DEFAULT TRUE,PRIMARY KEY(group_id,code));",
    "CREATE TABLE IF NOT EXISTS game_inventory(group_id BIGINT NOT NULL,user_id BIGINT NOT NULL,item_code TEXT NOT NULL,quantity INT NOT NULL DEFAULT 0,acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(group_id,user_id,item_code));",
    "CREATE TABLE IF NOT EXISTS game_seasons(id BIGSERIAL PRIMARY KEY,group_id BIGINT NOT NULL,season_code TEXT NOT NULL,title TEXT NOT NULL,starts_at TIMESTAMPTZ NOT NULL,ends_at TIMESTAMPTZ NOT NULL,enabled BOOLEAN NOT NULL DEFAULT TRUE,UNIQUE(group_id,season_code));",
    "CREATE TABLE IF NOT EXISTS game_season_players(season_id BIGINT NOT NULL REFERENCES game_seasons(id) ON DELETE CASCADE,group_id BIGINT NOT NULL,user_id BIGINT NOT NULL,season_xp BIGINT NOT NULL DEFAULT 0,season_games INT NOT NULL DEFAULT 0,season_wins INT NOT NULL DEFAULT 0,PRIMARY KEY(season_id,user_id));",
    "CREATE TABLE IF NOT EXISTS game_daily_claims(group_id BIGINT NOT NULL,user_id BIGINT NOT NULL,claim_key TEXT NOT NULL,claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(group_id,user_id,claim_key));",
    "CREATE TABLE IF NOT EXISTS game_audit(id BIGSERIAL PRIMARY KEY,group_id BIGINT,actor_id BIGINT NOT NULL,action TEXT NOT NULL,target_user_id BIGINT,metadata JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());"
  ].join("\n")).then(()=>undefined);
  try{await schema;}catch(e){schema=null;throw e;}
}

async function seed(pool:Pool,g:number){
  await pool.query("INSERT INTO game_group_settings(group_id) VALUES($1) ON CONFLICT DO NOTHING",[g]);
  for(const x of MISSIONS)await pool.query("INSERT INTO game_missions(group_id,code,title,period,target,reward_gems,reward_xp) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",[g,...x]);
  for(const x of ACH)await pool.query("INSERT INTO game_achievements(group_id,code,name,name_fa,description,reward_gems) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",[g,...x]);
  for(const x of SHOP)await pool.query("INSERT INTO game_shop_items(group_id,code,name,item_type,description,price) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",[g,...x]);
}
async function ensurePlayer(pool:Pool,ctx:GameContext,id=ctx.userId,u?:GameUser){
  await ensureGameSchema(pool);
  await seed(pool,ctx.chatId);
  const p=u??(id===ctx.userId?ctx.user:undefined);
  const display=p?.firstName||p?.username||String(id);
  await pool.query("INSERT INTO game_players(group_id,user_id,username,first_name,display_name,status) VALUES($1,$2,$3,$4,$5,'active') ON CONFLICT(group_id,user_id) DO UPDATE SET username=COALESCE(EXCLUDED.username,game_players.username),first_name=COALESCE(EXCLUDED.first_name,game_players.first_name),display_name=COALESCE(EXCLUDED.display_name,game_players.display_name),status='active',updated_at=NOW(),last_active_at=NOW()",[ctx.chatId,id,p?.username??null,p?.firstName??null,display]);
  await pool.query("INSERT INTO game_player_progression(group_id,user_id,level,xp,total_xp) SELECT group_id,user_id,level,xp,xp FROM game_players WHERE group_id=$1 AND user_id=$2 ON CONFLICT(group_id,user_id) DO UPDATE SET level=EXCLUDED.level,xp=EXCLUDED.xp,total_xp=GREATEST(game_player_progression.total_xp,EXCLUDED.total_xp),updated_at=NOW()",[ctx.chatId,id]);
  await pool.query("INSERT INTO game_wallets(group_id,user_id,balance,lifetime_earned,lifetime_spent) SELECT p.group_id,p.user_id,p.gems,COALESCE((SELECT SUM(delta) FROM game_wallet_ledger l WHERE l.group_id=p.group_id AND l.user_id=p.user_id AND l.delta>0),0),COALESCE((SELECT SUM(ABS(delta)) FROM game_wallet_ledger l WHERE l.group_id=p.group_id AND l.user_id=p.user_id AND l.delta<0),0) FROM game_players p WHERE p.group_id=$1 AND p.user_id=$2 ON CONFLICT(group_id,user_id) DO UPDATE SET balance=EXCLUDED.balance,updated_at=NOW()",[ctx.chatId,id]);
  await pool.query("INSERT INTO game_player_stats(group_id,user_id,total_games,wins,losses,high_score,current_streak,best_streak) SELECT group_id,user_id,total_games,wins,losses,high_score,current_streak,best_streak FROM game_players WHERE group_id=$1 AND user_id=$2 ON CONFLICT(group_id,user_id) DO UPDATE SET total_games=EXCLUDED.total_games,wins=EXCLUDED.wins,losses=EXCLUDED.losses,high_score=EXCLUDED.high_score,current_streak=EXCLUDED.current_streak,best_streak=EXCLUDED.best_streak,updated_at=NOW()",[ctx.chatId,id]);
  await pool.query("INSERT INTO game_player_rating(group_id,user_id,rating,league_points) SELECT group_id,user_id,rating,rating FROM game_players WHERE group_id=$1 AND user_id=$2 ON CONFLICT(group_id,user_id) DO UPDATE SET rating=EXCLUDED.rating,league_points=EXCLUDED.league_points,updated_at=NOW()",[ctx.chatId,id]);
  await pool.query("INSERT INTO game_player_streaks(group_id,user_id,current_streak,best_streak) SELECT group_id,user_id,current_streak,best_streak FROM game_players WHERE group_id=$1 AND user_id=$2 ON CONFLICT(group_id,user_id) DO UPDATE SET current_streak=EXCLUDED.current_streak,best_streak=EXCLUDED.best_streak,updated_at=NOW()",[ctx.chatId,id]);
}
async function changeGems(pool:Pool,g:number,u:number,d:number,reason:string,game?:string,meta:any={}){
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const r=await client.query<{gems:number}>("UPDATE game_players SET gems=gems+$3,updated_at=NOW(),last_active_at=NOW() WHERE group_id=$1 AND user_id=$2 AND gems+$3>=0 RETURNING gems",[g,u,d]);
    if(!r.rows[0]){await client.query("ROLLBACK");return {ok:false,balance:null};}
    const b=Number(r.rows[0].gems),before=b-d;
    await client.query("INSERT INTO game_wallet_ledger(group_id,user_id,transaction_type,delta,balance_before,balance_after,reason,game_code,reference_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)",[g,u,d>=0?"credit":"debit",d,before,b,reason,game??null,meta?.reference_id??null,JSON.stringify(meta)]);
    await client.query("INSERT INTO game_wallets(group_id,user_id,balance,lifetime_earned,lifetime_spent,updated_at) VALUES($1,$2,$3,GREATEST($4,0),GREATEST($5,0),NOW()) ON CONFLICT(group_id,user_id) DO UPDATE SET balance=EXCLUDED.balance,lifetime_earned=game_wallets.lifetime_earned+GREATEST($4,0),lifetime_spent=game_wallets.lifetime_spent+GREATEST($5,0),updated_at=NOW()",[g,u,b,d,Math.abs(d)]);
    await client.query("INSERT INTO game_activity_log(group_id,user_id,action,category,amount,reference_id,metadata) VALUES($1,$2,$3,'اقتصاد',$4,$5,$6::jsonb)",[g,u,d>=0?"دریافت":"مصرف",d,game??null,JSON.stringify(meta)]);
    await client.query("COMMIT");
    return {ok:true,balance:b};
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}
  finally{client.release();}
}
async function addXp(pool:Pool,g:number,u:number,d:number){
  const r=await pool.query<{xp:number;level:number}>("UPDATE game_players SET xp=xp+$3,updated_at=NOW(),last_active_at=NOW() WHERE group_id=$1 AND user_id=$2 RETURNING xp,level",[g,u,d]);
  if(!r.rows[0])return {level:1,up:false};
  const old=Number(r.rows[0].level),now=lvl(Number(r.rows[0].xp));
  if(now!==old)await pool.query("UPDATE game_players SET level=$3,updated_at=NOW() WHERE group_id=$1 AND user_id=$2",[g,u,now]);
  await pool.query("INSERT INTO game_player_progression(group_id,user_id,level,xp,total_xp) VALUES($1,$2,$3,$4,$4) ON CONFLICT(group_id,user_id) DO UPDATE SET level=EXCLUDED.level,xp=EXCLUDED.xp,total_xp=game_player_progression.total_xp+GREATEST($5,0),updated_at=NOW()",[g,u,now,Number(r.rows[0].xp),d]);
  await pool.query("UPDATE game_player_stats SET total_xp_earned=total_xp_earned+GREATEST($3,0),updated_at=NOW() WHERE group_id=$1 AND user_id=$2",[g,u,d]);
  if(d!==0)await pool.query("INSERT INTO game_activity_log(group_id,user_id,action,category,amount,metadata) VALUES($1,$2,'تغییر تجربه','پیشرفت',$3,$4::jsonb)",[g,u,d,JSON.stringify({level:now})]);
  return {level:now,up:now>old};
}
async function updateMission(pool:Pool,g:number,u:number,code:string,d:number){
  const m=(await pool.query<{period:string}>("SELECT period FROM game_missions WHERE group_id=$1 AND code=$2",[g,code])).rows[0];if(!m)return;
  const ck=period(m.period);await pool.query("INSERT INTO game_mission_progress(group_id,user_id,code,progress,claim_key,claimed) VALUES($1,$2,$3,$4,$5,FALSE) ON CONFLICT(group_id,user_id,code) DO UPDATE SET progress=CASE WHEN game_mission_progress.claim_key IS DISTINCT FROM EXCLUDED.claim_key THEN EXCLUDED.progress ELSE game_mission_progress.progress+EXCLUDED.progress END,claim_key=EXCLUDED.claim_key,claimed=CASE WHEN game_mission_progress.claim_key IS DISTINCT FROM EXCLUDED.claim_key THEN FALSE ELSE game_mission_progress.claimed END,updated_at=NOW()",[g,u,code,d,ck]);
}
async function updateSeason(pool:Pool,g:number,u:number,x:number,win:boolean){
  const d=new Date(),code="S"+d.getUTCFullYear()+String(d.getUTCMonth()+1).padStart(2,"0"),start=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)),end=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0,23,59,59));
  await pool.query("INSERT INTO game_seasons(group_id,season_code,title,starts_at,ends_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",[g,code,"Season "+code.slice(1),start,end]);
  const s=(await pool.query<{id:number}>("SELECT id FROM game_seasons WHERE group_id=$1 AND season_code=$2",[g,code])).rows[0];if(!s)return;
  await pool.query("INSERT INTO game_season_players(season_id,group_id,user_id,season_xp,season_games,season_wins) VALUES($1,$2,$3,$4,1,$5) ON CONFLICT(season_id,user_id) DO UPDATE SET season_xp=game_season_players.season_xp+EXCLUDED.season_xp,season_games=game_season_players.season_games+1,season_wins=game_season_players.season_wins+EXCLUDED.season_wins",[s.id,g,u,x,win?1:0]);
}
async function unlock(pool:Pool,g:number,u:number){
  const p=(await pool.query<any>("SELECT total_games,wins,quiz_wins FROM game_players WHERE group_id=$1 AND user_id=$2",[g,u])).rows[0];if(!p)return [];
  const list:string[]=[];if(+p.total_games>=1)list.push("first_game");if(+p.wins>=1)list.push("first_win");if(+p.wins>=10)list.push("ten_wins");if(+p.wins>=50)list.push("fifty_wins");if(+p.total_games>=100)list.push("hundred_games");if(+p.quiz_wins>=10)list.push("quiz_master");
  const out:string[]=[];for(const code of list){const q=await pool.query("INSERT INTO game_player_achievements(group_id,user_id,code) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[g,u,code]);if(!q.rowCount)continue;const reward=Number((await pool.query<{reward_gems:number}>("SELECT reward_gems FROM game_achievements WHERE group_id=$1 AND code=$2",[g,code])).rows[0]?.reward_gems||0);if(reward)await changeGems(pool,g,u,reward,"Achievement reward",code);out.push(code);}return out;
}
async function record(pool:Pool,ctx:GameContext,code:string,win:boolean,x:number,g:number,rd:number,meta:any={}){
  await pool.query("UPDATE game_players SET total_games=total_games+1,wins=wins+$3,losses=losses+$4,current_streak=CASE WHEN $5 THEN current_streak+1 ELSE 0 END,best_streak=GREATEST(best_streak,CASE WHEN $5 THEN current_streak+1 ELSE current_streak END),rating=GREATEST(0,rating+$6),updated_at=NOW(),last_active_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId,win?1:0,win?0:1,win,rd]);
  await pool.query("UPDATE game_players SET high_score=GREATEST(high_score,rating),updated_at=NOW() WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId]);
  await pool.query("INSERT INTO game_player_stats(group_id,user_id,total_games,wins,losses,high_score,current_streak,best_streak) SELECT group_id,user_id,total_games,wins,losses,high_score,current_streak,best_streak FROM game_players WHERE group_id=$1 AND user_id=$2 ON CONFLICT(group_id,user_id) DO UPDATE SET total_games=EXCLUDED.total_games,wins=EXCLUDED.wins,losses=EXCLUDED.losses,high_score=EXCLUDED.high_score,current_streak=EXCLUDED.current_streak,best_streak=EXCLUDED.best_streak,updated_at=NOW()",[ctx.chatId,ctx.userId]);
  await pool.query("INSERT INTO game_player_rating(group_id,user_id,rating,league_points) SELECT group_id,user_id,rating,rating FROM game_players WHERE group_id=$1 AND user_id=$2 ON CONFLICT(group_id,user_id) DO UPDATE SET rating=EXCLUDED.rating,league_points=EXCLUDED.league_points,updated_at=NOW()",[ctx.chatId,ctx.userId]);
  await pool.query("INSERT INTO game_player_streaks(group_id,user_id,current_streak,best_streak) SELECT group_id,user_id,current_streak,best_streak FROM game_players WHERE group_id=$1 AND user_id=$2 ON CONFLICT(group_id,user_id) DO UPDATE SET current_streak=EXCLUDED.current_streak,best_streak=EXCLUDED.best_streak,updated_at=NOW()",[ctx.chatId,ctx.userId]);

  const xr=await addXp(pool,ctx.chatId,ctx.userId,x);if(g){const gr=await changeGems(pool,ctx.chatId,ctx.userId,g,"Game reward",code,meta);if(!gr.ok)throw new Error("gem transaction rejected");}
  await pool.query("INSERT INTO game_match_history(group_id,user_id,game_code,result,xp_earned,gems_earned,rating_delta,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",[ctx.chatId,ctx.userId,code,win?"win":"loss",x,Math.max(0,g),rd,JSON.stringify(meta)]);
  await updateMission(pool,ctx.chatId,ctx.userId,"play_3",1);await updateMission(pool,ctx.chatId,ctx.userId,"play_15",1);if(win){await updateMission(pool,ctx.chatId,ctx.userId,"win_1",1);await updateMission(pool,ctx.chatId,ctx.userId,"win_8",1);}if(g>0){await updateMission(pool,ctx.chatId,ctx.userId,"earn_100",g);await updateMission(pool,ctx.chatId,ctx.userId,"earn_500",g);}await updateSeason(pool,ctx.chatId,ctx.userId,x,win);const a=await unlock(pool,ctx.chatId,ctx.userId);return {xr,a};
}
async function profile(pool:Pool,ctx:GameContext,id:number,name?:string){
  await ensurePlayer(pool,ctx,id,id===ctx.userId?ctx.user:{id,firstName:name});const p=(await pool.query<any>("SELECT * FROM game_players WHERE group_id=$1 AND user_id=$2",[ctx.chatId,id])).rows[0];
  const l=+p.level,x=+p.xp,g=+p.gems,r=+p.rating,w=+p.wins,lo=+p.losses,ga=+p.total_games,rate=ga?((w/ga)*100).toFixed(1):"0.0",ac=Number((await pool.query("SELECT COUNT(*)::int n FROM game_player_achievements WHERE group_id=$1 AND user_id=$2",[ctx.chatId,id])).rows[0]?.n||0);
  const inv=Number((await pool.query("SELECT COALESCE(SUM(quantity),0)::int n FROM game_inventory WHERE group_id=$1 AND user_id=$2",[ctx.chatId,id])).rows[0]?.n||0);
  const nameOut=p.first_name||name||String(id);return ["◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Gᴀᴍᴇ Pʀᴏғɪʟᴇ","","⛂ - نام : "+nameOut,"⛂ - نام کاربری : "+(p.username?"@"+p.username:"—"),"⛂ - شناسه : "+id,"","─────━━───── ◈ ─────━━─────","","⛂ - سطح : "+fa(l),"⛂ - تجربه : "+fa(x)+" XP","⛂ - پیشرفت : "+bar(x,l),"⛂ - جم : "+fa(g),"⛂ - لیگ : "+league(r),"⛂ - امتیاز رقابتی : "+fa(r),"","⛂ - بازی‌ها : "+fa(ga),"⛂ - برد : "+fa(w),"⛂ - باخت : "+fa(lo),"⛂ - درصد برد : "+rate+"٪","⛂ - زنجیره فعلی : "+fa(+p.current_streak),"⛂ - بهترین زنجیره : "+fa(+p.best_streak),"","⛂ - دستاوردها : "+fa(ac),"⛂ - آیتم‌ها : "+fa(inv)].join("\n");
}
async function center(pool:Pool,ctx:GameContext){
  await ensurePlayer(pool,ctx);
  const p=(await pool.query<any>("SELECT level,xp,gems,rating,total_games,wins,losses,current_streak,high_score FROM game_players WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId])).rows[0];
  const pos=Number((await pool.query("SELECT 1+COUNT(*)::int pos FROM game_players a JOIN game_players me ON me.group_id=a.group_id AND me.user_id=$2 WHERE a.group_id=$1 AND (a.rating>me.rating OR (a.rating=me.rating AND a.user_id<me.user_id))",[ctx.chatId,ctx.userId])).rows[0]?.pos||1);
  const nextXp=req(+p.level);
  const today=new Date().toISOString().slice(0,10);
  const claimed=(await pool.query("SELECT 1 FROM game_daily_claims WHERE group_id=$1 AND user_id=$2 AND claim_key=$3 LIMIT 1",[ctx.chatId,ctx.userId,today])).rowCount>0;
  const dailyReward=Number((await pool.query<{daily_reward:number}>("SELECT daily_reward FROM game_group_settings WHERE group_id=$1",[ctx.chatId])).rows[0]?.daily_reward??50);
  const status=await enabled(pool,ctx.chatId)?"فعال":"خاموش";
  return [
    "◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Gᴀᴍᴇ Cᴇɴᴛᴇʀ",
    "",
    "به مرکز بازی خوش آمدید، "+(ctx.user.firstName||ctx.user.username||String(ctx.userId))+" .",
    "",
    "⛂ - نام بازیکن : "+(ctx.user.firstName||ctx.user.username||String(ctx.userId)),
    "⛂ - سطح : "+fa(+p.level),
    "⛂ - رتبه : #"+fa(pos),
    "⛂ - امتیاز : "+fa(+p.rating),
    "⛂ - جم : "+fa(+p.gems),
    "",
    "                     ─────━━───── ◈ ─────━━─────",
    "",
    "⛂ - تجربه : "+fa(+p.xp)+" / "+fa(nextXp)+" XP",
    "⛂ - بردها : "+fa(+p.wins),
    "⛂ - باخت‌ها : "+fa(+p.losses),
    "⛂ - بازی‌ها : "+fa(+p.total_games),
    "⛂ - برد متوالی : "+fa(+p.current_streak),
    "⛂ - رکورد امتیاز : "+fa(+p.high_score),
    "",
    "                     ─────━━───── ◈ ─────━━─────",
    "",
    "وضعیت بازیکن : "+status,
    "فعالیت امروز : "+(claimed?"انجام شده":"فعال"),
    "پاداش روزانه : "+fa(dailyReward)+" جم",
    "",
    "برای ادامه، یکی از بخش‌های زیر را انتخاب کنید."
  ].join("\n");
}
async function rank(pool:Pool,ctx:GameContext){
  await ensurePlayer(pool,ctx);const rows=(await pool.query<any>("SELECT user_id,COALESCE(username,first_name,user_id::text) name,rating FROM game_players WHERE group_id=$1 ORDER BY rating DESC,user_id ASC LIMIT 10",[ctx.chatId])).rows;const pos=Number((await pool.query("SELECT 1+COUNT(*)::int pos FROM game_players a JOIN game_players me ON me.group_id=a.group_id AND me.user_id=$2 WHERE a.group_id=$1 AND (a.rating>me.rating OR (a.rating=me.rating AND a.user_id<me.user_id))",[ctx.chatId,ctx.userId])).rows[0]?.pos||1);
  return ["◈ Gᴀᴍᴇ Lᴇᴀᴅᴇʀʙᴏᴀʀᴅ","",...rows.map((x:any,i:number)=>String(i+1).padStart(2,"0")+" · "+(String(x.name).startsWith("@")?x.name:"@"+x.name)+" · "+fa(+x.rating)+" · "+league(+x.rating)),"","⛂ - رتبه شما : #"+fa(pos)].join("\n");
}
async function stats(pool:Pool,ctx:GameContext){
  await ensurePlayer(pool,ctx);const p=(await pool.query<any>("SELECT total_games,wins,losses,current_streak,best_streak,xp FROM game_players WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId])).rows[0];const earned=Number((await pool.query("SELECT COALESCE(SUM(delta),0)::bigint n FROM game_wallet_ledger WHERE group_id=$1 AND user_id=$2 AND delta>0",[ctx.chatId,ctx.userId])).rows[0]?.n||0),spent=Math.abs(Number((await pool.query("SELECT COALESCE(SUM(delta),0)::bigint n FROM game_wallet_ledger WHERE group_id=$1 AND user_id=$2 AND delta<0",[ctx.chatId,ctx.userId])).rows[0]?.n||0));
  return ["◈ Gᴀᴍᴇ Sᴛᴀᴛs","","⛂ - بازی‌ها : "+fa(+p.total_games),"⛂ - برد : "+fa(+p.wins),"⛂ - باخت : "+fa(+p.losses),"⛂ - زنجیره فعلی : "+fa(+p.current_streak),"⛂ - بهترین زنجیره : "+fa(+p.best_streak),"⛂ - XP : "+fa(+p.xp),"⛂ - جم دریافت‌شده : "+fa(earned),"⛂ - جم مصرف‌شده : "+fa(spent)].join("\n");
}
async function missionsText(pool:Pool,ctx:GameContext){
  await ensurePlayer(pool,ctx);const rows=(await pool.query<any>("SELECT m.title,m.target,m.reward_gems,COALESCE(p.progress,0) progress,COALESCE(p.claimed,FALSE) claimed FROM game_missions m LEFT JOIN game_mission_progress p ON p.group_id=m.group_id AND p.user_id=$2 AND p.code=m.code WHERE m.group_id=$1 AND m.enabled=TRUE ORDER BY CASE WHEN m.period='daily' THEN 0 ELSE 1 END,m.code",[ctx.chatId,ctx.userId])).rows;
  return ["◈ Gᴀᴍᴇ Mɪssɪᴏɴs","",...rows.map((x:any)=>(x.claimed?"✓":"○")+" "+x.title+" · "+fa(Math.min(+x.progress,+x.target))+"/"+fa(+x.target)+" · +"+fa(+x.reward_gems)+" جم"),"","دریافت پاداش: دریافت مأموریت‌ها"].join("\n");
}
async function claim(pool:Pool,ctx:GameContext){
  await ensurePlayer(pool,ctx);const rows=(await pool.query<any>("SELECT m.code,m.target,m.reward_gems,m.reward_xp,COALESCE(p.progress,0) progress,COALESCE(p.claimed,FALSE) claimed FROM game_missions m LEFT JOIN game_mission_progress p ON p.group_id=m.group_id AND p.user_id=$2 AND p.code=m.code WHERE m.group_id=$1 AND m.enabled=TRUE",[ctx.chatId,ctx.userId])).rows;let c=0,g=0,x=0;
  for(const q of rows)if(!q.claimed&&+q.progress>=+q.target){const u=await pool.query("UPDATE game_mission_progress SET claimed=TRUE WHERE group_id=$1 AND user_id=$2 AND code=$3 AND claimed=FALSE",[ctx.chatId,ctx.userId,q.code]);if(u.rowCount){if(+q.reward_gems){await changeGems(pool,ctx.chatId,ctx.userId,+q.reward_gems,"Mission reward",q.code);g+=+q.reward_gems;}if(+q.reward_xp){await addXp(pool,ctx.chatId,ctx.userId,+q.reward_xp);x+=+q.reward_xp;}c++;}}
  return c?"✓ "+fa(c)+" مأموریت دریافت شد.\n⛂ - جم : +"+fa(g)+"\n⛂ - XP : +"+fa(x):"⛂ - مأموریت کامل‌شده‌ای وجود ندارد.";
}
async function achievementsText(pool:Pool,ctx:GameContext){
  await ensurePlayer(pool,ctx);const rows=(await pool.query<any>("SELECT name_fa,description,reward_gems,EXISTS(SELECT 1 FROM game_player_achievements p WHERE p.group_id=a.group_id AND p.user_id=$2 AND p.code=a.code) unlocked FROM game_achievements a WHERE a.group_id=$1 ORDER BY code",[ctx.chatId,ctx.userId])).rows;
  return ["◈ Gᴀᴍᴇ Aᴄʜɪᴇᴠᴇᴍᴇɴᴛs","",...rows.map((x:any)=>(x.unlocked?"✓":"○")+" "+x.name_fa+" · "+x.description+" · +"+fa(+x.reward_gems)+" جم")].join("\n");
}
async function shop(pool:Pool,ctx:GameContext){
  await ensurePlayer(pool,ctx);const p=Number((await pool.query("SELECT gems FROM game_players WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId])).rows[0]?.gems||0),rows=(await pool.query<any>("SELECT code,name,description,price FROM game_shop_items WHERE group_id=$1 AND enabled=TRUE ORDER BY price",[ctx.chatId])).rows;
  return ["◈ Gᴀᴍᴇ Sʜᴏᴘ","","⛂ - موجودی شما : "+fa(p)+" جم","",...rows.map((x:any)=>x.code+" · "+x.name+" · "+fa(+x.price)+" جم\n  "+x.description),"","خرید: خرید آیتم gold_frame"].join("\n");
}
async function buy(pool:Pool,ctx:GameContext,code:string){
  await ensurePlayer(pool,ctx);const item=(await pool.query<any>("SELECT * FROM game_shop_items WHERE group_id=$1 AND code=$2 AND enabled=TRUE",[ctx.chatId,code])).rows[0];if(!item)return "✗ آیتم پیدا نشد.";const r=await changeGems(pool,ctx.chatId,ctx.userId,-Number(item.price),"Shop purchase",item.code);if(!r.ok)return "✗ موجودی جم کافی نیست.";await pool.query("INSERT INTO game_inventory(group_id,user_id,item_code,quantity) VALUES($1,$2,$3,1) ON CONFLICT(group_id,user_id,item_code) DO UPDATE SET quantity=game_inventory.quantity+1",[ctx.chatId,ctx.userId,item.code]);return "✓ خرید انجام شد.\n⛂ - آیتم : "+item.name+"\n⛂ - هزینه : "+fa(+item.price)+" جم\n⛂ - موجودی جدید : "+fa(Number(r.balance));
}
async function inventory(pool:Pool,ctx:GameContext){
  await ensurePlayer(pool,ctx);const rows=(await pool.query<any>("SELECT i.item_code,s.name,i.quantity FROM game_inventory i JOIN game_shop_items s ON s.group_id=i.group_id AND s.code=i.item_code WHERE i.group_id=$1 AND i.user_id=$2 AND i.quantity>0 ORDER BY s.name",[ctx.chatId,ctx.userId])).rows;return ["◈ Gᴀᴍᴇ Iɴᴠᴇɴᴛᴏʀʏ","",rows.length?rows.map((x:any)=>"⛂ - "+x.item_code+" · "+x.name+" · "+fa(+x.quantity)):["⛂ - انبار خالی است."]].flat().join("\n");
}
async function history(pool:Pool,ctx:GameContext){
  await ensurePlayer(pool,ctx);const m=(await pool.query<any>("SELECT game_code,result,xp_earned,gems_earned,rating_delta FROM game_match_history WHERE group_id=$1 AND user_id=$2 ORDER BY id DESC LIMIT 10",[ctx.chatId,ctx.userId])).rows,l=(await pool.query<any>("SELECT delta,balance_after,reason FROM game_wallet_ledger WHERE group_id=$1 AND user_id=$2 ORDER BY id DESC LIMIT 10",[ctx.chatId,ctx.userId])).rows;
  return ["◈ Gᴀᴍᴇ Hɪsᴛᴏʀʏ","","◈ مسابقات",...(m.length?m.map((x:any)=>"⛂ - "+x.game_code+" · "+x.result+" · +"+fa(+x.xp_earned)+" XP · "+(+x.gems_earned>=0?"+":"")+fa(+x.gems_earned)+" جم"):["⛂ - سابقه مسابقه‌ای ثبت نشده است."]),"","◈ تراکنش‌های جم",...(l.length?l.map((x:any)=>"⛂ - "+(+x.delta>=0?"+":"")+fa(+x.delta)+" جم · "+x.reason+" · موجودی "+fa(+x.balance_after)):["⛂ - تراکنش ثبت نشده است."])].join("\n");
}
async function seasonText(pool:Pool,ctx:GameContext){
  await ensurePlayer(pool,ctx);await updateSeason(pool,ctx.chatId,ctx.userId,0,false);const d=new Date(),code="S"+d.getUTCFullYear()+String(d.getUTCMonth()+1).padStart(2,"0"),s=(await pool.query<any>("SELECT * FROM game_seasons WHERE group_id=$1 AND season_code=$2",[ctx.chatId,code])).rows[0],p=(await pool.query<any>("SELECT * FROM game_season_players WHERE season_id=$1 AND user_id=$2",[s.id,ctx.userId])).rows[0],top=(await pool.query<any>("SELECT user_id,season_xp,season_wins FROM game_season_players WHERE season_id=$1 ORDER BY season_xp DESC,season_wins DESC LIMIT 5",[s.id])).rows;
  return ["◈ Gᴀᴍᴇ Sᴇᴀsᴏɴ","","⛂ - فصل : "+s.title,"⛂ - XP فصل شما : "+fa(+p?.season_xp||0),"⛂ - بازی فصل : "+fa(+p?.season_games||0),"⛂ - برد فصل : "+fa(+p?.season_wins||0),"","◈ رده‌بندی فصل",...top.map((x:any,i:number)=>String(i+1).padStart(2,"0")+" · "+x.user_id+" · "+fa(+x.season_xp)+" XP")].join("\n");
}
async function enabled(pool:Pool,g:number){const r=await pool.query<{enabled:boolean}>("SELECT enabled FROM game_group_settings WHERE group_id=$1",[g]).catch(()=>({rows:[] as Array<{enabled:boolean}>}));return r.rows[0]?.enabled!==false;}
async function daily(pool:Pool,ctx:GameContext){await ensurePlayer(pool,ctx);const d=new Date().toISOString().slice(0,10);const q=await pool.query("INSERT INTO game_daily_claims(group_id,user_id,claim_key) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[ctx.chatId,ctx.userId,d]);if(!q.rowCount)return "⛂ - جایزه روزانه امروز قبلاً دریافت شده است.";const s=(await pool.query<{daily_reward:number}>("SELECT daily_reward FROM game_group_settings WHERE group_id=$1",[ctx.chatId])).rows[0];const g=Number(s?.daily_reward??50);const gr=await changeGems(pool,ctx.chatId,ctx.userId,g,"Daily reward","daily");await addXp(pool,ctx.chatId,ctx.userId,80);return gr.ok?"✓ جایزه روزانه دریافت شد.\n⛂ - جم : +"+fa(g)+"\n⛂ - XP : +"+fa(80):"✗ دریافت جایزه انجام نشد."}
async function dice(pool:Pool,ctx:GameContext){
  await ensurePlayer(pool,ctx);if(!(await enabled(pool,ctx.chatId)))return "✗ سیستم بازی در این گروه خاموش است.";const r=1+Math.floor(Math.random()*6),win=r>=5,g=win?(r===6?80:45):10,x=win?70:25,rd=win?20:-10,res=await record(pool,ctx,"dice",win,x,g,rd,{roll:r});
  if(r===6){const q=await pool.query("INSERT INTO game_player_achievements(group_id,user_id,code) VALUES($1,$2,'high_roller') ON CONFLICT DO NOTHING",[ctx.chatId,ctx.userId]);if(q.rowCount){await changeGems(pool,ctx.chatId,ctx.userId,120,"Achievement reward","high_roller");res.a.push("High Roller");}}
  return ["◈ Dɪᴄᴇ","","⛂ - نتیجه : "+fa(r),"⛂ - وضعیت : "+(win?"برد":"باخت"),"⛂ - پاداش : +"+fa(g)+" جم","⛂ - تجربه : +"+fa(x)+" XP","⛂ - امتیاز : "+(rd>=0?"+":"")+fa(rd),res.xr.up?"⛂ - سطح جدید : "+fa(res.xr.level):"",res.a.length?"⛂ - دستاورد جدید : "+res.a.join(" · "):""].filter(Boolean).join("\n");
}
async function startQuiz(pool:Pool,ctx:GameContext){
  await ensurePlayer(pool,ctx);if(!(await enabled(pool,ctx.chatId)))return "✗ سیستم بازی در این گروه خاموش است.";const q=QUESTIONS[Math.floor(Math.random()*QUESTIONS.length)];quiz.set(key(ctx.chatId,ctx.userId),{answer:q.a,question:q.q,expires:Date.now()+45000});return ["◈ Qᴜɪᴢ","",q.q,"","۱) "+q.o[0],"۲) "+q.o[1],"۳) "+q.o[2],"۴) "+q.o[3],"","⛂ - زمان پاسخ : ۴۵ ثانیه","⛂ - پاسخ را فقط ۱ تا ۴ ارسال کن."].join("\n");
}
async function answerQuiz(pool:Pool,ctx:GameContext,value:string){
  const s=quiz.get(key(ctx.chatId,ctx.userId));if(!s)return null;if(s.expires<Date.now()){quiz.delete(key(ctx.chatId,ctx.userId));return "⛂ - زمان کوییز تمام شد.";}if(!/^[1-4۰-۹]$/.test(value))return null;const a=Number(value.replace(/[۰-۹]/g,d=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))))-1;quiz.delete(key(ctx.chatId,ctx.userId));const win=a===s.answer,res=await record(pool,ctx,"quiz",win,win?100:30,win?70:5,win?35:-15,{question:s.question,answer:a});if(win){await pool.query("UPDATE game_players SET quiz_wins=quiz_wins+1 WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId]);await updateMission(pool,ctx.chatId,ctx.userId,"quiz_3",1);}
  return ["◈ Qᴜɪᴢ · نتیجه","","⛂ - پاسخ شما : "+(a+1),"⛂ - پاسخ صحیح : "+(s.answer+1),"⛂ - نتیجه : "+(win?"صحیح · برد":"غلط · باخت"),"⛂ - پاداش : +"+fa(win?70:5)+" جم","⛂ - تجربه : +"+fa(win?100:30)+" XP",res.xr.up?"⛂ - سطح جدید : "+fa(res.xr.level):"",res.a.length?"⛂ - دستاورد جدید : "+res.a.join(" · "):""].filter(Boolean).join("\n");
}

export async function handleGameText(ctx:GameContext,text:string):Promise<string|null>{
  const raw=String(text??"").trim(),z=norm(raw.replace(/^[/!.]+/,""));if(!raw)return null;
  const known=quiz.has(key(ctx.chatId,ctx.userId)) || ["بازی","game","game center","مرکز بازی","راهنمای بازی","game help","game guide","پروفایل بازی","پروفایل گیم","game profile","gprofile","جم","gems","gem","game wallet","کیف پول بازی","رتبه بازی","game rank","جدول بازی","game leaderboard","leaderboard","آمار بازی","game stats","game statistics","تاریخچه بازی","game history","history game","ماموریت‌های بازی","ماموریت های بازی","game missions","دستاوردهای بازی","دستاورد های بازی","game achievements","فروشگاه بازی","game shop","shop game","انبار بازی","game inventory","inventory","فصل بازی","game season","season game","جایزه روزانه","پاداش روزانه","daily","daily reward","تاس","dice","بازی تاس","dice game","کوییز","کوییز بازی","quiz","game quiz","بازی روشن","game on","game enable","بازی خاموش","game off","game disable"].includes(z) || /^(?:خرید آیتم|buy item|purchase)\s+[a-z0-9_-]{2,50}$/i.test(z) || /^(?:دادن جم|grant gems|grant gem)\s+\d+$/i.test(raw) || /^(?:کسر جم|remove gems|remove gem)\s+\d+$/i.test(raw);
  if(!known)return null;await ensureGameSchema(ctx.pool);await ensurePlayer(ctx.pool,ctx);const qa=await answerQuiz(ctx.pool,ctx,raw);if(qa!==null)return qa;
  if(["بازی","game","game center","مرکز بازی"].includes(z))return center(ctx.pool,ctx);
  if(["راهنمای بازی","game help","game guide"].includes(z))return ["◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Gᴀᴍᴇ Hᴇʟᴘ","","بازی · game","پروفایل بازی · game profile","جم · gems","رتبه بازی · game rank","جدول بازی · game leaderboard","آمار بازی · game stats","تاریخچه بازی · game history","ماموریت‌های بازی · game missions","دریافت مأموریت‌ها · claim missions","دستاوردهای بازی · game achievements","فروشگاه بازی · game shop","خرید آیتم <code> · buy item <code>","انبار بازی · game inventory","فصل بازی · game season","جایزه روزانه · daily","تاس · dice","کوییز · quiz","بازی روشن · game on","بازی خاموش · game off","دادن جم <amount> با Reply · grant gems <amount>","کسر جم <amount> با Reply · remove gems <amount>"].join("\n");
  if(["پروفایل بازی","پروفایل گیم","game profile","gprofile"].includes(z))return profile(ctx.pool,ctx,ctx.replyToUserId??ctx.userId,ctx.replyToName);
  if(["جم","gems","gem","game wallet","کیف پول بازی"].includes(z)){const p=(await ctx.pool.query<any>("SELECT gems,level,xp,rating FROM game_players WHERE group_id=$1 AND user_id=$2",[ctx.chatId,ctx.userId])).rows[0];return "◈ Gᴀᴍᴇ Wᴀʟʟᴇᴛ\n\n⛂ - جم : "+fa(+p.gems)+"\n⛂ - سطح : "+fa(+p.level)+"\n⛂ - XP : "+fa(+p.xp)+"\n⛂ - لیگ : "+league(+p.rating);}
  if(["رتبه بازی","game rank","جدول بازی","game leaderboard","leaderboard"].includes(z))return rank(ctx.pool,ctx);
  if(["آمار بازی","game stats","game statistics"].includes(z))return stats(ctx.pool,ctx);
  if(["تاریخچه بازی","game history","history game"].includes(z))return history(ctx.pool,ctx);
  if(["ماموریت‌های بازی","ماموریت های بازی","game missions"].includes(z))return missionsText(ctx.pool,ctx);
  if(["دریافت مأموریت‌ها","دریافت ماموریت‌ها","claim missions"].includes(z))return claim(ctx.pool,ctx);
  if(["دستاوردهای بازی","دستاورد های بازی","game achievements"].includes(z))return achievementsText(ctx.pool,ctx);
  if(["فروشگاه بازی","game shop","shop game"].includes(z))return shop(ctx.pool,ctx);
  if(["انبار بازی","game inventory","inventory"].includes(z))return inventory(ctx.pool,ctx);
  if(["فصل بازی","game season","season game"].includes(z))return seasonText(ctx.pool,ctx);
  const bm=z.match(/^(?:خرید آیتم|buy item|purchase)\s+([a-z0-9_-]{2,50})$/i);if(bm)return buy(ctx.pool,ctx,bm[1]);
  if(["تاس","dice","بازی تاس","dice game"].includes(z))return dice(ctx.pool,ctx);
  if(["جایزه روزانه","پاداش روزانه","daily","daily reward"].includes(z))return daily(ctx.pool,ctx);
  if(["کوییز","کوییز بازی","quiz","game quiz"].includes(z))return startQuiz(ctx.pool,ctx);
  if(["بازی روشن","game on","game enable"].includes(z)){if(!ctx.isAdmin)return "✗ فقط مدیر گروه می‌تواند سیستم بازی را روشن کند.";await ctx.pool.query("INSERT INTO game_group_settings(group_id,enabled) VALUES($1,TRUE) ON CONFLICT(group_id) DO UPDATE SET enabled=TRUE,updated_at=NOW()",[ctx.chatId]);return "✓ سیستم بازی برای این گروه فعال شد.";}
  if(["بازی خاموش","game off","game disable"].includes(z)){if(!ctx.isAdmin)return "✗ فقط مدیر گروه می‌تواند سیستم بازی را خاموش کند.";await ctx.pool.query("INSERT INTO game_group_settings(group_id,enabled) VALUES($1,FALSE) ON CONFLICT(group_id) DO UPDATE SET enabled=FALSE,updated_at=NOW()",[ctx.chatId]);return "✓ سیستم بازی برای این گروه خاموش شد.";}
  const gm=raw.match(/^(?:دادن جم|grant gems|grant gem)\s+(\d+)$/i);if(gm){if(!ctx.isAdmin)return "✗ فقط مدیر گروه می‌تواند جم اعطا کند.";if(!ctx.replyToUserId)return "✗ روی کاربر ریپلای کن و مقدار جم را بنویس.";await ensurePlayer(ctx.pool,ctx,ctx.replyToUserId,{id:ctx.replyToUserId,firstName:ctx.replyToName});const r=await changeGems(ctx.pool,ctx.chatId,ctx.replyToUserId,+gm[1],"Admin grant",undefined,{actor:ctx.userId});return r.ok?"✓ "+fa(+gm[1])+" جم به کاربر اضافه شد.":"✗ عملیات انجام نشد.";}
  const rm=raw.match(/^(?:کسر جم|remove gems|remove gem)\s+(\d+)$/i);if(rm){if(!ctx.isAdmin)return "✗ فقط مدیر گروه می‌تواند جم کسر کند.";if(!ctx.replyToUserId)return "✗ روی کاربر ریپلای کن و مقدار جم را بنویس.";await ensurePlayer(ctx.pool,ctx,ctx.replyToUserId,{id:ctx.replyToUserId,firstName:ctx.replyToName});const r=await changeGems(ctx.pool,ctx.chatId,ctx.replyToUserId,-+rm[1],"Admin remove",undefined,{actor:ctx.userId});return r.ok?"✓ "+fa(+rm[1])+" جم از کاربر کسر شد.":"✗ موجودی کافی نیست؛ جم هرگز منفی نمی‌شود.";}
  return null;
}

export async function touchGamePlayer(pool:Pool,chatId:number,user:GameUser){await ensurePlayer(pool,{pool,chatId,userId:user.id,user,isAdmin:false});}
