/**
 * NavigationSteps — the turn-by-turn instruction list for a route.
 * Renders each step's instruction text + distance, with the arrival
 * step highlighted. While navigation is live (`currentIndex` set) the
 * active step is highlighted and completed steps dim to a checked state.
 * Only surfaces real data (labels/distances come from the backend's route
 * response).
 */
import { Check, Footprints } from "lucide-react";

import type { Route } from "@/lib/navigation-types";
import { formatMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";

export function NavigationSteps({
  route,
  currentIndex,
}: {
  route: Route;
  currentIndex?: number;
}) {
  const navigating = currentIndex !== undefined && currentIndex >= 0;
  return (
    <ol className="relative space-y-3 pl-1" aria-label="Navigation steps">
      {route.steps.map((step, i) => {
        const isLast = i === route.steps.length - 1;
        const isArrival = step.instruction?.startsWith("Arrive") ?? isLast;
        const completed = navigating && i < currentIndex;
        const isCurrent = navigating && i === currentIndex;
        return (
          <li
            key={step.edge_id}
            className={cn("relative flex gap-3", completed && "opacity-60")}
            aria-current={isCurrent ? "step" : undefined}
          >
            {/* Connector line */}
            {!isLast ? (
              <span aria-hidden className="absolute left-[13px] top-7 h-[calc(100%-12px)] w-px bg-brand-muted" />
            ) : null}
            <span
              className={cn(
                "z-10 flex size-7 shrink-0 items-center justify-center rounded-full border",
                completed
                  ? "border-brand-muted bg-brand-surface text-brand-subtle"
                  : isCurrent
                    ? "border-brand-cyan bg-brand-cyan/15 text-brand-cyan ring-2 ring-brand-cyan/30"
                    : isArrival
                      ? "border-brand-green/50 bg-brand-green/15 text-brand-green"
                      : "border-brand-muted bg-brand-surface text-brand-cyan",
              )}
              aria-hidden
            >
              {completed || isArrival ? (
                <Check className="size-3.5" />
              ) : (
                <Footprints className="size-3.5" />
              )}
            </span>
            <div className="min-w-0 flex-1 pb-1">
              <p
                className={cn(
                  "text-sm leading-snug",
                  completed
                    ? "text-brand-subtle line-through decoration-brand-subtle/40"
                    : isCurrent
                      ? "font-semibold text-brand-cyan"
                      : isArrival
                        ? "font-medium text-brand-green"
                        : "text-brand-text",
                )}
              >
                {step.instruction ?? `Walk ${Math.round(step.distance_m)} m`}
              </p>
              <p className="mt-0.5 text-xs text-brand-subtle">
                {Math.round(step.distance_m)} m
                {step.walk_time_min != null ? ` · ${formatMinutes(step.walk_time_min)}` : ""}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
