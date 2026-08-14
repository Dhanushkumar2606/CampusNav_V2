"""Tests for Phase 3 routing options: modes, stairs penalty, alternatives,
instructions, and the accessibility honesty model."""

from __future__ import annotations

import pytest

from app.routing.astar import (
    HeuristicKind,
    InMemoryGraph,
    NavEdge,
    NavNode,
    NoAccessiblePath,
    NoPath,
    RouteMode,
    RouteOptions,
    find_alternatives,
    find_route,
)


def _graph_with_stairs() -> InMemoryGraph:
    """A --B-- C (flat, 100m) versus A --D-- C (ramp, 60m each, no stairs)."""
    nodes = [
        NavNode(id="A", lat=0.0, lng=0.0, metadata={"label": "main_gate"}),
        NavNode(id="B", lat=0.0, lng=0.001, metadata={"label": "block_b"}),
        NavNode(id="C", lat=0.0, lng=0.002, metadata={"label": "library"}),
        NavNode(id="D", lat=0.0005, lng=0.001, metadata={"label": "plaza"}),
    ]
    edges = [
        NavEdge(id="ab", from_id="A", to_id="B", distance=100.0, has_stairs=True),
        NavEdge(id="bc", from_id="B", to_id="C", distance=100.0, has_stairs=True),
        NavEdge(id="ad", from_id="A", to_id="D", distance=120.0, has_stairs=False),
        NavEdge(id="dc", from_id="D", to_id="C", distance=120.0, has_stairs=False),
    ]
    return InMemoryGraph.build(nodes, edges)


def test_default_mode_ignores_stairs() -> None:
    g = _graph_with_stairs()
    route = find_route(g, "A", "C")
    # 100+100=200m beats 120+120=240m, even though it uses stairs.
    assert route.total_distance_m == pytest.approx(200.0)


def test_avoid_stairs_penalizes_not_excludes() -> None:
    g = _graph_with_stairs()
    route = find_route(g, "A", "C", RouteOptions(avoid_stairs=True))
    # Penalized stairs make the flat path (240m) cheaper in cost terms.
    assert route.total_distance_m == pytest.approx(240.0)
    # And it still connects — the penalty never removes the option entirely.
    assert route.step_count == 2


def test_require_accessible_skips_restricted_edges() -> None:
    nodes = [
        NavNode(id="A", lat=0.0, lng=0.0),
        NavNode(id="B", lat=0.0, lng=0.001),
    ]
    edges = [NavEdge(id="ab", from_id="A", to_id="B", distance=10.0, is_restricted=True)]
    g = InMemoryGraph.build(nodes, edges)

    with pytest.raises(NoAccessiblePath):
        find_route(g, "A", "B", RouteOptions(require_accessible=True))
    # Unrestricted mode still uses it.
    assert find_route(g, "A", "B").total_distance_m == pytest.approx(10.0)


def test_fastest_mode_uses_walk_time() -> None:
    nodes = [
        NavNode(id="A", lat=0.0, lng=0.0),
        NavNode(id="B", lat=0.0, lng=0.001),
        NavNode(id="C", lat=0.0, lng=0.002),
    ]
    edges = [
        # Direct but slow-walking long edge (10 min for 500m).
        NavEdge(id="ac", from_id="A", to_id="C", distance=500.0, walk_time_min=10.0),
        # Via B: 200m total, 2 minutes.
        NavEdge(id="ab", from_id="A", to_id="B", distance=100.0, walk_time_min=1.0),
        NavEdge(id="bc", from_id="B", to_id="C", distance=100.0, walk_time_min=1.0),
    ]
    g = InMemoryGraph.build(nodes, edges)

    fastest = find_route(g, "A", "C", RouteOptions(mode=RouteMode.FASTEST))
    assert fastest.estimated_walk_time_min == pytest.approx(2.0)
    assert fastest.step_count == 2  # went via B, not the direct edge

    shortest = find_route(g, "A", "C", RouteOptions(mode=RouteMode.SHORTEST))
    assert shortest.total_distance_m == pytest.approx(200.0)


def test_fastest_falls_back_to_speed_when_times_missing() -> None:
    nodes = [
        NavNode(id="A", lat=0.0, lng=0.0),
        NavNode(id="B", lat=0.0, lng=0.001),
    ]
    edges = [NavEdge(id="ab", from_id="A", to_id="B", distance=140.0)]  # no walk_time
    g = InMemoryGraph.build(nodes, edges)
    route = find_route(g, "A", "B", RouteOptions(mode=RouteMode.FASTEST))
    # 140 m / 84 m-per-min ≈ 1.667 min
    assert route.estimated_walk_time_min == pytest.approx(140.0 / 84.0, rel=1e-6)


def test_alternatives_returns_distinct_routes() -> None:
    g = _graph_with_stairs()
    primary = find_route(g, "A", "C")
    alternatives = find_alternatives(g, "A", "C", count=2)
    # Exactly one distinct alternative exists; it must differ from primary.
    assert len(alternatives) == 1
    alt = alternatives[0]
    assert {s.edge_id for s in primary.steps} != {s.edge_id for s in alt.steps}
    # The alternative is strictly longer (240m vs 200m).
    assert primary.total_distance_m == pytest.approx(200.0)
    assert alt.total_distance_m == pytest.approx(240.0)


def test_alternatives_never_exceeds_graph_capacity() -> None:
    nodes = [
        NavNode(id="A", lat=0.0, lng=0.0),
        NavNode(id="B", lat=0.0, lng=0.001),
    ]
    edges = [NavEdge(id="ab", from_id="A", to_id="B", distance=10.0)]
    g = InMemoryGraph.build(nodes, edges)
    # Only one path exists — no distinct alternative, even when asked for 3.
    assert find_alternatives(g, "A", "B", count=3) == []


def test_alternatives_honor_accessible_filter() -> None:
    nodes = [
        NavNode(id="A", lat=0.0, lng=0.0),
        NavNode(id="B", lat=0.0, lng=0.001),
        NavNode(id="C", lat=0.0, lng=0.002),
    ]
    edges = [
        NavEdge(id="ab", from_id="A", to_id="B", distance=10.0, accessible=False),
        NavEdge(id="bc", from_id="B", to_id="C", distance=10.0),
    ]
    g = InMemoryGraph.build(nodes, edges)
    opts = RouteOptions(require_accessible=True)
    with pytest.raises(NoAccessiblePath):
        find_route(g, "A", "C", opts)
    assert find_alternatives(g, "A", "C", count=2, options=opts) == []


def test_instructions_use_real_labels() -> None:
    g = _graph_with_stairs()
    route = find_route(g, "A", "C", RouteOptions(avoid_stairs=True))
    texts = [s.instruction for s in route.steps]
    assert texts[0] is not None and "plaza" in texts[0]
    assert texts[1] is not None and texts[1].startswith("Arrive at library")
    # Distances are real edge values.
    assert "120 m" in texts[0]


def test_instructions_surface_stairs_honestly() -> None:
    g = _graph_with_stairs()
    route = find_route(g, "A", "C")  # default uses the stairs path
    assert any("(stairs)" in (s.instruction or "") for s in route.steps)


def test_summary_is_present_and_human_readable() -> None:
    g = _graph_with_stairs()
    route = find_route(g, "A", "C")
    assert route.summary is not None
    assert "200 m" in route.summary
    assert "walk" in route.summary


def test_haversine_still_valid_for_fastest_mode() -> None:
    g = _graph_with_stairs()
    route = find_route(
        g, "A", "C", RouteOptions(mode=RouteMode.FASTEST, heuristic=HeuristicKind.HAVERSINE)
    )
    assert route.step_count == 2
