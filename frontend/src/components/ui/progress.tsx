import { cn } from "@/lib/utils";

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number; // 0..100
  tone?: "default" | "success" | "warning";
}

/** Thin progress bar used for navigation progress and loading. */
export function Progress({ value, tone = "default", className, ...props }: ProgressProps) {
  const clamped = Math.min(100, Math.max(0, value));
  const toneClass =
    tone === "success"
      ? "bg-brand-green"
      : tone === "warning"
        ? "bg-brand-amber"
        : "bg-brand-cyan";
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-brand-muted", className)}
      {...props}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-300", toneClass)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
