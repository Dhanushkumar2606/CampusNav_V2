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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { MapAssistantPanel } from "@/features/assistant/MapAssistant";
import { SRM_KTR_BOUNDS } from "@/features/map/mapStyle";
import { boundsFromCenter, boundsFromNodes, isSafari } from "@/lib/geo";

export function MapView() {
  const ctx = useCampusRoute();
  const { graph, route, sourceId, destinationId, edgesVisible } = ctx;
  const [useWebGL, setUseWebGL] = useState<boolean>(() => CAN_USE_WEBGL && !isSafari());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);

  // /map?place=<id> deep link: open the details card for that node.
  useEffect(() => {
    if (ctx.place) setSelectedNodeId(ctx.place);
  }, [ctx.place]);

  // ---- map wiring (MapLibre branch only; Leaflet draws its own layers) ---
  useGraphSources(graph, edgesVisible);
  useRouteLayer(route, graph, ctx.navSession);
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
  const hintText = showHint
    ? !sourceId
      ? "Pick a starting point and a destination in the panel, or tap any marker on the map, then press Find route."
      : !destinationId
        ? "Starting point set — now choose a destination."
        : ctx.routeStatus === "loading"
          ? "Finding the best route…"
          : ctx.routeStatus === "error"
            ? `No route found: ${ctx.routeError ?? "please adjust your choices"}.`
            : "Ready to calculate your route."
    : "";
  const campusBounds = useMemo(() => {
    // Per-campus viewport, most precise first: the loaded graph's node
    // bounds, then the catalog center of the selected campus (covers
    // campuses whose graph is still loading or not yet seeded), then the
    // shared fallback (pre-data first paint).
    const fromNodes = boundsFromNodes(graph?.nodes ?? []);
    if (fromNodes) return fromNodes;
    const campus = ctx.campuses.find((c) => c.slug === ctx.campusSlug) ?? null;
    return boundsFromCenter(campus) ?? SRM_KTR_BOUNDS;
  }, [graph, ctx.campuses, ctx.campusSlug]);

  // Fit the camera to the active campus once per campus — covers the very
  // first paint (controller may arrive a beat after mount), geo auto-detect
  // resolving after mount, and every future campus switch. Same-campus
  // graph reloads never re-aim, so the user's pan/zoom is respected.
  const lastFitCampusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ctx.campusSlug || !ctx.mapController) return;
    if (lastFitCampusRef.current === ctx.campusSlug) return;
    lastFitCampusRef.current = ctx.campusSlug;
    ctx.mapController.recenter(campusBounds);
  }, [ctx.campusSlug, campusBounds, ctx.mapController]);

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
            initialBounds={campusBounds}
          />
        </MapErrorBoundary>
      ) : (
        <LeafletCanvas
          graph={graph}
          route={route}
          sourceId={sourceId}
          destinationId={destinationId}
          navStep={ctx.navSession.active ? ctx.navSession.stepIndex : -1}
          onSelectNode={setSelectedNodeId}
          onRegister={register}
          onUnregister={unregister}
          edgesVisible={edgesVisible}
          initialBounds={campusBounds}
        />
      )}

      {/* Map controls — shared by both renderers via the map controller. */}
      <MapControls
        campusBounds={campusBounds}
        assistantOpen={assistantOpen}
        onToggleAssistant={() => setAssistantOpen((v) => !v)}
      />

      {/* NOVA chat — hovers over the right side of the map. */}
      {assistantOpen ? <MapAssistantPanel onClose={() => setAssistantOpen(false)} /> : null}

      {/* Active routing profile as map chips (desktop). */}
      <RouteChips />

      {/* Live turn-by-turn status while navigation is running. */}
      <NavStatusBar />

      {/* Idle hint — desktop only. */}
      {showHint ? (
        <div className="pointer-events-none absolute right-3 top-3 z-20 hidden max-w-xs rounded-md border border-brand-muted/60 bg-brand-navy px-3 py-2 text-xs text-brand-subtle md:block">
          <div className="mb-1 flex items-center gap-2 font-medium text-brand-text">
            <MapPin className="size-3.5 text-brand-cyan" /> Plan a route
          </div>
          <p>{hintText}</p>
        </div>
      ) : null}

      {/* Floating planner panel — desktop. */}
      <div className="absolute left-3 top-3 z-20 hidden w-[340px] flex-col overflow-hidden rounded-xl border border-brand-muted bg-brand-deep shadow-float md:flex">
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

      {/* Planner FAB + bottom sheet — mobile (hidden while navigating). */}
      {!ctx.navSession.active ? (
        <button
          type="button"
          onClick={openPlanner}
          className="absolute bottom-20 left-3 z-20 flex items-center gap-2 rounded-full border border-brand-muted bg-brand-deep px-4 py-2.5 text-sm font-medium text-brand-text shadow-float transition-colors hover:bg-brand-navy md:hidden"
        >
          <RouteIcon className="size-4 text-brand-cyan" />
          Plan a route
        </button>
      ) : null}
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
        <div className="absolute right-3 top-3 z-20 hidden w-80 rounded-xl border border-brand-muted bg-brand-deep p-4 shadow-float md:block">
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