"""Edge accessibility, edge type, walk_time.

Revision ID: 0003
Revises: 0002
Create Date: 2026-08-10

Adds three columns to path_edges so Phase 2's A* + UI can:

- `is_accessible` — default true so existing estimated edges are usable until
  real surveyed data is supplied.
- `edge_type` — 'walk' / 'stairs' / 'ramp' / 'transit' etc. Defaults to 'walk'
  to match the current dataset.
- `walk_time_min` — nullable float; populated by re-seeding from the JSON.

The migration is dialect-safe (no PostGIS-only types introduced).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("path_edges") as batch:
        batch.add_column(
            sa.Column(
                "is_accessible",
                sa.Boolean,
                nullable=False,
                server_default=sa.true(),
            )
        )
        batch.add_column(
            sa.Column(
                "edge_type",
                sa.String(16),
                nullable=False,
                server_default="walk",
            )
        )
        batch.add_column(
            sa.Column("walk_time_min", sa.Float, nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("path_edges") as batch:
        batch.drop_column("walk_time_min")
        batch.drop_column("edge_type")
        batch.drop_column("is_accessible")