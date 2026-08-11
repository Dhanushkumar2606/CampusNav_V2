/**
 * Manages the two `maplibregl.Marker` instances that pin source and
 * destination on the map. Cleans up on unmount and on id change.
 */
import { useEffect } from "react";
import maplibregl from "maplibre-gl";

import type { GraphPayload } from "@/lib/navigation-types";
import { brand } from "@/lib/brand";
import { useMap } from "./MapContext";

function makeMarkerElement(color: string): HTMLDivElement {
  const el = document.createElement("div");
  el.style.width = "20px";
  el.style.height = "20px";
  el.style.borderRadius = "999px";
  el.style.backgroundColor = color;
  el.style.border = `3px solid ${brand.deep}`;
  el.style.boxShadow = `0 0 12px ${color}, 0 2px 4px rgba(0,0,0,0.6)`;
  el.style.cursor = "pointer";
  return el;
}

export function useNodeMarkers(
  graph: GraphPayload | null,
  sourceId: string | null,
  destinationId: string | null,
) {
  const map = useMap();

  useEffect(() => {
    if (!map || !graph) return;
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));

    const markers: maplibregl.Marker[] = [];

    if (sourceId) {
      const n = byId.get(sourceId);
      if (n) {
        const m = new maplibregl.Marker({ element: makeMarkerElement(brand.cyan) })
          .setLngLat([n.lng, n.lat])
          .setPopup(new maplibregl.Popup({ offset: 18 }).setText(`Source: ${n.label}`))
          .addTo(map);
        markers.push(m);
      }
    }
    if (destinationId) {
      const n = byId.get(destinationId);
      if (n) {
        const m = new maplibregl.Marker({ element: makeMarkerElement(brand.green) })
          .setLngLat([n.lng, n.lat])
          .setPopup(new maplibregl.Popup({ offset: 18 }).setText(`Destination: ${n.label}`))
          .addTo(map);
        markers.push(m);
      }
    }
    return () => {
      for (const m of markers) m.remove();
    };
  }, [map, graph, sourceId, destinationId]);
}
