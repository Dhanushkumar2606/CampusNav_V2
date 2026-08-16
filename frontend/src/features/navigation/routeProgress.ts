/**
 * routeProgress — pure geometry helpers for live turn-by-turn navigation.
 *
 * Builds a walkable model of a route (continuous polyline + cumulative
 * distances + per-step boundaries, following real OSM edge geometry), then
 * projects a live GPS fix onto it: distance along the route, progress
 * fraction, the current step, and the perpendicular distance off the route
 * (for off-route detection). No DOM/state here — everything is a function
 * of (route, graph, fix) so the tracking engine can replay fixes freely.
 */
import type { GraphPayload, Route } from "@/lib/navigation-types";
import { haversineMeters } from "@/lib/geo";
import { stepCoords } from "@/features/map/routeGeometry";

export interface RouteStepBoundary {
  toNodeId: string;
  instruction: string | null;
  startDistM: number;
  endDistM: number;
}

export interface RouteGeometryModel {
  /** Continuous route polyline as [lng, lat] (duplicated junction vertices removed). */
  polyline: [number, number][];
  /** Cumulative walked meters at each polyline vertex (cum[0] === 0). */
  cum: number[];
  totalM: number;
  steps: RouteStepBoundary[];
}

export function buildRouteGeometryModel(
  route: Route,
  graph: GraphPayload,
): RouteGeometryModel {
  const polyline: [number, number][] = [];
  // One cumulative entry per polyline vertex (cum[0] === 0). Do NOT seed
  // this with a leading zero: the loop pushes 0 for the first vertex too,
  // and a duplicated entry shifts every later lookup by one vertex, which
  // under-reports remaining distance and can make arrival unreachable.
  const cum: number[] = [];
  const steps: RouteStepBoundary[] = [];
  let walked = 0;

  for (const step of route.steps) {
    // stepCoords prefers the step's own oriented geometry (backend) and
    // falls back to a direction-aware graph lookup.
    const coords = stepCoords(step, graph);

    const startDistM = walked;
    if (coords && coords.length >= 2) {
      // First step appends every vertex; later steps skip the duplicated
      // junction vertex (the previous step's last point).
      const appendFrom = polyline.length === 0 ? 0 : 1;
      let prevPt: [number, number] = polyline.length > 0
        ? polyline[polyline.length - 1]
        : coords[0];
      for (let i = appendFrom; i < coords.length; i++) {
        const pt = coords[i];
        walked += haversineMeters(prevPt[1], prevPt[0], pt[1], pt[0]);
        polyline.push(pt);
        cum.push(walked);
        prevPt = pt;
      }
    } else {
      // Unlinkable step: keep the boundary monotonic with its nominal length.
      walked += step.distance_m ?? 0;
    }
    steps.push({ toNodeId: step.to_node_id, instruction: step.instruction, startDistM, endDistM: walked });
  }

  return { polyline, cum, totalM: walked, steps };
}

export interface RouteProjection {
  /** Distance along the route (meters) to the projected point. */
  distM: number;
  /** 0..1 overall progress along the route. */
  frac: number;
  /** Perpendicular distance (meters) of the fix from the route. */
  offRouteM: number;
  /** Step index containing the projected point (clamped to the last step). */
  stepIndex: number;
}

const M_PER_DEG_LAT = 110574;
const MAX_DEG_LAT = 89;

/**
 * Project a GPS fix onto the route model. Uses a local equirectangular
 * meter grid around the fix — accurate to <1% within a campus-sized area.
 */
export function projectOnRoute(
  lat: number,
  lng: number,
  model: RouteGeometryModel,
): RouteProjection {
  const n = model.polyline.length;
  if (n < 2) {
    return { distM: 0, frac: 0, offRouteM: Infinity, stepIndex: 0 };
  }
  const mPerDegLng = 111320 * Math.cos((Math.min(MAX_DEG_LAT, Math.max(-MAX_DEG_LAT, lat)) * Math.PI) / 180);

  let best: { distM: number; offRouteM: number } | null = null;
  let minOff = Infinity;

  for (let i = 0; i < n - 1; i++) {
    const [aLng, aLat] = model.polyline[i];
    const [bLng, bLat] = model.polyline[i + 1];

    const ax = (aLng - lng) * mPerDegLng;
    const ay = (aLat - lat) * M_PER_DEG_LAT;
    const bx = (bLng - lng) * mPerDegLng;
    const by = (bLat - lat) * M_PER_DEG_LAT;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / lenSq)) : 0;

    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const offRouteM = Math.sqrt(cx * cx + cy * cy);
    const alongM = t * Math.sqrt(lenSq);
    const distM = model.cum[i] + alongM;

    if (offRouteM < minOff) minOff = offRouteM;
    // At sharp turns several segments can tie for nearest; among near-ties
    // prefer the one furthest along the route so the walker never regresses.
    if (offRouteM <= minOff + 5 && (best === null || distM > best.distM)) {
      best = { distM, offRouteM };
    }
  }

  if (best === null) {
    return { distM: 0, frac: 0, offRouteM: Infinity, stepIndex: 0 };
  }

  let stepIndex = model.steps.length - 1;
  for (let i = 0; i < model.steps.length; i++) {
    if (best.distM <= model.steps[i].endDistM + 1e-6) {
      stepIndex = i;
      break;
    }
  }

  const total = Math.max(1e-6, model.totalM);
  return {
    distM: best.distM,
    frac: best.distM / total,
    offRouteM: best.offRouteM,
    stepIndex,
  };
}