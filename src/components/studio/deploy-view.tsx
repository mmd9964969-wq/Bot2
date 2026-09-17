import { ENV_KEYS } from "@/lib/bot/defaults";
import { useStudio } from "@/store/studio";
import { Panel, PanelTitle } from "./panel";

const STEPS = [
  {
    fa: "ریپو روی GitHub — همین پروژه، بدون فایل توکن",
    en: "GitHub repo — this project, no token files",
  },
  {
    fa: "Railway → New Project → Deploy from GitHub",
    en: "Railway → New Project → Deploy from GitHub",
  },
  {
    fa: "Start Command را بگذار: node --experimental-strip-types bot/main.ts",
    en: "Set start command: node --experimental-strip-types bot/main.ts",
  },
  {
    fa: "Variables: BOT_TOKEN و OWNER_IDS",
    en: "Variables: BOT_TOKEN and OWNER_IDS",
  },
  {
    fa: "بات را در گروه ادمین کن با حق Ban و Restrict و Delete",
    en: "Promote the bot with Ban, Restrict, Delete",
  },
  {
    fa: "در گروه بزن /پینگ — اگر پونگ آمد هسته زنده‌ست",
    en: "In the group send /ping — pong means core is live",
  },
];

export function DeployView() {
  const fa = useStudio((s) => s.uiLang) === "fa";
  const config = useStudio((s) => s.config);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel>
        <PanelTitle
          kicker="GitHub · Railway"
          title={fa ? "استقرار فاز ۱" : "Phase 1 deploy"}
          hint={
            fa
              ? "توکن را در چت نفرست. BotFather را هم رد کردیم — بات را داری."
              : "Do not paste the token in chat. BotFather is skipped — you already have the bot."
          }
        />
        <ol className="space-y-2">
          {STEPS.map((s, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="font-mono text-[11px] text-accent">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-xs leading-snug">{fa ? s.fa : s.en}</span>
            </li>
          ))}
        </ol>
      </Panel>
      <Panel>
        <PanelTitle
          title={fa ? "نمونه متغیر" : "Sample variables"}
        />
        <pre
          dir="ltr"
          className="overflow-x-auto rounded-md bg-bg p-2.5 font-mono text-[11px] leading-snug"
        >
{`BOT_TOKEN=
OWNER_IDS=${config.ownerIds.join(",") || "YOUR_TELEGRAM_ID"}
DEFAULT_LANG=${config.defaultLang}
PREFIXES=${config.prefixes.join("")}
BOT_NAME=${config.botName}`}
        </pre>
        <ul className="mt-3 space-y-1">
          {ENV_KEYS.map((k) => (
            <li key={k.key} className="text-[11px] leading-snug text-muted">
              <span className="font-mono text-fg">{k.key}</span>
              {" — "}
              {fa ? k.fa : k.en}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs leading-snug text-muted">
          {fa
            ? "آیدی عددی خودت را از @userinfobot بگیر و در OWNER_IDS بگذار. فاز ۲ بعد از تأیید واژه‌ها."
            : "Get your numeric id from @userinfobot into OWNER_IDS. Phase 2 after you confirm wording."}
        </p>
      </Panel>
    </div>
  );
}
