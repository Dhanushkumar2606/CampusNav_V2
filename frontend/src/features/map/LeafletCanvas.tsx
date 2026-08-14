/**
 * LeafletCanvas — WebGL-free fallback renderer for the campus map.
 * Used when MapLibre can't initialize (hardware acceleration off, VMs,
 * blocked GPU drivers, Safari blank-paint failures). Same OSM raster tiles,
 * same campus graph, route, markers and controls — nothing is faked; it's a
 * second, honest renderer. Registers a MapController so the shared floating
 * controls (MapControls) drive it like they drive MapLibre.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";

import { brand, prettyLabel } from "@/lib/brand";
import type { GraphPayload, Route } from "@/lib/navigation-types";
import { boundsFromNodes, webglSupported } from "@/lib/geo";
import type { MapController } from "@/features/campus/CampusRouteContext";
import { LeafletContext } from "./LeafletContext";
import type { LeafletMapValue } from "./LeafletContext";

const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIB =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

interface Props {
  graph: GraphPayload | null;
  route: Route | null;
  sourceId: string | null;
  destinationId: string | null;
  onSelectNode: (id: string | null) => void;
  onRegister?: (controller: MapController) => void;
  onUnregister?: (kind: MapController["kind"]) => void;
  edgesVisible: boolean;
  children?: React.ReactNode;
}

function nodeIconHtml(isBuilding: boolean): string {
  const size = isBuilding ? 11 : 7;
  const offset = isBuilding ? 13 : 9;
  return `<div style="width:${size}px;height:${size}px;border-radius:999px;background:${brand.text};border:2px solid ${brand.navy};opacity:.95;transform:translate(-50%,-50%)"></div><div style="position:absolute;left:0;top:${offset}px;white-space:nowrap;font-size:10px;color:${brand.text};text-shadow:0 1px 2px ${brand.deep};transform:translateX(-50%)"></div>`;
}

export function LeafletCanvas({
  graph,
  route,
  sourceId,
  destinationId,
  onSelectNode,
  onRegister,
  onUnregister,
  edgesVisible,
  children,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const nodesGroupRef = useRef<L.LayerGroup | null>(null);
  const edgesGroupRef = useRef<L.LayerGroup | null>(null);
  const routePolylineRef = useRef<L.Polyline | null>(null);
  const originMarkerRef = useRef<L.CircleMarker | null>(null);
  const destMarkerRef = useRef<L.CircleMarker | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const accuracyCircleRef = useRef<L.Circle | null>(null);
  const [tileFailure, setTileFailure] = useState(false);
  const tileOkRef = useRef(false);
  const tileErrorCount = useRef(0);
  const tilesRef = useRef<L.TileLayer | null>(null);
  const handlersRef = useRef({ onRegister, onUnregister });
  handlersRef.current = { onRegister, onUnregister };
  const map = mapRef.current;

  const makeTiles = () => {
    const tl = L.tileLayer(OSM_TILES, { attribution: TILE_ATTRIB, maxZoom: 19 });
    tl.on("tileload", () => {
      tileOkRef.current = true;
      tileErrorCount.current = 0;
      setTileFailure(false);
    });
    tl.on("tileerror", () => {
      tileErrorCount.current += 1;
      if (!tileOkRef.current && tileErrorCount.current >= 10) {
        setTileFailure(true);
      }
    });
    return tl;
  };

  const ctxValue: LeafletMapValue = {
    map,
    edgesGroup: edgesGroupRef.current,
    routePolyline: routePolylineRef.current,
    setEdgesGroup: (g) => { edgesGroupRef.current = g; },
    setRoutePolyline: (p) => { routePolylineRef.current = p; },
  };

  // ---------- mount the Leaflet map once ----------
  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return;

    const m = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
    });
    mapRef.current = m;

    tilesRef.current = makeTiles().addTo(m);

    m.on("click", () => onSelectNode(null));

    // Safari/edge cases can mount the map before its container has layout
    // size; the map then stays at 0×0 forever. Watch the container and
    // re-measure whenever it changes (covers late CSS/fonts/layout too).
    let resizeObs: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObs = new ResizeObserver(() => {
        if (m) m.invalidateSize();
      });
      resizeObs.observe(containerRef.current);
    }
    // First frame after init: container often gains its real size then.
    const raf = window.requestAnimationFrame(() => m.invalidateSize());

    // ---- floating-control controller -----------------------------------
    const controller: MapController = {
      kind: "leaflet",
      getContainer: () => containerRef.current,
      recenter: (bounds) => {
        const [[swLng, swLat], [neLng, neLat]] = bounds;
        m.flyToBounds(L.latLngBounds(L.latLng(swLat, swLng), L.latLng(neLat, neLng)), {
          padding: [40, 40],
          duration: 0.6,
          maxZoom: 17,
        });
      },
      flyTo: (lat, lng, zoom = 16) => m.flyTo([lat, lng], zoom, { duration: 0.8 }),
      flyToBounds: (bounds) => {
        const [[swLng, swLat], [neLng, neLat]] = bounds;
        m.fitBounds(L.latLngBounds(L.latLng(swLat, swLng), L.latLng(neLat, neLng)), {
          padding: [40, 40],
          maxZoom: 17,
        });
      },
      supportsBearing: false,
      resetBearing: () => undefined,
      setBearing: () => undefined,
      setUserMarker: (lat, lng) => {
        userMarkerRef.current?.remove();
        const el = L.divIcon({
          className: "cn-user-icon",
          html: `<div style="width:16px;height:16px;border-radius:999px;background:${brand.cyan};border:3px solid ${brand.deep};box-shadow:0 0 0 4px rgba(45,212,191,.3),0 2px 6px rgba(0,0,0,.5)"></div>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        });
        userMarkerRef.current = L.marker([lat, lng], { icon: el })
          .bindTooltip("You are here")
          .addTo(m);
      },
      clearUserMarker: () => {
        userMarkerRef.current?.remove();
        userMarkerRef.current = null;
      },
      setUserAccuracy: (lat, lng, radiusM) => {
        accuracyCircleRef.current?.remove();
        accuracyCircleRef.current = null;
        if (!radiusM || radiusM <= 0) return;
        accuracyCircleRef.current = L.circle([lat, lng], {
          radius: radiusM,
          color: "rgba(45,212,191,0.35)",
          weight: 1,
          fillColor: "rgba(45,212,191,0.15)",
          fillOpacity: 1,
          interactive: false,
        }).addTo(m);
      },
    };
    handlersRef.current.onRegister?.(controller);

    return () => {
      window.cancelAnimationFrame(raf);
      resizeObs?.disconnect();
      handlersRef.current.onUnregister?.("leaflet");
      accuracyCircleRef.current?.remove();
      accuracyCircleRef.current = null;
      m.remove();
      mapRef.current = null;
    };
  }, [onSelectNode]);

  // ---------- fit to campus when the graph changes ----------
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !graph) return;
    const bbox = boundsFromNodes(graph.nodes);
    if (!bbox) return;
    const [[swLng, swLat], [neLng, neLat]] = bbox;
    m.fitBounds(L.latLngBounds(L.latLng(swLat, swLng), L.latLng(neLat, neLng)), {
      padding: [40, 40],
      maxZoom: 17,
    });
  }, [graph]);

  // ---------- edges ----------
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !graph) return;
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    edgesGroupRef.current?.remove();
    const group = L.layerGroup().addTo(m);
    for (const e of graph.edges) {
      const a = byId.get(e.from_id);
      const b = byId.get(e.to_id);
      if (!a || !b) continue;
      L.polyline(
        [
          [a.lat, a.lng],
          [b.lat, b.lng],
        ],
        {
          color: e.estimated ? brand.subtle : brand.green,
          weight: e.estimated ? 1.5 : 3,
          opacity: 0.7,
          dashArray: e.estimated ? "3 4" : undefined,
        },
      ).addTo(group);
    }
    edgesGroupRef.current = group;
  }, [graph]);

  // ---------- nodes ----------
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !graph) return;
    nodesGroupRef.current?.remove();
    const group = L.layerGroup().addTo(m);
    for (const n of graph.nodes) {
      const icon = L.divIcon({
        className: "cn-node-icon",
        html: nodeIconHtml(!!n.building_id),
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });
      const marker = L.marker([n.lat, n.lng], { icon, keyboard: true, title: prettyLabel(n.label) });
      marker.bindTooltip(prettyLabel(n.label), { direction: "top", offset: [0, -6] });
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        onSelectNode(n.id);
      });
      marker.addTo(group);
    }
    nodesGroupRef.current = group;
  }, [graph, onSelectNode]);

  // ---------- origin / destination markers ----------
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !graph) return;
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));

    originMarkerRef.current?.remove();
    destMarkerRef.current?.remove();
    originMarkerRef.current = null;
    destMarkerRef.current = null;

    const src = sourceId ? byId.get(sourceId) : null;
    const dst = destinationId ? byId.get(destinationId) : null;
    if (src) {
      originMarkerRef.current = L.circleMarker([src.lat, src.lng], {
        radius: 9,
        color: brand.deep,
        weight: 2,
        fillColor: brand.cyan,
        fillOpacity: 1,
      })
        .bindTooltip("Start", { direction: "top", offset: [0, -6] })
        .addTo(m);
    }
    if (dst) {
      destMarkerRef.current = L.circleMarker([dst.lat, dst.lng], {
        radius: 9,
        color: brand.deep,
        weight: 2,
        fillColor: brand.green,
        fillOpacity: 1,
      })
        .bindTooltip("Destination", { direction: "top", offset: [0, -6] })
        .addTo(m);
    }
  }, [graph, sourceId, destinationId]);

  // ---------- route polyline ----------
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    routePolylineRef.current?.remove();
    routePolylineRef.current = null;
    if (!route || !graph) return;

    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const latlngs: [number, number][] = [];
    for (const step of route.steps) {
      const a = byId.get(step.from_node_id);
      const b = byId.get(step.to_node_id);
      if (!a || !b) continue;
      if (latlngs.length === 0) latlngs.push([a.lat, a.lng]);
      latlngs.push([b.lat, b.lng]);
    }
    if (latlngs.length === 0) return;

    routePolylineRef.current = L.polyline(latlngs, {
      color: brand.cyan,
      weight: 5,
      opacity: 0.95,
    }).addTo(m);

    // Fit the camera to the route so it's always fully visible.
    m.fitBounds(L.latLngBounds(latlngs), { padding: [70, 70], maxZoom: 17 });
  }, [route, graph]);

  // ---------- edge visibility (driven by shared MapControls) ----------
  useEffect(() => {
    edgesGroupRef.current?.eachLayer((layer) => {
      if (layer instanceof L.Polyline) {
        layer.setStyle({ opacity: edgesVisible ? 0.7 : 0 });
      }
    });
  }, [edgesVisible]);

  const retryTiles = useCallback(() => {
    const m = mapRef.current;
    if (!m) return;
    setTileFailure(false);
    tileErrorCount.current = 0;
    tileOkRef.current = false;
    // Remove the failed layer instead of stacking a second one on top —
    // the old layer would keep erroring while the banner stays dismissed.
    tilesRef.current?.remove();
    tilesRef.current = makeTiles().addTo(m);
  }, []);

  return (
    <LeafletContext.Provider value={ctxValue}>
      <div className="relative h-full w-full">
        <div ref={containerRef} className="cn-leaflet absolute inset-0" aria-label="Campus map (compatibility mode)" role="application" />

        {tileFailure ? (
          <div className="absolute inset-0 z-[500] flex items-center justify-center bg-brand-deep/80 backdrop-blur-sm">
            <div className="max-w-sm rounded-xl border border-brand-muted bg-brand-navy/90 p-6 text-center">
              <h2 className="text-base font-semibold text-brand-text">Map tiles could not be loaded</h2>
              <p className="mt-2 text-sm text-brand-subtle">
                The free OpenStreetMap tile service didn't respond. Routing and search still work from the panel.
              </p>
              <button
                type="button"
                onClick={retryTiles}
                className="mt-4 rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-brand-deep hover:bg-brand-green/90"
              >
                Retry
              </button>
            </div>
          </div>
        ) : null}

        {children}
      </div>
    </LeafletContext.Provider>
  );
}

/** Run once at module scope: the renderer choice never changes for a session. */
export const CAN_USE_WEBGL = webglSupported();