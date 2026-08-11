/**
 * Mounts a `maplibregl.Map` against a div ref and exposes it through
 * `MapContext`. The map owns its own lifecycle; child feature hooks
 * add sources/layers via the context.
 */
import { useEffect, useRef, useState } from "react";
import maplibregl, { Map as MlMap } from "maplibre-gl";

import { MapContext } from "./MapContext";
import { OSM_RASTER_STYLE, SRM_KTR_BOUNDS } from "./mapStyle";

export function MapCanvas({ children }: { children?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<MlMap | null>(null);

  useEffect(() => {
    if (!ref.current) return;

    const m = new maplibregl.Map({
      container: ref.current,
      style: OSM_RASTER_STYLE,
      bounds: SRM_KTR_BOUNDS,
      fitBoundsOptions: { padding: 64 },
      attributionControl: { compact: true },
    });
    // Navigation + scale controls in the top-right.
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    setMap(m);

    return () => {
      m.remove();
      setMap(null);
    };
  }, []);

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
