"""Discovery router: search, building detail, campus categories."""

from __future__ import annotations

import dataclasses
import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.campus import Building, Campus, Entrance, Floor
from app.models.graph import PathNode, PathNodeKind
from app.schemas.discovery import (
    BuildingDetailOut,
    CategoryOut,
    EntranceOut,
    FloorOut,
    SearchResultOut,
)
from app.services.search import search

router = APIRouter(tags=["discovery"])

_WKT_RE = re.compile(r"POINT\s*\(\s*(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s*\)", re.IGNORECASE)


def _parse_point(wkt: str | None) -> tuple[float, float] | None:
    if not wkt:
        return None
    m = _WKT_RE.search(wkt)
    if not m:
        return None
    return float(m.group(1)), float(m.group(2))


@router.get("/search", response_model=list[SearchResultOut])
def search_endpoint(
    q: Annotated[str, Query(min_length=1, max_length=120)],
    campus: Annotated[str | None, Query(max_length=64)] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    db: Session = Depends(get_db),
) -> list[SearchResultOut]:
    """Fuzzy campus search over buildings, graph nodes and POIs."""
    return [SearchResultOut.model_validate(dataclasses.asdict(r)) for r in search(db, q, campus, limit)]


@router.get("/campuses/{slug}/categories", response_model=list[CategoryOut])
def campus_categories(
    slug: Annotated[str, Path(min_length=1, max_length=64)],
    db: Session = Depends(get_db),
) -> list[CategoryOut]:
    """Real category counts for the campus (buildings + node kinds)."""
    campus = db.execute(select(Campus).where(Campus.slug == slug)).scalar_one_or_none()
    if campus is None:
        raise HTTPException(status_code=404, detail=f"campus not found: {slug}")

    building_count = db.execute(
        select(func.count()).select_from(Building).where(Building.campus_id == campus.id)
    ).scalar_one()

    counts: dict[str, int] = {}
    rows = db.execute(
        select(PathNode.kind, func.count())
        .where(PathNode.campus_id == campus.id)
        .group_by(PathNode.kind)
    ).all()
    for kind, count in rows:
        if kind == PathNodeKind.BUILDING_ENTRANCE:
            continue  # mirrored by the buildings row
        label = {
            PathNodeKind.LANDMARK: "Landmarks",
            PathNodeKind.TRANSIT: "Transport",
            PathNodeKind.POI: "Places",
            PathNodeKind.JUNCTION: "Pathways",
        }.get(kind, kind.value.capitalize())
        counts[label] = int(count)

    out: list[CategoryOut] = [CategoryOut(key="building", label="Buildings", count=building_count)]
    for label, count in counts.items():
        key = label.lower()
        out.append(CategoryOut(key=key, label=label, count=count))
    return out


@router.get("/buildings/{building_id}", response_model=BuildingDetailOut)
def building_detail(
    building_id: str,
    db: Session = Depends(get_db),
) -> BuildingDetailOut:
    """Full building record: entrances, floors, connected graph nodes."""
    building = db.get(Building, building_id)
    if building is None:
        raise HTTPException(status_code=404, detail="building not found")

    entrances = [
        EntranceOut(
            id=e.id,
            label=e.label,
            lat=lat if (pt := _parse_point(e.location)) is not None else 0.0,
            lng=(pt[0] if pt else 0.0),
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
    nodes = db.execute(
        select(PathNode).where(
            PathNode.campus_id == building.campus_id,
            PathNode.label == building.code.lower(),
        )
    ).scalars().all()
    for n in nodes:
        pt = _parse_point(n.location)
        connected.append(
            {
                "id": str(n.id),
                "label": n.label,
                "type": n.kind.value,
                "lat": pt[1] if pt else 0.0,
                "lng": pt[0] if pt else 0.0,
            }
        )

    pt = _parse_point(building.centroid)
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
