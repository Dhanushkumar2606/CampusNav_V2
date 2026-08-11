"""A* shortest-path router over a (lat, lng) campus graph.

Public surface:

    result = find_route(graph, source_id, destination_id, options)
    # raises RouteError subclasses (UnknownNode, NoPath, SourceEqualsDest)

The graph is passed in as plain dataclasses — the router is decoupled from
SQLAlchemy. The HTTP layer (`app/services/navigation.py`) builds the graph
from the DB and calls this module.
"""
from __future__ import annotations

import heapq
import math
from collections.abc import Iterable
from dataclasses import dataclass, field
from enum import Enum
from typing import Hashable, Protocol


class HeuristicKind(str, Enum):
    """Heuristic used for the priority queue ordering."""

    HAVERSINE = "haversine"   # geographic distance — admissible for walking
    EUCLIDEAN = "euclidean"   # 2D Euclidean — admissible for flat approximations
    ZERO = "zero"             # Dijkstra — exact, no heuristic pruning


# ---------------------------------------------------------------------------
# Domain types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class NavNode:
    id: Hashable
    lat: float
    lng: float
    type: str = "node"
    building_id: Hashable | None = None
    floor_id: Hashable | None = None
    metadata: dict = field(default_factory=dict)


@dataclass(frozen=True)
class NavEdge:
    id: Hashable
    from_id: Hashable
    to_id: Hashable
    distance: float
    estimated: bool = True
    accessible: bool = True
    type: str = "walk"
    walk_time_min: float | None = None
    has_stairs: bool = False
    is_restricted: bool = False
    is_indoor: bool = False
    is_outdoor: bool = True
    surface_type: str | None = None
    slope: float | None = None


class RouteMode(str, Enum):
    """What A* optimizes for.

    SHORTEST — minimize distance walked (meters).
    FASTEST — minimize estimated walking time (minutes; falls back to
    distance / 1.4 m/s when an edge has no walk_time_min).
    """

    SHORTEST = "shortest"
    FASTEST = "fastest"


@dataclass(frozen=True)
class RouteOptions:
    require_accessible: bool = False
    prefer_estimated: bool | None = None  # None = no preference
    heuristic: HeuristicKind = HeuristicKind.HAVERSINE
    mode: RouteMode = RouteMode.SHORTEST
    # Penalize (never exclude) edges with stairs so the router picks
    # gentle alternatives when they exist.
    avoid_stairs: bool = False
    # Edges to penalize (e.g. previously-found alternative routes).
    # Multiplied by `penalty_factor` in the cost function.
    penalized_edge_ids: frozenset[Hashable] = frozenset()
    penalty_factor: float = 1.6


@dataclass(frozen=True)
class RouteStep:
    """One step in the route — the edge walked to reach a node."""

    from_node_id: Hashable
    to_node_id: Hashable
    edge_id: Hashable
    distance_m: float
    estimated: bool
    walk_time_min: float | None
    instruction: str | None = None


@dataclass(frozen=True)
class Route:
    source: Hashable
    destination: Hashable
    steps: list[RouteStep]
    total_distance_m: float
    estimated_walk_time_min: float
    all_estimated: bool
    summary: str | None = None

    @property
    def step_count(self) -> int:
        return len(self.steps)


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class RouteError(Exception):
    """Base class for routing errors. Carries a code for the API layer."""


class UnknownNode(RouteError):
    code = "unknown_node"


class SourceEqualsDest(RouteError):
    code = "source_equals_destination"


class NoPath(RouteError):
    code = "no_path"


class InvalidGraph(RouteError):
    code = "invalid_graph"


# ---------------------------------------------------------------------------
# Graph container
# ---------------------------------------------------------------------------


class Graph(Protocol):
    """Anything that exposes nodes/edges keyed by id is a graph."""

    def nodes(self) -> Iterable[NavNode]: ...
    def edges(self) -> Iterable[NavEdge]: ...
    def node(self, node_id: Hashable) -> NavNode | None: ...
    def neighbors(self, node_id: Hashable) -> list[NavEdge]: ...


@dataclass
class InMemoryGraph:
    """Concrete Graph used in tests and the HTTP layer."""

    _nodes: dict[Hashable, NavNode] = field(default_factory=dict)
    _edges: list[NavEdge] = field(default_factory=list)
    _adj: dict[Hashable, list[NavEdge]] = field(default_factory=dict)

    @classmethod
    def build(cls, nodes: Iterable[NavNode], edges: Iterable[NavEdge]) -> "InMemoryGraph":
        g = cls()
        for n in nodes:
            g._nodes[n.id] = n
            g._adj.setdefault(n.id, [])
        for e in edges:
            g._edges.append(e)
            g._adj.setdefault(e.from_id, []).append(e)
            # Treat all edges as bidirectional for routing — the loader stores
            # them canonicalized (min, max) and the A* walks both directions.
            g._adj.setdefault(e.to_id, []).append(
                NavEdge(
                    id=e.id,
                    from_id=e.to_id,
                    to_id=e.from_id,
                    distance=e.distance,
                    estimated=e.estimated,
                    accessible=e.accessible,
                    type=e.type,
                    walk_time_min=e.walk_time_min,
                    has_stairs=e.has_stairs,
                    is_restricted=e.is_restricted,
                    is_indoor=e.is_indoor,
                    is_outdoor=e.is_outdoor,
                    surface_type=e.surface_type,
                    slope=e.slope,
                )
            )
        return g

    def nodes(self) -> Iterable[NavNode]:
        return self._nodes.values()

    def edges(self) -> Iterable[NavEdge]:
        return self._edges

    def node(self, node_id: Hashable) -> NavNode | None:
        return self._nodes.get(node_id)

    def neighbors(self, node_id: Hashable) -> list[NavEdge]:
        return self._adj.get(node_id, [])


# ---------------------------------------------------------------------------
# Heuristics
# ---------------------------------------------------------------------------


_EARTH_RADIUS_M = 6_371_000.0


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in meters. Admissible for walking routing."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * _EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))


def _euclidean_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Treats lat/lng as flat coordinates. Inadmissible for long distances."""
    # ~111_111 m per degree of latitude. Longitude scaling depends on latitude
    # but at campus scale the error is small.
    dx = (lng2 - lng1) * 111_111 * math.cos(math.radians((lat1 + lat2) / 2))
    dy = (lat2 - lat1) * 111_111
    return math.sqrt(dx * dx + dy * dy)


def _heuristic(
    kind: HeuristicKind,
    src: NavNode,
    dst: NavNode,
) -> float:
    if kind == HeuristicKind.HAVERSINE:
        return _haversine_m(src.lat, src.lng, dst.lat, dst.lng)
    if kind == HeuristicKind.EUCLIDEAN:
        return _euclidean_m(src.lat, src.lng, dst.lat, dst.lng)
    if kind == HeuristicKind.ZERO:
        return 0.0
    raise InvalidGraph(f"Unknown heuristic: {kind}")


# ---------------------------------------------------------------------------
# Costs + heuristics
# ---------------------------------------------------------------------------

_WALK_SPEED_M_PER_MIN = 1.4 * 60  # 1.4 m/s fallback walking speed


def _edge_cost(edge: NavEdge, opts: RouteOptions) -> float:
    """Cost of traversing an edge under the route options.

    Units follow `mode`: meters for SHORTEST, minutes for FASTEST.
    `avoid_stairs` multiplies (never excludes) stairs edges; penalized
    edge ids (alternative-route bookkeeping) are scaled up as well.
    """
    if opts.mode == RouteMode.FASTEST:
        cost = edge.walk_time_min if edge.walk_time_min is not None else edge.distance / _WALK_SPEED_M_PER_MIN
    else:
        cost = edge.distance
    if opts.avoid_stairs and edge.has_stairs:
        cost *= 10.0
    if opts.penalized_edge_ids and edge.id in opts.penalized_edge_ids:
        cost *= opts.penalty_factor
    return cost


def _heuristic_cost(kind: HeuristicKind, src: NavNode, dst: NavNode, opts: RouteOptions) -> float:
    """Admissible heuristic in the same units as the g-score."""
    h = _heuristic(kind, src, dst)
    if opts.mode == RouteMode.FASTEST:
        return h / _WALK_SPEED_M_PER_MIN
    return h


def _allowed(edge: NavEdge, opts: RouteOptions) -> bool:
    """Edge eligibility filter."""
    if opts.require_accessible and (not edge.accessible or edge.is_restricted):
        return False
    return True


def find_route(
    graph: Graph,
    source_id: Hashable,
    destination_id: Hashable,
    options: RouteOptions | None = None,
) -> Route:
    """Compute the shortest (or fastest) path from source to destination.

    Raises:
        SourceEqualsDest: if source_id == destination_id.
        UnknownNode: if either id is not in the graph.
        NoPath: if no route exists under the given options.
    """
    opts = options or RouteOptions()

    src = graph.node(source_id)
    dst = graph.node(destination_id)
    if src is None or dst is None:
        unknown = source_id if src is None else destination_id
        raise UnknownNode(f"Node not in graph: {unknown}")
    if source_id == destination_id:
        raise SourceEqualsDest(f"source and destination are the same: {source_id}")

    g_score: dict[Hashable, float] = {source_id: 0.0}
    came_from: dict[Hashable, tuple[Hashable, NavEdge]] = {}
    closed: set[Hashable] = set()
    counter = 0  # heap tiebreaker so equal-f entries come out FIFO
    open_heap: list[tuple[float, int, Hashable]] = []
    heapq.heappush(open_heap, (0.0, counter, source_id))

    while open_heap:
        _, _, current = heapq.heappop(open_heap)
        if current in closed:
            continue
        if current == destination_id:
            return _reconstruct(graph, source_id, destination_id, came_from, g_score, opts)
        closed.add(current)
        current_node = graph.node(current)
        if current_node is None:
            continue

        for edge in graph.neighbors(current):
            if not _allowed(edge, opts):
                continue
            tentative = g_score[current] + _edge_cost(edge, opts)
            prev = g_score.get(edge.to_id)
            if prev is None or tentative < prev:
                g_score[edge.to_id] = tentative
                came_from[edge.to_id] = (current, edge)
                counter += 1
                f = tentative + _heuristic_cost(opts.heuristic, current_node, dst, opts)
                heapq.heappush(open_heap, (f, counter, edge.to_id))

    raise NoPath(f"No path from {source_id} to {destination_id}")


def find_alternatives(
    graph: Graph,
    source_id: Hashable,
    destination_id: Hashable,
    count: int,
    options: RouteOptions | None = None,
) -> list[Route]:
    """Best-effort alternative routes via iterated edge penalization.

    The primary (unpenalized) route is computed once and its edges are
    penalized; each subsequent run adds the previous route's edges to the
    penalty set, forcing the router onto a different (usually longer)
    corridor. Returns at most `count` routes that are DISTINCT from the
    primary and from each other (deduped by edge set); fewer if the graph
    is exhausted (NoPath is swallowed).
    """
    if count <= 0:
        return []
    opts = options or RouteOptions()

    try:
        primary = find_route(graph, source_id, destination_id, opts)
    except RouteError:
        return []

    penalized: set[Hashable] = set(s.edge_id for s in primary.steps)
    results: list[Route] = []
    # The primary route's edge set is not an alternative — never return it.
    seen: set[frozenset[Hashable]] = {frozenset(s.edge_id for s in primary.steps)}

    for _ in range(count):
        run_opts = RouteOptions(
            require_accessible=opts.require_accessible,
            heuristic=opts.heuristic,
            mode=opts.mode,
            avoid_stairs=opts.avoid_stairs,
            penalized_edge_ids=frozenset(penalized),
            penalty_factor=opts.penalty_factor,
        )
        try:
            route = find_route(graph, source_id, destination_id, run_opts)
        except RouteError:
            break
        edge_ids = frozenset(s.edge_id for s in route.steps)
        if edge_ids in seen:
            break
        seen.add(edge_ids)
        results.append(route)
        penalized |= edge_ids

    return results


def _reconstruct(
    graph: Graph,
    source_id: Hashable,
    destination_id: Hashable,
    came_from: dict[Hashable, tuple[Hashable, NavEdge]],
    g_score: dict[Hashable, float],
    opts: RouteOptions,
) -> Route:
    # Walk back from destination to source via came_from.
    steps: list[RouteStep] = []
    cur = destination_id
    while cur != source_id:
        prev, edge = came_from[cur]
        target = graph.node(cur)
        label = target.metadata.get("label") if target is not None else None
        instruction = _step_instruction(edge, target, label, cur == destination_id)
        steps.append(
            RouteStep(
                from_node_id=prev,
                to_node_id=cur,
                edge_id=edge.id,
                distance_m=edge.distance,
                estimated=edge.estimated,
                walk_time_min=edge.walk_time_min,
                instruction=instruction,
            )
        )
        cur = prev
    steps.reverse()

    # Sum real edge distances (never the g-score — it's in minutes in
    # FASTEST mode, meters in SHORTEST mode).
    total_distance = sum(s.distance_m for s in steps)
    # Sum walk_time_min across edges that have it; fall back to distance / 1.4 m/s.
    walk_times = [s.walk_time_min for s in steps if s.walk_time_min is not None]
    if walk_times:
        walk_time = sum(walk_times)
    else:
        walk_time = total_distance / (1.4 * 60)  # meters / (m/s) / 60s
    all_estimated = all(s.estimated for s in steps)
    summary = _route_summary(total_distance, walk_time, steps)

    return Route(
        source=source_id,
        destination=destination_id,
        steps=steps,
        total_distance_m=total_distance,
        estimated_walk_time_min=walk_time,
        all_estimated=all_estimated,
        summary=summary,
    )


def _step_instruction(edge: NavEdge, target: NavNode | None, label: str | None, is_arrival: bool) -> str:
    """Human-friendly step text built from real geometry data only.

    Distance is always shown; the target label appears only when the
    graph actually has one (never invented). Stairs/restrictions are
    surfaced so walkers know what the edge is.
    """
    d = f"{edge.distance:.0f} m"
    prefix = "Arrive at" if is_arrival else "Walk toward"
    if label:
        text = f"{prefix} {label} · {d}"
    else:
        text = f"Walk {d}"
    if edge.has_stairs:
        text += " (stairs)"
    if edge.is_restricted:
        text += " (restricted)"
    return text


def _route_summary(total_distance_m: float, walk_time_min: float, steps: list[RouteStep]) -> str:
    """e.g. '263 m · 3 min walk · 2 steps' — exact values from the route."""
    d = f"{total_distance_m:.0f} m"
    t = f"{walk_time_min:.0f} min" if walk_time_min >= 1 else "under 1 min"
    return f"{d} · {t} walk · {len(steps)} step{'s' if len(steps) != 1 else ''}"