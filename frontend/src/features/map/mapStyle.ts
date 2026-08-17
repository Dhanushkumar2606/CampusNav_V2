/**
 * MapLibre style + paint specs. The style is a minimal style.json that
 * pulls in OSM raster tiles via the canonical `tile.openstreetmap.org`
 * endpoint (per the OSM tile usage policy). Bounds hard-coded to the
 * SRM Kattankulathur campus.
 */
import type { StyleSpecification, SymbolLayerSpecification } from "maplibre-gl";

import { brand } from "@/lib/brand";

/** SRM Kattankulathur bounding box (lng, lat order — SW then NE). */
export const SRM_KTR_BOUNDS: [[number, number], [number, number]] = [
  [80.038, 12.819], // SW
  [80.050, 12.829], // NE
];

/**
 * Minimal MapLibre style backed by OSM raster tiles. Inline JSON keeps
 * the dev experience fast (no network round-trip for the style itself).
 */
export const OSM_RASTER_STYLE: StyleSpecification = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    "osm-raster": {
      type: "raster",
      tiles: [
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm-raster",
    },
  ],
};

/**
 * Paint spec for estimated (gray dashed) edges — debug graph overlay only,
 * hidden unless VITE_SHOW_GRAPH_DEBUG=true.
 */
export const ESTIMATED_LINE_PAINT = {
  "line-color": brand.subtle,
  "line-width": 1.5,
  "line-dasharray": [2, 2] as [number, number],
  "line-opacity": 0.6,
};

/** Paint spec for surveyed (neon green) edges — debug graph overlay only. */
export const SURVEYED_LINE_PAINT = {
  "line-color": brand.green,
  "line-width": 2.5,
  "line-opacity": 0.75,
};

/**
 * Route layer paints — a dark casing under a cyan main line (Google-Maps
 * style). Both use round caps/joins; the main line's dash array switches
 * per feature so estimated steps stay honest (dashed) instead of looking
 * surveyed. Casing width must exceed the main width by a few px.
 */
export const ROUTE_CASING_PAINT = {
  "line-color": brand.deep,
  "line-width": 8,
  "line-opacity": 0.95,
};

export const ROUTE_LINE_PAINT = {
  "line-color": brand.cyan,
  "line-width": 4.5,
  "line-opacity": 0.95,
  "line-dasharray": [
    "case",
    ["==", ["get", "estimated"], true],
    ["literal", [5, 4]],
    ["literal", [1, 0]],
  ] as unknown as number[],
};

/** Kind -> accent color for node dots. Buildings stay neutral (their labels
 *  are the show); junctions/transitions are intentionally recessive — they
 *  are navigation infrastructure, not places. */
export const NODE_KIND_COLORS: Record<string, string> = {
  building: brand.text,
  entrance: brand.cyan,
  landmark: brand.amber,
  transit: brand.green,
  poi: brand.text,
  junction: brand.subtle,
  transition: brand.subtle,
};

/** Base dot radius by kind; junctions shrink with zoom so the map stays
 *  readable from afar. */
export function nodeRadius(kind: string, isBuilding: boolean): number {
  if (isBuilding) return 5;
  if (kind === "junction" || kind === "transition") return 2.8;
  return 3.8;
}

/** Node dot circle paint spec — fully data-driven (radius/color carried in
 *  the feature properties by useGraphSources). Subtle by design: dots are
 *  click targets + orientation, not the main show. */
export const NODE_CIRCLE_PAINT = {
  "circle-radius": ["get", "radius"] as unknown as number,
  "circle-color": ["get", "color"] as unknown as string,
  "circle-stroke-color": brand.navy,
  "circle-stroke-width": 1,
  "circle-opacity": [
    "case",
    ["==", ["get", "isBuilding"], true],
    0.85,
    ["interpolate", ["linear"], ["zoom"], 13, 0.35, 16, 0.6],
  ] as unknown as number,
};

/** Halo ring behind 360°-enabled places — discovery badge, independent of
 *  the graph-debug toggle so 360° content is always findable. */
export const NODE_360_RING_PAINT = {
  "circle-radius": [
    "interpolate",
    ["linear"],
    ["zoom"],
    14,
    6,
    16,
    9,
  ] as unknown as number,
  "circle-color": "rgba(45, 212, 191, 0)",
  "circle-stroke-color": brand.cyan,
  "circle-stroke-width": 1.5,
  "circle-stroke-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0.45, 16, 0.9] as unknown as number,
};

export const NODE_360_LABEL_PAINT = {
  "text-color": brand.cyan,
  "text-halo-color": brand.deep,
  "text-halo-width": 1.5,
};

export const NODE_360_LABEL_LAYOUT: SymbolLayerSpecification["layout"] = {
  "text-field": "360°",
  "text-size": 10,
  "text-offset": [0, -2.1],
  "text-anchor": "bottom",
  "text-allow-overlap": false,
  "text-font": ["Noto Sans Regular"],
};

/** Secondary labels for POI-ish kinds (entrances, landmarks, transit stops)
 *  that are not buildings — they appear when zoomed in. */
export const NODE_KIND_LABEL_PAINT = {
  "text-color": ["get", "color"] as unknown as string,
  "text-halo-color": brand.deep,
  "text-halo-width": 1.2,
};

export const NODE_KIND_LABEL_LAYOUT: SymbolLayerSpecification["layout"] = {
  "text-field": ["get", "label"],
  "text-size": 10.5,
  "text-offset": [0, 1.1],
  "text-anchor": "top",
  "text-allow-overlap": false,
  "text-font": ["Noto Sans Regular"],
};

/** Invisible click target — slightly larger than the visible dot. */
export const NODE_HIT_PAINT = {
  "circle-radius": 12,
  "circle-color": "#000",
  "circle-opacity": 0,
  "circle-stroke-opacity": 0,
};

export const NODE_LABEL_PAINT = {
  "text-color": brand.text,
  "text-halo-color": brand.deep,
  "text-halo-width": 1.5,
};

export const NODE_LABEL_LAYOUT: SymbolLayerSpecification["layout"] = {
  "text-field": ["get", "label"],
  "text-size": 11,
  "text-offset": [0, 1.2],
  "text-anchor": "top",
  "text-allow-overlap": false,
  "text-font": ["Noto Sans Regular"],
};
