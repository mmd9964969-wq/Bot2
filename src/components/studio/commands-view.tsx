import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, Save, Search, ToggleLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cloneStudioDefaults, type StudioCommand, type StudioDocument } from "@/lib/bot/studio";
import { useStudio } from "@/store/studio";
import { Panel, PanelTitle } from "./panel";

export function CommandsView() {
  const fa = useStudio((s) => s.uiLang) === "fa";
  const [doc, setDoc] = useState<StudioDocument>(() => cloneStudioDefaults());
  const [selected, setSelected] = useState("robot");
  const [phase, setPhase] = useState<0 | 1 | 2>(0);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { fetch("/api/bot/studio").then((r) => r.json()).then((x) => { if (x.document) { setDoc(x.document); setSelected(x.document.commands[0]?.id ?? "robot"); } }).catch(() => undefined); }, []);

  const rows = useMemo(() => doc.commands.filter((c) => {
    if (phase && c.phase !== phase) return false;
    const n = q.trim().toLowerCase();
    return !n || [c.id, ...c.aliasesFa, ...c.aliasesEn, c.responseFa, c.responseEn].join(" ").toLowerCase().includes(n);
  }), [doc, phase, q]);

  const current = doc.commands.find((c) => c.id === selected) ?? rows[0] ?? null;

  function patchCommand(patch: Partial<StudioCommand>) {
    if (!current) return;
    setDoc((s) => ({ ...s, commands: s.commands.map((c) => c.id === current.id ? { ...c, ...patch } : c) }));
    setSaved(false);
  }

  async function save() {
    setSaving(true); setSaved(false);
    try {
      const res = await fetch("/api/bot/studio", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...doc, updatedAt: new Date().toISOString() }) });
      if (!res.ok) throw new Error("save failed");
      const body = await res.json();
      setDoc(body.document); setSaved(true);
    } finally { setSaving(false); }
  }

  return <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
    <Panel className="h-fit">
      <PanelTitle kicker={fa ? "مرکز فرمان" : "Command center"} title={fa ? "فاز و دستور" : "Phase & command"} />
      <div className="flex gap-1.5"><Filter active={phase===0} onClick={()=>setPhase(0)}>{fa?"همه":"All"}</Filter><Filter active={phase===1} onClick={()=>setPhase(1)}>01</Filter><Filter active={phase===2} onClick={()=>setPhase(2)}>02</Filter></div>
      <div className="relative mt-3"><Search className="pointer-events-none absolute start-2.5 top-2.5 size-3.5 text-subtle" /><Input value={q} onChange={(e)=>setQ(e.target.value)} className="ps-8" placeholder={fa?"جستجو...":"Search..."} /></div>
      <div className="mt-3 max-h-[60vh] space-y-1 overflow-y-auto">{rows.map((c)=><button key={c.id} type="button" onClick={()=>setSelected(c.id)} className={`w-full rounded-lg p-2.5 text-start ${selected===c.id?"bg-accent/12 shadow-[var(--shadow-border)]":"hover:bg-surface-2"}`}><div className="flex items-center justify-between"><span className="font-mono text-xs">{c.aliasesFa[0]||c.id}</span><span className={c.enabled?"size-1.5 rounded-full bg-ok":"size-1.5 rounded-full bg-danger"} /></div><p className="mt-1 text-[10px] text-muted">{c.id} · {fa?`فاز ${c.phase}`:`phase ${c.phase}`}</p></button>)}</div>
    </Panel>
    <div className="grid gap-4">
      {current ? <CommandEditor command={current} fa={fa} onPatch={patchCommand} /> : <Panel><p className="text-sm text-muted">{fa?"دستوری پیدا نشد.":"No command found."}</p></Panel>}
      <Panel><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-mono text-[10px] text-accent">PERSISTENCE</p><h3 className="mt-1 text-sm font-semibold">{fa?"ذخیره مستقیم در PostgreSQL":"Persist directly to PostgreSQL"}</h3><p className="mt-1 text-xs text-muted">{fa?"تغییرات ذخیره‌شده منبع اصلی تنظیمات هستند.":"Saved changes become the configuration source of truth."}</p></div><button type="button" onClick={save} disabled={saving} className="flex h-10 items-center gap-2 rounded-lg bg-fg px-4 text-xs font-semibold text-bg disabled:opacity-50">{saved?<Check className="size-3.5"/>:<Save className="size-3.5"/>}{saving?(fa?"در حال ذخیره...":"Saving..."):saved?(fa?"ذخیره شد":"Saved"):(fa?"ذخیره تغییرات":"Save changes")}</button></div></Panel>
    </div>
  </div>;
}

function CommandEditor({ command, fa, onPatch }: { command: StudioCommand; fa: boolean; onPatch: (p: Partial<StudioCommand>) => void }) {
  return <Panel>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-[10px] text-accent">{command.id} · PHASE {command.phase}</p><h2 className="mt-1 text-xl font-semibold">{fa?"ویرایش کامل دستور":"Full command editor"}</h2></div><button type="button" onClick={()=>onPatch({enabled:!command.enabled})} className="flex h-9 items-center gap-2 rounded-lg px-3 text-xs shadow-[var(--shadow-border)]"><ToggleLeft className="size-4"/>{command.enabled?(fa?"فعال":"Enabled"):(fa?"غیرفعال":"Disabled")}</button></div>
    <div className="mt-5 grid gap-4 xl:grid-cols-2">
      <EditorField label={fa?"نام‌های فارسی":"Persian aliases"}><Input value={command.aliasesFa.join(" ")} onChange={(e)=>onPatch({aliasesFa:e.target.value.split(/\s+/).filter(Boolean)})}/></EditorField>
      <EditorField label={fa?"نام‌های انگلیسی":"English aliases"}><Input dir="ltr" value={command.aliasesEn.join(" ")} onChange={(e)=>onPatch({aliasesEn:e.target.value.split(/\s+/).filter(Boolean)})}/></EditorField>
      <EditorField label={fa?"حداقل مقام":"Minimum rank"}><select value={command.minRank} onChange={(e)=>onPatch({minRank:e.target.value as StudioCommand["minRank"]})} className="h-9 rounded-md bg-surface-2 px-2 text-xs shadow-[var(--shadow-border)]"><option value="member">{fa?"عضو":"member"}</option><option value="admin">{fa?"ادمین":"admin"}</option><option value="owner">{fa?"مالک":"owner"}</option></select></EditorField>
      <EditorField label={fa?"قابلیت":"Capability"}><div className="flex h-9 items-center rounded-md bg-surface-2 px-3 text-xs"><Badge tone="accent">{command.capabilityId}</Badge></div></EditorField>
      <EditorField label={fa?"پاسخ فارسی":"Persian response"}><textarea value={command.responseFa} onChange={(e)=>onPatch({responseFa:e.target.value})} className="min-h-52 w-full resize-y rounded-lg bg-surface-2 p-3 text-sm leading-6 shadow-[var(--shadow-border)] outline-none focus:ring-1 focus:ring-accent/40"/></EditorField>
      <EditorField label={fa?"پاسخ انگلیسی":"English response"}><textarea dir="ltr" value={command.responseEn} onChange={(e)=>onPatch({responseEn:e.target.value})} className="min-h-52 w-full resize-y rounded-lg bg-surface-2 p-3 text-sm leading-6 shadow-[var(--shadow-border)] outline-none focus:ring-1 focus:ring-accent/40"/></EditorField>
    </div>
    <p className="mt-4 text-[11px] text-muted">{fa?"متغیرهای پویا مثل {{user_id}}، {{chat_title}} و {{rank}} در پاسخ قابل استفاده‌اند.":"Dynamic variables like {{user_id}}, {{chat_title}} and {{rank}} can be used in replies."}</p>
  </Panel>;
}

function EditorField({ label, children }: { label: string; children: ReactNode }) { return <label className="grid gap-1.5"><span className="text-[11px] text-muted">{label}</span>{children}</label>; }
function Filter({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) { return <button type="button" onClick={onClick} className={active?"h-8 rounded-md bg-fg px-3 text-[11px] font-medium text-bg":"h-8 rounded-md px-3 text-[11px] text-muted shadow-[var(--shadow-border)]"}>{children}</button>; }
