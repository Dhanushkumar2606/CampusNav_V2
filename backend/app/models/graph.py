"""Path graph: nodes and edges used by the A* router in Phase 2."""

from __future__ import annotations

import enum
from uuid import UUID

from sqlalchemy import (
    Boolean,
    Enum,
    Float,
    ForeignKey,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.campus import Campus, _uuid_pk
from app.models.user import GUID


class PathNodeKind(str, enum.Enum):
    JUNCTION = "junction"            # path intersection
    BUILDING_ENTRANCE = "entrance"   # matches an Entrance (may link)
    POI = "poi"                      # matches a POI
    TRANSITION = "transition"        # indoor/outdoor; e.g. stairs to a floor
    LANDMARK = "landmark"            # auditorium, plaza, named open space
    TRANSIT = "transit"              # bus stop, train station, gate


class PathNode(Base):
    __tablename__ = "path_nodes"

    id: Mapped[UUID] = _uuid_pk()
    campus_id: Mapped[UUID] = mapped_column(
        GUID(),
        ForeignKey("campuses.id"),
        nullable=False,
        index=True,
    )
    label: Mapped[str] = mapped_column(String(64), nullable=False)
    # WKT of ``POINT(lon lat)``.
    location: Mapped[str] = mapped_column(String(64), nullable=False)
    kind: Mapped[PathNodeKind] = mapped_column(
        Enum(PathNodeKind, name="path_node_kind", native_enum=False, length=24),
        default=PathNodeKind.JUNCTION,
        nullable=False,
    )

    campus: Mapped[Campus] = relationship(back_populates="path_nodes")

    edges_from: Mapped[list["PathEdge"]] = relationship(
        "PathEdge",
        foreign_keys="PathEdge.from_node_id",
        back_populates="from_node",
        cascade="all, delete-orphan",
    )
    edges_to: Mapped[list["PathEdge"]] = relationship(
        "PathEdge",
        foreign_keys="PathEdge.to_node_id",
        back_populates="to_node",
        cascade="all, delete-orphan",
    )


class PathEdge(Base):
    __tablename__ = "path_edges"

    id: Mapped[UUID] = _uuid_pk()
    from_node_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("path_nodes.id"), nullable=False, index=True
    )
    to_node_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("path_nodes.id"), nullable=False, index=True
    )
    distance_m: Mapped[float] = mapped_column(Float, nullable=False)
    has_stairs: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_covered: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # `bidirectional` is a convenience flag for the router: True means the
    # graph is undirected; the seed loader enforces (from < to) to keep
    # parallel edges from creating duplicates.
    bidirectional: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # True when the edge's distance / topology came from a non-surveyed
    # source (e.g. straight-line estimate between two geo points). Phase 2
    # uses this to style the rendered route so reviewers can see what's
    # ground-truth vs estimated.
    is_estimated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # True if the edge avoids stairs/steps (route is ramp/elevator compatible).
    # Defaults to true so the existing dataset is usable until surveyed data
    # is supplied.
    is_accessible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Future-proofing: walk / stairs / ramp / transit / etc.
    edge_type: Mapped[str] = mapped_column(String(16), nullable=False, default="walk")
    # Optional: walk time in minutes, populated when the source dataset
    # supplies it (the SRM KTR JSON does).
    walk_time_min: Mapped[float | None] = mapped_column(Float, nullable=True)

    from_node: Mapped[PathNode] = relationship(
        "PathNode", foreign_keys=[from_node_id], back_populates="edges_from"
    )
    to_node: Mapped[PathNode] = relationship(
        "PathNode", foreign_keys=[to_node_id], back_populates="edges_to"
    )
