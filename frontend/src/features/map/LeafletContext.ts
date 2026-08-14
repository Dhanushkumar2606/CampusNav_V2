import { createContext, useContext } from "react";
import type { Layer, LayerGroup, Map as LeafletMap } from "leaflet";

export interface LeafletMapValue {
  map: LeafletMap | null;
  /** Live handle to the graph-edges layer group (set by LeafletCanvas). */
  edgesGroup: LayerGroup | null;
  /** Live handle to the route polylines group (set by LeafletCanvas). */
  routePolyline: Layer | null;
  setEdgesGroup: (g: LayerGroup | null) => void;
  setRoutePolyline: (p: Layer | null) => void;
}

const LeafletContext = createContext<LeafletMapValue>({
  map: null,
  edgesGroup: null,
  routePolyline: null,
  setEdgesGroup: () => undefined,
  setRoutePolyline: () => undefined,
});

export function useLeafletMap(): LeafletMapValue {
  return useContext(LeafletContext);
}

export { LeafletContext };