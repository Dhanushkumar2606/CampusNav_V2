"""Campus, Building, Floor, Room, Entrance, POI models.

Geo columns are intentionally typed as `String` on SQLite and as
`geography(Point,4326)` on Postgres (the migration handles the dialect
diff). The application code stores WKT (``POINT(lon lat)``) either way;
Phase 2 will add GIST indexes via a follow-up migration.
"""

from __future__ import annotations

import enum
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.user import GUID


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _uuid_pk() -> Mapped[UUID]:
    return mapped_column(GUID(), primary_key=True, default=uuid4)


# ---------------------------------------------------------------------------
# Campus
# ---------------------------------------------------------------------------


class Campus(Base):
    __tablename__ = "campuses"

    id: Mapped[UUID] = _uuid_pk()
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    buildings: Mapped[list["Building"]] = relationship(
        back_populates="campus", cascade="all, delete-orphan"
    )
    pois: Mapped[list["POI"]] = relationship(
        back_populates="campus", cascade="all, delete-orphan"
    )
    path_nodes: Mapped[list["PathNode"]] = relationship(
        back_populates="campus", cascade="all, delete-orphan"
    )


# ---------------------------------------------------------------------------
# Building / Floor / Room
# ---------------------------------------------------------------------------


class Building(Base):
    __tablename__ = "buildings"

    id: Mapped[UUID] = _uuid_pk()
    campus_id: Mapped[UUID] = mapped_column(GUID(), ForeignKey("campuses.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    code: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    # WKT of ``POINT(lon lat)``; populated by seed, queried in Phase 2.
    centroid: Mapped[str | None] = mapped_column(String(64), nullable=True)
    num_floors: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    has_elevator: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_accessible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    campus: Mapped[Campus] = relationship(back_populates="buildings")
    floors: Mapped[list["Floor"]] = relationship(
        back_populates="building", cascade="all, delete-orphan"
    )
    entrances: Mapped[list["Entrance"]] = relationship(
        back_populates="building", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("campus_id", "code", name="uq_buildings_campus_code"),
    )


class Floor(Base):
    __tablename__ = "floors"

    id: Mapped[UUID] = _uuid_pk()
    building_id: Mapped[UUID] = mapped_column(GUID(), ForeignKey("buildings.id"), nullable=False)
    level: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[str] = mapped_column(String(64), nullable=False)

    building: Mapped[Building] = relationship(back_populates="floors")
    rooms: Mapped[list["Room"]] = relationship(
        back_populates="floor", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("building_id", "level", name="uq_floors_building_level"),
    )


class Room(Base):
    __tablename__ = "rooms"

    id: Mapped[UUID] = _uuid_pk()
    floor_id: Mapped[UUID] = mapped_column(GUID(), ForeignKey("floors.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_accessible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    floor: Mapped[Floor] = relationship(back_populates="rooms")
    timetable_entries: Mapped[list["TimetableEntry"]] = relationship(
        back_populates="room", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("floor_id", "code", name="uq_rooms_floor_code"),
    )


# ---------------------------------------------------------------------------
# Entrance / POI
# ---------------------------------------------------------------------------


class Entrance(Base):
    __tablename__ = "entrances"

    id: Mapped[UUID] = _uuid_pk()
    building_id: Mapped[UUID] = mapped_column(GUID(), ForeignKey("buildings.id"), nullable=False)
    label: Mapped[str] = mapped_column(String(64), nullable=False)
    location: Mapped[str] = mapped_column(String(64), nullable=False)  # POINT(lon lat)
    is_accessible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    has_stairs: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    building: Mapped[Building] = relationship(back_populates="entrances")


class POICategory(str, enum.Enum):
    CAFE = "cafe"
    RESTROOM = "restroom"
    ATM = "atm"
    OUTDOOR = "outdoor"
    SERVICE = "service"
    OTHER = "other"


class POI(Base):
    __tablename__ = "pois"

    id: Mapped[UUID] = _uuid_pk()
    campus_id: Mapped[UUID] = mapped_column(GUID(), ForeignKey("campuses.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[POICategory] = mapped_column(
        Enum(POICategory, name="poi_category", native_enum=False, length=16),
        default=POICategory.OTHER,
        nullable=False,
    )
    location: Mapped[str] = mapped_column(String(64), nullable=False)  # POINT(lon lat)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    campus: Mapped[Campus] = relationship(back_populates="pois")
