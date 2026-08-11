"""Navigation request/response schemas — also reused by Phase 3 tool calls."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.routing.astar import HeuristicKind
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


# ---------------------------------------------------------------------------
# Route request/response
# ---------------------------------------------------------------------------


class RouteRequestIn(BaseModel):
    source_id: UUID
    destination_id: UUID
    require_accessible: bool = False
    heuristic: HeuristicKind = HeuristicKind.HAVERSINE


class RouteStepOut(BaseModel):
    from_node_id: UUID
    to_node_id: UUID
    edge_id: UUID
    distance_m: float
    estimated: bool
    walk_time_min: float | None = None


class RouteOut(BaseModel):
    source: UUID
    destination: UUID
    steps: list[RouteStepOut]
    total_distance_m: float
    estimated_walk_time_min: float
    step_count: int
    all_estimated: bool


class RouteResponse(BaseModel):
    status: RouteStatus
    error: str | None = None
    route: RouteOut | None = None