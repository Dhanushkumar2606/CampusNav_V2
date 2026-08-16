/**
 * routeProgress tests — pure geometry engine over the committed fixture
 * route (real SRM A* route Boys Hostel → Medical Auditorium).
 *
 * Fixture-integrity tests here are load-bearing: if the simulated track
 * drifted off the route, these tests fail — the simulator would be lying.
 */
import { describe, expect, it } from "vitest";
import {
  buildRouteGeometryModel,
  projectOnRoute,
  type RouteGeometryModel,
} from "@/features/navigation/routeProgress";
import { BOYS_HOSTEL_GRAPH, BOYS_HOSTEL_ROUTE, BOYS_HOSTEL_TRACK } from "@/sim/tracks";

const model: RouteGeometryModel = buildRouteGeometryModel(BOYS_HOSTEL_ROUTE, BOYS_HOSTEL_GRAPH);

describe("buildRouteGeometryModel", () => {
  it("matches the backend total distance and step count", () => {
    expect(model.totalM).toBeGreaterThan(0);
    // The model flattens step geometry; the backend route's summed edges
    // must agree within the junction-duplicate tolerance.
    const backendTotal = BOYS_HOSTEL_ROUTE.total_distance_m;
    expect(Math.abs(model.totalM - backendTotal)).toBeLessThan(backendTotal * 0.02);
    expect(model.steps.length).toBe(BOYS_HOSTEL_ROUTE.step_count);
    expect(model.polyline.length).toBeGreaterThan(model.steps.length);
  });

  it("step boundaries are monotonic and cover [0, totalM]", () => {
    let prev = -1;
    for (const s of model.steps) {
      expect(s.startDistM).toBeGreaterThanOrEqual(prev);
      expect(s.endDistM).toBeGreaterThanOrEqual(s.startDistM);
      prev = s.endDistM;
    }
    expect(model.steps[model.steps.length - 1].endDistM).toBeCloseTo(model.totalM, 0);
    expect(model.cum[0]).toBe(0);
    expect(model.cum[model.cum.length - 1]).toBeCloseTo(model.totalM, 0);
  });
});

describe("projectOnRoute over the real fixture", () => {
  it("every simulated fix projects onto the route with negligible deviation", () => {
    // This is the whole point of the fixture: the simulated GPS track was
    // generated FROM this route's geometry, so every fix must sit on it.
    // The tolerance covers junction-vertex knife-edges (max observed ~4 m)
    // — real off-route detection looks for 50+ m — order of magnitude away.
    for (const fix of BOYS_HOSTEL_TRACK.fixes) {
      const proj = projectOnRoute(fix.lat, fix.lng, model);
      expect(proj.offRouteM).toBeLessThan(5);
    }
  });

  it("projects the track origin at dist 0 and the final fix at the full length", () => {
    const first = projectOnRoute(BOYS_HOSTEL_TRACK.fixes[0].lat, BOYS_HOSTEL_TRACK.fixes[0].lng, model);
    expect(first.distM).toBeLessThan(2);
    expect(first.stepIndex).toBe(0);

    const last = BOYS_HOSTEL_TRACK.fixes[BOYS_HOSTEL_TRACK.fixes.length - 1];
    const end = projectOnRoute(last.lat, last.lng, model);
    expect(end.distM).toBeCloseTo(model.totalM, 0);
    expect(end.frac).toBeGreaterThan(0.999);
    expect(end.stepIndex).toBe(model.steps.length - 1);
  });

  it("progress is monotonically increasing along the walked track", () => {
    let prevDist = -1;
    for (const fix of BOYS_HOSTEL_TRACK.fixes) {
      const proj = projectOnRoute(fix.lat, fix.lng, model);
      // Sub-meter wobble allowed at sharp junctions: the near-tie rule can
      // resolve a fix sitting on a vertex to the earlier segment's clamped
      // endpoint (equirectangular vs haversine meter drift). The engine's
      // step/arrival decisions ignore such drift (gates are 20-80 m).
      expect(proj.distM).toBeGreaterThanOrEqual(prevDist - 0.5);
      prevDist = proj.distM;
    }
    // The track walks ~M_PER_FIX meters per fix from the generator.
    expect(prevDist).toBeCloseTo(model.totalM, 0);
  });

  it("crosses the fixture's recorded step boundaries in order", () => {
    // Track every boundary that a step index advance would cross and check
    // the walker hits them in the fixture's order.
    const crossings: number[] = [];
    let lastStep = 0;
    for (let i = 0; i < BOYS_HOSTEL_TRACK.fixes.length; i++) {
      const proj = projectOnRoute(BOYS_HOSTEL_TRACK.fixes[i].lat, BOYS_HOSTEL_TRACK.fixes[i].lng, model);
      if (proj.stepIndex > lastStep) {
        crossings.push(i);
        lastStep = proj.stepIndex;
      }
    }
    expect(crossings.length).toBe(model.steps.length - 1);
    for (let i = 1; i < crossings.length; i++) {
      expect(crossings[i]).toBeGreaterThan(crossings[i - 1]);
    }
  });

  it("measures perpendicular deviation for off-route fixes", () => {
    // A fix offset ~90 m perpendicular to the route midpoint should report
    // ~90 m off-route while keeping a sane along-route distance.
    const mid = BOYS_HOSTEL_TRACK.fixes[Math.floor(BOYS_HOSTEL_TRACK.fixes.length / 2)];
    const off = projectOnRoute(mid.lat + 0.0008, mid.lng + 0.0008, model);
    expect(off.offRouteM).toBeGreaterThan(90);
    expect(off.offRouteM).toBeLessThan(140);
    // frac must not regress far because of the offset at the crossover.
    expect(off.frac).toBeGreaterThan(0.3);
  });

  it("a fix at the destination of a one-step route terminates at the end", () => {
    const last = BOYS_HOSTEL_TRACK.fixes[BOYS_HOSTEL_TRACK.fixes.length - 1];
    const proj = projectOnRoute(last.lat, last.lng, model);
    // The engine treats frac>=0.99 as arrived — the fixture end must satisfy it.
    expect(proj.frac).toBeGreaterThanOrEqual(0.99);
    const remaining = model.totalM - proj.distM;
    expect(remaining).toBeLessThanOrEqual(20);
  });
});

describe("projectOnRoute degenerate inputs", () => {
  it("returns a safe fallback for an empty model", () => {
    const empty: RouteGeometryModel = { polyline: [], cum: [0], totalM: 0, steps: [] };
    const proj = projectOnRoute(0, 0, empty);
    expect(proj.distM).toBe(0);
    expect(proj.frac).toBe(0);
    expect(proj.offRouteM).toBe(Infinity);
    expect(proj.stepIndex).toBe(0);
  });
});