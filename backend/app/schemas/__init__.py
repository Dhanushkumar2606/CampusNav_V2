"""Pydantic v2 schemas shared across routers and the eventual AI tool-calls."""

from app.schemas.auth import (
    RegisterIn,
    LoginIn,
    TokenOut,
    UserOut,
)
from app.schemas.health import HealthOut
from app.schemas.navigation import (
    BuildingOut,
    CampusOut,
    PathEdgeOut,
    PathNodeOut,
    RouteRequestIn,
    RouteResponse,
    RouteOut,
    RouteStepOut,
)

__all__ = [
    "BuildingOut",
    "CampusOut",
    "HealthOut",
    "LoginIn",
    "PathEdgeOut",
    "PathNodeOut",
    "RegisterIn",
    "RouteOut",
    "RouteRequestIn",
    "RouteResponse",
    "RouteStepOut",
    "TokenOut",
    "UserOut",
]
