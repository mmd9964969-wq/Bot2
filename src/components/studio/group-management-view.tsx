import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, Search, Send, Shield, Users, XCircle } from "lucide-react";
import { Panel, PanelTitle } from "./panel";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

type GroupRow = {
  group_id:number;
  title:string;
  username?:string|null;
  chat_type:string;
  bot_status:string;
  telegram_status:string;
  member_count:number;
  admin_count:number;
  owner_name?:string|null;
  bot_can_delete:boolean;
  bot_can_restrict:boolean;
  license_type?:string|null;
  last_activity_at?:string|null;
  last_sync_at?:string|null;
};

type Overview = {
  total:number;
  active:number;
  disabled:number;
  restricted:number;
  error:number;
  left_groups:number;
  avg_members:number;
  total_members:number;
};

type ConfirmState = {
  token:string;
  operation:string;
  groupIds:number[];
  scope?:string;
};

const FILTERS = [
  {key:"ALL",fa:"همه"},
  {key:"ACTIVE",fa:"فعال"},
  {key:"DISABLED",fa:"غیرفعال"},
  {key:"RESTRICTED",fa:"محدود"},
  {key:"ERROR",fa:"خطا"},
  {key:"LEFT",fa:"خارج‌شده"},
] as const;

function labelStatus(value:string){
  const item = FILTERS.find((x) => x.key === value);
  return item?.fa ?? value;
}
function badgeTone(value:string): "ok"|"danger"|"warn"|"accent" {
  if(value === "ACTIVE") return "ok";
  if(value === "ERROR" || value === "LEFT") return "danger";
  if(value === "DISABLED") return "warn";
  return "accent";
}

export function GroupManagementView(){
  const [overview,setOverview] = useState<Overview|null>(null);
  const [rows,setRows] = useState<GroupRow[]>([]);
  const [selected,setSelected] = useState<GroupRow|null>(null);
  const [query,setQuery] = useState("");
  const [filter,setFilter] = useState("ALL");
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [resetScope,setResetScope] = useState("config");
  const [confirm,setConfirm] = useState<ConfirmState|null>(null);
  const [bulkIds,setBulkIds] = useState<number[]>([]);
  const [bulkOpen,setBulkOpen] = useState(false);
  const [sendOpen,setSendOpen] = useState(false);

  async function load(groupId?:number){
    setLoading(true);
    setError("");
    try{
      const url = groupId
        ? "/api/owner/groups?groupId="+encodeURIComponent(String(groupId))
        : "/api/owner/groups?status="+encodeURIComponent(filter === "ALL" ? "" : filter)+"&search="+encodeURIComponent(query)+"&page=1&limit=20";
      const response = await fetch(url,{cache:"no-store"});
      const data = await response.json();
      if(!response.ok) throw new Error(data.error || "خطا در دریافت اطلاعات");
      if(groupId){
        setSelected(data.group || null);
        return;
      }
      setOverview(data.overview || null);
      setRows(Array.isArray(data.rows) ? data.rows : []);
      if(selected && !(data.rows || []).some((x:GroupRow) => x.group_id === selected.group_id)) setSelected(null);
    }catch(err){
      setError(err instanceof Error ? err.message : "خطا در دریافت اطلاعات");
    }finally{
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [filter]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 350);
    return () => window.clearTimeout(timer);
  }, [query]);

  async function post(body:Record<string,unknown>, refresh=true){
    setBusy(true);
    setError("");
    setNotice("");
    try{
      const response = await fetch("/api/owner/groups",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify(body),
      });
      const data = await response.json();
      if(!response.ok) throw new Error(data.error || "عملیات انجام نشد");
      if(refresh){
        if(selected?.group_id) await load(selected.group_id);
        else await load();
      }
      setNotice("✓ عملیات با موفقیت انجام شد.");
      return data;
    }catch(err){
      setError(err instanceof Error ? err.message : "عملیات انجام نشد");
      throw err;
    }finally{
      setBusy(false);
    }
  }

  async function beginConfirm(operation:string,groupIds:number[],scope?:string){
    try{
      const data = await post({action:"confirm",operation,groupIds,scope},false);
      setConfirm({token:data.token,operation,groupIds,scope});
    }catch{}
  }

  async function executeConfirm(){
    if(!confirm) return;
    try{
      await post({
        action:"execute",
        token:confirm.token,
        operation:confirm.operation,
        groupIds:confirm.groupIds,
        scope:confirm.scope,
      });
      setConfirm(null);
      if(selected?.group_id) await load(selected.group_id);
      else await load();
      if(confirm.operation.startsWith("bulk_")) setBulkIds([]);
    }catch{}
  }

  async function refreshSelected(){
    if(!selected) return;
    try{
      const data = await post({action:"group_refresh",groupId:selected.group_id},false);
      setSelected(data.group || null);
      setNotice("✓ اطلاعات گروه بروزرسانی شد.");
    }catch{}
  }

  async function syncAll(){
    try{
      const data = await post({action:"sync"},false);
      setNotice("✓ Sync انجام شد · بررسی‌شده: "+Number(data.result?.checked || 0)+" · موفق: "+Number(data.result?.ok || 0)+" · ناموفق: "+Number(data.result?.failed || 0));
      await load(selected?.group_id);
      if(!selected?.group_id) await load();
    }catch{}
  }

  function toggleBulk(id:number){
    setBulkIds((current) => current.includes(id) ? current.filter((x) => x !== id) : [...current,id]);
  }

  const bulkRows = useMemo(() => rows, [rows]);

  return (
    <div className="grid gap-5">
      <section className="relative overflow-hidden rounded-2xl bg-surface p-5 shadow-[var(--shadow-panel)] ring-1 ring-line sm:p-7">
        <div className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-accent/10 blur-3xl" />
        <div className="pointer-events-none absolute -left-20 -bottom-24 size-56 rounded-full bg-ok/5 blur-3xl" />
        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Badge tone="accent">OWNER · GROUP CONTROL</Badge>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight">مدیریت گروه‌ها</h1>
              <p className="mt-2 max-w-3xl text-xs leading-6 text-muted">
                مرکز کنترل سراسری گروه‌های ربات؛ داده‌های PostgreSQL و وضعیت لحظه‌ای Telegram در یک مسیر مشترک.
              </p>
            </div>
            <button type="button" onClick={() => void syncAll()} disabled={busy} className="flex h-9 items-center gap-2 rounded-xl px-3 text-xs text-muted ring-1 ring-line hover:text-fg disabled:opacity-40">
              <RefreshCw className="size-3.5" /> همگام‌سازی
            </button>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["کل",overview?.total || 0,"accent"],
              ["فعال",overview?.active || 0,"ok"],
              ["غیرفعال",overview?.disabled || 0,"warn"],
              ["محدود",overview?.restricted || 0,"accent"],
              ["خطا",overview?.error || 0,"danger"],
              ["خارج‌شده",overview?.left_groups || 0,"danger"],
            ].map(([name,value]) => (
              <div key={String(name)} className="rounded-xl bg-bg p-3 ring-1 ring-line">
                <p className="text-[10px] text-muted">{name}</p>
                <p className="mt-1 font-mono text-lg">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {(error || notice) && (
        <div className="grid gap-2">
          {error && <div className="rounded-xl bg-danger/10 p-3 text-xs text-danger ring-1 ring-danger/20">{error}</div>}
          {notice && <div className="rounded-xl bg-ok/10 p-3 text-xs text-ok ring-1 ring-ok/20">{notice}</div>}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[20rem_1fr]">
        <Panel className="h-fit lg:sticky lg:top-28">
          <PanelTitle kicker="GROUPS" title="فهرست گروه‌ها" hint={overview ? "میانگین اعضا: "+Number(overview.avg_members || 0).toFixed(1)+" · مجموع اعضا: "+Number(overview.total_members || 0) : ""} />
          <div className="relative">
            <Search className="pointer-events-none absolute start-2.5 top-2.5 size-3.5 text-subtle" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} className="ps-8" placeholder="جستجوی نام، شناسه یا username..." />
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {FILTERS.map((item) => (
              <button type="button" key={item.key} onClick={() => setFilter(item.key)} className={filter === item.key ? "h-8 rounded-lg bg-fg px-3 text-[10px] font-medium text-bg" : "h-8 rounded-lg px-3 text-[10px] text-muted ring-1 ring-line"}>
                {item.fa}
              </button>
            ))}
          </div>
          <div className="mt-4 max-h-[58vh] space-y-1 overflow-y-auto pe-1">
            {loading && !rows.length ? (
              <p className="p-3 text-xs text-muted">در حال دریافت...</p>
            ) : rows.map((group) => (
              <button type="button" key={group.group_id} onClick={() => void load(group.group_id)} className={"w-full rounded-xl p-3 text-start transition-all "+(selected?.group_id === group.group_id ? "bg-accent/10 ring-1 ring-accent/30" : "hover:bg-surface-2")}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium">{group.title || "گروه بدون نام"}</span>
                  <span className={group.bot_status === "ACTIVE" ? "size-1.5 rounded-full bg-ok" : group.bot_status === "ERROR" || group.bot_status === "LEFT" ? "size-1.5 rounded-full bg-danger" : "size-1.5 rounded-full bg-warn"} />
                </div>
                <p className="mt-1 font-mono text-[9px] text-subtle">{group.group_id}</p>
              </button>
            ))}
            {!loading && !rows.length && <p className="p-3 text-xs text-muted">گروهی پیدا نشد.</p>}
          </div>
        </Panel>

        <div className="grid gap-5">
          {!selected ? (
            <Panel>
              <div className="grid gap-2 sm:grid-cols-3">
                <Metric icon={Users} label="مجموع اعضا" value={String(overview?.total_members || 0)} />
                <Metric icon={Activity} label="میانگین اعضا" value={Number(overview?.avg_members || 0).toFixed(1)} />
                <Metric icon={Shield} label="گروه‌های فعال" value={String(overview?.active || 0)} />
              </div>
              <div className="mt-5 rounded-xl bg-surface-2 p-4 ring-1 ring-line">
                <p className="font-mono text-[9px] text-accent">OWNER CONTROL</p>
                <h2 className="mt-2 text-sm font-semibold">یک گروه را انتخاب کنید.</h2>
                <p className="mt-1 text-xs leading-6 text-muted">وضعیت واقعی، آمار، سلامت، لاگ و عملیات حساس همان گروه در این بخش نمایش داده می‌شود.</p>
              </div>
            </Panel>
          ) : (
            <>
              <Panel>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-[9px] text-accent">GROUP · {selected.group_id}</p>
                    <h2 className="mt-1 text-xl font-semibold">{selected.title || "گروه بدون نام"}</h2>
                    <p className="mt-1 text-xs text-muted">{selected.username ? "@"+selected.username+" · " : ""}{labelStatus(selected.bot_status)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={badgeTone(selected.bot_status)}>{labelStatus(selected.bot_status)}</Badge>
                    <button type="button" onClick={() => void refreshSelected()} disabled={busy} className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[10px] text-muted ring-1 ring-line hover:text-fg">
                      <RefreshCw className="size-3.5" /> بروزرسانی
                    </button>
                  </div>
                </div>
                <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <Stat label="اعضا" value={String(selected.member_count)} />
                  <Stat label="مدیران" value={String(selected.admin_count)} />
                  <Stat label="مالک گروه" value={selected.owner_name || "—"} />
                  <Stat label="وضعیت Telegram" value={selected.telegram_status || "—"} />
                  <Stat label="حذف پیام" value={selected.bot_can_delete ? "✓ مجاز" : "✗"} />
                  <Stat label="محدودسازی" value={selected.bot_can_restrict ? "✓ مجاز" : "✗"} />
                  <Stat label="لایسنس" value={selected.license_type || "—"} />
                  <Stat label="آخرین Sync" value={selected.last_sync_at ? new Date(selected.last_sync_at).toLocaleString("fa-IR") : "—"} />
                </div>
              </Panel>

              <Panel>
                <PanelTitle kicker="ACTIONS" title="کنترل گروه" hint="عملیات عادی و حساس از یکدیگر جدا شده‌اند." />
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  <Action label="فعال‌سازی" icon={CheckCircle2} tone="ok" disabled={selected.bot_status === "ACTIVE" || busy} onClick={() => void post({action:"enable",groupId:selected.group_id})} />
                  <Action label="غیرفعال‌سازی" icon={XCircle} tone="danger" disabled={selected.bot_status !== "ACTIVE" || busy} onClick={() => void beginConfirm("disable",[selected.group_id])} />
                  <Action label="ریست ربات" icon={RefreshCw} tone="danger" disabled={busy} onClick={() => void beginConfirm("reset",[selected.group_id],resetScope)} />
                  <Action label="ارسال پیام" icon={Send} tone="accent" disabled={busy} onClick={() => setSendOpen((value) => !value)} />
                  <Action label="خروج ربات" icon={AlertTriangle} tone="danger" disabled={selected.bot_status === "LEFT" || busy} onClick={() => void beginConfirm("leave",[selected.group_id])} />
                </div>
                <div className="mt-4 grid gap-3 rounded-xl bg-surface-2 p-4 ring-1 ring-line md:grid-cols-[1fr_auto] md:items-end">
                  <label className="grid gap-1.5">
                    <span className="text-[10px] text-muted">نوع ریست</span>
                    <select value={resetScope} onChange={(event) => setResetScope(event.target.value)} className="h-10 rounded-xl bg-bg px-3 text-xs ring-1 ring-line outline-none">
                      <option value="config">تنظیمات</option>
                      <option value="locks">قفل‌ها</option>
                      <option value="warnings">اخطارها</option>
                      <option value="messages">پیام‌ها</option>
                      <option value="management">مدیریت</option>
                      <option value="full">ریست کامل</option>
                    </select>
                  </label>
                  <button type="button" disabled={busy} onClick={() => void beginConfirm("reset",[selected.group_id],resetScope)} className="h-10 rounded-xl bg-danger/10 px-4 text-xs font-medium text-danger ring-1 ring-danger/20">
                    تأیید دو مرحله‌ای ریست
                  </button>
                </div>
                {sendOpen && <SendBox groupId={selected.group_id} busy={busy} onDone={() => setSendOpen(false)} />}
              </Panel>

              <Panel>
                <PanelTitle kicker="GROUP AUDIT" title="لاگ گروه" hint="آخرین عملیات ثبت‌شده در این مرکز" />
                <GroupLogs groupId={selected.group_id} />
              </Panel>
            </>
          )}
        </div>
      </div>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[9px] text-accent">BULK CONTROL</p>
            <h3 className="mt-1 text-sm font-semibold">عملیات گروهی</h3>
            <p className="mt-1 text-xs text-muted">انتخاب چند گروه و اجرای عملیات حساس با تأیید دو مرحله‌ای.</p>
          </div>
          <button type="button" onClick={() => setBulkOpen((value) => !value)} className="h-9 rounded-xl px-3 text-xs text-muted ring-1 ring-line">{bulkOpen ? "بستن" : "بازکردن"}</button>
        </div>
        {bulkOpen && (
          <div className="mt-4 grid gap-3">
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {bulkRows.map((group) => (
                <button type="button" key={group.group_id} onClick={() => toggleBulk(group.group_id)} className={"flex w-full items-center justify-between rounded-xl p-3 text-start text-xs ring-1 "+(bulkIds.includes(group.group_id) ? "bg-accent/10 ring-accent/30" : "bg-surface-2 ring-line")}>
                  <span>{bulkIds.includes(group.group_id) ? "✓" : "□"} {group.title || "گروه"}</span>
                  <span className="font-mono text-[9px] text-subtle">{group.group_id}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="me-auto text-[10px] text-muted">انتخاب‌شده: {bulkIds.length}</span>
              <button type="button" disabled={!bulkIds.length || busy} onClick={() => void beginConfirm("bulk_disable",bulkIds)} className="h-9 rounded-xl bg-danger/10 px-3 text-xs text-danger ring-1 ring-danger/20">غیرفعال‌سازی</button>
              <button type="button" disabled={!bulkIds.length || busy} onClick={() => void beginConfirm("bulk_leave",bulkIds)} className="h-9 rounded-xl bg-danger/10 px-3 text-xs text-danger ring-1 ring-danger/20">خروج</button>
            </div>
          </div>
        )}
      </Panel>

      {confirm && <ConfirmDialog confirm={confirm} busy={busy} onConfirm={() => void executeConfirm()} onCancel={() => setConfirm(null)} />}
    </div>
  );
}

function Metric({icon:Icon,label,value}:{icon:typeof Users;label:string;value:string}){
  return (
    <div className="rounded-xl bg-bg p-4 ring-1 ring-line">
      <Icon className="size-4 text-accent" />
      <p className="mt-3 text-[10px] text-muted">{label}</p>
      <p className="mt-1 font-mono text-lg">{value}</p>
    </div>
  );
}
function Stat({label,value}:{label:string;value:string}){
  return (
    <div className="rounded-xl bg-bg p-3 ring-1 ring-line">
      <p className="text-[10px] text-muted">{label}</p>
      <p className="mt-1 truncate text-xs font-medium">{value}</p>
    </div>
  );
}
function Action({label,icon:Icon,tone,disabled,onClick}:{label:string;icon:typeof RefreshCw;tone:"ok"|"danger"|"accent";disabled:boolean;onClick:()=>void}){
  const klass = tone==="ok" ? "bg-ok/10 text-ok ring-ok/20" : tone==="danger" ? "bg-danger/10 text-danger ring-danger/20" : "bg-accent/10 text-accent ring-accent/20";
  return <button type="button" disabled={disabled} onClick={onClick} className={"flex h-10 items-center justify-center gap-2 rounded-xl text-xs font-medium ring-1 hover:opacity-90 disabled:opacity-40 "+klass}><Icon className="size-3.5" />{label}</button>;
}
function ConfirmDialog({confirm,busy,onConfirm,onCancel}:{confirm:ConfirmState;busy:boolean;onConfirm:()=>void;onCancel:()=>void}){
  const isLeave = confirm.operation.includes("leave");
  const title = isLeave ? "خروج ربات" : confirm.operation.includes("reset") ? "ریست ربات" : "غیرفعال‌سازی";
  const count = confirm.groupIds.length;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-surface p-6 shadow-[var(--shadow-panel)] ring-1 ring-line">
        <Badge tone="warn">CONFIRMATION · 02 STEP</Badge>
        <h3 className="mt-3 text-lg font-semibold">{title}</h3>
        <p className="mt-2 text-xs leading-6 text-muted">مرحله اول انجام شد. این تأیید نهایی مرحله دوم است و برای {count} گروه اجرا می‌شود.</p>
        <div className="mt-4 rounded-xl bg-danger/10 p-4 text-xs leading-6 text-danger">تمام عملیات انجام‌شده در Audit Log ثبت خواهند شد.</div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="h-10 rounded-xl px-4 text-xs text-muted ring-1 ring-line">لغو</button>
          <button type="button" disabled={busy} onClick={onConfirm} className="h-10 rounded-xl bg-danger px-4 text-xs font-semibold text-white disabled:opacity-50">تأیید نهایی</button>
        </div>
      </div>
    </div>
  );
}
function SendBox({groupId,busy,onDone}:{groupId:number;busy:boolean;onDone:()=>void}){
  const [value,setValue]=useState("");
  const [error,setError]=useState("");
  async function submit(){
    setError("");
    try{
      const response=await fetch("/api/owner/groups",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({action:"send",groupId,text:value}),
      });
      const data=await response.json();
      if(!response.ok) throw new Error(data.error || "ارسال ناموفق بود");
      setValue("");
      onDone();
    }catch(err){setError(err instanceof Error ? err.message : "ارسال ناموفق بود");}
  }
  return (
    <div className="mt-4 rounded-xl bg-bg p-4 ring-1 ring-line">
      <p className="text-[10px] text-muted">پیام متنی برای گروه</p>
      <textarea value={value} onChange={(event) => setValue(event.target.value)} className="mt-2 min-h-28 w-full resize-y rounded-xl bg-surface p-3 text-xs leading-6 outline-none ring-1 ring-line focus:ring-accent/40" placeholder="متن پیام..." />
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <div className="mt-2 flex justify-end">
        <button type="button" onClick={() => void submit()} disabled={busy || !value.trim()} className="flex h-9 items-center gap-2 rounded-xl bg-fg px-3 text-xs font-semibold text-bg disabled:opacity-40"><Send className="size-3.5" /> ارسال</button>
      </div>
    </div>
  );
}
function GroupLogs({groupId}:{groupId:number}){
  const [logs,setLogs]=useState<any[]>([]);
  useEffect(() => {
    fetch("/api/owner/groups?groupId="+encodeURIComponent(String(groupId)),{cache:"no-store"})
      .then((response)=>response.json())
      .then((data)=>setLogs(Array.isArray(data.logs) ? data.logs : []))
      .catch(()=>undefined);
  },[groupId]);
  if(!logs.length) return <p className="text-xs text-muted">لاگی ثبت نشده است.</p>;
  return (
    <div className="space-y-1">
      {logs.slice(0,15).map((item) => (
        <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2 p-3 text-[10px]">
          <span>{String(item.action || "event")}</span>
          <span className="text-muted">{String(item.result || "—")} · {new Date(item.created_at).toLocaleString("fa-IR")}</span>
        </div>
      ))}
    </div>
  );
}
