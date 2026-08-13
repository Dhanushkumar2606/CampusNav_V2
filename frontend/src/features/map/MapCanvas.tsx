/**
 * Mounts a `maplibregl.Map` against a div ref and exposes it through
 * `MapContext`. The map owns its own lifecycle; child feature hooks
 * add sources/layers via the context.
 *
 * If WebGL is unavailable the map fails honestly: a fallback panel is
 * rendered instead of the canvas and the rest of the app keeps working
 * (previously an uncaught error unmounted the whole tree).
 */
import { useEffect, useRef, useState } from "react";
import maplibregl, { Map as MlMap } from "maplibre-gl";

import { MapContext } from "./MapContext";
import { MapUnavailable } from "./MapUnavailable";
import { OSM_RASTER_STYLE, SRM_KTR_BOUNDS } from "./mapStyle";

/** True when the browser can create a WebGL context of any version. */
function webglSupported(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const attrs: WebGLContextAttributes = {
      failIfMajorPerformanceCaveat: false,
    };
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl2", attrs) || canvas.getContext("webgl", attrs))
    );
  } catch {
    return false;
  }
}

export function MapCanvas({ children }: { children?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<MlMap | null>(null);
  const [unavailable, setUnavailable] = useState(false);

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
    // If the context dies later (driver reset, GPU change), degrade to the
    // honest fallback instead of throwing out of the React tree.
    m.on("error", (e) => {
      const msg = e?.error ? String(e.error.message ?? e.error) : String(e?.message ?? "");
      if (/webgl|context/i.test(msg)) {
        setUnavailable(true);
      }
    });
    // Navigation + scale controls in the top-right.
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    setMap(m);

    return () => {
      m.remove();
      setMap(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      </div>
    </MapContext.Provider>
  );
}