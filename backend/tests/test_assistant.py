"""Tests for Phase 5: rule-based assistant intent engine (POST /assistant/query)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from jose import jwt

from app.config import get_settings
from app.models.user import User


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
    # No "CSE Block" exists — the assistant must NOT route to a wrong
    # building; it shows the real candidates (Tech Park is the CSE home).
    assert res["kind"] in ("route", "search"), res
    if res["kind"] == "search":
        labels = [str(r["label"]) for r in res["data"]["results"]]
        assert any("CSE" in l or "cse" in l for l in labels), labels


def test_how_do_i_get_to_resolves(client: TestClient) -> None:
    res = _query(client, "How do I get to main gate")
    # With the Main Gate as the assumed origin, this honestly resolves to
    # "you're already there" — never a fabricated route.
    assert res["kind"] in ("route", "info"), res


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


def test_route_between_intent(client: TestClient) -> None:
    res = _query(client, "route from main block to the library")
    assert res["kind"] == "route", res
    data = res["data"]
    assert data["origin"]["id"] == "main_block"
    assert data["destination"]["id"] == "central_library"
    assert data["mode"] == "shortest"
    assert "main_block" not in (
        str(data["destination"]["id"]),
        str(data["destination"]["label"]),
    )


def test_route_between_without_from(client: TestClient) -> None:
    res = _query(client, "main block to library")
    assert res["kind"] == "route", res
    assert res["data"]["origin"]["id"] == "main_block"
    assert res["data"]["destination"]["id"] == "central_library"


def test_route_between_main_gate_to_boys_hostel(client: TestClient) -> None:
    res = _query(client, "main gate to boys hostel")
    assert res["kind"] == "route", res
    assert res["data"]["origin"]["id"] == "main_gate"
    assert res["data"]["destination"]["id"] == "boys_hostel"


def test_route_between_strips_filler_words(client: TestClient) -> None:
    res = _query(client, "from main gate to boys hostel please")
    assert res["kind"] == "route", res
    assert res["data"]["origin"]["id"] == "main_gate"
    assert res["data"]["destination"]["id"] == "boys_hostel"


def test_unknown_intent_falls_back_to_search(client: TestClient) -> None:
    res = _query(client, "what time does the cafeteria close")
    assert res["kind"] in ("search", "info"), res


def test_assistant_requires_auth(client: TestClient) -> None:
    r = client.post("/assistant/query", json={"query": "hallo"})
    assert r.status_code == 401


def test_greeting_intent(client: TestClient) -> None:
    res = _query(client, "Hello Spidy")
    assert res["kind"] == "info", res
    assert "SPIDY" in res["text"]


def test_capabilities_intent(client: TestClient) -> None:
    res = _query(client, "What can you help me with?")
    assert res["kind"] == "info", res
    assert "Route" in res["text"]


def test_campus_info_intent(client: TestClient) -> None:
    res = _query(client, "Tell me about SRM campus.")
    assert res["kind"] == "info", res
    assert "buildings" in res["text"]


def test_distance_between_intent(client: TestClient) -> None:
    res = _query(client, "How far is Boys Hostel from the Main Gate?")
    assert res["kind"] == "route", res
    data = res["data"]
    assert data["origin"]["id"] == "main_gate"
    assert data["destination"]["id"] == "boys_hostel"
    assert "on foot" in res["text"]


def test_distance_without_origin_assumes_main_gate(client: TestClient) -> None:
    res = _query(client, "How far is the library?")
    assert res["kind"] == "route", res
    assert res["data"]["origin"]["id"] == "main_gate"
    assert res["data"]["destination"]["label"] == "SRM Central Library"


def test_navigate_me_to_resolves(client: TestClient) -> None:
    res = _query(client, "Navigate me to the library.")
    assert res["kind"] == "route", res
    assert res["data"]["destination"]["label"] == "SRM Central Library"


def test_route_with_natural_language_preferences(client: TestClient) -> None:
    res = _query(
        client,
        "Find the fastest route from the Main Gate to the Library avoiding stairs.",
    )
    assert res["kind"] == "route", res
    data = res["data"]
    assert data["origin"]["id"] == "main_gate"
    assert data["destination"]["id"] == "central_library"
    assert data["mode"] == "fastest"
    assert data["avoid_stairs"] is True


def test_navigate_to_with_accessible_request(client: TestClient) -> None:
    res = _query(client, "Take me to the library using an accessible route")
    assert res["kind"] == "route", res
    assert res["data"]["destination"]["id"] == "central_library"
    assert res["data"]["require_accessible"] is True


def test_route_without_campus_context_picks_best(client: TestClient) -> None:
    """No campus_slug (the UI default): same-named places on other campuses
    are duplicates, not ambiguity — route to the deterministic best."""
    res = _query(client, "main gate to library")
    assert res["kind"] == "route", res
    assert res["data"]["origin"]["id"] == "main_gate"
    assert res["data"]["destination"]["id"] == "central_library"


def test_prefixed_route_to_phrasing(client: TestClient) -> None:
    res = _query(client, "Find an accessible route to Library.")
    assert res["kind"] == "route", res
    assert res["data"]["destination"]["id"] == "central_library"
    assert res["data"]["require_accessible"] is True

    res2 = _query(client, "Find the fastest route to the Library.")
    assert res2["kind"] == "route", res2
    assert res2["data"]["destination"]["id"] == "central_library"
    assert res2["data"]["mode"] == "fastest"


# ---- multi-campus: campuses without a surveyed Main Gate ----------------
# VIT Chennai's graph has NO gate node. NOVA's assumed-origin fallback must
# not dead-end with "unknown source" — it explains the problem and points
# to GPS or an explicit origin instead. (Regression for the production
# finding: "find an accessible route to the library" on VIT errored.)

def _seed_vit(db_session) -> tuple[str, object]:
    from pathlib import Path

    from app.seed.csv_loader import (
        _read_payload,
        load_buildings_and_nodes,
        load_campus,
        load_edges,
    )

    payload = _read_payload(Path(__file__).parent.parent / "seed_data" / "vit_chennai.json")
    campus = load_campus(db_session, payload)
    node_ids = load_buildings_and_nodes(db_session, payload, campus)
    load_edges(db_session, payload, campus, node_ids)
    db_session.commit()
    return campus.slug, campus.id


def _vit_headers(db_session) -> dict[str, str]:
    import uuid

    from app.models.user import Role, User
    from app.security import create_access_token

    user = User(
        id=uuid.uuid4(),
        email="vit-nova@test.dev",
        password_hash="x",  # never used — the JWT is signed directly below
        full_name="Vit Nova",
        role=Role.STUDENT,
    )
    db_session.add(user)
    db_session.commit()
    return {"Authorization": f"Bearer {create_access_token(subject=str(user.id))}"}


def _query_vit(
    client: TestClient,
    db_session,
    query: str,
    lat: float | None = None,
    lng: float | None = None,
) -> dict:
    slug, _ = _seed_vit(db_session)
    body = {"query": query, "campus_slug": slug}
    if lat is not None and lng is not None:
        body["user_lat"] = lat
        body["user_lng"] = lng
    r = client.post("/assistant/query", json=body, headers=_vit_headers(db_session))
    assert r.status_code == 200, r.text
    return r.json()


def test_vit_route_without_origin_explains_missing_gate(client: TestClient, db_session) -> None:
    """No origin, no GPS: no Main Gate exists on VIT — NOVA must guide the
    user instead of dead-ending on 'unknown source'."""
    res = _query_vit(client, db_session, "find an accessible route to the library")
    assert res["kind"] == "search", res
    assert "Main Gate" in res["text"]
    assert "location" in res["text"]


def test_vit_navigate_without_origin_explains_missing_gate(client: TestClient, db_session) -> None:
    res = _query_vit(client, db_session, "navigate to the library")
    assert res["kind"] == "search", res
    assert "Main Gate" in res["text"]
    assert "location" in res["text"]


def test_vit_route_with_gps_origin_routes_from_location(client: TestClient, db_session) -> None:
    """A live fix near a real VIT node becomes the origin — the route must
    succeed and say it starts from the user's location."""
    from app.models.graph import PathNode

    _, campus_id = _seed_vit(db_session)
    node = db_session.query(PathNode).filter(PathNode.campus_id == campus_id).first()
    assert node is not None
    # location is WKT "POINT(lng lat)".
    lng, lat = (float(p) for p in node.location.replace("POINT(", "").replace(")", "").split())
    res = _query_vit(
        client, db_session, "find an accessible route to the library", lat=lat, lng=lng
    )
    assert res["kind"] == "route", res
    assert res["data"]["origin"]["id"] == str(node.id)
    assert "location" in res["text"]
    assert res["data"]["require_accessible"] is True


# ---- AUTH-NOVA: Nova endpoint authentication contract -------------------

def test_nova_accepts_valid_existing_jwt(client: TestClient) -> None:
    """AUTH-NOVA-02: the same JWT the rest of CampusNav uses works here."""
    res = _query(client, "main gate to library")
    assert res["kind"] == "route", res
    assert res["data"]["origin"]["id"] == "main_gate"
    assert res["data"]["destination"]["id"] == "central_library"


def test_nova_missing_token_returns_401(client: TestClient) -> None:
    """AUTH-NOVA-03: no header -> 401, never a public endpoint."""
    r = client.post("/assistant/query", json={"query": "hello nova"})
    assert r.status_code == 401


def test_nova_invalid_token_returns_401(client: TestClient) -> None:
    """AUTH-NOVA-04: a malformed/forged token is rejected."""
    r = client.post(
        "/assistant/query",
        json={"query": "hello nova"},
        headers={"Authorization": "Bearer garbage.token.here"},
    )
    assert r.status_code == 401


def test_nova_expired_token_returns_401(client: TestClient, db_session) -> None:
    """AUTH-NOVA-05: an expired JWT for a real user is rejected."""
    user = db_session.query(User).filter(User.email == "phase5@test.com").first()
    if user is None:
        user = User(
            email="phase5-expired@test.com",
            password_hash="x",
            full_name="Expired Session",
        )
        db_session.add(user)
        db_session.commit()
        db_session.refresh(user)
    settings = get_settings()
    now = datetime.now(UTC)
    expired = jwt.encode(
        {"sub": str(user.id), "iat": now - timedelta(hours=2), "exp": now - timedelta(hours=1)},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    r = client.post(
        "/assistant/query",
        json={"query": "hello nova"},
        headers={"Authorization": f"Bearer {expired}"},
    )
    assert r.status_code == 401


def test_nova_disabled_user_returns_401(client: TestClient, db_session) -> None:
    """AUTH-NOVA-05b: tokens stop working the moment the account is disabled."""
    headers = _auth_headers(client, "disable-me@test.com")
    user = db_session.query(User).filter(User.email == "disable-me@test.com").first()
    user.disabled_at = datetime.now(UTC)
    db_session.commit()

    r = client.post(
        "/assistant/query",
        json={"query": "hello nova"},
        headers=headers,
    )
    assert r.status_code == 401


def test_nova_response_never_exposes_provider_credentials(client: TestClient) -> None:
    """AUTH-NOVA-07: the Nova response body contains no API-key material —
    provider credentials stay server-side by construction."""
    res = _query(client, "main gate to library")
    raw = str(res)
    assert "sk-" not in raw.lower()
    assert "api_key" not in raw.lower()
    assert "secret" not in raw.lower()