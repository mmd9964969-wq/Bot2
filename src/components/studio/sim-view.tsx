import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cloneStudioDefaults, type StudioDocument } from "@/lib/bot/studio";
import { useStudio } from "@/store/studio";
import { Panel, PanelTitle } from "./panel";

type Msg = { id: number; from: "user" | "bot"; text: string };

export function SimView() {
  const fa = useStudio((s) => s.uiLang) === "fa";
  const [doc, setDoc] = useState<StudioDocument>(() => cloneStudioDefaults());
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [rank, setRank] = useState<"member"|"admin"|"owner">("owner");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { fetch("/api/bot/studio").then((r)=>r.json()).then((x)=>x.document&&setDoc(x.document)).catch(()=>undefined); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages.length]);

  function send(value: string) {
    const raw = value.trim(); if (!raw) return;
    const token = raw.replace(/^[/!.]/, "").trim().split(/\s+/)[0].toLowerCase();
    const command = doc.commands.find((c) => c.enabled && [...c.aliasesFa, ...c.aliasesEn].some((a) => a.toLowerCase() === token));
    let reply = fa ? "دستور شناخته نشد." : "Unknown command.";
    if (command) {
      const allowed = command.minRank === "member" || (command.minRank === "admin" && rank !== "member") || rank === "owner";
      if (!allowed) reply = fa ? "دسترسی این دستور برای مقام شما کافی نیست." : "Your rank is not sufficient for this command.";
      else if (command.phase > 2) reply = fa ? "این قابلیت خارج از دو فاز فعال ربات است." : "This capability is outside the two active bot phases.";
      else {
        const template = fa ? command.responseFa : command.responseEn;
        reply = template
          .replaceAll("{{user_name}}", "you")
          .replaceAll("{{username}}", "@you")
          .replaceAll("{{user_id}}", "1001")
          .replaceAll("{{rank}}", rank)
          .replaceAll("{{chat_title}}", "گروه آزمایش")
          .replaceAll("{{chat_id}}", "-100123456")
          .replaceAll("{{chat_type}}", "supergroup")
          .replaceAll("{{members_count}}", "128")
          .replaceAll("{{admins_count}}", "4")
          .replaceAll("{{latency_ms}}", "42")
          .replaceAll("{{database_status}}", fa ? "متصل" : "connected")
          .replaceAll("{{version}}", "v2.0.0")
          .replaceAll("{{permissions}}", fa ? "کامل" : "full");
      }
    }
    setMessages((m)=>[...m,{id:Date.now(),from:"user",text:raw},{id:Date.now()+1,from:"bot",text:reply}].slice(-80));
    setText("");
  }

  return <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
    <Panel className="flex min-h-[30rem] flex-col p-0 sm:p-0">
      <div className="flex items-center justify-between border-b border-line px-4 py-3"><div><p className="text-sm font-semibold">{fa?"شبیه‌ساز زنده پنل":"Panel live simulator"}</p><p className="text-[10px] text-muted">{doc.commands.length} {fa?"دستور قابل تست":"editable commands"}</p></div></div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">{messages.map((m)=><div key={m.id} className={m.from==="user"?"ms-8 rounded-xl bg-accent/12 px-3 py-2":"me-8 rounded-xl bg-surface-2 px-3 py-2"}><p className="whitespace-pre-wrap text-sm leading-6">{m.text}</p></div>)}<div ref={endRef}/></div>
      <form onSubmit={(e)=>{e.preventDefault();send(text)}} className="flex gap-2 border-t border-line p-3"><Input value={text} onChange={(e)=>setText(e.target.value)} placeholder={fa?"مثلاً اطلاعات یا پنل":"e.g. info or panel"} /><button type="submit" className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-fg text-bg"><Send className="size-3.5"/></button></form>
    </Panel>
    <Panel className="h-fit">
      <PanelTitle title={fa?"سناریوی تست":"Test context"} />
      <div className="grid gap-2">
        {(["member","admin","owner"] as const).map((r)=><button key={r} type="button" onClick={()=>setRank(r)} className={rank===r?"h-9 rounded-lg bg-fg text-xs text-bg":"h-9 rounded-lg text-xs text-muted shadow-[var(--shadow-border)]"}>{fa?(r==="member"?"عضو":r==="admin"?"ادمین":"مالک"):r}</button>)}
      </div>
      <p className="mt-3 text-[11px] leading-5 text-muted">{fa?"دستورها بدون / هم در شبیه‌ساز قابل تست‌اند و پاسخ دقیقاً از سند پنل خوانده می‌شود.":"Commands can be tested without / and replies are read from the panel document."}</p>
    </Panel>
  </div>;
}
