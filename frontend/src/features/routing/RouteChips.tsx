/**
 * RouteChips — the active routing profile as compact chips on the map
 * (mode, stairs, accessibility, surveyed/estimated honesty) so the user
 * sees what a route is computed with without opening the planner panel.
 * Shown on the map whenever a route result is present. Includes a
 * "clear route" action.
 */
import { Accessibility, Footprints, X, Zap } from "lucide-react";

import { useCampusRoute } from "@/features/campus/CampusRouteContext";

export function RouteChips() {
  const { mode, avoidStairs, requireAccessible, route, routeStatus, clearRoute } = useCampusRoute();
  if (!route || routeStatus !== "ok") return null;

  const chip =
    "flex items-center gap-1.5 rounded-full border border-brand-muted/60 bg-brand-deep/90 px-3 py-1.5 text-xs font-medium text-brand-text shadow-float backdrop-blur";

  return (
    <div className="pointer-events-auto absolute bottom-4 left-3 z-20 hidden flex-wrap items-center gap-1.5 md:flex">
      <span className={chip}>
        {mode === "fastest" ? <Zap className="size-3.5 text-brand-green" /> : <Footprints className="size-3.5 text-brand-cyan" />}
        {mode === "fastest" ? "Fastest" : "Shortest"}
        {avoidStairs ? " · no stairs" : ""}
      </span>
      <span className={chip}>
        <Accessibility className={`size-3.5 ${requireAccessible ? "text-brand-amber" : "text-brand-subtle"}`} />
        {requireAccessible ? "Accessible only" : "Accessible ok"}
      </span>
      <span className={chip} title="All segment distances on this campus are straight-line estimates, not surveyed paths">
        {route.all_estimated ? "Estimated path" : "Surveyed"}
      </span>
      <button
        type="button"
        onClick={clearRoute}
        aria-label="Clear route"
        title="Clear route"
        className="flex h-7 w-7 items-center justify-center rounded-full border border-brand-muted/60 bg-brand-deep/90 text-brand-subtle shadow-float backdrop-blur transition-colors hover:bg-brand-surface hover:text-brand-text"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}