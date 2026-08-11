"""User model."""

from __future__ import annotations

import enum
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CHAR, DateTime, Enum, String, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import TypeDecorator

from app.db import Base


class Role(str, enum.Enum):
    STUDENT = "student"
    STAFF = "staff"
    ADMIN = "admin"


class GUID(TypeDecorator):
    """Platform-independent UUID type.

    Uses Postgres' native UUID when available, otherwise CHAR(36) so SQLite
    can store the canonical string form. `process_bind_param` always returns
    a string for SQLite (so SQLAlchemy never tries to bind a `UUID` to a
    SQLite parameter).
    """

    impl = CHAR
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(PG_UUID(as_uuid=True))
        return dialect.type_descriptor(CHAR(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if dialect.name == "postgresql":
            return value if isinstance(value, UUID) else UUID(str(value))
        return str(value if isinstance(value, UUID) else value)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return value if isinstance(value, UUID) else UUID(str(value))


def _uuid_pk() -> Mapped[UUID]:
    return mapped_column(GUID(), primary_key=True, default=uuid4)


class User(Base):
    __tablename__ = "users"

    id: Mapped[UUID] = _uuid_pk()
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[Role] = mapped_column(
        Enum(Role, name="user_role", native_enum=False, length=16),
        default=Role.STUDENT,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    disabled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<User id={self.id} email={self.email!r}>"
