/**
 * sim/scenarios — deterministic scenario builds over the committed track
 * fixtures. Every scenario is a pure function of the base track (offset
 * slices, accuracy overrides), so the panel and the headless driver replay
 * identical fix sequences. No randomness, no RNG, no network at runtime.
 */
import { BOYS_HOSTEL_TO_MEDICAL_AUDITORIUM } from "@/sim/tracks";
import { withDetour, withSegmentJunk, type SimTrack } from "@/sim/locationSim";

export interface SimScenario {
  id: string;
  label: string;
  /** True when this scenario needs the back-end reachable (re-route). */
  needsBackend: boolean;
  build: () => SimTrack;
}

const BASE = BOYS_HOSTEL_TO_MEDICAL_AUDITORIUM;

/** Scenario index constants — the dev panel and the headless driver share
 *  them so the E2E run selects scenarios by id. */
export const WALK_ROUTE = "walk-route";
export const COARSE_GPS = "coarse-gps";
export const GPS_DROPOUT = "gps-dropout";
export const OFF_ROUTE_DETOUR = "off-route-detour";
export const ARRIVAL = "arrival";

const coarseFixes = BASE.fixes.map((f) => ({ ...f, accuracyM: 55 }));

export const SCENARIOS: SimScenario[] = [
  {
    id: WALK_ROUTE,
    label: "Walk route (fine GPS)",
    needsBackend: false,
    build: () => BASE,
  },
  {
    id: ARRIVAL,
    label: "Arrival run (walk to destination)",
    needsBackend: false,
    build: () => BASE,
  },
  {
    id: COARSE_GPS,
    label: "Coarse GPS (55 m — no step advance)",
    needsBackend: false,
    build: () => ({ ...BASE, id: `${BASE.id}-coarse`, fixes: coarseFixes }),
  },
  {
    id: GPS_DROPOUT,
    label: "GPS dropout ~30%→~10 s of junk fixes",
    needsBackend: false,
    build: () => withSegmentJunk(BASE, Math.floor(BASE.fixes.length * 0.3), 10),
  },
  {
    id: OFF_ROUTE_DETOUR,
    label: "Off-route detour ~35% (~25 s, then re-route)",
    needsBackend: true,
    build: () => withDetour(BASE, Math.floor(BASE.fixes.length * 0.35), 25),
  },
];

export function scenarioById(id: string): SimScenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}