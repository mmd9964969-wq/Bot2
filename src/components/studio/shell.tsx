import { useEffect } from "react";
import { Activity, BookOpen, Layers3, MessageSquare, Rocket } from "lucide-react";
import { NizamMark } from "@/components/mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useStudio, type ViewId } from "@/store/studio";
import { CommandsView } from "./commands-view";
import { ConfigView } from "./config-view";
import { DeployView } from "./deploy-view";
import { OverviewView } from "./overview-view";
import { SimView } from "./sim-view";

const NAV: { id: ViewId; fa: string; en: string; icon: typeof Activity }[] = [
  { id: "overview", fa: "داشبورد", en: "Overview", icon: Activity },
  { id: "config", fa: "فازها", en: "Phases", icon: Layers3 },
  { id: "commands", fa: "۳۶ دستور", en: "36 commands", icon: BookOpen },
  { id: "sim", fa: "شبیه‌ساز", en: "Simulator", icon: MessageSquare },
  { id: "deploy", fa: "وضعیت", en: "Deploy", icon: Rocket },
];

export function StudioShell() {
  useEffect(() => { void useStudio.persist.rehydrate(); }, []);
  const uiLang = useStudio((s) => s.uiLang);
  const view = useStudio((s) => s.view);
  const setView = useStudio((s) => s.setView);
  const setUiLang = useStudio((s) => s.setUiLang);
  const rtl = uiLang === "fa";

  return (
    <div dir={rtl ? "rtl" : "ltr"} className="min-h-dvh bg-bg text-fg">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <div className="flex size-9 items-center justify-center rounded-xl bg-surface shadow-[var(--shadow-border)]">
            <NizamMark className="size-5 text-accent" />
          </div>
          <div>
            <div className="flex items-center gap-2"><span className="text-sm font-semibold">نظم</span><span className="font-mono text-[10px] text-subtle">CONTROL STUDIO</span></div>
            <p className="text-[10px] text-muted">{rtl ? "مرکز کنترل و پیکربندی ربات" : "Bot configuration control center"}</p>
          </div>
          <Badge tone="accent">{rtl ? "۵ فاز" : "5 phases"}</Badge>
          <div className="ms-auto flex gap-1">
            <Button size="sm" variant={uiLang === "fa" ? "solid" : "ghost"} onClick={() => setUiLang("fa")}>فا</Button>
            <Button size="sm" variant={uiLang === "en" ? "solid" : "ghost"} onClick={() => setUiLang("en")}>EN</Button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-3 pb-1 sm:px-6">
          {NAV.map((item) => { const Icon=item.icon; const active=view===item.id; return (
            <button key={item.id} type="button" onClick={() => setView(item.id)} className={cn("flex h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-xs font-medium", active ? "bg-surface text-fg shadow-[var(--shadow-border)]" : "text-muted hover:bg-surface-2 hover:text-fg")}>
              <Icon className="size-3.5" />{rtl ? item.fa : item.en}
            </button>
          ); })}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-7">
        {view === "overview" && <OverviewView />}
        {view === "config" && <ConfigView />}
        {view === "commands" && <CommandsView />}
        {view === "sim" && <SimView />}
        {view === "deploy" && <DeployView />}
      </main>
    </div>
  );
}
