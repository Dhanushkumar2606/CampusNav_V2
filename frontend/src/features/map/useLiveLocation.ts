/**
 * useLiveLocation — browser geolocation that keeps tracking the user's
 * position while the page is open (navigation mode needs a live fix, not
 * a single snapshot). Falls back to one-shot `getCurrentPosition` on
 * engines without `watchPosition`.
 *
 * Honest state machine: idle -> locating -> ok | denied | unavailable.
 * - `denied` stops watching (permission is final for the session).
 * - `unavailable` distinguishes POSITION_UNAVAILABLE, TIMEOUT, insecure
 *   context and missing API — each with a distinct, actionable message.
 *   TIMEOUT/UNAVAILABLE keep the watch alive and schedule controlled
 *   retries; a denied result never retries. The last good fix stays in
 *   `coords` through transient errors so the map dot never blinks out
 *   mid-walk. Never fabricates coordinates.
 *
 * Watch lifecycle:
 * - exactly one live watch at a time (re-arms replace, never stack)
 * - a watch only starts via a user action (`locate()`) or the retry/
 *   watchdog paths — never on every render
 * - `clearWatch` on denial, on re-arm, and on unmount
 *
 * Aliveness watchdog: browsers silently drop watchPosition callbacks
 * (Safari/iOS, power savers, backgrounded tabs) — the app would otherwise
 * sit on "ok" forever with a frozen dot. After one full silent gap the
 * watch is re-armed without touching the visual state, with a 25 s
 * back-off so a dead watch can't become a restart storm.
 *
 * The browser API is reached through the locationSource seam, so tests and
 * the dev-only simulated GPS can drive the same state machine without the
 * real sensors.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getLocationSource } from "@/lib/locationSource";

export type LocateStatus = "idle" | "locating" | "ok" | "denied" | "unavailable";

export type LocateErrorKind =
  | "denied"
  | "unavailable"
  | "timeout"
  | "insecure"
  | "unsupported";

export interface LocateCoords {
  lat: number;
  lng: number;
  accuracyM: number;
  /** Degrees clockwise from true north, when the device reports it. */
  headingDeg?: number;
  /** Meters/second, when the device reports it. */
  speedMps?: number;
  /** Meters above sea level, when the device reports it. */
  altitudeM?: number;
  /** Device fix timestamp (ms epoch). */
  timestamp: number;
}

export interface LocateResult {
  status: LocateStatus;
  coords: LocateCoords | null;
  /** Which failure produced the current status (undefined when ok). */
  errorKind: LocateErrorKind | null;
  /** Human-readable, code-specific error message (null when ok). */
  error: string | null;
  /** True while a controlled retry is scheduled after a transient error. */
  retrying: boolean;
  /** True when a live watch is registered with the browser/simulator. */
  watchActive: boolean;
}

export interface LiveLocation extends LocateResult {
  locate: () => void;
}

// High-accuracy fixes on phones near buildings/trees routinely take 10-15 s;
// a tighter timeout would fabricate failures on exactly the surfaces users
// walk. 20 s keeps the gate honest without stalling the UI (the state
// machine reports "locating"/"unavailable", not a hang).
const POSITION_TIMEOUT_MS = 20_000;
const POSITION_MAX_AGE_MS = 5_000;
// If a live watch goes silent for a full gap, restart it. Blink-free: the
// re-arm reuses the same success/failure contract and keeps the last fix.
const WATCH_SILENT_GAP_MS = 25_000;
const WATCH_CHECK_MS = 3_000;
// Controlled retry back-off for transient errors (re-arm cadence). Bounded
// after the first cycles: a walk under trees can drop fixes for minutes,
// so the schedule settles at a steady 30 s rather than giving up or
// hammering the browser.
const RETRY_DELAYS_MS = [4_000, 8_000, 15_000, 30_000];

export const MESSAGES = {
  denied:
    "Location permission is blocked. Allow location access in your browser settings and try again.",
  unavailable: "Your device could not obtain a GPS position. Move to an area with a clearer signal and try again.",
  timeout: "GPS is taking too long to respond. Retrying...",
  insecure: "Live location requires a secure connection (HTTPS). This page is not a secure context, so the browser blocks geolocation.",
  unsupported: "Live location is not supported by this browser.",
} as const;

const INITIAL: LocateResult = {
  status: "idle",
  coords: null,
  errorKind: null,
  error: null,
  retrying: false,
  watchActive: false,
};

type CoordsSnapshot = LocateCoords | null;

function snapshotFrom(pos: GeolocationPosition): LocateCoords {
  const c = pos.coords;
  return {
    lat: c.latitude,
    lng: c.longitude,
    accuracyM: c.accuracy,
    headingDeg: c.heading === null || Number.isNaN(c.heading) ? undefined : c.heading,
    speedMps: c.speed === null || Number.isNaN(c.speed) ? undefined : c.speed,
    altitudeM: c.altitude === null || Number.isNaN(c.altitude) ? undefined : c.altitude,
    timestamp: pos.timestamp,
  };
}

export function useLiveLocation(): LiveLocation {
  const [result, setResult] = useState<LocateResult>(INITIAL);
  const requestId = useRef(0);
  const watchIdRef = useRef<number | null>(null);
  const lastFixAtRef = useRef(0);
  const lastArmAtRef = useRef(0);
  const coordsRef = useRef<CoordsSnapshot>(null);
  const retryTimerRef = useRef<number | null>(null);
  const retryIndexRef = useRef(0);

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryIndexRef.current = 0;
  }, []);

  const stopWatch = useCallback(() => {
    if (watchIdRef.current !== null) {
      getLocationSource()?.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setResult((prev) => (prev.watchActive ? { ...prev, watchActive: false } : prev));
  }, []);

  const report = useCallback((patch: Partial<LocateResult>) => {
    setResult((prev) => ({ ...prev, ...patch }));
  }, []);

  const scheduleRetry = useCallback(
    (id: number, arm: () => void) => {
      if (retryTimerRef.current !== null) return;
      const delayMs =
        RETRY_DELAYS_MS[Math.min(retryIndexRef.current, RETRY_DELAYS_MS.length - 1)];
      retryIndexRef.current += 1;
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        // A newer user-initiated request superseded this retry — drop it.
        if (requestId.current !== id) return;
        arm();
      }, delayMs);
    },
    [],
  );

  /**
   * Start (or restart) the fix stream against the current session id.
   * Does NOT reset visible state: `locate()` handles the user-facing
   * "locating" reset, and the retry/watchdog paths call this to re-arm
   * without flickering the dot or the banner.
   */
  const arm = useCallback(() => {
    const id = ++requestId.current;
    lastArmAtRef.current = Date.now();
    stopWatch();

    const source = getLocationSource();
    if (!source) {
      clearRetry();
      report({ status: "unavailable", coords: null, errorKind: "unsupported", error: MESSAGES.unsupported, retrying: false });
      return;
    }
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      // Safari/Chrome silently fail geolocation on insecure origins — the
      // API exists but never yields a fix. Surface the real reason instead
      // of a generic "could not determine your location".
      clearRetry();
      report({ status: "unavailable", coords: coordsRef.current, errorKind: "insecure", error: MESSAGES.insecure, retrying: false });
      return;
    }

    const success = (pos: GeolocationPosition) => {
      if (requestId.current !== id) return;
      clearRetry();
      lastFixAtRef.current = Date.now();
      coordsRef.current = snapshotFrom(pos);
      report({
        status: "ok",
        coords: coordsRef.current,
        errorKind: null,
        error: null,
        retrying: false,
      });
    };
    const failure = (err: GeolocationPositionError) => {
      if (requestId.current !== id) return;
      const denied = err.code === err.PERMISSION_DENIED;
      if (denied) {
        clearRetry();
        stopWatch();
        coordsRef.current = null;
        report({ status: "denied", coords: null, errorKind: "denied", error: MESSAGES.denied, retrying: false });
        return;
      }
      const isTimeout = err.code === err.TIMEOUT;
      // Transient: keep the last good coords (the map dot never blinks),
      // keep the watch alive, and schedule a controlled re-arm retry.
      report({
        status: "unavailable",
        coords: coordsRef.current,
        errorKind: isTimeout ? "timeout" : "unavailable",
        error: isTimeout ? MESSAGES.timeout : MESSAGES.unavailable,
        retrying: true,
      });
      scheduleRetry(id, arm);
    };

    const opts: PositionOptions = {
      enableHighAccuracy: true,
      timeout: POSITION_TIMEOUT_MS,
      maximumAge: POSITION_MAX_AGE_MS,
    };
    if (typeof source.watchPosition === "function") {
      watchIdRef.current = source.watchPosition(success, failure, opts);
      setResult((prev) => ({ ...prev, watchActive: true }));
    } else {
      source.getCurrentPosition(success, failure, opts);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearRetry, report, scheduleRetry, stopWatch]);

  const locate = useCallback(() => {
    coordsRef.current = null;
    clearRetry();
    report({ status: "locating", coords: null, errorKind: null, error: null, retrying: false });
    arm();
  }, [arm, clearRetry, report]);

  // Watch-aliveness watchdog: re-arm a watch that has gone silent for a
  // full gap. Backs off to one restart per gap (a dead watch that never
  // delivers must not cause a restart storm). No-ops when no watch is
  // active (never re-prompts after a denial).
  useEffect(() => {
    const check = window.setInterval(() => {
      if (watchIdRef.current === null) return;
      if (Date.now() - lastArmAtRef.current < WATCH_SILENT_GAP_MS) return;
      if (Date.now() - lastFixAtRef.current >= WATCH_SILENT_GAP_MS) arm();
    }, WATCH_CHECK_MS);
    return () => window.clearInterval(check);
  }, [arm]);

  useEffect(
    () => () => {
      clearRetry();
      stopWatch();
      requestId.current++;
    },
    [clearRetry, stopWatch],
  );

  return { ...result, locate };
}