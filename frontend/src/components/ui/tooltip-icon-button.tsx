/**
 * TooltipIconButton — icon button with a hover animation and a styled
 * tooltip that reveals the function's name beside the symbol. The tooltip
 * eases in while the pointer is over the button and fades out when it
 * leaves (pointer-only reveal, like map-control conventions). Screen
 * readers are covered by the aria-label; the native `title` is deliberately
 * not used so the browser's tooltip can't double up with the styled one.
 */
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface Props {
  /** Function name — shown in the tooltip and announced to screen readers. */
  label: string;
  onClick: () => void;
  children: ReactNode;
  /** Mirrored into aria-pressed (toggles like fullscreen/overlay). */
  pressed?: boolean;
  disabled?: boolean;
  /** Extra classes (open-state colors, etc.). */
  className?: string;
  id?: string;
}

export function TooltipIconButton({
  label,
  onClick,
  children,
  pressed,
  disabled,
  className,
  id,
}: Props) {
  return (
    <button
      type="button"
      id={id}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      className={cn(
        "group/ctl relative flex size-9 items-center justify-center text-brand-subtle",
        // Hover animation: lift + grow + cyan glow, shared across the column.
        "transition-all duration-200 ease-out",
        "hover:-translate-y-0.5 hover:scale-110 hover:border-brand-cyan/60 hover:bg-brand-cyan/10 hover:text-brand-cyan hover:shadow-[0_0_18px_rgba(45,212,191,0.35)]",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "rounded-md border border-transparent",
        pressed && "text-brand-cyan",
        className,
      )}
    >
      {children}
      {/* Function-name tooltip: slides in from the left of the symbol. */}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute right-full top-1/2 z-[1] mr-2.5 -translate-y-1/2 whitespace-nowrap",
          "rounded-md border border-brand-muted bg-brand-deep/95 px-2.5 py-1 text-[11px] font-medium text-brand-text shadow-float backdrop-blur",
          "translate-x-1 opacity-0 transition-all duration-150 ease-out",
          "group-hover/ctl:translate-x-0 group-hover/ctl:opacity-100",
        )}
      >
        {label}
      </span>
    </button>
  );
}
