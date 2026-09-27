import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

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
  const [session,setSession]=useState<SessionState|null>(null);
  const [score,setScore]=useState(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const game=session?.gameCode||"";
  const title=names[game]||game;

  useEffect(()=>{
    const tg=window.Telegram?.WebApp;
    tg?.ready();tg?.expand();
    fetch("/api/game?session="+encodeURIComponent(sessionId)).then(r=>r.json()).then(x=>{
      if(!x.ok)throw new Error(x.error||"not_found");setSession(x.session);
    }).catch(e=>setError(String(e.message||e)));
  },[sessionId]);

  async function action(action:string,payload:string,add=10){
    const initData=window.Telegram?.WebApp?.initData||"";
    if(!initData){setError("این بازی باید از داخل Telegram اجرا شود.");return;}
    setBusy(true);setError("");
    try{
      const r=await fetch("/api/game",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId:Number(sessionId),action,payload,initData})});
      const x=await r.json();if(!x.ok)throw new Error(x.error||"game_error");
      setSession(x.session);if(action==="move")setScore(v=>Math.min(1000,v+add));
    }catch(e:any){setError(String(e.message||e));}
    finally{setBusy(false);}
  }

  const boardSize=useMemo(()=>game==="battleship"||game==="territory"?5:game==="sudoku"||game==="chess"||game==="checkers"?8:game==="minesweeper"?8:4,[game]);
  const board=Array.from({length:boardSize*boardSize},(_,i)=>i);

  if(error)return <main className="wrap"><section className="card"><h1>◈ {title}</h1><p>{error}</p></section></main>;
  if(!session)return <main className="wrap"><section className="card"><h1>◈ مرکز بازی</h1><p>در حال بارگذاری بازی...</p></section></main>;

  const finished=session.status==="finished";
  return <main className="wrap" dir="rtl">
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

      {game==="2048" && <div className="controls"><button onClick={()=>action("move","up",25)}>↑</button><div><button onClick={()=>action("move","right",25)}>→</button><button onClick={()=>action("move","left",25)}>←</button></div><button onClick={()=>action("move","down",25)}>↓</button></div>}
      {game==="fifteen" && <div className="grid grid4">{board.map(i=><button key={i} onClick={()=>action("move",String(i),12)}>{i===15?"":i+1}</button>)}</div>}
      {["snake","maze","target","obstacles","tower","shooting","mini_golf","survival"].includes(game) &&
        <div className="actions"><button onClick={()=>action("move","1",30)}>۱</button><button onClick={()=>action("move","2",30)}>۲</button><button onClick={()=>action("move","3",30)}>۳</button><button onClick={()=>action("move","4",30)}>۴</button></div>}
      {["tic_tac_toe_ai","draw_guess"].includes(game) &&
        <div className="actions"><button onClick={()=>action("move","x",40)}>حرکت</button><button onClick={()=>action("move","o",40)}>حرکت ویژه</button></div>}
      {!finished && <button className="finish" disabled={busy} onClick={()=>action("finish",String(Math.max(100,score)),0)}>ثبت نتیجه</button>}
      {finished && <div className="result">بازی به پایان رسید. نتیجه و پاداش توسط سرور ثبت شده است.</div>}
    </section>
  </main>;
}
