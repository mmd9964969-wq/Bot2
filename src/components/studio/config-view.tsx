import type { ReactNode } from "react";
import { ENV_KEYS } from "@/lib/bot/defaults";
import { Input } from "@/components/ui/input";
import { useStudio } from "@/store/studio";
import { Panel, PanelTitle } from "./panel";

export function ConfigView() {
  const fa = useStudio((s) => s.uiLang) === "fa";
  const config = useStudio((s) => s.config);
  const patch = useStudio((s) => s.patchConfig);
  const reset = useStudio((s) => s.resetAll);

  const envPreview = [
    `BOT_TOKEN=`,
    `OWNER_IDS=${config.ownerIds.join(",")}`,
    `DEFAULT_LANG=${config.defaultLang}`,
    `PREFIXES=${config.prefixes.join("")}`,
    `BOT_NAME=${config.botName}`,
  ].join("\n");

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel>
        <PanelTitle
          kicker={fa ? "defaults.ts" : "defaults.ts"}
          title={fa ? "تنظیمات هسته" : "Core settings"}
          hint={
            fa
              ? "این مقادیر در شبیه‌ساز همین‌جا اعمال می‌شوند. روی Railway از env می‌آیند."
              : "Studio uses these live. Railway reads the same keys from env."
          }
        />
        <div className="grid gap-2.5">
          <Field label={fa ? "نام بات" : "Bot name"}>
            <Input
              value={config.botName}
              onChange={(e) => patch({ botName: e.target.value })}
            />
          </Field>
          <Field label={fa ? "یوزرنیم بدون @" : "Username without @"}>
            <Input
              dir="ltr"
              className="font-mono"
              value={config.botUsername}
              onChange={(e) => patch({ botUsername: e.target.value.replace(/^@/, "") })}
            />
          </Field>
          <Field label={fa ? "پیشوندها" : "Prefixes"}>
            <Input
              dir="ltr"
              className="font-mono"
              value={config.prefixes.join(" ")}
              onChange={(e) =>
                patch({
                  prefixes: e.target.value.split(/\s+/).filter(Boolean),
                })
              }
            />
          </Field>
          <Field label={fa ? "آیدی مالک‌ها" : "Owner ids"}>
            <Input
              dir="ltr"
              className="font-mono"
              value={config.ownerIds.join(",")}
              onChange={(e) =>
                patch({
                  ownerIds: e.target.value
                    .split(/[,\s]+/)
                    .map((x) => x.trim())
                    .filter(Boolean),
                })
              }
            />
          </Field>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => patch({ defaultLang: "fa" })}
              className={chip(config.defaultLang === "fa")}
            >
              fa
            </button>
            <button
              type="button"
              onClick={() => patch({ defaultLang: "en" })}
              className={chip(config.defaultLang === "en")}
            >
              en
            </button>
            <button
              type="button"
              onClick={() =>
                patch({ ignoreUnknownInGroups: !config.ignoreUnknownInGroups })
              }
              className={chip(config.ignoreUnknownInGroups)}
            >
              {fa ? "سکوت روی دستور ناشناس" : "silent unknown"}
            </button>
          </div>
          <button
            type="button"
            onClick={reset}
            className="h-9 justify-self-start rounded-md px-3 text-xs text-muted shadow-[var(--shadow-border)] hover:text-fg"
          >
            {fa ? "بازگشت به پیش‌فرض" : "Reset defaults"}
          </button>
        </div>
      </Panel>

      <Panel>
        <PanelTitle
          kicker="Railway"
          title={fa ? "متغیرهای محیط" : "Environment keys"}
          hint={
            fa
              ? "توکن را فقط در Railway Variables بگذار."
              : "Put the token only in Railway Variables."
          }
        />
        <ul className="mb-3 space-y-1.5">
          {ENV_KEYS.map((k) => (
            <li key={k.key} className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-[11px] text-accent">{k.key}</span>
              <span className="text-[11px] leading-snug text-muted">
                {fa ? k.fa : k.en}
                {k.need ? (fa ? " · لازم" : " · required") : ""}
              </span>
            </li>
          ))}
        </ul>
        <pre
          dir="ltr"
          className="overflow-x-auto rounded-md bg-bg p-2.5 font-mono text-[11px] leading-snug text-fg"
        >
          {envPreview}
        </pre>
      </Panel>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] text-muted">{label}</span>
      {children}
    </label>
  );
}

function chip(on: boolean) {
  return [
    "h-8 rounded-md px-2.5 text-xs",
    on ? "bg-fg text-bg" : "text-muted shadow-[var(--shadow-border)]",
  ].join(" ");
}
