"""Building/campus detail queries shared by the discovery router and the
assistant tool registry (Phase H)."""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.campus import Building, Campus
from app.models.graph import PathNode
from app.schemas.discovery import BuildingDetailOut, EntranceOut, FloorOut

_WKT_RE = re.compile(r"POINT\s*\(\s*(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s*\)", re.IGNORECASE)


def parse_point(wkt: str | None) -> tuple[float, float] | None:
    """(lng, lat) from WKT ``POINT(lng lat)``, or None."""
    if not wkt:
        return None
    m = _WKT_RE.search(wkt)
    if not m:
        return None
    return float(m.group(1)), float(m.group(2))


def get_building_detail(session: Session, building_id: str) -> BuildingDetailOut | None:
    """Full building record: entrances, floors, connected graph nodes."""
    building = session.get(Building, building_id)
    if building is None:
        return None

    entrances = [
        EntranceOut(
            id=e.id,
            label=e.label,
            lat=pt[1] if (pt := parse_point(e.location)) is not None else 0.0,
            lng=pt[0] if pt else 0.0,
            is_accessible=e.is_accessible,
            has_stairs=e.has_stairs,
        )
        for e in building.entrances
    ]

    floors = [
        FloorOut(id=f.id, level=f.level, label=f.label, rooms_count=len(f.rooms))
        for f in sorted(building.floors, key=lambda f: f.level)
    ]

    # Graph nodes that represent this building (entrance node at centroid).
    connected: list[dict[str, object]] = []
    nodes = session.execute(
        select(PathNode).where(
            PathNode.campus_id == building.campus_id,
            PathNode.label == building.code.lower(),
        )
    ).scalars().all()
    for n in nodes:
        pt = parse_point(n.location)
        connected.append(
            {
                "id": str(n.id),
                "label": n.label,
                "type": n.kind.value,
                "lat": pt[1] if pt else 0.0,
                "lng": pt[0] if pt else 0.0,
            }
        )

    pt = parse_point(building.centroid)
    return BuildingDetailOut(
        id=building.id,
        campus_id=building.campus_id,
        name=building.name,
        code=building.code,
        num_floors=building.num_floors,
        has_elevator=building.has_elevator,
        is_accessible=building.is_accessible,
        lat=pt[1] if pt else None,
        lng=pt[0] if pt else None,
        entrances=entrances,
        floors=floors,
        connecting_nodes=connected,
    )


def campus_stats(session: Session, campus: Campus) -> dict[str, Any]:
    """Honest counts for a campus: buildings, walkable nodes, edges."""
    from sqlalchemy import func

    from app.models.graph import PathEdge

    edge_count = int(
        session.execute(
            select(func.count())
            .select_from(PathEdge)
            .join(PathNode, PathNode.id == PathEdge.from_node_id)
            .where(PathNode.campus_id == campus.id)
        ).scalar_one()
    )
    return {
        "id": str(campus.id),
        "name": campus.name,
        "slug": campus.slug,
        "description": campus.description,
        "building_count": _count(session, Building, campus.id),
        "node_count": len(campus.path_nodes),
        "edge_count": edge_count,
    }


def _count(session: Session, model: type, campus_id) -> int:
    from sqlalchemy import func

    return int(
        session.execute(
            select(func.count()).select_from(model).where(model.campus_id == campus_id)
        ).scalar_one()
    )


def find_campus(session: Session, campus_slug: str | None = None) -> Campus | None:
    """Default campus (first seeded) or the requested slug."""
    if campus_slug:
        return session.execute(
            select(Campus).where(Campus.slug == campus_slug)
        ).scalar_one_or_none()
    return session.execute(select(Campus).order_by(Campus.name)).scalars().first()
