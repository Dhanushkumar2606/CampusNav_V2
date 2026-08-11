/**
 * Drives the campus-graph rendering on the map:
 *   - One `geojson` source of node Points (campus-nodes).
 *   - One `geojson` source of edge LineStrings (campus-edges).
 *   - Two line layers filtered by `estimated`, plus a dot + label layer.
 *
 * Idempotent: when the graph or map changes, existing sources/layers
 * are removed before re-adding. This keeps the hook safe to re-run
 * whenever the user picks a different campus.
 */
import { useEffect } from "react";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";

import type { GraphPayload } from "@/lib/navigation-types";
import { useMap } from "./MapContext";
import {
  ESTIMATED_LINE_PAINT,
  NODE_CIRCLE_PAINT,
  NODE_HIT_PAINT,
  NODE_LABEL_LAYOUT,
  NODE_LABEL_PAINT,
  SURVEYED_LINE_PAINT,
} from "./mapStyle";

const SRC_NODES = "campus-nodes";
const SRC_EDGES = "campus-edges";

const LYR_EDGES_EST = "edges-estimated";
const LYR_EDGES_SUR = "edges-surveyed";
const LYR_NODES_HIT = "nodes-hit";
const LYR_NODES_DOT = "nodes-dot";
const LYR_NODES_LABEL = "nodes-label";

function nodesToFeatureCollection(graph: GraphPayload): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: graph.nodes.map(
      (n): Feature<Point> => ({
        type: "Feature",
        id: n.id,
        geometry: { type: "Point", coordinates: [n.lng, n.lat] },
        properties: {
          id: n.id,
          label: n.label,
          kind: n.type,
          isBuilding: !!n.building_id,
        },
      }),
    ),
  };
}

function edgesToFeatureCollection(graph: GraphPayload): FeatureCollection<LineString> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const features: Feature<LineString>[] = [];
  for (const e of graph.edges) {
    const a = byId.get(e.from_id);
    const b = byId.get(e.to_id);
    if (!a || !b) continue;
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [a.lng, a.lat],
          [b.lng, b.lat],
        ],
      },
      properties: {
        id: e.id,
        estimated: e.estimated,
        accessible: e.accessible,
        type: e.type,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

function removeIfExists(map: import("maplibre-gl").Map, kind: "source" | "layer", name: string) {
  if (kind === "layer" && map.getLayer(name)) map.removeLayer(name);
  if (kind === "source" && map.getSource(name)) map.removeSource(name);
}

export function useGraphSources(graph: GraphPayload | null) {
  const map = useMap();

  useEffect(() => {
    if (!map || !graph) return;
    // Skip if the data hasn't actually changed — the equality is good enough
    // because the GraphPayload reference flips on every refetch.
    let cancelled = false;

    const apply = () => {
      if (cancelled || !map.isStyleLoaded()) return;

      // Remove existing layers/sources first (idempotency).
      for (const id of [LYR_NODES_LABEL, LYR_NODES_DOT, LYR_NODES_HIT, LYR_EDGES_SUR, LYR_EDGES_EST]) {
        removeIfExists(map, "layer", id);
      }
      for (const id of [SRC_NODES, SRC_EDGES]) {
        removeIfExists(map, "source", id);
      }

      // Sources first — layers depend on them.
      map.addSource(SRC_EDGES, { type: "geojson", data: edgesToFeatureCollection(graph) });
      map.addSource(SRC_NODES, { type: "geojson", data: nodesToFeatureCollection(graph) });

      // Edges: estimated (gray dashed) drawn first, then surveyed (neon green).
      map.addLayer({
        id: LYR_EDGES_EST,
        type: "line",
        source: SRC_EDGES,
        filter: ["==", ["get", "estimated"], true],
        paint: ESTIMATED_LINE_PAINT,
      });
      map.addLayer({
        id: LYR_EDGES_SUR,
        type: "line",
        source: SRC_EDGES,
        filter: ["==", ["get", "estimated"], false],
        paint: SURVEYED_LINE_PAINT,
      });

      // Invisible hit area for clicks.
      map.addLayer({
        id: LYR_NODES_HIT,
        type: "circle",
        source: SRC_NODES,
        paint: NODE_HIT_PAINT,
      });
      // Visible dots.
      map.addLayer({
        id: LYR_NODES_DOT,
        type: "circle",
        source: SRC_NODES,
        paint: NODE_CIRCLE_PAINT,
      });
      // Labels for building nodes only.
      map.addLayer({
        id: LYR_NODES_LABEL,
        type: "symbol",
        source: SRC_NODES,
        filter: ["==", ["get", "isBuilding"], true],
        layout: NODE_LABEL_LAYOUT,
        paint: NODE_LABEL_PAINT,
      });
    };

    if (map.isStyleLoaded()) {
      apply();
    } else {
      map.once("load", apply);
    }

    return () => {
      cancelled = true;
    };
  }, [map, graph]);
}

/** IDs the rest of the app needs to wire interactions. */
export const GRAPH_LAYER_IDS = {
  hit: LYR_NODES_HIT,
  dot: LYR_NODES_DOT,
  edgesEstimated: LYR_EDGES_EST,
  edgesSurveyed: LYR_EDGES_SUR,
} as const;
