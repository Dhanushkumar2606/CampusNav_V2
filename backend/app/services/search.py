"""Campus search service — fuzzy, scored, over real data only.

Candidates come from `Building` (richer names/codes) and `PathNode`
(graph points: entrances, landmarks, transit, junctions). POI rows join
when present. Nothing is invented: scores are deterministic, results
carry real coordinates, and the whole index fits in memory at campus
scale (no external search dependency).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.campus import Building, Campus, Floor, POI, Room
from app.models.graph import PathNode, PathNodeKind
from app.services.navigation import _haversine

_WORD_RE = re.compile(r"[a-z0-9]+")


@dataclass(frozen=True)
class SearchResult:
    id: UUID
    label: str
    type: str  # "building" | "node" | "poi" | "room"
    category: str
    lat: float
    lng: float
    campus_id: UUID
    campus_slug: str
    campus_name: str
    building_id: UUID | None
    subtitle: str | None
    score: float
    # Graph/destination key: resolves via the campus graph `labels` map.
    # Null when the result has no graph node (e.g. POI rows).
    slug: str | None = None


@dataclass(frozen=True)
class _Candidate:
    id: UUID
    label: str
    haystack: str
    type: str
    category: str
    lat: float
    lng: float
    campus_id: UUID
    campus_slug: str
    campus_name: str
    building_id: UUID | None
    subtitle: str | None
    slug: str | None = None


_WKT_RE = re.compile(r"POINT\s*\(\s*(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s*\)", re.IGNORECASE)


def _parse_point(wkt: str | None) -> tuple[float, float] | None:
    if not wkt:
        return None
    m = _WKT_RE.search(wkt)
    if not m:
        return None
    return float(m.group(1)), float(m.group(2))


def _tokens(text: str) -> set[str]:
    return set(_WORD_RE.findall(text.lower()))


def _score(query: str, haystack: str) -> float:
    """Deterministic relevance score, 0..100."""
    q = query.lower().strip()
    h = haystack.lower().strip()
    if not q or not h:
        return 0.0
    if q == h:
        return 100.0
    if h.startswith(q):
        return 80.0
    q_tokens = _tokens(q)
    h_tokens = _tokens(h)
    if not q_tokens:
        return 40.0 if q in h else 0.0
    # Every query token present (word-boundary): the whole query matched.
    all_present = all(any(ht.startswith(t) for ht in h_tokens) for t in q_tokens)
    if q in h:
        # Whole-phrase substring — a full intent match ("cse block") beats
        # scattered token hits.
        return 90.0 if all_present else 45.0
    # Word-boundary contains: strongest signal after prefix.
    if any(ht.startswith(q) or ht == q for ht in h_tokens):
        return 90.0 if all_present else 70.0
    # Token-level: fraction of query tokens present anywhere.
    hits = sum(1 for t in q_tokens if any(ht.startswith(t) for ht in h_tokens))
    return round(30.0 * hits / len(q_tokens), 1)


def _candidates(session: Session, campus: Campus | None) -> list[_Candidate]:
    out: list[_Candidate] = []
    bq = select(Building)
    if campus is not None:
        bq = bq.where(Building.campus_id == campus.id)
    building_codes: set[tuple[str, str]] = set()
    for b in session.execute(bq).scalars():
        pt = _parse_point(b.centroid)
        if pt is None:
            continue
        building_codes.add((str(b.campus_id), b.code))
        out.append(
            _Candidate(
                id=b.id,
                label=b.name,
                haystack=f"{b.name} {b.code} {b.code.replace('_', ' ')}",
                type="building",
                category="building",
                lat=pt[1],
                lng=pt[0],
                campus_id=b.campus_id,
                campus_slug=b.campus.slug if b.campus else "",
                campus_name=b.campus.name if b.campus else "",
                building_id=b.id,
                subtitle=f"{b.num_floors} floor{'s' if b.num_floors != 1 else ''}"
                + (", elevator" if b.has_elevator else ""),
                slug=b.code.lower(),
            )
        )

    nq = select(PathNode)
    if campus is not None:
        nq = nq.where(PathNode.campus_id == campus.id)
    for n in session.execute(nq).scalars():
        # Entrance nodes duplicate the Building row (same code) — skip them,
        # but keep unique entrances such as main gates and transit stops.
        if n.kind == PathNodeKind.BUILDING_ENTRANCE and (str(n.campus_id), n.label) in building_codes:
            continue
        pt = _parse_point(n.location)
        if pt is None:
            continue
        out.append(
            _Candidate(
                id=n.id,
                label=n.label.replace("_", " "),
                haystack=n.label.replace("_", " "),
                type="node",
                category=n.kind.value,
                lat=pt[1],
                lng=pt[0],
                campus_id=n.campus_id,
                campus_slug=n.campus.slug if n.campus else "",
                campus_name=n.campus.name if n.campus else "",
                building_id=None,
                subtitle=n.kind.value.capitalize(),
                slug=n.label,
            )
        )

    pq = select(POI)
    if campus is not None:
        pq = pq.where(POI.campus_id == campus.id)
    for p in session.execute(pq).scalars():
        pt = _parse_point(p.location)
        if pt is None:
            continue
        out.append(
            _Candidate(
                id=p.id,
                label=p.name,
                haystack=p.name,
                type="poi",
                category=p.category.value,
                lat=pt[1],
                lng=pt[0],
                campus_id=p.campus_id,
                campus_slug=p.campus.slug if p.campus else "",
                campus_name=p.campus.name if p.campus else "",
                building_id=None,
                subtitle=p.description or None,
            )
        )

    # Rooms — schema-ready: rows appear only when floor/room data is seeded
    # (none today), but the query path is real and tested.
    rq = (
        select(Room, Floor, Building)
        .join(Floor, Floor.id == Room.floor_id)
        .join(Building, Building.id == Floor.building_id)
    )
    if campus is not None:
        rq = rq.where(Building.campus_id == campus.id)
    for room, floor, b in session.execute(rq):
        bpt = _parse_point(b.centroid)
        if bpt is None:
            continue
        out.append(
            _Candidate(
                id=room.id,
                label=room.code,
                haystack=f"{room.code} {room.name} {b.name} {floor.label} floor {floor.level}",
                type="room",
                category="room",
                lat=bpt[1],
                lng=bpt[0],
                campus_id=b.campus_id,
                campus_slug=b.campus.slug if b.campus else "",
                campus_name=b.campus.name if b.campus else "",
                building_id=b.id,
                subtitle=f"{room.name} · {b.name} · {floor.label}",
                slug=f"{b.code.lower()}:{room.code.lower()}",
            )
        )
    return out


# Category words that, when present in a query, boost that category.
# Query "nearest canteen" should favor POIs over buildings, etc.
_CATEGORY_BOOSTS: dict[str, str] = {
    "building": "building",
    "buildings": "building",
    "block": "building",
    "cafe": "poi",
    "cafes": "poi",
    "canteen": "poi",
    "canteens": "poi",
    "restroom": "poi",
    "restrooms": "poi",
    "atm": "poi",
    "landmark": "landmark",
    "landmarks": "landmark",
    "gate": "landmark",
    "station": "transit",
    "transit": "transit",
    "transport": "transit",
    "entrance": "entrance",
    "entrances": "entrance",
    "room": "room",
    "rooms": "room",
}


def search(
    session: Session,
    query: str,
    campus_slug: str | None = None,
    limit: int = 20,
    near_lat: float | None = None,
    near_lng: float | None = None,
) -> list[SearchResult]:
    """Search across buildings + graph nodes + POIs (+ rooms when seeded).
    Returns scored results (best first); empty list when nothing matches or
    query is blank.

    `near_lat`/`near_lng` bias results toward the given location: candidates
    within ~1.5 km get a proximity bonus (up to 40 points), relevance first.
    """
    q = query.strip()
    if not q:
        return []

    campus = None
    if campus_slug:
        campus = session.execute(
            select(Campus).where(Campus.slug == campus_slug)
        ).scalar_one_or_none()

    boost_targets = {_CATEGORY_BOOSTS[t] for t in _tokens(q) if t in _CATEGORY_BOOSTS}

    scored: list[tuple[float, _Candidate]] = []
    for c in _candidates(session, campus):
        score = _score(q, c.haystack)
        if score <= 0:
            continue
        if c.category in boost_targets:
            score += 20.0
        if near_lat is not None and near_lng is not None:
            dist = _haversine(near_lat, near_lng, c.lat, c.lng)
            score += 40.0 * max(0.0, 1.0 - dist / 1500.0)
        scored.append((score, c))

    # Relevance first; ties break toward richer result types (a building
    # outranks its entrance node, which outranks rooms/POIs).
    _type_priority = {"building": 0, "poi": 1, "node": 2, "room": 3}
    scored.sort(
        key=lambda pair: (
            -pair[0],
            _type_priority.get(pair[1].type, 9),
            pair[1].label,
        )
    )
    return [
        SearchResult(
            id=c.id,
            label=c.label,
            type=c.type,
            category=c.category,
            lat=c.lat,
            lng=c.lng,
            campus_id=c.campus_id,
            campus_slug=c.campus_slug,
            campus_name=c.campus_name,
            building_id=c.building_id,
            subtitle=c.subtitle,
            score=score,
            slug=c.slug,
        )
        for score, c in scored[:limit]
    ]
