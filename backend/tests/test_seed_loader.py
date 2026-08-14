"""Seed loader behaviour: campus identity, rename migration, provenance."""

from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import select

from app.models.campus import Campus
from app.models.graph import PathNode, PathNodeKind, PathEdge
from app.seed.csv_loader import (
    _read_payload,
    load_campus,
    load_provenance,
    load_buildings_and_nodes,
    load_edges,
)


def _mini_payload(name: str, slug: str | None = None, previously: str | None = None) -> dict:
    return {
        "campus": name,
        "slug": slug,
        "previously": previously,
        "data_provenance": {"dataset_name": name, "source": "test", "notes": "rename check"},
        "nodes": [
            {"id": "a", "name": "Place A", "lat": 12.84, "lng": 80.15, "category": "poi"},
        ],
        "edges": [],
    }


def test_load_campus_creates_with_derived_slug(db_session) -> None:
    payload = _mini_payload("My Campus Two")
    campus = load_campus(db_session, payload)
    assert campus.slug == "my-campus-two"
    matches = db_session.execute(
        select(Campus).where(Campus.slug == "my-campus-two")
    ).scalars().all()
    assert len(matches) == 1


def test_load_campus_renames_by_previously_hint(db_session) -> None:
    # Seed under the old name, then re-seed with the new display name: the
    # loader must migrate the existing row (name + slug), not duplicate it.
    old = _mini_payload("Old Campus Name")
    first = load_campus(db_session, old)
    db_session.flush()
    first_id = first.id

    renamed = _mini_payload("New Campus Name", previously="Old Campus Name")
    second = load_campus(db_session, renamed)
    db_session.flush()
    assert second.id == first_id
    assert second.name == "New Campus Name"
    assert second.slug == "new-campus-name"
    rows = db_session.execute(
        select(Campus).where(Campus.name == "New Campus Name")
    ).scalars().all()
    assert len(rows) == 1
    # The old identity must be gone, not duplicated.
    old_rows = db_session.execute(
        select(Campus).where(Campus.name == "Old Campus Name")
    ).scalars().all()
    assert len(old_rows) == 0


def test_load_provenance_follows_rename(db_session) -> None:
    # Provenance must be matched via the campus row after a rename, keeping
    # one row for the campus instead of orphaning the old dataset name.
    old = _mini_payload("Old Campus Name")
    campus = load_campus(db_session, old)
    prov1 = load_provenance(db_session, old, campus)
    db_session.flush()

    renamed = _mini_payload("New Campus Name", previously="Old Campus Name")
    campus2 = load_campus(db_session, renamed)
    prov2 = load_provenance(db_session, renamed, campus2)
    db_session.flush()
    assert prov2.id == prov1.id
    assert prov2.dataset_name == "New Campus Name"
    from app.models.provenance import DataProvenance

    rows = db_session.execute(
        select(DataProvenance).where(DataProvenance.dataset_name == "New Campus Name")
    ).scalars().all()
    assert len(rows) == 1


def test_load_one_preserves_nodes_across_rename(db_session, tmp_path) -> None:
    """End-to-end: re-seeding a renamed file keeps node ids/edges stable."""
    from sqlalchemy import func

    from app.seed.csv_loader import load_one

    def write_and_load(name: str, previously: str | None = None) -> None:
        p = _mini_payload(name, previously=previously)
        p["nodes"] = [
            {"id": "a", "name": "Place A", "lat": 12.84, "lng": 80.15, "category": "poi"},
            {"id": "b", "name": "Place B", "lat": 12.85, "lng": 80.16, "category": "poi"},
        ]
        p["edges"] = [
            {
                "from": "a",
                "to": "b",
                "distance_m": 100.0,
                "estimated": True,
                "geometry": [[80.15, 12.84], [80.16, 12.85]],
            }
        ]
        f = tmp_path / "campus.json"
        f.write_text(json.dumps(p), encoding="utf-8")
        assert load_one(db_session, f) == 0
        db_session.commit()

    write_and_load("Old Campus Name")
    campus = db_session.execute(
        select(Campus).where(Campus.slug == "old-campus-name")
    ).scalars().one()
    assert campus.slug == "old-campus-name"
    nodes = db_session.execute(
        select(PathNode).where(PathNode.campus_id == campus.id)
    ).scalars().all()
    assert len(nodes) == 2
    first_ids = {n.label: n.id for n in nodes}
    edge_count = len(
        db_session.execute(
            select(PathEdge)
            .join(PathNode, PathEdge.from_node_id == PathNode.id)
            .where(PathNode.campus_id == campus.id)
        ).scalars().all()
    )
    assert edge_count == 1

    write_and_load("New Campus Name", previously="Old Campus Name")
    campus2 = db_session.execute(
        select(Campus).where(Campus.slug == "new-campus-name")
    ).scalars().one()
    assert campus2.name == "New Campus Name"
    assert campus2.slug == "new-campus-name"
    nodes2 = db_session.execute(
        select(PathNode).where(PathNode.campus_id == campus2.id)
    ).scalars().all()
    assert len(nodes2) == 2
    second_ids = {n.label: n.id for n in nodes2}
    assert second_ids == first_ids  # same node rows survived the rename


def test_junction_nodes_load_as_junction_kind(db_session) -> None:
    payload = _mini_payload("Junction Town")
    payload["nodes"] = [
        {"id": "jn_a", "name": "Junction A", "lat": 12.84, "lng": 80.15, "category": "junction"},
        {"id": "poi_b", "name": "Place B", "lat": 12.85, "lng": 80.16, "category": "poi"},
    ]
    payload["edges"] = [
        {"from": "jn_a", "to": "poi_b", "distance_m": 50.0, "estimated": True},
    ]
    campus = load_campus(db_session, payload)
    node_ids = load_buildings_and_nodes(db_session, payload, campus)
    load_edges(db_session, payload, campus, node_ids)
    kinds = {
        n.label: n.kind
        for n in db_session.execute(
            select(PathNode).where(PathNode.campus_id == campus.id)
        ).scalars().all()
    }
    assert kinds["jn_a"][:3] == PathNodeKind.JUNCTION[:3]


def test_full_vit_seed_loads(db_session) -> None:
    """The corridor-network VIT payload loads end to end with junctions."""
    seed_path = Path(__file__).parent.parent / "seed_data" / "vit_chennai.json"
    payload = _read_payload(seed_path)
    campus = load_campus(db_session, payload)
    node_ids = load_buildings_and_nodes(db_session, payload, campus)
    load_edges(db_session, payload, campus, node_ids)
    db_session.commit()

    campus = db_session.execute(
        select(Campus).where(Campus.slug == "vit-chennai")
    ).scalars().one()
    assert campus.name == "VIT Chennai"
    nodes = db_session.execute(
        select(PathNode).where(PathNode.campus_id == campus.id)
    ).scalars().all()
    junctions = [n for n in nodes if n.kind == PathNodeKind.JUNCTION]
    assert len(junctions) >= 8
    edges = db_session.execute(
        select(PathEdge).join(PathNode, PathEdge.from_node_id == PathNode.id)
    ).scalars().all()
    assert len(edges) >= 25