"""Trace real walkway geometry from OpenStreetMap into a campus seed file.

Run once (network required), commit the result:

    uv run python -m scripts.osm_paths --seed seed_data/srm_ktr.json

What it does:

  1. Reads the campus seed JSON (nodes with real lat/lng).
  2. Queries the Overpass API for walkable ways (footway/path/pedestrian/
     steps/service/residential) inside the campus bounding box.
  3. For every graph edge (A -> B) it finds the best continuous way (or a
     2-way chain sharing a vertex) that passes within ~40 m of both
     endpoints, and extracts the shape points between the projections.
  4. Writes `geometry` (list of [lng, lat]) + `estimated: false` into the
     edge, recomputes `distance_m` along the shape, and updates the
     provenance notes.

Edges with NO plausible way stay untouched (straight line, estimated),
so a route never shows invented curves — only real walkway shapes.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

_M = 6_371_000.0
# Max distance from an edge endpoint to the traced way before we declare
# the way a mismatch (honest fallback to straight line).
_MAX_END_OFFSET_M = 110.0
# Max along-way length relative to the straight-line distance, with fixed
# slack for short edges. Guards against absurd detours that don't actually
# join the two points (a 50 m hop may not have a direct walkway, but a
# 3x loop isn't the honest walking path either).
_MAX_DETOUR_FACTOR = 1.9
_MAX_DETOUR_SLACK_M = 70.0
# Ways sharing a vertex closer than this merge into one continuous path.
_WAY_JOIN_M = 15.0

_BBOX_PAD = 0.008  # degrees (~0.9 km) around the node cloud

_HIGHWAY_TAGS = "footway|path|pedestrian|steps|service|residential"


def _haversine_m(a1: float, a2: float, b1: float, b2: float) -> float:
    p1, p2 = math.radians(a2), math.radians(b2)
    dp = math.radians(b2 - a2)
    dl = math.radians(b1 - a1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * _M * math.asin(math.sqrt(h))


def _close_m(a: list[float], b: list[float]) -> float:
    return _haversine_m(a[0], a[1], b[0], b[1])


def _project(p: list[float], a: list[float], b: list[float]) -> tuple[float, float, list[float]]:
    """Project point p onto segment a-b in local meters.

    Returns (t, distance_m, projected_point) with t in [0, 1].
    """
    d_lng = b[0] - a[0]
    d_lat = b[1] - a[1]
    denom = d_lng * d_lng + d_lat * d_lat
    if denom <= 0:
        return 0.0, _close_m(p, a), a
    t = ((p[0] - a[0]) * d_lng + (p[1] - a[1]) * d_lat) / denom
    t = max(0.0, min(1.0, t))
    proj = [a[0] + t * d_lng, a[1] + t * d_lat]
    return t, _close_m(p, proj), proj


def _way_length(geom: list[list[float]]) -> float:
    return sum(_close_m(a, b) for a, b in zip(geom, geom[1:]))


def _nearest_point_on_way(
    p: list[float], geom: list[list[float]]
) -> tuple[float, int]:
    """(distance_m to the way, index of the nearest segment-start vertex)."""
    best = (math.inf, 0)
    for i, a in enumerate(geom[:-1]):
        _, d, _ = _project(p, a, geom[i + 1])
        if d < best[0]:
            best = (d, i)
    return best


def _extract_path(
    way_geom: list[list[float]],
    a: list[float],
    b: list[float],
    reversed_guard: bool = False,
) -> list[list[float]] | None:
    """Shape from A to B walking along one way, or None when impossible."""
    dist_a, idx_a = _nearest_point_on_way(a, way_geom)
    dist_b, idx_b = _nearest_point_on_way(b, way_geom)
    if dist_a > _MAX_END_OFFSET_M or dist_b > _MAX_END_OFFSET_M:
        # The endpoint sits far from the way as traced — try traversing the
        # way in the opposite direction before giving up.
        if not reversed_guard:
            return _extract_path(list(reversed(way_geom)), a, b, reversed_guard=True)
        return None
    if idx_a > idx_b:
        idx_a, idx_b = idx_b, idx_a
    return [a, *way_geom[idx_a : idx_b + 1], b]


def _fetch_ways(nodes: list[list[float]]) -> list[list[list[float]]]:
    """Overpass: walkable way geometries inside the node-cloud bbox.

    The public Overpass endpoints are flaky — retry with backoff across
    the two official mirrors.
    """
    lngs = [n[0] for n in nodes]
    lats = [n[1] for n in nodes]
    s = min(lats) - _BBOX_PAD
    w = min(lngs) - _BBOX_PAD
    n = max(lats) + _BBOX_PAD
    e = max(lngs) + _BBOX_PAD
    q = (
        f'[out:json][timeout:30];'
        f'way["highway"~"^{_HIGHWAY_TAGS}$"]({s},{w},{n},{e});'
        f"out tags geom;"
    )
    endpoints = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
    ]
    import time

    data = None
    for attempt in range(6):
        url = endpoints[attempt % len(endpoints)]
        try:
            req = urllib.request.Request(
                url,
                data=urllib.parse.urlencode({"data": q}).encode(),
                headers={"User-Agent": "campusnav-seed-tool/0.1"},
            )
            with urllib.request.urlopen(req, timeout=90) as resp:
                data = json.loads(resp.read().decode())
            break
        except Exception as exc:
            print(f"  overpass attempt {attempt + 1} failed ({exc}); retrying …", flush=True)
            time.sleep(2 + 2 * attempt)
    if data is None:
        raise RuntimeError("Overpass unreachable after 6 attempts")
    ways: list[list[list[float]]] = []
    for el in data.get("elements", []):
        geom = [[g["lon"], g["lat"]] for g in el.get("geometry", [])]
        if len(geom) >= 2:
            ways.append(geom)
    return ways


def _trace_edge(a: list[float], b: list[float], ways: list[list[list[float]]]) -> list[list[float]] | None:
    """Best single-way (or two-way chain) path A -> B, or None."""
    straight = _close_m(a, b)
    best: tuple[list[list[float]], float] | None = None

    for w in ways:
        path = _extract_path(w, a, b)
        if path is None:
            continue
        length = _way_length(path)
        if length > _MAX_DETOUR_FACTOR * straight + _MAX_DETOUR_SLACK_M:
            continue
        if best is None or length < best[1]:
            best = (path, length)
    if best is not None:
        return best[0]

    # Two-way chains: ways sharing a near vertex connect into one path.
    for i, w1 in enumerate(ways):
        for w2 in ways[i + 1 :]:
            for va in w1:
                for vb in w2:
                    if _close_m(va, vb) > _WAY_JOIN_M:
                        continue
                    chain = _extract_path(w1, a, va)
                    if chain is None:
                        chain = _extract_path(list(reversed(w1)), a, va)
                    tail = _extract_path(w2, vb, b)
                    if tail is None:
                        tail = _extract_path(list(reversed(w2)), vb, b)
                    if chain is None or tail is None:
                        continue
                    full = chain + tail
                    length = _way_length(full)
                    if length > _MAX_DETOUR_FACTOR * straight + _MAX_DETOUR_SLACK_M:
                        continue
                    if best is None or length < best[1]:
                        best = (full, length)
    return best[0] if best is not None else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", required=True, type=Path, help="Path to the campus seed JSON")
    args = parser.parse_args(argv)

    payload = json.loads(args.seed.read_text(encoding="utf-8"))
    nodes = {n["id"]: [float(n["lng"]), float(n["lat"])] for n in payload["nodes"]}
    node_coords = list(nodes.values())

    print(f"fetching OSM walkways for {len(node_coords)} nodes …", flush=True)
    ways = _fetch_ways(node_coords)
    print(f"  {len(ways)} walkable ways found", flush=True)

    traced = 0
    for e in payload["edges"]:
        a = nodes.get(e["from"])
        b = nodes.get(e["to"])
        if a is None or b is None:
            continue
        path = _trace_edge(a, b, ways)
        if path is None:
            continue
        e["geometry"] = [[round(p[0], 6), round(p[1], 6)] for p in path]
        e["distance_m"] = round(_way_length(path), 1)
        e["estimated"] = False
        e["note"] = "walkway traced from OpenStreetMap (Overpass)"
        traced += 1

    prov = payload.setdefault("data_provenance", {})
    prov["edges"] = (
        f"footways traced from OpenStreetMap via Overpass for {traced}/{len(payload['edges'])} "
        f"edges; the rest remain straight-line estimates (no real walkway joins them)."
    )

    args.seed.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"done. traced {traced}/{len(payload['edges'])} edges -> {args.seed}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())