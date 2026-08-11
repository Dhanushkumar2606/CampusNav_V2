"""Per-edge accessibility + surface model.

Revision ID: 0004
Revises: 0003
Create Date: 2026-08-11

Extends `path_edges` with the accessibility/surface fields the spec asks
for, plus an honesty flag: `accessibility_verified` defaults to FALSE so
existing (un-surveyed) data is never presented as verified accessible.
Routing can consume these; the UI must show the unverified state.

New columns:
- surface_type      VARCHAR(32) NULL     ('paved', 'gravel', 'grass', ...)
- slope             FLOAT NULL           (percent rise, NULL = unknown)
- path_type         VARCHAR(16) NULL     ('footpath', 'road', 'ramp', 'stairs', ...)
- is_indoor         BOOLEAN NOT NULL DEFAULT FALSE
- is_outdoor        BOOLEAN NOT NULL DEFAULT TRUE
- is_restricted     BOOLEAN NOT NULL DEFAULT FALSE
- accessibility_verified BOOLEAN NOT NULL DEFAULT FALSE
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("path_edges") as batch:
        batch.add_column(sa.Column("surface_type", sa.String(32), nullable=True))
        batch.add_column(sa.Column("slope", sa.Float, nullable=True))
        batch.add_column(sa.Column("path_type", sa.String(16), nullable=True))
        batch.add_column(
            sa.Column("is_indoor", sa.Boolean, nullable=False, server_default=sa.false())
        )
        batch.add_column(
            sa.Column("is_outdoor", sa.Boolean, nullable=False, server_default=sa.true())
        )
        batch.add_column(
            sa.Column("is_restricted", sa.Boolean, nullable=False, server_default=sa.false())
        )
        batch.add_column(
            sa.Column(
                "accessibility_verified",
                sa.Boolean,
                nullable=False,
                server_default=sa.false(),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("path_edges") as batch:
        batch.drop_column("accessibility_verified")
        batch.drop_column("is_restricted")
        batch.drop_column("is_outdoor")
        batch.drop_column("is_indoor")
        batch.drop_column("path_type")
        batch.drop_column("slope")
        batch.drop_column("surface_type")
