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
    expect(result.current.coords).toEqual(expect.objectContaining({ lat: 12.82, lng: 80.04, accuracyM: 8 }));
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
    expect(result.current.errorKind).toBe("timeout");
    expect(result.current.error).toMatch(/Retrying/);
    expect(result.current.retrying).toBe(true);
    // Watch survives: the next fix must land.
    expect(stub.watches.size).toBe(1);
    expect(result.current.watchActive).toBe(true);

    act(() => stub.pushFix(12.82, 80.04, 8));
    expect(result.current.status).toBe("ok");
    expect(result.current.coords?.lat).toBe(12.82);
    expect(result.current.retrying).toBe(false);
    expect(result.current.errorKind).toBeNull();
  });

  it("maps POSITION_UNAVAILABLE to a distinct, actionable error", () => {
    const stub = new StubSource();
    setLocationSourceOverride(stub);
    const { result } = renderHook(() => useLiveLocation());

    act(() => result.current.locate());
    act(() => stub.pushError(2));

    expect(result.current.status).toBe("unavailable");
    expect(result.current.errorKind).toBe("unavailable");
    expect(result.current.error).toMatch(/clearer signal/);
    expect(result.current.retrying).toBe(true);
  });

  it("reports an insecure context honestly instead of a generic failure", () => {
    const stub = new StubSource();
    setLocationSourceOverride(stub);
    const { result } = renderHook(() => useLiveLocation());

    const original = Object.getOwnPropertyDescriptor(window, "isSecureContext");
    Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });

    act(() => result.current.locate());
    expect(result.current.status).toBe("unavailable");
    expect(result.current.errorKind).toBe("insecure");
    expect(result.current.error).toMatch(/HTTPS/);
    expect(result.current.retrying).toBe(false);
    // No watch is registered against the browser.
    expect(stub.watches.size).toBe(0);

    // Restore for the rest of the suite (other tests need a secure context).
    if (original) Object.defineProperty(window, "isSecureContext", original);
    else delete (window as { isSecureContext?: boolean }).isSecureContext;
  });

  it("exposes the live watch state and stops it on denial", () => {
    const stub = new StubSource();
    setLocationSourceOverride(stub);
    const { result } = renderHook(() => useLiveLocation());

    expect(result.current.watchActive).toBe(false);
    act(() => result.current.locate());
    expect(result.current.watchActive).toBe(true);

    act(() => stub.pushError(1));
    expect(result.current.watchActive).toBe(false);
    expect(stub.watches.size).toBe(0);
  });

  it("retries a transient failure by re-arming the watch on a controlled delay", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const stub = new StubSource();
    setLocationSourceOverride(stub);
    const { result } = renderHook(() => useLiveLocation());

    act(() => result.current.locate());
    act(() => stub.pushError(3));
    expect(result.current.retrying).toBe(true);

    // First retry at 4 s: the watch is replaced, not stacked.
    act(() => vi.advanceTimersByTime(4_500));
    expect(stub.cleared).toHaveLength(1);
    expect(stub.watches.size).toBe(1);
    expect(result.current.watchActive).toBe(true);
    // The retried watch delivers again.
    act(() => stub.pushFix(12.85, 80.07, 9));
    expect(result.current.status).toBe("ok");
    expect(result.current.retrying).toBe(false);

    vi.useRealTimers();
  });

  it("keeps the last good coords through a transient error (dot never blinks)", () => {
    const stub = new StubSource();
    setLocationSourceOverride(stub);
    const { result } = renderHook(() => useLiveLocation());

    act(() => result.current.locate());
    act(() => stub.pushFix(12.82, 80.04, 8));
    expect(result.current.status).toBe("ok");

    // A timeout mid-walk must not erase the fix the map is showing.
    act(() => stub.pushError(3));
    expect(result.current.status).toBe("unavailable");
    expect(result.current.coords).toEqual(expect.objectContaining({ lat: 12.82, lng: 80.04, accuracyM: 8 }));
    // And the watch is still live, so recovery needs no user action.
    expect(stub.watches.size).toBe(1);

    act(() => stub.pushFix(12.83, 80.05, 7));
    expect(result.current.status).toBe("ok");
    expect(result.current.coords?.lat).toBe(12.83);
  });

  it("a denied error clears the fix even after an ok was delivered", () => {
    const stub = new StubSource();
    setLocationSourceOverride(stub);
    const { result } = renderHook(() => useLiveLocation());

    act(() => result.current.locate());
    act(() => stub.pushFix(12.82, 80.04, 8));

    act(() => stub.pushError(1));
    expect(result.current.status).toBe("denied");
    expect(result.current.coords).toBeNull();
    expect(stub.watches.size).toBe(0);
  });

  it("re-arms a silently dead watch without resetting the visible fix", () => {
    // Fake Date too: the watchdog measures the silent gap with Date.now().
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    const stub = new StubSource();
    setLocationSourceOverride(stub);
    const { result } = renderHook(() => useLiveLocation());

    act(() => result.current.locate());
    act(() => stub.pushFix(12.82, 80.04, 8));
    expect(stub.watches.size).toBe(1);

    // No fixes for one full silent gap: the watchdog must restart the watch
    // while keeping the last fix on screen (browsers drop watches silently).
    act(() => vi.advanceTimersByTime(30_000));
    expect(stub.cleared).toHaveLength(1);
    expect(stub.watches.size).toBe(1);
    expect(result.current.status).toBe("ok");
    expect(result.current.coords).toEqual(expect.objectContaining({ lat: 12.82, lng: 80.04, accuracyM: 8 }));

    // The re-armed watch delivers fixes again.
    act(() => stub.pushFix(12.84, 80.06, 6));
    expect(result.current.status).toBe("ok");
    expect(result.current.coords?.lat).toBe(12.84);

    vi.useRealTimers();
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
    expect(result.current.coords).toEqual(expect.objectContaining({ lat: 12.8, lng: 80.0, accuracyM: 12 }));
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
    expect(result.current.coords).toEqual(expect.objectContaining({ lat: 12.825, lng: 80.042, accuracyM: 8 }));
    act(() => result.current.locate());
    expect(result.current.status).toBe("locating");
  });
});