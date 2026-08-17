"""Store geo point columns as WKT text on Postgres instead of geography.

Migrations 0001+ created ``geography(Point,4326)`` columns so a future
Phase-2 GIST index could serve spatial queries. The ORM models and every
reader in the app (navigation/search/discovery/assistant) treat these
columns as plain WKT strings (``POINT(lon lat)``), however, and
SQLAlchemy returns a PostGIS geography as hex EWKB -- which breaks every
``parse_point`` consumer. Since the routing engine runs in-memory A* (no
SQL-side spatial functions exist in the codebase), the type adds
complexity without any consumer. Convert the columns to text, carrying
existing rows over with ``ST_AsText`` (deterministic, same coordinates).
SQLite is untouched (already text).
"""

import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"

# (table, (columns, gist_index_on_first_column)) -- every geography(Point,4326)
# column plus the GIST index created alongside it in migration 0001.
GEO_COLUMNS = {
    "buildings": (["centroid"], "idx_buildings_centroid"),
    "entrances": (["location"], "idx_entrances_location"),
    "pois": (["location"], "idx_pois_location"),
    "path_nodes": (["location"], "idx_path_nodes_location"),
}


def _is_postgres() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def upgrade() -> None:
    if not _is_postgres():
        return
    for table, (columns, index) in GEO_COLUMNS.items():
        # GIST only supports geography/geometry -- drop it before the type
        # change; nothing in the app queries spatially, so it is not rebuilt.
        op.execute(sa.text(f'DROP INDEX IF EXISTS "{index}"'))
        for column in columns:
            op.execute(
                sa.text(
                    f'ALTER TABLE "{table}" ALTER COLUMN "{column}" '
                    f'TYPE text USING ST_AsText("{column}")::text'
                )
            )


def downgrade() -> None:
    if not _is_postgres():
        return
    for table, (columns, index) in GEO_COLUMNS.items():
        for column in columns:
            op.execute(
                sa.text(
                    f'ALTER TABLE "{table}" ALTER COLUMN "{column}" '
                    f'TYPE geography(Point,4326) '
                    f'USING ST_GeogFromText("{column}", 4326)'
                )
            )
        op.execute(
            sa.text(f'CREATE INDEX "{index}" ON "{table}" USING gist ("{columns[0]}")')
        )