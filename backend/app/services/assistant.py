"""Assistant service — rule-based intent engine over search + routing."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.campus import Building, Campus
from app.models.graph import PathNode, PathNodeKind
from app.services.search import search as search_service, SearchResult


INTENT_PATTERNS = [
    # "I have a class in CSE 204 in 15 minutes. I'm at the library. Take me there using the fastest accessible route."
    (
        re.compile(
            r"(?:class|lecture|session)\s+(?:in|at)\s+([A-Za-z0-9\s]+?)\s+(?:in\s+)?(\d+)\s*(?:min|minute|minutes)",
            re.IGNORECASE,
        ),
        "class_with_time",
    ),
    # "Navigate to CSE Block"
    (re.compile(r"(?:navigate|go|take\s+me)\s+to\s+(.+)", re.IGNORECASE), "navigate_to"),
    # "Find the library"
    (re.compile(r"(?:find|search|locate)\s+(.+)", re.IGNORECASE), "find"),
    # "Where is the auditorium"
    (re.compile(r"where\s+is\s+(.+)", re.IGNORECASE), "find"),
    # "How do I get to main gate"
    (re.compile(r"how\s+(?:do\s+I|to)\s+get\s+to\s+(.+)", re.IGNORECASE), "navigate_to"),
]


def classify_intent(text: str) -> tuple[str, dict[str, str]]:
    """Return (intent_type, extracted_slots).

    Slots mirror the regex capture groups 1-indexed (``"1"``, ``"2"``, …)
    plus the raw text under ``"raw"`` — the patterns use positional groups.
    """
    for pattern, intent in INTENT_PATTERNS:
        m = pattern.search(text)
        if m:
            slots: dict[str, str] = {"raw": text}
            for i, g in enumerate(m.groups()):
                if g:
                    slots[str(i + 1)] = g.strip()
            return intent, slots
    return "unknown", {"raw": text}


@dataclass(frozen=True)
class AssistantResponse:
    kind: Literal["route", "search", "info", "error"]
    text: str
    data: dict | None = None


def resolve_building_room(session: Session, query: str, campus_slug: str | None = None) -> SearchResult | None:
    """Try to match a building/room query to a real building."""
    results = search_service(session, query, campus_slug, limit=5)
    for r in results:
        if r.type == "building":
            return r
    return None


def resolve_destination(
    session: Session,
    slots: dict[str, str],
    campus_slug: str | None = None,
) -> tuple[SearchResult | None, str | None]:
    """Extract destination from slots (room name, building name, landmark)."""
    # Try the first capture group from the regex
    for key in ("0", "1", "building", "destination", "place", "location"):
        val = slots.get(key)
        if val:
            result = resolve_building_room(session, val.strip(), campus_slug)
            if result:
                return result, val.strip()
    return None, None


def format_search_response(results: list[SearchResult], query: str) -> AssistantResponse:
    if not results:
        return AssistantResponse(
            kind="info",
            text=f"I couldn't find anything matching “{query}” on campus.",
        )
    lines = [f"Found {len(results)} result(s) for “{query}”:"] + [
        f"• {r.label} ({r.category}) — score {r.score}" for r in results[:5]
    ]
    return AssistantResponse(kind="search", text="\n".join(lines), data={"results": [r.__dict__ for r in results]})


def assistant_query(
    session: Session,
    query: str,
    campus_slug: str | None = None,
    user_location: UUID | None = None,
    time_constraint_min: int | None = None,
) -> AssistantResponse:
    """Main entry point — rule-based, no LLM required."""
    intent, slots = classify_intent(query)

    if intent == "class_with_time":
        # Slots: building name (group 1), minutes (group 2)
        building_name = slots.get("1", "").strip()
        time_constraint_min = int(slots.get("2", "0"))
        dest, _ = resolve_destination(session, {"0": building_name}, campus_slug)
        if not dest:
            return AssistantResponse(
                kind="error",
                text=f"I couldn't find a building matching “{building_name}”. Could you clarify the name?",
            )
        # In a real implementation we'd call routing with user_location + dest
        return AssistantResponse(
            kind="route",
            text=(
                f"Class in {dest.label} in {time_constraint_min} minutes. "
                f"From your current location, I'll find the fastest accessible route."
            ),
            data={
                "destination": dest.__dict__,
                "time_constraint_min": time_constraint_min,
                "require_accessible": True,
                "mode": "fastest",
            },
        )

    if intent in ("navigate_to", "find"):
        dest, raw = resolve_destination(session, slots, campus_slug)
        if not dest:
            # Fall back to search
            results = search_service(session, query, campus_slug, limit=10)
            return format_search_response(results, query)

        if intent == "navigate_to":
            return AssistantResponse(
                kind="route",
                text=f"Navigating to {dest.label}. Tap the route to start.",
                data={
                    "destination": dest.__dict__,
                    "require_accessible": False,
                    "mode": "shortest",
                },
            )
        else:
            return format_search_response([dest], query)

    # Unknown intent — fall back to search
    results = search_service(session, query, campus_slug, limit=10)
    return format_search_response(results, query)