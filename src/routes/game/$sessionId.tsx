import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

declare global {
  interface Window {
    Telegram?: { WebApp?: {
      ready:()=>void;
      expand:()=>void;
      close:()=>void;
      initData:string;
      initDataUnsafe?:{user?:{id:number;first_name?:string;username?:string}};
      MainButton?:{setText:(t:string)=>void;show:()=>void;hide:()=>void;onClick:(fn:()=>void)=>void};
    }};
  }
}

type SessionState={
  id:number;gameCode:string;status:string;mode:string;currentTurnUserId:number|null;turnNo:number;
  state:any;players:any[];
};

const names:Record<string,string>={
  sudoku:"سودوکو",minesweeper:"مین‌روب","2048":"۲۰۴۸",fifteen:"پازل ۱۵",snake:"مار",maze:"لابیرنت",target:"شکار هدف",
  obstacles:"پرش از موانع",tower:"برج‌سازی",shooting:"تیراندازی به هدف",tic_tac_toe_ai:"دوز مقابل ربات",
  chess:"شطرنج",checkers:"چکرز",battleship:"نبرد ناوگان",memory_duel:"حافظه رقابتی",bingo:"بینگو",draw_guess:"نقاشی و حدس",
  territory:"نبرد منطقه‌ای",mini_golf:"مینی‌گلف",survival:"مسابقه بقا",treasure_hunt:"شکار گنج دونفره",
};

export const Route=createFileRoute("/game/$sessionId")({component:GameMiniApp});

function GameMiniApp(){
  const {sessionId}=Route.useParams();
  const launchToken=new URLSearchParams(typeof window!=="undefined"?window.location.search:"").get("launch")||"";
  const [session,setSession]=useState<SessionState|null>(null);
  const [score,setScore]=useState(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const game=session?.gameCode||"";
  const title=names[game]||game;

  useEffect(()=>{
    const tg=window.Telegram?.WebApp;
    tg?.ready();tg?.expand();
    let alive=true;
    const load=async()=>{
      try{
        const r=await fetch("/api/game?session="+encodeURIComponent(sessionId),{cache:"no-store"});
        const x=await r.json();
        if(!x.ok)throw new Error(x.error||"not_found");
        if(alive)setSession(x.session);
      }catch(e){if(alive)setError(String((e as any)?.message||e));}
    };
    void load();
    const timer=window.setInterval(load,1200);
    return()=>{alive=false;window.clearInterval(timer);};
  },[sessionId]);

  async function action(actionName:string,payload:string,add=10){
    const initData=window.Telegram?.WebApp?.initData||"";
    if(!initData&&!launchToken){
      setError("لینک اجرای بازی معتبر نیست. بازی را از دکمه «اجرای بازی» باز کنید.");
      return;
    }
    setBusy(true);setError("");
    try{
      const r=await fetch("/api/game",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({
          sessionId:Number(sessionId),
          action:actionName,
          payload,
          initData,
          launchToken
        })
      });
      const x=await r.json();
      if(!x.ok)throw new Error(x.error||"game_error");
      setSession(x.session);
      if(actionName==="move"&&game!=="2048")setScore(v=>Math.min(1000,v+add));
    }catch(e:any){
      setError(String(e.message||e));
    }finally{
      setBusy(false);
    }
  }

  const boardSize=useMemo(()=>game==="battleship"||game==="territory"?5:game==="sudoku"||game==="chess"||game==="checkers"?8:game==="minesweeper"?8:4,[game]);
  const board=Array.from({length:boardSize*boardSize},(_,i)=>i);

  const styles=`
    :root{color-scheme:dark}
    *{box-sizing:border-box}
    body{margin:0;background:#07090c;color:#f4f5f7;font-family:Vazirmatn,Arial,sans-serif}
    button{font:inherit}
    .wrap{min-height:100vh;padding:16px;background:radial-gradient(circle at 50% -10%,#253343 0,#0b0e13 36%,#07090c 76%)}
    .head,.scorebar{max-width:760px;margin:0 auto 12px}
    .head{display:flex;justify-content:space-between;align-items:end;gap:12px}
    .kicker{font:600 11px/1.4 Inter,Arial,sans-serif;letter-spacing:.12em;opacity:.55}
    h1{font-size:25px;margin:5px 0 0}
    .stat{display:flex;flex-direction:column;gap:4px;text-align:left;opacity:.8;font-size:12px}
    .card{background:rgba(18,22,28,.84);border:1px solid rgba(255,255,255,.09);border-radius:20px;padding:16px;box-shadow:0 18px 48px rgba(0,0,0,.30);backdrop-filter:blur(18px)}
    .scorebar{display:grid;grid-template-columns:1.2fr 1fr 90px;gap:10px}
    .scorebar div{display:flex;flex-direction:column;gap:5px;background:rgba(10,13,17,.88);border-radius:13px;padding:10px}
    .scorebar span{font-size:11px;opacity:.5}
    .scorebar b{font-size:13px}
    .play{max-width:760px;margin:auto;text-align:center}
    .grid{display:grid;gap:6px;max-width:540px;margin:0 auto 14px}
    .grid button{aspect-ratio:1;border:1px solid rgba(255,255,255,.08);border-radius:10px;background:#161a20;color:#fff;cursor:pointer}
    .grid button:active,.actions button:active,.controls button:active,.finish:active{transform:scale(.97)}
    .actions{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;max-width:480px;margin:0 auto 14px}
    .actions button,.controls button,.finish{border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:13px;background:#171b22;color:#fff;cursor:pointer}
    .controls{display:grid;justify-content:center;gap:8px;margin:0 auto 14px}
    .controls>div{display:flex;gap:8px;justify-content:center}
    .controls button{min-width:78px}
    .finish{width:100%;max-width:480px;background:#242a33}
    .result{margin-top:12px;padding:12px;border-radius:12px;background:#11151b}
    p{opacity:.75}

    .g2048{max-width:590px;margin:0 auto}
    .g2048Top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px}
    .g2048Hint{font-size:12px;opacity:.55}
    .score2048{display:flex;gap:8px}
    .badge2048{min-width:76px;padding:8px 10px;border-radius:12px;background:#0f1318;border:1px solid rgba(255,255,255,.08)}
    .badge2048 span{display:block;font-size:10px;opacity:.45}
    .badge2048 b{display:block;margin-top:2px;font-size:14px}
    .board3d{perspective:950px;transform-style:preserve-3d;transform:rotateX(10deg);padding:14px 14px 20px;border-radius:24px;background:linear-gradient(145deg,#202731,#0d1015);border:1px solid rgba(255,255,255,.10);box-shadow:0 34px 70px rgba(0,0,0,.48),inset 0 1px 0 rgba(255,255,255,.06)}
    .boardInner{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;transform-style:preserve-3d}
    .cell3d{position:relative;aspect-ratio:1;border-radius:14px;background:#0b0f14;border:1px solid rgba(255,255,255,.045);box-shadow:inset 0 -7px 12px rgba(0,0,0,.40),inset 0 1px 0 rgba(255,255,255,.035)}
    .tile3d{position:absolute;inset:4px;display:grid;place-items:center;border-radius:11px;background:linear-gradient(145deg,#3a4552,#1a2028);border:1px solid rgba(255,255,255,.16);font-weight:800;font-size:clamp(21px,6vw,42px);box-shadow:0 10px 0 rgba(0,0,0,.22),0 18px 25px rgba(0,0,0,.22),inset 0 1px 0 rgba(255,255,255,.16);transform:translateZ(var(--z));transition:transform .16s ease,filter .16s ease}
    .tile3d.pop{animation:tilePop .18s ease-out}
    .tile2048-2{background:linear-gradient(145deg,#74879b,#2b3743)}
    .tile2048-4{background:linear-gradient(145deg,#8a795d,#3b3022)}
    .tile2048-8{background:linear-gradient(145deg,#9e663f,#4b2b1b)}
    .tile2048-16{background:linear-gradient(145deg,#ad4f3d,#54231b)}
    .tile2048-32{background:linear-gradient(145deg,#b83d3d,#5a1a1c)}
    .tile2048-64{background:linear-gradient(145deg,#cc3947,#65141f)}
    .tile2048-128{background:linear-gradient(145deg,#8d55b6,#371d50)}
    .tile2048-256{background:linear-gradient(145deg,#5b63c9,#252a69)}
    .tile2048-512{background:linear-gradient(145deg,#327ec2,#163b60)}
    .tile2048-1024{background:linear-gradient(145deg,#2f9d92,#154f4a)}
    .tile2048-2048{background:linear-gradient(145deg,#d1a83c,#604c18);color:#fff;box-shadow:0 12px 0 rgba(55,37,4,.55),0 0 30px rgba(209,168,60,.25),inset 0 1px 0 rgba(255,255,255,.22)}
    .controls2048{display:grid;grid-template-columns:repeat(3,68px);gap:8px;justify-content:center;margin:18px auto 10px}
    .controls2048 button{height:52px;border:1px solid rgba(255,255,255,.11);border-radius:13px;background:#171d24;color:#fff;font-size:22px;cursor:pointer;box-shadow:0 7px 16px rgba(0,0,0,.23)}
    .controls2048 .up{grid-column:2}
    .controls2048 .left{grid-column:1}
    .controls2048 .down{grid-column:2}
    .controls2048 .right{grid-column:3}
    .controls2048 button:disabled{opacity:.4;cursor:not-allowed}
    .gameStatus{margin-top:10px;padding:11px 13px;border-radius:13px;background:#0d1217;border:1px solid rgba(255,255,255,.07);font-size:12px;opacity:.78}
    @keyframes tilePop{0%{transform:translateZ(var(--z)) scale(.86)}70%{transform:translateZ(var(--z)) scale(1.04)}100%{transform:translateZ(var(--z)) scale(1)}}
    @media(max-width:620px){
      .scorebar{grid-template-columns:1fr 1fr}.scorebar div:last-child{grid-column:1/-1}
      .head{align-items:start}
      .board3d{padding:10px 10px 16px}.boardInner{gap:6px}.cell3d{border-radius:11px}.tile3d{inset:3px;border-radius:9px}
    }
  `;

  if(error)return <main className="wrap"><style>{styles}</style><section className="card"><h1>◈ {title||"مرکز بازی"}</h1><p>{error}</p></section></main>;
  if(!session)return <main className="wrap"><style>{styles}</style><section className="card"><h1>◈ مرکز بازی</h1><p>در حال بارگذاری بازی...</p></section></main>;

  const finished=session.status==="finished";

  if(game==="2048"){
    return <><style>{styles}</style><main className="wrap" dir="rtl">
      <section className="head">
        <div><span className="kicker">Pᴇʀsɪᴀɴ ᴮᵒᵗ · Mɪɴɪ Aᴘᴘ · 3D</span><h1>۲۰۴۸</h1></div>
        <div className="stat"><b>تک‌نفره</b><span>حرکت {Number(session.state?.moves||0)}</span></div>
      </section>

      <section className="card play g2048">
        <div className="g2048Top">
          <div className="g2048Hint">هدف: رسیدن به کاشی ۲۰۴۸</div>
          <div className="score2048">
            <div className="badge2048"><span>امتیاز</span><b>{fa(Number(session.state?.score||0))}</b></div>
            <div className="badge2048"><span>بیشترین</span><b>{fa(Number(session.state?.bestTile||2))}</b></div>
          </div>
        </div>

        <Twenty48Board
          board={Array.isArray(session.state?.board)?session.state.board.map(Number):Array(16).fill(0)}
          busy={busy}
          finished={finished}
          onMove={(direction)=>action("move",direction,0)}
        />

        <div className="gameStatus">
          {finished
            ? "بازی تمام شده و نتیجه و پاداش توسط سرور ثبت شده است."
            : "حرکت را با دکمه‌ها، کشیدن انگشت روی صفحه یا کلیدهای جهت‌دار انجام بده."
          }
        </div>

        {!finished && <button className="finish" style={{marginTop:12}} disabled={busy} onClick={()=>action("finish","0",0)}>انصراف و پایان بازی</button>}
        {finished && <div className="result">نتیجه نهایی در همان گروه اعلام شده است.</div>}
      </section>
    </main></>;
  }

  return <><style>{styles}</style><main className="wrap" dir="rtl">
    <section className="head">
      <div><span className="kicker">Pᴇʀsɪᴀɴ ᴮᵒᵗ · Mɪɴɪ Aᴘᴘ</span><h1>{title}</h1></div>
      <div className="stat"><b>{session.mode==="multi"?"چندنفره":"تک‌نفره"}</b><span>نوبت {session.turnNo}</span></div>
    </section>

    <section className="card scorebar">
      <div><span>بازیکنان</span><b>{session.players.map(p=>p.name).join(" · ")}</b></div>
      <div><span>وضعیت</span><b>{finished?"پایان‌یافته":session.currentTurnUserId===window.Telegram?.WebApp?.initDataUnsafe?.user?.id?"نوبت شما":"در انتظار حریف"}</b></div>
      <div><span>امتیاز</span><b>{score}</b></div>
    </section>

    <section className="card play">
      {["sudoku","minesweeper","chess","checkers","battleship","territory","memory_duel","bingo","treasure_hunt"].includes(game) &&
        <div className="grid" style={{gridTemplateColumns:"repeat("+boardSize+",1fr)"}}>
          {board.map(i=><button key={i} disabled={busy||finished} onClick={()=>action("move",String(i),15)}>{(i%boardSize)+1}</button>)}
        </div>}

      {game==="fifteen" && <div className="grid">{board.map(i=><button key={i} disabled={busy||finished} onClick={()=>action("move",String(i),12)}>{i===15?"":i+1}</button>)}</div>}
      {["snake","maze","target","obstacles","tower","shooting","mini_golf","survival"].includes(game) &&
        <div className="actions"><button onClick={()=>action("move","1",30)}>۱</button><button onClick={()=>action("move","2",30)}>۲</button><button onClick={()=>action("move","3",30)}>۳</button><button onClick={()=>action("move","4",30)}>۴</button></div>}
      {["tic_tac_toe_ai","draw_guess"].includes(game) &&
        <div className="actions"><button onClick={()=>action("move","x",40)}>حرکت</button><button onClick={()=>action("move","o",40)}>حرکت ویژه</button></div>}
      {!finished && <button className="finish" disabled={busy} onClick={()=>action("finish",String(Math.max(100,score)),0)}>ثبت نتیجه</button>}
      {finished && <div className="result">بازی به پایان رسید. نتیجه و پاداش توسط سرور ثبت شده است.</div>}
    </section>
  </main></>;
}

function fa(value:number){
  return String(Number.isFinite(value)?value:0).split("").map(d=>"۰۱۲۳۴۵۶۷۸۹"[Number(d)]||d).join("");
}

function Twenty48Board({board,busy,finished,onMove}:{board:number[];busy:boolean;finished:boolean;onMove:(direction:string)=>void}){
  const [pointerStart,setPointerStart]=useState<{x:number;y:number}|null>(null);
  const canMove=!busy&&!finished;

  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      const map:Record<string,string>={ArrowUp:"up",ArrowDown:"down",ArrowLeft:"left",ArrowRight:"right","w":"up","s":"down","a":"left","d":"right"};
      const dir=map[e.key];
      if(dir&&canMove){e.preventDefault();onMove(dir);}
    };
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[canMove,onMove]);

  function pointerDown(e:ReactPointerEvent<HTMLDivElement>){
    if(!canMove)return;
    setPointerStart({x:e.clientX,y:e.clientY});
  }

  function pointerUp(e:ReactPointerEvent<HTMLDivElement>){
    if(!canMove||!pointerStart)return;
    const dx=e.clientX-pointerStart.x,dy=e.clientY-pointerStart.y;
    setPointerStart(null);
    if(Math.max(Math.abs(dx),Math.abs(dy))<28)return;
    onMove(Math.abs(dx)>Math.abs(dy)?(dx>0?"right":"left"):(dy>0?"down":"up"));
  }

  return <div className="board3d" onPointerDown={pointerDown} onPointerUp={pointerUp} onPointerCancel={()=>setPointerStart(null)}>
    <div className="boardInner">
      {board.map((value,index)=>{
        const tileClass=value?"tile3d tile2048-"+value:"";
        const depth=value?Math.min(60,8+Math.round(Math.log2(Math.max(2,value))*5)):0;
        return <div className="cell3d" key={index}>
          {value>0 && <div className={tileClass+" pop"} style={{["--z" as any]:depth+"px"}}>{value}</div>}
        </div>;
      })}
    </div>

    <div className="controls2048">
      <button className="up" disabled={!canMove} onClick={()=>onMove("up")}>↑</button>
      <button className="left" disabled={!canMove} onClick={()=>onMove("left")}>←</button>
      <button className="down" disabled={!canMove} onClick={()=>onMove("down")}>↓</button>
      <button className="right" disabled={!canMove} onClick={()=>onMove("right")}>→</button>
    </div>
  </div>;
}
