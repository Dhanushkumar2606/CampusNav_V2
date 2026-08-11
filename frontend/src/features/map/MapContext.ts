/**
 * Carries the live `maplibregl.Map` instance down to feature hooks
 * (useGraphSources, useRouteLayer, useNodeMarkers) without prop-drilling.
 */
import { createContext, useContext } from "react";
import type { Map as MlMap } from "maplibre-gl";

export const MapContext = createContext<MlMap | null>(null);

export function useMap(): MlMap | null {
  return useContext(MapContext);
}
