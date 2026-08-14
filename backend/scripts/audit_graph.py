"""CampusNav graph data-quality audit — report only, never writes.

Reads a seed JSON payload (same shape as `app.seed.csv_loader`) and prints
a report of data-quality issues: dangling edges, duplicates, self-loops,
disconnected components, distance/walk-time plausibility, and which
accessibility fields are actually present (honesty check for the "never
claim unverified accessibility" rule).

Run:

    python backend/scripts/audit_graph.py backend/seed_data/srm_ktr.json
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

METERS_PER_DEG_LAT = 111_320.0


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    lat1, lng1, lat2, lng2 = map(math.radians, (lat1, lng1, lat2, lng2))
    dlat = lat2 - lat1
    dlng = lng2 - lng1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 2 * 6371000.0 * math.asin(math.sqrt(a))


def reachable(node_ids: list[str], edges: list[dict[str, Any]]) -> tuple[dict[str, int], list[list[str]]]:
    adj: dict[str, set[str]] = {nid: set() for nid in node_ids}
    for e in edges:
        a, b = e["from"], e["to"]
        if a in adj and b in adj:
            adj[a].add(b)
            adj[b].add(a)
    seen: set[str] = set()
    components: list[list[str]] = []
    degree: dict[str, int] = {nid: 0 for nid in node_ids}
    for nid in node_ids:
        degree[nid] = len(adj[nid])
        if nid in seen:
            continue
        stack = [nid]
        seen.add(nid)
        comp: list[str] = []
        while stack:
            cur = stack.pop()
            comp.append(cur)
            for nb in adj[cur]:
                if nb not in seen:
                    seen.add(nb)
                    stack.append(nb)
        components.append(sorted(comp))
    return degree, components


def audit(payload: dict[str, Any]) -> int:
    nodes = payload.get("nodes", [])
    edges = payload.get("edges", [])
    node_ids = [n["id"] for n in nodes]
    id_set = set(node_ids)
    name_by_id = {n["id"]: n.get("name", n["id"]) for n in nodes}
    coords = {n["id"]: (float(n["lat"]), float(n["lng"])) for n in nodes}
    failures = 0
    issues: list[str] = []

    print(f"campus: {payload.get('campus', '?')}")
    print(f"nodes: {len(nodes)}   edges: {len(edges)}")

    # --- node inventory ---
    cats: dict[str, int] = {}
    for n in nodes:
        c = (n.get("category") or "unknown").lower()
        cats[c] = cats.get(c, 0) + 1
    print("categories: " + ", ".join(f"{k}={v}" for k, v in sorted(cats.items())))

    # --- dangling / duplicate / self-loop checks ---
    seen_pairs: set[tuple[str, str]] = set()
    for e in edges:
        a, b = e.get("from"), e.get("to")
        pair = (a, b) if a <= b else (b, a)
        for end, side in ((a, "from"), (b, "to")):
            if end not in id_set:
                failures += 1
                issues.append(f"dangling edge {side} node '{end}' on edge {a} -> {b}")
        if a == b:
            failures += 1
            issues.append(f"self-loop edge {a} -> {b}")
        elif pair in seen_pairs:
            failures += 1
            issues.append(f"duplicate/duplicated-direction edge {a} <-> {b}")
        else:
            seen_pairs.add(pair)

    # --- connectivity ---
    degree, components = reachable(node_ids, edges)
    isolated = [nid for nid in node_ids if degree[nid] == 0]
    if isolated:
        failures += 1
        issues.append(
            "isolated nodes: " + ", ".join(f"{nid} ({name_by_id[nid]})" for nid in isolated)
        )
    if len(components) > 1:
        failures += 1
        issues.append(
            f"disconnected graph: {len(components)} components "
            f"({', '.join(str(len(c)) for c in sorted(components, key=len, reverse=True))} nodes each)"
        )
    else:
        print("connectivity: single component")

    # --- distance vs haversine + walk-speed sanity ---
    for e in edges:
        a, b = e.get("from"), e.get("to")
        if a not in coords or b not in coords:
            continue
        hav = haversine_m(*coords[a], *coords[b])
        stated = float(e.get("distance_m", 0))
        if stated <= 0:
            failures += 1
            issues.append(f"edge {a} -> {b}: non-positive distance_m ({stated})")
            continue
        ratio = hav / stated
        if ratio < 0.85 or ratio > 1.25:
            failures += 1
            issues.append(
                f"edge {a} -> {b}: distance_m={stated:.1f} vs haversine={hav:.1f} "
                f"(ratio {ratio:.2f}, outside 0.85-1.25)"
            )
        wt = e.get("walk_time_min")
        if wt is not None:
            speed_m_min = stated / float(wt)
            if speed_m_min > 100 or speed_m_min < 30:
                failures += 1
                issues.append(
                    f"edge {a} -> {b}: walk_time_min={wt} implies {speed_m_min:.0f} m/min "
                    "(implausible; 30-100 m/min expected)"
                )

    # --- accessibility-surface presence (honesty check) ---
    ACC_FIELDS = [
        "is_accessible", "accessibility_verified", "has_stairs", "is_restricted",
        "is_indoor", "is_outdoor", "surface_type", "slope", "edge_type",
    ]
    present = {f: sum(1 for e in edges if f in e and e.get(f) is not None) for f in ACC_FIELDS}
    print("edge accessibility fields present: " + ", ".join(
        f"{f}={present[f]}/{len(edges)}" for f in ACC_FIELDS
    ))
    est = sum(1 for e in edges if bool(e.get("estimated", True)))
    print(f"estimated edges: {est}/{len(edges)}")
    verified = sum(1 for e in edges if bool(e.get("accessibility_verified", False)))
    if verified and verified < est:
        print(f"note: {verified} edge(s) claim accessibility_verified while {est} are estimated")

    if issues:
        print(f"\n{len(issues)} issue(s):")
        for item in issues:
            print(f"  - {item}")
        print(f"\nFAIL: {failures} blocking issue(s) — fix before treating data as surveyed.")
    else:
        print("\nOK: no data-quality issues detected.")
    return failures


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("seed_file", type=Path, help="Path to a seed JSON payload")
    args = parser.parse_args(argv)
    if not args.seed_file.exists():
        print(f"no such file: {args.seed_file}", file=sys.stderr)
        return 2
    with args.seed_file.open(encoding="utf-8") as f:
        payload = json.load(f)
    return 1 if audit(payload) else 0


if __name__ == "__main__":
    sys.exit(main())