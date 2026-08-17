/**
 * Immersive provider abstraction — the single place that knows how each
 * 360°/panorama provider is consumed.
 *
 * CampusNav never ships imagery of its own: it references an external
 * provider (e.g. the official SRMIST virtual tour) by URL. The navigation
 * engine has no dependency on any provider — a campus without an immersive
 * config simply hides the 360° action.
 *
 * Adding a future provider (own Campus360 imagery, Mapillary, KartaView,
 * Google Street View) means registering it here + a scene resolver; the UI
 * and routing stay untouched.
 */
import type { GraphPayload, ImmersiveScene, PathNode, Route } from "@/lib/navigation-types";

export type ImmersiveProviderId = "campus360" | "srm-cube";

export interface ImmersiveProviderMeta {
  /** Short display name, e.g. "Campus 360". */
  label: string;
  /**
   * How the provider's content is consumed:
   *  - "iframe":      embedded in the app when the provider allows framing.
   *  - "external":    opens in a new tab (provider blocks embedding).
   *  - "tiles":       rendered in-app from the provider's cube tiles
   *                   (one scene at a time — see CubePanorama).
   *  - "none":        no viewable source (media not yet provided).
   */
  embed: "iframe" | "external" | "tiles" | "none";
}

const PROVIDERS: Record<string, ImmersiveProviderMeta> = {
  campus360: {
    label: "Campus 360",
    embed: "external",
  },
  "srm-cube": {
    label: "SRM 360° Tour — scene",
    embed: "tiles",
  },
};

export function immersiveProviderMeta(provider: string | null | undefined): ImmersiveProviderMeta {
  return PROVIDERS[provider ?? ""] ?? { label: provider ?? "360° Tour", embed: "external" };
}

/**
 * Resolve the 360° scene for a node — scene-linked only.
 *
 * Returns a scene solely when the node's OWN scene carries a real url or
 * media_id: clicking a block opens exactly that block's 360° view, never a
 * whole-site tour. No campus-level fallback: without per-scene content
 * there is simply no 360° and the UI hides the action.
 */
export function nodeImmersive(node: PathNode): ImmersiveScene | null {
  const scene = node.metadata?.immersive as Partial<ImmersiveScene> | null | undefined;
  if (!scene?.url && !scene?.mediaId) return null;
  return {
    provider: scene.provider ?? "campus360",
    url: scene.url ?? null,
    label: scene.label ?? node.label,
    available: true,
    mediaId: scene.mediaId ?? null,
    // Landing orientation flows through so a scene can open looking at its
    // subject (yaw 0 = front face) instead of a generic straight-ahead.
    initialHeading: scene.initialHeading,
    initialPitch: scene.initialPitch,
    initialFov: scene.initialFov,
    // Location linkage — lets the 360 action reuse the existing routing
    // workflow ("Navigate here") and feeds map discovery.
    nodeId: node.id,
    lat: node.lat,
    lng: node.lng,
  };
}

/**
 * Every immersive scene on a campus, in node order, with its resolved
 * scene — powers scene-to-scene browsing (prev/next in the viewer) and
 * 360 discovery on the map.
 */
export interface ImmersiveBlock {
  nodeId: string;
  label: string;
  scene: ImmersiveScene;
}

export function campusImmersiveBlocks(graph: GraphPayload | null | undefined): ImmersiveBlock[] {
  if (!graph) return [];
  const out: ImmersiveBlock[] = [];
  for (const node of graph.nodes) {
    const scene = nodeImmersive(node);
    if (!scene) continue;
    out.push({ nodeId: node.id, label: scene.label ?? node.label, scene });
  }
  return out;
}

/**
 * Route-aware 360° viewpoints — every waypoint along a route that carries
 * an immersive scene, in walking order, deduped by node.
 *
 * Navigation is a chain of places: each step ends at a node (building
 * entrance, landmark, POI…), and every such node is a candidate viewpoint.
 * The UI lists these along the route ("360° at: X · Y · Z") and offers the
 * current one live during navigation. Returns [] when the route or graph
 * carries no immersive content, so the feature degrades to nothing.
 */
export interface RouteViewpoint {
  /** Index into route.steps — the step that *arrives* at this node. */
  stepIndex: number;
  nodeId: string;
  label: string;
  scene: ImmersiveScene;
}

export function routeImmersiveViewpoints(
  route: Route | null | undefined,
  graph: GraphPayload | null | undefined,
): RouteViewpoint[] {
  if (!route || !graph) return [];
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const out: RouteViewpoint[] = [];

  const push = (stepIndex: number, nodeId: string) => {
    if (seen.has(nodeId)) return;
    const node = nodes.get(nodeId);
    if (!node) return;
    const scene = nodeImmersive(node);
    if (!scene) return;
    seen.add(nodeId);
    out.push({ stepIndex, nodeId, label: scene.label ?? node.label, scene });
  };

  const first = route.steps[0];
  if (first) push(0, first.from_node_id);
  route.steps.forEach((s, i) => push(i, s.to_node_id));
  return out;
}
