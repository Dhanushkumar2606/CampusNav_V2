/**
 * Map page: full-height split layout. Left column has the routing panel,
 * right column has the map. The page owns the route + selection state
 * because the URL is the source of truth for shareable routes. The page
 * also owns the campus graph (it loads once and forwards both to the
 * panel and to the map hooks) so we don't double-fetch.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { LogOut, MapPin } from "lucide-react";

import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import type { GraphPayload, Route } from "@/lib/navigation-types";
import { MapCanvas } from "@/features/map/MapCanvas";
import { useGraphSources } from "@/features/map/useGraphSources";
import { useNodeMarkers } from "@/features/map/useNodeMarkers";
import { useRouteLayer } from "@/features/map/useRouteLayer";
import { RoutingPanel } from "@/features/routing/RoutingPanel";

interface Props {
  /** Optional pre-loaded graph (e.g. set by RoutingPanel via callback). */
  graph: GraphPayload | null;
  onGraphChange: (g: GraphPayload | null) => void;
}

export function MapView({ graph, onGraphChange }: Props) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [sourceId, setSourceId] = useState<string | null>(searchParams.get("source"));
  const [destinationId, setDestinationId] = useState<string | null>(
    searchParams.get("destination"),
  );
  const [requireAccessible, setRequireAccessible] = useState<boolean>(
    searchParams.get("accessible") === "true",
  );
  const [route, setRoute] = useState<Route | null>(null);

  // ---- drive URL deep-linking ------------------------------------------
  useEffect(() => {
    const next = new URLSearchParams();
    if (sourceId) next.set("source", sourceId);
    if (destinationId) next.set("destination", destinationId);
    if (requireAccessible) next.set("accessible", "true");
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, destinationId, requireAccessible]);

  // ---- map wiring -------------------------------------------------------
  useGraphSources(graph);
  useRouteLayer(route, graph);
  useNodeMarkers(graph, sourceId, destinationId);

  // ---- handlers ---------------------------------------------------------
  const onLogout = useCallback(() => {
    logout();
    navigate("/", { replace: true });
  }, [logout, navigate]);

  return (
    <div className="flex h-screen flex-col bg-brand-deep text-brand-text">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-brand-muted bg-brand-navy/80 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="size-2.5 rounded-full bg-brand-green shadow-[0_0_12px_2px_rgba(57,255,20,0.6)]" />
          <span className="text-sm uppercase tracking-[0.2em] text-brand-subtle">
            CampusNav · Map
          </span>
          {user ? (
            <span className="hidden text-xs text-brand-subtle md:inline">
              · {user.email}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onLogout}>
            <LogOut className="size-4" />
            Sign out
          </Button>
        </div>
      </header>

      {/* Main split */}
      <main className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="border-r border-brand-muted bg-brand-deep">
          <RoutingPanel
            sourceId={sourceId}
            destinationId={destinationId}
            onSourceChange={setSourceId}
            onDestinationChange={setDestinationId}
            requireAccessible={requireAccessible}
            onRequireAccessibleChange={setRequireAccessible}
            route={route}
            onRouteChange={setRoute}
            graph={graph}
            onGraphChange={onGraphChange}
          />
        </aside>

        <section className="relative min-h-0">
          <MapCanvas>
            <div className="pointer-events-none absolute right-3 top-3 z-10 hidden max-w-xs rounded-md border border-brand-muted/60 bg-brand-navy/80 px-3 py-2 text-xs text-brand-subtle backdrop-blur md:block">
              <div className="mb-1 flex items-center gap-2 font-medium text-brand-text">
                <MapPin className="size-3.5 text-brand-cyan" /> Plan a route
              </div>
              <p>
                Pick a starting point and a destination in the panel, then
                press <span className="text-brand-green">Find route</span>.
                The route polyline will appear here.
              </p>
            </div>
          </MapCanvas>
        </section>
      </main>
    </div>
  );
}