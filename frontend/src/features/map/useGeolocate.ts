/**
 * useGeolocate — browser geolocation with an honest state machine.
 * Never fabricates coordinates: idle -> locating -> ok | denied | unavailable.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type LocateStatus = "idle" | "locating" | "ok" | "denied" | "unavailable";

export interface LocateResult {
  status: LocateStatus;
  coords: { lat: number; lng: number; accuracyM: number } | null;
  error: string | null;
}

const INITIAL: LocateResult = { status: "idle", coords: null, error: null };

export function useGeolocate() {
  const [result, setResult] = useState<LocateResult>(INITIAL);
  const requestId = useRef(0);

  const locate = useCallback(() => {
    const id = ++requestId.current;
    setResult(INITIAL);

    if (!("geolocation" in navigator)) {
      setResult({ status: "unavailable", coords: null, error: "Geolocation is not supported by this browser." });
      return;
    }

    setResult({ status: "locating", coords: null, error: null });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (requestId.current !== id) return;
        setResult({
          status: "ok",
          coords: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy },
          error: null,
        });
      },
      (err) => {
        if (requestId.current !== id) return;
        const denied = err.code === err.PERMISSION_DENIED;
        setResult({
          status: denied ? "denied" : "unavailable",
          coords: null,
          error: denied
            ? "Location permission denied. Enable it in your browser to use your current position."
            : "Could not determine your location.",
        });
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
    );
  }, []);

  useEffect(() => () => void requestId.current++, []);

  return { ...result, locate };
}
