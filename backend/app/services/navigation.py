"""Navigation service — DB-backed graph and route request handler.

The service:

- Loads `PathNode` + `PathEdge` rows for the requested campus into an
  `InMemoryGraph` (decoupled from SQLAlchemy).
- Parses `POINT(lng lat)` WKT strings into (lng, lat) tuples.
- Translates `RouteError` subclasses into clean `NavigationResult` objects
  with a typed `status` field, so the HTTP layer doesn't leak Python
  exceptions across the boundary.
"""
from __future__ import annotations

import enum
import re
from collections.abc import Sequence
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.campus import Building, Campus, _uuid_pk  # noqa: F401  (Building/Campus used by callers)
from app.models.graph import PathEdge, PathNode, PathNodeKind
from app.routing.astar import (
    HeuristicKind,
    InMemoryGraph,
    NavEdge,
    NavNode,
    NoPath,
    Route,
    RouteError,
    RouteMode,
    RouteOptions,
    SourceEqualsDest,
    UnknownNode,
    find_alternatives,
    find_route,
)


_WKT_RE = re.compile(r"POINT\s*\(\s*(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s*\)", re.IGNORECASE)


def _parse_point(wkt: str) -> tuple[float, float]:
    """Parse a POINT(lng lat) WKT string. Returns (lng, lat)."""
    m = _WKT_RE.search(wkt or "")
    if not m:
        raise ValueError(f"Invalid WKT: {wkt!r}")
    return float(m.group(1)), float(m.group(2))


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------


class RouteStatus(str, enum.Enum):
    OK = "ok"
    UNKNOWN_NODE = "unknown_node"
    SOURCE_EQUALS_DEST = "source_equals_destination"
    NO_PATH = "no_path"
    INVALID_GRAPH = "invalid_graph"


@dataclass
class NavigationResult:
    status: RouteStatus
    route: Route | None = None
    error: str | None = None
    alternatives: list[Route] | None = None


# ---------------------------------------------------------------------------
# Graph construction
# ---------------------------------------------------------------------------


def build_campus_graph(session: Session, campus_id: UUID) -> InMemoryGraph:
    """Load all nodes/edges for a campus into an in-memory A* graph."""
    nodes = session.execute(
        select(PathNode).where(PathNode.campus_id == campus_id)
    ).scalars().all()
    edges = session.execute(
        select(PathEdge)
        .join(PathNode, PathEdge.from_node_id == PathNode.id)
        .where(PathNode.campus_id == campus_id)
    ).scalars().all()

    nav_nodes: list[NavNode] = []
    for n in nodes:
        lng, lat = _parse_point(n.location)
        # Find a paired building (best-effort: nearest by id ordering; the
        # loader stores the building's PathNode with the building's centroid,
        # so we look up the Building with the same code on this campus).
        building_id: UUID | None = None
        if n.kind == PathNodeKind.BUILDING_ENTRANCE:
            building = session.execute(
                select(Building).where(
                    Building.campus_id == n.campus_id,
                    Building.code == _label_to_building_code(n.label),
                )
            ).scalar_one_or_none()
            if building is not None:
                building_id = building.id
        nav_nodes.append(
            NavNode(
                id=n.id,
                lat=lat,
                lng=lng,
                type=n.kind.value,
                building_id=building_id,
                metadata={"label": n.label},
            )
        )

    nav_edges: list[NavEdge] = []
    for e in edges:
        nav_edges.append(
            NavEdge(
                id=e.id,
                from_id=e.from_node_id,
                to_id=e.to_node_id,
                distance=float(e.distance_m),
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
            )
        )

    return InMemoryGraph.build(nav_nodes, nav_edges)


def _label_to_building_code(label: str) -> str:
    """Reverse of the loader's `_building_code`. 'main_block' → 'MAIN_BLOCK'."""
    return label.upper()


# ---------------------------------------------------------------------------
# Route request handling
# ---------------------------------------------------------------------------


@dataclass
class RouteRequest:
    source_id: UUID
    destination_id: UUID
    require_accessible: bool = False
    heuristic: HeuristicKind = HeuristicKind.HAVERSINE
    mode: RouteMode = RouteMode.SHORTEST
    avoid_stairs: bool = False
    alternatives: int = 0


def request_route(graph: InMemoryGraph, req: RouteRequest) -> NavigationResult:
    """Run A* (+ optional alternatives) and translate errors into a typed
    result. Never throws."""
    options = RouteOptions(
        require_accessible=req.require_accessible,
        heuristic=req.heuristic,
        mode=req.mode,
        avoid_stairs=req.avoid_stairs,
    )
    try:
        route = find_route(graph, req.source_id, req.destination_id, options)
        alternatives: list[Route] = []
        if req.alternatives > 0:
            alternatives = find_alternatives(
                graph,
                req.source_id,
                req.destination_id,
                min(req.alternatives, 3),
                options,
            )
        return NavigationResult(
            status=RouteStatus.OK,
            route=route,
            alternatives=alternatives or None,
        )
    except UnknownNode as e:
        return NavigationResult(status=RouteStatus.UNKNOWN_NODE, error=str(e))
    except SourceEqualsDest as e:
        return NavigationResult(status=RouteStatus.SOURCE_EQUALS_DEST, error=str(e))
    except NoPath as e:
        return NavigationResult(status=RouteStatus.NO_PATH, error=str(e))
    except RouteError as e:
        return NavigationResult(status=RouteStatus.INVALID_GRAPH, error=str(e))


# ---------------------------------------------------------------------------
# Public list helpers (used by the HTTP layer)
# ---------------------------------------------------------------------------


def list_campus_nodes(session: Session, campus_id: UUID) -> Sequence[PathNode]:
    return session.execute(
        select(PathNode).where(PathNode.campus_id == campus_id)
    ).scalars().all()


def list_campus_edges(session: Session, campus_id: UUID) -> Sequence[PathEdge]:
    return session.execute(
        select(PathEdge)
        .join(PathNode, PathEdge.from_node_id == PathNode.id)
        .where(PathNode.campus_id == campus_id)
    ).scalars().all()


def list_campuses(session: Session) -> Sequence[Campus]:
    return session.execute(select(Campus).order_by(Campus.name)).scalars().all()


def get_campus_by_slug(session: Session, slug: str) -> Campus | None:
    return session.execute(
        select(Campus).where(Campus.slug == slug)
    ).scalar_one_or_none()