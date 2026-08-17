/**
 * Adds / updates the A* route polyline layer on the map. When `route`
 * changes, builds one LineString per consecutive step — following each
 * edge's real walkway geometry (curves and bends from OSM) when surveyed,
 * straight-line fallback otherwise.
 *
 * While navigation is active the layer highlights the current step (wider,
 * full opacity), dims completed steps and fades upcoming ones via
 * data-driven paint expressions.
 */
import { useEffect, useMemo, useRef } from "react";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";

import type { GraphPayload, Route } from "@/lib/navigation-types";
import type { NavSession } from "@/features/campus/CampusRouteContext";
import { brand } from "@/lib/brand";
import { polylineBounds, routePolyline, stepCoords } from "./routeGeometry";
import { useMap } from "./MapContext";
import { ROUTE_CASING_PAINT, ROUTE_LINE_PAINT } from "./mapStyle";

const SRC_ROUTE = "route-line";
const LYR_ROUTE_CASING = "route-line-casing";
const LYR_ROUTE = "route-line";
// Next-junction emphasis during navigation: a pulsing amber ring on the
// endpoint of the current step — "turn here next".
const SRC_NEXT = "route-next";
const LYR_NEXT = "route-next-pulse";

function buildRouteGeoJson(route: Route, graph: GraphPayload): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = [];
  route.steps.forEach((step, index) => {
    const coords = stepCoords(step, graph);
    if (!coords || coords.length < 2) return;
    const estimated = step.estimated ?? false;
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: { edgeId: step.edge_id, estimated, stepIndex: index },
    });
  });
  return { type: "FeatureCollection", features };
}

export function useRouteLayer(
  route: Route | null,
  graph: GraphPayload | null,
  navSession?: NavSession,
) {
  const map = useMap();
  const navStep = navSession?.active ? navSession.stepIndex : -1;
  const pulseRef = useRef(false);

  const fc = useMemo<FeatureCollection<LineString> | null>(() => {
    if (!route || !graph) return null;
    return buildRouteGeoJson(route, graph);
  }, [route, graph]);

  // Add / update the source + layers. A null route removes any stale
  // polyline so a failed/cleared route never leaves a ghost line on the map.
  useEffect(() => {
    if (!map) return;
    let cancelled = false;

    const clear = () => {
      for (const id of [LYR_ROUTE, LYR_ROUTE_CASING]) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      if (map.getSource(SRC_ROUTE)) map.removeSource(SRC_ROUTE);
    };

    if (!fc) {
      const clearWhenReady = () => {
        if (cancelled) return;
        clear();
      };
      if (map.isStyleLoaded()) clearWhenReady();
      else map.once("load", clearWhenReady);
      return () => {
        cancelled = true;
      };
    }

    const apply = () => {
      if (cancelled || !map.isStyleLoaded()) return;
      const existing = map.getSource(SRC_ROUTE) as
        | import("maplibre-gl").GeoJSONSource
        | undefined;
      if (existing && "setData" in existing) {
        existing.setData(fc);
      } else {
        // Ensure no stale layer from a previous mount.
        clear();
        map.addSource(SRC_ROUTE, { type: "geojson", data: fc });
        // Insert above the campus-edges layers but below the dots/labels.
        const before = map.getLayer("nodes-dot") ? "nodes-dot" : undefined;
        // Dark casing under the cyan main line — rounded caps/joins and a
        // per-feature dash array (estimated steps stay dashed, honestly).
        map.addLayer(
          {
            id: LYR_ROUTE_CASING,
            type: "line",
            source: SRC_ROUTE,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { ...ROUTE_CASING_PAINT, "line-opacity": 0 },
          },
          before,
        );
        map.addLayer(
          {
            id: LYR_ROUTE,
            type: "line",
            source: SRC_ROUTE,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { ...ROUTE_LINE_PAINT, "line-opacity": 0 },
          },
          before,
        );
        // Draw-in: fade both lines in after they land.
        window.setTimeout(() => {
          if (cancelled || !map.isStyleLoaded()) return;
          if (map.getLayer(LYR_ROUTE_CASING)) {
            map.setPaintProperty(LYR_ROUTE_CASING, "line-opacity", 0.95);
          }
          if (map.getLayer(LYR_ROUTE)) {
            map.setPaintProperty(LYR_ROUTE, "line-opacity", 0.95);
          }
        }, 30);
      }
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);

    return () => {
      cancelled = true;
    };
  }, [map, fc]);

  // Navigation styling: highlight the current step, dim the traveled part,
  // and pulse a marker on the current step's endpoint (the next junction to
  // reach). Data-driven expressions compare each feature's stepIndex against
  // the live nav step, so no geometry rebuilds while walking.
  useEffect(() => {
    if (!map || !fc || !route || !graph) return;

    const step = navStep >= 0 ? route.steps[navStep] : null;
    const stepCoordsArr = step ? stepCoords(step, graph) : null;
    const endpoint = stepCoordsArr && stepCoordsArr.length > 0
      ? stepCoordsArr[stepCoordsArr.length - 1]
      : null;

    const styleNavStep = () => {
      if (!map.isStyleLoaded()) return;
      const main = map.getLayer(LYR_ROUTE);
      const casing = map.getLayer(LYR_ROUTE_CASING);
      if (!main || !casing) return;
      // No active session → one calm, continuous route at full opacity.
      map.setPaintProperty(LYR_ROUTE, "line-width", [
        "case",
        ["==", ["get", "stepIndex"], navStep],
        6.5,
        4.5,
      ]);
      map.setPaintProperty(
        LYR_ROUTE,
        "line-opacity",
        navStep < 0
          ? 0.95
          : [
              "case",
              ["<", ["get", "stepIndex"], navStep],
              0.18,
              ["==", ["get", "stepIndex"], navStep],
              0.95,
              0.55,
            ],
      );
      map.setPaintProperty(LYR_ROUTE_CASING, "line-opacity", navStep < 0 ? 0.95 : 0.6);

      // Next-junction pulse marker: halo + core, amber.
      const nextFc: FeatureCollection<Point> | null = endpoint
        ? {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                id: "halo",
                geometry: { type: "Point", coordinates: endpoint },
                properties: { core: false },
              },
              {
                type: "Feature",
                id: "core",
                geometry: { type: "Point", coordinates: endpoint },
                properties: { core: true },
              },
            ],
          }
        : null;

      if (nextFc) {
        const existing = map.getSource(SRC_NEXT) as import("maplibre-gl").GeoJSONSource | undefined;
        if (existing && "setData" in existing) {
          existing.setData(nextFc);
        } else {
          if (map.getSource(SRC_NEXT)) map.removeSource(SRC_NEXT);
          map.addSource(SRC_NEXT, { type: "geojson", data: nextFc });
          const before = map.getLayer("nodes-dot") ? "nodes-dot" : undefined;
          map.addLayer(
            {
              id: LYR_NEXT,
              type: "circle",
              source: SRC_NEXT,
              paint: {
                "circle-radius": ["case", ["get", "core"], 4.5, 11],
                "circle-color": ["case", ["get", "core"], brand.amber, "rgba(245,158,11,0.22)"],
                "circle-stroke-color": brand.amber,
                "circle-stroke-width": ["case", ["get", "core"], 0, 2],
                "circle-stroke-opacity": ["case", ["feature-state", "pulse"], 0.3, 0.95],
              },
            },
            before,
          );
        }
      } else {
        if (map.getLayer(LYR_NEXT)) map.removeLayer(LYR_NEXT);
        if (map.getSource(SRC_NEXT)) map.removeSource(SRC_NEXT);
      }
    };

    // Gentle pulse on the halo ring (~1 Hz amber blink, hardware-toggled).
    const pulseTimer = window.setInterval(() => {
      if (!map.isStyleLoaded() || !map.getLayer(LYR_NEXT)) return;
      pulseRef.current = !pulseRef.current;
      map.setFeatureState({ source: SRC_NEXT, id: "halo" }, { pulse: pulseRef.current });
    }, 900);

    if (map.isStyleLoaded()) styleNavStep();
    else map.once("load", styleNavStep);

    return () => {
      window.clearInterval(pulseTimer);
      if (map.getLayer(LYR_NEXT)) map.removeLayer(LYR_NEXT);
      if (map.getSource(SRC_NEXT)) map.removeSource(SRC_NEXT);
    };
  }, [map, fc, navStep, route, graph]);

  // Fit the camera to a NEW route only — keyed on the route reference so a
  // campus switch doesn't yank the camera around while the route is intact.
  const lastRouteRef = useRef<Route | null>(null);
  useEffect(() => {
    if (!map || !fc || !route || !graph) return;
    if (lastRouteRef.current === route) return;
    lastRouteRef.current = route;
    const bbox = polylineBounds(routePolyline(route, graph));
    if (!bbox) return;
    map.fitBounds(bbox, { padding: 80, duration: 600, maxZoom: 17 });
  }, [map, fc, route, graph]);
}

/** The continuous geometry of the current route (for the progress engine). */
export function useRoutePolyline(
  route: Route | null,
  graph: GraphPayload | null,
): [number, number][] {
  return useMemo(() => {
    if (!route || !graph) return [];
    return routePolyline(route, graph);
  }, [route, graph]);
}