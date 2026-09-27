export type GameEngine="bot"|"miniapp"|"hybrid";
export type GameMode="single"|"multi";
export type GameDefinition={
  code:string; name:string; engine:GameEngine; players:1|2; turnBased:boolean; scoreCap:number;
  single?:{winGems:number;lossGems:number;winXp:number;lossXp:number;winRating:number;lossRating:number;winCups:number;lossCups:number};
  multi?:{winGems:number;lossGems:number;drawGems:number;winXp:number;lossXp:number;drawXp:number;winRating:number;lossRating:number;drawRating:number;winCups:number;lossCups:number;drawCups:number};
};

const s=(code:string,name:string):GameDefinition=>({code,name,engine:"bot",players:1,turnBased:false,scoreCap:1000,single:{winGems:40,lossGems:5,winXp:60,lossXp:20,winRating:10,lossRating:-5,winCups:3,lossCups:0}});
const m=(code:string,name:string,engine:GameEngine="miniapp",turnBased=true):GameDefinition=>({code,name,engine,players:2,turnBased,scoreCap:5000,multi:{winGems:140,lossGems:35,drawGems:50,winXp:180,lossXp:80,drawXp:110,winRating:35,lossRating:-15,drawRating:0,winCups:7,lossCups:1,drawCups:3}});
const h=(code:string,name:string):GameDefinition=>({code,name,engine:"hybrid",players:2,turnBased:false,scoreCap:5000,multi:{winGems:130,lossGems:30,drawGems:45,winXp:160,lossXp:70,drawXp:100,winRating:30,lossRating:-12,drawRating:0,winCups:6,lossCups:1,drawCups:2}});

export const SINGLE_GAMES:GameDefinition[]=[
  { ...s("quiz","کوییز"), single:{winGems:45,lossGems:3,winXp:65,lossXp:20,winRating:10,lossRating:-5,winCups:3,lossCups:0}},
  s("guess_number","حدس عدد"),
  s("rps_ai","سنگ، کاغذ، قیچی با هوش مصنوعی"),
  s("true_false","درست یا غلط"),
  s("word_guess","حدس کلمه"),
  s("hidden_word","کلمه پنهان"),
  s("word_chain","زنجیره کلمات"),
  {code:"sudoku",name:"سودوکو",engine:"miniapp",players:1,turnBased:false,scoreCap:5000,single:{winGems:95,lossGems:8,winXp:140,lossXp:25,winRating:16,lossRating:-4,winCups:5,lossCups:0}},
  {code:"minesweeper",name:"مین‌روب",engine:"miniapp",players:1,turnBased:false,scoreCap:5000,single:{winGems:85,lossGems:7,winXp:125,lossXp:25,winRating:14,lossRating:-4,winCups:4,lossCups:0}},
  {code:"2048",name:"۲۰۴۸",engine:"miniapp",players:1,turnBased:false,scoreCap:10000,single:{winGems:90,lossGems:5,winXp:130,lossXp:20,winRating:15,lossRating:-3,winCups:4,lossCups:0}},
  {code:"fifteen",name:"پازل ۱۵",engine:"miniapp",players:1,turnBased:false,scoreCap:5000,single:{winGems:75,lossGems:5,winXp:115,lossXp:20,winRating:13,lossRating:-3,winCups:4,lossCups:0}},
  {code:"snake",name:"مار",engine:"miniapp",players:1,turnBased:false,scoreCap:10000,single:{winGems:80,lossGems:5,winXp:120,lossXp:20,winRating:14,lossRating:-3,winCups:4,lossCups:0}},
  {code:"maze",name:"لابیرنت",engine:"miniapp",players:1,turnBased:false,scoreCap:5000,single:{winGems:80,lossGems:5,winXp:120,lossXp:20,winRating:14,lossRating:-3,winCups:4,lossCups:0}},
  {code:"target",name:"شکار هدف",engine:"miniapp",players:1,turnBased:false,scoreCap:5000,single:{winGems:70,lossGems:5,winXp:110,lossXp:20,winRating:12,lossRating:-3,winCups:3,lossCups:0}},
  {code:"obstacles",name:"پرش از موانع",engine:"miniapp",players:1,turnBased:false,scoreCap:5000,single:{winGems:75,lossGems:5,winXp:115,lossXp:20,winRating:13,lossRating:-3,winCups:4,lossCups:0}},
  {code:"tower",name:"برج‌سازی",engine:"miniapp",players:1,turnBased:false,scoreCap:5000,single:{winGems:80,lossGems:5,winXp:120,lossXp:20,winRating:14,lossRating:-3,winCups:4,lossCups:0}},
  {code:"shooting",name:"تیراندازی به هدف",engine:"miniapp",players:1,turnBased:false,scoreCap:5000,single:{winGems:80,lossGems:5,winXp:120,lossXp:20,winRating:14,lossRating:-3,winCups:4,lossCups:0}},
  {code:"tic_tac_toe_ai",name:"دوز مقابل ربات",engine:"miniapp",players:1,turnBased:true,scoreCap:5000,single:{winGems:70,lossGems:8,winXp:110,lossXp:25,winRating:14,lossRating:-5,winCups:4,lossCups:0}},
];

export const MULTI_GAMES:GameDefinition[]=[
  h("rps","سنگ، کاغذ، قیچی"),
  h("quiz_duel","کوییز رقابتی"),
  m("chess","شطرنج","miniapp",true),
  m("checkers","چکرز","miniapp",true),
  m("battleship","نبرد ناوگان","miniapp",true),
  h("word_duel","حدس کلمه دوئلی"),
  h("math_battle","جنگ ریاضی"),
  h("typing_speed","سرعت تایپ"),
  h("reaction","مسابقه واکنش"),
  m("memory_duel","حافظه رقابتی","miniapp",true),
  m("bingo","بینگو","miniapp",false),
  m("draw_guess","نقاشی و حدس","miniapp",false),
  h("emoji_guess","حدس ایموجی"),
  h("trivia","مسابقه اطلاعات عمومی"),
  m("territory","نبرد منطقه‌ای","miniapp",true),
  m("mini_golf","مینی‌گلف","miniapp",false),
  m("survival","مسابقه بقا","miniapp",false),
  m("treasure_hunt","شکار گنج دونفره","miniapp",true),
];

export const GAME_CATALOG={single:SINGLE_GAMES,multi:MULTI_GAMES} as const;

export function gameDefinition(code:string){
  return [...SINGLE_GAMES,...MULTI_GAMES].find(g=>g.code===code)??null;
}

export function gameRules(code:string,mode:GameMode){
  const g=gameDefinition(code);
  if(!g)return null;
  return mode==="single"?g.single??null:g.multi??null;
}

export const BOT_SINGLE_CODES=new Set(SINGLE_GAMES.filter(g=>g.engine!=="miniapp").map(g=>g.code));
export const MINI_SINGLE_CODES=new Set(SINGLE_GAMES.filter(g=>g.engine!=="bot").map(g=>g.code));
export const BOT_MULTI_CODES=new Set(MULTI_GAMES.filter(g=>g.engine!=="miniapp").map(g=>g.code));
export const MINI_MULTI_CODES=new Set(MULTI_GAMES.filter(g=>g.engine!=="bot").map(g=>g.code));
