"""Per-edge path geometry (Google-Maps-style walkway shapes).

Revision ID: 0006
Revises: 0005
Create Date: 2026-08-14

Adds `geometry` (WKT LINESTRING, NULL = unknown/straight-line) to
`path_edges`. When present, the client renders the route along the real
walkway shape (curves and bends from OpenStreetMap) instead of a straight
line between nodes, and distance is measured along the geometry.

- geometry        TEXT NULL   WKT ``LINESTRING(lng lat, lng lat, ...)``
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("path_edges") as batch:
        batch.add_column(sa.Column("geometry", sa.Text, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("path_edges") as batch:
        batch.drop_column("geometry")
