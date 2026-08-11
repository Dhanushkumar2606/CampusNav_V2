/**
 * Map page: full-height split layout. Left column has the routing panel,
 * right column has the map. The page owns the route + selection state
 * because the URL is the source of truth for shareable routes. The page
 * also owns the campus graph (it loads once and forwards both to the
 * panel and to the map hooks) so we don't double-fetch.
 *
 * Rendered inside AppShell — the shell owns the header/branding.
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MapPin } from "lucide-react";

import { listBuildings } from "@/api/navigation";
import type { Building, GraphPayload, Route } from "@/lib/navigation-types";
import { MapCanvas } from "@/features/map/MapCanvas";
import { useGraphSources } from "@/features/map/useGraphSources";
import { useNodeMarkers } from "@/features/map/useNodeMarkers";
import { useRouteLayer } from "@/features/map/useRouteLayer";
import { useNodeClick } from "@/features/map/useNodeClick";
import { MapControls } from "@/features/map/MapControls";
import { BuildingDetails } from "@/features/map/BuildingDetails";
import { RoutingPanel } from "@/features/routing/RoutingPanel";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { SRM_KTR_BOUNDS } from "@/features/map/mapStyle";

interface Props {
  /** Optional pre-loaded graph (e.g. set by RoutingPanel via callback). */
  graph: GraphPayload | null;
  onGraphChange: (g: GraphPayload | null) => void;
}

export function MapView({ graph, onGraphChange }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();

  const [sourceId, setSourceId] = useState<string | null>(searchParams.get("source"));
  const [destinationId, setDestinationId] = useState<string | null>(
    searchParams.get("destination"),
  );
  const [requireAccessible, setRequireAccessible] = useState<boolean>(
    searchParams.get("accessible") === "true",
  );
  const [route, setRoute] = useState<Route | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [buildings, setBuildings] = useState<Building[] | null>(null);

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

  // ---- fetch building records for the active campus ---------------------
  useEffect(() => {
    const slug = graph?.campus.slug;
    if (!slug) {
      setBuildings(null);
      return;
    }
    let cancelled = false;
    listBuildings(slug)
      .then((bs) => {
        if (!cancelled) setBuildings(bs);
      })
      .catch(() => {
        if (!cancelled) setBuildings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [graph?.campus.slug]);

  // ---- map wiring -------------------------------------------------------
  useGraphSources(graph);
  useRouteLayer(route, graph);
  useNodeMarkers(graph, sourceId, destinationId);
  useNodeClick(setSelectedNodeId);

  const selectedNode = graph?.nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedBuilding =
    selectedNode?.building_id && buildings
      ? (buildings.find((b) => b.id === selectedNode.building_id) ?? null)
      : null;

  const showHint = !route && !selectedNode;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 bg-brand-deep text-brand-text md:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="min-h-0 border-r border-brand-muted bg-brand-deep">
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
          {showHint ? (
            <div className="pointer-events-none absolute right-3 top-3 z-10 hidden max-w-xs rounded-md border border-brand-muted/60 bg-brand-navy/80 px-3 py-2 text-xs text-brand-subtle backdrop-blur md:block">
              <div className="mb-1 flex items-center gap-2 font-medium text-brand-text">
                <MapPin className="size-3.5 text-brand-cyan" /> Plan a route
              </div>
              <p>
                Pick a starting point and a destination in the panel, or tap
                any marker on the map, then press{" "}
                <span className="text-brand-green">Find route</span>.
              </p>
            </div>
          ) : null}

          <MapControls campusBounds={SRM_KTR_BOUNDS} />

          {/* Selected-place card — desktop overlay */}
          {selectedNode ? (
            <div className="absolute left-3 top-3 z-10 hidden w-80 rounded-xl border border-brand-muted bg-brand-deep/95 p-4 shadow-float backdrop-blur md:block">
              <BuildingDetails
                node={selectedNode}
                building={selectedBuilding}
                graph={graph!}
                onSetOrigin={() => setSourceId(selectedNode.id)}
                onSetDestination={() => setDestinationId(selectedNode.id)}
                onClose={() => setSelectedNodeId(null)}
              />
            </div>
          ) : null}

          {/* Selected-place sheet — mobile */}
          <BottomSheet
            open={Boolean(selectedNode)}
            onClose={() => setSelectedNodeId(null)}
            title="Place details"
            className="h-[50vh]"
          >
            {selectedNode ? (
              <BuildingDetails
                node={selectedNode}
                building={selectedBuilding}
                graph={graph!}
                variant="full"
                onSetOrigin={() => setSourceId(selectedNode.id)}
                onSetDestination={() => setDestinationId(selectedNode.id)}
                onClose={() => setSelectedNodeId(null)}
              />
            ) : null}
          </BottomSheet>
        </MapCanvas>
      </section>
    </div>
  );
}
