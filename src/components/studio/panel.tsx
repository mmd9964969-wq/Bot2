import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Panel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl bg-surface p-3 shadow-[var(--shadow-border)] sm:p-4",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function PanelTitle({
  kicker,
  title,
  hint,
}: {
  kicker?: string;
  title: string;
  hint?: string;
}) {
  return (
    <div className="mb-3">
      {kicker ? (
        <p className="font-mono text-[10px] tracking-wide text-accent">{kicker}</p>
      ) : null}
      <h2 className="text-[15px] font-semibold leading-tight">{title}</h2>
      {hint ? <p className="mt-0.5 text-xs leading-snug text-muted">{hint}</p> : null}
    </div>
  );
}

export function KeyRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 last:border-0">
      <span className="shrink-0 text-xs text-muted">{label}</span>
      <span
        className={cn(
          "min-w-0 text-end text-xs leading-snug text-fg",
          mono && "font-mono",
        )}
      >
        {value}
      </span>
    </div>
  );
}
