"""CampusNav V2 seed loader.

Reads one or more JSON files (a directory of `*.json`, or a single file),
each describing one campus (nodes + edges + provenance), and upserts them
into the DB.

Run with:

    uv run python -m app.seed.csv_loader --data-dir ./seed_data
    # or point at a single file:
    uv run python -m app.seed.csv_loader --data-dir ./seed_data/srm_ktr.json

Optional flags:
    --reset    Wipe all seeded tables first (preserves users).

JSON shape (see backend/seed_data/srm_ktr.json for the canonical example):

    {
      "campus": "SRM Institute of Science and Technology, Kattankulathur",
      "data_provenance": {
        "node_names_and_floors": "...",
        "node_coordinates": "...",
        "edges": "ESTIMATED — straight-line distances, not surveyed walking paths."
      },
      "nodes": [
        { "id": "main_gate", "name": "Main Gate", "category": "entrance",
          "lat": 12.8259, "lng": 80.0422 }
      ],
      "edges": [
        { "from": "main_gate", "to": "univ_building",
          "distance_m": 263.4, "walk_time_min": 3.3,
          "estimated": true, "note": "straight-line estimate" }
      ]
    }

Edges may carry a real walkway shape instead of a straight line:

      { "from": "main_gate", "to": "univ_building",
        "geometry": [[80.0422, 12.8259], [80.0425, 12.8261], [80.0428, 12.8264]],
        "estimated": false, "note": "walkway traced from OpenStreetMap" }

`geometry` is a list of [lng, lat] points following the actual path
(backend/scripts/osm_paths.py generates these from OSM walkways). When
present the loader stores it as WKT LINESTRING, recomputes `distance_m`
along the shape, and marks the edge as NOT estimated unless the JSON
explicitly says otherwise.

The loader:

  - Splits nodes into `Building` (academic / library / admin) and `PathNode`
    (everything else). Each building also gets a `PathNode(kind="entrance")`
    at the same coordinates so the A* router in Phase 2 can target it.
  - Records `data_provenance` so reviewers know what's surveyed vs estimated.
  - Sets `is_estimated` on every edge from the JSON's `estimated` field.
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models.campus import Building, Campus, Entrance
from app.models.graph import PathEdge, PathNode, PathNodeKind
from app.models.provenance import DataProvenance

log = logging.getLogger("seed")

# Categories that become `Building` rows. Everything else stays on `PathNode`.
BUILDING_CATEGORIES = {"academic", "library", "admin"}
# Categories that map directly to PathNodeKind.
CATEGORY_TO_KIND = {
    "entrance": PathNodeKind.BUILDING_ENTRANCE,
    "academic": PathNodeKind.BUILDING_ENTRANCE,  # for buildings; entrance node mirrors it
    "library": PathNodeKind.BUILDING_ENTRANCE,
    "admin": PathNodeKind.BUILDING_ENTRANCE,
    "campus_center": PathNodeKind.LANDMARK,  # the campus's main pin/entry plaza
    "landmark": PathNodeKind.LANDMARK,
    "transit": PathNodeKind.TRANSIT,
    "hostel": PathNodeKind.POI,
    "accommodation": PathNodeKind.POI,
    "medical": PathNodeKind.POI,
    "recreation": PathNodeKind.POI,
    "sports": PathNodeKind.POI,
    "food": PathNodeKind.POI,
    "parking": PathNodeKind.POI,
    "bank": PathNodeKind.POI,
    "poi": PathNodeKind.POI,
    "junction": PathNodeKind.JUNCTION,  # walkway network vertices (not POIs)
}
# Building code derivation: upper-case the id, joining word chunks with "_"
# for readability — e.g. "main_block" → "MAIN_BLOCK", "tech_park" → "TECH_PARK".
def _building_code(node_id: str) -> str:
    parts = node_id.upper().split("_")
    # If there's only one chunk, return as-is; otherwise join with underscore.
    return parts[0] if len(parts) == 1 else "_".join(parts)


def _point(lng: float, lat: float) -> str:
    """WKT for a 2D point: POINT(longitude latitude)."""
    return f"POINT({lng} {lat})"


_G_PLUS_RE = re.compile(r"G\+\s*(\d+)")

_M = 6_371_000.0


def _haversine_m(lng_a: float, lat_a: float, lng_b: float, lat_b: float) -> float:
    """Great-circle distance in meters (WGS84)."""
    import math

    p1, p2 = math.radians(lat_a), math.radians(lat_b)
    dp = math.radians(lat_b - lat_a)
    dl = math.radians(lng_b - lng_a)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * _M * math.asin(math.sqrt(h))


def _geometry_wkt(geometry: list[list[float]] | None) -> str | None:
    """Validate [lng, lat] pairs and build WKT LINESTRING, or None."""
    if not geometry or len(geometry) < 2:
        return None
    pts = []
    for p in geometry:
        if not isinstance(p, (list, tuple)) or len(p) != 2:
            return None
        lng, lat = float(p[0]), float(p[1])
        if not (-180 <= lng <= 180 and -90 <= lat <= 90):
            return None
        pts.append(f"{lng} {lat}")
    return "LINESTRING(" + ", ".join(pts) + ")"


def _geometry_length_m(geometry: list[list[float]]) -> float:
    """Walkway length along the shape (haversine over consecutive points)."""
    total = 0.0
    for a, b in zip(geometry, geometry[1:]):
        total += _haversine_m(a[0], a[1], b[0], b[1])
    return total


def _parse_num_floors(name: str, fallback: int = 1) -> int:
    """Pull 'G+15' style annotations from a building name → 16.

    Falls back to `fallback` if the annotation is absent. Buildings without
    a `G+N` token get `fallback` (which we use for landmarks like auditorium
    that aren't academic buildings anyway).
    """
    m = _G_PLUS_RE.search(name)
    if not m:
        return fallback
    return int(m.group(1)) + 1


def _read_payload(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"Missing seed file: {path}")
    with path.open(encoding="utf-8") as f:
        return json.load(f)


# --- Loaders --------------------------------------------------------------------


def load_provenance(
    session: Session,
    payload: dict[str, Any],
    campus: Campus | None = None,
) -> DataProvenance:
    prov = payload.get("data_provenance") or {}
    notes = " | ".join(f"{k}: {v}" for k, v in prov.items()) or None
    # Match on the payload name first, then on the (possibly renamed)
    # campus row, so renames keep one provenance row instead of orphaning
    # the old one.
    existing = session.execute(
        select(DataProvenance).where(DataProvenance.dataset_name == payload["campus"])
    ).scalar_one_or_none()
    if existing is None and campus is not None:
        existing = session.execute(
            select(DataProvenance).where(DataProvenance.dataset_name == campus.name)
        ).scalar_one_or_none()
    # Rename support: the old dataset name is carried via `previously`
    # (same shape as load_campus), so the provenance row follows the
    # campus instead of being orphaned/deduplicated.
    if existing is None:
        prev = payload.get("previously")
        if prev:
            existing = session.execute(
                select(DataProvenance).where(DataProvenance.dataset_name == prev)
            ).scalar_one_or_none()
    if existing is None:
        existing = DataProvenance(
            dataset_name=payload["campus"],
            source="user-provided JSON",
            url=None,
            notes=notes,
        )
        session.add(existing)
        session.flush()
    else:
        existing.dataset_name = payload["campus"]
        existing.notes = notes
    return existing


def load_campus(session: Session, payload: dict[str, Any]) -> Campus:
    name = payload["campus"]
    # Slug derived from name so re-running is idempotent; an explicit
    # payload `slug` overrides it (e.g. renaming a campus to a short
    # display name while keeping a clean, stable slug).
    slug = payload.get("slug") or re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    existing = session.execute(
        select(Campus).where(Campus.slug == slug)
    ).scalar_one_or_none()
    # Support renames: a campus whose name changed but was seeded under the
    # old name is matched by name (or by an explicit payload `previously`
    # hint holding the old name/slug) and migrated (name + slug) in place.
    if existing is None:
        existing = session.execute(
            select(Campus).where(Campus.name == name)
        ).scalar_one_or_none()
    if existing is None:
        prev = payload.get("previously")
        if prev:
            existing = session.execute(
                select(Campus).where(Campus.name == prev)
            ).scalar_one_or_none() or session.execute(
                select(Campus).where(Campus.slug == prev)
            ).scalar_one_or_none()
    # Optional catalog metadata from the JSON: "featured" pins the campus in
    # the Explore hub, "center" overrides the centroid computed from nodes.
    featured = bool(payload.get("featured", False))
    center = payload.get("center") or {}
    center_lat = center.get("lat")
    center_lng = center.get("lng")
    # Optional immersive layer (360° provider config). Pure metadata — the
    # navigation engine never reads it; an absent/malformed value leaves the
    # previous config untouched rather than wiping it on re-seed.
    immersive = payload.get("immersive")
    immersive_json = None
    if isinstance(immersive, dict) and immersive:
        import json as _json

        immersive_json = _json.dumps(immersive)
    if existing is None:
        c = Campus(
            name=name,
            slug=slug,
            description="Seeded from user-provided JSON (see data_provenance).",
            featured=featured,
            center_lat=center_lat,
            center_lng=center_lng,
            immersive_json=immersive_json,
        )
        session.add(c)
        session.flush()
        existing = c
    else:
        existing.name = name
        existing.slug = slug
        existing.featured = featured
        if immersive_json is not None:
            existing.immersive_json = immersive_json
        if center_lat is not None and center_lng is not None:
            existing.center_lat = center_lat
            existing.center_lng = center_lng
    return existing


def load_buildings_and_nodes(
    session: Session,
    payload: dict[str, Any],
    campus: Campus,
) -> dict[str, UUID]:
    """Returns {node_id: path_node_id} for every node in the payload."""
    node_ids: dict[str, UUID] = {}
    for n in payload["nodes"]:
        category = (n.get("category") or "").lower()
        kind = CATEGORY_TO_KIND.get(category, PathNodeKind.POI)
        point = _point(float(n["lng"]), float(n["lat"]))

        building_id: UUID | None = None
        if category in BUILDING_CATEGORIES:
            code = _building_code(n["id"])
            existing = session.execute(
                select(Building).where(
                    Building.campus_id == campus.id, Building.code == code
                )
            ).scalar_one_or_none()
            num_floors = _parse_num_floors(n["name"])
            if existing is None:
                b = Building(
                    campus_id=campus.id,
                    name=n["name"],
                    code=code,
                    centroid=point,
                    num_floors=num_floors,
                    has_elevator=(num_floors >= 3),  # reasonable heuristic; not authoritative
                    is_accessible=True,
                )
                session.add(b)
                session.flush()
                existing = b
            else:
                existing.centroid = point
                existing.num_floors = num_floors
                existing.name = n["name"]
            building_id = existing.id
            # For buildings the graph node carries `kind=entrance` at the
            # building centroid so the A* router can land on it.
            node_kind = PathNodeKind.BUILDING_ENTRANCE
            # Mirror that node as an `Entrance` row (Phase 2: building
            # details). Coordinates come from the same surveyed centroid;
            # accessibility mirrors the building's `is_accessible` default.
            existing_entrance = session.execute(
                select(Entrance).where(Entrance.building_id == existing.id)
            ).scalar_one_or_none()
            if existing_entrance is None:
                session.add(
                    Entrance(
                        building_id=existing.id,
                        label=n["name"],
                        location=point,
                        is_accessible=existing.is_accessible,
                        has_stairs=False,
                    )
                )
        else:
            node_kind = kind

        existing_node = session.execute(
            select(PathNode).where(
                PathNode.campus_id == campus.id, PathNode.label == n["id"]
            )
        ).scalar_one_or_none()
        if existing_node is None:
            pn = PathNode(
                campus_id=campus.id,
                label=n["id"],
                kind=node_kind,
                location=point,
            )
            session.add(pn)
            session.flush()
            existing_node = pn
        else:
            existing_node.kind = node_kind
            existing_node.location = point

        node_ids[n["id"]] = existing_node.id

    session.flush()
    return node_ids


def load_edges(
    session: Session,
    payload: dict[str, Any],
    campus: Campus,
    node_ids: dict[str, UUID],
) -> None:
    """Upsert edges keyed by canonical (sorted from, to)."""
    for e in payload["edges"]:
        from_id = node_ids.get(e["from"])
        to_id = node_ids.get(e["to"])
        if from_id is None or to_id is None:
            log.warning("skipping edge %s -> %s: unknown node", e["from"], e["to"])
            continue

        # Canonical key — store the edge as (min, max) so the A* router can
        # treat it as undirected when `bidirectional=true` without duplicating.
        a, b = sorted([from_id, to_id], key=str)
        flipped = from_id != a
        geometry_raw = e.get("geometry")
        if flipped and isinstance(geometry_raw, list):
            geometry_raw = list(reversed(geometry_raw))
        geometry = _geometry_wkt(geometry_raw)
        # Real walkway shape — measure distance along it and stop calling the
        # edge "estimated" unless the JSON explicitly says otherwise.
        distance_m = float(e["distance_m"])
        if geometry_raw and len(geometry_raw) >= 2:
            distance_m = round(_geometry_length_m(geometry_raw), 1)
        is_estimated = bool(e.get("estimated", geometry is None))
        walk_time = e.get("walk_time_min")
        edge_type = e.get("edge_type", "walk")
        # Accessibility fields default to the honest "unverified" baseline:
        # usable (accessible=True) but never presented as verified.
        is_accessible = bool(e.get("is_accessible", True))
        has_stairs = bool(e.get("has_stairs", False))
        is_restricted = bool(e.get("is_restricted", False))
        is_indoor = bool(e.get("is_indoor", False))
        is_outdoor = bool(e.get("is_outdoor", True))
        surface_type = e.get("surface_type")
        slope = e.get("slope")
        accessibility_verified = bool(e.get("accessibility_verified", False))

        existing = session.execute(
            select(PathEdge).where(
                PathEdge.from_node_id == a,
                PathEdge.to_node_id == b,
            )
        ).scalar_one_or_none()
        if existing is None:
            row = PathEdge(
                from_node_id=a,
                to_node_id=b,
                distance_m=distance_m,
                has_stairs=has_stairs,
                is_covered=False,
                bidirectional=True,
                is_estimated=is_estimated,
                is_accessible=is_accessible,
                edge_type=str(edge_type),
                walk_time_min=float(walk_time) if walk_time is not None else None,
                surface_type=surface_type,
                slope=float(slope) if slope is not None else None,
                is_indoor=is_indoor,
                is_outdoor=is_outdoor,
                is_restricted=is_restricted,
                accessibility_verified=accessibility_verified,
                geometry=geometry,
            )
            session.add(row)
        else:
            existing.distance_m = distance_m
            existing.is_estimated = is_estimated
            existing.geometry = geometry
            existing.edge_type = str(edge_type)
            existing.walk_time_min = float(walk_time) if walk_time is not None else None
            existing.is_accessible = is_accessible
            existing.has_stairs = has_stairs
            existing.is_restricted = is_restricted
            existing.is_indoor = is_indoor
            existing.is_outdoor = is_outdoor
            existing.surface_type = surface_type
            existing.slope = float(slope) if slope is not None else None
            existing.accessibility_verified = accessibility_verified
    session.flush()


def reset(session: Session) -> None:
    for model in [PathEdge, PathNode, Building, Campus, DataProvenance]:
        session.execute(delete(model))
    session.flush()
    log.info("reset: seeded tables cleared")


def prune_campus(
    session: Session,
    payload: dict[str, Any],
    campus: Campus,
    node_ids: dict[str, UUID],
) -> None:
    """Make a campus payload authoritative: drop nodes / buildings / edges
    that existed in a previous version of the same campus file (e.g. a node
    later renamed or removed). Safe to run idempotently alongside the upserts.
    """
    kept_labels = {n["id"] for n in payload["nodes"]}

    stale_nodes = session.execute(
        select(PathNode).where(
            PathNode.campus_id == campus.id,
            PathNode.label.not_in(kept_labels),
        )
    ).scalars().all()
    if stale_nodes:
        log.info(
            "  pruning %d stale path nodes from %s", len(stale_nodes), campus.name
        )
        for n in stale_nodes:
            log.info("    - %s", n.label)

    kept_codes = {
        _building_code(n["id"])
        for n in payload["nodes"]
        if (n.get("category") or "").lower() in BUILDING_CATEGORIES
    }
    stale_buildings = session.execute(
        select(Building).where(
            Building.campus_id == campus.id,
            Building.code.not_in(kept_codes) if kept_codes else Building.campus_id.isnot(None),
        )
    ).scalars().all()
    if stale_buildings:
        log.info(
            "  pruning %d stale buildings from %s", len(stale_buildings), campus.name
        )
        for b in stale_buildings:
            log.info("    - %s", b.code)
            session.execute(
                delete(Entrance).where(Entrance.building_id == b.id)
            )
            session.delete(b)

    desired_keys: set[tuple[UUID, UUID]] = set()
    for e in payload["edges"]:
        a_id, b_id = node_ids.get(e["from"]), node_ids.get(e["to"])
        if a_id is None or b_id is None:
            continue
        desired_keys.add(tuple(sorted([a_id, b_id], key=str)))

    campus_edges = session.execute(
        select(PathEdge)
        .join(PathNode, PathEdge.from_node_id == PathNode.id)
        .where(PathNode.campus_id == campus.id)
    ).scalars().all()
    pruned_edges = 0
    for e in campus_edges:
        key = tuple(sorted([e.from_node_id, e.to_node_id], key=str))
        if key not in desired_keys:
            session.delete(e)
            pruned_edges += 1

    for n in stale_nodes:
        session.delete(n)
    if pruned_edges:
        log.info("  pruned %d stale edges from %s", pruned_edges, campus.name)
    session.flush()


# --- CLI ------------------------------------------------------------------------


def _ensure_center(
    session: Session,
    campus: Campus,
    payload: dict[str, Any],
) -> None:
    """Backfill the catalog centroid from node coordinates when unset."""
    if campus.center_lat is not None and campus.center_lng is not None:
        return
    nodes = payload.get("nodes") or []
    if not nodes:
        return
    lats = [float(n["lat"]) for n in nodes if n.get("lat") is not None]
    lngs = [float(n["lng"]) for n in nodes if n.get("lng") is not None]
    if not lats or not lngs:
        return
    campus.center_lat = round(sum(lats) / len(lats), 6)
    campus.center_lng = round(sum(lngs) / len(lngs), 6)
    session.flush()


def load_one(
    session: Session,
    target: Path,
) -> int:
    """Load a single seed JSON file. Returns 0 on success, 1 on failure."""
    payload = _read_payload(target)
    # The data directory also holds non-seed JSON (e.g. the OSM raw cache
    # that build_network_graph.py writes). Skip anything that isn't a
    # campus payload instead of crashing the whole load.
    if not isinstance(payload, dict) or not isinstance(payload.get("campus"), str):
        log.info("skipping %s: not a campus seed payload", target.name)
        return 0
    log.info("loading %s from %s", payload.get("campus", "?"), target.name)

    campus = load_campus(session, payload)
    prov = load_provenance(session, payload, campus)
    log.info("  data_provenance: %s (source=%s)", prov.dataset_name, prov.source)

    node_ids = load_buildings_and_nodes(session, payload, campus)
    load_edges(session, payload, campus, node_ids)
    prune_campus(session, payload, campus, node_ids)
    _ensure_center(session, campus, payload)

    n_buildings = len(
        session.execute(
            select(Building).where(Building.campus_id == campus.id)
        ).all()
    )
    n_nodes = len(
        session.execute(
            select(PathNode).where(PathNode.campus_id == campus.id)
        ).all()
    )
    n_edges = len(
        session.execute(
            select(PathEdge)
            .join(PathNode, PathEdge.from_node_id == PathNode.id)
            .where(PathNode.campus_id == campus.id)
        ).all()
    )
    log.info(
        "done. campus=%s buildings=%d path_nodes=%d path_edges=%d",
        campus.name, n_buildings, n_nodes, n_edges,
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    parser = argparse.ArgumentParser(description="CampusNav seed loader (JSON)")
    parser.add_argument(
        "--data-dir",
        required=True,
        type=Path,
        help="Either a directory containing *.json files or a single .json file",
    )
    parser.add_argument("--reset", action="store_true", help="Wipe seeded tables first")
    args = parser.parse_args(argv)

    target: Path = args.data_dir
    if target.is_dir():
        json_files = sorted(target.glob("*.json"))
        if not json_files:
            print(f"no .json files found in {target}", file=sys.stderr)
            return 2
    else:
        json_files = [target]

    session = SessionLocal()
    try:
        if args.reset:
            reset(session)
            session.commit()

        for file in json_files:
            if load_one(session, file) != 0:
                return 1
        session.commit()
        return 0
    except Exception:
        session.rollback()
        log.exception("seed failed")
        return 1
    finally:
        session.close()


if __name__ == "__main__":
    sys.exit(main())
