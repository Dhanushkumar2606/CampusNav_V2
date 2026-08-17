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
import { stepCoords } from "./routeGeometry";
import { NODE_KIND_COLORS } from "./mapStyle";
import { nodeImmersive } from "@/lib/immersive";
import type { MapController } from "@/features/campus/CampusRouteContext";
import { LeafletContext } from "./LeafletContext";
import type { LeafletMapValue } from "./LeafletContext";

const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIB =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Kinds that fade out on the Leaflet map below this zoom (infrastructure
 *  dots, not places — they slim down like the MapLibre zoom tiers). */
const MINOR_KINDS = ["junction", "transition"];
const MINOR_KIND_ZOOM = 15;

interface Props {
  graph: GraphPayload | null;
  route: Route | null;
  sourceId: string | null;
  destinationId: string | null;
  /** Active navigation step index, or -1 when not navigating. */
  navStep?: number;
  onSelectNode: (id: string | null) => void;
  onRegister?: (controller: MapController) => void;
  onUnregister?: (kind: MapController["kind"]) => void;
  edgesVisible: boolean;
  /** Opening viewport for the active campus (fit once on mount). */
  initialBounds?: [[number, number], [number, number]];
  children?: React.ReactNode;
}

function nodeIconHtml(kind: string, isBuilding: boolean, has360: boolean): string {
  const size = isBuilding ? 10 : MINOR_KINDS.includes(kind) ? 5.5 : 7;
  const offset = isBuilding ? 13 : 9;
  const color = NODE_KIND_COLORS[kind] ?? NODE_KIND_COLORS.poi;
  const ring = has360
    ? `<div style="position:absolute;inset:-5px;border-radius:999px;border:1.5px solid ${brand.cyan};opacity:.85"></div>`
    : "";
  return `<div style="position:relative;width:${size}px;height:${size}px;border-radius:999px;background:${color};border:1px solid ${brand.navy};opacity:.75;transform:translate(-50%,-50%)">${ring}</div><div style="position:absolute;left:0;top:${offset}px;white-space:nowrap;font-size:10px;color:${brand.text};text-shadow:0 1px 2px ${brand.deep};transform:translateX(-50%)"></div>`;
}

/** Teardrop map pin (start = cyan, destination = green) with a dark core,
 *  tip pointing down — anchors on the node like a classic map marker. */
function pinIconHtml(kind: "start" | "destination"): string {
  const color = kind === "start" ? brand.cyan : brand.green;
  return `<div style="position:relative;width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:2px solid ${brand.deep};box-shadow:0 2px 6px rgba(0,0,0,.55)"></div><div style="position:absolute;left:7px;top:7px;width:8px;height:8px;border-radius:999px;background:${brand.deep};border:1px solid ${color};transform:rotate(45deg)"></div>`;
}

export function LeafletCanvas({
  graph,
  route,
  sourceId,
  destinationId,
  navStep = -1,
  onSelectNode,
  onRegister,
  onUnregister,
  edgesVisible,
  initialBounds,
  children,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const nodesGroupRef = useRef<L.LayerGroup | null>(null);
  const edgesGroupRef = useRef<L.LayerGroup | null>(null);
  const routePolylineRef = useRef<L.Layer | null>(null);
  const originMarkerRef = useRef<L.Marker | null>(null);
  const destMarkerRef = useRef<L.Marker | null>(null);
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
    const raf = window.requestAnimationFrame(() => {
      m.invalidateSize();
      // Opening viewport for the active campus (fit-on-campus-change in
      // MapView re-aims later if the campus resolves after mount).
      if (initialBounds) {
        const [[swLng, swLat], [neLng, neLat]] = initialBounds;
        m.fitBounds(
          L.latLngBounds(L.latLng(swLat, swLng), L.latLng(neLat, neLng)),
          { padding: [40, 40], maxZoom: 16 },
        );
      }
    });

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
      setUserMarker: (lat, lng, headingDeg) => {
        userMarkerRef.current?.remove();
        const cone =
          headingDeg === undefined || Number.isNaN(headingDeg)
            ? ""
            : `<div style="position:absolute;left:5px;top:-22px;width:14px;height:24px;transform:rotate(${headingDeg}deg);transform-origin:50% 100%;clip-path:polygon(50% 100%,0 0,100% 0);background:linear-gradient(to bottom,rgba(45,212,191,0.9),rgba(45,212,191,0.35));"></div>`;
        const el = L.divIcon({
          className: "cn-user-icon",
          html: `<div style="position:relative;width:24px;height:24px;transform:translate(-50%,-50%)">${cone}<div style="position:absolute;inset:0;border-radius:999px;background:${brand.cyan};border:3px solid ${brand.deep};box-shadow:0 0 0 4px rgba(45,212,191,.3),0 2px 6px rgba(0,0,0,.5)"></div></div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
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
      // Follow the surveyed walkway shape when the edge has one.
      const coords: [number, number][] =
        e.geometry && e.geometry.length >= 2
          ? e.geometry.map(([lng, lat]) => [lat, lng] as [number, number])
          : [
              [a.lat, a.lng],
              [b.lat, b.lng],
            ];
      L.polyline(coords, {
        color: e.estimated ? brand.subtle : brand.green,
        weight: e.estimated ? 1.5 : 3,
        // Born hidden; shown/hidden by the edgesVisible effect below so the
        // raw network never flashes in front of a normal user.
        opacity: 0,
        dashArray: e.estimated ? "3 4" : undefined,
      }).addTo(group);
    }
    edgesGroupRef.current = group;
    if (edgesVisible) {
      edgesGroupRef.current?.eachLayer((layer) => {
        if (layer instanceof L.Polyline) layer.setStyle({ opacity: 0.7 });
      });
    }
  }, [graph, edgesVisible]);

  // ---------- nodes ----------
  const nodeKindsRef = useRef<Map<L.Marker, string> | null>(null);
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !graph) return;
    nodesGroupRef.current?.remove();
    const group = L.layerGroup().addTo(m);
    const kinds = new Map<L.Marker, string>();
    for (const n of graph.nodes) {
      const icon = L.divIcon({
        className: "cn-node-icon",
        html: nodeIconHtml(n.type, !!n.building_id, Boolean(nodeImmersive(n))),
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
      kinds.set(marker, n.type);
    }
    nodesGroupRef.current = group;
    nodeKindsRef.current = kinds;
  }, [graph, onSelectNode]);

  // ---------- origin / destination markers ----------
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !graph) return;
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));

    const removePins = () => {
      originMarkerRef.current?.remove();
      destMarkerRef.current?.remove();
      originMarkerRef.current = null;
      destMarkerRef.current = null;
    };
    removePins();

    const addPin = (nodeId: string | null, kind: "start" | "destination"): L.Marker | null => {
      const n = nodeId ? byId.get(nodeId) : null;
      if (!n) return null;
      const tip = L.divIcon({
        className: "cn-pin-icon",
        html: pinIconHtml(kind),
        iconSize: [22, 22],
        iconAnchor: [11, 22],
      });
      const marker = L.marker([n.lat, n.lng], {
        icon: tip,
        keyboard: true,
        interactive: true,
        zIndexOffset: 1000,
      });
      marker
        .bindTooltip(kind === "start" ? "Start" : "Destination", { direction: "top", offset: [0, -18] })
        .addTo(m);
      return marker;
    };

    originMarkerRef.current = addPin(sourceId, "start");
    destMarkerRef.current = addPin(destinationId, "destination");
  }, [graph, sourceId, destinationId]);

  // ---------- route polyline ----------
  // One polyline per step so the active step can be highlighted and the
  // traveled part dimmed while navigating (navStep drives the styles).
  // While navigating, the current step's endpoint also gets a pulsing amber
  // ring — "turn here next" emphasis mirroring the MapLibre renderer.
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    routePolylineRef.current?.remove();
    routePolylineRef.current = null;
    if (!route || !graph) return;

    const navigating = navStep >= 0;
    const polylines: L.Path[] = [];
    const allLatLngs: [number, number][] = [];

    route.steps.forEach((step, i) => {
      const coordsRaw = stepCoords(step, graph);
      if (!coordsRaw) return;
      const coords: [number, number][] = coordsRaw.map(([lng, lat]) => [lat, lng]);
      if (allLatLngs.length === 0) allLatLngs.push(...coords);
      else allLatLngs.push(...coords.slice(1));

      const isPast = navigating && i < navStep;
      const isCurrent = navigating && i === navStep;
      // Two stacked polylines per step: a dark casing under a cyan main line
      // (rounded caps/joins) so the route pops against bright OSM tiles.
      // Estimated steps — no real walkway geometry — render dashed, honestly.
      const mainWeight = isCurrent ? 7 : 4.5;
      const casing = L.polyline(coords, {
        color: brand.deep,
        weight: mainWeight + 3.5,
        opacity: isPast ? 0.05 : 0.4,
        lineCap: "round",
        lineJoin: "round",
      });
      const main = L.polyline(coords, {
        color: isPast ? brand.subtle : brand.cyan,
        weight: mainWeight,
        opacity: isPast ? 0.2 : isCurrent ? 1 : 0.55,
        dashArray: step.estimated ? "5 4" : undefined,
        lineCap: "round",
        lineJoin: "round",
      });
      polylines.push(casing, main);
    });
    if (polylines.length === 0) return;

    // Next-junction emphasis: pulsing amber ring at the current step's end.
    let pulseCircle: L.CircleMarker | null = null;
    let pulseTimer: number | null = null;
    if (navigating) {
      const step = route.steps[navStep];
      const coordsRaw = stepCoords(step, graph);
      const end = coordsRaw && coordsRaw.length > 0 ? coordsRaw[coordsRaw.length - 1] : null;
      if (end) {
        pulseCircle = L.circleMarker([end[1], end[0]], {
          radius: 9,
          color: brand.amber,
          weight: 2,
          fillColor: brand.amber,
          fillOpacity: 0.3,
          interactive: false,
        });
        polylines.push(pulseCircle);
        let on = false;
        pulseTimer = window.setInterval(() => {
          on = !on;
          pulseCircle?.setStyle({ fillOpacity: on ? 0.45 : 0.12 });
        }, 900);
      }
    }

    routePolylineRef.current = L.layerGroup(polylines).addTo(m);
    // Draw-in for the idle route; navigation styling applies directly.
    if (!navigating) {
      polylines.forEach((p) => p.setStyle({ opacity: 0 }));
      window.setTimeout(() => {
        polylines.forEach((p) =>
          p.setStyle({ opacity: (p.options.weight ?? 5) > 6 ? 0.4 : 0.95 }),
        );
      }, 60);
    }

    // Fit the camera to the route so it's always fully visible (only when
    // the route geometry itself changes, not on every step advance).
    if (allLatLngs.length > 1) {
      m.fitBounds(L.latLngBounds(allLatLngs), { padding: [70, 70], maxZoom: 17 });
    }
    return () => {
      if (pulseTimer !== null) window.clearInterval(pulseTimer);
      pulseCircle = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, graph, navStep]);

  // ---------- edge visibility (driven by shared MapControls) ----------
  useEffect(() => {
    edgesGroupRef.current?.eachLayer((layer) => {
      if (layer instanceof L.Polyline) {
        layer.setStyle({ opacity: edgesVisible ? 0.7 : 0 });
      }
    });
  }, [edgesVisible]);

  // ---------- node visibility (raw graph hidden for normal users) ----------
  // Markers stay mounted — they double as click targets — but the icon
  // element fades out while the debug toggle is off, and minor kinds
  // (junctions/transitions) slim to a whisper below the "places" zoom.
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !graph) return;
    const refresh = () => {
      const z = m.getZoom();
      nodesGroupRef.current?.eachLayer((layer) => {
        if (!(layer instanceof L.Marker)) return;
        const el = layer.getElement();
        if (!el) return;
        const kind = nodeKindsRef.current?.get(layer) ?? "";
        const minor = MINOR_KINDS.includes(kind) && z < MINOR_KIND_ZOOM;
        el.style.opacity = edgesVisible && !minor ? "1" : minor ? "0.15" : "0";
      });
    };
    refresh();
    m.on("zoomend", refresh);
    return () => {
      m.off("zoomend", refresh);
    };
  }, [graph, edgesVisible]);

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