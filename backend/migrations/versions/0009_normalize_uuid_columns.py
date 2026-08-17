"""Normalize UUID columns from CHAR/VARCHAR(36) to native uuid on Postgres.

Migrations 0001-0008 declared every UUID-shaped primary/foreign key as
sa.String(36) / sa.CHAR(36) via their shared ``_uuid_type()`` helper. SQLite
tolerated that (dynamic typing), but PostgreSQL enforces column types, so
ORM equality comparisons such as ``PathNode.campus_id == <uuid>`` failed
with "operator does not exist: character varying = uuid" and the production
seed loader crashed on boot.

This migration converts the affected columns to native ``uuid`` on
PostgreSQL (casting existing string values, which are canonical UUID
strings). Foreign keys are dropped first, recreated afterwards with their
original ON UPDATE/DELETE semantics. SQLite is intentionally left unchanged
-- the app's GUID type renders CHAR(36) there, so the storage matches the
ORM exactly.
"""

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"

# (table, columns) -- the id column plus every FK referencing a UUID column.
UUID_COLUMNS = {
    "users": ["id"],
    "campuses": ["id"],
    "buildings": ["id", "campus_id"],
    "floors": ["id", "building_id"],
    "rooms": ["id", "floor_id"],
    "entrances": ["id", "building_id"],
    "pois": ["id", "campus_id"],
    "path_nodes": ["id", "campus_id"],
    "path_edges": ["id", "from_node_id", "to_node_id"],
    "favorites": ["id", "user_id", "target_id"],
    "user_preferences": ["user_id"],
    "timetable_entries": ["id", "room_id", "user_id"],
    "data_provenance": ["id"],
}

_FK_SQL = sa.text(
    """
    SELECT c.conname AS name,
           c.conrelid::regclass::text AS rel,
           pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE c.contype = 'f' AND n.nspname = 'public'
    ORDER BY c.conrelid::regclass::text, c.conname
    """
)


def _is_postgres() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def _fks() -> list[tuple[str, str, str]]:
    conn = op.get_bind()
    return [(name, rel, d) for name, rel, d in conn.execute(_FK_SQL)]


def upgrade() -> None:
    if not _is_postgres():
        return
    bind = op.get_bind()
    fks = _fks()
    for name, rel, _ in fks:
        op.execute(sa.text(f'ALTER TABLE "{rel}" DROP CONSTRAINT "{name}"'))
    try:
        for table, columns in UUID_COLUMNS.items():
            for column in columns:
                op.alter_column(
                    table,
                    column,
                    type_=sa.Uuid(),
                    postgresql_using=f'"{column}"::uuid',
                )
    finally:
        # Restore FKs even if a later ALTER fails, so the schema stays usable.
        for name, rel, def_ in fks:
            op.execute(sa.text(f'ALTER TABLE "{rel}" ADD CONSTRAINT "{name}" {def_}'))


def downgrade() -> None:
    if not _is_postgres():
        return
    bind = op.get_bind()
    fks = _fks()
    for name, rel, _ in fks:
        op.execute(sa.text(f'ALTER TABLE "{rel}" DROP CONSTRAINT "{name}"'))
    for table, columns in UUID_COLUMNS.items():
        for column in columns:
            op.alter_column(table, column, type_=sa.String(36))
    for name, rel, def_ in fks:
        op.execute(sa.text(f'ALTER TABLE "{rel}" ADD CONSTRAINT "{name}" {def_}'))