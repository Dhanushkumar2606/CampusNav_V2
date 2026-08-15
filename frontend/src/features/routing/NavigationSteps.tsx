/**
 * NavigationSteps — the turn-by-turn instruction list for a route.
 * Renders each step's instruction text + distance, with the arrival
 * step highlighted. While navigation is live (`currentIndex` set) the
 * active step is highlighted and completed steps dim to a checked state.
 * Only surfaces real data (labels/distances come from the backend's route
 * response).
 *
 * Route-aware 360°: when a step's endpoint node carries an immersive scene
 * (per the campus config), a small chip lets the user open that viewpoint
 * in the ImmersiveViewer. Purely additive — the navigation state machine
 * is untouched.
 */
import { useMemo, useState } from "react";
import { Check, Footprints, Orbit } from "lucide-react";

import { ImmersiveViewer } from "@/features/immersive/ImmersiveViewer";
import type { GraphPayload, ImmersiveScene, Route } from "@/lib/navigation-types";
import { formatMinutes } from "@/lib/format";
import { routeImmersiveViewpoints } from "@/lib/immersive";
import { cn } from "@/lib/utils";

export function NavigationSteps({
  route,
  currentIndex,
  graph,
}: {
  route: Route;
  currentIndex?: number;
  graph?: GraphPayload | null;
}) {
  const navigating = currentIndex !== undefined && currentIndex >= 0;
  const viewpointByNode = useMemo(() => {
    const map = new Map<string, { stepIndex: number; label: string; scene: ImmersiveScene }>();
    for (const v of routeImmersiveViewpoints(route, graph ?? null)) {
      map.set(v.nodeId, v);
    }
    return map;
  }, [route, graph]);
  const [activeScene, setActiveScene] = useState<ImmersiveScene | null>(null);
  const [activeLabel, setActiveLabel] = useState<string>("");
  return (
    <>
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
              {(() => {
                const viewpoint = viewpointByNode.get(step.to_node_id);
                if (!viewpoint) return null;
                return (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveScene(viewpoint.scene);
                      setActiveLabel(viewpoint.label);
                    }}
                    className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-md border border-brand-cyan/40 bg-brand-cyan/10 px-1.5 py-0.5 text-[11px] font-medium text-brand-cyan transition-colors hover:bg-brand-cyan/20"
                    aria-label={`View 360° at ${viewpoint.label}`}
                  >
                    <Orbit className="size-3 shrink-0" aria-hidden />
                    <span className="truncate">{viewpoint.label}</span>
                  </button>
                );
              })()}
            </div>
          </li>
        );
      })}
    </ol>
    <ImmersiveViewer
      open={activeScene !== null}
      scene={activeScene}
      placeLabel={activeLabel}
      onClose={() => {
        setActiveScene(null);
        setActiveLabel("");
      }}
    />
    </>
  );
}
