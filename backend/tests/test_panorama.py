"""Panorama tile relay tests — validation, allowlist, and upstream passthrough."""

from __future__ import annotations

import urllib.request

from fastapi.testclient import TestClient

from app.routers import panorama

MEDIA = "94652D98_145D_D693_419A_9AE6E084796B"


def _probe(client: TestClient, path: str) -> TestClient:
    return client.get(path)


def test_valid_tile_streams_jpeg(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(panorama, "_fetch_tile", lambda url: b"\xff\xd8fakejpeg\xff\xd9")
    r = client.get(f"/api/panorama/tile/{MEDIA}/f/0/0_0.jpg")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"
    assert "max-age=86400" in r.headers["cache-control"]
    assert r.content == b"\xff\xd8fakejpeg\xff\xd9"


def test_tile_url_is_built_from_validated_parts(client: TestClient, monkeypatch) -> None:
    seen: list[str] = []

    def fake_fetch(url: str) -> bytes:
        seen.append(url)
        return b"\xff\xd8jpg"

    monkeypatch.setattr(panorama, "_fetch_tile", fake_fetch)
    client.get(f"/api/panorama/tile/{MEDIA}/b/1/1_0.jpg")
    assert seen == [
        "https://webstor.srmist.edu.in/web_assets/srmist-virtual-tour-vo/media/"
        f"panorama_{MEDIA}_0/b/1/1_0.jpg"
    ]


def test_unknown_media_id_rejected(client: TestClient) -> None:
    r = client.get("/api/panorama/tile/FFFF0000_0000_0000_0000_000000000000/f/0/0_0.jpg")
    assert r.status_code == 404


def test_invalid_face_rejected(client: TestClient) -> None:
    r = client.get(f"/api/panorama/tile/{MEDIA}/x/0/0_0.jpg")
    assert r.status_code == 400


def test_invalid_level_rejected(client: TestClient) -> None:
    r = client.get(f"/api/panorama/tile/{MEDIA}/f/3/0_0.jpg")
    assert r.status_code == 400


def test_tile_outside_pyramid_rejected(client: TestClient) -> None:
    # Level 0 is 4x4 -> row/col in 0..3; 4 is out of bounds.
    r = client.get(f"/api/panorama/tile/{MEDIA}/f/0/4_0.jpg")
    assert r.status_code == 400


def test_upstream_failure_maps_to_502(client: TestClient, monkeypatch) -> None:
    import urllib.error

    def boom(url: str, timeout: int = 20):
        raise urllib.error.URLError("connection refused")

    monkeypatch.setattr(urllib.request, "urlopen", boom)
    r = client.get(f"/api/panorama/tile/{MEDIA}/f/0/0_0.jpg")
    assert r.status_code == 502
    assert r.json()["detail"] == "Upstream tile unavailable"