"""Assistant tool registry + dispatcher (Phase H).

Six tools, each a pure function of (session, args):

  search_campus        — fuzzy search over buildings/nodes/rooms
  get_nearby_places    — nodes within a radius of a live fix
  get_building_details — entrances/floors/rooms for one building
  calculate_route      — REAL A* routing (no placeholder text)
  get_campus_info      — campus stats (buildings/nodes/edges)
  list_categories      — category counts for a campus

The intent classifier in `assistant.py` maps a user message onto one or
more tool calls; results are rendered as cards by the frontend.
"""

from __future__ import annotations

import re
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.campus import Building
from app.models.graph import PathNode, PathNodeKind
from app.routing.astar import HeuristicKind, RouteMode
from app.services.discovery import (
    campus_stats,
    find_campus,
    get_building_detail,
    parse_point,
)
from app.services.navigation import (
    RouteRequest,
    build_campus_graph,
    request_route,
)
from app.services.search import search as search_service

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)

TOOL_DEFS: list[dict[str, Any]] = [
    {"name": "search_campus", "description": "Fuzzy search over campus buildings, landmarks and rooms."},
    {"name": "get_nearby_places", "description": "Walkable places within a radius of a coordinate."},
    {"name": "get_building_details", "description": "Entrances, floors and rooms of one building."},
    {"name": "calculate_route", "description": "Real walking route between two places with distance and ETA."},
    {"name": "get_campus_info", "description": "Campus facts: name, building/node/edge counts."},
    {"name": "list_categories", "description": "Category counts (buildings, landmarks, transit, places)."},
]


def _serialize_search(results) -> list[dict[str, Any]]:
    return [
        {
            "id": str(r.id),
            "label": r.label,
            "type": r.type,
            "category": r.category,
            "slug": r.slug,
            "campus_slug": r.campus_slug,
            "campus_name": r.campus_name,
            "score": r.score,
            "lat": r.lat,
            "lng": r.lng,
        }
        for r in results
    ]


def run_search_campus(session: Session, args: dict[str, Any]) -> dict[str, Any]:
    query = str(args.get("query", "")).strip()
    if not query:
        return {"results": []}
    limit = min(max(int(args.get("limit", 5)), 1), 10)
    campus = args.get("campus") or None
    results = search_service(session, query, campus, limit=limit)
    return {"results": _serialize_search(results)}


def run_get_nearby_places(session: Session, args: dict[str, Any]) -> dict[str, Any]:
    lat = args.get("lat")
    lng = args.get("lng")
    if lat is None or lng is None:
        return {"error": "missing coordinates", "places": []}
    campus = find_campus(session, args.get("campus") or None)
    if campus is None:
        return {"error": "no campus", "places": []}
    radius_m = float(args.get("radius_m", 300))
    category = (args.get("category") or "").lower() or None

    places: list[dict[str, Any]] = []
    for node in campus.path_nodes:
        if category and node.kind.value != category:
            continue
        pt = parse_point(node.location)
        if not pt:
            continue
        from app.services.navigation import _haversine

        d = _haversine(lat, lng, pt[1], pt[0])
        if d <= radius_m:
            places.append(
                {
                    "node_id": str(node.id),
                    "label": node.label,
                    "type": node.kind.value,
                    "lat": pt[1],
                    "lng": pt[0],
                    "distance_m": round(d, 1),
                }
            )
    places.sort(key=lambda p: p["distance_m"])
    return {"campus": campus.slug, "places": places}


def run_get_building_details(session: Session, args: dict[str, Any]) -> dict[str, Any]:
    building_id = str(args.get("building_id", ""))
    detail = get_building_detail(session, building_id)
    if detail is None:
        return {"error": f"building not found: {building_id}"}
    out = detail.model_dump()
    out["id"] = str(out["id"])
    out["campus_id"] = str(out["campus_id"])
    for e in out["entrances"]:
        e["id"] = str(e["id"])
    for f in out["floors"]:
        f["id"] = str(f["id"])
    return out


def _resolve_endpoint(graph, labels: dict[str, UUID], endpoint: str) -> UUID | None:
    """Endpoint may be a label (campus node label) or a node UUID."""
    if not endpoint:
        return None
    if UUID_RE.match(endpoint):
        for node in graph.nodes():
            if str(node.id) == endpoint:
                return node.id
        return None
    return labels.get(endpoint.lower())


def run_calculate_route(session: Session, args: dict[str, Any]) -> dict[str, Any]:
    from app.services.navigation import list_campus_nodes

    campus = find_campus(session, args.get("campus") or None)
    if campus is None:
        return {"error": "no campus"}
    graph = build_campus_graph(session, campus.id)
    labels: dict[str, UUID] = {}
    for n in list_campus_nodes(session, campus.id):
        labels[n.label.lower()] = n.id
    source = _resolve_endpoint(graph, labels, str(args.get("source", "")))
    destination = _resolve_endpoint(graph, labels, str(args.get("destination", "")))
    if source is None or destination is None:
        missing = []
        if source is None:
            missing.append("source")
        if destination is None:
            missing.append("destination")
        return {"error": f"unknown {' and '.join(missing)}", "campus": campus.slug}

    mode = RouteMode.FASTEST if args.get("mode") == "fastest" else RouteMode.SHORTEST
    result = request_route(
        graph,
        RouteRequest(
            source_id=source,
            destination_id=destination,
            require_accessible=bool(args.get("require_accessible", False)),
            heuristic=HeuristicKind.HAVERSINE,
            mode=mode,
            avoid_stairs=bool(args.get("avoid_stairs", False)),
        ),
    )
    if result.status.value != "ok" or result.route is None:
        return {
            "error": result.error or result.status.value,
            "status": result.status.value,
            "campus": campus.slug,
        }

    route = result.route
    return {
        "campus": campus.slug,
        "source": str(route.source),
        "destination": str(route.destination),
        "mode": mode.value,
        "total_distance_m": round(route.total_distance_m, 1),
        "estimated_walk_time_min": round(route.estimated_walk_time_min, 1),
        "step_count": route.step_count,
        "all_estimated": route.all_estimated,
        "steps": [
            {
                "instruction": s.instruction,
                "distance_m": round(s.distance_m, 1),
                "estimated": s.estimated,
                "walk_time_min": s.walk_time_min,
            }
            for s in route.steps
        ],
    }


def run_get_campus_info(session: Session, args: dict[str, Any]) -> dict[str, Any]:
    campus = find_campus(session, args.get("campus") or None)
    if campus is None:
        return {"error": "no campus"}
    return campus_stats(session, campus)


def run_list_categories(session: Session, args: dict[str, Any]) -> dict[str, Any]:
    campus = find_campus(session, args.get("campus") or None)
    if campus is None:
        return {"error": "no campus"}
    building_count = int(
        session.execute(
            select(func.count()).select_from(Building).where(Building.campus_id == campus.id)
        ).scalar_one()
    )
    counts: list[dict[str, Any]] = [
        {"key": "building", "label": "Buildings", "count": building_count}
    ]
    rows = session.execute(
        select(PathNode.kind, func.count())
        .where(PathNode.campus_id == campus.id)
        .group_by(PathNode.kind)
    ).all()
    for kind, count in rows:
        if kind == PathNodeKind.BUILDING_ENTRANCE:
            continue
        label = {
            PathNodeKind.LANDMARK: "Landmarks",
            PathNodeKind.TRANSIT: "Transport",
            PathNodeKind.POI: "Places",
            PathNodeKind.JUNCTION: "Pathways",
        }.get(kind, kind.value.capitalize())
        counts.append({"key": label.lower(), "label": label, "count": int(count)})
    return {"campus": campus.slug, "categories": counts}


TOOL_RUNNERS: dict[str, Any] = {
    "search_campus": run_search_campus,
    "get_nearby_places": run_get_nearby_places,
    "get_building_details": run_get_building_details,
    "calculate_route": run_calculate_route,
    "get_campus_info": run_get_campus_info,
    "list_categories": run_list_categories,
}


def run_tool(session: Session, name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Execute one tool by name; never raises (returns {'error': ...})."""
    runner = TOOL_RUNNERS.get(name)
    if runner is None:
        return {"error": f"unknown tool: {name}"}
    try:
        return runner(session, args)
    except Exception as exc:  # noqa: BLE001 — tool errors are user-facing text
        return {"error": f"{name} failed: {exc}"}
