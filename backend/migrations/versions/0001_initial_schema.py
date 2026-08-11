"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-08-10

Notes
-----
Geo columns are written as `geography(Point,4326)` on Postgres+PostGIS and as
plain `String` on SQLite. The application code stores WKT (``POINT(lon lat)``)
either way; Phase 2 will add GIST indexes via a follow-up migration that
no-ops on SQLite.

Unique constraints are declared inline on `create_table` so the migration
runs on both SQLite (no ALTER CONSTRAINT support) and Postgres.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# --- dialect-aware type helpers -------------------------------------------------


def _is_postgres() -> bool:
    bind = op.get_bind()
    return bind.dialect.name == "postgresql"


def _uuid_type():
    """UUID PK column that works on both Postgres and SQLite."""
    return sa.String(length=36)


def _point_type():
    """geography(Point,4326) on Postgres, String on SQLite."""
    if _is_postgres():
        from geoalchemy2 import Geography

        return Geography(geometry_type="POINT", srid=4326)
    return sa.String(length=64)


# --- upgrade --------------------------------------------------------------------


def upgrade() -> None:
    uuid_t = _uuid_type()
    point = _point_type()

    # Users ---------------------------------------------------------------
    op.create_table(
        "users",
        sa.Column("id", uuid_t, primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("full_name", sa.String(255), nullable=False),
        sa.Column(
            "role",
            sa.Enum("student", "staff", "admin", name="user_role", native_enum=False, length=16),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("disabled_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    # Campuses ------------------------------------------------------------
    op.create_table(
        "campuses",
        sa.Column("id", uuid_t, primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(64), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("slug", name="uq_campuses_slug"),
    )
    op.create_index("ix_campuses_slug", "campuses", ["slug"], unique=True)

    # Buildings -----------------------------------------------------------
    op.create_table(
        "buildings",
        sa.Column("id", uuid_t, primary_key=True),
        sa.Column("campus_id", uuid_t, sa.ForeignKey("campuses.id"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("centroid", point, nullable=True),
        sa.Column("num_floors", sa.Integer, nullable=False, server_default="1"),
        sa.Column("has_elevator", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("is_accessible", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.UniqueConstraint("campus_id", "code", name="uq_buildings_campus_code"),
    )
    op.create_index("ix_buildings_code", "buildings", ["code"])

    # Floors --------------------------------------------------------------
    op.create_table(
        "floors",
        sa.Column("id", uuid_t, primary_key=True),
        sa.Column("building_id", uuid_t, sa.ForeignKey("buildings.id"), nullable=False),
        sa.Column("level", sa.Integer, nullable=False),
        sa.Column("label", sa.String(64), nullable=False),
        sa.UniqueConstraint("building_id", "level", name="uq_floors_building_level"),
    )

    # Rooms ---------------------------------------------------------------
    op.create_table(
        "rooms",
        sa.Column("id", uuid_t, primary_key=True),
        sa.Column("floor_id", uuid_t, sa.ForeignKey("floors.id"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("capacity", sa.Integer, nullable=True),
        sa.Column("is_accessible", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.UniqueConstraint("floor_id", "code", name="uq_rooms_floor_code"),
    )

    # Entrances -----------------------------------------------------------
    op.create_table(
        "entrances",
        sa.Column("id", uuid_t, primary_key=True),
        sa.Column("building_id", uuid_t, sa.ForeignKey("buildings.id"), nullable=False),
        sa.Column("label", sa.String(64), nullable=False),
        sa.Column("location", point, nullable=False),
        sa.Column("is_accessible", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("has_stairs", sa.Boolean, nullable=False, server_default=sa.false()),
    )

    # POIs ----------------------------------------------------------------
    op.create_table(
        "pois",
        sa.Column("id", uuid_t, primary_key=True),
        sa.Column("campus_id", uuid_t, sa.ForeignKey("campuses.id"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column(
            "category",
            sa.Enum(
                "cafe", "restroom", "atm", "outdoor", "service", "other",
                name="poi_category", native_enum=False, length=16,
            ),
            nullable=False,
        ),
        sa.Column("location", point, nullable=False),
        sa.Column("description", sa.Text, nullable=True),
    )

    # Path nodes ----------------------------------------------------------
    op.create_table(
        "path_nodes",
        sa.Column("id", uuid_t, primary_key=True),
        sa.Column("campus_id", uuid_t, sa.ForeignKey("campuses.id"), nullable=False),
        sa.Column("label", sa.String(64), nullable=False),
        sa.Column("location", point, nullable=False),
        sa.Column(
            "kind",
            sa.Enum(
                "junction", "entrance", "poi", "transition",
                name="path_node_kind", native_enum=False, length=24,
            ),
            nullable=False,
        ),
    )
    op.create_index("ix_path_nodes_campus_id", "path_nodes", ["campus_id"])

    # Path edges ----------------------------------------------------------
    op.create_table(
        "path_edges",
        sa.Column("id", uuid_t, primary_key=True),
        sa.Column("from_node_id", uuid_t, sa.ForeignKey("path_nodes.id"), nullable=False),
        sa.Column("to_node_id", uuid_t, sa.ForeignKey("path_nodes.id"), nullable=False),
        sa.Column("distance_m", sa.Float, nullable=False),
        sa.Column("has_stairs", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("is_covered", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("bidirectional", sa.Boolean, nullable=False, server_default=sa.true()),
    )
    op.create_index("ix_path_edges_from_node_id", "path_edges", ["from_node_id"])
    op.create_index("ix_path_edges_to_node_id", "path_edges", ["to_node_id"])

    # Timetable entries ---------------------------------------------------
    op.create_table(
        "timetable_entries",
        sa.Column("id", uuid_t, primary_key=True),
        sa.Column("user_id", uuid_t, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("room_id", uuid_t, sa.ForeignKey("rooms.id"), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("course_code", sa.String(32), nullable=False),
        sa.Column("notes", sa.Text, nullable=True),
    )
    op.create_index("ix_timetable_entries_user_id", "timetable_entries", ["user_id"])
    op.create_index("ix_timetable_entries_room_id", "timetable_entries", ["room_id"])


def downgrade() -> None:
    op.drop_index("ix_timetable_entries_room_id", table_name="timetable_entries")
    op.drop_index("ix_timetable_entries_user_id", table_name="timetable_entries")
    op.drop_table("timetable_entries")

    op.drop_index("ix_path_edges_to_node_id", table_name="path_edges")
    op.drop_index("ix_path_edges_from_node_id", table_name="path_edges")
    op.drop_table("path_edges")

    op.drop_index("ix_path_nodes_campus_id", table_name="path_nodes")
    op.drop_table("path_nodes")
    op.drop_table("pois")
    op.drop_table("entrances")

    op.drop_table("rooms")
    op.drop_table("floors")
    op.drop_index("ix_buildings_code", table_name="buildings")
    op.drop_table("buildings")

    op.drop_index("ix_campuses_slug", table_name="campuses")
    op.drop_table("campuses")

    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
