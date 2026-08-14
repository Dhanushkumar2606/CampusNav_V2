import { createContext, useContext } from "react";
import type { LayerGroup, Map as LeafletMap, Polyline } from "leaflet";

export interface LeafletMapValue {
  map: LeafletMap | null;
  /** Live handle to the graph-edges layer group (set by LeafletCanvas). */
  edgesGroup: LayerGroup | null;
  /** Live handle to the route polyline (set by LeafletCanvas). */
  routePolyline: Polyline | null;
  setEdgesGroup: (g: LayerGroup | null) => void;
  setRoutePolyline: (p: Polyline | null) => void;
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