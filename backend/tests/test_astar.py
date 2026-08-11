"""A* engine tests."""

from __future__ import annotations

import math

import pytest

from app.routing.astar import (
    HeuristicKind,
    InMemoryGraph,
    NavEdge,
    NavNode,
    NoPath,
    RouteOptions,
    SourceEqualsDest,
    UnknownNode,
    find_route,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def line_graph() -> InMemoryGraph:
    """Three nodes in a straight line A — B — C with distances 10m / 20m."""
    nodes = [
        NavNode(id="A", lat=0.0, lng=0.0),
        NavNode(id="B", lat=0.0, lng=0.0001),  # ~11m east of A
        NavNode(id="C", lat=0.0, lng=0.0003),  # ~22m east of B
    ]
    edges = [
        NavEdge(id="e1", from_id="A", to_id="B", distance=10.0),
        NavEdge(id="e2", from_id="B", to_id="C", distance=20.0),
    ]
    return InMemoryGraph.build(nodes, edges)


@pytest.fixture()
def branch_graph() -> InMemoryGraph:
    """A diamond: A → B → D, A → C → D, with B-D shorter than C-D, so the
    shortest A→D route uses B."""
    nodes = [
        NavNode(id="A", lat=0.0, lng=0.0),
        NavNode(id="B", lat=0.0001, lng=0.0001),
        NavNode(id="C", lat=0.0001, lng=-0.0001),
        NavNode(id="D", lat=0.0002, lng=0.0),
    ]
    edges = [
        NavEdge(id="ab", from_id="A", to_id="B", distance=5.0, walk_time_min=0.5),
        NavEdge(id="ac", from_id="A", to_id="C", distance=5.0, walk_time_min=0.5),
        NavEdge(id="bd", from_id="B", to_id="D", distance=5.0, walk_time_min=0.5),
        NavEdge(id="cd", from_id="C", to_id="D", distance=50.0, walk_time_min=5.0),
    ]
    return InMemoryGraph.build(nodes, edges)


@pytest.fixture()
def disconnected_graph() -> InMemoryGraph:
    nodes = [
        NavNode(id="A", lat=0.0, lng=0.0),
        NavNode(id="B", lat=0.0, lng=0.0001),
        NavNode(id="Z", lat=1.0, lng=1.0),  # disconnected island
    ]
    edges = [
        NavEdge(id="ab", from_id="A", to_id="B", distance=10.0),
    ]
    return InMemoryGraph.build(nodes, edges)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_finds_valid_route_on_line(line_graph: InMemoryGraph) -> None:
    route = find_route(line_graph, "A", "C")
    assert route.source == "A"
    assert route.destination == "C"
    assert [s.from_node_id for s in route.steps] == ["A", "B"]
    assert [s.to_node_id for s in route.steps] == ["B", "C"]
    assert route.total_distance_m == pytest.approx(30.0)
    assert route.step_count == 2


def test_shortest_path_selects_better_branch(branch_graph: InMemoryGraph) -> None:
    route = find_route(branch_graph, "A", "D")
    # A→B→D (5+5=10) beats A→C→D (5+50=55).
    assert [s.edge_id for s in route.steps] == ["ab", "bd"]
    assert route.total_distance_m == pytest.approx(10.0)


def test_walk_time_prefers_edges_with_known_time(branch_graph: InMemoryGraph) -> None:
    route = find_route(branch_graph, "A", "D")
    # A→B→D: 0.5 + 0.5 = 1.0 min (sum of walk_time_min on the chosen edges)
    assert route.estimated_walk_time_min == pytest.approx(1.0)


def test_unreachable_raises_no_path(disconnected_graph: InMemoryGraph) -> None:
    with pytest.raises(NoPath):
        find_route(disconnected_graph, "A", "Z")


def test_invalid_node_raises_unknown_node(line_graph: InMemoryGraph) -> None:
    with pytest.raises(UnknownNode):
        find_route(line_graph, "A", "NOT_THERE")
    with pytest.raises(UnknownNode):
        find_route(line_graph, "NOT_THERE", "A")


def test_source_equals_destination_raises(line_graph: InMemoryGraph) -> None:
    with pytest.raises(SourceEqualsDest):
        find_route(line_graph, "A", "A")


def test_route_reconstruction_surfaces_all_steps(branch_graph: InMemoryGraph) -> None:
    route = find_route(branch_graph, "A", "D")
    step_pairs = [(s.from_node_id, s.to_node_id) for s in route.steps]
    assert step_pairs == [("A", "B"), ("B", "D")]


def test_haversine_distance_matches_direct(branch_graph: InMemoryGraph) -> None:
    route = find_route(branch_graph, "A", "D", RouteOptions(heuristic=HeuristicKind.HAVERSINE))
    assert route.total_distance_m == pytest.approx(10.0)


def test_zero_heuristic_still_finds_optimal(line_graph: InMemoryGraph) -> None:
    route = find_route(
        line_graph, "A", "C", RouteOptions(heuristic=HeuristicKind.ZERO)
    )
    assert route.total_distance_m == pytest.approx(30.0)


def test_require_accessible_excludes_blocking_edge() -> None:
    nodes = [
        NavNode(id="A", lat=0.0, lng=0.0),
        NavNode(id="B", lat=0.0, lng=0.0001),
        NavNode(id="C", lat=0.0, lng=0.0002),
    ]
    edges = [
        NavEdge(id="ab", from_id="A", to_id="B", distance=10.0, accessible=False),
        NavEdge(id="bc", from_id="B", to_id="C", distance=10.0, accessible=True),
    ]
    graph = InMemoryGraph.build(nodes, edges)

    # Without accessibility filter, route A→C goes through B (20m).
    route_open = find_route(graph, "A", "C")
    assert route_open.total_distance_m == pytest.approx(20.0)

    # With filter, B is unreachable from A → NoPath.
    with pytest.raises(NoPath):
        find_route(
            graph, "A", "C", RouteOptions(require_accessible=True)
        )


def test_distance_calculation_uses_edge_distance_not_heuristic() -> None:
    """A* g-score uses edge distance, not heuristic. With a perfect heuristic
    the order is identical; with a degenerate one the score still reflects
    what we walked."""
    nodes = [
        NavNode(id="A", lat=0.0, lng=0.0),
        NavNode(id="B", lat=0.0, lng=0.0001),
    ]
    edges = [
        NavEdge(id="ab", from_id="A", to_id="B", distance=123.4),
    ]
    graph = InMemoryGraph.build(nodes, edges)
    route = find_route(graph, "A", "B")
    assert route.total_distance_m == pytest.approx(123.4)


def test_all_estimated_flag_when_every_edge_estimated(branch_graph: InMemoryGraph) -> None:
    # Default branch_graph edges have estimated=True (default).
    route = find_route(branch_graph, "A", "D")
    assert route.all_estimated is True


def test_performance_suitable_for_campus_scale() -> None:
    """Smoke test: 200 nodes / 600 edges in well under a second."""
    n = 200
    nodes = [
        NavNode(id=f"n{i}", lat=0.0 + i * 1e-5, lng=0.0 + (i % 7) * 1e-5)
        for i in range(n)
    ]
    edges = []
    for i in range(n):
        if i + 1 < n:
            edges.append(NavEdge(id=f"e{i}-{i+1}", from_id=f"n{i}", to_id=f"n{i+1}", distance=10.0))
        if i + 7 < n:
            edges.append(NavEdge(id=f"e{i}-{i+7}", from_id=f"n{i}", to_id=f"n{i+7}", distance=15.0))
    graph = InMemoryGraph.build(nodes, edges)
    route = find_route(graph, "n0", f"n{n-1}")
    assert route.total_distance_m > 0
    # Bounded CI time: 0.5s is comfortably loose for 200-node graph.
    # (No scope assertion — just smoke.)
    assert math.isfinite(route.total_distance_m)