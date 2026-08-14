import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCampusRoute } from "../campus/CampusRouteContext";
import { useToast } from "../../components/ui/toast";
import { haversineMeters, bearingDegrees, boundsFromNodes } from "../../lib/geo";

const STEP_ADVANCE_M = 25;
const ARRIVAL_M = 20;
const WALK_SPEED_M_PER_MIN = 75;

function formatMinutes(min: number): string {
  const whole = Math.max(1, Math.ceil(min));
  return `${whole} min`;
}

function formatArrival(minFromNow: number): string {
  const d = new Date(Date.now() + minFromNow * 60_000);
  return `~${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

export function NavStatusBar() {
  const {
    navSession,
    route,
    graph,
    locate,
    mapController,
    cancelNavigation,
    setNavStep,
  } = useCampusRoute();
  const [follow, setFollow] = useState(true);
  const finishedRef = useRef(false);
  const lastCheckedRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const { toast } = useToast();
  const destinationLabel = useMemo(() => {
    if (!graph || !route) return null;
    return graph.nodes.find((n) => n.id === route.destination)?.label ?? null;
  }, [graph, route]);

  const step = navSession.active ? route?.steps ?? null : null;

  const remainingMeters = step
    ? step.slice(navSession.stepIndex).reduce((acc, s) => acc + (s.distance_m ?? 0), 0)
    : 0;

  const arrival = useMemo(() => {
    if (!navSession.startedAt || remainingMeters <= 0 || !step) return null;
    return { min: Math.max(1, Math.ceil(remainingMeters / WALK_SPEED_M_PER_MIN)) };
  }, [navSession.startedAt, remainingMeters, step]);

  const checkPosition = useCallback(
    (lat: number, lng: number) => {
      if (!navSession.active || !route || finishedRef.current) return;
      // Skip only when this identical fix was already processed very recently
      // (prevents camera churn on duplicate GPS samples); every *new* fix is
      // processed immediately so a position change can never fall in a
      // throttle window unnoticed.
      const prev = lastCheckedRef.current;
      const sameFix =
        prev !== null &&
        Math.abs(prev.lat - lat) < 1e-8 &&
        Math.abs(prev.lng - lng) < 1e-8 &&
        Date.now() - prev.at < 4000;
      if (sameFix) return;
      lastCheckedRef.current = { lat, lng, at: Date.now() };
      const idx = navSession.stepIndex;
      const steps = route.steps;
      if (idx >= steps.length) return;
      const node = graph?.nodes?.find((n) => n.id === steps[idx].to_node_id);
      if (!node) return;
      const d = haversineMeters(lat, lng, node.lat, node.lng);
      if (d <= ARRIVAL_M && idx === steps.length - 1) {
        finishedRef.current = true;
        cancelNavigation();
        toast({
          title: `You've arrived at ${destinationLabel ?? "your destination"}`,
          tone: "success",
        });
        return;
      }
      if (d <= STEP_ADVANCE_M && idx < steps.length - 1) {
        setNavStep(idx + 1);
        return;
      }
      if (!follow) return;
      // Identical fix already flew the camera: nothing new to see.
      if (prev && prev.lat === lat && prev.lng === lng) return;
      mapController?.flyTo(lat, lng, 17);
      if (mapController?.supportsBearing && idx < steps.length - 1 && d > 40) {
        mapController.resetBearing();
        mapController.setBearing(bearingDegrees(lat, lng, node.lat, node.lng));
      }
    },
    [navSession.active, navSession.stepIndex, route, graph, follow, mapController, cancelNavigation, setNavStep, toast, destinationLabel],
  );

  useEffect(() => {
    if (locate.status === "ok" && locate.coords) {
      checkPosition(locate.coords.lat, locate.coords.lng);
    }
  }, [locate, checkPosition]);

  useEffect(() => {
    if (!navSession.active) finishedRef.current = false;
  }, [navSession.active]);

  // Navigation needs a live fix — request one when the session starts and
  // the user hasn't locked geolocation to denied/ok this page-lifetime yet.
  useEffect(() => {
    if (navSession.active && locate.status !== "ok" && locate.status !== "denied") {
      locate.locate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navSession.active]);

  useEffect(() => {
    if (navSession.active && route && graph) {
      const coords = route.steps
        .map((s) => graph.nodes.find((n) => n.id === s.to_node_id))
        .filter((n): n is NonNullable<typeof n> => !!n)
        .map((n) => ({ lat: n.lat, lng: n.lng }));
      if (coords.length > 1) {
        const bounds = boundsFromNodes(coords);
        if (bounds) mapController?.flyToBounds(bounds);
      }
    }
  }, [navSession.active, route, graph, mapController]);

  if (!navSession.active || !step) return null;

  const hasFix = locate.status === "ok" && !!locate.coords;
  const current = step[navSession.stepIndex];
  const total = step.length;
  const progress = total > 0 ? Math.min(1, navSession.stepIndex / total) : 0;

  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 z-30 w-[min(92vw,420px)] -translate-x-1/2 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
            {navSession.stepIndex >= total
              ? "Arrived"
              : current?.instruction ?? "Getting ready…"}
          </p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {navSession.stepIndex >= total
              ? "You have reached your destination."
              : step.length - navSession.stepIndex > 1
                ? `${formatMinutes(arrival?.min ?? remainingMeters / WALK_SPEED_M_PER_MIN)} · ${formatArrival(arrival?.min ?? remainingMeters / WALK_SPEED_M_PER_MIN)} · ${remainingMeters.toFixed(0)} m left`
                : `Last leg · ${remainingMeters.toFixed(0)} m left`}
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div
              className="h-full rounded-full bg-teal-500 transition-all"
              style={{ width: `${Math.max(4, progress * 100)}%` }}
            />
          </div>
          {!hasFix && (
            <p className="mt-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
              GPS signal lost — steps won't auto-advance until it returns.
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          <button
            onClick={() => setFollow((f) => !f)}
            aria-label={follow ? "Stop following my location" : "Follow my location"}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            title={follow ? "Following location" : "Not following"}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <circle cx="18" cy="6" r="1.6" fill="currentColor" stroke="none" />
            </svg>
          </button>
          <button
            onClick={cancelNavigation}
            aria-label="End navigation"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
            title="End navigation"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}