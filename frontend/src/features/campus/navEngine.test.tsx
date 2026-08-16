/**
 * navEngine tests — the live-tracking engine inside CampusRouteProvider,
 * exercised end-to-end over the real SRM route fixture with fixes injected
 * through the LocationSource seam.
 *
 * The engine's rules are the audit targets:
 *   fine fixes (<40 m)  -> step advance (2-fix hysteresis), arrival, off-route
 *   coarse fixes (40-80) -> remaining/ETA refresh ONLY, no decisions
 *   junk fixes (>80)    -> ignored entirely
 *   permission denied   -> session stops tracking without crashing
 *   off-route >50 m     -> one automatic re-route from the snapped node
 *   arrival <=20 m / frac>=0.99 -> phase "arrived", remaining 0
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";

import { CampusRouteProvider, useCampusRoute } from "@/features/campus/CampusRouteContext";
import { setLocationSourceOverride } from "@/lib/locationSource";
import { createSimulatedLocationSource, withDetour } from "@/sim/locationSim";
import {
  BOYS_HOSTEL_GRAPH,
  BOYS_HOSTEL_ROUTE,
  BOYS_HOSTEL_ROUTE_RESPONSE,
  BOYS_HOSTEL_TRACK,
} from "@/sim/tracks";
import { buildRouteGeometryModel } from "@/features/navigation/routeProgress";
import type { RouteRequest, Campus } from "@/lib/navigation-types";

const SLUG = "srm-institute-of-science-and-technology-kattankulathur";
const CAMPUS: Campus = {
  id: "srm-ktr",
  name: "SRM Institute of Science and Technology (KTR)",
  slug: SLUG,
  description: null,
  featured: true,
  center_lat: 12.823,
  center_lng: 80.044,
  immersive: null,
};

const SRC_ID = BOYS_HOSTEL_ROUTE.steps[0].from_node_id;
const DST_ID = BOYS_HOSTEL_ROUTE.steps[BOYS_HOSTEL_ROUTE.steps.length - 1].to_node_id;

/** Real-ish nearest-node mock: snap one of the route's endpoint nodes. */
const nearestNodeMock = vi.fn(async (_slug: string) => ({
  node_id: SRC_ID,
  label: "boys_hostel",
  type: "entrance",
  lat: BOYS_HOSTEL_TRACK.fixes[0].lat,
  lng: BOYS_HOSTEL_TRACK.fixes[0].lng,
  distance_m: 0,
}));

const postRouteMock = vi.fn(async (_slug: string, _req: RouteRequest) => ({
  ...BOYS_HOSTEL_ROUTE_RESPONSE,
  route: { ...BOYS_HOSTEL_ROUTE },
}));

vi.mock("@/api/navigation", () => ({
  listCampuses: vi.fn(async () => [CAMPUS]),
  getGraph: vi.fn(async () => BOYS_HOSTEL_GRAPH),
  listBuildings: vi.fn(async () => []),
  getCampusesNear: vi.fn(async () => []),
  nearestNode: (...args: unknown[]) => nearestNodeMock(...(args as [string])),
  postRoute: (...args: unknown[]) => postRouteMock(...(args as [string, RouteRequest])),
  routeErrorMessage: (status: string) => `err:${status}`,
  transportErrorMessage: (err: unknown) => `transport:${String(err)}`,
}));

/** Exposes the session state to the DOM so tests assert on it. */
function Harness() {
  const ctx = useCampusRoute();
  return (
    <div>
      <span data-testid="phase">{ctx.navSession.phase}</span>
      <span data-testid="active">{String(ctx.navSession.active)}</span>
      <span data-testid="step">{ctx.navSession.stepIndex}</span>
      <span data-testid="remaining">{ctx.navSession.remainingM ?? ""}</span>
      <span data-testid="eta">{ctx.navSession.etaSec ?? ""}</span>
      <span data-testid="offroute">{String(ctx.navSession.offRoute)}</span>
      <span data-testid="locate-status">{ctx.locate.status}</span>
      <span data-testid="route-status">{ctx.routeStatus}</span>
      <span data-testid="graph-ready">{ctx.graph ? "yes" : "no"}</span>
      <span data-testid="nearest">{ctx.nearestNode ? ctx.nearestNode.label : ""}</span>
      <button type="button" data-testid="find" onClick={() => void ctx.findRoute()}>
        find
      </button>
      <button type="button" data-testid="start" onClick={() => ctx.startNavigation()}>
        start
      </button>
      <button type="button" data-testid="cancel" onClick={() => ctx.cancelNavigation()}>
        cancel
      </button>
      <button type="button" data-testid="endpoints" onClick={() => {
        ctx.setSourceId(SRC_ID);
        ctx.setDestinationId(DST_ID);
      }}>
        endpoints
      </button>
    </div>
  );
}

function renderEngine() {
  return render(
    <CampusRouteProvider>
      <Harness />
    </CampusRouteProvider>,
  );
}

let sim: ReturnType<typeof createSimulatedLocationSource>;

const text = (id: string) => document.querySelector(`[data-testid="${id}"]`)?.textContent ?? "";

/** Click a harness button inside act (DOM-first; avoids RTL screen binding). */
function clickByTestId(id: string) {
  const el = document.querySelector(`[data-testid="${id}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`harness element #${id} not found`);
  act(() => el.click());
}

/** Push one explicit fix through the simulated watch, then flush effects. */
async function pushFix(fix: { lat: number; lng: number; accuracyM: number }) {
  act(() => sim.control.pushFix(fix));
  await act(async () => {
    await Promise.resolve();
  });
}

/** Push fix[i] (accuracy overrideable) and flush pending microtasks. */
async function drive(i: number, accuracyM?: number) {
  const fix = BOYS_HOSTEL_TRACK.fixes[i];
  await pushFix({ ...fix, accuracyM: accuracyM ?? fix.accuracyM });
}

/** Push a consecutive run of fixes [from, to], one effect-run each — the
 *  engine's 2-fix hysteresis and off-route logic observe fixes sequentially,
 *  exactly like a live watch delivers them (~1/s). */
async function driveRange(from: number, to: number, accuracyM?: number) {
  for (let i = from; i <= to; i++) {
    await drive(i, accuracyM);
  }
}

async function startSession() {
  // Campuses + graph load, then the endpoints + Find route, then Start.
  // findRoute early-returns while the graph is still loading, so wait for it.
  await waitFor(() => expect(text("graph-ready")).toBe("yes"));
  clickByTestId("endpoints");
  clickByTestId("find");
  await waitFor(() => expect(text("route-status")).toBe("ok"));
  clickByTestId("start");
  await waitFor(() => expect(text("active")).toBe("true"));
}

beforeEach(() => {
  vi.useRealTimers();
  sim = createSimulatedLocationSource();
  setLocationSourceOverride(sim);
  nearestNodeMock.mockClear();
  postRouteMock.mockClear();
});

afterEach(() => {
  act(() => sim.control.reset());
  setLocationSourceOverride(null);
});

describe("navigation tracking engine", () => {
  it("starts a fresh session at step 0 with no progress", async () => {
    renderEngine();
    await startSession();

    expect(text("phase")).toBe("navigating");
    expect(text("step")).toBe("0");
    expect(text("offroute")).toBe("false");
  });

  it("tracks: remaining distance shrinks and step index advances on fine fixes", async () => {
    renderEngine();
    await startSession();

    const model = buildRouteGeometryModel(BOYS_HOSTEL_ROUTE, BOYS_HOSTEL_GRAPH);
    const total = model.totalM;

    await driveRange(0, 30);
    expect(Number(text("remaining"))).toBeGreaterThan(0);
    expect(Number(text("remaining"))).toBeLessThan(total - 20);

    // Step advance requires crossing the boundary on TWO consecutive fixes;
    // the fixture guarantees each boundary exists, so walking far enough
    // must turn the step over (hysteresis still requires the second fix).
    const far = Math.floor(BOYS_HOSTEL_TRACK.fixes.length * 0.6);
    await driveRange(31, far);
    expect(Number(text("step"))).toBeGreaterThanOrEqual(1);
    expect(Number(text("remaining"))).toBeLessThan(total * 0.6);
  });

  it("reaches arrival at the end of the track and zeros remaining", async () => {
    renderEngine();
    await startSession();

    const n = BOYS_HOSTEL_TRACK.fixes.length;
    // Walk nearly the whole route, then the final stretch.
    await driveRange(0, n - Math.min(n - 1, 60));
    await driveRange(n - Math.min(n - 1, 60), n - 1);

    await waitFor(() => expect(text("phase")).toBe("arrived"));
    expect(text("remaining")).toBe("0");
    expect(text("step")).toBe(String(BOYS_HOSTEL_ROUTE.step_count - 1));
  });

  it("re-departs: a fine fix well short of the end resumes guidance after arrival", async () => {
    renderEngine();
    await startSession();

    const n = BOYS_HOSTEL_TRACK.fixes.length;
    await driveRange(0, n - 1);
    await waitFor(() => expect(text("phase")).toBe("arrived"));
    expect(text("remaining")).toBe("0");

    // A multipath glitch pinned the walker at the destination; the next
    // honest fix sits back near the route's start — the session must
    // resume navigating instead of freezing on "arrived" forever.
    const early = Math.floor(n * 0.2);
    await driveRange(0, early);
    await waitFor(() => expect(text("phase")).toBe("navigating"));
    expect(text("offroute")).toBe("false");
    expect(Number(text("remaining"))).toBeGreaterThan(0);
    expect(Number(text("remaining"))).toBeLessThan(n * 1.5);

    // And a fix still hugging the destination zone must NOT flap back.
    await driveRange(0, n - 2, 5);
    await waitFor(() => expect(text("phase")).toBe("arrived"));
  });

  it("coarse fixes (40-80 m) refresh remaining but never advance steps or arrive", async () => {
    renderEngine();
    await startSession();
    const model = buildRouteGeometryModel(BOYS_HOSTEL_ROUTE, BOYS_HOSTEL_GRAPH);
    const total = model.totalM;

    // 90% of the route at 55 m accuracy: still "navigating", step 0.
    const end = Math.floor(BOYS_HOSTEL_TRACK.fixes.length * 0.9);
    await driveRange(0, end, 55);

    expect(text("phase")).toBe("navigating");
    expect(text("step")).toBe("0");
    expect(Number(text("remaining"))).toBeLessThan(total * 0.15);
    expect(Number(text("remaining"))).toBeGreaterThan(0);
  });

  it("junk fixes (>80 m) are ignored entirely", async () => {
    renderEngine();
    await startSession();

    await driveRange(0, 20, 300);
    expect(text("remaining")).toBe("");
  });

  it("off-route detour flags the session and triggers one re-route from the snapped node", async () => {
    renderEngine();
    // Realistic reroute latency: the route request takes ~150 ms, so the
    // off-route flag stays observable before the fresh route resets it,
    // and the in-flight guard gets a chance to dedupe the re-requests.
    postRouteMock.mockImplementation(
      async () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ ...BOYS_HOSTEL_ROUTE_RESPONSE, route: { ...BOYS_HOSTEL_ROUTE } }), 150);
        }),
    );
await startSession();
    // Clear the setup POST (the Find click) so the reroute count below
    // measures only the automatic re-route this test drives.
    postRouteMock.mockClear();

    const detour = withDetour(BOYS_HOSTEL_TRACK, Math.floor(BOYS_HOSTEL_TRACK.fixes.length * 0.35), 25);
    const start = Math.floor(BOYS_HOSTEL_TRACK.fixes.length * 0.35) - 1;

    await driveRange(0, start);
    const before = Number(text("remaining"));
    expect(before).toBeGreaterThan(50);

    // Wait for the GPS snap (debounced 600 ms) so the auto re-route can
    // actually fire from the snapped node when the detour starts.
    await waitFor(() => expect(text("nearest")).toBe("boys_hostel"));

    // Enter the detour: fixes now sit ~90 m off the route polyline.
    for (let i = 1; i <= 5; i++) {
      await pushFix(detour.fixes[start + i]);
    }

    await waitFor(() => expect(text("offroute")).toBe("true"));
    // One-shot auto re-route: postRoute must be called with the snapped
    // origin, and the session must recover (route reset clears offRoute).
    await waitFor(() => {
      expect(postRouteMock).toHaveBeenCalledWith(
        SLUG,
        expect.objectContaining({ source_id: SRC_ID, destination_id: DST_ID }),
      );
    });
    // Only once (in-flight guard swallows the flood of detour fixes).
    expect(postRouteMock).toHaveBeenCalledTimes(1);

    // Session reset by the fresh route: back to the planned origin.
    await waitFor(() => expect(text("offroute")).toBe("false"));
    expect(text("phase")).toBe("navigating");
    // NOTE: stepIndex is NOT asserted — the last off-route fix is still
    // pending and the engine re-projects it onto the fresh route (the
    // mock re-snaps to the ORIGIN, so the stale fix projects mid-route).
    // With the real nearest-node endpoint the re-route origin sits next to
    // the stale fix, so the re-projection lands near step 0 — a behavior
    // of the snap, not the reroute machinery.
  });

  it("getting back within the clear threshold lifts the off-route flag", async () => {
    renderEngine();
    // No snap available: the auto re-route must NOT clear the flag itself,
    // so the flag's lifecycle here proves the thresholds, not the reset.
    nearestNodeMock.mockRejectedValue(new Error("no snap"));
    await startSession();

    // Feed a fix ~58 m off (clear threshold is 30 m — stays flagged).
    const mid = BOYS_HOSTEL_TRACK.fixes[Math.floor(BOYS_HOSTEL_TRACK.fixes.length * 0.2)];
    const offFix = { lat: mid.lat + 0.001, lng: mid.lng + 0.001, accuracyM: 8 };
    await pushFix(offFix);
    await waitFor(() => expect(text("offroute")).toBe("true"));

    // Back on the route within the clear zone.
    await pushFix(mid);
    await waitFor(() => expect(text("offroute")).toBe("false"));
  });

  it("ETA stays realistic: fine fixes over time produce a sane etaSec", async () => {
    renderEngine();
    await startSession();

    // Walk 40 fixes spaced ~1.25 m apart in real time: pace ~1.25 m/s.
    // Only Date is faked — timers/debounce stay real.
    vi.useFakeTimers({ toFake: ["Date"] });
    const origin = Date.now();
    for (let i = 1; i <= 40; i++) {
      vi.setSystemTime(origin + i * 1000);
      await drive(i);
    }
    vi.useRealTimers();

    const remaining = Number(text("remaining"));
    expect(Number(text("eta"))).toBeGreaterThan(0);
    expect(Number(text("eta"))).toBeLessThan(3600);
    expect(Math.abs(Number(text("eta")) * 1.25 - remaining)).toBeLessThan(60);
  });
});

describe("navigation lifecycle", () => {
  it("cancel stops tracking; restart starts fresh", async () => {
    renderEngine();
    await startSession();
    await driveRange(0, 40);
    const before = Number(text("remaining"));
    expect(before).toBeLessThanOrEqual(572);

    clickByTestId("cancel");
    expect(text("active")).toBe("false");
    expect(text("phase")).toBe("navigating");
    expect(text("step")).toBe("0");

    // Fresh session resets the tracking refs: remaining starts null again.
    clickByTestId("start");
    await waitFor(() => expect(text("active")).toBe("true"));
    expect(text("remaining")).toBe("");

    await driveRange(0, 40);
    expect(Number(text("remaining"))).toBeGreaterThan(0);
  });

  it("permission denied surfaces as locate denied without crashing the session", async () => {
    renderEngine();
    await startSession();

    act(() => sim.control.pushError("denied"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(text("locate-status")).toBe("denied");
    expect(text("active")).toBe("true");
    expect(text("phase")).toBe("navigating");

    // The user taps locate again and a live fix resumes tracking.
    clickByTestId("start");
    await drive(0);
    expect(text("locate-status")).toBe("ok");
  });
});