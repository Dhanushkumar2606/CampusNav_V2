"""Navigation HTTP router: catalog + route POST.

Endpoints:
  GET  /navigation/campuses                     — catalog list
  GET  /navigation/campuses/near                — camps ranked by distance from a point
  GET  /navigation/campuses/{slug}/stats        — cheap catalog counts (Explore hub)
  GET  /navigation/campuses/{slug}/graph        — nodes + edges for the campus
  GET  /navigation/campuses/{slug}/nearest-node — GPS-fix snapping to the graph
  GET  /navigation/campuses/{slug}/buildings    — building centroids for the map
  POST /navigation/campuses/{slug}/route        — A* route request

The router uses `app.services.navigation` for all DB + A* logic so the A*
implementation stays decoupled from FastAPI.
"""

from __future__ import annotations

import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.navigation import (
    BuildingOut,
    CampusNearOut,
    CampusOut,
    CampusStatsOut,
    NearestNodeOut,
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
    campus_stats as service_campus_stats,
    campuses_near as service_campuses_near,
    get_campus_by_slug,
    list_campus_edges,
    list_campus_nodes,
    list_campuses,
    request_route,
)
from app.services.navigation import (
    nearest_node as nearest_campus_node,
)

router = APIRouter(prefix="/navigation", tags=["navigation"])


# --- helpers ---------------------------------------------------------------


_WKT_RE = re.compile(r"POINT\s*\(\s*(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s*\)", re.IGNORECASE)
_LINESTRING_RE = re.compile(
    r"LINESTRING\s*\(\s*(.*?)\s*\)", re.IGNORECASE | re.DOTALL
)
_COORD_PAIR_RE = re.compile(r"(-?\d+\.?\d*)\s+(-?\d+\.?\d*)")


def _parse_lng_lat(wkt: str) -> tuple[float, float]:
    m = _WKT_RE.search(wkt or "")
    if not m:
        raise ValueError(f"Invalid WKT: {wkt!r}")
    return float(m.group(1)), float(m.group(2))


def _parse_linestring(wkt: str | None) -> list[list[float]] | None:
    """WKT LINESTRING(lng lat, ...) -> [[lng, lat], ...], or None."""
    if not wkt:
        return None
    m = _LINESTRING_RE.search(wkt)
    if not m:
        return None
    pts: list[list[float]] = []
    for pair in _COORD_PAIR_RE.finditer(m.group(1)):
        pts.append([float(pair.group(1)), float(pair.group(2))])
    return pts if len(pts) >= 2 else None


# --- endpoints -------------------------------------------------------------


@router.get("/campuses", response_model=list[CampusOut])
def campuses(db: Session = Depends(get_db)) -> list[CampusOut]:
    return [CampusOut.model_validate(c) for c in list_campuses(db)]


@router.get("/campuses/near", response_model=list[CampusNearOut])
def campuses_near(
    lat: Annotated[float, Query(ge=-90, le=90)],
    lng: Annotated[float, Query(ge=-180, le=180)],
    limit: Annotated[int, Query(ge=1, le=25)] = 10,
    radius_m: Annotated[float, Query(ge=0)] = 200_000,
    db: Session = Depends(get_db),
) -> list[CampusNearOut]:
    """Campuses ranked by distance from a point, nearest first.

    Only campuses with a catalog centroid participate; `distance_m` is the
    honest haversine distance in meters.
    """
    return [
        CampusNearOut.model_validate({**CampusOut.model_validate(c).model_dump(), "distance_m": d})
        for c, d in service_campuses_near(db, lat, lng, limit=limit, radius_m=radius_m)
    ]


@router.get("/campuses/{slug}/stats", response_model=CampusStatsOut)
def campus_stats(
    slug: Annotated[str, Path(min_length=1, max_length=64)],
    db: Session = Depends(get_db),
) -> CampusStatsOut:
    """Cheap catalog counts for one campus (Explore hub cards)."""
    campus = get_campus_by_slug(db, slug)
    if campus is None:
        raise HTTPException(status_code=404, detail=f"campus not found: {slug}")

    return CampusStatsOut(
        campus_id=campus.id,
        campus_slug=campus.slug,
        **service_campus_stats(db, campus.id),
    )


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
    # Codes are uppercase in the catalog but node labels are lowercase in
    # the graph — compare case-insensitively so every building pairs with
    # its entrance node.
    building_by_code = {b.code.casefold(): b for b in buildings_db}

    out_nodes: list[PathNodeOut] = []
    # Optional per-node immersive info from the campus-level config:
    # {"provider", "url", "label", "available"} merged from `scenes` keyed by
    # the node's seed label; "media_id" carries the 360° scene id when the
    # provider renders scene tiles in-app (e.g. the SRM tour's cube scenes).
    # Scene-linked only: a node carries immersive metadata solely when ITS
    # OWN scene has a real url or media_id — never a whole-site tour.
    # Purely additive — navigation ignores it.
    campus_immersive = campus.immersive or {}
    campus_scenes = campus_immersive.get("scenes") or {}
    for n in nodes:
        lng, lat = _parse_lng_lat(n.location)
        building_id = None
        if n.label.casefold() in building_by_code:
            building_id = building_by_code[n.label.casefold()].id
        metadata: dict = {"campus_id": str(n.campus_id)}
        scene = campus_scenes.get(n.label)
        if isinstance(scene, dict) and scene and (scene.get("url") or scene.get("media_id")):
            metadata["immersive"] = {
                "provider": scene.get("provider")
                or campus_immersive.get("provider", "campus360"),
                "url": scene.get("url"),
                "mediaId": scene.get("media_id"),
                "available": bool(scene.get("available", True)),
                "label": scene.get("label") or n.label,
            }
        out_nodes.append(
            PathNodeOut(
                id=n.id,
                label=n.label,
                type=n.kind.value,
                lat=lat,
                lng=lng,
                building_id=building_id,
                metadata=metadata,
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
            has_stairs=bool(e.has_stairs),
            is_restricted=bool(e.is_restricted),
            is_indoor=bool(e.is_indoor),
            is_outdoor=bool(e.is_outdoor),
            surface_type=e.surface_type,
            slope=float(e.slope) if e.slope is not None else None,
            accessibility_verified=bool(e.accessibility_verified),
            geometry=_parse_linestring(e.geometry),
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


@router.get(
    "/campuses/{slug}/nearest-node",
    response_model=NearestNodeOut,
)
def nearest_node(
    slug: Annotated[str, Path(min_length=1, max_length=64)],
    lat: Annotated[float, Query(ge=-90, le=90)],
    lng: Annotated[float, Query(ge=-180, le=180)],
    db: Session = Depends(get_db),
) -> NearestNodeOut:
    """Snap a raw GPS fix to the walkable graph: returns the closest node
    and its straight-line distance to the fix (honest — never fabricates
    a position on a path)."""
    campus = get_campus_by_slug(db, slug)
    if campus is None:
        raise HTTPException(status_code=404, detail=f"campus not found: {slug}")
    hit = nearest_campus_node(db, campus.id, lat, lng)
    if hit is None:
        raise HTTPException(status_code=404, detail="campus has no graph nodes")
    node, distance_m = hit
    node_lng, node_lat = _parse_lng_lat(node.location)
    return NearestNodeOut(
        node_id=node.id,
        label=node.label,
        type=node.kind.value,
        lat=node_lat,
        lng=node_lng,
        distance_m=distance_m,
    )


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
            mode=payload.mode,
            avoid_stairs=payload.avoid_stairs,
            alternatives=payload.alternatives,
        ),
    )

    def _route_out(r: Route) -> RouteOut:
        return RouteOut(
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
                    instruction=s.instruction,
                    geometry=s.geometry,
                )
                for s in r.steps
            ],
            total_distance_m=r.total_distance_m,
            estimated_walk_time_min=r.estimated_walk_time_min,
            step_count=r.step_count,
            all_estimated=r.all_estimated,
            summary=r.summary,
        )

    if result.status == RouteStatus.OK and result.route is not None:
        alternatives = [ _route_out(r) for r in (result.alternatives or []) ]
        return RouteResponse(
            status=result.status,
            route=_route_out(result.route),
            alternatives=alternatives or None,
        )

    # Map status → HTTP code for the standard cases; everything else is 422.
    if result.status in (RouteStatus.UNKNOWN_NODE, RouteStatus.SOURCE_EQUALS_DEST):
        raise HTTPException(status_code=400, detail=result.error)
    if result.status in (RouteStatus.NO_PATH, RouteStatus.NO_ACCESS_ROUTE):
        raise HTTPException(status_code=404, detail=result.error)
    raise HTTPException(status_code=422, detail=result.error)