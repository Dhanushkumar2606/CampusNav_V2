"""CampusNav V2 seed loader.

Reads a single JSON file describing a campus (nodes + edges + provenance)
and upserts into the DB.

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

The loader:

  - Splits nodes into `Building` (academic / library) and `PathNode`
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
BUILDING_CATEGORIES = {"academic", "library"}
# Categories that map directly to PathNodeKind.
CATEGORY_TO_KIND = {
    "entrance": PathNodeKind.BUILDING_ENTRANCE,
    "academic": PathNodeKind.BUILDING_ENTRANCE,  # for buildings; entrance node mirrors it
    "library": PathNodeKind.BUILDING_ENTRANCE,
    "landmark": PathNodeKind.LANDMARK,
    "transit": PathNodeKind.TRANSIT,
    "hostel": PathNodeKind.POI,
    "poi": PathNodeKind.POI,
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


def load_provenance(session: Session, payload: dict[str, Any]) -> DataProvenance:
    prov = payload.get("data_provenance") or {}
    notes = " | ".join(f"{k}: {v}" for k, v in prov.items()) or None
    existing = session.execute(
        select(DataProvenance).where(DataProvenance.dataset_name == payload["campus"])
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
        existing.notes = notes
    return existing


def load_campus(session: Session, payload: dict[str, Any]) -> Campus:
    name = payload["campus"]
    # Slug derived from name so re-running is idempotent.
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    existing = session.execute(
        select(Campus).where(Campus.slug == slug)
    ).scalar_one_or_none()
    if existing is None:
        c = Campus(
            name=name,
            slug=slug,
            description="Seeded from user-provided JSON (see data_provenance).",
        )
        session.add(c)
        session.flush()
        existing = c
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
        is_estimated = bool(e.get("estimated", True))
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
                distance_m=float(e["distance_m"]),
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
            )
            session.add(row)
        else:
            existing.distance_m = float(e["distance_m"])
            existing.is_estimated = is_estimated
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


# --- CLI ------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    parser = argparse.ArgumentParser(description="CampusNav seed loader (JSON)")
    parser.add_argument(
        "--data-dir",
        required=True,
        type=Path,
        help="Either a directory containing one *.json file or a single .json file",
    )
    parser.add_argument("--reset", action="store_true", help="Wipe seeded tables first")
    args = parser.parse_args(argv)

    target: Path = args.data_dir
    if target.is_dir():
        json_files = sorted(target.glob("*.json"))
        if not json_files:
            print(f"no .json files found in {target}", file=sys.stderr)
            return 2
        if len(json_files) > 1:
            print(
                f"multiple .json files in {target}: {[f.name for f in json_files]}; "
                "pass a single file explicitly.",
                file=sys.stderr,
            )
            return 2
        target = json_files[0]

    session = SessionLocal()
    try:
        if args.reset:
            reset(session)
            session.commit()

        payload = _read_payload(target)
        log.info("loading %s from %s", payload.get("campus", "?"), target.name)

        prov = load_provenance(session, payload)
        log.info("  data_provenance: %s (source=%s)", prov.dataset_name, prov.source)

        campus = load_campus(session, payload)
        node_ids = load_buildings_and_nodes(session, payload, campus)
        load_edges(session, payload, campus, node_ids)

        # Summary
        n_buildings = session.execute(
            select(Building).where(Building.campus_id == campus.id)
        ).all()
        n_nodes = session.execute(
            select(PathNode).where(PathNode.campus_id == campus.id)
        ).all()
        n_edges = session.execute(
            select(PathEdge).join(PathNode, PathEdge.from_node_id == PathNode.id)
            .where(PathNode.campus_id == campus.id)
        ).all()
        session.commit()
        log.info(
            "done. campus=%s buildings=%d path_nodes=%d path_edges=%d",
            campus.name, len(n_buildings), len(n_nodes), len(n_edges),
        )
        return 0
    except Exception:
        session.rollback()
        log.exception("seed failed")
        return 1
    finally:
        session.close()


if __name__ == "__main__":
    sys.exit(main())
