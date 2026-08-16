/**
 * useLiveLocation — browser geolocation that keeps tracking the user's
 * position while the page is open (navigation mode needs a live fix, not
 * a single snapshot). Falls back to one-shot `getCurrentPosition` on
 * engines without `watchPosition`.
 *
 * Honest state machine: idle -> locating -> ok | denied | unavailable.
 * A `denied` result stops watching (permission is final for the session),
 * while a transient error (timeout) keeps the watch alive for the next
 * fix. Never fabricates coordinates.
 *
 * The browser API is reached through the locationSource seam, so tests and
 * the dev-only simulated GPS can drive the same state machine without the
 * real sensors.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getLocationSource } from "@/lib/locationSource";

export type LocateStatus = "idle" | "locating" | "ok" | "denied" | "unavailable";

export interface LocateResult {
  status: LocateStatus;
  coords: { lat: number; lng: number; accuracyM: number } | null;
  error: string | null;
}

export interface LiveLocation extends LocateResult {
  locate: () => void;
}

const INITIAL: LocateResult = { status: "idle", coords: null, error: null };

export function useLiveLocation(): LiveLocation {
  const [result, setResult] = useState<LocateResult>(INITIAL);
  const requestId = useRef(0);
  const watchIdRef = useRef<number | null>(null);

  const stopWatch = useCallback(() => {
    if (watchIdRef.current !== null) {
      getLocationSource()?.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  const locate = useCallback(() => {
    const id = ++requestId.current;
    stopWatch();
    setResult(INITIAL);

    const source = getLocationSource();
    if (!source) {
      setResult({
        status: "unavailable",
        coords: null,
        error: "Geolocation is not supported by this browser.",
      });
      return;
    }

    const success = (pos: GeolocationPosition) => {
      if (requestId.current !== id) return;
      setResult({
        status: "ok",
        coords: {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
        },
        error: null,
      });
    };
    const failure = (err: GeolocationPositionError) => {
      if (requestId.current !== id) return;
      const denied = err.code === err.PERMISSION_DENIED;
      if (denied) stopWatch();
      setResult({
        status: denied ? "denied" : "unavailable",
        coords: null,
        error: denied
          ? "Location permission denied. Enable it for this site in your browser's settings, then tap locate again."
          : "Could not determine your location.",
      });
    };

    setResult({ status: "locating", coords: null, error: null });
    const opts: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 5000,
    };
    if (typeof source.watchPosition === "function") {
      watchIdRef.current = source.watchPosition(success, failure, opts);
    } else {
      source.getCurrentPosition(success, failure, opts);
    }
  }, [stopWatch]);

  useEffect(
    () => () => {
      stopWatch();
      requestId.current++;
    },
    [stopWatch],
  );

  return { ...result, locate };
}