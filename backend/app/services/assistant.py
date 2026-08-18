"""Assistant service — rule-based intent engine over the Phase H tool
registry. The regex classifier picks an intent; the dispatcher maps it to
one or more tool calls (with real routing via `calculate_route`); results
are returned as structured `tool_calls` for the frontend cards."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.campus import Building
from app.services.discovery import find_campus
from app.services.navigation import nearest_node
from app.services.tools import (
    run_search_campus,
)

INTENT_PATTERNS = [
    # "Hello Nova" / "Hello Spidy" / "Hey" — full-string greetings only, so
    # "hi, I have a class at 2pm" keeps its class intent.
    (
        re.compile(
            r"^\s*(?:hi|hello|hey|yo|namaste|greetings|good\s+(?:morning|afternoon|evening))\b(?:\s+(?:nova|spidy)\b)?[\s,.!?]*$",
            re.IGNORECASE,
        ),
        "greeting",
    ),
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
    # "from main block to the library" / "route from the hostel to the library"
    (
        re.compile(r"(?:route\s+)?from\s+(.+?)\s+to\s+(.+)", re.IGNORECASE),
        "route_between",
    ),
    # "Find an accessible route to X" / "the fastest route to the library"
    # — destination-only, with the preference as a prefix. Must come BEFORE
    # the bare route_between pattern (which would otherwise split at the
    # first "to"); never steals "Find the library" (no "route to").
    (
        re.compile(
            r"(?:find\s+)?(?:an?\s+|the\s+)?(?:fastest|quickest|shortest|accessible|wheelchair)\s+route\s+to\s+(.+)",
            re.IGNORECASE,
        ),
        "navigate_to",
    ),
    # Bare "main block to library" (no "from") — but never steal queries
    # that already start with a navigation verb or "how".
    (
        re.compile(
            r"^(?!(?:navigate|go|take\s+me|how)\b)(.+?)\s+to\s+(.+)$",
            re.IGNORECASE,
        ),
        "route_between",
    ),
    # "Navigate to CSE Block" / "Navigate me to CSE Block" / "Take me to X"
    # / "Go to the library".
    (
        re.compile(
            r"(?:navigate|go|guide|lead|walk|show\s+me|take\s+me)\s+(?:me\s+)?to\s+(.+)",
            re.IGNORECASE,
        ),
        "navigate_to",
    ),
    # "How do I get to main gate"
    (re.compile(r"how\s+(?:do\s+I|to)\s+get\s+to\s+(.+)", re.IGNORECASE), "navigate_to"),
    # "How far is it from X to Y" (slot 1 = origin, slot 2 = destination)
    (
        re.compile(
            r"how\s+far\s+(?:is|are)\s+it\s+from\s+(.+?)\s+to\s+(.+?)\s*[?.!]*$",
            re.IGNORECASE,
        ),
        "distance_between",
    ),
    # "How far is Boys Hostel from the Main Gate?" (slot 1 = target,
    # optional slot 2 = origin); "how far is the library" works too.
    (
        re.compile(
            r"how\s+far\s+(?:is|are)\s+(.+?)(?:\s+from\s+(.+?))?\s*[?.!]*$",
            re.IGNORECASE,
        ),
        "distance",
    ),
    # "Find the library" / "Where is the auditorium"
    (re.compile(r"(?:find|search|locate)\s+(.+)", re.IGNORECASE), "find"),
    (re.compile(r"where\s+is\s+(.+)", re.IGNORECASE), "find"),
    # Campus-level facts BEFORE the generic "about X" pattern — "Tell me
    # about SRM campus." is a campus question, not a place search. The
    # subject must END on "campus" so "tell me about the campus canteen"
    # still searches the canteen.
    (
        re.compile(
            r"(?:campus\s+info|about\s+the\s+campus|what\s+is\s+(?:this|the)\s+campus|"
            r"tell\s+me\s+about\s+(?:the\s+)?(?:[a-z0-9]+\s+)?campus|"
            r"what\s+about\s+(?:the\s+)?(?:[a-z0-9]+\s+)?campus|"
            r"how\s+many\s+(?:buildings|places|nodes|rooms))\s*(?:are\s+there)?[.!?]*$",
            re.IGNORECASE,
        ),
        "campus_info",
    ),
    # "Info about the library" / "Tell me about the Tech Park"
    (re.compile(r"(?:info|details|about|tell\s+me\s+about)\s+(.+)", re.IGNORECASE), "info_about"),
    # "List categories" / "what's on campus"
    (re.compile(r"(?:categories|what'?s\s+on\s+campus|list\s+places)", re.IGNORECASE), "categories"),
    # Standalone capability questions — full-string anchored so "help me
    # find X" lands on the "find" intent above, never here.
    (
        re.compile(
            r"^\s*(?:what\s+can\s+you\s+(?:do|help\s+me\s+with)|what\s+do\s+you\s+do|"
            r"how\s+do\s+you\s+work|what\s+are\s+(?:your\s+)?(?:features|capabilities)|"
            r"show\s+me\s+(?:your\s+)?(?:features|capabilities)|help)\s*[?.!]*$",
            re.IGNORECASE,
        ),
        "capabilities",
    ),
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


_STRONG_SCORE = 60.0
_AMBIG_GAP = 5.0
_ARTICLE_RE = re.compile(r"^(the|a|an)\s+", re.IGNORECASE)
# Trailing chat filler ("please", "now", "show me") must not become part of
# a route point phrase — "boys hostel please" is not a place name.
_TRAILING_FILLER_RE = re.compile(r"(?:\s+(?:please|now|thanks|thank\s+you|show\s+me|bro|mate|quickly|fast))+\s*$", re.IGNORECASE)
# Route-preference tails ("avoiding stairs", "using the fastest route",
# "the fastest route") are noise on a route point phrase, not place names.
_PREF_TAIL_RE = re.compile(
    r"(?:\s+(?:avoid|avoiding|without)\s+.*|\s+using\s+.*|"
    r"\s+(?:the\s+)?(?:fastest|quickest|shortest|accessible|wheelchair)\s+route\b.*|"
    r"\s+(?:fastest|quickest|shortest|accessible|wheelchair)\s*)$",
    re.IGNORECASE,
)
_FAST_PREF_RE = re.compile(r"\b(?:fastest|quickest|timed|fast)\b", re.IGNORECASE)
_ACCESSIBLE_PREF_RE = re.compile(r"\b(?:accessible|wheelchair)\b", re.IGNORECASE)
_AVOID_STAIRS_PREF_RE = re.compile(
    r"\b(?:avoid|avoiding)\s+stairs\b|\bno\s+stairs\b|\belevator\s+only\b",
    re.IGNORECASE,
)
_EDGE_PUNCT_RE = re.compile(r"^[\s,.!?;:'\"-]+|[\s,.!?;:'\"-]+$")


def _route_prefs(query: str) -> dict[str, Any]:
    """Extract route preferences from natural language: "fastest", "shortest",
    "accessible", "avoiding stairs" — used for the actual routing options."""
    return {
        "mode": "fastest" if _FAST_PREF_RE.search(query) else "shortest",
        "require_accessible": bool(_ACCESSIBLE_PREF_RE.search(query)),
        "avoid_stairs": bool(_AVOID_STAIRS_PREF_RE.search(query)),
    }


def _first_result(
    session: Session, query: str, campus_slug: str | None
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    """Best search hit for a place phrase, plus all strong candidates.

    Leading articles ("the library"), trailing filler ("please") and
    preference tails ("avoiding stairs") are stripped before the search —
    they are noise tokens, not part of the phrase. Entrance nodes that
    mirror a building (same label/code) collapse into that building. Among
    the remaining STRONG matches (relevance >= 60: exact, prefix, or
    whole-phrase substring) a near-tie between two DIFFERENT places reports
    ambiguous (None + candidates) so callers ask the user instead of
    guessing; a clear winner is returned as the destination.
    """
    phrase = _ARTICLE_RE.sub("", query.strip())
    phrase = _TRAILING_FILLER_RE.sub("", phrase)
    phrase = _PREF_TAIL_RE.sub("", phrase)
    phrase = _EDGE_PUNCT_RE.sub("", phrase)
    if not phrase:
        return None, []
    results = run_search_campus(session, {"query": phrase, "campus": campus_slug or "", "limit": 8})
    by_slug: dict[str, dict[str, Any]] = {}
    for r in results.get("results", []):
        if r["type"] not in ("building", "node", "room"):
            continue
        if r.get("score", 0) < _STRONG_SCORE:
            continue
        key = r.get("slug") or r.get("id")
        prev = by_slug.get(key)
        # Same place listed twice (entrance node + building): keep the
        # building — richer details for the frontend cards.
        if prev is None or (r["type"] == "building" and prev["type"] != "building"):
            by_slug[key] = r
    strong = sorted(by_slug.values(), key=lambda r: (-r.get("score", 0.0), r["label"]))
    if not strong:
        return None, []
    # Ambiguity only makes sense WITH a campus context: without one, the
    # same place can legitimately exist on several campuses (e.g. a "main
    # gate" or "library" everywhere) — that is a duplicate, not a choice.
    # Pick the deterministic best instead of asking which campus's library.
    if campus_slug and len(strong) >= 2 and strong[0]["score"] - strong[1]["score"] <= _AMBIG_GAP:
        return None, strong
    return strong[0], strong


def _building_for_node(session: Session, hit: dict[str, Any]) -> dict[str, Any] | None:
    """Resolve an entrance-node hit to its building (by code == node label).

    Node hits carry `slug` = the node label; buildings carry the same code.
    Returns a search-shaped dict or None when no building matches.
    """
    code = hit.get("slug")
    if not code:
        return None
    b = session.execute(
        select(Building).where(func.lower(Building.code) == code.lower())
    ).scalar_one_or_none()
    if b is None or b.centroid is None:
        return None
    pt = re.search(r"POINT\s*\(\s*(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s*\)", b.centroid, re.IGNORECASE)
    if pt is None:
        return None
    return {
        "id": str(b.id),
        "label": b.name,
        "type": "building",
        "category": "building",
        "lat": float(pt.group(2)),
        "lng": float(pt.group(1)),
        "campus_id": str(b.campus_id),
        "campus_slug": b.campus.slug if b.campus else "",
        "campus_name": b.campus.name if b.campus else "",
        "building_id": str(b.id),
        "subtitle": f"{b.num_floors} floor(s)",
        "score": hit.get("score", 0),
        "slug": b.code.lower(),
    }


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

    if intent in ("route_between", "distance", "distance_between"):
        prefs = _route_prefs(query)
        if intent in ("route_between", "distance_between"):
            origin_phrase = slots.get("1", "").strip()
            dest_phrase = slots.get("2", "").strip()
        else:  # "distance": "How far is X from Y?" — slot 1 is the target.
            dest_phrase = slots.get("1", "").strip()
            origin_phrase = slots.get("2", "").strip()
        origin_hit, origin_strong = (
            _first_result(session, origin_phrase, campus_slug) if origin_phrase else (None, [])
        )
        dest, dest_strong = _first_result(session, dest_phrase, campus_slug)

        def ambiguous(phrase: str, candidates: list[dict[str, Any]]) -> AssistantResponse:
            return AssistantResponse(
                kind="search",
                text=f"I found several places matching “{phrase}” — which one did you mean?",
                data={"results": candidates},
                tool_calls=calls,
            )

        if dest is None and dest_strong:
            return ambiguous(dest_phrase, dest_strong)
        if dest is None:
            results = call("search_campus", {"query": query, "campus": campus_slug or "", "limit": 5})
            return AssistantResponse(
                kind="search",
                text=f"I couldn't place “{dest_phrase}” as a route point. Here's what I found for “{query}”:",
                data={"results": results.get("results", [])},
                tool_calls=calls,
            )
        if origin_phrase and origin_hit is None and origin_strong:
            return ambiguous(origin_phrase, origin_strong)
        if origin_phrase and origin_hit is None:
            results = call("search_campus", {"query": query, "campus": campus_slug or "", "limit": 5})
            return AssistantResponse(
                kind="search",
                text=f"I couldn't place “{origin_phrase}” as a route point. Here's what I found for “{query}”:",
                data={"results": results.get("results", [])},
                tool_calls=calls,
            )
        if origin_hit is not None and origin_hit.get("slug") == dest.get("slug"):
            return AssistantResponse(
                kind="info",
                text=f"You picked the same place for both ends — {dest['label']}.",
                tool_calls=calls,
            )
        # No explicit origin. Prefer a live GPS fix snapped to a real graph
        # node (honest, personalized — never fabricates a position). Else
        # assume the campus Main Gate — which only exists on campuses with a
        # surveyed gate node (SRM has one, VIT does not), so the route-error
        # path below explains why when the assumption can't be honored.
        assumed_origin = origin_hit is None
        if origin_hit is not None:
            source = origin_hit.get("slug") or origin_hit.get("id")
            origin_label = origin_hit["label"]
        elif origin is not None:
            source = origin["node_id"]
            shown = origin["label"] if origin["label"] != origin["node_id"] else "your location"
            origin_label = f"{shown} (your location)"
        else:
            source = "main_gate"
            origin_label = "Main Gate"
        route_args: dict[str, Any] = {
            "campus": dest.get("campus_slug") or campus_slug or "",
            "source": source,
            "destination": dest.get("slug") or dest.get("id"),
            "mode": prefs["mode"],
            "require_accessible": prefs["require_accessible"],
            "avoid_stairs": prefs["avoid_stairs"],
        }
        route = call("calculate_route", route_args)
        if "error" in route:
            if assumed_origin and "unknown source" in str(route.get("error", "")):
                return AssistantResponse(
                    kind="search",
                    text=(
                        f"I can't work out where you're starting from — this campus has no "
                        f"Main Gate. Try “route from <a place> to {dest['label']}”, "
                        f"or enable your location and ask again."
                    ),
                    data={"destination": dest},
                    tool_calls=calls,
                )
            return AssistantResponse(
                kind="error",
                text=(
                    f"I found {origin_label} and {dest['label']} but couldn't compute a route"
                    + (f" ({route['error']})." if route.get("error") else ".")
                ),
                data={"destination": dest},
                tool_calls=calls,
            )
        if intent in ("distance", "distance_between"):
            text = (
                f"It's about {route['total_distance_m']} m from {origin_label} to {dest['label']} — "
                f"roughly {route['estimated_walk_time_min']} min on foot."
            )
        else:
            text = (
                f"Here's the {route['mode']} route from {origin_label} to {dest['label']}: "
                f"{route['total_distance_m']} m, about {route['estimated_walk_time_min']} min."
            )
        if route_args["require_accessible"]:
            text += " (accessible route)"
        elif route_args["avoid_stairs"]:
            text += " (avoiding stairs)"
        return AssistantResponse(
            kind="route",
            text=text,
            data={
                "destination": {**dest, "id": dest.get("slug") or dest.get("id")},
                "origin": {
                    "id": source,
                    "label": origin_label,
                    "campus_slug": dest.get("campus_slug") or campus_slug or "",
                },
                "require_accessible": route_args["require_accessible"],
                "avoid_stairs": route_args["avoid_stairs"],
                "mode": route_args["mode"],
                "total_distance_m": route.get("total_distance_m"),
                "estimated_walk_time_min": route.get("estimated_walk_time_min"),
                "step_count": route.get("step_count"),
            },
            tool_calls=calls,
        )

    if intent in ("navigate_to", "class_with_time"):
        phrase = slots.get("1", "").strip()
        dest, dest_strong = _first_result(session, phrase, campus_slug)
        if dest is None and dest_strong:
            return AssistantResponse(
                kind="search",
                text=f"I found several places matching “{phrase}” — which one did you mean?",
                data={"results": dest_strong},
                tool_calls=calls,
            )
        if dest is None:
            results = call("search_campus", {"query": query, "campus": campus_slug or "", "limit": 5})
            return AssistantResponse(
                kind="search",
                text=f"I couldn't find a destination matching “{phrase}”. Here's what I found for “{query}”:",
                data={"results": results.get("results", [])},
                tool_calls=calls,
            )
        prefs = _route_prefs(query)
        route_args: dict[str, Any] = {
            "campus": dest.get("campus_slug") or campus_slug or "",
            # Real source: live location when available, otherwise the
            # campus Main Gate where one exists — the text below says so
            # explicitly. Never fabricates the user's position; campuses
            # without a gate node get an explanatory error instead.
            "source": origin["node_id"] if origin else "main_gate",
            "destination": dest.get("slug") or dest.get("id"),
            "mode": "fastest" if intent == "class_with_time" else prefs["mode"],
            "require_accessible": intent == "class_with_time" or prefs["require_accessible"],
            "avoid_stairs": prefs["avoid_stairs"],
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
            if assumed_origin and "unknown source" in str(route.get("error", "")):
                return AssistantResponse(
                    kind="search",
                    text=(
                        f"I can't work out where you're starting from — this campus has no "
                        f"Main Gate. Try “navigate to {dest['label']}” with your location "
                        f"enabled."
                    ),
                    data={"destination": dest},
                    tool_calls=calls,
                )
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
        if route_args["require_accessible"]:
            text += " (accessible route)"
        elif route_args["avoid_stairs"]:
            text += " (avoiding stairs)"
        return AssistantResponse(
            kind="route",
            text=text,
            data={
                # Node ids for the map: slug = node label for both ends, so
                # the frontend can resolve them against the campus graph.
                "destination": {**dest, "id": dest.get("slug") or dest.get("id")},
                "origin": (
                    {**origin, "id": origin["node_id"]}
                    if origin
                    else {"id": "main_gate", "label": "Main Gate", "campus_slug": dest.get("campus_slug") or campus_slug or ""}
                ),
                "require_accessible": route_args.get("require_accessible", False),
                "avoid_stairs": route_args.get("avoid_stairs", False),
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
            hit, _ = _first_result(session, target, campus_slug)
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
            ref, _ = _first_result(session, target, campus_slug)
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
        hit, strong = _first_result(session, target, campus_slug)
        if hit is None and strong:
            return AssistantResponse(
                kind="search",
                text=f"I found several matches for “{target}” — which one did you mean?",
                data={"results": strong},
                tool_calls=calls,
            )
        if hit is None:
            # No strong match — show the closest real candidates instead of
            # confidently answering for a wrong building.
            weak = call(
                "search_campus",
                {"query": target, "campus": campus_slug or "", "limit": 5},
            )
            near = [
                r for r in weak.get("results", []) if r["type"] in ("building", "node", "room")
            ]
            if near:
                return AssistantResponse(
                    kind="search",
                    text=f"I couldn't find exactly “{target}” on campus — closest matches:",
                    data={"results": near},
                    tool_calls=calls,
                )
            return AssistantResponse(
                kind="info",
                text=f"I couldn't find “{target}” on campus.",
                tool_calls=calls,
            )
        if hit["type"] == "building" or (
            hit["type"] == "node" and hit.get("category") == "entrance"
        ):
            if hit["type"] == "node":
                resolved = _building_for_node(session, hit)
                if resolved is not None:
                    hit = resolved
            if hit["type"] != "building":
                return AssistantResponse(
                    kind="search",
                    text=f"“{hit['label']}” is a {hit['category'] or 'point'} on campus.",
                    data={"results": [hit]},
                    tool_calls=calls,
                )
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

    if intent == "greeting":
        return AssistantResponse(
            kind="info",
            text=(
                "Hello! I'm SPIDY, your campus navigation guide. Try “Take me to the library”, "
                "“Find the fastest route from the Main Gate to the Tech Park avoiding stairs”, "
                "or “What can you help me with?”"
            ),
            tool_calls=calls,
        )

    if intent == "capabilities":
        return AssistantResponse(
            kind="info",
            text=(
                "I can help you get around campus:\n"
                "• Route anywhere — “Take me to the library” or “route from the Main Gate to the Tech Park”\n"
                "• Distances — “How far is Boys Hostel from the Main Gate?”\n"
                "• Find places — “Where is the library?”\n"
                "• Route preferences — fastest, accessible, or avoiding stairs\n"
                "• Campus facts — “Tell me about SRM campus.”"
            ),
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
