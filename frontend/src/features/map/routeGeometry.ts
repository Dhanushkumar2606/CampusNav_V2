/**
 * Shared geometry helpers: build real walkway polylines from edge
 * `geometry` (falling back to straight lines), and flatten a route into
 * one continuous coordinate list the progress/off-route engine can walk.
 */
import type { GraphPayload, PathEdge, PathNode, Route, RouteStep } from "@/lib/navigation-types";

/** Coordinates ([lng, lat]) for one edge's walkable shape. */
export function edgeCoords(
  edge: Pick<PathEdge, "geometry" | "from_id" | "to_id">,
  fromNode: PathNode,
  toNode: PathNode,
  reverse = false,
): [number, number][] {
  if (edge.geometry && edge.geometry.length >= 2) {
    return reverse ? [...edge.geometry].reverse() : edge.geometry;
  }
  const pts: [number, number][] = [
    [fromNode.lng, fromNode.lat],
    [toNode.lng, toNode.lat],
  ];
  return reverse ? pts.reverse() : pts;
}

function sqDist(a: [number, number], b: [number, number]): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}

/**
 * The walkable shape for ONE route step, oriented from_node -> to_node.
 *
 * Prefers the step's own geometry (the backend orients it when building
 * the route). As a fallback (older cached responses) the edge geometry is
 * looked up in the graph and reversed when it is stored in the opposite
 * direction — detected by which endpoint it starts closer to.
 */
export function stepCoords(
  step: Pick<RouteStep, "from_node_id" | "to_node_id" | "edge_id" | "geometry">,
  graph: GraphPayload,
): [number, number][] | null {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const a = byId.get(step.from_node_id);
  const b = byId.get(step.to_node_id);
  if (!a || !b) return null;
  if (step.geometry && step.geometry.length >= 2) return step.geometry;
  const edge = graph.edges.find((e) => e.id === step.edge_id);
  if (!edge) return null;
  const coords = edgeCoords(edge, a, b);
  if (coords.length >= 2) {
    const first = coords[0];
    const startPt: [number, number] = [a.lng, a.lat];
    const endPt: [number, number] = [b.lng, b.lat];
    if (sqDist(first, endPt) < sqDist(first, startPt)) {
      return [...coords].reverse();
    }
  }
  return coords;
}

/**
 * Flatten a route into one continuous [lng, lat] polyline following each
 * step's real edge geometry (bends included), with all segments joined
 * endpoint-to-endpoint. Skips steps whose nodes are missing from the graph.
 */
export function routePolyline(route: Route, graph: GraphPayload): [number, number][] {
  const out: [number, number][] = [];
  for (const step of route.steps) {
    const coords = stepCoords(step, graph);
    if (!coords) continue;
    if (out.length === 0) {
      out.push(...coords);
    } else {
      // Skip the duplicated junction vertex for continuity of lengths.
      out.push(...coords.slice(1));
    }
  }
  return out;
}

export function polylineBounds(
  coords: [number, number][],
): [[number, number], [number, number]] | null {
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