/**
 * Mounts a `maplibregl.Map` against a div ref and exposes it through
 * `MapContext`. The map owns its own lifecycle; child feature hooks
 * add sources/layers via the context.
 *
 * If WebGL is unavailable the map fails honestly: a fallback panel is
 * rendered instead of the canvas (previously an uncaught error unmounted
 * the whole tree). If the OSM raster tiles error out (transient network
 * blips, 5xx from the tile server), the raster source is re-created —
 * maplibre marks failed tiles `errored` and won't re-request them until
 * the source is rebuilt, so this is the only public way to nudge them.
 * Retries are coalesced, bounded (2 auto-passes), and after that a small
 * banner appears with a manual retry so a dead connection isn't hammered.
 */
import { useEffect, useRef, useState } from "react";
import maplibregl, { Map as MlMap } from "maplibre-gl";

import { webglSupported } from "@/lib/geo";
import { brand } from "@/lib/brand";
import type { MapController } from "@/features/campus/CampusRouteContext";
import { MapContext } from "./MapContext";
import { MapUnavailable } from "./MapUnavailable";
import { GRAPH_LAYER_IDS } from "./useGraphSources";
import { OSM_RASTER_STYLE, SRM_KTR_BOUNDS } from "./mapStyle";

/** Coalesce bursts of failed tiles into a single reload pass. */
const RETRY_COALESCE_MS = 1500;
const MAX_AUTO_RETRIES = 2;
const RASTER_SOURCE_ID = "osm-raster";
const RASTER_SOURCE_SPEC = OSM_RASTER_STYLE.sources[RASTER_SOURCE_ID];
const ACCURACY_SOURCE_ID = "user-accuracy";
const ACCURACY_LAYER_ID = "user-accuracy-halo";

function isTileError(msg: string): boolean {
  return /could not load image/i.test(msg);
}

export function MapCanvas({
  children,
  onFallback,
  onRegister,
  onUnregister,
  edgesVisible,
}: {
  children?: React.ReactNode;
  /** Called when WebGL dies after mount — the parent swaps to the Leaflet renderer. */
  onFallback?: () => void;
  /** Registers this renderer's controller with the session (MapControls). */
  onRegister?: (controller: MapController) => void;
  /** Removes this renderer's controller (switching branches/unmount). */
  onUnregister?: (kind: MapController["kind"]) => void;
  /** Whether the graph-edge layers are visible (driven by MapControls). */
  edgesVisible?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<MlMap | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [tileBanner, setTileBanner] = useState(false);
  const failCountRef = useRef(0);
  const retryTimerRef = useRef<number | undefined>(undefined);
  const reloadRef = useRef<(() => void) | null>(null);
  const onFallbackRef = useRef(onFallback);
  onFallbackRef.current = onFallback;
  const handlersRef = useRef({ onRegister, onUnregister });
  handlersRef.current = { onRegister, onUnregister };
  const edgesVisibleRef = useRef(edgesVisible);
  edgesVisibleRef.current = edgesVisible;
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const accuracyCleanupRef = useRef<(() => void) | null>(null);
  const [userMarkerEl] = useState(() => {
    const el = document.createElement("div");
    el.style.width = "16px";
    el.style.height = "16px";
    el.style.borderRadius = "999px";
    el.style.backgroundColor = brand.cyan;
    el.style.border = `3px solid ${brand.deep}`;
    el.style.boxShadow = "0 0 0 4px rgba(45,212,191,0.3), 0 2px 6px rgba(0,0,0,0.5)";
    return el;
  });

  useEffect(() => {
    if (!ref.current || unavailable) return;
    if (!webglSupported()) {
      setUnavailable(true);
      return;
    }

    const m = new maplibregl.Map({
      container: ref.current,
      style: OSM_RASTER_STYLE,
      bounds: SRM_KTR_BOUNDS,
      fitBoundsOptions: { padding: 64 },
      attributionControl: { compact: true },
    });

    const reloadRasterSource = () => {
      try {
        if (m.getSource(RASTER_SOURCE_ID)) {
          m.removeSource(RASTER_SOURCE_ID);
          m.addSource(RASTER_SOURCE_ID, RASTER_SOURCE_SPEC as Parameters<MlMap["addSource"]>[1]);
        }
      } catch {
        // Style may be mid-swap; the next tile error will re-enter the path.
      }
    };
    reloadRef.current = reloadRasterSource;

    // If the context dies later (driver reset, GPU change), degrade to the
    // honest fallback instead of throwing out of the React tree. WebGL2
    // losses are detected by the browser reliably (that's the API contract),
    // so this is the trigger for the live renderer swap.
    const onError = (e: { error?: { message?: string } | unknown; message?: string }) => {
      const err = e?.error;
      const msg = err && typeof err === "object" && "message" in err
        ? String((err as { message?: string }).message ?? "")
        : String(e?.message ?? "");
      if (/webgl|context/i.test(msg)) {
        if (onFallbackRef.current) {
          // MapLibre can't render on this context — switch to the Leaflet
          // renderer live instead of leaving a dead canvas (the old behavior
          // showed an error panel and the map area stayed dark).
          onFallbackRef.current();
        } else {
          setUnavailable(true);
        }
        return;
      }
      if (!isTileError(msg)) return;
      failCountRef.current += 1;
      if (failCountRef.current > MAX_AUTO_RETRIES) {
        setTileBanner(true);
        return;
      }
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = window.setTimeout(() => {
        if (m.isStyleLoaded()) {
          reloadRasterSource();
        } else {
          // Style never finished loading — retrying tiles won't help yet.
          setTileBanner(true);
        }
      }, RETRY_COALESCE_MS);
    };
    m.on("error", onError);

    // A successful tile load proves the tile server is reachable again —
    // clear the failure state and dismiss the banner so a transient blip
    // doesn't stick around until a manual retry.
    const onTileLoad = () => {
      failCountRef.current = 0;
      setTileBanner(false);
      window.clearTimeout(retryTimerRef.current);
    };
    m.on("tileload", onTileLoad);

    // Direct DOM-level signals (some browsers fire these without a matching
    // map 'error' event).
    const canvasEl = m.getCanvas();
    const onContextLost = () => {
      if (onFallbackRef.current) onFallbackRef.current();
      else setUnavailable(true);
    };
    canvasEl?.addEventListener("webglcontextlost", onContextLost);
    canvasEl?.addEventListener("webglcontextcreationerror", onContextLost);

    // Navigation + scale controls in the top-right.
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    // ---- floating-control controller -----------------------------------
    const toLngLat = (bounds: [[number, number], [number, number]]) =>
      [
        [bounds[0][1], bounds[0][0]],
        [bounds[1][1], bounds[1][0]],
      ] as [[number, number], [number, number]];
    const applyEdgesVisibility = () => {
      const visible = edgesVisibleRef.current;
      for (const id of [GRAPH_LAYER_IDS.edgesEstimated, GRAPH_LAYER_IDS.edgesSurveyed]) {
        if (m.getLayer(id)) {
          m.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
        }
      }
    };
    const controller: MapController = {
      kind: "maplibre",
      getContainer: () => ref.current,
      recenter: (bounds) => m.fitBounds(toLngLat(bounds), { padding: 48, duration: 600 }),
      flyTo: (lat, lng, zoom = 16) =>
        m.flyTo({ center: [lng, lat], zoom, duration: 800 }),
      flyToBounds: (bounds) => m.fitBounds(toLngLat(bounds), { padding: 48, duration: 600 }),
      supportsBearing: true,
      resetBearing: () => m.easeTo({ bearing: 0, pitch: 0, duration: 500 }),
      setBearing: (deg) => m.easeTo({ bearing: deg, duration: 700 }),
      setUserMarker: (lat, lng) => {
        userMarkerRef.current?.remove();
        userMarkerRef.current = new maplibregl.Marker({ element: userMarkerEl })
          .setLngLat([lng, lat])
          .setPopup(new maplibregl.Popup({ offset: 14 }).setText("You are here"))
          .addTo(m);
      },
      clearUserMarker: () => {
        userMarkerRef.current?.remove();
        userMarkerRef.current = null;
      },
      setUserAccuracy: (lat, lng, radiusM) => {
        accuracyCleanupRef.current?.();
        accuracyCleanupRef.current = null;
        if (!radiusM || radiusM <= 0 || !m.isStyleLoaded()) return;
        if (m.getLayer(ACCURACY_LAYER_ID)) m.removeLayer(ACCURACY_LAYER_ID);
        if (m.getSource(ACCURACY_SOURCE_ID)) m.removeSource(ACCURACY_SOURCE_ID);
        if (!m.getSource(ACCURACY_SOURCE_ID)) {
          m.addSource(ACCURACY_SOURCE_ID, {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  geometry: { type: "Point", coordinates: [lng, lat] },
                  properties: {},
                },
              ],
            },
          });
        }
        m.addLayer({
          id: ACCURACY_LAYER_ID,
          type: "circle",
          source: ACCURACY_SOURCE_ID,
          paint: {
            "circle-color": "rgba(45,212,191,0.15)",
            "circle-stroke-color": "rgba(45,212,191,0.35)",
            "circle-stroke-width": 1,
            "circle-radius": 10, // placeholder; corrected on zoomend/moveend
          },
        });
        const updateRadius = () => {
          if (!m.isStyleLoaded() || !m.getLayer(ACCURACY_LAYER_ID)) return;
          const mPerPx = 156543.03392 * Math.cos((lat * Math.PI) / 180) / Math.pow(2, m.getZoom());
          m.setPaintProperty(ACCURACY_LAYER_ID, "circle-radius", Math.max(2, radiusM / mPerPx));
        };
        updateRadius();
        m.on("zoomend", updateRadius);
        m.once("moveend", updateRadius);
        accuracyCleanupRef.current = () => {
          m.off("zoomend", updateRadius);
        };
      },
    };
    handlersRef.current.onRegister?.(controller);
    applyEdgesVisibility();
    // Re-apply edge visibility whenever the edge source is (re)created —
    // layers added after this effect ran would otherwise ignore the toggle.
    const onSourceData = (e: { sourceId?: string; isSourceLoaded?: boolean }) => {
      if (e.sourceId === "campus-edges" && e.isSourceLoaded) applyEdgesVisibility();
    };
    m.on("sourcedata", onSourceData);

    setMap(m);

    return () => {
      window.clearTimeout(retryTimerRef.current);
      m.off("error", onError);
      m.off("tileload", onTileLoad);
      m.off("sourcedata", onSourceData);
      canvasEl?.removeEventListener("webglcontextlost", onContextLost);
      canvasEl?.removeEventListener("webglcontextcreationerror", onContextLost);
      reloadRef.current = null;
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      accuracyCleanupRef.current?.();
      accuracyCleanupRef.current = null;
      handlersRef.current.onUnregister?.("maplibre");
      m.remove();
      setMap(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live edge-visibility toggle (also covers layers added after mount via
  // the sourcedata hook registered above).
  useEffect(() => {
    if (!map) return;
    for (const id of [GRAPH_LAYER_IDS.edgesEstimated, GRAPH_LAYER_IDS.edgesSurveyed]) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", edgesVisible ? "visible" : "none");
      }
    }
  }, [map, edgesVisible]);

  const onManualRetry = () => {
    failCountRef.current = 0;
    setTileBanner(false);
    reloadRef.current?.();
  };

  if (unavailable) {
    return (
      <MapContext.Provider value={null}>
        <MapUnavailable />
      </MapContext.Provider>
    );
  }

  return (
    <MapContext.Provider value={map}>
      <div className="relative h-full w-full">
        <div ref={ref} className="absolute inset-0" />
        {/* Floating overlays can be slotted in here (popups, etc.). */}
        {map ? children : null}
        {tileBanner ? (
          <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-md border border-brand-muted bg-brand-deep/95 px-3 py-2 text-xs text-brand-text shadow-float backdrop-blur">
            <span>
              Map tiles failed to load — your connection to the tile server
              looks flaky.
            </span>
            <button
              type="button"
              onClick={onManualRetry}
              className="rounded border border-brand-muted px-2 py-1 font-medium text-brand-cyan transition-colors hover:bg-brand-surface"
            >
              Retry
            </button>
          </div>
        ) : null}
      </div>
    </MapContext.Provider>
  );
}