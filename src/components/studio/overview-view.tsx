import { useEffect, useState } from "react";
import { ArrowUpRight, CheckCircle2, Database, Layers3, Radio, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useStudio } from "@/store/studio";
import { cloneStudioDefaults, type StudioDocument } from "@/lib/bot/studio";
import { Panel, PanelTitle } from "./panel";

export function OverviewView() {
  const fa = useStudio((s) => s.uiLang) === "fa";
  const setView = useStudio((s) => s.setView);
  const [doc, setDoc] = useState<StudioDocument>(() => cloneStudioDefaults());

  useEffect(() => {
    fetch("/api/bot/studio").then((r) => r.json()).then((x) => x.document && setDoc(x.document)).catch(() => undefined);
  }, []);

  const p1 = doc.capabilities.filter((x) => x.phase === 1);
  const p2 = doc.capabilities.filter((x) => x.phase === 2);

  return (
    <div className="grid gap-5">
      <section className="relative overflow-hidden rounded-2xl bg-surface p-6 shadow-[var(--shadow-panel)] ring-1 ring-line sm:p-8">
        <div className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full bg-accent/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 -right-20 size-64 rounded-full bg-ok/5 blur-3xl" />
        <div className="relative grid gap-7 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
          <div>
            <Badge tone="accent">CONTROL STUDIO · v3</Badge>
            <h1 className="mt-4 max-w-2xl text-2xl font-semibold tracking-tight sm:text-4xl">
              {fa ? "فرمان کامل ربات، در یک لایه کنترل." : "Complete bot control, in one layer."}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">
              {fa
                ? "ربات فقط دو فاز فعال دارد. تمام دستورات، پاسخ‌ها، سطح دسترسی و تنظیمات اجرایی از این پنل مدیریت می‌شوند و PostgreSQL منبع اصلی تنظیمات است."
                : "The bot has exactly two active phases. Commands, replies, access levels and runtime settings are managed here, with PostgreSQL as the source of truth."}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <button type="button" onClick={() => setView("commands")} className="flex h-10 items-center gap-2 rounded-xl bg-fg px-4 text-xs font-semibold text-bg">
                {fa ? "ویرایش دستورات" : "Edit commands"} <ArrowUpRight className="size-3.5" />
              </button>
              <button type="button" onClick={() => setView("sim")} className="h-10 rounded-xl px-4 text-xs text-muted ring-1 ring-line hover:text-fg">
                {fa ? "تست شبیه‌ساز" : "Open simulator"}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Metric icon={Layers3} label={fa ? "فازهای فعال" : "Active phases"} value="2" />
            <Metric icon={Radio} label={fa ? "قابلیت‌ها" : "Capabilities"} value={String(doc.capabilities.length)} />
            <Metric icon={CheckCircle2} label={fa ? "دستورات فعال" : "Active commands"} value={String(doc.commands.length)} />
            <Metric icon={Database} label="Source" value="PostgreSQL" />
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <PhaseCard phase={1} titleFa="هسته و اطلاعات" titleEn="Core & information" items={p1} fa={fa} />
        <PhaseCard phase={2} titleFa="وضعیت و سیستم" titleEn="Status & system" items={p2} fa={fa} />
      </div>

      <Panel>
        <PanelTitle kicker={fa ? "ARCHITECTURE" : "ARCHITECTURE"} title={fa ? "یک منبع حقیقت" : "Single source of truth"} />
        <div className="grid gap-2 md:grid-cols-3">
          <Arch title="01" icon={Layers3} text={fa ? "پنل وب — ویرایش و کنترل" : "Web panel — edit & control"} />
          <Arch title="02" icon={Database} text={fa ? "PostgreSQL — ذخیره دائمی" : "PostgreSQL — persistence"} />
          <Arch title="03" icon={ShieldCheck} text={fa ? "Telegram Bot — اجرای تنظیمات ذخیره‌شده" : "Telegram bot — executes saved configuration"} />
        </div>
      </Panel>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Database; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-bg p-3 ring-1 ring-line">
      <Icon className="size-4 text-accent" />
      <p className="mt-3 text-[11px] text-muted">{label}</p>
      <p className="font-mono text-lg">{value}</p>
    </div>
  );
}

function PhaseCard({ phase, titleFa, titleEn, items, fa }: { phase: number; titleFa: string; titleEn: string; items: StudioDocument["capabilities"]; fa: boolean }) {
  return (
    <Panel>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] text-accent">{fa ? `فاز ۰${phase}` : `PHASE 0${phase}`}</p>
          <h2 className="mt-1 text-lg font-semibold">{fa ? titleFa : titleEn}</h2>
        </div>
        <Badge tone={phase === 1 ? "ok" : "warn"}>{fa ? "فعال" : "Live"}</Badge>
      </div>
      <div className="mt-4 grid gap-2">
        {items.map((item) => (
          <div key={item.id} className="rounded-xl bg-surface-2 p-3 ring-1 ring-line">
            <p className="text-sm font-medium">{fa ? item.titleFa : item.titleEn}</p>
            <p className="mt-1 text-xs leading-5 text-muted">{fa ? item.descriptionFa : item.descriptionEn}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Arch({ title, icon: Icon, text }: { title: string; icon: typeof Database; text: string }) {
  return (
    <div className="rounded-xl bg-surface-2 p-4 ring-1 ring-line">
      <div className="flex items-center gap-2"><Icon className="size-4 text-accent" /><span className="font-mono text-[10px] text-subtle">{title}</span></div>
      <p className="mt-3 text-xs leading-5">{text}</p>
    </div>
  );
}
