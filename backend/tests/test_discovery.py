"""Tests for Phase 4: search, building detail, categories, favorites,
preferences."""

from __future__ import annotations

from fastapi.testclient import TestClient


def _register_and_login(client: TestClient, email: str = "phase4@test.com") -> str:
    r = client.post(
        "/auth/register",
        json={"email": email, "password": "Password!123", "full_name": "Phase Four"},
    )
    if r.status_code == 409:
        # already exists from a previous run — fine
        pass
    tok = client.post(
        "/auth/login",
        data={"username": email, "password": "Password!123"},
    )
    assert tok.status_code == 200, tok.text
    return tok.json()["access_token"]


def test_search_finds_building_by_name(client: TestClient) -> None:
    r = client.get("/search", params={"q": "library"})
    assert r.status_code == 200
    results = r.json()
    assert any(x["label"] == "SRM Central Library" for x in results)


def test_search_finds_node_by_label(client: TestClient) -> None:
    r = client.get("/search", params={"q": "auditorium"})
    assert r.status_code == 200
    results = r.json()
    assert any("auditorium" in x["label"] for x in results)


def test_search_scoring_puts_exact_match_first(client: TestClient) -> None:
    r = client.get("/search", params={"q": "Main Gate"})
    assert r.status_code == 200
    results = r.json()
    assert results and results[0]["score"] == 100
    assert "gate" in results[0]["label"].lower()


def test_search_blank_query_returns_empty(client: TestClient) -> None:
    r = client.get("/search", params={"q": "   "})
    assert r.status_code == 200  # passes validation, service returns []
    assert r.json() == []


def test_search_filters_by_campus(client: TestClient) -> None:
    r = client.get(
        "/search",
        params={"q": "library", "campus": "srm-institute-of-science-and-technology-kattankulathur"},
    )
    assert r.status_code == 200
    assert r.json(), "campus-scoped search must return results"


def test_search_unknown_campus_falls_back_to_all(client: TestClient) -> None:
    r = client.get("/search", params={"q": "library", "campus": "no-such-campus"})
    assert r.status_code == 200  # graceful: unknown campus ignored


def test_building_detail_returns_real_fields(client: TestClient) -> None:
    r = client.get("/search", params={"q": "Central Library"})
    building = next(x for x in r.json() if x["type"] == "building")
    d = client.get(f"/buildings/{building['id']}")
    assert d.status_code == 200
    body = d.json()
    assert body["name"] == "SRM Central Library"
    assert body["num_floors"] >= 1
    assert body["lat"] is not None and body["lng"] is not None
    # Entrances/floors may be empty (honest) but must be lists.
    assert isinstance(body["entrances"], list)
    assert isinstance(body["floors"], list)


def test_building_detail_404_for_unknown(client: TestClient) -> None:
    r = client.get("/buildings/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404


def test_campus_categories_reflect_real_data(client: TestClient) -> None:
    r = client.get(
        "/navigation/campuses", params={}
    )
    slug = r.json()[0]["slug"]
    c = client.get(f"/campuses/{slug}/categories")
    assert c.status_code == 200
    cats = {x["key"]: x["count"] for x in c.json()}
    assert cats.get("building", 0) >= 1
    assert cats.get("landmarks", 0) >= 1  # auditorium + medical auditorium


def test_favorites_requires_auth(client: TestClient) -> None:
    r = client.get("/favorites")
    assert r.status_code in (401, 403)


def test_favorites_add_list_remove(client: TestClient) -> None:
    token = _register_and_login(client)
    headers = {"Authorization": f"Bearer {token}"}

    r = client.get("/search", params={"q": "Central Library"})
    building = next(x for x in r.json() if x["type"] == "building")

    add = client.post(
        "/favorites",
        json={"target_type": "building", "target_id": building["id"], "note": "research home"},
        headers=headers,
    )
    assert add.status_code == 201, add.text
    fav_id = add.json()["id"]
    assert add.json()["label"] == "SRM Central Library"

    lst = client.get("/favorites", headers=headers)
    assert any(x["id"] == fav_id for x in lst.json())

    # Idempotent re-add returns the same favorite.
    again = client.post(
        "/favorites",
        json={"target_type": "building", "target_id": building["id"]},
        headers=headers,
    )
    assert again.json()["id"] == fav_id

    rm = client.delete(f"/favorites/{fav_id}", headers=headers)
    assert rm.status_code == 204
    lst2 = client.get("/favorites", headers=headers)
    assert not any(x["id"] == fav_id for x in lst2.json())


def test_favorites_reject_unknown_target(client: TestClient) -> None:
    token = _register_and_login(client)
    r = client.post(
        "/favorites",
        json={"target_type": "building", "target_id": "00000000-0000-0000-0000-000000000000"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 404


def test_favorites_are_user_scoped(client: TestClient) -> None:
    t1 = _register_and_login(client, "scope-a@test.com")
    t2 = _register_and_login(client, "scope-b@test.com")
    r = client.get("/search", params={"q": "Tech Park"})
    building = next(x for x in r.json() if x["type"] == "building")

    client.post(
        "/favorites",
        json={"target_type": "building", "target_id": building["id"]},
        headers={"Authorization": f"Bearer {t1}"},
    )
    lst2 = client.get("/favorites", headers={"Authorization": f"Bearer {t2}"})
    assert lst2.json() == [], "user B must not see user A's favorites"


def test_preferences_roundtrip(client: TestClient) -> None:
    token = _register_and_login(client, "prefs@test.com")
    headers = {"Authorization": f"Bearer {token}"}

    r = client.get("/preferences", headers=headers)
    assert r.json()["units"] == "metric"

    put = client.put(
        "/preferences",
        json={"units": "imperial", "default_mode": "fastest", "default_avoid_stairs": True},
        headers=headers,
    )
    assert put.status_code == 200
    assert put.json()["units"] == "imperial"
    assert put.json()["default_mode"] == "fastest"
    assert put.json()["default_avoid_stairs"] is True
    # Unset keys keep defaults.
    assert put.json()["default_require_accessible"] is False


def test_preferences_validate_values(client: TestClient) -> None:
    token = _register_and_login(client, "prefs2@test.com")
    r = client.put(
        "/preferences",
        json={"units": "furlongs"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422
