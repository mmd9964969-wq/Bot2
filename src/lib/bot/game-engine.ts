import { createHmac, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import { telegramApi } from "../telegram/api.ts";
import type { GameContext } from "./game-core.ts";

export type EngineMode="solo"|"multi";
export type EngineTransport="bot"|"mini_app";

type EngineGame={
  code:string;
  name:string;
  mode:EngineTransport;
  turns:boolean;
  maxPlayers:number;
  kind:"choice"|"answer"|"board"|"action";
};

export const ENGINE_GAMES:EngineGame[]=[
  {code:"quiz",name:"کوییز",mode:"bot",turns:false,maxPlayers:1,kind:"choice"},
  {code:"guess_number",name:"حدس عدد",mode:"bot",turns:false,maxPlayers:1,kind:"choice"},
  {code:"rps_ai",name:"سنگ، کاغذ، قیچی با هوش مصنوعی",mode:"bot",turns:false,maxPlayers:1,kind:"choice"},
  {code:"true_false",name:"درست یا غلط",mode:"bot",turns:false,maxPlayers:1,kind:"choice"},
  {code:"word_guess",name:"حدس کلمه",mode:"bot",turns:false,maxPlayers:1,kind:"choice"},
  {code:"hidden_word",name:"کلمه پنهان",mode:"bot",turns:false,maxPlayers:1,kind:"choice"},
  {code:"word_chain",name:"زنجیره کلمات",mode:"bot",turns:true,maxPlayers:1,kind:"choice"},
  {code:"sudoku",name:"سودوکو",mode:"mini_app",turns:false,maxPlayers:1,kind:"board"},
  {code:"minesweeper",name:"مین‌روب",mode:"mini_app",turns:false,maxPlayers:1,kind:"board"},
  {code:"2048",name:"۲۰۴۸",mode:"mini_app",turns:false,maxPlayers:1,kind:"board"},
  {code:"fifteen",name:"پازل ۱۵",mode:"mini_app",turns:false,maxPlayers:1,kind:"board"},
  {code:"snake",name:"مار",mode:"mini_app",turns:false,maxPlayers:1,kind:"action"},
  {code:"maze",name:"لابیرنت",mode:"mini_app",turns:false,maxPlayers:1,kind:"board"},
  {code:"target",name:"شکار هدف",mode:"mini_app",turns:false,maxPlayers:1,kind:"action"},
  {code:"obstacles",name:"پرش از موانع",mode:"mini_app",turns:false,maxPlayers:1,kind:"action"},
  {code:"tower",name:"برج‌سازی",mode:"mini_app",turns:false,maxPlayers:1,kind:"action"},
  {code:"shooting",name:"تیراندازی به هدف",mode:"mini_app",turns:false,maxPlayers:1,kind:"action"},
  {code:"tic_tac_toe_ai",name:"دوز مقابل ربات",mode:"mini_app",turns:true,maxPlayers:1,kind:"board"},

  {code:"rps",name:"سنگ، کاغذ، قیچی",mode:"bot",turns:false,maxPlayers:2,kind:"choice"},
  {code:"quiz_duel",name:"کوییز رقابتی",mode:"bot",turns:false,maxPlayers:2,kind:"choice"},
  {code:"chess",name:"شطرنج",mode:"mini_app",turns:true,maxPlayers:2,kind:"board"},
  {code:"checkers",name:"چکرز",mode:"mini_app",turns:true,maxPlayers:2,kind:"board"},
  {code:"battleship",name:"نبرد ناوگان",mode:"mini_app",turns:true,maxPlayers:2,kind:"board"},
  {code:"word_duel",name:"حدس کلمه دوئلی",mode:"bot",turns:false,maxPlayers:2,kind:"choice"},
  {code:"math_battle",name:"جنگ ریاضی",mode:"bot",turns:false,maxPlayers:2,kind:"choice"},
  {code:"typing_speed",name:"سرعت تایپ",mode:"bot",turns:false,maxPlayers:2,kind:"answer"},
  {code:"reaction",name:"مسابقه واکنش",mode:"bot",turns:false,maxPlayers:2,kind:"answer"},
  {code:"memory_duel",name:"حافظه رقابتی",mode:"mini_app",turns:false,maxPlayers:2,kind:"board"},
  {code:"bingo",name:"بینگو",mode:"mini_app",turns:true,maxPlayers:2,kind:"board"},
  {code:"draw_guess",name:"نقاشی و حدس",mode:"mini_app",turns:true,maxPlayers:2,kind:"action"},
  {code:"emoji_guess",name:"حدس ایموجی",mode:"bot",turns:false,maxPlayers:2,kind:"choice"},
  {code:"trivia",name:"مسابقه اطلاعات عمومی",mode:"bot",turns:false,maxPlayers:2,kind:"choice"},
  {code:"territory",name:"نبرد منطقه‌ای",mode:"mini_app",turns:true,maxPlayers:2,kind:"board"},
  {code:"mini_golf",name:"مینی‌گلف",mode:"mini_app",turns:true,maxPlayers:2,kind:"action"},
  {code:"survival",name:"مسابقه بقا",mode:"mini_app",turns:false,maxPlayers:2,kind:"action"},
  {code:"treasure_hunt",name:"شکار گنج دونفره",mode:"mini_app",turns:true,maxPlayers:2,kind:"board"},
  {code:"duel_dice",name:"دوئل تاس",mode:"bot",turns:false,maxPlayers:2,kind:"choice"},
];

const byCode=new Map(ENGINE_GAMES.map(g=>[g.code,g]));
export const getEngineGame=(code:string)=>byCode.get(code);
export const isEngineGame=(code:string)=>byCode.has(code);

const SOLO_REWARD={win:{g:50,xp:70,r:12,c:1,s:120},loss:{g:10,xp:25,r:-3,c:0,s:40},draw:{g:18,xp:35,r:0,c:0,s:70}};
const MULTI_REWARD={win:{g:120,xp:150,r:35,c:3,s:300},loss:{g:30,xp:70,r:-15,c:0,s:90},draw:{g:50,xp:90,r:0,c:1,s:160}};

export async function ensureEngineSchema(pool:Pool){
  await pool.query("ALTER TABLE game_players ADD COLUMN IF NOT EXISTS cups INT NOT NULL DEFAULT 0 CHECK(cups>=0)");
  await pool.query("ALTER TABLE game_player_stats ADD COLUMN IF NOT EXISTS cups BIGINT NOT NULL DEFAULT 0 CHECK(cups>=0)");
  await pool.query("ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'solo'");
  await pool.query("ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS current_turn_user_id BIGINT");
  await pool.query("ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS turn_no INT NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS max_turns INT");
  await pool.query("ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS state JSONB NOT NULL DEFAULT '{}'::jsonb");
  await pool.query("ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS winner_id BIGINT");
  await pool.query("ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS ended_reason TEXT");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_game_sessions_active_turn ON game_sessions(group_id,status,current_turn_user_id)");
  await pool.query("CREATE TABLE IF NOT EXISTS game_session_players(session_id BIGINT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,group_id BIGINT NOT NULL,user_id BIGINT NOT NULL,slot INT NOT NULL CHECK(slot BETWEEN 1 AND 10),ready BOOLEAN NOT NULL DEFAULT TRUE,score BIGINT NOT NULL DEFAULT 0,cups_delta INT NOT NULL DEFAULT 0,joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),left_at TIMESTAMPTZ,PRIMARY KEY(session_id,user_id),UNIQUE(session_id,slot))");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_game_session_players_user ON game_session_players(group_id,user_id,joined_at DESC)");
  await pool.query("CREATE TABLE IF NOT EXISTS game_engine_events(id BIGSERIAL PRIMARY KEY,session_id BIGINT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,group_id BIGINT NOT NULL,user_id BIGINT,turn_no INT,action TEXT NOT NULL,payload JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS game_multiplayer_rooms(id BIGSERIAL PRIMARY KEY,group_id BIGINT NOT NULL,game_code TEXT NOT NULL,host_id BIGINT NOT NULL,max_players INT NOT NULL DEFAULT 2 CHECK(max_players BETWEEN 2 AND 10),status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','ready','active','finished','cancelled')),match_id BIGINT,metadata JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),started_at TIMESTAMPTZ,finished_at TIMESTAMPTZ,cancelled_at TIMESTAMPTZ)");
  await pool.query("CREATE TABLE IF NOT EXISTS game_multiplayer_room_players(room_id BIGINT NOT NULL REFERENCES game_multiplayer_rooms(id) ON DELETE CASCADE,group_id BIGINT NOT NULL,user_id BIGINT NOT NULL,slot INT NOT NULL CHECK(slot BETWEEN 1 AND 10),ready BOOLEAN NOT NULL DEFAULT TRUE,joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),left_at TIMESTAMPTZ,PRIMARY KEY(room_id,user_id),UNIQUE(room_id,slot))");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_game_rooms_group_status ON game_multiplayer_rooms(group_id,status,created_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_game_room_players_room ON game_multiplayer_room_players(room_id,slot)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_game_room_players_user ON game_multiplayer_room_players(group_id,user_id,joined_at DESC)");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_game_room_players_active_group_user ON game_multiplayer_room_players(group_id,user_id) WHERE left_at IS NULL");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_game_rooms_open_host ON game_multiplayer_rooms(group_id,host_id) WHERE status IN ('waiting','ready','active')");

  await pool.query("CREATE INDEX IF NOT EXISTS idx_game_engine_events_session ON game_engine_events(session_id,created_at)");
}

function reward(mode:EngineMode,result:"win"|"loss"|"draw"){return (mode==="multi"?MULTI_REWARD:SOLO_REWARD)[result];}

async function ensureParticipant(pool:Pool,ctx:GameContext,sessionId:number){
  const s=(await pool.query<any>("SELECT * FROM game_sessions WHERE id=$1 AND group_id=$2",[sessionId,ctx.chatId])).rows[0];
  if(!s)return null;
  const p=(await pool.query<any>("SELECT * FROM game_session_players WHERE session_id=$1 AND user_id=$2 AND left_at IS NULL",[sessionId,ctx.userId])).rows[0];
  if(!p)return null;
  return {s,p};
}

export async function createEngineSession(pool:Pool,ctx:GameContext,code:string,mode:EngineMode,playerIds:number[]=[ctx.userId]){
  const game=getEngineGame(code); if(!game)throw new Error("Unknown game: "+code);
  await ensureEngineSchema(pool);
  const unique=[...new Set(playerIds.map(Number))].filter(Number.isSafeInteger);
  if(unique.length<1||unique.length>game.maxPlayers)throw new Error("Invalid player count");
  const initial=initialState(code,unique);
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const currentTurn=game.turns?unique[0]:null;
    const q=await client.query<{id:number}>(
      "INSERT INTO game_sessions(group_id,game_code,creator_id,status,players_count,mode,current_turn_user_id,turn_no,max_turns,state,metadata,started_at) VALUES($1,$2,$3,'active',$4,$5,$6,0,$7,$8::jsonb,$9::jsonb,NOW()) RETURNING id",
      [ctx.chatId,code,ctx.userId,unique.length,mode,currentTurn,game.turns?Math.max(1,initial.maxTurns||100):null,JSON.stringify(initial),JSON.stringify({transport:game.mode})]
    );
    const sessionId=Number(q.rows[0].id);
    for(let i=0;i<unique.length;i++)await client.query("INSERT INTO game_session_players(session_id,group_id,user_id,slot) VALUES($1,$2,$3,$4)",[sessionId,ctx.chatId,unique[i],i+1]);
    await client.query("INSERT INTO game_engine_events(session_id,group_id,user_id,turn_no,action,payload) VALUES($1,$2,$3,0,'session_start',$4::jsonb)",[sessionId,ctx.chatId,ctx.userId,JSON.stringify({code,mode,players:unique})]);
    await client.query("COMMIT");
    return sessionId;
  }catch(e){await client.query("ROLLBACK").catch(()=>{});throw e;}finally{client.release();}
}

function spawn2048Tile(board:number[]){
  const empty: number[]=[];
  for(let i=0;i<board.length;i++)if(board[i]===0)empty.push(i);
  if(!empty.length)return board;
  const next=[...board];
  const index=empty[Math.floor(Math.random()*empty.length)];
  next[index]=Math.random()<0.9?2:4;
  return next;
}
function make2048State(){
  let board=Array(16).fill(0) as number[];
  board=spawn2048Tile(board);
  board=spawn2048Tile(board);
  return {board,score:0,moves:0,bestTile:2,maxTurns:1000};
}
function move2048Line(line:number[]){
  const compact=line.filter(Boolean);
  const result:number[]=[];
  let gained=0;
  for(let i=0;i<compact.length;i++){
    if(i+1<compact.length&&compact[i]===compact[i+1]){
      const merged=compact[i]*2;
      result.push(merged);
      gained+=merged;
      i++;
    }else result.push(compact[i]);
  }
  while(result.length<4)result.push(0);
  return {line:result,gained};
}
function move2048(board:number[],direction:string){
  const next=Array(16).fill(0) as number[];
  let gained=0;
  for(let r=0;r<4;r++){
    let line:number[]=[];
    if(direction==="left"||direction==="right"){
      line=[board[r*4],board[r*4+1],board[r*4+2],board[r*4+3]];
      if(direction==="right")line.reverse();
      const m=move2048Line(line);
      line=m.line;if(direction==="right")line.reverse();
      for(let c=0;c<4;c++)next[r*4+c]=line[c];
      gained+=m.gained;
    }
  }
  if(direction==="up"||direction==="down"){
    for(let c=0;c<4;c++){
      line=[board[c],board[4+c],board[8+c],board[12+c]];
      if(direction==="down")line.reverse();
      const m=move2048Line(line);
      line=m.line;if(direction==="down")line.reverse();
      for(let r=0;r<4;r++)next[r*4+c]=line[r];
      gained+=m.gained;
    }
  }
  const changed=next.some((v,i)=>v!==board[i]);
  return {board:changed?spawn2048Tile(next):board,score:gained,changed};
}
function has2048Win(board:number[]){return board.some(v=>v>=2048);}
function can2048Move(board:number[]){
  if(board.some(v=>v===0))return true;
  for(let r=0;r<4;r++)for(let c=0;c<4;c++){
    const v=board[r*4+c];
    if(c<3&&board[r*4+c+1]===v)return true;
    if(r<3&&board[(r+1)*4+c]===v)return true;
  }
  return false;
}
function initialState(code:string,players:number[]){
  switch(code){
    case "quiz":
    case "quiz_duel":
    case "trivia":
      return {q:"کدام سیاره به خورشید نزدیک‌تر است؟",options:["عطارد","زمین","مریخ","زهره"],answer:0,answers:{},round:1,maxTurns:5};
    case "guess_number": return {target:1+Math.floor(Math.random()*20),attempts:0,maxAttempts:6};
    case "rps_ai":
    case "rps": return {choices:{},maxTurns:1};
    case "true_false": return {statement:"خورشید یک ستاره است.",answer:true,answered:false};
    case "word_guess": return {word:"باران",mask:"ب _ ر ا _",tries:0,maxTries:6};
    case "hidden_word": return {word:"پرشین",mask:"_ _ _ _ _ _",tries:0,maxTries:6};
    case "word_chain": return {last:"بازی",turn:players[0],moves:0,maxTurns:8};
    case "word_duel": return {word:"کامپیوتر",guesses:{},round:1};
    case "math_battle": return {a:7,b:8,op:"×",answer:56,answers:{},round:1};
    case "typing_speed": return {text:"Persian Bot Game",answers:{}};
    case "reaction": return {signal:3+Math.floor(Math.random()*5),answers:{}};
    case "emoji_guess": return {emoji:"🌊🚢",answer:"دریا",answers:{}};
    case "memory_duel": return {pairs:[0,0,1,1,2,2,3,3].sort(()=>Math.random()-.5),found:{},answers:{},turn:players[0]};
    case "bingo": return {numbers:[1,2,3,4,5,6,7,8,9].sort(()=>Math.random()-.5),marked:{},turn:players[0],moves:0,maxTurns:18};
    case "draw_guess": return {word:"کشتی",guesser:players[1],drawer:players[0],turn:players[0],done:false};
    case "territory": return {board:Array(25).fill(0),turn:players[0],moves:0,maxTurns:20};
    case "mini_golf": return {holes:3,scores:{},turn:players[0],hole:1};
    case "survival": return {hp:{[players[0]]:3,[players[1]]:3},turns:0,maxTurns:9};
    case "treasure_hunt": return {treasure:Math.floor(Math.random()*16),found:{},turn:players[0],moves:0,maxTurns:12};
    case "duel_dice": return {rolls:{}};
    default:return {moves:0,maxTurns:20,score:{},turn:players[0]};
  }
}

export async function renderEngineSession(pool:Pool,ctx:GameContext,sessionId:number){
  await ensureEngineSchema(pool);
  const x=await ensureParticipant(pool,ctx,sessionId);
  if(!x)return null;
  const {s}=x;const game=getEngineGame(String(s.game_code))!;
  const players=(await pool.query<any>("SELECT sp.user_id,sp.slot,sp.score,COALESCE(p.first_name,p.username,p.user_id::text) name FROM game_session_players sp LEFT JOIN game_players p ON p.group_id=sp.group_id AND p.user_id=sp.user_id WHERE sp.session_id=$1 AND sp.left_at IS NULL ORDER BY sp.slot",[sessionId])).rows;
  const state=s.state??{};
  const finished=s.status==="finished";
  return {session:s,game,players,state,finished};
}

function botMarkup(sessionId:number,code:string,userId:number,state:any,players:any[]){
  const s=String(sessionId),u=String(userId);
  if(["quiz","quiz_duel","trivia"].includes(code)){
    return {inline_keyboard:[["۰","۱","۲","۳"].map((v,i)=>({text:"‹ "+v,callback_data:"game:engine:move:"+s+":"+i+":"+u})),
      [{text:"‹ وضعیت بازی",callback_data:"game:engine:view:"+s+":"+u},{text:"‹ مرکز بازی",callback_data:"game:center"}]]};
  }
  if(code==="duel_dice")return {inline_keyboard:[[{text:"‹ انداختن تاس",callback_data:"game:engine:move:"+s+":roll:"+u}],[{text:"‹ وضعیت",callback_data:"game:engine:view:"+s+":"+u}]]};
  if(["rps_ai","rps"].includes(code))return {inline_keyboard:[
    [{text:"‹ سنگ",callback_data:"game:engine:move:"+s+":rock:"+u},{text:"‹ کاغذ",callback_data:"game:engine:move:"+s+":paper:"+u},{text:"‹ قیچی",callback_data:"game:engine:move:"+s+":scissors:"+u}],
    [{text:"‹ وضعیت",callback_data:"game:engine:view:"+s+":"+u}]
  ]};
  if(["true_false"].includes(code))return {inline_keyboard:[[ {text:"‹ درست",callback_data:"game:engine:move:"+s+":true:"+u},{text:"‹ غلط",callback_data:"game:engine:move:"+s+":false:"+u} ]]};
  if(code==="guess_number")return {inline_keyboard:[[ {text:"‹ ۱-۵",callback_data:"game:engine:move:"+s+":low:"+u},{text:"‹ ۶-۱۰",callback_data:"game:engine:move:"+s+":mid:"+u},{text:"‹ ۱۱-۲۰",callback_data:"game:engine:move:"+s+":high:"+u} ]]};
  if(["word_guess","hidden_word","word_duel","word_chain","typing_speed","math_battle","reaction","emoji_guess"].includes(code))return {inline_keyboard:[[ {text:"‹ ثبت پاسخ",callback_data:"game:engine:move:"+s+":submit:"+u},{text:"‹ وضعیت",callback_data:"game:engine:view:"+s+":"+u} ]]};
  return {inline_keyboard:[[ {text:"‹ پایان بازی",callback_data:"game:engine:finish:"+s+":"+u},{text:"‹ وضعیت",callback_data:"game:engine:view:"+s+":"+u} ]]};
}

function miniMarkup(sessionId:number,code:string,userId:number,privateChat=false){
  const rawBase=process.env.GAME_WEBAPP_URL||""; const base=rawBase.endsWith("/")?rawBase.slice(0,-1):rawBase;
  const gameName=getEngineGame(code)?.name||"بازی";
  if(!base)return {inline_keyboard:[
    [{text:"‹ وضعیت بازی",callback_data:"game:engine:view:"+sessionId+":"+userId}],
    [{text:"‹ مرکز بازی",callback_data:"game:center"}]
  ]};
  const url=miniAppLaunchUrl(sessionId,code,userId);
  // Telegram WebApp buttons are supported in private chats only.
  // From a group we use a callback that sends a real WebApp button to the user's private chat.
  if(!privateChat){
    return {inline_keyboard:[
      [{text:"‹ اجرای "+gameName+" در PV",callback_data:"game:engine:launch:"+sessionId+":"+code+":"+userId}],
      [{text:"‹ وضعیت بازی",callback_data:"game:engine:view:"+sessionId+":"+userId}],
      [{text:"‹ مرکز بازی",callback_data:"game:center"}]
    ]};
  }
  return {inline_keyboard:[
    [{text:"‹ اجرای "+gameName,web_app:{url}}],
    [{text:"‹ وضعیت بازی",callback_data:"game:engine:view:"+sessionId+":"+userId}],
    [{text:"‹ مرکز بازی",callback_data:"game:center"}]
  ]};
}

function names(players:any[]){return players.map(p=>p.name||String(p.user_id)).join(" و ");}

export async function engineView(pool:Pool,ctx:GameContext,sessionId:number){
  const v=await renderEngineSession(pool,ctx,sessionId); if(!v)return {text:"✗ نشست بازی پیدا نشد.",replyMarkup:{inline_keyboard:[]}};
  const s=v.session,g=v.game;
  if(v.finished){
    const results=(await pool.query<any>("SELECT user_id,result,score,xp_earned,gems_earned,rating_delta,metadata FROM game_results WHERE session_id=$1 ORDER BY position NULLS LAST,user_id",[sessionId])).rows;
    const mine=results.find((r:any)=>Number(r.user_id)===ctx.userId);
    return {text:["◈ نتیجه "+g.name,"","⛂ - وضعیت : پایان‌یافته",...results.map((r:any,i:number)=>"⛂ - بازیکن "+(i+1)+" : "+r.result+" · امتیاز "+fa(+r.score)), "", "⛂ - نتیجه شما : "+(mine?.result==="win"?"برد":mine?.result==="loss"?"باخت":"مساوی"),"⛂ - جم : +"+fa(+(mine?.gems_earned||0)),"⛂ - تجربه : +"+fa(+(mine?.xp_earned||0)),"⛂ - رنک : "+((+mine?.rating_delta||0)>=0?"+":"")+fa(+mine?.rating_delta||0),"⛂ - کاپ : "+((+mine?.metadata?.cups_delta||0)>=0?"+":"")+fa(+mine?.metadata?.cups_delta||0)].join("\n"),replyMarkup:{inline_keyboard:[
      [{text:"‹ بازی دوباره",callback_data:"game:play:"+ctx.userId},{text:"‹ پروفایل",callback_data:"game:profile:"+ctx.userId}],
      [{text:"‹ مرکز بازی",callback_data:"game:center"}]
    ]}};
  }
  const st=v.state;
  let detail="";
  if(st.q)detail="\n⛂ - سؤال : "+st.q+"\n"+st.options.map((x:string,i:number)=>String.fromCharCode(65+i)+" · "+x).join("\n");
  if(st.target)detail="\n⛂ - محدوده : ۱ تا ۲۰\n⛂ - تلاش : "+fa(st.attempts||0)+" / "+fa(st.maxAttempts||6);
  if(st.statement)detail="\n⛂ - گزاره : "+st.statement;
  if(st.word)detail="\n⛂ - کلمه : "+(st.mask||"_ _ _ _") ;
  if(st.last)detail="\n⛂ - کلمه آخر : "+st.last+"\n⛂ - نوبت : "+(st.turn===ctx.userId?"شما":"حریف");
  if(st.a&&st.b)detail="\n⛂ - مسئله : "+fa(st.a)+" "+st.op+" "+fa(st.b);
  if(st.text)detail="\n⛂ - متن آزمون : "+st.text;
  if(st.emoji)detail="\n⛂ - سرنخ : "+st.emoji;
  return {text:["◈ "+g.name,"","⛂ - حالت : "+(s.mode==="multi"?"چندنفره آنلاین":"تک‌نفره"),"⛂ - وضعیت : "+(s.current_turn_user_id===ctx.userId?"نوبت شما":"در حال انتظار"),"⛂ - بازیکنان : "+names(v.players),detail,"","⛂ - سیستم نتیجه : برد / باخت / مساوی","⛂ - پاداش : جم · تجربه · رنک · کاپ · امتیاز"].join("\n"),replyMarkup:g.mode==="mini_app"?miniMarkup(sessionId,g.code,ctx.userId,ctx.chatId>0?false:true):botMarkup(sessionId,g.code,ctx.userId,st,v.players)};
}

async function settleEngine(pool:Pool,sessionId:number,outcomes:Array<{userId:number,result:"win"|"loss"|"draw",score:number,metadata?:any}>,reason="normal"){
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const s=(await client.query<any>("SELECT * FROM game_sessions WHERE id=$1 FOR UPDATE",[sessionId])).rows[0];
    if(!s){await client.query("ROLLBACK");throw new Error("session_missing");}
    if(s.status==="finished"){
      await client.query("ROLLBACK");
      return;
    }
    const mode=s.mode==="multi"?"multi":"solo";
    const rset=(s.metadata?.reward_mode===mode?null:null);
    for(const o of outcomes){
      const rr=reward(mode,o.result);
      const info=JSON.stringify({...o.metadata,cups_delta:rr.c});
      const exists=(await client.query("SELECT 1 FROM game_results WHERE session_id=$1 AND user_id=$2",[sessionId,o.userId])).rowCount>0;
      if(exists)continue;
      const p=(await client.query<any>("SELECT gems,xp,rating,cups,total_games,wins,losses,current_streak,best_streak,COALESCE(display_name,first_name,username,user_id::text) AS display_name,username FROM game_players WHERE group_id=$1 AND user_id=$2 FOR UPDATE",[s.group_id,o.userId])).rows[0];
      if(!p)continue;
      const newGems=Math.max(0,Number(p.gems)+rr.g);
      const newXp=Math.max(0,Number(p.xp)+rr.xp);
      const newRating=Math.max(0,Number(p.rating)+rr.r);
      const newCups=Math.max(0,Number(p.cups||0)+rr.c);
      await client.query("UPDATE game_players SET gems=$3,xp=$4,rating=$5,cups=$6,total_games=total_games+1,wins=wins+$7,losses=losses+$8,current_streak=CASE WHEN $9 THEN current_streak+1 ELSE 0 END,best_streak=GREATEST(best_streak,CASE WHEN $9 THEN current_streak+1 ELSE current_streak END),high_score=GREATEST(high_score,$10),updated_at=NOW(),last_active_at=NOW() WHERE group_id=$1 AND user_id=$2",[s.group_id,o.userId,newGems,newXp,newRating,newCups,o.result==="win"?1:0,o.result==="loss"?1:0,o.result==="win",o.score]);
      await client.query("INSERT INTO game_wallet_ledger(group_id,user_id,transaction_type,delta,balance_before,balance_after,reason,game_code,reference_id,metadata) VALUES($1,$2,'credit',$3,$4,$5,'Game reward',$6,$7,$8::jsonb)",[s.group_id,o.userId,rr.g,Number(p.gems),newGems,s.game_code,"session:"+sessionId,info]);
      await client.query("INSERT INTO game_wallets(group_id,user_id,balance,lifetime_earned,updated_at) VALUES($1,$2,$3,$4,NOW()) ON CONFLICT(group_id,user_id) DO UPDATE SET balance=EXCLUDED.balance,lifetime_earned=game_wallets.lifetime_earned+$4,updated_at=NOW()",[s.group_id,o.userId,newGems,Math.max(0,rr.g)]);
      await client.query("UPDATE game_player_stats SET total_games=total_games+1,wins=wins+$3,losses=losses+$4,total_score=total_score+$5,high_score=GREATEST(high_score,$5),cups=cups+$6,current_streak=CASE WHEN $7 THEN current_streak+1 ELSE 0 END,best_streak=GREATEST(best_streak,CASE WHEN $7 THEN current_streak+1 ELSE current_streak END),total_xp_earned=total_xp_earned+$8,total_gems_earned=total_gems_earned+$9,updated_at=NOW() WHERE group_id=$1 AND user_id=$2",[s.group_id,o.userId,o.result==="win"?1:0,o.result==="loss"?1:0,o.score,rr.c,o.result==="win",rr.xp,Math.max(0,rr.g)]);
      await client.query("UPDATE game_player_rating SET rating=$3,league_points=GREATEST(0,$3),updated_at=NOW() WHERE group_id=$1 AND user_id=$2",[s.group_id,o.userId,newRating]);
      await client.query("UPDATE game_player_streaks SET current_streak=$3,best_streak=GREATEST(best_streak,$3),updated_at=NOW() WHERE group_id=$1 AND user_id=$2",[s.group_id,o.userId,o.result==="win"?Number(p.current_streak)+1:0]);
      await client.query("INSERT INTO game_results(session_id,group_id,user_id,result,score,xp_earned,gems_earned,rating_delta,position,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)",[sessionId,s.group_id,o.userId,o.result,o.score,rr.xp,Math.max(0,rr.g),rr.r,o.result==="win"?1:o.result==="draw"?2:3,info]);
      await client.query("INSERT INTO game_match_history(group_id,user_id,game_code,result,xp_earned,gems_earned,rating_delta,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",[s.group_id,o.userId,s.game_code,o.result,rr.xp,Math.max(0,rr.g),rr.r,info]);
      await client.query("UPDATE game_session_players SET score=$3,cups_delta=$4 WHERE session_id=$1 AND user_id=$2",[sessionId,o.userId,o.score,rr.c]);
    }
    const winners=outcomes.filter(x=>x.result==="win");
    await client.query("UPDATE game_sessions SET status='finished',winner_id=$2,ended_at=NOW(),ended_reason=$3,result=$4::jsonb WHERE id=$1",[sessionId,winners[0]?.userId||null,reason,JSON.stringify({outcomes})]);
    await client.query("UPDATE game_multiplayer_rooms SET status='finished',finished_at=NOW(),metadata=metadata||$1::jsonb WHERE metadata->>'session_id'=$2",[JSON.stringify({engine_status:"finished"}),String(sessionId)]);
    await client.query("COMMIT");
    try{
      const gameName=getEngineGame(String(s.game_code))?.name||String(s.game_code);
      const resultFa=(result:"win"|"loss"|"draw")=>result==="win"?"برد":result==="loss"?"باخت":"مساوی";
      const escapeHtml=(v:any)=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
      const lines:string[]=[
        "<b>◈ نتیجه بازی "+escapeHtml(gameName)+"</b>",
        ""
      ];
      for(const o of outcomes){
        const rr=reward(mode,o.result);
        const p=(await pool.query<any>("SELECT COALESCE(display_name,first_name,username,user_id::text) AS display_name FROM game_players WHERE group_id=$1 AND user_id=$2",[s.group_id,o.userId])).rows[0];
        const name=escapeHtml(p?.display_name||String(o.userId));
        lines.push('<a href="tg://user?id='+o.userId+'">'+name+"</a>");
        lines.push("⛂ - نتیجه : "+resultFa(o.result));
        lines.push("⛂ - امتیاز : "+fa(Number(o.score||0)));
        lines.push("⛂ - جم : +"+fa(Number(rr.g)));
        lines.push("⛂ - تجربه : +"+fa(Number(rr.xp)));
        lines.push("⛂ - رنک : "+(rr.r>=0?"+":"")+fa(Number(rr.r)));
        lines.push("⛂ - کاپ : "+(rr.c>=0?"+":"")+fa(Number(rr.c)));
        lines.push("");
      }
      const sent=await telegramApi("sendMessage",{
        chat_id:Number(s.group_id),
        text:lines.join("\n").trim(),
        parse_mode:"HTML"
      });
      if(!sent.ok)console.error("[game-reward] group announcement failed:",sent.description);
    }catch(error){
      console.error("[game-reward] group announcement exception:",(error as any)?.message??error);
    }
  }catch(e){await client.query("ROLLBACK").catch(()=>{});throw e;}finally{client.release();}
}

export async function resolveAction(pool:Pool,ctx:GameContext,sessionId:number,action:string,payload:string){
  const x=await ensureParticipant(pool,ctx,sessionId);if(!x)throw new Error("not_participant");
  const {s}=x;if(s.status==="finished")return;
  const game=getEngineGame(String(s.game_code));if(!game)throw new Error("unknown_game");
  const state={...(s.state||{})};
  await pool.query("INSERT INTO game_engine_events(session_id,group_id,user_id,turn_no,action,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)",[sessionId,s.group_id,ctx.userId,s.turn_no,action,JSON.stringify({value:payload})]);

  const players=(await pool.query<any>("SELECT user_id FROM game_session_players WHERE session_id=$1 AND left_at IS NULL ORDER BY slot",[sessionId])).rows.map((r:any)=>Number(r.user_id));
  if(game.turns&&s.current_turn_user_id&&Number(s.current_turn_user_id)!==ctx.userId)throw new Error("not_your_turn");

  if(action==="finish"){
    if(game.code==="2048"){
      const score=Math.max(0,Number(state.score||0));
      if(s.mode==="solo")return settleEngine(pool,sessionId,[{userId:ctx.userId,result:"loss",score}],"2048_forfeit");
      const other=players.find(x=>x!==ctx.userId)!;
      return settleEngine(pool,sessionId,[{userId:ctx.userId,result:"loss",score},{userId:other,result:"win",score:score}],"2048_forfeit");
    }
    const score=Math.max(0,Math.min(1000,Number(payload)||100));
    if(s.mode==="solo")return settleEngine(pool,sessionId,[{userId:ctx.userId,result:score>=500?"win":"loss",score}], "mini_app_finish");
    const mine=score>=500?"win":"loss";const other=players.find(x=>x!==ctx.userId)!;
    return settleEngine(pool,sessionId,[{userId:ctx.userId,result:mine,score},{userId:other,result:mine==="win"?"loss":"win",score:1000-score}],"mini_app_finish");
  }

  if(game.code==="2048"){
    const direction=String(payload||"").toLowerCase();
    if(!["up","down","left","right"].includes(direction))throw new Error("invalid_2048_move");
    const currentBoard=Array.isArray(state.board)?state.board.map(Number):make2048State().board;
    const moved=move2048(currentBoard,direction);
    if(!moved.changed){
      if(has2048Win(currentBoard))return settleEngine(pool,sessionId,[{userId:ctx.userId,result:"win",score:Number(state.score||0)}],"2048_win");
      if(!can2048Move(currentBoard))return settleEngine(pool,sessionId,[{userId:ctx.userId,result:"loss",score:Number(state.score||0)}],"2048_game_over");
      return;
    }
    state.board=moved.board;
    state.score=Number(state.score||0)+moved.score;
    state.moves=Number(state.moves||0)+1;
    state.bestTile=Math.max(...state.board);
    if(has2048Win(state.board))return settleEngine(pool,sessionId,[{userId:ctx.userId,result:"win",score:Number(state.score)}],"2048_win");
    if(!can2048Move(state.board))return settleEngine(pool,sessionId,[{userId:ctx.userId,result:"loss",score:Number(state.score)}],"2048_game_over");
    await pool.query("UPDATE game_sessions SET state=$2::jsonb,turn_no=turn_no+1 WHERE id=$1",[sessionId,JSON.stringify(state)]);
    return;
  }

  if(game.code==="duel_dice"){
    if(!Array.isArray(state.rolls))state.rolls={};
    if(state.rolls[ctx.userId])throw new Error("already_rolled");
    state.rolls={...(state.rolls||{}),[ctx.userId]:1+Math.floor(Math.random()*6)};
    const ids=Object.keys(state.rolls).map(Number);
    if(ids.length>=2){
      const a=ids[0],b=ids[1],ra=Number(state.rolls[a]),rb=Number(state.rolls[b]);
      if(ra===rb)return settleEngine(pool,sessionId,[{userId:a,result:"draw",score:160},{userId:b,result:"draw",score:160}],"duel_dice_draw");
      const aWin=ra>rb;
      return settleEngine(pool,sessionId,[{userId:a,result:aWin?"win":"loss",score:aWin?300:90},{userId:b,result:aWin?"loss":"win",score:aWin?90:300}],"duel_dice");
    }
    await pool.query("UPDATE game_sessions SET state=$2::jsonb,turn_no=turn_no+1 WHERE id=$1",[sessionId,JSON.stringify(state)]);
    return;
  }

  if(["rps_ai","rps"].includes(game.code)){
    state.choices={...(state.choices||{}),[ctx.userId]:payload};
    const ids=Object.keys(state.choices).map(Number);
    if(game.code==="rps_ai"&&ids.length>=1){
      const ai=["rock","paper","scissors"][Math.floor(Math.random()*3)];
      const me=state.choices[ctx.userId],outcome=me===ai?"draw":((me==="rock"&&ai==="scissors")||(me==="paper"&&ai==="rock")||(me==="scissors"&&ai==="paper"))?"win":"loss";
      return settleEngine(pool,sessionId,[{userId:ctx.userId,result:outcome,score:outcome==="win"?120:outcome==="draw"?70:40}], "rps_ai");
    }
    if(ids.length>=2){
      const [a,b]=ids;const ca=state.choices[a],cb=state.choices[b];let ra:"win"|"loss"|"draw";if(ca===cb)ra="draw";else ra=((ca==="rock"&&cb==="scissors")||(ca==="paper"&&cb==="rock")||(ca==="scissors"&&cb==="paper"))?"win":"loss";
      const rb=ra==="win"?"loss":ra==="loss"?"win":"draw";
      return settleEngine(pool,sessionId,[{userId:a,result:ra,score:ra==="win"?300:ra==="draw"?160:90},{userId:b,result:rb,score:rb==="win"?300:rb==="draw"?160:90}],"rps");
    }
  }

  if(["quiz","quiz_duel","trivia"].includes(game.code)){
    const answer=Number(payload);state.answers={...(state.answers||{}),[ctx.userId]:answer};
    if(game.code==="quiz"&&Number.isFinite(answer)){const win=answer===Number(state.answer);return settleEngine(pool,sessionId,[{userId:ctx.userId,result:win?"win":"loss",score:win?150:40}], "quiz");}
    const ids=Object.keys(state.answers).map(Number);if(ids.length>=2||game.code!=="quiz"){
      if(ids.length>=2){const a=ids[0],b=ids[1],aa=Number(state.answers[a]),bb=Number(state.answers[b]),aw=aa===Number(state.answer),bw=bb===Number(state.answer);
        if(aw&&bw)return settleEngine(pool,sessionId,[{userId:a,result:"draw",score:180},{userId:b,result:"draw",score:180}],"quiz_draw");
        if(aw)return settleEngine(pool,sessionId,[{userId:a,result:"win",score:300},{userId:b,result:"loss",score:80}],"quiz_duel");
        if(bw)return settleEngine(pool,sessionId,[{userId:a,result:"loss",score:80},{userId:b,result:"win",score:300}],"quiz_duel");
        return settleEngine(pool,sessionId,[{userId:a,result:"draw",score:80},{userId:b,result:"draw",score:80}],"quiz_wrong");
      }
    }
  }

  if(game.code==="true_false"){
    const v=payload==="true";const win=v===Boolean(state.answer);return settleEngine(pool,sessionId,[{userId:ctx.userId,result:win?"win":"loss",score:win?120:40}],"true_false");
  }

  if(game.code==="guess_number"){
    state.attempts=Number(state.attempts||0)+1;
    const range=payload==="low"?[1,5]:payload==="mid"?[6,10]:[11,20];
    const hit=Number(state.target)>=range[0]&&Number(state.target)<=range[1];
    if(hit||state.attempts>=state.maxAttempts)return settleEngine(pool,sessionId,[{userId:ctx.userId,result:hit?"win":"loss",score:hit?180:50}],"guess_number");
    await pool.query("UPDATE game_sessions SET state=$2::jsonb,turn_no=turn_no+1 WHERE id=$1",[sessionId,JSON.stringify(state)]);return;
  }

  if(game.code==="word_chain"){
    if(!payload||payload.trim().length<2)throw new Error("invalid_word");
    state.last=payload.trim().slice(-12);state.moves=Number(state.moves||0)+1;state.turn=(state.turn===ctx.userId?ctx.userId:ctx.userId);
    if(state.moves>=state.maxTurns)return settleEngine(pool,sessionId,[{userId:ctx.userId,result:"win",score:220}],"word_chain_complete");
    await pool.query("UPDATE game_sessions SET state=$2::jsonb,turn_no=turn_no+1 WHERE id=$1",[sessionId,JSON.stringify(state)]);return;
  }

  const scoredAnswer=["word_guess","hidden_word","word_duel","math_battle","typing_speed","reaction","emoji_guess"].includes(game.code);
  if(scoredAnswer){
    const good=(game.code==="math_battle"&&payload==="56")||(game.code==="emoji_guess"&&payload==="دریا")||(game.code==="word_guess"&&payload.includes("باران"))||(game.code==="hidden_word"&&payload.includes("پرشین"))||(game.code==="word_duel"&&payload.includes("کامپیوتر"))||(game.code==="typing_speed"&&payload.toLowerCase()==="persian bot game")||(game.code==="reaction"&&Number(payload)<=Number(state.signal));
    if(s.mode==="solo")return settleEngine(pool,sessionId,[{userId:ctx.userId,result:good?"win":"loss",score:good?180:50}],game.code);
    state.answers={...(state.answers||{}),[ctx.userId]:{good,at:Date.now()}};const ids=Object.keys(state.answers).map(Number);if(ids.length>=2){const goodIds=ids.filter(id=>state.answers[id]?.good);if(goodIds.length===1){const w=goodIds[0],l=ids.find(id=>id!==w)!;return settleEngine(pool,sessionId,[{userId:w,result:"win",score:300},{userId:l,result:"loss",score:90}],game.code);}if(goodIds.length===0)return settleEngine(pool,sessionId,ids.map(id=>({userId:id,result:"draw" as const,score:90})),game.code);return settleEngine(pool,sessionId,ids.map(id=>({userId:id,result:"draw" as const,score:150})),game.code);}
  }

  state.moves=Number(state.moves||0)+1;
  const next=game.maxPlayers>1?players.find(x=>x!==ctx.userId)||ctx.userId:ctx.userId;
  await pool.query("UPDATE game_sessions SET state=$2::jsonb,turn_no=turn_no+1,current_turn_user_id=$3 WHERE id=$1",[sessionId,JSON.stringify(state),game.turns?next:null]);
  if(game.maxPlayers>1&&state.moves>=Number(state.maxTurns||20))return settleEngine(pool,sessionId,players.map(id=>({userId:id,result:"draw" as const,score:Math.round(180/players.length)})), "round_limit");
}

export async function startEngine(ctx:GameContext,code:string,mode:EngineMode,playerIds:number[]=[ctx.userId]){
  const id=await createEngineSession(ctx.pool,ctx,code,mode,playerIds);
  const view:any=await engineView(ctx.pool,ctx,id);
  view.sessionId=id;
  if(getEngineGame(code)?.mode==="mini_app")view.miniApp={
    sessionId:id,
    gameCode:code,
    url:(()=>{const raw=process.env.GAME_WEBAPP_URL||"";const base=raw.endsWith("/")?raw.slice(0,-1):raw;return miniAppLaunchUrl(id,code,ctx.userId);})()
  };
  return view;
}

async function launchMiniAppForSession(ctx:GameContext,sessionId:number){
  const v=await renderEngineSession(ctx.pool,ctx,sessionId);
  if(!v||v.game.mode!=="mini_app")return await engineView(ctx.pool,ctx,sessionId);
  const raw=process.env.GAME_WEBAPP_URL||"";
  const base=raw.endsWith("/")?raw.slice(0,-1):raw;
  const url=miniAppLaunchUrl(sessionId,String(v.session.game_code),ctx.userId);
  const view:any=await engineView(ctx.pool,ctx,sessionId);
  view.sessionId=sessionId;
  view.miniApp={sessionId,gameCode:String(v.session.game_code),url};
  return view;
}

export async function handleEngineCallback(ctx:GameContext,parts:string[]){
  const sub=parts[2]??"";
  const sessionId=Number(parts[3]??0);
  const owner=Number(parts[parts.length-1]??0);
  if(owner&&owner!==ctx.userId)return {text:"⛂ - این بازی متعلق به بازیکن دیگری است.",replyMarkup:{inline_keyboard:[]}};
  if(sub==="start"){
    const code=parts[4]??"";
    return await startEngine(ctx,code,"solo",[ctx.userId]);
  }
  if(sub==="launch"){
    return await launchMiniAppForSession(ctx,sessionId);
  }
  if(sub==="move"){
    const payload=parts[4]??"";
    await resolveAction(ctx.pool,ctx,sessionId,"move",payload);
    return await engineView(ctx.pool,ctx,sessionId);
  }
  if(sub==="finish"){
    await resolveAction(ctx.pool,ctx,sessionId,"finish",parts[4]??"700");
    return await engineView(ctx.pool,ctx,sessionId);
  }
  if(sub==="view")return await engineView(ctx.pool,ctx,sessionId);
  return null;
}

export function createMiniAppLaunchToken(sessionId:number,userId:number,botToken=String(process.env.BOT_TOKEN||"")){
  return createHmac("sha256",botToken).update("miniapp:"+sessionId+":"+userId).digest("hex");
}
export function miniAppLaunchUrl(sessionId:number,code:string,userId:number){
  const raw=process.env.GAME_WEBAPP_URL||"";const base=raw.endsWith("/")?raw.slice(0,-1):raw;
  if(!base)return "";
  return base+"/game/"+sessionId+"?code="+encodeURIComponent(code)+"&launch="+createMiniAppLaunchToken(sessionId,userId);
}

export function verifyTelegramInitData(initData:string,botToken:string,maxAgeSec=86400){
  const qs=new URLSearchParams(initData);const hash=qs.get("hash");if(!hash)return null;
  const authDate=Number(qs.get("auth_date")||0);if(!authDate||Math.abs(Date.now()/1000-authDate)>maxAgeSec)return null;
  qs.delete("hash");const check=[...qs.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+"="+v).join("\n");
  const secret=createHmac("sha256","WebAppData").update(botToken).digest();
  const expected=createHmac("sha256",secret).update(check).digest("hex");
  const a=Buffer.from(expected,"hex"),b=Buffer.from(hash,"hex");if(a.length!==b.length||!timingSafeEqual(a,b))return null;
  let user:any=null;try{user=JSON.parse(qs.get("user")||"null");}catch{}
  if(!user?.id)return null;return user;
}

function fa(x:number){return String(x).split("").map(d=>"۰۱۲۳۴۵۶۷۸۹"[Number(d)]||d).join("")}

export async function miniAppAction(pool:Pool,sessionId:number,initData:string,botToken:string,action:string,payload:string){
  const user=verifyTelegramInitData(initData,botToken);if(!user)throw new Error("invalid_telegram_init_data");
  const row=(await pool.query<any>("SELECT group_id FROM game_sessions WHERE id=$1 AND status='active'",[sessionId])).rows[0];if(!row)throw new Error("session_finished");
  const ctx:GameContext={pool,chatId:Number(row.group_id),userId:Number(user.id),user:{id:Number(user.id),username:user.username,firstName:user.first_name},isAdmin:false};
  return await (action==="finish"?resolveAction(pool,ctx,sessionId,"finish",payload):resolveAction(pool,ctx,sessionId,"move",payload)).then(async()=>engineView(pool,ctx,sessionId));
}


export async function startEngineFromRoom(pool:Pool,ctx:GameContext,roomId:number,groupId:number,gameCode:string,playerIds:number[]){
  const sessionId=await createEngineSession(pool,ctx,gameCode,"multi",playerIds);
  await pool.query("UPDATE game_multiplayer_rooms SET status='active',started_at=NOW(),metadata=metadata||$1::jsonb,match_id=NULL WHERE id=$2 AND group_id=$3",[JSON.stringify({engine:"game_engine_v1",session_id:sessionId}),roomId,groupId]);
  return await engineView(pool,{...ctx,userId:ctx.userId},sessionId);
}

export async function engineSessionIdFromRoom(pool:Pool,roomId:number,groupId:number){
  const row=(await pool.query<any>("SELECT metadata->>'session_id' session_id FROM game_multiplayer_rooms WHERE id=$1 AND group_id=$2",[roomId,groupId])).rows[0];
  return Number(row?.session_id||0)||null;
}
