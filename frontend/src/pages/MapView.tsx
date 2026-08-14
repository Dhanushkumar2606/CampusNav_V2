/**
 * MapView — map-first page. The map is full-bleed; every panel floats above
 * it instead of stealing a fixed column:
 *
 *   desktop:  floating planner panel (left, collapsible), details card (right),
 *             hint (right, only when idle), controls (bottom-right)
 *   mobile:   full-bleed map, bottom-sheet planner behind a "Plan a route"
 *             FAB, bottom-sheet place details
 *
 * All session state (campus/graph/selection/route) lives in
 * CampusRouteContext; the URL is synced by MapViewHost. The renderer choice
 * (MapLibre vs Leaflet) and place-selection stay local to the page.
 */
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, MapPin, Route as RouteIcon } from "lucide-react";

import type { MapController } from "@/features/campus/CampusRouteContext";
import { useCampusRoute } from "@/features/campus/CampusRouteContext";
import { MapCanvas } from "@/features/map/MapCanvas";
import { LeafletCanvas, CAN_USE_WEBGL } from "@/features/map/LeafletCanvas";
import { MapErrorBoundary } from "@/components/ui/map-error-boundary";
import { useGraphSources } from "@/features/map/useGraphSources";
import { useNodeMarkers } from "@/features/map/useNodeMarkers";
import { useRouteLayer } from "@/features/map/useRouteLayer";
import { useNodeClick } from "@/features/map/useNodeClick";
import { MapControls } from "@/features/map/MapControls";
import { NavStatusBar } from "@/features/navigation/NavStatusBar";
import { BuildingDetails } from "@/features/map/BuildingDetails";
import { RoutingPanel } from "@/features/routing/RoutingPanel";
import { RouteChips } from "@/features/routing/RouteChips";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { SRM_KTR_BOUNDS } from "@/features/map/mapStyle";
import { boundsFromNodes, isSafari } from "@/lib/geo";

export function MapView() {
  const ctx = useCampusRoute();
  const { graph, route, sourceId, destinationId, edgesVisible } = ctx;
  const [useWebGL, setUseWebGL] = useState<boolean>(() => CAN_USE_WEBGL && !isSafari());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [plannerOpen, setPlannerOpen] = useState(false);

  // /map?place=<id> deep link: open the details card for that node.
  useEffect(() => {
    if (ctx.place) setSelectedNodeId(ctx.place);
  }, [ctx.place]);

  // ---- map wiring (MapLibre branch only; Leaflet draws its own layers) ---
  useGraphSources(graph);
  useRouteLayer(route, graph);
  useNodeMarkers(graph, sourceId, destinationId);
  useNodeClick(setSelectedNodeId);

  const register = useCallback(
    (c: MapController) => {
      ctx.registerMapController(c);
    },
    [ctx],
  );
  const unregister = useCallback(
    (kind: MapController["kind"]) => {
      ctx.unregisterMapController(kind);
    },
    [ctx],
  );

  const selectedNode = graph?.nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedBuilding =
    selectedNode?.building_id && ctx.buildings
      ? (ctx.buildings.find((b) => b.id === selectedNode.building_id) ?? null)
      : null;

  const showHint = !route && !selectedNode;
  const campusBounds = boundsFromNodes(graph?.nodes ?? []) ?? SRM_KTR_BOUNDS;

  const openPlanner = () => setPlannerOpen(true);

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-brand-deep text-brand-text">
      {/* The map fills the whole page; every panel floats above it. */}
      {useWebGL ? (
        <MapErrorBoundary>
          <MapCanvas
            onFallback={() => setUseWebGL(false)}
            onRegister={register}
            onUnregister={unregister}
            edgesVisible={edgesVisible}
          />
        </MapErrorBoundary>
      ) : (
        <LeafletCanvas
          graph={graph}
          route={route}
          sourceId={sourceId}
          destinationId={destinationId}
          onSelectNode={setSelectedNodeId}
          onRegister={register}
          onUnregister={unregister}
          edgesVisible={edgesVisible}
        />
      )}

      {/* Map controls — shared by both renderers via the map controller. */}
      <MapControls campusBounds={campusBounds} />

      {/* Active routing profile as map chips (desktop). */}
      <RouteChips />

      {/* Live turn-by-turn status while navigation is running. */}
      <NavStatusBar />

      {/* Idle hint — desktop only. */}
      {showHint ? (
        <div className="pointer-events-none absolute right-3 top-3 z-20 hidden max-w-xs rounded-md border border-brand-muted/60 bg-brand-navy/80 px-3 py-2 text-xs text-brand-subtle backdrop-blur md:block">
          <div className="mb-1 flex items-center gap-2 font-medium text-brand-text">
            <MapPin className="size-3.5 text-brand-cyan" /> Plan a route
          </div>
          <p>
            Pick a starting point and a destination in the panel, or tap any
            marker on the map, then press{" "}
            <span className="text-brand-green">Find route</span>.
          </p>
        </div>
      ) : null}

      {/* Floating planner panel — desktop. */}
      <div className="absolute left-3 top-3 z-20 hidden w-[340px] flex-col overflow-hidden rounded-xl border border-brand-muted bg-brand-deep/95 shadow-float backdrop-blur md:flex">
        <div className="flex items-center justify-between border-b border-brand-muted/60 px-4 py-2.5">
          <span className="flex items-center gap-2 text-sm font-medium text-brand-text">
            <RouteIcon className="size-4 text-brand-cyan" /> Plan a route
          </span>
          <button
            type="button"
            onClick={() => setPanelCollapsed((v) => !v)}
            aria-label={panelCollapsed ? "Expand route planner" : "Collapse route planner"}
            className="rounded p-1 text-brand-subtle transition-colors hover:bg-brand-surface hover:text-brand-text"
          >
            {panelCollapsed ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
        </div>
        {!panelCollapsed ? (
          <div className="max-h-[calc(100dvh-10rem)] min-h-0 overflow-y-auto">
            <RoutingPanel />
          </div>
        ) : null}
      </div>

      {/* Planner FAB + bottom sheet — mobile. */}
      <button
        type="button"
        onClick={openPlanner}
        className="absolute bottom-20 left-3 z-20 flex items-center gap-2 rounded-full border border-brand-muted bg-brand-deep/95 px-4 py-2.5 text-sm font-medium text-brand-text shadow-float backdrop-blur transition-colors hover:bg-brand-navy md:hidden"
      >
        <RouteIcon className="size-4 text-brand-cyan" />
        Plan a route
      </button>
      <BottomSheet
        open={plannerOpen}
        onClose={() => setPlannerOpen(false)}
        title="Plan a route"
        className="h-[75vh]"
      >
        <RoutingPanel />
      </BottomSheet>

      {/* Selected-place details — desktop card (top-right; mutually exclusive
          with the hint, which only shows when nothing is selected). */}
      {selectedNode ? (
        <div className="absolute right-3 top-3 z-20 hidden w-80 rounded-xl border border-brand-muted bg-brand-deep/95 p-4 shadow-float backdrop-blur md:block">
          <BuildingDetails
            node={selectedNode}
            building={selectedBuilding}
            graph={graph!}
            onSetOrigin={() => ctx.setSourceId(selectedNode.id)}
            onSetDestination={() => ctx.setDestinationId(selectedNode.id)}
            onClose={() => {
              setSelectedNodeId(null);
              ctx.setPlace(null);
            }}
          />
        </div>
      ) : null}

      {/* Selected-place sheet — mobile. */}
      <BottomSheet
        open={Boolean(selectedNode)}
        onClose={() => {
          setSelectedNodeId(null);
          ctx.setPlace(null);
        }}
        title="Place details"
        className="h-[50vh]"
      >
        {selectedNode ? (
          <BuildingDetails
            node={selectedNode}
            building={selectedBuilding}
            graph={graph!}
            variant="full"
            onSetOrigin={() => ctx.setSourceId(selectedNode.id)}
            onSetDestination={() => ctx.setDestinationId(selectedNode.id)}
            onClose={() => {
              setSelectedNodeId(null);
              ctx.setPlace(null);
            }}
          />
        ) : null}
      </BottomSheet>
    </div>
  );
}