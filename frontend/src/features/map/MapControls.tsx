/**
 * MapControls — floating map controls (recenter, locate, edge layers).
 * Custom DOM buttons styled to match MapLibre's ctrl-group look.
 */
import { Loader2, LocateFixed, LocateOff, Maximize2, Route as RouteIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";

import { useToast } from "@/components/ui/toast";
import { brand } from "@/lib/brand";
import { useMap } from "./MapContext";
import { useGeolocate } from "./useGeolocate";
import { GRAPH_LAYER_IDS } from "./useGraphSources";

export function MapControls({ campusBounds }: { campusBounds: [[number, number], [number, number]] }) {
  const map = useMap();
  const { toast } = useToast();
  const locate = useGeolocate();
  const [showEdges, setShowEdges] = useState(true);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  // Toggle edge layers visibility.
  useEffect(() => {
    if (!map) return;
    for (const id of [GRAPH_LAYER_IDS.edgesEstimated, GRAPH_LAYER_IDS.edgesSurveyed]) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", showEdges ? "visible" : "none");
      }
    }
  }, [map, showEdges]);

  // You-are-here marker following the geolocation result.
  useEffect(() => {
    if (!map) return;
    if (locate.status === "ok" && locate.coords) {
      const el = document.createElement("div");
      el.style.width = "16px";
      el.style.height = "16px";
      el.style.borderRadius = "999px";
      el.style.backgroundColor = brand.cyan;
      el.style.border = `3px solid ${brand.deep}`;
      el.style.boxShadow = `0 0 0 4px rgba(45,212,191,0.3), 0 2px 6px rgba(0,0,0,0.5)`;
      markerRef.current?.remove();
      markerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([locate.coords.lng, locate.coords.lat])
        .setPopup(new maplibregl.Popup({ offset: 14 }).setText("You are here"))
        .addTo(map);
      map.flyTo({ center: [locate.coords.lng, locate.coords.lat], zoom: 16, duration: 800 });
    } else if (locate.status === "denied" || locate.status === "unavailable") {
      markerRef.current?.remove();
      markerRef.current = null;
    }
  }, [map, locate.status, locate.coords]);

  const onLocate = () => {
    if (locate.status === "locating") return;
    if (locate.status === "ok") {
      map?.flyTo({ center: [locate.coords!.lng, locate.coords!.lat], zoom: 16, duration: 800 });
      return;
    }
    locate.locate();
    // Surface failures honestly via toast once the state settles.
    const check = (attempt: number) => {
      if (attempt > 6) return;
      if (locate.status === "denied" || locate.status === "unavailable") {
        toast({ title: "Location unavailable", description: locate.error ?? undefined, tone: "error" });
        return;
      }
      if (locate.status !== "locating") return;
      window.setTimeout(() => check(attempt + 1), 500);
    };
    check(0);
  };

  const onRecenter = () => {
    if (!map) return;
    map.fitBounds(campusBounds, { padding: 48, duration: 600 });
  };

  const btn =
    "flex h-9 w-9 items-center justify-center rounded-md text-brand-subtle transition-colors hover:bg-brand-surface hover:text-brand-text";

  return (
    <div className="absolute bottom-4 right-3 z-10 flex flex-col gap-1.5">
      <div className="flex flex-col overflow-hidden rounded-lg border border-brand-muted bg-brand-deep/90 shadow-float backdrop-blur">
        <button type="button" className={btn} onClick={onRecenter} aria-label="Recenter on campus" title="Recenter">
          <Maximize2 className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          className={btn}
          onClick={onLocate}
          aria-label="Show my location"
          title="Show my location"
        >
          {locate.status === "locating" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : locate.status === "denied" || locate.status === "unavailable" ? (
            <LocateOff className="size-4 text-brand-amber" aria-hidden />
          ) : (
            <LocateFixed className="size-4" aria-hidden />
          )}
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => setShowEdges((v) => !v)}
          aria-label={showEdges ? "Hide campus pathways" : "Show campus pathways"}
          aria-pressed={showEdges}
          title="Toggle pathways"
        >
          <RouteIcon className={showEdges ? "size-4 text-brand-cyan" : "size-4"} aria-hidden />
        </button>
      </div>
    </div>
  );
}
