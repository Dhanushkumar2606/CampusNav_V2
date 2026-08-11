"""is_estimated on path_edges; data_provenance table.

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-10

Notes
-----
- `path_edges.is_estimated` defaults to true. The seed loader sets it from the
  source dataset; future surveyed paths can be added with is_estimated=false.
- `data_provenance` records where a campus dataset came from. Single-row for
  now (one campus = one source), but the table is generic so multi-source
  merges can be tracked later.
- `path_nodes.kind` enum is widened conceptually (landmark, transit) but the
  column type is `VARCHAR(24)` on SQLite, so no DDL change is required there.
  On Postgres, when a real native enum is used, we'd ALTER TYPE — currently
  we use `native_enum=False` so the column is text and accepts any value the
  application validates.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _is_postgres() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def _uuid_type():
    return sa.String(length=36)


def upgrade() -> None:
    # path_edges.is_estimated
    with op.batch_alter_table("path_edges") as batch:
        batch.add_column(
            sa.Column(
                "is_estimated",
                sa.Boolean,
                nullable=False,
                server_default=sa.true(),
            )
        )

    # data_provenance
    op.create_table(
        "data_provenance",
        sa.Column("id", _uuid_type(), primary_key=True),
        sa.Column("dataset_name", sa.String(64), nullable=False),
        sa.Column("source", sa.String(255), nullable=False),
        sa.Column("url", sa.String(512), nullable=True),
        sa.Column("fetched_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("notes", sa.Text, nullable=True),
        sa.UniqueConstraint("dataset_name", name="uq_data_provenance_dataset_name"),
    )


def downgrade() -> None:
    op.drop_table("data_provenance")
    with op.batch_alter_table("path_edges") as batch:
        batch.drop_column("is_estimated")
