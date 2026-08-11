"""Pytest fixtures."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app
from app.security import hash_password
from app.models.user import Role, User
from app.models.campus import Campus, Building, Floor, Room
from app.models.graph import PathNode, PathEdge, PathNodeKind
import uuid


@pytest.fixture()
def db_session() -> Iterator:
    """In-memory SQLite session, isolated per test."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(engine)
    TestingSessionLocal = sessionmaker(
        bind=engine, autoflush=False, autocommit=False, future=True
    )
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


@pytest.fixture()
def client(db_session) -> Iterator[TestClient]:
    """FastAPI TestClient wired to the in-memory DB."""

    def _get_db_override():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = _get_db_override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def seed_user(db_session) -> User:
    user = User(
        id=uuid.uuid4(),
        email="seed@example.com",
        password_hash=hash_password("correct-horse-battery-staple"),
        full_name="Seed User",
        role=Role.STUDENT,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture()
def seed_campus(db_session) -> Campus:
    campus = Campus(
        id=uuid.uuid4(),
        name="Pilot Campus (PLACEHOLDER)",
        slug="pilot-placeholder",
        description="Fictional campus for Phase 1 verification.",
    )
    db_session.add(campus)
    db_session.commit()
    db_session.refresh(campus)
    return campus