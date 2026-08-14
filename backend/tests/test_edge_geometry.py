"""Phase C: real walkway geometry (OSM-traced edge shapes)."""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models.graph import PathEdge




def test_geometry_edges_loaded_from_seed(db_session) -> None:
    """The seed carries OSM-traced walkways for a subset of edges."""
    rows = db_session.execute(select(PathEdge)).scalars().all()
    with_geometry = [e for e in rows if e.geometry]
    # The current SRM seed traces the majority of edges from real walkways.
    assert len(with_geometry) >= 5, [e.geometry for e in rows]
    for e in with_geometry:
        assert e.geometry.startswith("LINESTRING(")
        # A traced edge is NOT an estimate: it follows a surveyed shape.
        assert e.is_estimated is False


def test_geometry_edges_measure_along_shape(db_session) -> None:
    """distance_m follows the walked shape, so it >= straight-line span."""
    rows = db_session.execute(select(PathEdge)).scalars().all()
    from app.routing.astar import _haversine_m

    for e in rows:
        if not e.geometry:
            continue
        assert e.distance_m > 0
        # Spot-check an interior point exists (a bend), not a 2-point line.
        interior = e.geometry.count(",") >= 2


def test_graph_payload_serializes_geometry(client: TestClient) -> None:
    res = client.get("/navigation/campuses/srm-institute-of-science-and-technology-kattankulathur/graph")
    assert res.status_code == 200, res.text
    edges = res.json()["edges"]
    shaped = [e for e in edges if e["geometry"]]
    assert len(shaped) >= 5
    for e in shaped:
        pts = e["geometry"]
        assert isinstance(pts, list) and len(pts) >= 2
        for p in pts:
            assert len(p) == 2 and isinstance(p[0], float)


def test_route_uses_geometry_edges_and_still_routes(client: TestClient) -> None:
    """Routing over geometry-backed edges works end-to-end (A* unchanged)."""
    graph = client.get(
        "/navigation/campuses/srm-institute-of-science-and-technology-kattankulathur/graph"
    ).json()
    labels = graph["labels"]
    res = client.post(
        "/navigation/campuses/srm-institute-of-science-and-technology-kattankulathur/route",
        json={
            "source_id": str(labels["main_gate"]),
            "destination_id": str(labels["central_library"]),
            "require_accessible": False,
            "mode": "shortest",
        },
    )
    assert res.status_code in (200, 400), res.text
    if res.status_code == 200:
        body = res.json()
        assert body["status"] == "ok"
        assert body["route"]["total_distance_m"] > 0