"""Assistant service — rule-based intent engine over the Phase H tool
registry. The regex classifier picks an intent; the dispatcher maps it to
one or more tool calls (with real routing via `calculate_route`); results
are returned as structured `tool_calls` for the frontend cards."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Literal

from sqlalchemy.orm import Session

from app.services.discovery import find_campus
from app.services.navigation import nearest_node
from app.services.tools import (
    run_search_campus,
)

INTENT_PATTERNS = [
    # "I have a class in CSE 204 in 15 minutes. I'm at the library."
    (
        re.compile(
            r"(?:class|lecture|session)\s+(?:in|at)\s+([A-Za-z0-9\s]+?)\s+(?:in\s+)?(\d+)\s*(?:min|minute|minutes)",
            re.IGNORECASE,
        ),
        "class_with_time",
    ),
    # "Nearest canteen" / "What's near the auditorium"
    (re.compile(r"(?:nearest|closest)\s+([a-z0-9\s]+)", re.IGNORECASE), "nearest"),
    (re.compile(r"what'?s\s+near\s+(.+)", re.IGNORECASE), "near"),
    # "Navigate to CSE Block"
    (re.compile(r"(?:navigate|go|take\s+me)\s+to\s+(.+)", re.IGNORECASE), "navigate_to"),
    # "How do I get to main gate"
    (re.compile(r"how\s+(?:do\s+I|to)\s+get\s+to\s+(.+)", re.IGNORECASE), "navigate_to"),
    # "Find the library" / "Where is the auditorium"
    (re.compile(r"(?:find|search|locate)\s+(.+)", re.IGNORECASE), "find"),
    (re.compile(r"where\s+is\s+(.+)", re.IGNORECASE), "find"),
    # "Info about the library" / "Tell me about the Tech Park"
    (re.compile(r"(?:info|details|about|tell\s+me\s+about)\s+(.+)", re.IGNORECASE), "info_about"),
    # "How many buildings are there" / "campus info"
    (re.compile(r"(?:how\s+many|campus\s+info|about\s+the\s+campus|tell\s+me\s+about\s+the\s+campus)", re.IGNORECASE), "campus_info"),
    # "List categories" / "what's on campus"
    (re.compile(r"(?:categories|what'?s\s+on\s+campus|list\s+places)", re.IGNORECASE), "categories"),
]


def classify_intent(text: str) -> tuple[str, dict[str, str]]:
    """Return (intent_type, extracted_slots). Slots mirror regex groups 1-indexed."""
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
    tool_calls: list[dict[str, Any]] = field(default_factory=list)


def _first_result(session: Session, query: str, campus_slug: str | None) -> dict[str, Any] | None:
    """Best search hit for a destination phrase, or None."""
    results = run_search_campus(session, {"query": query, "campus": campus_slug or "", "limit": 5})
    for r in results.get("results", []):
        if r["type"] in ("building", "node", "room"):
            return r
    return None


def _snap_user_location(session: Session, campus_slug: str | None, lat: float, lng: float) -> dict[str, Any] | None:
    """Snap a live GPS fix to the nearest real graph node (honest)."""
    campus = find_campus(session, campus_slug)
    if campus is None:
        return None
    hit = nearest_node(session, campus.id, lat, lng)
    if hit is None:
        return None
    node, distance_m = hit
    return {
        "node_id": str(node.id),
        "label": node.label,
        "type": node.kind.value,
        "distance_m": round(distance_m, 1),
    }


def assistant_query(
    session: Session,
    query: str,
    campus_slug: str | None = None,
    user_location: str | None = None,  # node UUID (legacy)
    user_lat: float | None = None,
    user_lng: float | None = None,
    time_constraint_min: int | None = None,
) -> AssistantResponse:
    """Main entry point — rule-based, no LLM required."""
    intent, slots = classify_intent(query)
    calls: list[dict[str, Any]] = []

    def call(name: str, args: dict[str, Any]) -> dict[str, Any]:
        result = run_tool_import(session, name, args)
        calls.append({"tool": name, "args": args, "result": result})
        return result

    # Live location beats an explicit node id; both default to None.
    origin: dict[str, Any] | None = None
    if user_lat is not None and user_lng is not None:
        origin = _snap_user_location(session, campus_slug, user_lat, user_lng)
        if origin is None and user_location:
            origin = {"node_id": user_location, "label": user_location}
    elif user_location:
        origin = {"node_id": user_location, "label": user_location}

    if intent in ("navigate_to", "class_with_time"):
        phrase = slots.get("1", "").strip()
        dest = _first_result(session, phrase, campus_slug)
        if dest is None:
            results = call("search_campus", {"query": query, "campus": campus_slug or "", "limit": 5})
            return AssistantResponse(
                kind="search",
                text=f"I couldn't find a destination matching “{phrase}”. Here's what I found for “{query}”:",
                data={"results": results.get("results", [])},
                tool_calls=calls,
            )
        route_args: dict[str, Any] = {
            "campus": dest.get("campus_slug") or campus_slug or "",
            # Real source: live location when available, otherwise the
            # campus Main Gate (a real surveyed node) — and the text below
            # says so explicitly. Never fabricates the user's position.
            "source": origin["node_id"] if origin else "main_gate",
            "destination": dest.get("slug") or dest.get("id"),
            "mode": "fastest" if intent == "class_with_time" else "shortest",
            "require_accessible": intent == "class_with_time",
        }
        assumed_origin = origin is None
        route = call("calculate_route", route_args)
        if route.get("status") == "source_equals_destination":
            return AssistantResponse(
                kind="info",
                text=f"You're already at {dest['label']}.",
                data={"destination": dest},
                tool_calls=calls,
            )
        if "error" in route:
            text = (
                f"I found {dest['label']} but couldn't compute a route"
                + (f" ({route['error']})." if route.get("error") else ".")
            )
            return AssistantResponse(kind="error", text=text, data={"destination": dest}, tool_calls=calls)
        minutes = slots.get("2")
        if intent == "class_with_time":
            eta_text = (
                f"~{route['estimated_walk_time_min']} min to walk"
                if not assumed_origin
                else f"~{route['estimated_walk_time_min']} min from the Main Gate"
            )
            text = (
                f"Class in {dest['label']} in {minutes} minutes. The fastest accessible route "
                f"is {route['total_distance_m']} m, {eta_text}."
            )
        else:
            origin_text = " (from your live location)" if not assumed_origin else " from the Main Gate — share your live location for a personalized start"
            text = (
                f"Here's the {route['mode']} route to {dest['label']}{origin_text}: "
                f"{route['total_distance_m']} m, about {route['estimated_walk_time_min']} min."
            )
        return AssistantResponse(
            kind="route",
            text=text,
            data={
                "destination": dest,
                "origin": origin,
                "require_accessible": route_args.get("require_accessible", False),
                "mode": route_args.get("mode", "shortest"),
                "time_constraint_min": int(minutes) if minutes else time_constraint_min,
                "total_distance_m": route.get("total_distance_m"),
                "estimated_walk_time_min": route.get("estimated_walk_time_min"),
                "step_count": route.get("step_count"),
            },
            tool_calls=calls,
        )

    if intent in ("nearest", "near"):
        target = slots.get("1", "").strip()
        args: dict[str, Any] = {
            "campus": campus_slug or "",
            "lat": user_lat if user_lat is not None else None,
            "lng": user_lng if user_lng is not None else None,
            "category": target if target in ("landmark", "transit", "poi", "entrance") else None,
        }
        if args["category"] is None:
            # A specific place type ("nearest canteen"): search first, and
            # answer honestly when the type doesn't exist on campus rather
            # than dumping unrelated nearby nodes.
            hit = _first_result(session, target, campus_slug)
            if hit is None:
                return AssistantResponse(
                    kind="info",
                    text=f"I couldn't find a “{target}” in the campus data.",
                    tool_calls=calls,
                )
            if hit.get("lat") is not None:
                args["lat"], args["lng"] = hit["lat"], hit["lng"]
        if args["lat"] is None or args["lng"] is None:
            # "nearest to the auditorium" — resolve the reference place first.
            ref = _first_result(session, target, campus_slug)
            if ref is not None and ref.get("lat") is not None:
                args["lat"], args["lng"] = ref["lat"], ref["lng"]
        if args["lat"] is None or args["lng"] is None:
            return AssistantResponse(
                kind="error",
                text="I need your live location (or a place to measure from) to find nearby places.",
                tool_calls=calls,
            )
        result = call("get_nearby_places", args)
        places = result.get("places", [])
        if not places:
            return AssistantResponse(
                kind="info",
                text="Nothing within range matches that near you on the campus data.",
                tool_calls=calls,
            )
        lines = [f"Near you (within {args.get('radius_m', 300)} m):"] + [
            f"• {p['label']} ({p['type']}) — {p['distance_m']} m" for p in places[:5]
        ]
        return AssistantResponse(
            kind="search",
            text="\n".join(lines),
            data={"results": places},
            tool_calls=calls,
        )

    if intent == "info_about":
        target = slots.get("1", "").strip()
        hit = _first_result(session, target, campus_slug)
        if hit is None:
            return AssistantResponse(
                kind="info",
                text=f"I couldn't find “{target}” on campus.",
                tool_calls=calls,
            )
        if hit["type"] == "building":
            detail = call("get_building_details", {"building_id": hit["id"]})
            if "error" in detail:
                return AssistantResponse(
                    kind="info",
                    text=f"{hit['label']} is a campus building; no detail record is loaded yet.",
                    tool_calls=calls,
                )
            floors = detail.get("num_floors")
            entrances = len(detail.get("entrances", []))
            rooms = sum(f.get("rooms_count", 0) for f in detail.get("floors", []))
            parts = [f"{hit['label']}"]
            if floors is not None:
                parts.append(f"{floors} floor(s)")
            if entrances:
                parts.append(f"{entrances} entrance(s)")
            if rooms:
                parts.append(f"{rooms} room(s)")
            text = "Here's what I know: " + ", ".join(parts) + "."
            return AssistantResponse(
                kind="info",
                text=text,
                data={"building_detail": detail},
                tool_calls=calls,
            )
        return AssistantResponse(
            kind="search",
            text=f"“{hit['label']}” is a {hit['type']} on campus.",
            data={"results": [hit]},
            tool_calls=calls,
        )

    if intent == "campus_info":
        info = call("get_campus_info", {"campus": campus_slug or ""})
        if "error" in info:
            return AssistantResponse(kind="error", text="No campus data loaded.", tool_calls=calls)
        text = (
            f"{info['name']} — {info['building_count']} buildings, "
            f"{info['node_count']} walkable points, {info['edge_count']} paths."
        )
        return AssistantResponse(kind="info", text=text, data={"campus_info": info}, tool_calls=calls)

    if intent == "categories":
        cats = call("list_categories", {"campus": campus_slug or ""})
        if "error" in cats:
            return AssistantResponse(kind="error", text="No campus data loaded.", tool_calls=calls)
        lines = [f"{c['label']}: {c['count']}" for c in cats.get("categories", [])]
        return AssistantResponse(
            kind="info",
            text="What's on campus:\n" + "\n".join(lines),
            data={"categories": cats.get("categories", [])},
            tool_calls=calls,
        )

    # Unknown intent — fall back to search.
    results = call("search_campus", {"query": query, "campus": campus_slug or "", "limit": 5})
    hits = results.get("results", [])
    if not hits:
        return AssistantResponse(
            kind="info",
            text=f"I couldn't find anything matching “{query}” on campus.",
            tool_calls=calls,
        )
    lines = [f"Found {len(hits)} result(s) for “{query}”:"] + [
        f"• {r['label']} ({r['category']})" for r in hits
    ]
    return AssistantResponse(kind="search", text="\n".join(lines), data={"results": hits}, tool_calls=calls)


def run_tool_import(session: Session, name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Import indirection so `call` stays small (keeps this module tidy)."""
    from app.services.tools import run_tool

    return run_tool(session, name, args)
