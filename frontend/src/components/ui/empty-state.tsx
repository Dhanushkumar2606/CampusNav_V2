import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

/** Polished empty state — never leave a blank screen. */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-brand-muted bg-brand-navy/40 px-6 py-12 text-center",
        className,
      )}
    >
      {Icon ? (
        <div className="flex size-11 items-center justify-center rounded-full bg-brand-surface">
          <Icon className="size-5 text-brand-subtle" aria-hidden />
        </div>
      ) : null}
      <div>
        <h3 className="text-sm font-semibold text-brand-text">{title}</h3>
        {description ? (
          <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-brand-subtle">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
