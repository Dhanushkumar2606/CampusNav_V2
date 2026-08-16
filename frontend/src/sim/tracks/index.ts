/**
 * sim/tracks — committed deterministic GPS fixtures.
 *
 * - *.json:     fix tracks (one fix per walked meter @1.25 m/s walking
 *               pace; metadata carries the real route's step boundaries).
 * - *.route.json: the exact backend route response the track was derived
 *               from (frontend Route shape).
 * - *.graph.json: minimal real graph (nodes + edge geometry) covering the
 *               route's edges — the tracking engine needs it because the
 *               backend route response carries no per-step geometry and
 *               routeProgress falls back to graph edges (stepCoords).
 *
 * Generated once by scripts/generate-sim-tracks.mjs against the seeded
 * SRM dataset; never touched at runtime. Dev/SimulatorPanel and the vitest
 * engine tests replay them, so simulated runs and automated tests exercise
 * identical geometry.
 */
import type { GraphPayload, Route, RouteResponse } from "@/lib/navigation-types";
import type { SimFix, SimTrack } from "@/sim/locationSim";

export interface SimTrackFixture {
  id: string;
  label: string;
  sourceLabel: string;
  destLabel: string;
  mode: string;
  totalM: number;
  stepCount: number;
  fixesPerSecond: number;
  stepStartsM: number[];
  fixes: SimFix[];
}

import boysHostelTrackJson from "./srm-boys-hostel-to-medical-auditorium.json";
import boysHostelRouteJson from "./srm-boys-hostel-to-medical-auditorium.route.json";
import boysHostelGraphJson from "./srm-boys-hostel-to-medical-auditorium.graph.json";

export const BOYS_HOSTEL_TRACK: SimTrackFixture = boysHostelTrackJson;
// JSON fixtures widen tuples/enums to number[]/string — the backend emits
// the exact shapes the frontend consumes, so an explicit narrowing cast is
// the honest contract here.
export const BOYS_HOSTEL_ROUTE_RESPONSE: RouteResponse =
  boysHostelRouteJson as unknown as RouteResponse;
export const BOYS_HOSTEL_ROUTE: Route = BOYS_HOSTEL_ROUTE_RESPONSE.route as Route;
export const BOYS_HOSTEL_GRAPH: GraphPayload = boysHostelGraphJson as unknown as GraphPayload;

export function toSimTrack(fixture: SimTrackFixture): SimTrack {
  return {
    id: fixture.id,
    label: fixture.label,
    sourceLabel: fixture.sourceLabel,
    destLabel: fixture.destLabel,
    totalM: fixture.totalM,
    fixes: fixture.fixes,
  };
}

export const BOYS_HOSTEL_TO_MEDICAL_AUDITORIUM: SimTrack = toSimTrack(BOYS_HOSTEL_TRACK);