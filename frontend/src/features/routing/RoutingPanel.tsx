/**
 * RoutingPanel — orchestrates the left-side controls. Owns:
 *   - campuses list (fetched once)
 *   - selected campus + its graph (re-fetched on campus change)
 *   - source / destination selection
 *   - accessibility toggle
 *   - the route request (calls /navigation/campuses/{slug}/route)
 *
 * State is split: this component owns campus + selection state (so it can
 * re-render its own cards without disturbing the parent), but the
 * resulting `Route` is lifted to the parent via `onRouteChange` so the
 * map can render the polyline.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Navigation, Route as RouteIcon, AlertTriangle } from "lucide-react";

import {
  getGraph,
  listCampuses,
  postRoute,
  routeErrorMessage,
} from "@/api/navigation";
import type { Campus, GraphPayload, Route } from "@/lib/navigation-types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { prettyLabel } from "@/lib/brand";

import { AccessibilityToggle } from "./AccessibilityToggle";
import { CampusPicker } from "./CampusPicker";
import { EstimatedBanner } from "./EstimatedBanner";
import { LocationPicker } from "./LocationPicker";
import { RouteSummary } from "./RouteSummary";

export type RouteStatus = "idle" | "loading" | "ok" | "error";

export interface RoutingPanelProps {
  // Forwarded selection (kept in sync with URL search params via parent).
  sourceId: string | null;
  destinationId: string | null;
  onSourceChange: (id: string) => void;
  onDestinationChange: (id: string) => void;
  requireAccessible: boolean;
  onRequireAccessibleChange: (next: boolean) => void;
  // Lifted-up route state (parent renders the polyline).
  route: Route | null;
  onRouteChange: (route: Route | null) => void;
  // Lifted-up graph state (parent renders the map).
  graph: GraphPayload | null;
  onGraphChange: (g: GraphPayload | null) => void;
}

export function RoutingPanel({
  sourceId,
  destinationId,
  onSourceChange,
  onDestinationChange,
  requireAccessible,
  onRequireAccessibleChange,
  route,
  onRouteChange,
  graph,
  onGraphChange,
}: RoutingPanelProps) {
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [campusSlug, setCampusSlug] = useState<string | null>(null);
  const [loadingCampuses, setLoadingCampuses] = useState(true);
  const [loadingGraph, setLoadingGraph] = useState(false);
  const [routeStatus, setRouteStatus] = useState<RouteStatus>("idle");
  const [routeError, setRouteError] = useState<string | null>(null);
  const [campusesError, setCampusesError] = useState<string | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);

  // ---- load campuses on mount ------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setLoadingCampuses(true);
    listCampuses()
      .then((cs) => {
        if (cancelled) return;
        setCampuses(cs);
        setLoadingCampuses(false);
        if (cs.length > 0) setCampusSlug(cs[0].slug);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCampusesError(err instanceof Error ? err.message : "Could not load campuses");
        setLoadingCampuses(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- re-fetch graph when campus changes ------------------------------
  useEffect(() => {
    if (!campusSlug) {
      onGraphChange(null);
      return;
    }
    let cancelled = false;
    setLoadingGraph(true);
    setGraphError(null);
    getGraph(campusSlug)
      .then((g) => {
        if (cancelled) return;
        onGraphChange(g);
        setLoadingGraph(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setGraphError(err instanceof Error ? err.message : "Could not load graph");
        setLoadingGraph(false);
      });
    return () => {
      cancelled = true;
    };
  }, [campusSlug, onGraphChange]);

  // ---- fire route request ----------------------------------------------
  const onFindRoute = useCallback(async () => {
    if (!graph || !sourceId || !destinationId) return;
    setRouteStatus("loading");
    setRouteError(null);
    try {
      const res = await postRoute(graph.campus.slug, {
        source_id: sourceId,
        destination_id: destinationId,
        require_accessible: requireAccessible,
        heuristic: "haversine",
      });
      if (res.status === "ok" && res.route) {
        onRouteChange(res.route);
        setRouteStatus("ok");
      } else {
        onRouteChange(null);
        setRouteError(routeErrorMessage(res.status, res.error));
        setRouteStatus("error");
      }
    } catch (err) {
      onRouteChange(null);
      setRouteError(err instanceof Error ? err.message : "Could not compute route");
      setRouteStatus("error");
    }
  }, [graph, sourceId, destinationId, requireAccessible, onRouteChange]);

  const canSubmit = !!graph && !!sourceId && !!destinationId && routeStatus !== "loading";
  const sourceNode = useMemo(
    () => graph?.nodes.find((n) => n.id === sourceId) ?? null,
    [graph, sourceId],
  );
  const destinationNode = useMemo(
    () => graph?.nodes.find((n) => n.id === destinationId) ?? null,
    [graph, destinationId],
  );

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <EstimatedBanner />

      {/* Campus picker */}
      <Card className="border-brand-muted bg-brand-navy/60">
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
              onChange={setCampusSlug}
            />
          )}
        </CardContent>
      </Card>

      {/* Source / destination */}
      <Card className="border-brand-muted bg-brand-navy/60">
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

          <div className="space-y-2">
            <Label htmlFor="src">From</Label>
            <LocationPicker
              id="src"
              graph={graph}
              value={sourceId}
              onChange={onSourceChange}
              placeholder={graph ? "Pick a starting point" : "Loading graph…"}
              disabled={!graph}
            />
            {sourceNode ? (
              <p className="text-xs text-brand-subtle">
                <span className="text-brand-cyan">●</span> {prettyLabel(sourceNode.label)}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="dst">To</Label>
            <LocationPicker
              id="dst"
              graph={graph}
              value={destinationId}
              onChange={onDestinationChange}
              placeholder={graph ? "Pick a destination" : "Loading graph…"}
              disabled={!graph}
            />
            {destinationNode ? (
              <p className="text-xs text-brand-subtle">
                <span className="text-brand-green">●</span> {prettyLabel(destinationNode.label)}
              </p>
            ) : null}
          </div>

          <Separator className="bg-brand-muted" />

          <AccessibilityToggle
            checked={requireAccessible}
            onChange={onRequireAccessibleChange}
          />

          <Button
            size="lg"
            disabled={!canSubmit}
            onClick={onFindRoute}
            className="w-full"
          >
            {routeStatus === "loading" ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Finding route…
              </>
            ) : (
              <>
                <Navigation className="size-4" />
                Find route
              </>
            )}
          </Button>

          {routeStatus === "error" && routeError ? (
            <ErrorAlert title="Could not compute a route" message={routeError} />
          ) : null}
        </CardContent>
      </Card>

      {/* Route summary (only when there's a route) */}
      {route ? (
        <Card className="border-brand-cyan/40 bg-brand-navy/70">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-wider text-brand-cyan">
              <RouteIcon className="size-4" /> Route
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RouteSummary route={route} />
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
