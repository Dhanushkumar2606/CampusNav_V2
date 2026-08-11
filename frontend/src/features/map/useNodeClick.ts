/**
 * useNodeClick — wires click + hover-cursor behavior onto the invisible
 * node hit layer so the map can select buildings/landmarks.
 */
import { useEffect } from "react";
import type { MapLayerMouseEvent } from "maplibre-gl";

import { useMap } from "./MapContext";
import { GRAPH_LAYER_IDS } from "./useGraphSources";

export function useNodeClick(onSelect: (nodeId: string | null) => void) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    const layerId = GRAPH_LAYER_IDS.hit;
    if (!map.getLayer(layerId)) return;

    const onClick = (e: MapLayerMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [layerId] });
      if (features.length === 0) {
        onSelect(null);
        return;
      }
      const id = features[0].properties?.id;
      if (typeof id === "string") onSelect(id);
    };
    const onMouseMove = (e: MapLayerMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [layerId] });
      map.getCanvas().style.cursor = features.length > 0 ? "pointer" : "";
    };

    map.on("click", layerId, onClick);
    map.on("mousemove", onMouseMove);
    return () => {
      map.off("click", layerId, onClick);
      map.off("mousemove", onMouseMove);
      map.getCanvas().style.cursor = "";
    };
  }, [map, onSelect]);
}
