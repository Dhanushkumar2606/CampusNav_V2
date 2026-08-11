"""Auth endpoint tests."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_register_then_login_then_me(client: TestClient) -> None:
    r = client.post(
        "/auth/register",
        json={
            "email": "new@example.com",
            "password": "supersecret123",
            "full_name": "New User",
        },
    )
    assert r.status_code == 201, r.text
    user = r.json()
    assert user["email"] == "new@example.com"
    assert user["full_name"] == "New User"
    assert user["role"] == "student"
    assert "password" not in user and "password_hash" not in user

    r = client.post(
        "/auth/login",
        data={"username": "new@example.com", "password": "supersecret123"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    assert token

    r = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    me = r.json()
    assert me["email"] == "new@example.com"


def test_register_duplicate_email_409(client: TestClient) -> None:
    payload = {
        "email": "dup@example.com",
        "password": "supersecret123",
        "full_name": "Dup",
    }
    assert client.post("/auth/register", json=payload).status_code == 201
    r = client.post("/auth/register", json=payload)
    assert r.status_code == 409
    assert "already" in r.json()["detail"].lower()


def test_login_bad_password_401(client: TestClient) -> None:
    client.post(
        "/auth/register",
        json={
            "email": "x@example.com",
            "password": "supersecret123",
            "full_name": "X",
        },
    )
    r = client.post(
        "/auth/login",
        data={"username": "x@example.com", "password": "wrong"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert r.status_code == 401


def test_me_unauthenticated_401(client: TestClient) -> None:
    r = client.get("/auth/me")
    assert r.status_code == 401