"""SQLAlchemy engine, session factory, and FastAPI dependency."""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    """Base class for all ORM models."""


_settings = get_settings()

# SQLite needs a special connect_args; Postgres uses defaults.
_connect_args: dict = {"check_same_thread": False} if _settings.is_sqlite else {}


engine = create_engine(
    _settings.database_url,
    connect_args=_connect_args,
    pool_pre_ping=True,
    future=True,
)

SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
    future=True,
)


def get_db() -> Iterator[Session]:
    """FastAPI dependency that yields a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# IMPORTANT: import models so that Alembic autogenerate and Base.metadata
# see every table. Imported at module bottom to avoid circular imports.
from app.models import (  # noqa: E402, F401
    user as _user,
    campus as _campus,
    graph as _graph,
    timetable as _timetable,
    provenance as _provenance,
)
