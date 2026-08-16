/**
 * locationSource — the single seam between CampusNav and the browser GPS.
 *
 * Every geolocation call site (live tracking, campus auto-detect, nearby
 * campuses) goes through getLocationSource() instead of touching
 * navigator.geolocation directly. Production always receives the real
 * browser API. Development builds can opt into a deterministic simulated
 * source (VITE_SIMULATED_GPS=true) so the whole navigation flow can be
 * verified without moving — and tests inject their own source via
 * setLocationSourceOverride().
 *
 * The simulated provider is dev-only by construction: import.meta.env.DEV
 * is statically replaced with false during production builds, so the
 * simulation branch (and its fixture data) is dead code that Rollup
 * eliminates from the shipped bundle. The simulator can never reach a
 * production user.
 */
import { createSimulatedLocationSource } from "@/sim/locationSim";

export interface LocationSource {
  watchPosition(
    success: PositionCallback,
    error: PositionErrorCallback | null,
    options?: PositionOptions,
  ): number;
  clearWatch(id: number): void;
  getCurrentPosition(
    success: PositionCallback,
    error: PositionErrorCallback | null,
    options?: PositionOptions,
  ): void;
}

let overrideSource: LocationSource | null = null;
let simSource: ReturnType<typeof createSimulatedLocationSource> | null = null;

/** Test hook: install a controlled source (or null to clear). */
export function setLocationSourceOverride(source: LocationSource | null): void {
  overrideSource = source;
}

export function isSimulatedLocationEnabled(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_SIMULATED_GPS === "true";
}

export function getLocationSource(): LocationSource | null {
  if (overrideSource) return overrideSource;
  if (isSimulatedLocationEnabled()) {
    if (!simSource) {
      // Lazy singleton: the simulator keeps one watch state so the panel
      // and the hooks (live tracking + auto-detect) share the same fixes.
      simSource = createSimulatedLocationSource();
    }
    return simSource;
  }
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) return null;
  return navigator.geolocation;
}