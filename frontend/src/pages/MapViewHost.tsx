/**
 * MapView host — owns the campus graph state. Lifts it out of RoutingPanel
 * so the same `GraphPayload` can be passed to both the panel (for the
 * dropdowns) and the map hooks (for sources/layers). This avoids the
 * RoutingPanel doing the fetch twice when the panel re-renders.
 */
import { useState } from "react";

import type { GraphPayload } from "@/lib/navigation-types";
import { MapView } from "./MapView";

export function MapViewHost() {
  const [graph, setGraph] = useState<GraphPayload | null>(null);
  return <MapView graph={graph} onGraphChange={setGraph} />;
}