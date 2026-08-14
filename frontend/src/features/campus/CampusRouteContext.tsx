/**
 * CampusRouteContext — single owner of the map session state.
 *
 * Owns: campuses list, active campus + graph, route selection + constraints,
 * route result + alternatives, edge-layer visibility, geolocation, the
 * active map controller (registered by whichever renderer is mounted), and
 * the navigation session state machine. The map page, routing panel, controls
 * and detail cards all read from here instead of prop-drilling or duplicating
 * fetches. The URL stays the source of truth for shareable routes; a thin
 * sync layer in MapViewHost hydrates from and writes back to search params.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  getGraph,
  listBuildings,
  listCampuses,
  postRoute,
  routeErrorMessage,
  transportErrorMessage,
} from "@/api/navigation";
import type { Building, Campus, GraphPayload, Route, RouteMode } from "@/lib/navigation-types";
import { nearestNode, type NearestNodeOut } from "@/api/navigation";
import { boundsFromNodes } from "@/lib/geo";
import { useLiveLocation, type LocateResult } from "@/features/map/useLiveLocation";

export type Bounds2D = [[number, number], [number, number]];
export type RouteRequestStatus = "idle" | "loading" | "ok" | "error";

/** Abstraction over the WebGL (MapLibre) and DOM (Leaflet) renderers so the
 *  floating controls stay renderer-agnostic. */
export interface MapController {
  kind: "maplibre" | "leaflet";
  getContainer: () => HTMLElement | null;
  recenter: (bounds: Bounds2D) => void;
  flyTo: (lat: number, lng: number, zoom?: number) => void;
  flyToBounds: (bounds: Bounds2D) => void;
  supportsBearing: boolean;
  resetBearing: () => void;
  setBearing: (deg: number) => void;
  setUserMarker: (lat: number, lng: number) => void;
  clearUserMarker: () => void;
  /** GPS accuracy halo in meters around (lat, lng); null hides it. */
  setUserAccuracy: (lat: number, lng: number, radiusM: number | null) => void;
}

export interface NavSession {
  active: boolean;
  stepIndex: number;
  startedAt: number | null;
}

interface HydratableSearchParams {
  get(name: string): string | null;
}

interface CampusRouteContextValue {
  campuses: Campus[];
  loadingCampuses: boolean;
  campusesError: string | null;
  campusSlug: string | null;
  graph: GraphPayload | null;
  loadingGraph: boolean;
  graphError: string | null;
  selectCampus: (slug: string) => void;
  buildings: Building[] | null;

  sourceId: string | null;
  destinationId: string | null;
  setSourceId: (id: string | null) => void;
  setDestinationId: (id: string | null) => void;
  /** Place opened via /map?place=<id> (details card target). */
  place: string | null;
  setPlace: (id: string | null) => void;
  requireAccessible: boolean;
  setRequireAccessible: (v: boolean) => void;
  mode: RouteMode;
  setMode: (m: RouteMode) => void;
  avoidStairs: boolean;
  setAvoidStairs: (v: boolean) => void;

  route: Route | null;
  alternatives: Route[];
  activeAltIndex: number;
  pickAlternative: (index: number) => void;
  routeStatus: RouteRequestStatus;
  routeError: string | null;
  findRoute: () => Promise<void>;
  clearRoute: () => void;

  edgesVisible: boolean;
  setEdgesVisible: (v: boolean) => void;

  locate: LocateResult & { locate: () => void };
  /** True when the live fix is outside the active campus bounds. */
  outsideCampus: boolean;
  /** Closest walkable node to the live fix (GPS snap), or null. */
  nearestNode: NearestNodeOut | null;

  mapController: MapController | null;
  registerMapController: (c: MapController) => void;
  unregisterMapController: (kind: MapController["kind"]) => void;

  navSession: NavSession;
  startNavigation: () => void;
  cancelNavigation: () => void;
  setNavStep: (index: number) => void;

  hydrate: (params: HydratableSearchParams) => void;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CampusRouteContext = createContext<CampusRouteContextValue | undefined>(undefined);

export function CampusRouteProvider({ children }: { children: ReactNode }) {
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [loadingCampuses, setLoadingCampuses] = useState(true);
  const [campusesError, setCampusesError] = useState<string | null>(null);
  const [campusSlug, setCampusSlug] = useState<string | null>(null);
  const [graph, setGraph] = useState<GraphPayload | null>(null);
  const [loadingGraph, setLoadingGraph] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [buildings, setBuildings] = useState<Building[] | null>(null);

  const [sourceId, setSourceId] = useState<string | null>(null);
  const [destinationId, setDestinationId] = useState<string | null>(null);
  const [place, setPlace] = useState<string | null>(null);
  // Deep-link labels (?source=central_library) that still need the graph
  // loaded before they can resolve to a node id.
  const pendingLabelsRef = useRef<{ source?: string | null; destination?: string | null; place?: string | null }>({});
  // Bumped whenever a pending label is added, so the resolution effect can
  // re-run even when the graph is already loaded (labels live in a ref).
  const [pendingTick, setPendingTick] = useState(0);
  // Campus currently reflected in the session, for cheap change detection in
  // hydrate (avoids nuking the loaded graph on same-campus URL re-syncs).
  const lastCampusRef = useRef<string | null>(null);
  // One-shot: hydrating from a URL with both endpoints should auto-run the
  // route once the graph is present (sharing stays one click away).
  const autoRouteRef = useRef(false);
  const setSourceIdSafe = useCallback((id: string | null) => {
    pendingLabelsRef.current.source = null;
    setSourceId(id);
  }, []);
  const setDestinationIdSafe = useCallback((id: string | null) => {
    pendingLabelsRef.current.destination = null;
    setDestinationId(id);
  }, []);
  const [requireAccessible, setRequireAccessible] = useState(false);
  const [mode, setMode] = useState<RouteMode>("shortest");
  const [avoidStairs, setAvoidStairs] = useState(false);

  const [route, setRoute] = useState<Route | null>(null);
  const [alternatives, setAlternatives] = useState<Route[]>([]);
  const [activeAltIndex, setActiveAltIndex] = useState(-1);
  const [routeStatus, setRouteStatus] = useState<RouteRequestStatus>("idle");
  const [routeError, setRouteError] = useState<string | null>(null);

  const [edgesVisible, setEdgesVisible] = useState(true);
  const [mapController, setMapController] = useState<MapController | null>(null);
  const [navSession, setNavSession] = useState<NavSession>({ active: false, stepIndex: 0, startedAt: null });
  const [nearestNodeHit, setNearestNodeHit] = useState<NearestNodeOut | null>(null);

  const locate = useLiveLocation();

  // ---- live-fix snapping + outside-campus detection -----------------------
  const campusBounds = useMemo(() => boundsFromNodes(graph?.nodes ?? []), [graph]);
  const outsideCampus = useMemo(() => {
    if (locate.status !== "ok" || !locate.coords || !campusBounds) return false;
    const [[swLng, swLat], [neLng, neLat]] = campusBounds;
    const pad = 0.003; // ~300 m slack around the bounding box
    return (
      locate.coords.lat < swLat - pad ||
      locate.coords.lat > neLat + pad ||
      locate.coords.lng < swLng - pad ||
      locate.coords.lng > neLng + pad
    );
  }, [locate.status, locate.coords, campusBounds]);

  useEffect(() => {
    if (!campusSlug || locate.status !== "ok" || !locate.coords) {
      setNearestNodeHit(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      nearestNode(campusSlug, locate.coords!.lat, locate.coords!.lng)
        .then((hit) => {
          if (!cancelled) setNearestNodeHit(hit);
        })
        .catch(() => {
          if (!cancelled) setNearestNodeHit(null);
        });
    }, 600);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [campusSlug, locate.status, locate.coords]);

  // ---- load campuses once -------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    listCampuses()
      .then((cs) => {
        if (cancelled) return;
        setCampuses(cs);
        setLoadingCampuses(false);
        if (cs.length > 0) setCampusSlug((prev) => prev ?? cs[0].slug);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCampusesError(err instanceof Error ? err.message : "Could not load campuses");
        setLoadingCampuses(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- fetch graph on campus change ---------------------------------------
  const selectCampus = useCallback((slug: string) => {
    lastCampusRef.current = slug;
    setCampusSlug(slug);
    // Node ids are campus-scoped — stale selections must not leak across.
    setSourceId(null);
    setDestinationId(null);
    pendingLabelsRef.current = {};
    setRoute(null);
    setAlternatives([]);
    setActiveAltIndex(-1);
    setRouteStatus("idle");
    setRouteError(null);
  }, []);

  useEffect(() => {
    if (!campusSlug) return;
    let cancelled = false;
    setLoadingGraph(true);
    setGraphError(null);
    getGraph(campusSlug)
      .then((g) => {
        if (cancelled) return;
        setGraph(g);
        setLoadingGraph(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setGraphError(err instanceof Error ? err.message : "Could not load graph");
        setLoadingGraph(false);
      });
    return () => {
      cancelled = true;
    };
  }, [campusSlug]);

  // ---- deep-link resolution (labels -> ids) + one-shot auto-route --------
  // Runs whenever the graph arrives or a selection changes, so a URL like
  // /map?destination=central_library resolves to a node id and then fetches
  // the route without a button press.
  useEffect(() => {
    if (autoRouteRef.current && sourceId && destinationId) {
      autoRouteRef.current = false;
      setTimeout(() => findRouteRef.current?.(), 0);
      return;
    }
    const pending = pendingLabelsRef.current;
    if (!graph || (!pending.source && !pending.destination && !pending.place)) return;
    let srcId = sourceId;
    let dstId = destinationId;
    if (pending.source && graph.labels?.[pending.source]) {
      srcId = graph.labels[pending.source];
      pending.source = null;
    }
    if (pending.destination && graph.labels?.[pending.destination]) {
      dstId = graph.labels[pending.destination];
      pending.destination = null;
    }
    let placeId = place;
    if (pending.place && graph.labels?.[pending.place]) {
      placeId = graph.labels[pending.place];
      pending.place = null;
    }
    if (srcId !== sourceId) setSourceId(srcId);
    if (dstId !== destinationId) setDestinationId(dstId);
    if (placeId !== place) setPlace(placeId);
  }, [graph, sourceId, destinationId, place, pendingTick]);

  // ---- building details for the active campus -----------------------------
  useEffect(() => {
    const slug = graph?.campus.slug;
    if (!slug) {
      setBuildings(null);
      return;
    }
    let cancelled = false;
    listBuildings(slug)
      .then((bs) => {
        if (!cancelled) setBuildings(bs);
      })
      .catch(() => {
        if (!cancelled) setBuildings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [graph?.campus.slug]);

  // ---- route request ------------------------------------------------------
  const findRoute = useCallback(async () => {
    if (!graph || !sourceId || !destinationId) return;
    setRouteStatus("loading");
    setRouteError(null);
    setAlternatives([]);
    setActiveAltIndex(-1);
    try {
      const res = await postRoute(graph.campus.slug, {
        source_id: sourceId,
        destination_id: destinationId,
        require_accessible: requireAccessible,
        heuristic: "haversine",
        mode,
        avoid_stairs: avoidStairs,
        alternatives: 3,
      });
      if (res.status === "ok" && res.route) {
        setRoute(res.route);
        setAlternatives(res.alternatives ?? []);
        setRouteStatus("ok");
      } else {
        setRoute(null);
        setRouteError(routeErrorMessage(res.status, res.error));
        setRouteStatus("error");
      }
    } catch (err) {
      setRoute(null);
      setRouteError(transportErrorMessage(err));
      setRouteStatus("error");
    }
  }, [graph, sourceId, destinationId, requireAccessible, mode, avoidStairs]);

  const pickAlternative = useCallback(
    (index: number) => {
      setActiveAltIndex(index);
      const alt = alternatives[index];
      if (alt) setRoute(alt);
    },
    [alternatives],
  );

  const clearRoute = useCallback(() => {
    setRoute(null);
    setAlternatives([]);
    setActiveAltIndex(-1);
    setRouteStatus("idle");
    setRouteError(null);
    setNavSession({ active: false, stepIndex: 0, startedAt: null });
  }, []);

  // ---- map controller registry --------------------------------------------
  const registerMapController = useCallback((c: MapController) => {
    setMapController(c);
  }, []);

  const unregisterMapController = useCallback((kind: MapController["kind"]) => {
    setMapController((prev) => (prev?.kind === kind ? null : prev));
  }, []);

  // ---- navigation session --------------------------------------------------
  const findRouteRef = useRef<typeof findRoute | null>(null);
  findRouteRef.current = findRoute;

  const startNavigation = useCallback(() => {
    setNavSession({ active: true, stepIndex: 0, startedAt: Date.now() });
  }, []);

  const cancelNavigation = useCallback(() => {
    setNavSession({ active: false, stepIndex: 0, startedAt: null });
  }, []);

  const setNavStep = useCallback((index: number) => {
    setNavSession((prev) => ({ ...prev, stepIndex: Math.max(0, index) }));
  }, []);

  // ---- URL hydration (called once by MapViewHost on mount) ----------------
  const hydrate = useCallback(
    (params: HydratableSearchParams) => {
      const campus = params.get("campus");
      if (campus) {
        setCampusSlug(campus);
        if (lastCampusRef.current !== campus) {
          lastCampusRef.current = campus;
          setCampusSlug(campus);
          // Node ids are campus-scoped — stale graph/selections must not
          // leak across, but only when the campus actually changes: the
          // write-back re-hydrates with the same campus after every URL
          // sync and must not nuke an already-loaded graph.
          setGraph(null);
          setBuildings(null);
          setSourceId(null);
          setDestinationId(null);
          pendingLabelsRef.current = {};
        } else {
          setCampusSlug(campus);
        }
      }
      const src = params.get("source");
      const dst = params.get("destination");
    if (src && dst) autoRouteRef.current = true;
    if (src) {
      if (UUID_RE.test(src)) setSourceId(src);
      else {
        pendingLabelsRef.current.source = src;
        setPendingTick((t) => t + 1);
      }
    }
    if (dst) {
      if (UUID_RE.test(dst)) setDestinationId(dst);
      else {
        pendingLabelsRef.current.destination = dst;
        setPendingTick((t) => t + 1);
      }
    }
    const placeParam = params.get("place");
    if (placeParam) {
      if (UUID_RE.test(placeParam)) setPlace(placeParam);
      else {
        pendingLabelsRef.current.place = placeParam;
        setPendingTick((t) => t + 1);
      }
    }
      if (params.get("accessible") === "true") setRequireAccessible(true);
      const m = params.get("mode");
      if (m === "shortest" || m === "fastest") setMode(m);
      if (params.get("avoid_stairs") === "true") setAvoidStairs(true);
    },
    [],
  );

  const value = useMemo<CampusRouteContextValue>(
    () => ({
      campuses,
      loadingCampuses,
      campusesError,
      campusSlug,
      graph,
      loadingGraph,
      graphError,
      selectCampus,
      buildings,
      sourceId,
      destinationId,
      setSourceId: setSourceIdSafe,
      setDestinationId: setDestinationIdSafe,
      place,
      setPlace,
      requireAccessible,
      setRequireAccessible,
      mode,
      setMode,
      avoidStairs,
      setAvoidStairs,
      route,
      alternatives,
      activeAltIndex,
      pickAlternative,
      routeStatus,
      routeError,
      findRoute,
      clearRoute,
      edgesVisible,
      setEdgesVisible,
      locate,
      outsideCampus,
      nearestNode: nearestNodeHit,
      mapController,
      registerMapController,
      unregisterMapController,
      navSession,
      startNavigation,
      cancelNavigation,
      setNavStep,
      hydrate,
    }),
    [
      campuses, loadingCampuses, campusesError, campusSlug, graph, loadingGraph,
      graphError, selectCampus, buildings, sourceId, destinationId, place, requireAccessible,
      mode, avoidStairs, route, alternatives, activeAltIndex, pickAlternative,
      routeStatus, routeError, findRoute, clearRoute, edgesVisible, locate,
      outsideCampus, nearestNodeHit, mapController, registerMapController, unregisterMapController, navSession,
      startNavigation, cancelNavigation, setNavStep, hydrate,
    ],
  );

  return <CampusRouteContext.Provider value={value}>{children}</CampusRouteContext.Provider>;
}

export function useCampusRoute(): CampusRouteContextValue {
  const ctx = useContext(CampusRouteContext);
  if (!ctx) throw new Error("useCampusRoute must be used within CampusRouteProvider");
  return ctx;
}