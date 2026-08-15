/**
 * NavStatusBar — the live turn-by-turn banner shown while navigation runs.
 *
 * Purely presentational: the GPS -> step/arrival/progress engine lives in
 * CampusRouteContext (accuracy-gated, hysteresis, off-route re-route). This
 * bar renders the current instruction + progress, announces steps by voice
 * (speechSynthesis) and haptics (vibration) — both user-toggleable and
 * persisted in localStorage — keeps the camera following the walker, and
 * shows the arrival screen when the engine reports the route is done.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Orbit } from "lucide-react";
import { useCampusRoute } from "../campus/CampusRouteContext";
import { bearingDegrees, boundsFromNodes } from "../../lib/geo";
import { nodeImmersive } from "../../lib/immersive";
import type { ImmersiveScene } from "../../lib/navigation-types";
import { ImmersiveViewer } from "../immersive/ImmersiveViewer";

const CAMERA_FOLLOW_ZOOM = 17;
const VOICE_KEY = "campusnav:voice";
const HAPTICS_KEY = "campusnav:haptics";

function voiceEnabled(): boolean {
  return localStorage.getItem(VOICE_KEY) !== "off";
}
function hapticsEnabled(): boolean {
  return localStorage.getItem(HAPTICS_KEY) !== "off";
}

function speak(text: string, enabled: boolean): void {
  if (!enabled || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = 1.05;
  window.speechSynthesis.speak(u);
}

function buzz(ms: number | number[], enabled: boolean): void {
  if (!enabled || !("vibrate" in navigator)) return;
  navigator.vibrate(ms);
}

function formatMinutes(min: number): string {
  const whole = Math.max(1, Math.ceil(min));
  return `${whole} min`;
}

function formatArrival(secFromNow: number): string {
  const d = new Date(Date.now() + secFromNow * 1000);
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
  } = useCampusRoute();
  const [follow, setFollow] = useState(true);
  const [voice, setVoice] = useState(voiceEnabled);
  const [haptics, setHaptics] = useState(hapticsEnabled);
  const lastCheckedRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const announcedRef = useRef(-1);
  const headedToRef = useRef<string | null>(null);

  const destinationLabel = useMemo(() => {
    if (!graph || !route) return null;
    return graph.nodes.find((n) => n.id === route.destination)?.label ?? null;
  }, [graph, route]);

  /**
   * Route-aware 360°: the node the walker is heading toward right now
   * (current step's endpoint, or the destination when the route is done).
   * Purely additive — the viewer never touches navigation state.
   */
  const currentViewpoint = useMemo(() => {
    if (!navSession.active || !route || !graph) return null;
    const steps = route.steps;
    const idx = navSession.stepIndex;
    const nodeId = idx >= 0 && idx < steps.length ? steps[idx].to_node_id : route.destination;
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) return null;
    const scene = nodeImmersive(node);
    return scene ? { label: scene.label ?? node.label, scene } : null;
  }, [navSession.active, navSession.stepIndex, route, graph]);

  const [viewerScene, setViewerScene] = useState<ImmersiveScene | null>(null);
  const [viewerLabel, setViewerLabel] = useState<string>("");

  const step = navSession.active ? (route?.steps ?? null) : null;
  const arrived = navSession.active && navSession.phase === "arrived";

  // ---- voice + haptic announcements: new step, or arrival -----------------
  useEffect(() => {
    if (!navSession.active || !route) {
      announcedRef.current = -1;
      return;
    }
    if (arrived) {
      if (announcedRef.current !== -2) {
        announcedRef.current = -2;
        speak(`You have arrived at ${destinationLabel ?? "your destination"}`, voice);
        buzz([60, 60, 120], haptics);
      }
      return;
    }
    const steps = route.steps;
    const idx = navSession.stepIndex;
    if (idx < 0 || idx >= steps.length) return;
    if (announcedRef.current !== idx) {
      announcedRef.current = idx;
      const text = steps[idx].instruction ?? `Walk ${Math.round(steps[idx].distance_m)} meters`;
      speak(text, voice);
      buzz(60, haptics);
    }
  }, [navSession.active, navSession.stepIndex, arrived, route, destinationLabel, voice, haptics]);

  const toggleVoice = () => {
    setVoice((v) => {
      const next = !v;
      localStorage.setItem(VOICE_KEY, next ? "on" : "off");
      if (next) speak("Voice guidance on", true);
      return next;
    });
  };
  const toggleHaptics = () => {
    setHaptics((h) => {
      const next = !h;
      localStorage.setItem(HAPTICS_KEY, next ? "on" : "off");
      buzz(40, next);
      return next;
    });
  };

  // ---- camera follow: glide to the fix, bearing toward the next node ------
  const checkPosition = useCallback(
    (lat: number, lng: number) => {
      if (!navSession.active) return;
      // Skip only when this identical fix was already processed very recently
      // (prevents camera churn on duplicate GPS samples).
      const prev = lastCheckedRef.current;
      const sameFix =
        prev !== null &&
        Math.abs(prev.lat - lat) < 1e-8 &&
        Math.abs(prev.lng - lng) < 1e-8 &&
        Date.now() - prev.at < 4000;
      if (sameFix) return;
      lastCheckedRef.current = { lat, lng, at: Date.now() };

      const steps = route?.steps ?? [];
      const idx = navSession.stepIndex;
      const targetNode =
        idx < steps.length ? graph?.nodes.find((n) => n.id === steps[idx].to_node_id) : null;
      if (!follow) return;
      mapController?.flyTo(lat, lng, CAMERA_FOLLOW_ZOOM);
      if (mapController?.supportsBearing && targetNode) {
        mapController.resetBearing();
        mapController.setBearing(bearingDegrees(lat, lng, targetNode.lat, targetNode.lng));
      }
    },
    [navSession.active, navSession.stepIndex, route, graph, follow, mapController],
  );

  useEffect(() => {
    if (locate.status === "ok" && locate.coords) {
      checkPosition(locate.coords.lat, locate.coords.lng);
    }
  }, [locate, checkPosition]);

  // Navigation needs a live fix — request one when the session starts and
  // the user hasn't locked geolocation to denied/ok this page-lifetime yet.
  useEffect(() => {
    if (navSession.active && locate.status !== "ok" && locate.status !== "denied") {
      locate.locate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navSession.active]);

  useEffect(() => {
    if (!navSession.active || !route || !graph) return;
    const headedTo = route.destination;
    if (headedToRef.current === headedTo) return;
    headedToRef.current = headedTo;
    const nodes = route.steps
      .map((s) => graph.nodes.find((n) => n.id === s.to_node_id))
      .filter((n): n is NonNullable<typeof n> => !!n)
      .map((n) => ({ lat: n.lat, lng: n.lng }));
    if (nodes.length > 1) {
      const bounds = boundsFromNodes(nodes);
      if (bounds) mapController?.flyToBounds(bounds);
    }
  }, [navSession.active, route, graph, mapController]);

  if (!navSession.active || !step) return null;

  const hasFix = locate.status === "ok" && !!locate.coords;
  const total = step.length;
  const idx = navSession.stepIndex;
  const current = idx < total ? step[idx] : null;
  const remainingM = navSession.remainingM;
  const etaSec = navSession.etaSec;

  const timeText =
    remainingM !== null
      ? etaSec !== null
        ? `${formatMinutes(etaSec / 60)} · ${formatArrival(etaSec)} · ${remainingM.toFixed(0)} m left`
        : `${remainingM.toFixed(0)} m left`
      : null;

  const progressPct = (() => {
    if (arrived) return 100;
    if (remainingM === null || !route || route.total_distance_m <= 0) {
      return total > 0 ? Math.min(100, (idx / total) * 100) : 4;
    }
    const done = route.total_distance_m - remainingM;
    return Math.max(4, Math.min(100, (done / route.total_distance_m) * 100));
  })();

  return (
    <>
      <div
        className={
          "pointer-events-auto absolute bottom-24 left-1/2 z-30 w-[min(92vw,420px)] -translate-x-1/2 rounded-xl border shadow-lg backdrop-blur md:bottom-4 " +
          (arrived
            ? "border-brand-green/50 bg-brand-navy/95"
            : navSession.offRoute
              ? "border-brand-amber/60 bg-brand-navy/95"
              : "border-brand-muted bg-brand-navy/95")
      }
    >
      <div className="flex items-start gap-3 p-3">
        <div className="min-w-0 flex-1">
          {arrived ? (
            <>
              <p className="text-sm font-semibold text-brand-green">
                You've arrived at {destinationLabel ?? "your destination"}
              </p>
              <p className="mt-0.5 text-xs text-brand-subtle">
                Navigation complete. End the session whenever you're ready.
              </p>
            </>
          ) : (
            <>
              <p className="truncate text-sm font-semibold text-brand-text">
                {current?.instruction ?? "Getting ready…"}
              </p>
              <p className="mt-0.5 text-xs text-brand-subtle">
                {navSession.offRoute
                  ? "Off the route — re-routing from your position…"
                  : total - idx > 1
                    ? `${timeText ?? "…"}`
                    : `Last leg · ${remainingM !== null ? remainingM.toFixed(0) + " m" : "…"} left`}
              </p>
            </>
          )}
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand-muted/50">
            <div
              className={
                "h-full rounded-full transition-all " +
                (arrived ? "bg-brand-green" : "bg-brand-cyan")
              }
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {!hasFix && (
            <p className="mt-1.5 text-xs font-medium text-brand-amber">
              GPS signal lost — steps won't advance until it returns.
            </p>
          )}
          {currentViewpoint ? (
            <button
              type="button"
              onClick={() => {
                setViewerScene(currentViewpoint.scene);
                setViewerLabel(currentViewpoint.label);
              }}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-brand-cyan/40 bg-brand-cyan/10 py-1.5 text-xs font-medium text-brand-cyan transition-colors hover:bg-brand-cyan/20"
              aria-label={`See ${currentViewpoint.label} in 360°`}
            >
              <Orbit className="size-3.5" aria-hidden />
              See {currentViewpoint.label} in 360°
            </button>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          <button
            type="button"
            onClick={toggleVoice}
            aria-label={voice ? "Disable voice guidance" : "Enable voice guidance"}
            aria-pressed={voice}
            title={voice ? "Voice guidance on" : "Voice guidance off"}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-brand-muted text-brand-subtle transition-colors hover:bg-brand-surface hover:text-brand-text"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 5 6 9H3v6h3l5 4V5z" strokeLinejoin="round" />
              {voice ? <path d="M15.5 8.5a5 5 0 0 1 0 7" strokeLinecap="round" /> : <path d="M16 9l5 6M21 9l-5 6" strokeLinecap="round" />}
            </svg>
          </button>
          <button
            type="button"
            onClick={toggleHaptics}
            aria-label={haptics ? "Disable haptics" : "Enable haptics"}
            aria-pressed={haptics}
            title={haptics ? "Haptics on" : "Haptics off"}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-brand-muted text-brand-subtle transition-colors hover:bg-brand-surface hover:text-brand-text"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              {haptics ? (
                <>
                  <path d="M6 8v8M10 5v14M14 7v10M18 9v6" strokeLinecap="round" />
                </>
              ) : (
                <>
                  <path d="M6 8v8M10 5v14M14 7v10M18 9v6" strokeLinecap="round" />
                  <path d="M4 4l16 16" strokeLinecap="round" />
                </>
              )}
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setFollow((f) => !f)}
            aria-label={follow ? "Stop following my location" : "Follow my location"}
            aria-pressed={follow}
            title={follow ? "Following location" : "Not following"}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-brand-muted text-brand-subtle transition-colors hover:bg-brand-surface hover:text-brand-text"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <circle cx="18" cy="6" r="1.6" fill="currentColor" stroke="none" />
            </svg>
          </button>
          <button
            type="button"
            onClick={cancelNavigation}
            aria-label="End navigation"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-brand-red/40 text-brand-red transition-colors hover:bg-brand-red/10"
            title="End navigation"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
      {arrived ? (
        <div className="border-t border-brand-muted/50 p-3">
          <button
            type="button"
            onClick={cancelNavigation}
            className="w-full rounded-lg border border-brand-green/40 bg-brand-green/10 py-2 text-sm font-medium text-brand-green transition-colors hover:bg-brand-green/20"
          >
            Done · Return to map
          </button>
        </div>
      ) : null}
    </div>
    <ImmersiveViewer
      open={viewerScene !== null}
      scene={viewerScene}
      placeLabel={viewerLabel}
      onClose={() => {
        setViewerScene(null);
        setViewerLabel("");
      }}
    />
    </>
  );
}