"""Discovery router: search, building detail, campus categories."""

from __future__ import annotations

import dataclasses
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.campus import Building, Campus
from app.models.graph import PathNode, PathNodeKind
from app.schemas.discovery import (
    BuildingDetailOut,
    CategoryOut,
    SearchResultOut,
)
from app.services.discovery import get_building_detail
from app.services.search import search

router = APIRouter(tags=["discovery"])


@router.get("/search", response_model=list[SearchResultOut])
def search_endpoint(
    q: Annotated[str, Query(min_length=1, max_length=120)],
    campus: Annotated[str | None, Query(max_length=64)] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    lat: Annotated[float | None, Query(ge=-90, le=90)] = None,
    lng: Annotated[float | None, Query(ge=-180, le=180)] = None,
    db: Session = Depends(get_db),
) -> list[SearchResultOut]:
    """Fuzzy campus search over buildings, graph nodes, POIs and rooms.

    Optional `lat`/`lng` bias results toward that location ("near me").
    """
    return [
        SearchResultOut.model_validate(dataclasses.asdict(r))
        for r in search(db, q, campus, limit, near_lat=lat, near_lng=lng)
    ]


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
    detail = get_building_detail(db, building_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="building not found")
    return detail
