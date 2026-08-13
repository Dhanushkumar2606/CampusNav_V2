"""Tests for Phase 5: rule-based assistant intent engine (POST /assistant/query)."""

from __future__ import annotations

from fastapi.testclient import TestClient


def _auth_headers(client: TestClient, email: str = "phase5@test.com") -> dict[str, str]:
    client.post(
        "/auth/register",
        json={"email": email, "password": "Password!123", "full_name": "Phase Five"},
    )  # 409 on repeat runs is fine
    tok = client.post(
        "/auth/login",
        data={"username": email, "password": "Password!123"},
    )
    assert tok.status_code == 200, tok.text
    return {"Authorization": f"Bearer {tok.json()['access_token']}"}


def _query(client: TestClient, q: str) -> dict:
    r = client.post("/assistant/query", json={"query": q}, headers=_auth_headers(client))
    assert r.status_code == 200, r.text
    return r.json()


def test_navigate_to_resolves_building(client: TestClient) -> None:
    res = _query(client, "Navigate to the library")
    assert res["kind"] == "route", res
    assert res["data"]["destination"]["label"] == "SRM Central Library"


def test_take_me_to_resolves_building(client: TestClient) -> None:
    res = _query(client, "take me to the CSE Block")
    assert res["kind"] == "route", res
    assert res["data"]["destination"] is not None


def test_how_do_i_get_to_resolves(client: TestClient) -> None:
    res = _query(client, "How do I get to main gate")
    assert res["kind"] == "route", res


def test_where_is_returns_search(client: TestClient) -> None:
    res = _query(client, "Where is the library?")
    assert res["kind"] == "search", res
    hits = [r["label"] for r in res["data"]["results"]]
    assert "SRM Central Library" in hits


def test_find_returns_search(client: TestClient) -> None:
    res = _query(client, "Find the auditorium")
    assert res["kind"] == "search", res
    assert any("auditorium" in r["label"] for r in res["data"]["results"])


def test_class_with_time_intent(client: TestClient) -> None:
    res = _query(client, "I have a class in the Tech Park in 15 minutes")
    assert res["kind"] == "route", res
    data = res["data"]
    assert data["time_constraint_min"] == 15
    assert data["require_accessible"] is True
    assert data["mode"] == "fastest"


def test_unknown_intent_falls_back_to_search(client: TestClient) -> None:
    res = _query(client, "what time does the cafeteria close")
    assert res["kind"] in ("search", "info"), res


def test_assistant_requires_auth(client: TestClient) -> None:
    r = client.post("/assistant/query", json={"query": "hallo"})
    assert r.status_code == 401