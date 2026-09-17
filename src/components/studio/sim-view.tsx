import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { Rank } from "@/lib/bot/registry";
import { useStudio } from "@/store/studio";
import { Panel, PanelTitle } from "./panel";

const SAMPLES_FA = ["/پینگ", "/راهنما", "/بن @ali اسپم", "/آیدی", "/زبان en", "!mute @ali 10m"];
const SAMPLES_EN = ["/ping", "/help", "/ban @ali spam", "/id", "/lang fa", "/سکوت @ali 10m"];
const RANKS: Rank[] = ["owner", "admin", "member"];

export function SimView() {
  const fa = useStudio((s) => s.uiLang) === "fa";
  const messages = useStudio((s) => s.messages);
  const send = useStudio((s) => s.sendSim);
  const reset = useStudio((s) => s.resetSim);
  const mode = useStudio((s) => s.simMode);
  const setMode = useStudio((s) => s.setSimMode);
  const rank = useStudio((s) => s.simRank);
  const setRank = useStudio((s) => s.setSimRank);
  const botName = useStudio((s) => s.config.botName);
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  function submit() {
    send(text);
    setText("");
  }

  const samples = fa ? SAMPLES_FA : SAMPLES_EN;

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_16rem]">
      <Panel className="flex min-h-[28rem] flex-col p-0 sm:p-0">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <div>
            <p className="text-sm font-medium leading-tight">
              {mode === "private"
                ? fa
                  ? "چت خصوصی"
                  : "Private chat"
                : fa
                  ? "گروه آزمایش"
                  : "Test group"}
            </p>
            <p className="text-[11px] text-muted">{botName}</p>
          </div>
          <button
            type="button"
            onClick={reset}
            className="h-8 rounded-md px-2 text-[11px] text-muted hover:text-fg"
          >
            {fa ? "پاک" : "clear"}
          </button>
        </div>
        <div className="flex max-h-[26rem] min-h-72 flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-2">
          {messages.map((m) => (
            <div
              key={m.id}
              className={
                m.from === "user"
                  ? "ms-8 rounded-lg rounded-ee-sm bg-accent/15 px-2.5 py-1.5"
                  : m.from === "bot"
                    ? "me-8 rounded-lg rounded-es-sm bg-surface-2 px-2.5 py-1.5"
                    : "px-1 py-0.5 text-center text-[11px] text-subtle"
              }
            >
              {m.from !== "system" ? (
                <p className="text-[10px] leading-none text-accent">
                  {m.from === "bot" ? botName : m.name}
                </p>
              ) : null}
              <pre className="whitespace-pre-wrap font-sans text-[13px] leading-snug">
                {m.text}
              </pre>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <div className="border-t border-line p-2">
          <div className="mb-1.5 flex flex-wrap gap-1">
            {samples.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="h-7 rounded-sm px-2 font-mono text-[11px] text-muted shadow-[var(--shadow-border)] hover:text-fg"
              >
                {s}
              </button>
            ))}
          </div>
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={fa ? "مثلاً /بن یا /help" : "e.g. /بن or /help"}
            />
            <button
              type="submit"
              className="flex size-9 items-center justify-center rounded-md bg-fg text-bg"
              aria-label={fa ? "ارسال" : "Send"}
            >
              <Send className="size-3.5" />
            </button>
          </form>
        </div>
      </Panel>

      <div className="grid gap-3 content-start">
        <Panel>
          <PanelTitle title={fa ? "نقش تو" : "Your rank"} />
          <div className="flex flex-wrap gap-1.5">
            {RANKS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRank(r)}
                className={
                  rank === r
                    ? "h-8 rounded-md bg-fg px-2.5 text-xs text-bg"
                    : "h-8 rounded-md px-2.5 text-xs text-muted shadow-[var(--shadow-border)]"
                }
              >
                {fa
                  ? r === "owner"
                    ? "مالک"
                    : r === "admin"
                      ? "ادمین"
                      : "عضو"
                  : r}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              onClick={() => setMode("group")}
              className={
                mode === "group"
                  ? "h-8 rounded-md bg-fg px-2.5 text-xs text-bg"
                  : "h-8 rounded-md px-2.5 text-xs text-muted shadow-[var(--shadow-border)]"
              }
            >
              {fa ? "گروه" : "group"}
            </button>
            <button
              type="button"
              onClick={() => setMode("private")}
              className={
                mode === "private"
                  ? "h-8 rounded-md bg-fg px-2.5 text-xs text-bg"
                  : "h-8 rounded-md px-2.5 text-xs text-muted shadow-[var(--shadow-border)]"
              }
            >
              {fa ? "خصوصی" : "private"}
            </button>
          </div>
        </Panel>
        <Panel>
          <PanelTitle
            title={fa ? "چی را تست کنی" : "What to try"}
            hint={
              fa
                ? "عضو را بزن و /اطلاعات بفرست — باید رد شود. مالک /بن بزند — فاز ۲ اعلام می‌شود."
                : "Switch to member and send /info — should refuse. Owner /ban — gated to phase 2."
            }
          />
        </Panel>
      </div>
    </div>
  );
}
