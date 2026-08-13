"""Pytest fixtures."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app
from app.security import hash_password
from app.models.user import Role, User
from app.models.campus import Campus, Building, Floor, Room
from app.models.graph import PathNode, PathEdge, PathNodeKind
import uuid
from pathlib import Path


@pytest.fixture()
def db_session() -> Iterator[Session]:
    """In-memory SQLite session, isolated per test."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(
        bind=engine, autoflush=False, autocommit=False, future=True
    )
    Base.metadata.create_all(engine)
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


@pytest.fixture(autouse=True)
def seed_discovery_data(db_session):
    """Load the SRM Kattankulathur seed data into the in-memory DB."""
    from app.seed.csv_loader import (
        load_provenance,
        load_campus,
        load_buildings_and_nodes,
        load_edges,
        _read_payload,
    )

    seed_path = Path(__file__).parent.parent / "seed_data" / "srm_ktr.json"
    payload = _read_payload(seed_path)
    prov = load_provenance(db_session, payload)
    campus = load_campus(db_session, payload)
    node_ids = load_buildings_and_nodes(db_session, payload, campus)
    load_edges(db_session, payload, campus, node_ids)
    db_session.commit()