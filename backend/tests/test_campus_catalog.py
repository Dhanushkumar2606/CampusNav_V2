"""Tests for the campus catalog endpoints (stats + near geo-ranking)."""

from __future__ import annotations

import json
import math
import uuid
from pathlib import Path

from app.models.campus import Campus

SRM_SLUG = "srm-institute-of-science-and-technology-kattankulathur"


def _add_campus(db_session, name: str, slug: str, lat=None, lng=None) -> Campus:
    campus = Campus(
        id=uuid.uuid4(),
        name=name,
        slug=slug,
        description=f"{name} (test)",
        featured=False,
        center_lat=lat,
        center_lng=lng,
    )
    db_session.add(campus)
    db_session.commit()
    db_session.refresh(campus)
    return campus


def test_campus_stats_counts(db_session, client):
    res = client.get(f"/navigation/campuses/{SRM_SLUG}/stats")
    assert res.status_code == 200, res.text
    data = res.json()
    # Counts must match the authoritative seed JSON (junction-based walkway
    # network: POIs + junctions + surveyed network edges + entrance connectors).
    seed = json.loads(
        (Path(__file__).parent.parent / "seed_data" / "srm_ktr.json").read_text()
    )
    assert data["campus_slug"] == SRM_SLUG
    assert data["nodes"] == len(seed["nodes"])
    assert data["edges"] == len(seed["edges"])
    assert data["buildings"] == 8
    # Surveyed/estimated split must match the seed JSON — this guards the
    # loader against silently flipping `estimated` or dropping walkway
    # geometry (a stale DB once marked every edge estimated).
    assert data["surveyed_edges"] == sum(
        1 for e in seed["edges"] if not e.get("estimated", False)
    )
    assert data["edges"] - data["surveyed_edges"] == sum(
        1 for e in seed["edges"] if e.get("estimated", False)
    )
    # Node-kind buckets from the seed: 9 entrances, 2 landmarks, 1 transit,
    # 1 POI (remaining nodes are junctions/transitions and are not counted).
    assert data["entrances"] == 9
    assert data["landmarks"] == 2
    assert data["transit"] == 1
    assert data["poi"] == 1
    buckets = data["entrances"] + data["landmarks"] + data["transit"] + data["poi"]
    assert 0 < buckets <= data["nodes"]


def test_campus_stats_unknown_slug(client):
    res = client.get("/navigation/campuses/no-such-campus/stats")
    assert res.status_code == 404


def test_campuses_near_ranks_by_distance_and_filters_no_center(db_session, client):
    # SRM gets a catalog centroid; a second campus sits far away; a third has none.
    srm = db_session.query(Campus).filter(Campus.slug == SRM_SLUG).one()
    srm.center_lat, srm.center_lng = 12.8232, 80.0442
    far = _add_campus(db_session, "Far Campus", "far-campus", lat=13.0827, lng=80.2707)
    far.center_lat, far.center_lng = 13.0827, 80.2707
    db_session.commit()
    _add_campus(db_session, "No Center", "no-center")

    res = client.get("/navigation/campuses/near", params={"lat": 12.8232, "lng": 80.0442})
    assert res.status_code == 200, res.text
    rows = res.json()
    assert [r["slug"] for r in rows] == [SRM_SLUG, "far-campus"]
    assert rows[0]["distance_m"] == 0.0
    # Honest haversine: SRM → Chennai Egmore is roughly 30 km.
    assert 25_000 < rows[1]["distance_m"] < 40_000
    assert "distance_m" in rows[0]

    # radius excludes the far campus; limit truncates.
    res = client.get(
        "/navigation/campuses/near",
        params={"lat": 12.8232, "lng": 80.0442, "radius_m": 1_000},
    )
    assert [r["slug"] for r in res.json()] == [SRM_SLUG]

    res = client.get(
        "/navigation/campuses/near",
        params={"lat": 12.8232, "lng": 80.0442, "limit": 1},
    )
    assert [r["slug"] for r in res.json()] == [SRM_SLUG]


def test_campuses_near_outside_radius_returns_empty(db_session, client):
    srm = db_session.query(Campus).filter(Campus.slug == SRM_SLUG).one()
    srm.center_lat, srm.center_lng = 12.8232, 80.0442
    db_session.commit()
    res = client.get(
        "/navigation/campuses/near",
        params={"lat": 51.5074, "lng": -0.1278, "radius_m": 100},
    )
    assert res.status_code == 200
    assert res.json() == []


def test_campuses_list_exposes_featured_and_center(db_session, client):
    srm = db_session.query(Campus).filter(Campus.slug == SRM_SLUG).one()
    srm.featured = True
    srm.center_lat, srm.center_lng = 12.8232, 80.0442
    db_session.commit()

    res = client.get("/navigation/campuses")
    assert res.status_code == 200
    rows = res.json()
    assert len(rows) == 1
    assert rows[0]["featured"] is True
    assert rows[0]["center_lat"] == 12.8232
    assert rows[0]["center_lng"] == 80.0442


def test_haversine_honesty(db_session, client):
    """The near endpoint reports the real distance, not a grid estimate."""
    srm = db_session.query(Campus).filter(Campus.slug == SRM_SLUG).one()
    srm.center_lat, srm.center_lng = 12.8232, 80.0442
    db_session.commit()

    lat2, lng2 = 13.0827, 80.2707
    res = client.get("/navigation/campuses/near", params={"lat": lat2, "lng": lng2})
    rows = res.json()
    row = next(r for r in rows if r["slug"] == SRM_SLUG)

    def haversine(lat1, lng1, lat2_, lng2_):
        r = 6371_000
        p1, p2 = map(math.radians, (lat1, lat2_))
        dp, dl = math.radians(lat2_ - lat1), math.radians(lng2_ - lng1)
        a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        return 2 * r * math.asin(math.sqrt(a))

    expected = haversine(12.8232, 80.0442, lat2, lng2)
    assert abs(row["distance_m"] - expected) < 100