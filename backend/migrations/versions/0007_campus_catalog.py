"""Campus catalog discovery fields.

Revision ID: 0007
Revises: 0006
Create Date: 2026-08-14

Adds catalog metadata so the Explore hub can feature and geo-rank
campuses without loading full graphs:

- featured     BOOLEAN NULL   flagged campus (default false after seed)
- center_lat   FLOAT  NULL    catalog centroid (from seed graph nodes)
- center_lng   FLOAT  NULL

``/navigation/campuses/near`` sorts by distance to these centers; the
Explore home renders featured campuses first.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("campuses") as batch:
        batch.add_column(sa.Column("featured", sa.Boolean, nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("center_lat", sa.Float, nullable=True))
        batch.add_column(sa.Column("center_lng", sa.Float, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("campuses") as batch:
        batch.drop_column("center_lng")
        batch.drop_column("center_lat")
        batch.drop_column("featured")