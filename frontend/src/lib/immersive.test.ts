/**
 * Immersive layer: scene resolution + per-scene landing orientation.
 */
import { describe, expect, it } from "vitest";

import { campusImmersiveBlocks, nodeImmersive, routeImmersiveViewpoints } from "@/lib/immersive";
import type { GraphPayload, PathNode, Route } from "@/lib/navigation-types";

function node(overrides: Partial<PathNode> = {}): PathNode {
  return {
    id: "library",
    label: "Library",
    type: "landmark",
    lat: 12.84,
    lng: 80.15,
    building_id: null,
    metadata: {},
    ...overrides,
  };
}

const graph: GraphPayload = {
  campus: {
    id: "c1",
    name: "Test Campus",
    slug: "test-campus",
    description: null,
    featured: false,
    center_lat: null,
    center_lng: null,
    immersive: {
      provider: "srm-cube",
      url: null,
      label: "SRM 360°",
      available: true,
    },
  },
  nodes: [
    node({
      metadata: {
        immersive: { provider: "srm-cube", label: "Central Library", mediaId: "M1" },
      },
    }),
  ],
  edges: [],
  labels: { Library: "library" },
};

describe("nodeImmersive", () => {
  it("returns null when the node carries no immersive scene", () => {
    expect(nodeImmersive(node())).toBeNull();
  });

  it("return null when the scene has neither url nor mediaId", () => {
    const n = node({ metadata: { immersive: { provider: "srm-cube", label: "x" } } });
    expect(nodeImmersive(n)).toBeNull();
  });

  it("resolves a tiles scene with its mediaId", () => {
    const n = node({
      metadata: {
        immersive: { provider: "srm-cube", label: "Central Library", mediaId: "M1" },
      },
    });
    const scene = nodeImmersive(n);
    expect(scene?.mediaId).toBe("M1");
    expect(scene?.provider).toBe("srm-cube");
    expect(scene?.available).toBe(true);
  });

  it("flows through the per-scene landing orientation", () => {
    const n = node({
      metadata: {
        immersive: {
          provider: "srm-cube",
          label: "Central Library",
          mediaId: "M1",
          initialHeading: 135,
          initialPitch: -6,
          initialFov: 60,
        },
      },
    });
    const scene = nodeImmersive(n);
    expect(scene?.initialHeading).toBe(135);
    expect(scene?.initialPitch).toBe(-6);
    expect(scene?.initialFov).toBe(60);
  });

  it("defaults the provider and label for an unnamed scene", () => {
    const n = node({
      metadata: { immersive: { mediaId: "M2" } },
    });
    const scene = nodeImmersive(n);
    expect(scene?.provider).toBe("campus360");
    expect(scene?.label).toBe("Library");
  });

  it("links the scene to its graph node (location-aware actions)", () => {
    const n = node({
      lat: 12.8405,
      lng: 80.1537,
      metadata: {
        immersive: { provider: "srm-cube", label: "Central Library", mediaId: "M1" },
      },
    });
    const scene = nodeImmersive(n);
    expect(scene?.nodeId).toBe("library");
    expect(scene?.lat).toBe(12.8405);
    expect(scene?.lng).toBe(80.1537);
  });
});

describe("campusImmersiveBlocks", () => {
  it("lists every immersive place in node order with its scene", () => {
    const multi: GraphPayload = {
      ...graph,
      nodes: [
        node({
          id: "a",
          metadata: { immersive: { provider: "srm-cube", label: "A 360", mediaId: "MA" } },
        }),
        node({ id: "plain" }),
        node({
          id: "b",
          label: "B Block",
          metadata: { immersive: { provider: "srm-cube", label: "B 360", mediaId: "MB" } },
        }),
      ],
    };
    const blocks = campusImmersiveBlocks(multi);
    expect(blocks.map((b) => b.nodeId)).toEqual(["a", "b"]);
    expect(blocks[0].scene.mediaId).toBe("MA");
    expect(blocks[0].label).toBe("A 360");
  });

  it("returns [] for null/undefined graphs", () => {
    expect(campusImmersiveBlocks(null)).toEqual([]);
    expect(campusImmersiveBlocks(undefined)).toEqual([]);
  });
});

describe("routeImmersiveViewpoints", () => {
  const route: Route = {
    source: "a",
    destination: "b",
    steps: [{ from_node_id: "a", to_node_id: "library", edge_id: "e1", distance_m: 100, estimated: false, walk_time_min: 2, instruction: null, geometry: null }],
    total_distance_m: 100,
    estimated_walk_time_min: 2,
    step_count: 1,
    all_estimated: false,
    summary: null,
  };

  it("lists the arriving node's scene in walking order", () => {
    const vps = routeImmersiveViewpoints(route, graph);
    expect(vps).toHaveLength(1);
    expect(vps[0]).toMatchObject({ nodeId: "library", label: "Central Library" });
  });

  it("returns [] when nothing routes", () => {
    expect(routeImmersiveViewpoints(null, graph)).toEqual([]);
    expect(routeImmersiveViewpoints(route, null)).toEqual([]);
  });
});