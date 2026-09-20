import { useEffect } from "react";
import { Activity, BookOpen, Layers3, MessageSquare, Rocket, ShieldCheck } from "lucide-react";
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
  { id: "overview", fa: "نمای کلی", en: "Overview", icon: Activity },
  { id: "config", fa: "دو فاز", en: "Two phases", icon: Layers3 },
  { id: "commands", fa: "دستورات", en: "Commands", icon: BookOpen },
  { id: "sim", fa: "آزمایش", en: "Simulator", icon: MessageSquare },
  { id: "deploy", fa: "سرویس", en: "Service", icon: Rocket },
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
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-2xl">
        <div className="mx-auto flex min-h-16 max-w-[1480px] items-center gap-3 px-4 sm:px-7">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface ring-1 ring-line-strong">
            <NizamMark className="size-5 text-accent" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold tracking-tight">نظم</span>
              <span className="hidden font-mono text-[9px] tracking-[0.18em] text-accent sm:inline">CONTROL STUDIO</span>
            </div>
            <p className="truncate text-[10px] text-muted">{rtl ? "مرکز فرمان ربات و منبع اصلی تنظیمات" : "Bot command center and configuration source"}</p>
          </div>
          <Badge tone="accent">{rtl ? "۲ فاز · ۹ دستور" : "2 phases · 9 commands"}</Badge>
          <div className="ms-auto flex items-center gap-1">
            <Button size="sm" variant={uiLang === "fa" ? "solid" : "ghost"} onClick={() => setUiLang("fa")}>فا</Button>
            <Button size="sm" variant={uiLang === "en" ? "solid" : "ghost"} onClick={() => setUiLang("en")}>EN</Button>
          </div>
        </div>
        <div className="mx-auto max-w-[1480px] px-3 pb-2 sm:px-7">
          <nav className="flex gap-1 overflow-x-auto rounded-xl bg-surface/70 p-1 ring-1 ring-line">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setView(item.id)}
                  className={cn(
                    "flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-[11px] font-medium transition-all",
                    active
                      ? "bg-fg text-bg shadow-sm"
                      : "text-muted hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  <Icon className="size-3.5" />
                  {rtl ? item.fa : item.en}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1480px] px-4 py-5 sm:px-7 sm:py-8">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-accent">{rtl ? "MASTER CONTROL" : "MASTER CONTROL"}</p>
            <p className="mt-1 text-xs text-muted">{rtl ? "هر تغییر ذخیره‌شده در PostgreSQL منبع تنظیمات ربات است." : "Every saved change in PostgreSQL is the bot configuration source of truth."}</p>
          </div>
          <div className="hidden items-center gap-2 text-[10px] text-muted sm:flex">
            <ShieldCheck className="size-3.5 text-ok" />
            PostgreSQL synced
          </div>
        </div>
        {view === "overview" && <OverviewView />}
        {view === "config" && <ConfigView />}
        {view === "commands" && <CommandsView />}
        {view === "sim" && <SimView />}
        {view === "deploy" && <DeployView />}
      </main>
    </div>
  );
}
