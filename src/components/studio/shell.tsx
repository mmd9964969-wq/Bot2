import { useEffect } from "react";
import {
  BookOpen,
  Cable,
  MessageSquare,
  Settings2,
  Shield,
} from "lucide-react";
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

const NAV: { id: ViewId; fa: string; en: string; icon: typeof Shield }[] = [
  { id: "overview", fa: "بیس", en: "Base", icon: Shield },
  { id: "config", fa: "تنظیمات", en: "Config", icon: Settings2 },
  { id: "commands", fa: "دستورات", en: "Commands", icon: BookOpen },
  { id: "sim", fa: "شبیه‌ساز", en: "Sim", icon: MessageSquare },
  { id: "deploy", fa: "استقرار", en: "Deploy", icon: Cable },
];

export function StudioShell() {
  useEffect(() => {
    void useStudio.persist.rehydrate();
  }, []);
  const uiLang = useStudio((s) => s.uiLang);
  const view = useStudio((s) => s.view);
  const setView = useStudio((s) => s.setView);
  const setUiLang = useStudio((s) => s.setUiLang);
  const rtl = uiLang === "fa";

  return (
    <div
      dir={rtl ? "rtl" : "ltr"}
      className="flex min-h-dvh flex-col bg-bg text-fg"
    >
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur-sm">
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-3 px-3 sm:px-5">
          <NizamMark className="size-5 text-accent" />
          <div className="min-w-0 leading-none">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold tracking-tight">نظم</span>
              <span className="font-mono text-[10px] text-subtle">Nizam</span>
            </div>
          </div>
          <Badge tone="accent">
            {rtl ? "فاز ۱ · هسته" : "Phase 1 · core"}
          </Badge>
          <div className="ms-auto flex items-center gap-1">
            <Button
              size="sm"
              variant={uiLang === "fa" ? "solid" : "ghost"}
              onClick={() => setUiLang("fa")}
            >
              فا
            </Button>
            <Button
              size="sm"
              variant={uiLang === "en" ? "solid" : "ghost"}
              onClick={() => setUiLang("en")}
            >
              EN
            </Button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-0.5 overflow-x-auto px-2 sm:px-5">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                className={cn(
                  "flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-xs font-medium transition-colors duration-[var(--motion-quick)]",
                  active
                    ? "border-accent text-fg"
                    : "border-transparent text-muted hover:text-fg",
                )}
              >
                <Icon className="size-3.5" />
                {rtl ? item.fa : item.en}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-3 py-4 sm:px-5 sm:py-5">
        {view === "overview" && <OverviewView />}
        {view === "config" && <ConfigView />}
        {view === "commands" && <CommandsView />}
        {view === "sim" && <SimView />}
        {view === "deploy" && <DeployView />}
      </main>
    </div>
  );
}
