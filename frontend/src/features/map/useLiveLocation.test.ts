/**
 * useLiveLocation state-machine tests — driven through the LocationSource
 * seam with a controllable stub, never the real browser API.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useLiveLocation } from "@/features/map/useLiveLocation";
import {
  setLocationSourceOverride,
  type LocationSource,
} from "@/lib/locationSource";
import { createSimulatedLocationSource } from "@/sim/locationSim";

/** Controllable LocationSource stub for these tests. */
class StubSource implements LocationSource {
  watches = new Map<number, { success: PositionCallback; error: PositionErrorCallback | null }>();
  cleared: number[] = [];
  private nextId = 1;

  watchPosition(success: PositionCallback, error: PositionErrorCallback | null) {
    const id = this.nextId++;
    this.watches.set(id, { success, error });
    return id;
  }
  clearWatch(id: number) {
    this.cleared.push(id);
    this.watches.delete(id);
  }
  getCurrentPosition(_success: PositionCallback, error: PositionErrorCallback | null) {
    (error ?? (() => {}))(makeError(2, "stub unavailable"));
  }
  pushFix(lat: number, lng: number, accuracyM = 10) {
    for (const w of this.watches.values()) w.success(makePosition(lat, lng, accuracyM));
  }
  pushError(code: 1 | 2 | 3) {
    for (const w of this.watches.values()) w.error?.(makeError(code, `code ${code}`));
  }
}

function makePosition(lat: number, lng: number, accuracy: number): GeolocationPosition {
  return {
    coords: {
      latitude: lat,
      longitude: lng,
      accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
    timestamp: Date.now(),
  } as GeolocationPosition;
}

function makeError(code: number, message: string): GeolocationPositionError {
  return {
    code,
    message,
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  } as GeolocationPositionError;
}

afterEach(() => {
  setLocationSourceOverride(null);
  vi.useRealTimers();
});

describe("useLiveLocation", () => {
  it("idle -> locating -> ok with a fix", async () => {
    const stub = new StubSource();
    setLocationSourceOverride(stub);
    const { result } = renderHook(() => useLiveLocation());

    expect(result.current.status).toBe("idle");

    act(() => result.current.locate());
    expect(result.current.status).toBe("locating");

    act(() => stub.pushFix(12.82, 80.04, 8));
    expect(result.current.status).toBe("ok");
    expect(result.current.coords).toEqual({ lat: 12.82, lng: 80.04, accuracyM: 8 });
    expect(result.current.error).toBeNull();
  });

  it("permission denied stops the watch", () => {
    const stub = new StubSource();
    setLocationSourceOverride(stub);
    const { result } = renderHook(() => useLiveLocation());

    act(() => result.current.locate());
    act(() => stub.pushError(1));

    expect(result.current.status).toBe("denied");
    expect(result.current.coords).toBeNull();
    expect(stub.watches.size).toBe(0);
    expect(stub.cleared.length).toBe(1);
  });

  it("transient timeout keeps the watch alive for the next fix", () => {
    const stub = new StubSource();
    setLocationSourceOverride(stub);
    const { result } = renderHook(() => useLiveLocation());

    act(() => result.current.locate());
    act(() => stub.pushError(3));

    expect(result.current.status).toBe("unavailable");
    // Watch survives: the next fix must land.
    expect(stub.watches.size).toBe(1);

    act(() => stub.pushFix(12.82, 80.04, 8));
    expect(result.current.status).toBe("ok");
    expect(result.current.coords?.lat).toBe(12.82);
  });

  it("a second locate() supersedes stale results from the first watch", () => {
    const stub = new StubSource();
    setLocationSourceOverride(stub);
    const { result } = renderHook(() => useLiveLocation());

    act(() => result.current.locate());
    act(() => result.current.locate());
    // Only one watch lives at a time.
    expect(stub.watches.size).toBe(1);
    expect(stub.cleared.length).toBe(1);
    expect(result.current.status).toBe("locating");

    act(() => stub.pushFix(12.8, 80.0, 12));
    expect(result.current.status).toBe("ok");
    expect(result.current.coords).toEqual({ lat: 12.8, lng: 80.0, accuracyM: 12 });
  });

  it("reports unavailable when no location source exists", () => {
    // jsdom ships no navigator.geolocation, and no override is installed:
    // the seam resolves to null -> the hook must say "unavailable".
    setLocationSourceOverride(null);
    const { result } = renderHook(() => useLiveLocation());

    act(() => result.current.locate());
    expect(result.current.status).toBe("unavailable");
    expect(result.current.error).toMatch(/not supported/i);
  });

  it("clears the watch on unmount", () => {
    const stub = new StubSource();
    setLocationSourceOverride(stub);
    const { result, unmount } = renderHook(() => useLiveLocation());

    act(() => result.current.locate());
    expect(stub.watches.size).toBe(1);

    unmount();
    expect(stub.watches.size).toBe(0);
  });
});

describe("useLiveLocation + simulated source", () => {
  it("delivers fixes from the deterministic simulator", () => {
    const sim = createSimulatedLocationSource();
    setLocationSourceOverride(sim);
    const { result } = renderHook(() => useLiveLocation());

    act(() => result.current.locate());
    act(() => sim.control.pushFix({ lat: 12.825, lng: 80.042, accuracyM: 8 }));

    expect(result.current.status).toBe("ok");
    expect(result.current.coords).toEqual({ lat: 12.825, lng: 80.042, accuracyM: 8 });
    act(() => result.current.locate());
    expect(result.current.status).toBe("locating");
  });
});