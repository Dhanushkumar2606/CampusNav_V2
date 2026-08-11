"""Timetable entry model — used by Phase 3's intent agent.

No endpoints in Phase 1; the table exists so the Phase 3 agent can join on it.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.campus import Room, _uuid_pk
from app.models.user import GUID, User


class TimetableEntry(Base):
    __tablename__ = "timetable_entries"

    id: Mapped[UUID] = _uuid_pk()
    user_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("users.id"), nullable=False, index=True
    )
    room_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("rooms.id"), nullable=False, index=True
    )
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    course_code: Mapped[str] = mapped_column(String(32), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    user: Mapped[User] = relationship()
    room: Mapped[Room] = relationship(back_populates="timetable_entries")
