"""Rebuild the CampusNav routing graph from the real OSM walkable network.

Fetches (or reuses a cached copy of) every walkable way around the campus
from OpenStreetMap via Overpass, then builds a junction-based routing
graph:

  * junction nodes where ways meet, split, or bend;
  * split nodes at the nearest network point to each building entrance;
  * surveyed network edges that follow the OSM way geometry exactly
    (distance measured along the shape);
  * short estimated connector edges from each entrance to its split node.

The result is written into ``seed_data/srm_ktr.json`` (nodes/edges +
provenance), which the idempotent ``csv_loader`` imports with ``--reset``.

Usage::

    python -m scripts.build_network_graph            # use cached OSM data
    python -m scripts.build_network_graph --refresh  # re-fetch from Overpass
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SEED_DIR = Path(__file__).resolve().parent.parent / "seed_data"
SEED_FILE = SEED_DIR / "srm_ktr.json"
OSM_CACHE = SEED_DIR / "osm_network_raw.json"

# Everything a pedestrian can legally/physically walk on around campus.
WALKABLE_HIGHWAYS = {
    "footway",
    "path",
    "pedestrian",
    "steps",
    "living_street",
    "service",
    "unclassified",
    "residential",
    "tertiary",
    "cycleway",
    "track",
    "road",
}
STAIRS_HIGHWAYS = {"steps"}

# Bounding box (south, west, north, east) padded around the 13 POIs.
BBOX = (12.816, 80.033, 12.830, 80.053)
OVERPASS_URLS = [
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]
WALK_M_PER_MIN = 75.0  # ~4.5 km/h

# Longest gap between disconnected OSM footway fragments that will be bridged
# with an estimated straight link (metres).
MAX_COMPONENT_LINK_M = 500.0


def fetch_osm(bbox: tuple[float, float, float, float]) -> list[dict]:
    query = f"""
    [out:json][timeout:150];
    way["highway"]({bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]});
    (._;>;);
    out body;
    """
    last_err: Exception | None = None
    for url in OVERPASS_URLS:
        try:
            req = urllib.request.Request(
                url,
                data=urllib.parse.urlencode({"data": query}).encode(),
                headers={"User-Agent": "CampusNav-seed/1.0"},
            )
            data = json.load(urllib.request.urlopen(req, timeout=180))
            print(f"fetched {len(data['elements'])} elements from {url}")
            return data["elements"]
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            last_err = e
            print(f"  mirror failed: {url} ({e})")
            time.sleep(2)
    raise RuntimeError(f"all Overpass mirrors failed: {last_err}")


def load_osm(refresh: bool, cache_path: Path, bbox: tuple[float, float, float, float]) -> list[dict]:
    if refresh or not cache_path.exists():
        elements = fetch_osm(bbox)
        cache_path.write_text(json.dumps(elements))
        print(f"cached OSM raw -> {cache_path}")
    else:
        elements = json.loads(cache_path.read_text())
        print(f"using cached OSM raw ({len(elements)} elements)")
    return elements


def haversine_m(a_lng: float, a_lat: float, b_lng: float, b_lat: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = math.radians(b_lat - a_lat), math.radians(b_lng - a_lng)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def geometry_length_m(coords: list[list[float]]) -> float:
    return sum(haversine_m(a[0], a[1], b[0], b[1]) for a, b in zip(coords, coords[1:]))


def project_point_on_segment(
    p_lng: float, p_lat: float, a_lng: float, a_lat: float, b_lng: float, b_lat: float
) -> tuple[float, float, float]:
    """Closest point on segment a->b to p; returns (lng, lat, t)."""
    dx, dy = b_lng - a_lng, b_lat - a_lat
    length2 = dx * dx + dy * dy
    if length2 == 0:
        return a_lng, a_lat, 0.0
    t = ((p_lng - a_lng) * dx + (p_lat - a_lat) * dy) / length2
    t = max(0.0, min(1.0, t))
    return a_lng + t * dx, a_lat + t * dy, t


def build_graph(elements: list[dict], pois: list[dict]) -> tuple[list[dict], list[dict]]:
    """Returns (junction_nodes, edges) for the walkable network."""
    node_coords: dict[int, tuple[float, float]] = {}
    for el in elements:
        if el["type"] == "node":
            node_coords[el["id"]] = (el["lon"], el["lat"])

    ways: list[dict] = []
    for el in elements:
        if el["type"] != "way":
            continue
        highway = el.get("tags", {}).get("highway")
        if highway not in WALKABLE_HIGHWAYS:
            continue
        nodes = [n for n in el["nodes"] if n in node_coords]
        if len(nodes) >= 2:
            ways.append(
                {
                    "id": el["id"],
                    "highway": highway,
                    "nodes": nodes,
                }
            )
    ways.sort(key=lambda w: w["id"])
    print(f"walkable ways: {len(ways)}")

    # ---- connected components over way nodes -------------------------------
    parent: dict[int, int] = {}
    for w in ways:
        for n in w["nodes"]:
            parent.setdefault(n, n)

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for w in ways:
        for a, b in zip(w["nodes"], w["nodes"][1:]):
            union(a, b)

    comp_sizes: dict[int, int] = {}
    for n in parent:
        comp_sizes[find(n)] = comp_sizes.get(find(n), 0) + 1
    main_comp = max(comp_sizes, key=comp_sizes.get)
    print(f"components: {len(comp_sizes)}; main has {comp_sizes[main_comp]} nodes")

    # ---- snap POIs onto the nearest walkable way (any component) -----------
    # Campus OSM footways are often split into several disconnected fragments
    # (gaps of a few metres to a few hundred). Snapping across all components
    # keeps every entrance on the real network; the fragments are then joined
    # with short, honestly-estimated links below.
    snap_targets = [w for w in ways if w["highway"] not in STAIRS_HIGHWAYS]
    poi_splits: list[dict] = []  # {poi_id, way, seg_index, t, lng, lat, comp}
    for poi in pois:
        p_lng, p_lat = float(poi["lng"]), float(poi["lat"])
        best: tuple[float, int, int, float, float, float] | None = None
        for w in snap_targets:
            ns = w["nodes"]
            for k in range(len(ns) - 1):
                a, b = ns[k], ns[k + 1]
                ax, ay = node_coords[a]
                bx, by = node_coords[b]
                x, y, t = project_point_on_segment(p_lng, p_lat, ax, ay, bx, by)
                d = haversine_m(p_lng, p_lat, x, y)
                if best is None or d < best[0]:
                    best = (d, w["id"], k, t, x, y)
        assert best is not None, f"no network for POI {poi['id']}"
        d, wid, seg, t, x, y = best
        print(f"  snap {poi['id']:<18} -> way {wid} seg {seg} t={t:.2f} ({d:.0f} m)")
        poi_splits.append({"poi_id": poi["id"], "way": wid, "seg": seg, "t": t, "lng": x, "lat": y})

    # Keep only components that host at least one snapped POI (satellite
    # fragments with no anchor are dead weight).
    snap_comp = {w["id"]: find(n) for w in ways for n in w["nodes"] if n in parent}
    kept_comps = {snap_comp.get(s["way"]) for s in poi_splits}
    kept_members = {n for n in parent if find(n) in kept_comps}
    print(f"kept components: {len(kept_comps)} ({comp_sizes[main_comp] - sum(1 for n in parent if find(n) in kept_comps)} nodes dropped)")

    # ---- junction detection -------------------------------------------------
    # A way node is a routing vertex when it is a way endpoint, connects two
    # different ways, or has degree != 2 (fork/intersection).
    incidence: dict[int, set[int]] = {}
    degree: dict[int, int] = {}
    for w in ways:
        ns = w["nodes"]
        for i, nid in enumerate(ns):
            incidence.setdefault(nid, set()).add(w["id"])
            # interior nodes connect two segments of the way; endpoints one
            degree[nid] = degree.get(nid, 0) + (1 if i in (0, len(ns) - 1) else 2)

    def is_vertex(nid: int, way_nodes: list[int]) -> bool:
        if nid not in kept_members:
            return False
        if nid in (way_nodes[0], way_nodes[-1]):
            return True
        return degree[nid] != 2 or len(incidence.get(nid, set())) > 1

    splits_by_way: dict[int, list[dict]] = {}
    for s in poi_splits:
        splits_by_way.setdefault(s["way"], []).append(s)
    for w in ways:
        if w["id"] in splits_by_way:
            splits_by_way[w["id"]].sort(key=lambda s: s["t"])

    # ---- chain ways between vertices ---------------------------------------
    junction_coords: dict[tuple[float, float], str] = {}
    junction_order: list[tuple[str, float, float]] = []
    junction_comp: dict[int, set[str]] = {}
    edges: list[dict] = []
    seen_pairs: set[tuple[str, str]] = set()

    def vertex_id(lng: float, lat: float) -> str:
        key = (round(lng, 6), round(lat, 6))
        if key not in junction_coords:
            jid = f"junction_{len(junction_order) + 1}"
            junction_coords[key] = jid
            junction_order.append((jid, key[0], key[1]))
        return junction_coords[key]

    for w in ways:
        ns = w["nodes"]
        if not any(n in kept_members for n in ns):
            continue
        coords = [node_coords[n] for n in ns]
        splits = splits_by_way.get(w["id"], [])
        way_comp = find(next(n for n in ns if n in parent))

        # Ordered timeline of "events" along the way: every way node and every
        # split insertion (with its t along the containing segment). Each event
        # becomes a routing vertex only when it is a junction, way endpoint, or
        # split point; the coords between consecutive events form an edge's
        # geometry, so split points never drop the nodes around them.
        events: list[tuple[float, int, tuple[float, float], bool]] = []  # (t, way_idx, coord, is_split)
        for i in range(len(ns)):
            events.append((float(i), i, coords[i], False))
            for s in splits:
                if s["seg"] == i:
                    events.append((float(i) + s["t"], i, (s["lng"], s["lat"]), True))
        for s in splits:
            if s["seg"] == len(ns) - 1:
                events.append((float(len(ns) - 1) + s["t"], len(ns) - 2, (s["lng"], s["lat"]), True))
        # stable sort by (t, is_split last so identical t keeps way node first)
        events.sort(key=lambda e: (e[0], 0 if e[3] else -1))

        # keep only events that are routing vertices
        verts = []
        for t, idx, coord, is_split in events:
            is_vertex_ev = is_split or idx in (0, len(ns) - 1) or is_vertex(
                ns[idx], ns
            )
            if is_vertex_ev:
                vid = vertex_id(*coord)
                junction_comp.setdefault(way_comp, set()).add(vid)
                if verts and verts[-1][2] == vid:
                    continue
                verts.append((t, coord, vid))

        if len(verts) < 2:
            continue

        for (t1, c1, v1), (t2, c2, v2) in zip(verts, verts[1:]):
            pair = tuple(sorted([v1, v2]))
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            # collect every event strictly between the two vertices
            geom: list[list[float]] = [[c1[0], c1[1]]]
            for t, idx, coord, is_split in events:
                if t1 < t < t2:
                    geom.append([coord[0], coord[1]])
            geom.append([c2[0], c2[1]])
            if len(geom) < 2:
                continue
            is_stairs = w["highway"] in STAIRS_HIGHWAYS
            dist = geometry_length_m(geom)
            if dist < 1.0:
                continue
            edges.append(
                {
                    "from": v1,
                    "to": v2,
                    "distance_m": round(dist, 1),
                    "walk_time_min": round(dist / WALK_M_PER_MIN, 1),
                    "estimated": False,
                    "is_accessible": not is_stairs,
                    "has_stairs": is_stairs,
                    "note": "walkway network from OpenStreetMap",
                    "geometry": geom,
                }
            )

    print(f"junction nodes: {len(junction_order)}, network edges: {len(edges)}")

    # ---- bridge disconnected OSM fragments -----------------------------------
    # Campus footways frequently arrive as several disconnected components
    # (gaps of metres to a few hundred metres — missing links in OSM). Join
    # every kept component to its nearest neighbour with a short straight
    # edge, honestly flagged `estimated`, so routes can cross the campus.
    comp_vertices: dict[int, list[tuple[str, float, float]]] = {}
    for ci, (vid, lng, lat) in enumerate(junction_order):
        # Component for each vertex was recorded while chaining ways below;
        # junctions created by the vertex_id() helper get their comp here.
        for comp, members in junction_comp.items():
            if vid in members:
                comp_vertices.setdefault(comp, []).append((vid, lng, lat))
                break

    kept_comps_sorted = sorted(comp_vertices)
    linked_comp_pairs: set[tuple[int, int]] = set()
    for i in range(len(kept_comps_sorted)):
        for j in range(i + 1, len(kept_comps_sorted)):
            ci, cj = kept_comps_sorted[i], kept_comps_sorted[j]
            # Up to two links per pair: fragments are often loops, so a
            # single connection point forces a long walk around the loop.
            # The second link uses the nearest *distinct* vertex pair.
            best: list[tuple[float, str, str]] = []
            for va, la, lna in comp_vertices[ci]:
                for vb, lb, lnb in comp_vertices[cj]:
                    d = haversine_m(la, lna, lb, lnb)
                    best.append((d, va, vb))
            best.sort()
            used_va: set[str] = set()
            used_vb: set[str] = set()
            for d, va, vb in best:
                if len(used_va) >= 2 or len(used_vb) >= 2:
                    break
                if va in used_va or vb in used_vb:
                    continue
                if d > MAX_COMPONENT_LINK_M:
                    break
                va_coords = next((lng, lat) for v, lng, lat in junction_order if v == va)
                vb_coords = next((lng, lat) for v, lng, lat in junction_order if v == vb)
                edges.append(
                    {
                        "from": va,
                        "to": vb,
                        "distance_m": round(d, 1),
                        "walk_time_min": round(d / WALK_M_PER_MIN, 1),
                        "estimated": True,
                        "is_accessible": True,
                        "has_stairs": False,
                        "note": "link between disconnected OSM network fragments (estimated straight)",
                        "geometry": [[va_coords[0], va_coords[1]], [vb_coords[0], vb_coords[1]]],
                    }
                )
                used_va.add(va)
                used_vb.add(vb)
                linked_comp_pairs.add((ci, cj))
    print(
        f"inter-component links: {len(linked_comp_pairs)} "
        f"({sum(1 for e in edges if e['note'].startswith('link between'))} edges)"
    )

    # ---- entrance connectors ------------------------------------------------
    split_by_poi = {s["poi_id"]: s for s in poi_splits}
    for poi in pois:
        s = split_by_poi[poi["id"]]
        dist = haversine_m(float(poi["lng"]), float(poi["lat"]), s["lng"], s["lat"])
        if dist < 1.0:
            continue
        edges.append(
            {
                "from": poi["id"],
                "to": vertex_id(s["lng"], s["lat"]),
                "distance_m": round(dist, 1),
                "walk_time_min": round(dist / WALK_M_PER_MIN, 1),
                "estimated": True,
                "is_accessible": True,
                "has_stairs": False,
                "note": "entrance connector to the walkway network (short, straight)",
                "geometry": None,
            }
        )
    print(f"connector edges: {sum(1 for e in edges if e['estimated'])}")

    junction_nodes = [
        {"id": jid, "name": "Walkway junction", "category": "junction", "lng": lng, "lat": lat}
        for jid, lng, lat in junction_order
    ]
    return junction_nodes, edges


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="re-fetch OSM from Overpass")
    parser.add_argument(
        "--seed-file",
        type=Path,
        default=SEED_FILE,
        help="campus seed JSON to rebuild (default: srm_ktr.json)",
    )
    parser.add_argument(
        "--osm-cache",
        type=Path,
        default=None,
        help="OSM raw cache file (default: seed_data/osm_network_raw.json)",
    )
    parser.add_argument(
        "--bbox",
        nargs=4,
        type=float,
        default=BBOX,
        metavar=("S", "W", "N", "E"),
        help="Overpass bounding box (default: SRM KTR bbox)",
    )
    args = parser.parse_args()

    seed_file = args.seed_file.resolve()
    cache_path = (args.osm_cache or (seed_file.parent / "osm_network_raw.json")).resolve()
    print(f"seed file: {seed_file}")
    print(f"osm cache: {cache_path}")
    print(f"bbox: {args.bbox}")

    seed = json.loads(seed_file.read_text())
    # Only the real entrances/landmarks/POIs get snapped onto the network —
    # never previously generated junction nodes.
    pois = [n for n in seed["nodes"] if n.get("category") != "junction"]
    print(f"POI anchors: {len(pois)}")

    elements = load_osm(args.refresh, cache_path, tuple(args.bbox))
    junction_nodes, edges = build_graph(elements, pois)

    seed["nodes"] = pois + junction_nodes
    seed["edges"] = edges
    seed["data_provenance"]["edges"] = (
        "routing graph rebuilt from the OpenStreetMap walkable network "
        f"({len(edges)} edges: junction-to-junction ways with full geometry, "
        "plus short entrance connectors). Distances measured along the shapes."
    )
    seed["data_provenance"]["graph"] = (
        "junction nodes where walkable ways meet/split (Overpass), split nodes at "
        "the nearest network point to each entrance, straight estimated connectors "
        "from entrances to the network."
    )
    seed_file.write_text(json.dumps(seed, indent=1))
    print(f"wrote {seed_file} — {len(seed['nodes'])} nodes, {len(edges)} edges")
    return 0


if __name__ == "__main__":
    sys.exit(main())
