/**
 * locationSim — deterministic simulated LocationSource.
 *
 * Replays precomputed fix tracks (committed JSON fixtures generated once
 * from real backend route geometry) at a fixed 1 s cadence, plus explicit
 * error/fix push controls for tests and the dev SimulatorPanel. The state
 * machine of useLiveLocation is untouched — the simulated source fulfills
 * the exact same watchPosition/clearWatch/getCurrentPosition contract as
 * navigator.geolocation, so every engine rule (accuracy gates, step
 * hysteresis, off-route, arrival) is exercised over real route geometry
 * with zero randomness.
 *
 * Dev/test only: production never imports this (see lib/locationSource.ts).
 */
export interface SimFix {
  lat: number;
  lng: number;
  accuracyM: number;
}

export interface SimTrack {
  id: string;
  label: string;
  sourceLabel: string;
  destLabel: string;
  totalM: number;
  /** Fixes at a fixed 1 s cadence, 0 = first fix. */
  fixes: SimFix[];
}

export type SimErrorKind = "denied" | "timeout";

interface WatchState {
  id: number;
  success: PositionCallback;
  error: PositionErrorCallback | null;
}

export interface SimulatorControl {
  /** Load a track (stops any replay; the next start() begins at fix 0). */
  loadTrack(track: SimTrack): void;
  /** Start replaying the loaded track at 1 fix/second. */
  start(): void;
  /** Pause replay (fixes stop flowing). */
  pause(): void;
  /** Stop replay and drop the track. */
  reset(): void;
  /** Jump the replay cursor to a specific fix index (0-based). */
  seek(index: number): void;
  /** Deliver one fix immediately to every active watch (test/driver API). */
  pushFix(fix: SimFix): void;
  /** Deliver a one-off geolocation error to every active watch. */
  pushError(kind: SimErrorKind): void;
  /** Override accuracy for every fix from the cursor on (deterministic). */
  setAccuracy(m: number): void;
  /** Replay speed multiplier (1 = 1 fix/second; dev/E2E use 30+). */
  setSpeed(mult: number): void;
  /** Current replay speed multiplier. */
  speed: () => number;
  /** True while a track is loaded. */
  hasTrack: () => boolean;
  /** Current track, if any. */
  getTrack: () => SimTrack | null;
  /** Cursor index in the current track, or -1. */
  cursor: () => number;
  /** True while the replay interval is running. */
  isRunning: () => boolean;
  /** Subscribe to control-state changes (panel + driver update live). */
  onChange: (cb: () => void) => () => void;
}

export interface SimulatedLocationSource {
  control: SimulatorControl;
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

const REPLAY_MS = 1000;

interface SimState {
  track: SimTrack | null;
  cursor: number;
  accuracyOverride: number | null;
  speed: number;
  interval: number | null;
  watches: Map<number, WatchState>;
  listeners: Set<() => void>;
}

let singleton: SimulatedLocationSource | null = null;

export function createSimulatedLocationSource(): SimulatedLocationSource {
  if (singleton) return singleton;

  const state: SimState = {
    track: null,
    cursor: -1,
    accuracyOverride: null,
    speed: 1,
    interval: null,
    watches: new Map(),
    listeners: new Set(),
  };
  let nextWatchId = 1;

  const notify = () => {
    for (const cb of state.listeners) cb();
  };
  const currentFix = (): SimFix | null => {
    if (!state.track || state.cursor < 0 || state.cursor >= state.track.fixes.length) return null;
    const fix = state.track.fixes[state.cursor];
    return state.accuracyOverride === null
      ? fix
      : { lat: fix.lat, lng: fix.lng, accuracyM: state.accuracyOverride };
  };

  const deliverFix = (fix: SimFix) => {
    const pos = {
      coords: {
        latitude: fix.lat,
        longitude: fix.lng,
        accuracy: fix.accuracyM,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: Date.now(),
    } as GeolocationPosition;
    for (const w of state.watches.values()) w.success(pos);
  };

  const deliverError = (kind: SimErrorKind) => {
    const code = kind === "denied" ? 1 : 3;
    const err = {
      code,
      message: kind === "denied" ? "Simulated permission denied" : "Simulated timeout",
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    } as GeolocationPositionError;
    for (const w of state.watches.values()) {
      if (w.error) w.error(err);
    }
  };

  const clearIntervalNow = () => {
    if (state.interval !== null) {
      window.clearInterval(state.interval);
      state.interval = null;
    }
  };

  const tick = () => {
    if (!state.track) {
      clearIntervalNow();
      return;
    }
    if (state.cursor + 1 < state.track.fixes.length) {
      state.cursor += 1;
      const fix = currentFix();
      if (fix) deliverFix(fix);
      notify();
    } else {
      clearIntervalNow();
      notify();
    }
  };

  const control: SimulatorControl = {
    loadTrack(track) {
      clearIntervalNow();
      state.track = track;
      state.cursor = -1;
      state.accuracyOverride = null;
      notify();
    },
    start() {
      if (!state.track) return;
      clearIntervalNow();
      if (state.cursor < 0) state.cursor = -1;
      // First fix lands immediately, then one per REPLAY_MS / speed.
      tick();
      if (state.cursor < state.track.fixes.length - 1) {
        const everyMs = Math.max(1, Math.round(REPLAY_MS / state.speed));
        state.interval = window.setInterval(tick, everyMs);
      }
      notify();
    },
    pause() {
      clearIntervalNow();
      notify();
    },
    reset() {
      clearIntervalNow();
      state.track = null;
      state.cursor = -1;
      state.accuracyOverride = null;
      notify();
    },
    seek(index) {
      if (state.track) {
        state.cursor = Math.max(0, Math.min(index, state.track.fixes.length - 1));
        notify();
      }
    },
    pushFix(fix) {
      deliverFix(fix);
      notify();
    },
    pushError(kind) {
      deliverError(kind);
      notify();
    },
    setAccuracy(m) {
      state.accuracyOverride = m;
      notify();
    },
    setSpeed(mult) {
      state.speed = Math.max(1, mult);
      notify();
    },
    speed: () => state.speed,
    hasTrack: () => state.track !== null,
    getTrack: () => state.track,
    cursor: () => state.cursor,
    isRunning: () => state.interval !== null,
    onChange(cb) {
      state.listeners.add(cb);
      return () => {
        state.listeners.delete(cb);
      };
    },
  };

  singleton = {
    control,
    watchPosition(success, error) {
      const id = nextWatchId++;
      state.watches.set(id, { id, success, error });
      // A fresh watch immediately sees the current fix (like a live watch).
      const fix = currentFix();
      if (fix) setTimeout(() => deliverFix(fix), 0);
      return id;
    },
    clearWatch(id) {
      state.watches.delete(id);
    },
    getCurrentPosition(success, error) {
      window.setTimeout(() => {
        const fix = currentFix();
        if (fix) success({
          coords: {
            latitude: fix.lat,
            longitude: fix.lng,
            accuracy: fix.accuracyM,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: Date.now(),
        } as GeolocationPosition);
        else if (error) {
          error({
            code: 3,
            message: "Simulated timeout (no track loaded)",
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          } as GeolocationPositionError);
        }
      }, 50);
    },
  };

  return singleton;
}

/** After the first fix is delivered, every subsequent fix within this many
 *  indices is skipped — used by scenario builders to freeze a walk. */
export function withSegmentJunk(
  track: SimTrack,
  fromIndex: number,
  length: number,
  accuracyM = 300,
): SimTrack {
  const fixes = track.fixes.map((f, i) =>
    i >= fromIndex && i < fromIndex + length ? { ...f, accuracyM } : f,
  );
  return { ...track, id: `${track.id}-junk`, fixes };
}

/** Offset a slice of the track by (dLat, dLng) degrees (~90 m) to simulate
 *  walking off the route, returning to the original line after `length`
 *  fixes. Deterministic detour for off-route + re-route scenarios. */
export function withDetour(
  track: SimTrack,
  fromIndex: number,
  length: number,
  dLat = 0.0009,
  dLng = 0.0008,
): SimTrack {
  const fixes = track.fixes.map((f, i) =>
    i >= fromIndex && i < fromIndex + length
      ? { lat: f.lat + dLat, lng: f.lng + dLng, accuracyM: f.accuracyM }
      : f,
  );
  return { ...track, id: `${track.id}-detour`, fixes };
}