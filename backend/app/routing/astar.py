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


@dataclass(frozen=True)
class RouteOptions:
    require_accessible: bool = False
    prefer_estimated: bool | None = None  # None = no preference
    heuristic: HeuristicKind = HeuristicKind.HAVERSINE


@dataclass(frozen=True)
class RouteStep:
    """One step in the route — the edge walked to reach a node."""

    from_node_id: Hashable
    to_node_id: Hashable
    edge_id: Hashable
    distance_m: float
    estimated: bool
    walk_time_min: float | None


@dataclass(frozen=True)
class Route:
    source: Hashable
    destination: Hashable
    steps: list[RouteStep]
    total_distance_m: float
    estimated_walk_time_min: float
    all_estimated: bool

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
# A* implementation
# ---------------------------------------------------------------------------


def find_route(
    graph: Graph,
    source_id: Hashable,
    destination_id: Hashable,
    options: RouteOptions | None = None,
) -> Route:
    """Compute the shortest path from source to destination.

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
            return _reconstruct(graph, source_id, destination_id, came_from, g_score)
        closed.add(current)
        current_node = graph.node(current)
        if current_node is None:
            continue

        for edge in graph.neighbors(current):
            if opts.require_accessible and not edge.accessible:
                continue
            tentative = g_score[current] + edge.distance
            prev = g_score.get(edge.to_id)
            if prev is None or tentative < prev:
                g_score[edge.to_id] = tentative
                came_from[edge.to_id] = (current, edge)
                counter += 1
                f = tentative + _heuristic(opts.heuristic, current_node, dst)
                heapq.heappush(open_heap, (f, counter, edge.to_id))

    raise NoPath(f"No path from {source_id} to {destination_id}")


def _reconstruct(
    graph: Graph,
    source_id: Hashable,
    destination_id: Hashable,
    came_from: dict[Hashable, tuple[Hashable, NavEdge]],
    g_score: dict[Hashable, float],
) -> Route:
    # Walk back from destination to source via came_from.
    steps: list[RouteStep] = []
    cur = destination_id
    while cur != source_id:
        prev, edge = came_from[cur]
        steps.append(
            RouteStep(
                from_node_id=prev,
                to_node_id=cur,
                edge_id=edge.id,
                distance_m=edge.distance,
                estimated=edge.estimated,
                walk_time_min=edge.walk_time_min,
            )
        )
        cur = prev
    steps.reverse()

    total_distance = g_score[destination_id]
    # Sum walk_time_min across edges that have it; fall back to distance / 1.4 m/s.
    walk_times = [s.walk_time_min for s in steps if s.walk_time_min is not None]
    if walk_times:
        walk_time = sum(walk_times)
    else:
        walk_time = total_distance / (1.4 * 60)  # meters / (m/s) / 60s
    all_estimated = all(s.estimated for s in steps)

    return Route(
        source=source_id,
        destination=destination_id,
        steps=steps,
        total_distance_m=total_distance,
        estimated_walk_time_min=walk_time,
        all_estimated=all_estimated,
    )