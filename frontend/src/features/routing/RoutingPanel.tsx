/**
 * RoutingPanel — the route planner UI. All session state (campuses, graph,
 * selection, constraints, route result + alternatives) lives in
 * CampusRouteContext; this component is purely presentational. It renders
 * the campus picker, source/destination pickers, route preferences, the
 * find-route action and the result card with alternatives + steps.
 */
import { useMemo } from "react";
import { Loader2, Navigation as NavigationIcon, Route as RouteIcon, AlertTriangle, X } from "lucide-react";

import type { Route } from "@/lib/navigation-types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDistance, formatMinutes } from "@/lib/format";
import { useCampusRoute } from "@/features/campus/CampusRouteContext";

import { CampusPicker } from "./CampusPicker";
import { LocationPicker } from "./LocationPicker";
import { NavigationSteps } from "./NavigationSteps";
import { RoutePreferences } from "./RoutePreferences";
import { RouteSummary } from "./RouteSummary";

export function RoutingPanel() {
  const {
    campuses,
    loadingCampuses,
    campusesError,
    campusSlug,
    selectCampus,
    graph,
    loadingGraph,
    graphError,
    sourceId,
    destinationId,
    setSourceId,
    setDestinationId,
    requireAccessible,
    setRequireAccessible,
    mode,
    setMode,
    avoidStairs,
    setAvoidStairs,
    route,
    alternatives,
    activeAltIndex,
    pickAlternative,
    routeStatus,
    routeError,
    findRoute,
    clearRoute,
    startNavigation,
    navSession,
  } = useCampusRoute();

    // While navigation runs, the planner is read-only: changing or recomputing
  // the route under the walker would desync the live session.
  const canSubmit =
    !!graph && !!sourceId && !!destinationId && routeStatus !== "loading" && !navSession.active;
  const visibleRoute: Route | null = activeAltIndex >= 0 ? alternatives[activeAltIndex] ?? null : route;

  // Honest accessibility diagnosis: when an accessible route is required
  // and the router reports no path, check whether either endpoint has ANY
  // accessible connection in the campus graph. A negative answer means the
  // filter (not a routing bug) is what's blocking the trip.
  const accessibleDiagnosis = useMemo(() => {
    if (!requireAccessible || routeStatus !== "error" || !graph) return null;
    const hasAccessibleEdge = (id: string | null) => {
      if (!id) return null;
      return graph.edges.some(
        (e) => e.from_id === id && e.accessible && !e.is_restricted,
      );
    };
    const srcOk = hasAccessibleEdge(sourceId);
    const dstOk = hasAccessibleEdge(destinationId);
    if (srcOk === null || dstOk === null) return null;
    const parts: string[] = [];
    if (!srcOk) parts.push("the starting point has no wheelchair-accessible connections");
    if (!dstOk) parts.push("the destination has no wheelchair-accessible connections");
    if (parts.length === 0) return "The accessible filter is on and the router found no connected accessible path — try a different pair of points.";
    return `The accessible filter is on, but ${parts.join(" and ")} on this campus.`;
  }, [requireAccessible, routeStatus, graph, sourceId, destinationId]);

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Campus picker */}
      <Card className="border-brand-muted bg-brand-navy">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm uppercase tracking-wider text-brand-subtle">
            Campus
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loadingCampuses ? (
            <div className="flex items-center gap-2 text-sm text-brand-subtle">
              <Loader2 className="size-4 animate-spin" />
              Loading campuses…
            </div>
          ) : campusesError ? (
            <ErrorAlert title="Could not load campuses" message={campusesError} />
          ) : (
            <CampusPicker
              campuses={campuses}
              value={campusSlug}
              onChange={selectCampus}
            />
          )}
        </CardContent>
      </Card>

      {/* Source / destination */}
      <Card className="border-brand-muted bg-brand-navy">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm uppercase tracking-wider text-brand-subtle">
            Plan a route
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingGraph ? (
            <div className="flex items-center gap-2 text-sm text-brand-subtle">
              <Loader2 className="size-4 animate-spin" />
              Loading campus graph…
            </div>
          ) : graphError ? (
            <ErrorAlert title="Could not load graph" message={graphError} />
          ) : null}

          <div className="space-y-2.5">
            <Label htmlFor="src" className="text-sm font-medium">
              From
            </Label>
            <LocationPicker
              id="src"
              graph={graph}
              value={sourceId}
              onChange={(id) => setSourceId(id)}
              placeholder={graph ? "Pick a starting point" : "Loading graph…"}
              disabled={!graph}
              allowLive
            />
          </div>

          <div className="space-y-2.5">
            <Label htmlFor="dst" className="text-sm font-medium">
              To
            </Label>
            <LocationPicker
              id="dst"
              graph={graph}
              value={destinationId}
              onChange={(id) => setDestinationId(id)}
              placeholder={graph ? "Pick a destination" : "Loading graph…"}
              disabled={!graph}
            />
          </div>

          <Separator className="bg-brand-muted" />

          <RoutePreferences
            mode={mode}
            onModeChange={setMode}
            avoidStairs={avoidStairs}
            onAvoidStairsChange={setAvoidStairs}
            requireAccessible={requireAccessible}
            onRequireAccessibleChange={setRequireAccessible}
          />

          <Button
            size="lg"
            disabled={!canSubmit}
            onClick={() => void findRoute()}
            className="w-full"
          >
            {navSession.active ? (
              <>
                <NavigationIcon className="size-4" />
                Navigation in progress
              </>
            ) : routeStatus === "loading" ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Finding route…
              </>
            ) : (
              <>
                <NavigationIcon className="size-4" />
                Find route
              </>
            )}
          </Button>

          {routeStatus === "error" && routeError ? (
            <div className="space-y-2">
              <ErrorAlert title="Could not compute a route" message={routeError} />
              {accessibleDiagnosis ? (
                <p className="rounded-md border border-brand-amber/40 bg-brand-amber/10 px-3 py-2 text-xs text-brand-amber">
                  {accessibleDiagnosis}
                </p>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                disabled={!canSubmit}
                onClick={() => void findRoute()}
              >
                Try again
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Route result */}
      {route && visibleRoute ? (
        <Card className="border-brand-cyan/40 bg-brand-navy">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-wider text-brand-cyan">
              <RouteIcon className="size-4" /> Route
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Alternatives picker — every option shows distance + time so
                the comparison is actually informative. */}
            {alternatives.length > 0 ? (
              <Tabs
                value={String(activeAltIndex >= 0 ? activeAltIndex + 1 : 0)}
                onValueChange={(v) => pickAlternative(Number(v) - 1)}
              >
                <TabsList className="w-full">
                  <TabsTrigger value="0" className="flex-1">
                    {formatDistance(route.total_distance_m)} ·{" "}
                    {formatMinutes(route.estimated_walk_time_min)}
                  </TabsTrigger>
                  {alternatives.map((a, i) => (
                    <TabsTrigger key={i} value={String(i + 1)} className="flex-1">
                      {formatDistance(a.total_distance_m)} ·{" "}
                      {formatMinutes(a.estimated_walk_time_min)}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            ) : null}

            <RouteSummary route={visibleRoute} />
            <div className="flex items-center gap-2">
              <Button
                className="flex-1"
                onClick={startNavigation}
                disabled={!visibleRoute || navSession.active}
              >
                <NavigationIcon className="size-4" />
                {navSession.active ? "Navigating…" : "Start navigation"}
              </Button>
              {/* Cancel/Stop: clearing the route also terminates any active
                  navigation session (clearRoute resets navSession). Subtle,
                  secondary action next to the primary Start button. */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={clearRoute}
                aria-label={navSession.active ? "Stop navigation" : "Cancel route"}
                title={navSession.active ? "Stop navigation" : "Cancel route"}
                className="shrink-0"
              >
                <X className="size-4" aria-hidden />
                {navSession.active ? "Stop navigation" : "Cancel route"}
              </Button>
            </div>
            <NavigationSteps
              route={visibleRoute}
              currentIndex={navSession.active ? navSession.stepIndex : undefined}
              graph={graph}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function ErrorAlert({ title, message }: { title: string; message: string }) {
  return (
    <Alert variant="destructive" className="border-red-500/40 bg-red-500/10">
      <AlertTriangle className="size-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}