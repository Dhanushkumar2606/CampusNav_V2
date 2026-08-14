/**
 * useNodeClick — wires click + hover-cursor behavior onto the invisible
 * node hit layer so the map can select buildings/landmarks.
 *
 * The hit layer doesn't exist until the graph sources are added (graph
 * arrives over the network, style loads independently), so attachment is
 * retried until the layer appears: once on mount, then on every
 * `sourcedata` event (the maplibre event fired whenever a source's data
 * lands) until it succeeds. Handlers are layer-scoped via
 * queryRenderedFeatures({layers:[hit]}) and guarded by getLayer so layer
 * rebuilds across campus switches are safe.
 */
import { useEffect } from "react";
import type { MapLayerMouseEvent } from "maplibre-gl";

import { useMap } from "./MapContext";
import { GRAPH_LAYER_IDS } from "./useGraphSources";

export function useNodeClick(onSelect: (nodeId: string | null) => void) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    const m = map;
    const layerId = GRAPH_LAYER_IDS.hit;
    let attached = false;
    let cancelled = false;

    const onClick = (e: MapLayerMouseEvent) => {
      if (!m.getLayer(layerId)) return;
      const features = m.queryRenderedFeatures(e.point, { layers: [layerId] });
      if (features.length === 0) {
        onSelect(null);
        return;
      }
      const id = features[0].properties?.id;
      if (typeof id === "string") onSelect(id);
    };
    const onMouseMove = (e: MapLayerMouseEvent) => {
      if (!m.getLayer(layerId)) return;
      const features = m.queryRenderedFeatures(e.point, { layers: [layerId] });
      const canvas = m.getCanvas();
      if (canvas) canvas.style.cursor = features.length > 0 ? "pointer" : "";
    };
    const onSourceData = () => maybeAttach();

    function maybeAttach() {
      if (cancelled || attached) return;
      if (!m.isStyleLoaded() || !m.getLayer(layerId)) return;
      attached = true;
      m.on("click", layerId, onClick);
      m.on("mousemove", onMouseMove);
      m.off("sourcedata", onSourceData);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
    m.on("sourcedata", onSourceData);
    maybeAttach();

    return () => {
      cancelled = true;
      m.off("sourcedata", onSourceData);
      m.off("click", layerId, onClick);
      m.off("mousemove", onMouseMove);
      const canvas = m.getCanvas();
      if (canvas) canvas.style.cursor = "";
    };
  }, [map, onSelect]);
}