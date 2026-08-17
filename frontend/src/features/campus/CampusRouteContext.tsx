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
  getCampusesNear,
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
import { getLocationSource } from "@/lib/locationSource";
import { buildRouteGeometryModel, projectOnRoute } from "@/features/navigation/routeProgress";

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
  setUserMarker: (lat: number, lng: number, headingDeg?: number) => void;
  clearUserMarker: () => void;
  /** GPS accuracy halo in meters around (lat, lng); null hides it. */
  setUserAccuracy: (lat: number, lng: number, radiusM: number | null) => void;
}

export interface NavSession {
  active: boolean;
  phase: "navigating" | "arrived";
  stepIndex: number;
  startedAt: number | null;
  /** Remaining route distance from the latest processed GPS fix, or null. */
  remainingM: number | null;
  /** ETA seconds from the latest processed fix (pace-smoothed), or null. */
  etaSec: number | null;
  /** True when the live fix has drifted off the route (awaiting re-route). */
  offRoute: boolean;
}

const IDLE_NAV: NavSession = {
  active: false,
  phase: "navigating",
  stepIndex: 0,
  startedAt: null,
  remainingM: null,
  etaSec: null,
  offRoute: false,
};

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

/** Where the user last explored; the map reopens there next time. */
const LAST_CAMPUS_KEY = "campusnav:last-campus";
const NEAR_RADIUS_M = 200_000;

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
  // True when the URL pinned a campus — geo auto-detect must not override it.
  const explicitCampusRef = useRef(false);
  // One-shot: hydrating from a URL with both endpoints should auto-run the
  // route once the graph is present (sharing stays one click away).
  const autoRouteRef = useRef(false);
  // Live mirrors of the endpoint ids for change detection in the safe
  // setters — state setters are async, and re-setting the same id (e.g. a
  // hydration re-sync) must not nuke a freshly calculated route.
  const sourceIdRef = useRef<string | null>(null);
  const destinationIdRef = useRef<string | null>(null);
  const clearRoute = useCallback(() => {
    setRoute(null);
    setAlternatives([]);
    setActiveAltIndex(-1);
    setRouteStatus("idle");
    setRouteError(null);
    setNavSession(IDLE_NAV);
  }, []);
  const setSourceIdSafe = useCallback(
    (id: string | null) => {
      pendingLabelsRef.current.source = null;
      if (sourceIdRef.current !== id) {
        sourceIdRef.current = id;
        clearRoute();
      }
      setSourceId(id);
    },
    [clearRoute],
  );
  const setDestinationIdSafe = useCallback(
    (id: string | null) => {
      pendingLabelsRef.current.destination = null;
      if (destinationIdRef.current !== id) {
        destinationIdRef.current = id;
        clearRoute();
      }
      setDestinationId(id);
    },
    [clearRoute],
  );
  const [requireAccessible, setRequireAccessible] = useState(false);
  const [mode, setMode] = useState<RouteMode>("shortest");
  const [avoidStairs, setAvoidStairs] = useState(false);

  const [route, setRoute] = useState<Route | null>(null);
  const [alternatives, setAlternatives] = useState<Route[]>([]);
  const [activeAltIndex, setActiveAltIndex] = useState(-1);
  const [routeStatus, setRouteStatus] = useState<RouteRequestStatus>("idle");
  const [routeError, setRouteError] = useState<string | null>(null);

  // Campus pathway overlay (the raw graph). Off by default — normal users
  // see the computed route, not the routing network. Set
  // VITE_SHOW_GRAPH_DEBUG=true to paint every edge for development.
  const [edgesVisible, setEdgesVisible] = useState(
    () => import.meta.env.VITE_SHOW_GRAPH_DEBUG === "true",
  );
  const [mapController, setMapController] = useState<MapController | null>(null);
  const [navSession, setNavSession] = useState<NavSession>(IDLE_NAV);
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
  // Default campus selection: URL param (set by hydrate) wins; otherwise the
  // last campus from localStorage; otherwise a geolocation auto-detect; the
  // featured campus is the fallback. Only the fallback is applied before the
  // geo lookup resolves, so the map paints instantly and re-targets when the
  // fix arrives.
  useEffect(() => {
    let cancelled = false;
    listCampuses()
      .then((cs) => {
        if (cancelled) return;
        setCampuses(cs);
        setLoadingCampuses(false);
        if (cs.length === 0) return;
        setCampusSlug((prev) => {
          if (prev) return prev;
          try {
            const stored = localStorage.getItem(LAST_CAMPUS_KEY);
            if (stored && cs.some((c) => c.slug === stored)) {
              lastCampusRef.current = stored;
              return stored;
            }
          } catch {
            // ignore storage errors
          }
          const featured = cs.find((c) => c.featured);
          return featured?.slug ?? cs[0].slug;
        });
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

  // Auto-detect (one-shot at boot): when no campus was pinned — no URL
  // param (hydrate has already run) and nothing stored — ask for a GPS fix
  // and hop to the nearest catalog centroid. Runs strictly before the
  // campuses load resolves, so it can't be cancelled by that state change.
  useEffect(() => {
    if (campusSlug || explicitCampusRef.current) return;
    const source = getLocationSource();
    if (!source) return;
    try {
      if (localStorage.getItem(LAST_CAMPUS_KEY)) return;
    } catch {
      // ignore storage errors
    }
    let cancelled = false;
    source.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        getCampusesNear(pos.coords.latitude, pos.coords.longitude, { radiusM: NEAR_RADIUS_M })
          .then((near) => {
            if (cancelled || near.length === 0 || lastCampusRef.current) return;
            selectCampus(near[0].slug);
          })
          .catch(() => {
            // cold fallback stays selected
          });
      },
      () => {
        // permission denied / no fix — the fallback campus stays
      },
      { timeout: 8000, maximumAge: 300_000 },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- fetch graph on campus change ---------------------------------------
  const selectCampus = useCallback((slug: string) => {
    lastCampusRef.current = slug;
    try {
      localStorage.setItem(LAST_CAMPUS_KEY, slug);
    } catch {
      // ignore storage errors
    }
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
    // Resolve deep-link labels FIRST: they live in a ref and arrive on a
    // different render than the ids, and the one-shot auto-route below must
    // run against the RESOLVED endpoints. Skipping this and early-returning
    // on the auto-route branch would strand a fresh destination as pending
    // whenever a route already exists (e.g. a GPS-snapped follow-up query
    // while the previous route is still on screen) — the map would then
    // keep routing to the old place while the chat reports the new one.
    const pending = pendingLabelsRef.current;
    let srcId = sourceId;
    let dstId = destinationId;
    let placeId = place;
    if (pending.source && graph?.labels?.[pending.source]) {
      srcId = graph.labels[pending.source];
      pending.source = null;
    }
    if (pending.destination && graph?.labels?.[pending.destination]) {
      dstId = graph.labels[pending.destination];
      pending.destination = null;
    }
    if (pending.place && graph?.labels?.[pending.place]) {
      placeId = graph.labels[pending.place];
      pending.place = null;
    }
    if (srcId !== sourceId) setSourceId(srcId);
    if (dstId !== destinationId) setDestinationId(dstId);
    if (placeId !== place) setPlace(placeId);
    // One-shot auto-route (deep links, chat route intents): hold the flag
    // until the campus graph is present AND both endpoints resolve — on a
    // fresh load or a campus switch the graph arrives in a later render
    // than the node ids, and findRoute needs it.
    if (autoRouteRef.current && graph && srcId && dstId) {
      autoRouteRef.current = false;
      setTimeout(() => findRouteRef.current?.(), 0);
    }
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
  const findRoute = useCallback(
    async (overrides?: { sourceId?: string | null }) => {
      const srcId = overrides?.sourceId ?? sourceId;
      if (!graph || !srcId || !destinationId) return;
      setRouteStatus("loading");
      setRouteError(null);
      setAlternatives([]);
      setActiveAltIndex(-1);
      try {
        const res = await postRoute(graph.campus.slug, {
          source_id: srcId,
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
          // A fresh route supersedes any navigation progress: after an
          // off-route re-route the walker restarts from the snapped origin.
          setNavSession((prev) =>
            prev.active
              ? { ...prev, phase: "navigating", stepIndex: 0, offRoute: false, remainingM: null, etaSec: null }
              : prev,
          );
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
    },
    [graph, sourceId, destinationId, requireAccessible, mode, avoidStairs],
  );

  const pickAlternative = useCallback(
    (index: number) => {
      setActiveAltIndex(index);
      const alt = alternatives[index];
      if (alt) setRoute(alt);
    },
    [alternatives],
  );

  // ---- map controller registry --------------------------------------------
  const registerMapController = useCallback((c: MapController) => {
    setMapController(c);
  }, []);

  const unregisterMapController = useCallback((kind: MapController["kind"]) => {
    setMapController((prev) => (prev?.kind === kind ? null : prev));
  }, []);

  // ---- auto re-route on preference changes ---------------------------------
  // The Find button (or a deep link) drives the FIRST request. After that,
  // any change to the route inputs — mode, accessible-only, avoid-stairs,
  // endpoints, campus or graph — immediately re-runs the request so the map
  // always shows the route for the currently selected preferences. Guarded
  // by a last-key ref so stable re-renders never re-fire, and skipped while
  // an active navigation session is in progress.
  const recalcKeyRef = useRef<string | null>(null);
  const recalcKey = `${campusSlug}|${sourceId ?? ""}|${destinationId ?? ""}|${mode}|${requireAccessible}|${avoidStairs}`;
  useEffect(() => {
    if (!graph || !sourceId || !destinationId || navSession.active) return;
    // No route yet and no failed attempt: only the Find button / deep-link
    // auto-route may start a request, and there is nothing to update on an
    // input change. Record the key anyway — otherwise the key stays
    // unrecorded through the Find request's loading->ok transition and the
    // effect fires one REDUNDANT second request once the route lands (a
    // duplicate POST per Find click, plus a session-affecting reset when
    // the re-route path is active).
    if (route === null && routeStatus !== "error") {
      recalcKeyRef.current = recalcKey;
      return;
    }
    if (recalcKeyRef.current === recalcKey) return;
    recalcKeyRef.current = recalcKey;
    // Drop the stale route and its alternatives so the map never shows the
    // previous preferences' path while the new request is in flight.
    setRoute(null);
    setAlternatives([]);
    setActiveAltIndex(-1);
    void findRouteRef.current?.();
  }, [recalcKey, graph, route, routeStatus, navSession.active, sourceId, destinationId]);

  // ---- navigation session --------------------------------------------------
  const findRouteRef = useRef<typeof findRoute | null>(null);
  findRouteRef.current = findRoute;

  const updateNavSession = useCallback((patch: Partial<NavSession>) => {
    setNavSession((prev) => ({ ...prev, ...patch }));
  }, []);

  const startNavigation = useCallback(() => {
    // Start from where you are: with a live fix, re-run the route from the
    // snapped node so the session and the walker share the user's real
    // origin instead of the last planned source. The route response lands
    // before the next fix and restarts the walker at step 0 (findRoute
    // resets the session phase when active). The snap must not be the
    // destination itself — that request would 400 (same source/destination)
    // and destroy the route mid-session.
    const snap = nearestNodeHit;
    if (
      snap &&
      sourceId &&
      destinationId &&
      snap.node_id !== sourceId &&
      snap.node_id !== destinationId
    ) {
      void findRouteRef.current?.({ sourceId: snap.node_id });
    }
    setNavSession({
      active: true,
      phase: "navigating",
      stepIndex: 0,
      startedAt: Date.now(),
      remainingM: null,
      etaSec: null,
      offRoute: false,
    });
    // Walking navigation needs a live GPS fix — kick the locator off as
    // part of starting, so the walker actually tracks without the user
    // having to remember the locate button.
    locate.locate();
  }, [locate, nearestNodeHit, sourceId, destinationId]);

  const cancelNavigation = useCallback(() => {
    setNavSession(IDLE_NAV);
  }, []);

  const setNavStep = useCallback((index: number) => {
    setNavSession((prev) => ({ ...prev, stepIndex: Math.max(0, index) }));
  }, []);

  // ---- live tracking engine (GPS -> nav state) -----------------------------
  // Projects each fix onto the route geometry and drives stepIndex/arrival/
  // remaining/ETA/off-route. Accuracy-gated: fixes worse than 40 m cannot
  // advance steps or declare arrival, and a step boundary must be crossed
  // twice (hysteresis) before the instruction turns over. Off-route episodes
  // trigger one automatic re-route from the snapped node.
  const NAV_FIX_MAX_ACCURACY_M = 40;
  const NAV_FIX_COARSE_ACCURACY_M = 80;
  const NAV_ARRIVED_M = 20;
  const NAV_OFFROUTE_M = 50;
  const NAV_OFFROUTE_CLEAR_M = 30;
  const NAV_FALLBACK_SPEED_MPS = 75 / 60;
  const paceSamplesRef = useRef<number[]>([]);
  const lastFixRef = useRef<{ at: number; distM: number } | null>(null);
  const crossedRef = useRef<{ step: number; count: number } | null>(null);
  const reRouteInFlightRef = useRef(false);

  // Fresh sessions start with clean tracking state.
  useEffect(() => {
    if (navSession.active) {
      paceSamplesRef.current = [];
      lastFixRef.current = null;
      crossedRef.current = null;
      reRouteInFlightRef.current = false;
    }
  }, [navSession.active]);

  useEffect(() => {
    if (!navSession.active || !route || !graph) return;
    const fix = locate.coords;
    if (locate.status !== "ok" || !fix) return;
    // Two-tier accuracy gate: a coarse fix (40-80 m — typical phone GPS in
    // a canyon or indoors) still refreshes remaining distance and ETA, but
    // only a fine fix may advance steps, declare arrival or judge off-route
    // (those decisions need decimeter-grade projection). Junk fixes
    // (> 80 m) are ignored entirely.
    if (fix.accuracyM > NAV_FIX_COARSE_ACCURACY_M) return;
    const coarse = fix.accuracyM > NAV_FIX_MAX_ACCURACY_M;

    const model = buildRouteGeometryModel(route, graph);
    if (model.totalM <= 0 || model.polyline.length < 2) return;
    const proj = projectOnRoute(fix.lat, fix.lng, model);

    if (navSession.phase === "arrived") {
      // A session stays on "arrived" unless a fine, honest fix shows the
      // walker has clearly LEFT the destination zone — the arrival gate in
      // reverse, with margin so one fix near the boundary can't flap the
      // phase. Covers a multipath glitch that falsely triggered arrival and
      // walking past the destination: guidance must resume either way.
      if (coarse || model.totalM - proj.distM <= NAV_ARRIVED_M + 50) return;
      crossedRef.current = null;
      updateNavSession({
        phase: "navigating",
        offRoute: false,
        // A departure is a fresh context like a re-snap: the step is the
        // honest projection of the current fix, not a continuation of the
        // finished walk.
        stepIndex: Math.max(0, proj.stepIndex),
      });
    }

    // Arrival: the projection has effectively reached the end of the route.
    if (!coarse && (model.totalM - proj.distM <= NAV_ARRIVED_M || proj.frac >= 0.99)) {
      updateNavSession({ phase: "arrived", remainingM: 0, etaSec: 0, offRoute: false });
      return;
    }

    // Step advance with 2-fix hysteresis: a boundary must be crossed on two
    // consecutive processed fixes before the step turns over, so jitter
    // around a turn can't flip instructions back and forth.
    if (!coarse) {
      if (proj.stepIndex > navSession.stepIndex) {
        const crossed = crossedRef.current;
        if (crossed && crossed.step === proj.stepIndex) {
          crossedRef.current = null;
          updateNavSession({ stepIndex: proj.stepIndex });
        } else {
          crossedRef.current = { step: proj.stepIndex, count: 1 };
        }
      } else if (proj.stepIndex < navSession.stepIndex) {
        // GPS regressed behind the current step — wait for a stable re-cross.
        crossedRef.current = null;
      } else {
        crossedRef.current = null;
      }
    }

    // Remaining distance + ETA with pace smoothing (A2): instantaneous
    // speed between fixes, median of the last samples, capped to sanity.
    const now = Date.now();
    const last = lastFixRef.current;
    const remainingM = Math.max(0, model.totalM - proj.distM);
    let paceMps = NAV_FALLBACK_SPEED_MPS;
    if (last && now - last.at >= 1000) {
      const dt = (now - last.at) / 1000;
      const speed = (proj.distM - last.distM) / dt;
      if (speed > 0.2 && speed < 3) {
        paceSamplesRef.current.push(speed);
        if (paceSamplesRef.current.length > 5) paceSamplesRef.current.shift();
      }
      if (paceSamplesRef.current.length > 0) {
        const sorted = [...paceSamplesRef.current].sort((a, b) => a - b);
        paceMps = sorted[Math.floor(sorted.length / 2)];
      }
    }
    lastFixRef.current = { at: now, distM: proj.distM };
    const etaSec = Math.round(remainingM / Math.max(0.3, paceMps));

    // Off-route detection + one-shot auto re-route (A4). Toggle thresholds
    // are separate so a fix near the boundary doesn't flap the banner.
    // Coarse fixes can't judge deviations — a blurry fix is already an
    // uncertainty bubble of that size.
    const nearStart = proj.frac < 0.03;
    const offNow = !coarse && !nearStart && proj.offRouteM > NAV_OFFROUTE_M;
    const cleared = proj.offRouteM < NAV_OFFROUTE_CLEAR_M;
    if (offNow && !navSession.offRoute) {
      updateNavSession({ offRoute: true, remainingM, etaSec });
      // Never re-route INTO the destination: the backend rejects a route
      // with source == destination (400), and re-routing is meaningless
      // when the walker is already at the target. The snap may also be
      // stale (it updates on a quiet-position debounce) — same guard.
      if (
        nearestNodeHit &&
        nearestNodeHit.node_id !== destinationId &&
        !reRouteInFlightRef.current
      ) {
        reRouteInFlightRef.current = true;
        findRouteRef.current?.({ sourceId: nearestNodeHit.node_id })?.finally(() => {
          reRouteInFlightRef.current = false;
        });
      }
    } else if (cleared && navSession.offRoute) {
      updateNavSession({ offRoute: false, remainingM, etaSec });
    } else {
      updateNavSession({ remainingM, etaSec });
    }
  }, [
    navSession.active,
    navSession.phase,
    navSession.stepIndex,
    navSession.offRoute,
    route,
    graph,
    locate.status,
    locate.coords,
    nearestNodeHit,
    updateNavSession,
  ]);

  // ---- map follows the walker (navigation mode) ---------------------------
  // Throttled fly-along: recenters on the live fix when the user has moved
  // meaningfully (or after a quiet period), so the walker stays in view
  // without fighting every GPS jitter. Reset whenever a session ends.
  const lastFollowRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  useEffect(() => {
    if (!navSession.active || navSession.phase === "arrived") {
      lastFollowRef.current = null;
      return;
    }
    const fix = locate.coords;
    if (locate.status !== "ok" || !fix || !mapController) return;
    if (fix.accuracyM > NAV_FIX_COARSE_ACCURACY_M) return;
    const last = lastFollowRef.current;
    const now = Date.now();
    if (last) {
      const moved = Math.hypot(fix.lat - last.lat, fix.lng - last.lng) * 111_320;
      if (moved < 20 || now - last.at < 4000) return;
    }
    lastFollowRef.current = { lat: fix.lat, lng: fix.lng, at: now };
    mapController.flyTo(fix.lat, fix.lng, 17);
  }, [navSession.active, navSession.phase, locate.status, locate.coords, mapController]);

  // ---- URL hydration (called once by MapViewHost on mount) ----------------
  const hydrate = useCallback(
    (params: HydratableSearchParams) => {
      const campus = params.get("campus");
      if (campus) {
        explicitCampusRef.current = true;
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