"""Tests for Phase H: assistant tool registry, dispatcher and real routing."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.services.assistant import assistant_query
from app.services.tools import run_calculate_route, run_get_nearby_places, run_search_campus


def _auth_headers(client: TestClient, email: str = "phaseh@test.com") -> dict[str, str]:
    client.post(
        "/auth/register",
        json={"email": email, "password": "Password!123", "full_name": "Phase H"},
    )  # 409 on repeat runs is fine
    tok = client.post(
        "/auth/login",
        data={"username": email, "password": "Password!123"},
    )
    assert tok.status_code == 200, tok.text
    return {"Authorization": f"Bearer {tok.json()['access_token']}"}


def _query(client: TestClient, q: str, **extra) -> dict:
    r = client.post(
        "/assistant/query",
        json={"query": q, **extra},
        headers=_auth_headers(client),
    )
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------
# Tool registry — direct unit tests against the in-memory DB
# ---------------------------------------------------------------------------


def test_search_campus_tool(db_session) -> None:
    out = run_search_campus(db_session, {"query": "central library", "limit": 3})
    assert out["results"]
    assert any(r["slug"] == "central_library" for r in out["results"])


def test_calculate_route_tool_uses_real_routing(db_session) -> None:
    """Phase H: calculate_route must call the actual A* router."""
    out = run_calculate_route(
        db_session,
        {"source": "main_gate", "destination": "central_library", "campus": ""},
    )
    assert "error" not in out, out
    assert out["total_distance_m"] > 0
    assert out["estimated_walk_time_min"] > 0
    assert out["step_count"] >= 1
    assert out["steps"][0]["instruction"] is not None
    assert out["mode"] == "shortest"


def test_calculate_route_accessible_mode(db_session) -> None:
    out = run_calculate_route(
        db_session,
        {"source": "main_gate", "destination": "central_library", "require_accessible": True},
    )
    assert "error" not in out, out
    assert out["estimated_walk_time_min"] > 0


def test_get_nearby_places_returns_distances(db_session) -> None:
    # Central Library coordinates; the Tech Park entrance node is ~300 m east.
    out = run_get_nearby_places(
        db_session,
        {"lat": 12.8236146, "lng": 80.0424808, "radius_m": 500},
    )
    assert out["places"], out
    assert all("distance_m" in p for p in out["places"])
    assert out["places"] == sorted(out["places"], key=lambda p: p["distance_m"])


def test_get_nearby_places_unknown_category_is_honest(db_session) -> None:
    out = run_get_nearby_places(
        db_session,
        {"lat": 12.8236146, "lng": 80.0424808, "category": "canteen"},
    )
    # No canteen exists in the seeded data — the tool must not invent one.
    assert out["places"] == []


# ---------------------------------------------------------------------------
# Dispatcher — intents map to real tool calls with live-location snapping
# ---------------------------------------------------------------------------


def test_navigate_to_runs_calculate_route(client: TestClient) -> None:
    res = _query(client, "Navigate to the library")
    assert res["kind"] == "route"
    tools = [c["tool"] for c in res["tool_calls"]]
    assert "calculate_route" in tools
    route = next(c["result"] for c in res["tool_calls"] if c["tool"] == "calculate_route")
    assert route["total_distance_m"] > 0
    assert "Main Gate" in res["text"]  # explicit assumed-origin note


def test_navigate_to_uses_live_location(client: TestClient) -> None:
    res = _query(client, "Navigate to the library", user_lat=12.8259, user_lng=80.0422)
    assert res["kind"] == "route"
    route = next(c["result"] for c in res["tool_calls"] if c["tool"] == "calculate_route")
    assert route["source"] is not None
    # Live fix is near the Main Gate; a route from a snapped real node exists.
    assert route["step_count"] >= 1


def test_class_with_time_runs_accessible_fastest(client: TestClient) -> None:
    res = _query(client, "I have a class in the Tech Park in 15 minutes")
    assert res["kind"] == "route"
    route_args = next(c["args"] for c in res["tool_calls"] if c["tool"] == "calculate_route")
    assert route_args["mode"] == "fastest"
    assert route_args["require_accessible"] is True
    route = next(c["result"] for c in res["tool_calls"] if c["tool"] == "calculate_route")
    assert route["estimated_walk_time_min"] > 0


def test_nearest_with_live_location(client: TestClient) -> None:
    res = _query(client, "nearest canteen", user_lat=12.8236146, user_lng=80.0424808)
    # Honest: no canteen exists in the seeded data -> info, never fake results.
    assert res["kind"] == "info", res
    assert "canteen" in res["text"]


def test_nearest_places_from_reference(client: TestClient) -> None:
    res = _query(client, "what's near the auditorium")
    assert res["kind"] in ("info", "search"), res
    tools = [c["tool"] for c in res["tool_calls"]]
    assert "get_nearby_places" in tools


def test_info_about_building_returns_details(client: TestClient) -> None:
    res = _query(client, "Tell me about the Central Library")
    assert res["kind"] == "info", res
    detail = next(c["result"] for c in res["tool_calls"] if c["tool"] == "get_building_details")
    assert "entrances" in detail
    assert detail["name"] == "SRM Central Library"


def test_campus_info_intent(client: TestClient) -> None:
    res = _query(client, "How many buildings are there?")
    assert res["kind"] == "info", res
    info = next(c["result"] for c in res["tool_calls"] if c["tool"] == "get_campus_info")
    assert info["building_count"] >= 1


def test_categories_intent(client: TestClient) -> None:
    res = _query(client, "What's on campus?")
    assert res["kind"] == "info", res
    cats = next(c["result"] for c in res["tool_calls"] if c["tool"] == "list_categories")
    assert any(c["key"] == "building" for c in cats["categories"])


def test_assistant_requires_auth(client: TestClient) -> None:
    r = client.post("/assistant/query", json={"query": "hallo"})
    assert r.status_code == 401