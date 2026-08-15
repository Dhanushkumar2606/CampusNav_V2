"""Campus immersive/360° provider metadata.

Revision ID: 0008
Revises: 0007
Create Date: 2026-08-14

Adds an optional per-campus immersive layer configuration (JSON text) so
the Explore/360° experience can be configured without touching the
navigation graph:

- immersive_json  TEXT NULL   {"provider", "url", "available", "label", "scenes": {...}}

The column is opaque to the navigation engine: routing, accessibility and
the AI assistant never read it. A campus without the column still
navigates perfectly; the frontend simply hides the 360° action.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("campuses") as batch:
        batch.add_column(sa.Column("immersive_json", sa.Text, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("campuses") as batch:
        batch.drop_column("immersive_json")
