"""Discovery + user-data schemas: search, building detail, categories,
favorites, preferences."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------


class SearchResultOut(BaseModel):
    id: UUID
    label: str
    type: str
    category: str
    lat: float
    lng: float
    campus_id: UUID
    campus_slug: str
    campus_name: str
    building_id: UUID | None = None
    subtitle: str | None = None
    score: float
    # Destination key that resolves through the campus graph `labels` map
    # (building code / node label); None when no graph node exists.
    slug: str | None = None


class CategoryOut(BaseModel):
    key: str
    label: str
    count: int


# ---------------------------------------------------------------------------
# Building detail
# ---------------------------------------------------------------------------


class EntranceOut(BaseModel):
    id: UUID
    label: str
    lat: float
    lng: float
    is_accessible: bool
    has_stairs: bool


class FloorOut(BaseModel):
    id: UUID
    level: int
    label: str
    rooms_count: int


class BuildingDetailOut(BaseModel):
    id: UUID
    campus_id: UUID
    name: str
    code: str
    num_floors: int
    has_elevator: bool
    is_accessible: bool
    lat: float | None = None
    lng: float | None = None
    entrances: list[EntranceOut] = Field(default_factory=list)
    floors: list[FloorOut] = Field(default_factory=list)
    connecting_nodes: list[dict[str, Any]] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Favorites / preferences
# ---------------------------------------------------------------------------


class FavoriteIn(BaseModel):
    target_type: str = Field(pattern="^(building|node)$")
    target_id: UUID
    note: str | None = Field(default=None, max_length=255)


class FavoriteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    target_type: str
    target_id: UUID
    note: str | None = None
    created_at: datetime
    # Resolved label — filled by the router (not a DB column).
    label: str | None = None
    category: str | None = None


class PreferencesIn(BaseModel):
    """Partial preferences payload — only provided keys are updated."""

    units: str | None = Field(default=None, pattern="^(metric|imperial)$")
    default_mode: str | None = Field(default=None, pattern="^(shortest|fastest)$")
    default_avoid_stairs: bool | None = None
    default_require_accessible: bool | None = None
    theme: str | None = Field(default=None, pattern="^(dark|light)$")


class PreferencesOut(BaseModel):
    units: str = "metric"
    default_mode: str = "shortest"
    default_avoid_stairs: bool = False
    default_require_accessible: bool = False
    theme: str = "dark"
