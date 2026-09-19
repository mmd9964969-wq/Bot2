import { useEffect, useState } from "react";
import { Check, Save } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cloneStudioDefaults, type StudioDocument } from "@/lib/bot/studio";
import { useStudio } from "@/store/studio";
import { Panel, PanelTitle } from "./panel";

export function ConfigView() {
  const fa = useStudio((s) => s.uiLang) === "fa";
  const [doc, setDoc] = useState<StudioDocument>(() => cloneStudioDefaults());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { fetch("/api/bot/studio").then((r) => r.json()).then((x) => x.document && setDoc(x.document)).catch(() => undefined); }, []);

  function patchCapability(id: string, enabled: boolean) {
    setDoc((s) => ({ ...s, capabilities: s.capabilities.map((c) => c.id === id ? { ...c, enabled } : c) }));
    setSaved(false);
  }

  async function save() {
    setSaving(true); setSaved(false);
    try {
      const res = await fetch("/api/bot/studio", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...doc, updatedAt: new Date().toISOString() }) });
      if (!res.ok) throw new Error("save failed");
      const body = await res.json(); setDoc(body.document); setSaved(true);
    } finally { setSaving(false); }
  }

  return <div className="grid gap-4">
    <Panel>
      <PanelTitle kicker={fa ? "فازها" : "Phases"} title={fa ? "پنج فاز فعال ربات" : "Five live phases in the bot"} hint={fa ? "قابلیت‌ها در پنل جزئی‌تر دسته‌بندی می‌شوند، اما خروجی ربات فقط فاز ۱ و ۲ دارد." : "Capabilities are granular in the panel, while the bot exposes only phases 1 and 2."} />
      <div className="grid gap-3 md:grid-cols-2">
        {[1,2].map((phase) => {
          const items = doc.capabilities.filter((c) => c.phase === phase);
          return <div key={phase} className="rounded-xl bg-surface-2 p-4">
            <div className="flex items-center justify-between"><div><p className="font-mono text-[10px] text-accent">{phase === 1 ? "PHASE 01" : "PHASE 02"}</p><h3 className="mt-1 text-base font-semibold">{phase === 1 ? (fa ? "هسته و وضعیت" : "Core & status") : (fa ? "مدیریت و حفاظت" : "Management & protection")}</h3></div><Badge tone={phase===1?"ok":"warn"}>{items.length}</Badge></div>
            <div className="mt-3 space-y-1.5">{items.map((c) => <label key={c.id} className="flex cursor-pointer items-center justify-between rounded-lg bg-bg p-2.5"><span><span className="block text-xs font-medium">{fa?c.titleFa:c.titleEn}</span><span className="text-[10px] text-muted">{fa?c.descriptionFa:c.descriptionEn}</span></span><input type="checkbox" checked={c.enabled} onChange={(e)=>patchCapability(c.id,e.target.checked)} /></label>)}</div>
          </div>;
        })}
      </div>
    </Panel>

    <div className="grid gap-4 lg:grid-cols-2">
      <Panel>
        <PanelTitle kicker="GLOBAL" title={fa ? "تنظیمات اجرایی" : "Runtime settings"} />
        <div className="grid gap-3">
          <label className="grid gap-1.5"><span className="text-[11px] text-muted">{fa?"نام نمایشی بات":"Bot display name"}</span><Input value={doc.settings.botName} onChange={(e)=>{setDoc((s)=>({...s,settings:{...s.settings,botName:e.target.value}}));setSaved(false);}} /></label>
          <label className="grid gap-1.5"><span className="text-[11px] text-muted">{fa?"زبان پیش‌فرض":"Default language"}</span><select value={doc.settings.defaultLang} onChange={(e)=>{setDoc((s)=>({...s,settings:{...s.settings,defaultLang:e.target.value as "fa"|"en"}}));setSaved(false);}} className="h-9 rounded-md bg-surface-2 px-2 text-xs shadow-[var(--shadow-border)]"><option value="fa">fa</option><option value="en">en</option></select></label>
          <div className="flex flex-wrap gap-2"><button type="button" onClick={()=>{setDoc((s)=>({...s,settings:{...s.settings,bareCommands:!s.settings.bareCommands}}));setSaved(false);}} className={doc.settings.bareCommands?"h-8 rounded-md bg-fg px-3 text-xs text-bg":"h-8 rounded-md px-3 text-xs text-muted shadow-[var(--shadow-border)]"}>{fa?"دستور بدون /":"Bare commands"}</button><button type="button" onClick={()=>{setDoc((s)=>({...s,settings:{...s.settings,compactReplies:!s.settings.compactReplies}}));setSaved(false);}} className={doc.settings.compactReplies?"h-8 rounded-md bg-fg px-3 text-xs text-bg":"h-8 rounded-md px-3 text-xs text-muted shadow-[var(--shadow-border)]"}>{fa?"پاسخ فشرده":"Compact replies"}</button></div>
        </div>
      </Panel>
      <Panel>
        <PanelTitle kicker="PERSISTENCE" title={fa ? "اعمال تنظیمات" : "Apply configuration"} hint={fa ? "همه تغییرات این صفحه و صفحه دستورات در PostgreSQL ذخیره می‌شوند." : "Changes from this page and Commands are persisted in PostgreSQL."} />
        <button type="button" onClick={save} disabled={saving} className="flex h-10 items-center gap-2 rounded-lg bg-fg px-4 text-xs font-semibold text-bg disabled:opacity-50">{saved?<Check className="size-3.5"/>:<Save className="size-3.5" />}{saving?(fa?"در حال ذخیره...":"Saving..."):saved?(fa?"ذخیره شد":"Saved"):(fa?"ذخیره تغییرات":"Save changes")}</button>
      </Panel>
    </div>
  </div>;
}
