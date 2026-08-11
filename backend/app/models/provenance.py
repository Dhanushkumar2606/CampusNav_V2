"""Data provenance — records where a campus dataset came from."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.user import GUID


def _uuid_pk() -> Mapped[UUID]:
    return mapped_column(GUID(), primary_key=True, default=uuid4)


class DataProvenance(Base):
    __tablename__ = "data_provenance"

    id: Mapped[UUID] = _uuid_pk()
    dataset_name: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    source: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<DataProvenance {self.dataset_name!r} from {self.source!r}>"
