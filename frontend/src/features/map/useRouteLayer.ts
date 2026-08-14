/**
 * Adds / updates the A\* route polyline layer on the map. When `route`
 * changes, builds a FeatureCollection of one LineString per consecutive
 * step and writes it to a single source. fitBounds is called so the
 * user sees the whole route.
 */
import { useEffect, useMemo, useRef } from "react";
import type { Feature, FeatureCollection, LineString } from "geojson";

import type { Route } from "@/lib/navigation-types";
import { useMap } from "./MapContext";
import { ROUTE_LINE_PAINT } from "./mapStyle";
import type { GraphPayload } from "@/lib/navigation-types";

const SRC_ROUTE = "route-line";
const LYR_ROUTE = "route-line";

function buildRouteGeoJson(
  route: Route,
  graph: GraphPayload,
): FeatureCollection<LineString> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const features: Feature<LineString>[] = [];
  for (const step of route.steps) {
    const a = byId.get(step.from_node_id);
    const b = byId.get(step.to_node_id);
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
      properties: { edgeId: step.edge_id },
    });
  }
  return { type: "FeatureCollection", features };
}

function bboxFromCoords(coords: number[][]): [[number, number], [number, number]] | null {
  if (coords.length === 0) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

export function useRouteLayer(route: Route | null, graph: GraphPayload | null) {
  const map = useMap();

  const fc = useMemo<FeatureCollection<LineString> | null>(() => {
    if (!route || !graph) return null;
    return buildRouteGeoJson(route, graph);
  }, [route, graph]);

  // Add / update the source + layer. A null route removes any stale
  // polyline so a failed/cleared route never leaves a ghost line on the map.
  useEffect(() => {
    if (!map) return;
    let cancelled = false;

    const clear = () => {
      if (map.getLayer(LYR_ROUTE)) map.removeLayer(LYR_ROUTE);
      if (map.getSource(SRC_ROUTE)) map.removeSource(SRC_ROUTE);
    };

    if (!fc) {
      const clearWhenReady = () => {
        if (cancelled) return;
        clear();
      };
      if (map.isStyleLoaded()) clearWhenReady();
      else map.once("load", clearWhenReady);
      return () => {
        cancelled = true;
      };
    }

    const apply = () => {
      if (cancelled || !map.isStyleLoaded()) return;
      const existing = map.getSource(SRC_ROUTE) as
        | import("maplibre-gl").GeoJSONSource
        | undefined;
      if (existing && "setData" in existing) {
        existing.setData(fc);
      } else {
        // Ensure no stale layer from a previous mount.
        clear();
        map.addSource(SRC_ROUTE, { type: "geojson", data: fc });
        // Insert above the campus-edges layers but below the dots/labels.
        const before = map.getLayer("nodes-dot") ? "nodes-dot" : undefined;
        map.addLayer(
          {
            id: LYR_ROUTE,
            type: "line",
            source: SRC_ROUTE,
            paint: ROUTE_LINE_PAINT,
          },
          before,
        );
      }
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);

    return () => {
      cancelled = true;
    };
  }, [map, fc]);

  // Fit the camera to a NEW route only — keyed on the route reference so a
  // campus switch doesn't yank the camera around while the route is intact.
  const lastRouteRef = useRef<Route | null>(null);
  useEffect(() => {
    if (!map || !fc) return;
    if (lastRouteRef.current === route) return;
    lastRouteRef.current = route;
    const coords = fc.features.flatMap((f) => f.geometry.coordinates);
    const bbox = bboxFromCoords(coords);
    if (!bbox) return;
    map.fitBounds(bbox, { padding: 80, duration: 600, maxZoom: 17 });
  }, [map, fc, route]);
}
