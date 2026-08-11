"""Navigation HTTP router: catalog + route POST.

Endpoints:
  GET  /navigation/campuses
  GET  /navigation/campuses/{slug}/graph         — nodes + edges for the campus
  POST /navigation/campuses/{slug}/route         — A* route request
  GET  /navigation/campuses/{slug}/buildings     — building centroids for the map

The router uses `app.services.navigation` for all DB + A* logic so the A*
implementation stays decoupled from FastAPI.
"""

from __future__ import annotations

import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.navigation import (
    BuildingOut,
    CampusOut,
    PathEdgeOut,
    PathNodeOut,
    RouteOut,
    RouteRequestIn,
    RouteResponse,
    RouteStepOut,
)
from app.services.navigation import (
    RouteRequest,
    RouteStatus,
    build_campus_graph,
    get_campus_by_slug,
    list_campus_edges,
    list_campus_nodes,
    list_campuses,
    request_route,
)

router = APIRouter(prefix="/navigation", tags=["navigation"])


# --- helpers ---------------------------------------------------------------


_WKT_RE = re.compile(r"POINT\s*\(\s*(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s*\)", re.IGNORECASE)


def _parse_lng_lat(wkt: str) -> tuple[float, float]:
    m = _WKT_RE.search(wkt or "")
    if not m:
        raise ValueError(f"Invalid WKT: {wkt!r}")
    return float(m.group(1)), float(m.group(2))


# --- endpoints -------------------------------------------------------------


@router.get("/campuses", response_model=list[CampusOut])
def campuses(db: Session = Depends(get_db)) -> list[CampusOut]:
    return [CampusOut.model_validate(c) for c in list_campuses(db)]


@router.get(
    "/campuses/{slug}/graph",
    response_model=dict,
)
def campus_graph(
    slug: Annotated[str, Path(min_length=1, max_length=64)],
    db: Session = Depends(get_db),
) -> dict:
    """Return all path nodes and edges for a campus.

    The frontend uses this to render the static map. The A* route is
    computed on demand via `POST /campuses/{slug}/route`.
    """
    campus = get_campus_by_slug(db, slug)
    if campus is None:
        raise HTTPException(status_code=404, detail=f"campus not found: {slug}")

    nodes = list_campus_nodes(db, campus.id)
    edges = list_campus_edges(db, campus.id)

    # Build a label→node-id lookup so the frontend can address nodes by
    # their readable label (matches the seed JSON).
    label_to_id = {n.label: n.id for n in nodes}

    # Pair buildings with their entrance nodes.
    from sqlalchemy import select as _select
    from app.models.campus import Building

    buildings_db = db.execute(
        _select(Building).where(Building.campus_id == campus.id)
    ).scalars().all()
    building_by_code = {b.code: b for b in buildings_db}

    out_nodes: list[PathNodeOut] = []
    for n in nodes:
        lng, lat = _parse_lng_lat(n.location)
        building_id = None
        if n.label in building_by_code:
            building_id = building_by_code[n.label].id
        out_nodes.append(
            PathNodeOut(
                id=n.id,
                label=n.label,
                type=n.kind.value,
                lat=lat,
                lng=lng,
                building_id=building_id,
                metadata={"campus_id": str(n.campus_id)},
            )
        )

    out_edges: list[PathEdgeOut] = [
        PathEdgeOut(
            id=e.id,
            from_id=e.from_node_id,
            to_id=e.to_node_id,
            distance_m=float(e.distance_m),
            estimated=bool(e.is_estimated),
            accessible=bool(e.is_accessible),
            type=str(e.edge_type),
            walk_time_min=float(e.walk_time_min) if e.walk_time_min is not None else None,
        )
        for e in edges
    ]

    return {
        "campus": CampusOut.model_validate(campus).model_dump(mode="json"),
        "nodes": [n.model_dump(mode="json") for n in out_nodes],
        "edges": [e.model_dump(mode="json") for e in out_edges],
        "labels": label_to_id,
    }


@router.get("/campuses/{slug}/buildings", response_model=list[BuildingOut])
def campus_buildings(
    slug: Annotated[str, Path(min_length=1, max_length=64)],
    db: Session = Depends(get_db),
) -> list[BuildingOut]:
    campus = get_campus_by_slug(db, slug)
    if campus is None:
        raise HTTPException(status_code=404, detail=f"campus not found: {slug}")

    from sqlalchemy import select as _select
    from app.models.campus import Building

    rows = db.execute(
        _select(Building).where(Building.campus_id == campus.id).order_by(Building.code)
    ).scalars().all()

    out: list[BuildingOut] = []
    for b in rows:
        lng, lat = (_parse_lng_lat(b.centroid) if b.centroid else (0.0, 0.0))
        out.append(
            BuildingOut(
                id=b.id,
                campus_id=b.campus_id,
                name=b.name,
                code=b.code,
                num_floors=b.num_floors,
                has_elevator=b.has_elevator,
                is_accessible=b.is_accessible,
                lng=lng,
                lat=lat,
            )
        )
    return out


@router.post(
    "/campuses/{slug}/route",
    response_model=RouteResponse,
    status_code=status.HTTP_200_OK,
)
def compute_route(
    slug: Annotated[str, Path(min_length=1, max_length=64)],
    payload: RouteRequestIn,
    db: Session = Depends(get_db),
) -> RouteResponse:
    campus = get_campus_by_slug(db, slug)
    if campus is None:
        raise HTTPException(status_code=404, detail=f"campus not found: {slug}")

    graph = build_campus_graph(db, campus.id)

    result = request_route(
        graph,
        RouteRequest(
            source_id=payload.source_id,
            destination_id=payload.destination_id,
            require_accessible=payload.require_accessible,
            heuristic=payload.heuristic,
        ),
    )

    if result.status == RouteStatus.OK and result.route is not None:
        r = result.route
        route_out = RouteOut(
            source=r.source,
            destination=r.destination,
            steps=[
                RouteStepOut(
                    from_node_id=s.from_node_id,
                    to_node_id=s.to_node_id,
                    edge_id=s.edge_id,
                    distance_m=s.distance_m,
                    estimated=s.estimated,
                    walk_time_min=s.walk_time_min,
                )
                for s in r.steps
            ],
            total_distance_m=r.total_distance_m,
            estimated_walk_time_min=r.estimated_walk_time_min,
            step_count=r.step_count,
            all_estimated=r.all_estimated,
        )
        return RouteResponse(status=result.status, route=route_out)

    # Map status → HTTP code for the standard cases; everything else is 422.
    if result.status in (RouteStatus.UNKNOWN_NODE, RouteStatus.SOURCE_EQUALS_DEST):
        raise HTTPException(status_code=400, detail=result.error)
    if result.status == RouteStatus.NO_PATH:
        raise HTTPException(status_code=404, detail=result.error)
    raise HTTPException(status_code=422, detail=result.error)