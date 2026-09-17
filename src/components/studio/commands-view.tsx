import { useMemo, useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { COMMANDS, type Phase } from "@/lib/bot/registry";
import { useStudio } from "@/store/studio";
import { Panel, PanelTitle } from "./panel";

export function CommandsView() {
  const fa = useStudio((s) => s.uiLang) === "fa";
  const overrides = useStudio((s) => s.aliasOverrides);
  const setAliases = useStudio((s) => s.setAliases);
  const [q, setQ] = useState("");
  const [phase, setPhase] = useState<Phase | 0>(0);

  const rows = useMemo(() => {
    const query = q.trim();
    return COMMANDS.filter((c) => {
      if (phase && c.phase !== phase) return false;
      if (!query) return true;
      const blob = [
        c.id,
        ...c.aliasesEn,
        ...c.aliasesFa,
        c.descFa,
        c.descEn,
        ...(overrides[c.id]?.en ?? []),
        ...(overrides[c.id]?.fa ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return blob.includes(query.toLowerCase());
    });
  }, [q, phase, overrides]);

  return (
    <div className="grid gap-3">
      <Panel>
        <PanelTitle
          kicker="registry.ts"
          title={fa ? "واژه‌نامه فا / en" : "FA / EN dictionary"}
          hint={
            fa
              ? "مستعار را با فاصله بنویس. ذخیره محلی است تا واژه‌ها را قبل از فاز بعد قفل کنیم."
              : "Space-separated aliases. Saved locally so wording is locked before the next phase."
          }
        />
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={fa ? "جستجو بن، سکوت، warn…" : "Search ban, mute, اخطار…"}
            className="max-w-xs"
          />
          <FilterChip on={phase === 0} onClick={() => setPhase(0)}>
            {fa ? "همه" : "all"}
          </FilterChip>
          {([1, 2, 3, 4, 5] as Phase[]).map((p) => (
            <FilterChip key={p} on={phase === p} onClick={() => setPhase(p)}>
              {fa ? `فاز ${p}` : `p${p}`}
            </FilterChip>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-start text-xs">
            <thead>
              <tr className="border-b border-line text-subtle">
                <th className="py-1.5 pe-2 font-medium">{fa ? "دستور" : "id"}</th>
                <th className="py-1.5 pe-2 font-medium">EN</th>
                <th className="py-1.5 pe-2 font-medium">{fa ? "فارسی" : "FA"}</th>
                <th className="py-1.5 font-medium">{fa ? "وضعیت" : "status"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const en = (overrides[c.id]?.en ?? c.aliasesEn).join(" ");
                const faA = (overrides[c.id]?.fa ?? c.aliasesFa).join(" ");
                return (
                  <tr key={c.id} className="border-b border-line align-top">
                    <td className="py-2 pe-2">
                      <p className="font-mono text-[11px]">{c.id}</p>
                      <p className="text-[11px] leading-snug text-muted">
                        {fa ? c.descFa : c.descEn}
                      </p>
                    </td>
                    <td className="py-1.5 pe-2">
                      <Input
                        dir="ltr"
                        className="h-8 font-mono text-[11px]"
                        value={en}
                        onChange={(e) =>
                          setAliases(
                            c.id,
                            "en",
                            e.target.value.split(/\s+/).filter(Boolean),
                          )
                        }
                      />
                    </td>
                    <td className="py-1.5 pe-2">
                      <Input
                        className="h-8 font-mono text-[11px]"
                        value={faA}
                        onChange={(e) =>
                          setAliases(
                            c.id,
                            "fa",
                            e.target.value.split(/\s+/).filter(Boolean),
                          )
                        }
                      />
                    </td>
                    <td className="py-2">
                      <Badge tone={c.phase === 1 ? "ok" : "muted"}>
                        {c.phase === 1
                          ? fa
                            ? "فعال"
                            : "live"
                          : fa
                            ? `فاز ${c.phase}`
                            : `phase ${c.phase}`}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function FilterChip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        on
          ? "h-8 rounded-md bg-fg px-2.5 text-[11px] font-medium text-bg"
          : "h-8 rounded-md px-2.5 text-[11px] text-muted shadow-[var(--shadow-border)]"
      }
    >
      {children}
    </button>
  );
}
