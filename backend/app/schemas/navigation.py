"""Navigation request/response schemas — also reused by Phase 3 tool calls."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.routing.astar import HeuristicKind, RouteMode
from app.services.navigation import RouteStatus

# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------


class CampusOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    slug: str
    description: str | None = None
    featured: bool = False
    center_lat: float | None = None
    center_lng: float | None = None
    # Optional 360°/immersive provider config — scene-linked only, each
    # scene carries its own per-block url (never a whole-site tour):
    # ({"provider": "campus360", "url": ..., "available": true,
    #   "label": ..., "scenes": {node_label: {"label": ..., "url": ...}}}).
    # Null when unset.
    immersive: dict[str, Any] | None = None


class CampusStatsOut(BaseModel):
    """Cheap catalog counts for the Explore hub (no graph loading)."""

    campus_id: UUID
    campus_slug: str
    buildings: int
    nodes: int
    entrances: int
    landmarks: int
    transit: int
    poi: int
    edges: int
    surveyed_edges: int


class CampusNearOut(CampusOut):
    distance_m: float


class BuildingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    campus_id: UUID
    name: str
    code: str
    num_floors: int
    has_elevator: bool
    is_accessible: bool
    lat: float | None = None
    lng: float | None = None


class PathNodeOut(BaseModel):
    id: UUID
    label: str
    type: str
    lat: float
    lng: float
    building_id: UUID | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class PathEdgeOut(BaseModel):
    id: UUID
    from_id: UUID
    to_id: UUID
    distance_m: float
    estimated: bool
    accessible: bool
    type: str
    walk_time_min: float | None = None
    has_stairs: bool = False
    is_restricted: bool = False
    is_indoor: bool = False
    is_outdoor: bool = True
    surface_type: str | None = None
    slope: float | None = None
    accessibility_verified: bool = False
    # Real walkway shape ([lng, lat] pairs along the path), when surveyed.
    # Null = straight-line between the endpoints (estimated edge).
    geometry: list[list[float]] | None = None


# ---------------------------------------------------------------------------
# Route request/response
# ---------------------------------------------------------------------------


class RouteRequestIn(BaseModel):
    source_id: UUID
    destination_id: UUID
    require_accessible: bool = False
    heuristic: HeuristicKind = HeuristicKind.HAVERSINE
    mode: RouteMode = RouteMode.SHORTEST
    avoid_stairs: bool = False
    alternatives: int = Field(default=0, ge=0, le=3)


class RouteStepOut(BaseModel):
    from_node_id: UUID
    to_node_id: UUID
    edge_id: UUID
    distance_m: float
    estimated: bool
    walk_time_min: float | None = None
    instruction: str | None = None
    # The edge's walkway shape as [lng, lat], oriented from_node_id ->
    # to_node_id. Absent for estimated (straight-line) steps.
    geometry: list[list[float]] | None = None


class RouteOut(BaseModel):
    source: UUID
    destination: UUID
    steps: list[RouteStepOut]
    total_distance_m: float
    estimated_walk_time_min: float
    step_count: int
    all_estimated: bool
    summary: str | None = None


class RouteResponse(BaseModel):
    status: RouteStatus
    error: str | None = None
    route: RouteOut | None = None
    alternatives: list[RouteOut] | None = None


class NearestNodeOut(BaseModel):
    """Closest graph node to a raw GPS fix — lets the client snap a live
    location to the walkable graph instead of faking a position on a path."""

    node_id: UUID
    label: str
    type: str
    lat: float
    lng: float
    distance_m: float