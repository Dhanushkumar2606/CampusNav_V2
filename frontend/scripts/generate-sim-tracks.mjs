// generate-sim-tracks.mjs — deterministic GPS track fixtures for the
// navigation simulator (dev/tests only).
//
// The fixture tracks are REAL backend route geometry: this script asks the
// running backend for an A* route between two SRM nodes, flattens the step
// geometry into one continuous polyline (same logic the frontend uses in
// routeProgress.buildRouteGeometryModel), and emits one simulated GPS fix
// per walked meter with a fixed cadence metadata. Committed to the repo so
// the simulator and tests replay an exact route with zero randomness and
// zero runtime network access.
//
// Usage:  node scripts/generate-sim-tracks.mjs   (backend on :8000)
//
// Env:    CAMPUSNAV_BASE_URL (default http://localhost:8000)
const BASE = process.env.CAMPUSNAV_BASE_URL ?? "http://localhost:8000";
const SLUG = "srm-institute-of-science-and-technology-kattankulathur";

// Meters walked per simulated second (brisk walking ~1.25 m/s). The engine
// treats fixes as arriving ~1s apart; the cadence only matters for the pace
// (speed = 1.25 m/s -> ETA math in the engine stays realistic).
const M_PER_FIX = 1.25;
const FIX_ACCURACY_M = 8;

const TRACKS = [
  {
    id: "srm-boys-hostel-to-medical-auditorium",
    label: "Boys Hostel → Medical Auditorium",
    sourceLabel: "boys_hostel",
    destLabel: "medical_auditorium",
    mode: "shortest",
    avoid_stairs: false,
    require_accessible: false,
  },
];

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Mirrors frontend src/features/map/routeGeometry.ts stepCoords() —
// prefers the step's oriented geometry, otherwise looks up the edge and
// reverses it when stored in the opposite direction.
function stepCoords(step, nodesById, edges) {
  const a = nodesById.get(step.from_node_id);
  const b = nodesById.get(step.to_node_id);
  if (!a || !b) return null;
  if (step.geometry && step.geometry.length >= 2) return step.geometry;
  const edge = edges.find((e) => e.id === step.edge_id);
  if (!edge) return null;
  const raw = edge.geometry && edge.geometry.length >= 2
    ? edge.geometry
    : [[a.lng, a.lat], [b.lng, b.lat]];
  const sq = (x) => x * x;
  const first = raw[0];
  const startPt = [a.lng, a.lat];
  const endPt = [b.lng, b.lat];
  if (sq(first[0] - endPt[0]) + sq(first[1] - endPt[1]) <
      sq(first[0] - startPt[0]) + sq(first[1] - startPt[1])) {
    return [...raw].reverse();
  }
  return raw;
}

// Mirrors buildRouteGeometryModel from routeProgress.ts (including the
// fixed cumulative array — one entry per polyline vertex, no leading dup).
function buildModel(route, nodesById, edges) {
  const polyline = [];
  const cum = [];
  let walked = 0;
  for (const step of route.steps) {
    const coords = stepCoords(step, nodesById, edges);
    if (coords && coords.length >= 2) {
      const appendFrom = polyline.length === 0 ? 0 : 1;
      let prevPt = polyline.length > 0 ? polyline[polyline.length - 1] : coords[0];
      for (let i = appendFrom; i < coords.length; i++) {
        const pt = coords[i];
        walked += haversineMeters(prevPt[1], prevPt[0], pt[1], pt[0]);
        polyline.push(pt);
        cum.push(walked);
        prevPt = pt;
      }
    } else {
      walked += step.distance_m ?? 0;
    }
  }
  return { polyline, cum, totalM: walked };
}

// Emit fixes every M_PER_FIX meters along the polyline.
function interpolate(polyline, cum, totalM) {
  const fixes = [];
  let target = 0;
  // Segment index cursor (start at segment 0 so fix 0 lands on the origin).
  let seg = 0;
  // Emit at cumulative distances 0, M_PER_FIX, 2*M_PER_FIX, ... <= totalM.
  while (target <= totalM + 1e-9) {
    while (seg < polyline.length - 2 && cum[seg + 1] < target) seg++;
    const d0 = cum[seg];
    const d1 = cum[seg + 1];
    const [aLng, aLat] = polyline[seg];
    const [bLng, bLat] = polyline[seg + 1];
    const span = Math.max(1e-9, d1 - d0);
    const t = Math.min(1, Math.max(0, (target - d0) / span));
    fixes.push({
      lat: aLat + (bLat - aLat) * t,
      lng: aLng + (bLng - aLng) * t,
      accuracyM: FIX_ACCURACY_M,
    });
    target += M_PER_FIX;
  }
  // Guarantee the final fix sits exactly on the destination node.
  const [endLng, endLat] = polyline[polyline.length - 1];
  fixes.push({ lat: endLat, lng: endLng, accuracyM: FIX_ACCURACY_M });
  return fixes;
}

async function main() {
  const graphRes = await fetch(`${BASE}/navigation/campuses/${SLUG}/graph`);
  if (!graphRes.ok) {
    throw new Error(`graph request failed (${graphRes.status} ${graphRes.statusText}) — is the backend on ${BASE}?`);
  }
  const graph = await graphRes.json();
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));

  for (const t of TRACKS) {
    const srcId = graph.labels?.[t.sourceLabel];
    const dstId = graph.labels?.[t.destLabel];
    if (!srcId || !dstId) {
      throw new Error(`labels not found: ${t.sourceLabel}=${srcId} ${t.destLabel}=${dstId}`);
    }
    const routeRes = await fetch(`${BASE}/navigation/campuses/${SLUG}/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_id: srcId,
        destination_id: dstId,
        require_accessible: t.require_accessible,
        heuristic: "haversine",
        mode: t.mode,
        avoid_stairs: t.avoid_stairs,
        alternatives: 0,
      }),
    });
    const body = await routeRes.json();
    if (body.status !== "ok" || !body.route) {
      throw new Error(`route failed: ${JSON.stringify(body)}`);
    }
    const route = body.route;
    const model = buildModel(route, nodesById, graph.edges);
    const fixes = interpolate(model.polyline, model.cum, model.totalM);

    const fixture = {
      id: t.id,
      label: t.label,
      sourceLabel: t.sourceLabel,
      destLabel: t.destLabel,
      mode: t.mode,
      totalM: Math.round(model.totalM * 10) / 10,
      stepCount: route.step_count,
      fixesPerSecond: 1,
      stepStartsM: route.steps.map((s) => s.distance_m),
      fixes,
    };

    // Route + minimal graph fixtures: same shape the frontend consumes, so
    // engine tests replay the exact route the track was derived from.
    const routeIds = new Set();
    for (const s of route.steps) {
      routeIds.add(s.from_node_id);
      routeIds.add(s.to_node_id);
      routeIds.add(s.edge_id);
    }
    const miniGraph = {
      campus: graph.campus,
      nodes: graph.nodes.filter((n) => routeIds.has(n.id)),
      edges: graph.edges.filter((e) => routeIds.has(e.id)),
      labels: {
        [t.sourceLabel]: srcId,
        [t.destLabel]: dstId,
      } ,
    };
    const routeFixture = {
      status: "ok",
      error: null,
      route,
      alternatives: [],
    };

    const fs = await import("node:fs");
    const tracksDir = new URL("../src/sim/tracks/", import.meta.url);
    fs.mkdirSync(tracksDir, { recursive: true });
    const trackPath = new URL(`${t.id}.json`, tracksDir);
    const routePath = new URL(`${t.id}.route.json`, tracksDir);
    const graphPath = new URL(`${t.id}.graph.json`, tracksDir);
    fs.writeFileSync(trackPath, JSON.stringify(fixture, null, 1) + "\n");
    fs.writeFileSync(routePath, JSON.stringify(routeFixture, null, 1) + "\n");
    fs.writeFileSync(graphPath, JSON.stringify(miniGraph, null, 1) + "\n");
    console.log(
      `wrote ${t.id} (${route.step_count} steps, ${Math.round(model.totalM)} m, ${fixes.length} fixes), route fixture + graph fixture (${miniGraph.nodes.length} nodes, ${miniGraph.edges.length} edges) -> ${tracksDir.pathname}`,
    );
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});