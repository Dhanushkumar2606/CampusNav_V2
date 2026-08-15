"""Immersive (360°) layer metadata: seed persistence + API exposure.

Scene-linked contract: each node carries immersive metadata only when ITS
OWN scene has a real url — a campus-level tour url must never be attached
to nodes (no whole-site embedding). The immersive config is strictly
optional and additive: a campus without it must load, serialize and route
exactly as before.
"""

from __future__ import annotations

import json

from sqlalchemy import select

from app.models.campus import Campus
from app.schemas.navigation import CampusOut
from app.seed.csv_loader import load_campus, load_buildings_and_nodes

LIBRARY_URL = "https://example.in/360/library"
LIBRARY_MEDIA_ID = "94652D98_145D_D693_419A_9AE6E084796B"
IMMERSIVE = {
    "provider": "srm-cube",
    "url": None,
    "label": "SRM 360° Tour — building scenes",
    "available": True,
    "scenes": {
        "library": {
            "label": "Central Library",
            "available": True,
            "url": LIBRARY_URL,
            "media_id": LIBRARY_MEDIA_ID,
        },
        "tech_park": {"label": "Tech Park Entrance", "available": True, "url": None},
    },
}

PAYLOAD: dict = {
    "campus": "Test Campus",
    "slug": "test-campus",
    "immersive": IMMERSIVE,
    "data_provenance": {"source": "test"},
    "nodes": [
        {"id": "library", "name": "Library", "lat": 12.84, "lng": 80.15, "category": "landmark"},
        {"id": "tech_park", "name": "Tech Park", "lat": 12.84, "lng": 80.16, "category": "landmark"},
        {"id": "main_gate", "name": "Main Gate", "lat": 12.83, "lng": 80.14, "category": "entrance"},
    ],
    "edges": [],
}


def test_immersive_config_persisted_and_serialized(db_session) -> None:
    campus = load_campus(db_session, PAYLOAD)
    load_buildings_and_nodes(db_session, PAYLOAD, campus)
    db_session.flush()

    row = db_session.execute(
        select(Campus).where(Campus.slug == "test-campus")
    ).scalar_one()
    assert row.immersive == IMMERSIVE

    out = CampusOut.model_validate(row)
    assert out.immersive == IMMERSIVE
    assert out.immersive["scenes"]["library"]["label"] == "Central Library"


def test_campus_without_immersive_serializes_none(db_session) -> None:
    payload = {k: v for k, v in PAYLOAD.items() if k != "immersive"}
    campus = load_campus(db_session, payload)
    db_session.flush()

    out = CampusOut.model_validate(campus)
    assert out.immersive is None


def test_graph_endpoint_attaches_node_immersive(db_session, client) -> None:
    campus = load_campus(db_session, PAYLOAD)
    load_buildings_and_nodes(db_session, PAYLOAD, campus)
    db_session.commit()

    res = client.get("/api/navigation/campuses/test-campus/graph")
    assert res.status_code == 200
    body = res.json()
    assert body["campus"]["immersive"]["provider"] == "srm-cube"

    by_label = {n["label"]: n for n in body["nodes"]}
    # Scene with a real url -> that block alone carries immersive metadata,
    # using ITS OWN url (never a campus/whole-site tour), plus its scene id.
    assert by_label["library"]["metadata"]["immersive"]["label"] == "Central Library"
    assert by_label["library"]["metadata"]["immersive"]["url"] == LIBRARY_URL
    assert by_label["library"]["metadata"]["immersive"]["mediaId"] == LIBRARY_MEDIA_ID
    # Scene without a url -> no immersive key at all (scene-linked gating).
    assert "immersive" not in by_label["tech_park"]["metadata"]
    # …unmapped nodes fall back to plain metadata (no immersive key).
    assert "immersive" not in by_label["main_gate"]["metadata"]
    # The whole-site tour url (if any) is never attached to a node.
    assert all(
        "url" not in (n.get("metadata", {}).get("immersive") or {})
        or n["metadata"]["immersive"]["url"] != "https://example.in/tour/index.htm"
        for n in body["nodes"]
    )


def test_routing_ignores_immersive_layer(db_session, client) -> None:
    """The navigation engine must not care about immersive metadata."""
    campus = load_campus(db_session, PAYLOAD)
    db_session.commit()
    res = client.get("/api/navigation/campuses/test-campus/stats")
    assert res.status_code == 200
    # No graph nodes -> stats still answer (proves the config is inert data).
    assert res.json()["nodes"] == 0