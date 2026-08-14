/**
 * Manages the two `maplibregl.Marker` instances that pin source and
 * destination on the map. Cleans up on unmount and on id change.
 */
import { useEffect } from "react";
import maplibregl from "maplibre-gl";

import type { GraphPayload } from "@/lib/navigation-types";
import { brand } from "@/lib/brand";
import { useMap } from "./MapContext";

/**
 * Classic teardrop map pin (rotated -45° square with one square corner
 * rounded), a dark core with a colored rim, anchored at its tip so the
 * point sits exactly on the node.
 */
function makeMarkerElement(kind: "source" | "destination"): HTMLDivElement {
  const color = kind === "source" ? brand.cyan : brand.green;
  const el = document.createElement("div");
  el.style.position = "relative";
  el.style.width = "22px";
  el.style.height = "22px";
  el.style.borderRadius = "50% 50% 50% 0";
  el.style.transform = "rotate(-45deg)";
  el.style.background = color;
  el.style.border = `2px solid ${brand.deep}`;
  el.style.boxShadow = "0 2px 6px rgba(0,0,0,0.55)";
  el.style.cursor = "pointer";

  const core = document.createElement("div");
  core.style.position = "absolute";
  core.style.left = "7px";
  core.style.top = "7px";
  core.style.width = "8px";
  core.style.height = "8px";
  core.style.borderRadius = "999px";
  core.style.background = brand.deep;
  core.style.border = `1px solid ${color}`;
  core.style.transform = "rotate(45deg)";
  el.appendChild(core);
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
        const m = new maplibregl.Marker({
          element: makeMarkerElement("source"),
          anchor: "bottom",
        })
          .setLngLat([n.lng, n.lat])
          .setPopup(new maplibregl.Popup({ offset: 18 }).setText(`Source: ${n.label}`))
          .addTo(map);
        markers.push(m);
      }
    }
    if (destinationId) {
      const n = byId.get(destinationId);
      if (n) {
        const m = new maplibregl.Marker({
          element: makeMarkerElement("destination"),
          anchor: "bottom",
        })
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
