import { PHASES } from "@/lib/bot/registry";
import { useStudio } from "@/store/studio";
import { KeyRow, Panel, PanelTitle } from "./panel";

const EDIT_POINTS = [
  {
    file: "src/lib/bot/defaults.ts",
    fa: "نام بات، پیشوند / ! . ، زبان پیش‌فرض، آیدی مالک",
    en: "Bot name, prefixes, default language, owner ids",
  },
  {
    file: "src/lib/bot/registry.ts",
    fa: "مستعار فارسی/انگلیسی هر دستور — اگر در گروهت «میوت» می‌گن نه «سکوت»",
    en: "FA/EN aliases per command — change community slang here",
  },
  {
    file: "src/lib/bot/engine.ts",
    fa: "منطق پارس و متن پاسخ‌های فاز ۱. فاصله خطوط پاسخ‌ها همین‌جا کم است",
    en: "Parser + phase-1 reply text. Replies stay compact here",
  },
  {
    file: "Railway env",
    fa: "BOT_TOKEN و OWNER_IDS — توکن را در کد نگذار",
    en: "BOT_TOKEN and OWNER_IDS — never commit the token",
  },
];

export function OverviewView() {
  const fa = useStudio((s) => s.uiLang) === "fa";
  const setView = useStudio((s) => s.setView);

  return (
    <div className="grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
      <Panel>
        <PanelTitle
          kicker={fa ? "۰۱ · فاز ۱" : "01 · phase 1"}
          title={fa ? "هسته بات، بدون شلوغی" : "Bot core, nothing extra"}
          hint={
            fa
              ? "الان فقط اسکلت کار می‌کند: تشخیص دستور فارسی و انگلیسی، سطح دسترسی، پاسخ فشرده. بن و سکوت فاز ۲ است."
              : "Only the skeleton is live: FA/EN command matching, ranks, compact replies. Ban/mute land in phase 2."
          }
        />
        <div className="space-y-0">
          <KeyRow
            label={fa ? "موتور" : "engine"}
            value={fa ? "یک پارس برای فا و en" : "one parser for fa + en"}
          />
          <KeyRow
            label={fa ? "پیشوند" : "prefix"}
            value="/  !  ."
            mono
          />
          <KeyRow
            label={fa ? "رتبه" : "ranks"}
            value={fa ? "مالک > سودو > ادمین > عضو" : "owner > sudo > admin > member"}
          />
          <KeyRow
            label={fa ? "دستورات زنده" : "live commands"}
            value={
              fa
                ? "استارت، راهنما، پینگ، آیدی، اطلاعات، زبان، مدیران، تنظیمات"
                : "start help ping id info lang staff settings"
            }
          />
        </div>
        <p className="mt-3 text-xs leading-snug text-muted">
          {fa
            ? "اصطلاح گروه تلگرام با فارسی رسمی فرق دارد؛ هر دو ثبت شده. اگر واژه‌ای کم است از تب دستورات اضافه کن."
            : "Telegram slang and formal Persian both register. Add a missing word in Commands."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="h-9 rounded-md bg-fg px-3 text-xs font-medium text-bg"
            onClick={() => setView("sim")}
          >
            {fa ? "تست در شبیه‌ساز" : "Try the simulator"}
          </button>
          <button
            type="button"
            className="h-9 rounded-md px-3 text-xs font-medium text-fg shadow-[var(--shadow-border)]"
            onClick={() => setView("commands")}
          >
            {fa ? "واژه‌ها را چک کن" : "Review wording"}
          </button>
        </div>
      </Panel>

      <Panel>
        <PanelTitle
          kicker={fa ? "۰۲ · دستی عوض کن" : "02 · edit by hand"}
          title={fa ? "کجا را تغییر بدهی" : "Where to change things"}
          hint={
            fa
              ? "قبل از فاز ۲ همین چهار نقطه را مرور کن."
              : "Review these four points before phase 2."
          }
        />
        <ul className="space-y-2">
          {EDIT_POINTS.map((row) => (
            <li key={row.file} className="rounded-md bg-surface-2 px-2.5 py-2">
              <p className="font-mono text-[11px] text-accent">{row.file}</p>
              <p className="text-xs leading-snug text-muted">{fa ? row.fa : row.en}</p>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel className="lg:col-span-2">
        <PanelTitle
          kicker={fa ? "۰۳ · نقشه فازها" : "03 · phases"}
          title={fa ? "قسمت به قسمت" : "Built in parts"}
        />
        <ol className="grid gap-2 sm:grid-cols-5">
          {PHASES.map((p) => (
            <li
              key={p.id}
              className={
                p.id === 1
                  ? "rounded-lg bg-accent/12 p-2.5 shadow-[var(--shadow-border)]"
                  : "rounded-lg bg-surface-2 p-2.5"
              }
            >
              <p className="font-mono text-[10px] text-subtle">
                {fa ? `فاز ${p.id}` : `Phase ${p.id}`}
              </p>
              <p className="text-sm font-medium leading-tight">
                {fa ? p.fa : p.en}
              </p>
              <p className="mt-1 text-[11px] leading-snug text-muted">
                {fa ? p.blurbFa : p.blurbEn}
              </p>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
