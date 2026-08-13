"""Favorites + user preferences.

Revision ID: 0005
Revises: 0004
Create Date: 2026-08-11

- `favorites`: per-user saved places. Polymorphic target (building or
  graph node) so POIs/floors can be saved later without a migration.
- `user_preferences`: per-user JSON preferences (units, route defaults).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "favorites",
        sa.Column("id", sa.CHAR(36), primary_key=True),
        sa.Column(
            "user_id",
            sa.CHAR(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("target_type", sa.String(16), nullable=False),  # 'building' | 'node'
        sa.Column("target_id", sa.CHAR(36), nullable=False),
        sa.Column("note", sa.String(255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "user_id", "target_type", "target_id", name="uq_favorites_user_target"
        ),
    )
    op.create_table(
        "user_preferences",
        sa.Column(
            "user_id",
            sa.CHAR(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("prefs", sa.JSON, nullable=False, server_default="{}"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("user_preferences")
    op.drop_table("favorites")
