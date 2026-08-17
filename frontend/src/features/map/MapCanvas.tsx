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
import { setGraphLayersVisible } from "./useGraphSources";
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

/** DEV-only structured diagnostics — what failed, on what canvas, in what
 *  viewport, with which renderer. Tree-shaken from production bundles, so
 *  normal users never see internals (they keep the honest panels/banners). */
function logMapDiagnostics(trigger: string, detail: string): void {
  const canvas = document.querySelector(".maplibregl-canvas");
  const mapEl = document.querySelector(".maplibregl-map");
  console.info(
    `[CampusNav map] diagnostic (${trigger}): provider=maplibre-gl ` +
      `webgl2=${webglSupported()} viewport=${window.innerWidth}x${window.innerHeight} ` +
      `container=${mapEl?.clientWidth ?? "?"}x${mapEl?.clientHeight ?? "?"} ` +
      `canvas=${canvas ? `${canvas.clientWidth}x${canvas.clientHeight}` : "none"} ` +
      `style=${document.querySelectorAll(".maplibregl-missing-css").length ? "css-missing" : "css-ok"} ` +
      `detail="${detail.slice(0, 160)}"`,
  );
}

export function MapCanvas({
  children,
  onFallback,
  onRegister,
  onUnregister,
  edgesVisible,
  initialBounds,
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
  /** Opening viewport for the active campus; the shared default is only
   *  used when no campus data is known yet (first paint). */
  initialBounds?: [[number, number], [number, number]];
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
  const edgesVisibleRef = useRef<boolean>(false);
  edgesVisibleRef.current = !!edgesVisible;
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const accuracyCleanupRef = useRef<(() => void) | null>(null);
  // The marker element is created once and re-skinned on every fix: the
  // teal dot (rounded, brand border) plus a heading cone that rotates
  // around the dot when the device reports a course.
  const [userMarkerEl] = useState(() => document.createElement("div"));

  const skinUserMarker = (headingDeg?: number) => {
    const el = userMarkerEl;
    el.style.width = "24px";
    el.style.height = "24px";
    const cone = headingDeg === undefined || Number.isNaN(headingDeg)
      ? ""
      : `<div style="position:absolute;left:5px;top:-22px;width:14px;height:24px;transform:rotate(${headingDeg}deg);transform-origin:50% 100%;clip-path:polygon(50% 100%,0 0,100% 0);background:linear-gradient(to bottom,rgba(45,212,191,0.9),rgba(45,212,191,0.35));"></div>`;
    el.innerHTML =
      `<div style="position:absolute;inset:0;border-radius:999px;background:${brand.cyan};border:3px solid ${brand.deep};box-shadow:0 0 0 4px rgba(45,212,191,0.3),0 2px 6px rgba(0,0,0,0.5);"></div>` +
      cone;
  };

  useEffect(() => {
    if (!ref.current || unavailable) return;
    if (!webglSupported()) {
      setUnavailable(true);
      return;
    }

    const m = new maplibregl.Map({
      container: ref.current,
      style: OSM_RASTER_STYLE,
      // Per-campus opening viewport; the SRM box is only the pre-data
      // fallback — fit-on-campus-change re-aims once the campus resolves.
      bounds: initialBounds ?? SRM_KTR_BOUNDS,
      fitBoundsOptions: { padding: 64 },
      attributionControl: { compact: true },
    });

    // ---- container-size reconciliation ----------------------------------
    // MapLibre reads the container size once at construction and afterwards
    // only on window resize (trackResize). Browsers resize the map container
    // without a window event all the time — mobile URL-bar collapse, bottom
    // nav / sheet animations, tab switches, orientation, layout settling
    // right after mount (the container can even be mid-layout when the map
    // is constructed, which pins the canvas to a stale/fractional height and
    // leaves the rest of the map blank). Watch the container directly with a
    // ResizeObserver and re-measure the map, coalesced through one rAF so a
    // burst of layout churn costs a single resize per frame — never a loop.
    let lastW = -1;
    let lastH = -1;
    let pendingResize: number | undefined = undefined;
    const resize = () => {
      pendingResize = undefined;
      const c = ref.current;
      if (!c) return;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (w === lastW && h === lastH) return;
      if (w <= 0 || h <= 0) return;
      lastW = w;
      lastH = h;
      try {
        m.resize();
      } catch {
        // Map may be mid-construction removal; the next observation retries.
      }
    };
    const scheduleResize = () => {
      if (pendingResize !== undefined) return;
      pendingResize = window.requestAnimationFrame(resize);
    };
    const resizeObs =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(scheduleResize)
        : null;
    if (resizeObs) resizeObs.observe(ref.current);
    // Reconcile right after mount: the constructor may have measured the
    // container before it had its real size (observed on Android Chrome —
    // canvas pinned to a stale height while the layout grew underneath it).
    scheduleResize();

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
      if (import.meta.env.DEV) logMapDiagnostics("error", msg);
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
      setGraphLayersVisible(m, edgesVisibleRef.current);
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
      setUserMarker: (lat, lng, headingDeg) => {
        userMarkerRef.current?.remove();
        skinUserMarker(headingDeg);
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
        if (!radiusM || radiusM <= 0) return;
        const draw = () => {
          if (!m.isStyleLoaded()) return;
          if (!m.getLayer(ACCURACY_LAYER_ID)) {
            if (m.getSource(ACCURACY_SOURCE_ID)) m.removeSource(ACCURACY_SOURCE_ID);
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
            m.addLayer({
              id: ACCURACY_LAYER_ID,
              type: "circle",
              source: ACCURACY_SOURCE_ID,
              paint: {
                "circle-color": "rgba(45,212,191,0.15)",
                "circle-stroke-color": "rgba(45,212,191,0.35)",
                "circle-stroke-width": 1,
                "circle-radius": 10, // placeholder; corrected below
              },
            });
          }
          const mPerPx = 156543.03392 * Math.cos((lat * Math.PI) / 180) / Math.pow(2, m.getZoom());
          m.setPaintProperty(ACCURACY_LAYER_ID, "circle-radius", Math.max(2, radiusM / mPerPx));
        };
        if (!m.isStyleLoaded()) {
          // Style still loading (common on the very first fix): create the
          // halo as soon as it's ready instead of dropping it silently.
          const onStyleLoad = () => draw();
          m.once("style.load", onStyleLoad);
          accuracyCleanupRef.current = () => {
            m.off("style.load", onStyleLoad);
          };
          return;
        }
        draw();
        m.on("zoomend", draw);
        m.once("moveend", draw);
        accuracyCleanupRef.current = () => {
          m.off("zoomend", draw);
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
      if (pendingResize !== undefined) window.cancelAnimationFrame(pendingResize);
      if (resizeObs) resizeObs.disconnect();
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
    setGraphLayersVisible(map, !!edgesVisible);
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