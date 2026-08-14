"""Tests for the GPS-snapping endpoint (GET /navigation/campuses/{slug}/nearest-node)."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_nearest_node_at_main_gate(client: TestClient, seed_campus) -> None:
    """A fix exactly on the Main Gate resolves to it with ~0 m distance."""
    resp = client.get(
        "/navigation/campuses/srm-institute-of-science-and-technology-kattankulathur/nearest-node",
        params={"lat": 12.8259119, "lng": 80.0422862},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["label"] == "main_gate"
    assert body["distance_m"] < 1.0
    assert body["type"] == "entrance"


def test_nearest_node_snaps_remote_fix(client: TestClient) -> None:
    """A fix inside campus but off-node returns the closest real node
    (never invents a position) and a positive honest distance."""
    resp = client.get(
        "/navigation/campuses/srm-institute-of-science-and-technology-kattankulathur/nearest-node",
        params={"lat": 12.8236, "lng": 80.0440},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["node_id"]
    assert body["label"]
    assert body["distance_m"] > 0
    # nearest to that fix is the MBA block cluster.
    assert body["label"] in {"mba_block", "biotech_block", "boys_hostel"}


def test_nearest_node_far_away_still_snaps(client: TestClient) -> None:
    """Even a far fix snaps to the campus (straight-line, honest distance)."""
    resp = client.get(
        "/navigation/campuses/srm-institute-of-science-and-technology-kattankulathur/nearest-node",
        params={"lat": 13.0, "lng": 80.2},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["distance_m"] > 10_000


def test_nearest_node_unknown_campus(client: TestClient) -> None:
    resp = client.get(
        "/navigation/campuses/nope/nearest-node",
        params={"lat": 12.8, "lng": 80.0},
    )
    assert resp.status_code == 404


def test_nearest_node_rejects_out_of_range(client: TestClient) -> None:
    resp = client.get(
        "/navigation/campuses/srm-institute-of-science-and-technology-kattankulathur/nearest-node",
        params={"lat": 99.0, "lng": 80.0},
    )
    assert resp.status_code == 422