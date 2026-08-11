import { cn } from "@/lib/utils";

export type ChipVariant = "default" | "outline" | "active" | "danger" | "warning";

const variantClasses: Record<ChipVariant, string> = {
  default: "bg-brand-surface text-brand-text border-brand-muted",
  outline: "bg-transparent text-brand-subtle border-brand-muted",
  active: "bg-brand-green/15 text-brand-green border-brand-green/40",
  danger: "bg-brand-danger/10 text-brand-danger border-brand-danger/30",
  warning: "bg-brand-amber/10 text-brand-amber border-brand-amber/30",
};

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ChipVariant;
}

/** Small filter/label chip — used for categories, badges, quick actions. */
export function Chip({ className, variant = "default", ...props }: ChipProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
