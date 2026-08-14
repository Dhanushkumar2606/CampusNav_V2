/**
 * MapViewHost — entry point for the /map route. Wraps the map page in the
 * CampusRouteProvider and keeps the URL search params in sync with the
 * session state (campus, source, destination, constraints). The URL is the
 * source of truth for shareable routes: deep links hydrate the provider
 * once on mount, then every state change writes back with `replace`.
 */
import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";

import { CampusRouteProvider, useCampusRoute } from "@/features/campus/CampusRouteContext";
import { getPreferences } from "@/api/search";
import { useAuth } from "@/auth/AuthContext";
import { MapView } from "./MapView";

export function MapViewHost() {
  return (
    <CampusRouteProvider>
      <MapRouteSync />
    </CampusRouteProvider>
  );
}

function MapRouteSync() {
  const ctx = useCampusRoute();
  const [searchParams, setSearchParams] = useSearchParams();
  const hydrated = useRef(false);

  // Hydrate the session from the URL whenever its key params change (not
  // just on mount): deep links arriving while already on /map — e.g. the
  // header search dropdown — must take effect too. The provider auto-runs
  // the route once both endpoints are present, so a shared link is one
  // click away with no form interaction.
  const paramsKey = searchParams.toString();
  useEffect(() => {
    if (hydrated.current && !paramsKey) return;
    hydrated.current = true;
    ctx.hydrate(searchParams);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey]);

  // Write-back: keep the URL shareable whenever the session changes.
  // Node ids are unstable across re-seeds, so labels go in the URL when
  // the graph knows one for the selected node.
  const idToLabel = useMemo(() => {
    const m = new Map<string, string>();
    if (ctx.graph?.labels) {
      for (const [label, id] of Object.entries(ctx.graph.labels)) m.set(id, label);
    }
    return m;
  }, [ctx.graph?.labels]);

  // Apply the signed-in user's saved preferences (default mode, stairs,
  // accessibility) as session defaults — but only when the URL doesn't
  // already pin those values, so deep links and explicit choices win.
  const { status: authStatus, getToken } = useAuth();
  const prefsAppliedRef = useRef(false);
  useEffect(() => {
    if (authStatus !== "authenticated" || prefsAppliedRef.current) return;
    if (searchParams.get("source") || searchParams.get("destination")) return;
    prefsAppliedRef.current = true;
    let cancelled = false;
    const token = getToken();
    if (!token) return;
    getPreferences(token)
      .then((p) => {
        if (cancelled) return;
        if (!searchParams.get("mode")) ctx.setMode(p.default_mode);
        if (!searchParams.get("avoid_stairs")) ctx.setAvoidStairs(p.default_avoid_stairs);
        if (!searchParams.get("accessible")) ctx.setRequireAccessible(p.default_require_accessible);
      })
      .catch(() => {
        // Preferences are a soft default; a failed load changes nothing.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (ctx.campusSlug) next.set("campus", ctx.campusSlug);
    if (ctx.sourceId) next.set("source", idToLabel.get(ctx.sourceId) ?? ctx.sourceId);
    if (ctx.destinationId) next.set("destination", idToLabel.get(ctx.destinationId) ?? ctx.destinationId);
    if (ctx.place) next.set("place", idToLabel.get(ctx.place) ?? ctx.place);
    if (ctx.requireAccessible) next.set("accessible", "true");
    if (ctx.mode && ctx.mode !== "shortest") next.set("mode", ctx.mode);
    if (ctx.avoidStairs) next.set("avoid_stairs", "true");
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [
    ctx.campusSlug,
    ctx.sourceId,
    ctx.destinationId,
    ctx.place,
    ctx.requireAccessible,
    ctx.mode,
    ctx.avoidStairs,
    idToLabel,
    searchParams,
    setSearchParams,
  ]);

  return <MapView />;
}