/**
 * MapControls — floating map controls (recenter, locate, edge layers,
 * fullscreen, north). Renderer-agnostic: every action goes through the
 * active MapController registered by MapCanvas/LeafletCanvas, and
 * geolocation state lives in CampusRouteContext — one instance serves
 * both renderer branches.
 */
import { lazy, useEffect, useRef, useState } from "react";
import { Compass, Focus, Loader2, LocateFixed, LocateOff, Maximize2, Minimize2, Route as RouteIcon } from "lucide-react";

import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { Bounds2D } from "@/features/campus/CampusRouteContext";
import { useCampusRoute } from "@/features/campus/CampusRouteContext";
import { MapAssistantNotch } from "@/features/assistant/MapAssistant";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import type { LocateStatus } from "./useLiveLocation";

// DEV-only engineering panel. Lazy + gated so the simulation fixtures never
// enter a production bundle: in prod builds import.meta.env.DEV is statically
// false and Rollup drops this entire branch (including the sim module).
const NavigationDiagnostics = import.meta.env.DEV
  ? lazy(() =>
      import("@/sim/NavigationDiagnostics").then((m) => ({
        default: m.NavigationDiagnostics,
      })),
    )
  : null;

/** Toast the locate failure once the state machine settles (not per click). */
function useLocateFailureToast(locateStatus: LocateStatus, error: string | null) {
  const { toast } = useToast();
  const notified = useRef<LocateStatus | null>(null);

  useEffect(() => {
    if (locateStatus !== "denied" && locateStatus !== "unavailable") return;
    if (notified.current === locateStatus) return;
    notified.current = locateStatus;
    toast({ title: "Location unavailable", description: error ?? undefined, tone: "error" });
  }, [locateStatus, error, toast]);
}

export function MapControls({
  campusBounds,
  assistantOpen,
  onToggleAssistant,
}: {
  campusBounds: Bounds2D;
  assistantOpen: boolean;
  onToggleAssistant: () => void;
}) {
  const { locate, mapController, edgesVisible, setEdgesVisible, outsideCampus } = useCampusRoute();
  useLocateFailureToast(locate.status, locate.error);
  const { toast } = useToast();
  const [fullscreen, setFullscreen] = useState(false);
  const outsideNotified = useRef(false);

  // Honest "you are outside the campus" notice — once per fix, not nagging.
  useEffect(() => {
    if (!outsideCampus) {
      outsideNotified.current = false;
      return;
    }
    if (outsideNotified.current) return;
    outsideNotified.current = true;
    toast({
      title: "You appear to be outside this campus",
      description: "Routes need a campus graph — the closest node to you is far away. Try a campus near you.",
      tone: "info",
    });
  }, [outsideCampus, toast]);

  // Fullscreen state follows the browser (Esc exits independently of us).
  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs as EventListener);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs as EventListener);
    };
  }, []);

  // You-are-here marker: drawn by whichever renderer is mounted, with the
  // GPS accuracy halo so the estimate's honesty is visible. Only a denied
  // permission removes the dot: transient errors (timeout/unavailable that
  // the watch survives) or a re-acquisition keep the last fix visible —
  // wiping the dot on every GPS hiccup made tracking look broken mid-walk.
  //
  // Visual smoothing: the marker glides via an exponential average toward
  // the raw fix (and skips sub-threshold jitter), so tiny GPS fluctuations
  // don't make it jump. The smoothing touches ONLY the drawn marker — the
  // navigation engine always receives the raw fix from useLiveLocation.
  const drawnRef = useRef<{ lat: number; lng: number } | null>(null);
  const DRAW_ALPHA = 0.5;
  const MIN_DRAW_M = 1.5;
  useEffect(() => {
    if (!mapController) return;
    if (locate.status === "ok" && locate.coords) {
      const raw = locate.coords;
      const prev = drawnRef.current;
      let drawn = prev;
      if (!drawn) {
        drawn = { lat: raw.lat, lng: raw.lng };
      } else {
        const distM = Math.hypot(raw.lat - drawn.lat, raw.lng - drawn.lng) * 111_320;
        if (distM >= MIN_DRAW_M) {
          drawn = {
            lat: drawn.lat + (raw.lat - drawn.lat) * DRAW_ALPHA,
            lng: drawn.lng + (raw.lng - drawn.lng) * DRAW_ALPHA,
          };
        }
      }
      drawnRef.current = drawn;
      mapController.setUserMarker(drawn.lat, drawn.lng, raw.headingDeg);
      mapController.setUserAccuracy(drawn.lat, drawn.lng, raw.accuracyM);
    } else if (locate.status === "denied") {
      drawnRef.current = null;
      mapController.clearUserMarker();
      mapController.setUserAccuracy(0, 0, null);
    }
  }, [mapController, locate.status, locate.coords]);

  // Camera follows the fix after a locate press: the first fix to land (or
  // a fix that moved meaningfully since the last follow) flies the map to
  // it, so the dot is actually in view — not hidden off-screen.
  const locateFlyingRef = useRef(false);
  const lastFlyRef = useRef<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (!locateFlyingRef.current || locate.status !== "ok" || !locate.coords || !mapController) {
      return;
    }
    const { lat, lng } = locate.coords;
    const last = lastFlyRef.current;
    const movedEnough = !last || Math.hypot(lat - last.lat, lng - last.lng) * 111_320 > 5;
    if (!movedEnough) return;
    lastFlyRef.current = { lat, lng };
    mapController.flyTo(lat, lng, 16);
    // Keep following while fixes keep coming; the user's own panning is
    // free to break out of it (any interaction just stops the fly mode).
  }, [mapController, locate.status, locate.coords]);

  // Any manual map interaction ends the follow-a-fix mode (persistent
  // listeners — a later locate press re-enables flying again).
  useEffect(() => {
    if (!mapController) return;
    const stop = () => {
      locateFlyingRef.current = false;
    };
    const container = mapController.getContainer();
    container?.addEventListener("pointerdown", stop);
    container?.addEventListener("wheel", stop);
    return () => {
      container?.removeEventListener("pointerdown", stop);
      container?.removeEventListener("wheel", stop);
    };
  }, [mapController]);

  const settingsHint = () =>
    toast({
      title: "Location permission is blocked",
      description: "Enable location for this site in your browser's site settings, then tap the locate button again.",
      tone: "info",
    });

  // Always-visible state label for the locate button — the user always
  // knows what the system is doing (idle / acquiring / live / retrying /
  // blocked).
  const locateStatusText = (() => {
    switch (locate.status) {
      case "ok":
        return "Live";
      case "locating":
        return "Locating…";
      case "denied":
        return "Permission\nrequired";
      case "unavailable":
        return locate.retrying ? "Searching\nGPS…" : "Location\nunavailable";
      default:
        return "Use my\nlocation";
    }
  })();
  const locateLabel = (() => {
    switch (locate.status) {
      case "ok":
        return "Live location";
      case "locating":
        return "Locating you...";
      case "denied":
        return "Location permission required — enable it in browser settings, then tap again";
      case "unavailable":
        return locate.retrying ? "Searching for GPS... retrying" : locate.error ?? "Location unavailable";
      default:
        return "Use my location";
    }
  })();

  const onLocate = () => {
    if (locate.status === "locating") return;
    if (locate.status === "ok" && locate.coords) {
      locateFlyingRef.current = true;
      mapController?.flyTo(locate.coords.lat, locate.coords.lng, 16);
      return;
    }
    if (locate.status === "denied") {
      // Chromium lets a page re-request a permission that was denied in the
      // same session — try that before giving up. Safari (iOS/desktop) has
      // no permissions.request at all: re-tapping just tells the user where
      // to unlock it instead of silently doing nothing.
      const req = (navigator.permissions as { request?: (d: { name: PermissionName }) => Promise<PermissionStatus> } | undefined)
        ?.request;
      if (req) {
        void req({ name: "geolocation" })
          .then(() => locate.locate())
          .catch(() => undefined);
        return;
      }
      settingsHint();
      return;
    }
    // (Re)start the watch — the follow mode above lands the camera on the
    // first fix that resolves this request.
    locateFlyingRef.current = true;
    locate.locate();
  };

  const onRecenter = () => mapController?.recenter(campusBounds);

  const onFullscreen = () => {
    const container = mapController?.getContainer();
    if (!container) return;
    const el = container as HTMLElement & {
      webkitRequestFullscreen?: () => void;
      webkitExitFullscreen?: () => void;
    };
    if (document.fullscreenElement) {
      if (document.exitFullscreen) void document.exitFullscreen();
      else el.webkitExitFullscreen?.();
    } else if (el.requestFullscreen) {
      void el.requestFullscreen();
    } else {
      el.webkitRequestFullscreen?.();
    }
  };

  return (
    <div className="absolute bottom-4 right-3 z-30 flex flex-col gap-1.5">
      {/* No overflow-hidden here: the per-button tooltips slide out to the
          left of the column and must not be clipped by the container. */}
      <div className="flex flex-col rounded-lg border border-brand-muted bg-brand-deep/90 shadow-float backdrop-blur">
        <TooltipIconButton label="Recenter on campus" onClick={onRecenter}>
          <Focus className="size-4" aria-hidden />
        </TooltipIconButton>
        {/* Locate button with an honest, always-visible state label. */}
        <button
          type="button"
          onClick={onLocate}
          aria-label={locateLabel}
          title={locateLabel}
          className={cn(
            "group/loc relative flex w-full flex-col items-center justify-center gap-0.5 rounded-md border border-transparent px-1 py-1.5",
            "transition-all duration-200 ease-out",
            "hover:-translate-y-0.5 hover:scale-110 hover:border-brand-cyan/60 hover:bg-brand-cyan/10 hover:shadow-[0_0_18px_rgba(45,212,191,0.35)]",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
            locate.status === "ok"
              ? "text-brand-cyan"
              : locate.status === "denied"
                ? "text-brand-amber"
                : "text-brand-subtle",
          )}
        >
          {locate.status === "locating" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : locate.status === "denied" ? (
            <LocateOff className="size-4 text-brand-amber" aria-hidden />
          ) : (
            <LocateFixed className="size-4" aria-hidden />
          )}
          <span
            className={cn(
              "max-w-[5.5rem] text-center text-[8.5px] font-semibold leading-tight tracking-wide",
              locate.status === "ok" && "text-brand-cyan",
              (locate.status === "unavailable" || locate.status === "locating") && "text-brand-amber",
            )}
          >
            {locateStatusText}
          </span>
        </button>
        {/* Raw-graph debug overlay. Only reachable in development builds
            (VITE_SHOW_GRAPH_DEBUG=true); never shown in production so the
            routing network can't be mistaken for the active route. */}
        {import.meta.env.VITE_SHOW_GRAPH_DEBUG === "true" ? (
          <TooltipIconButton
            label={edgesVisible ? "Hide campus pathways" : "Show campus pathways"}
            onClick={() => setEdgesVisible(!edgesVisible)}
            pressed={edgesVisible}
          >
            <RouteIcon className={edgesVisible ? "size-4 text-brand-cyan" : "size-4"} aria-hidden />
          </TooltipIconButton>
        ) : null}
        {mapController?.supportsBearing ? (
          <TooltipIconButton label="Reset map north" onClick={() => mapController.resetBearing()}>
            <Compass className="size-4" aria-hidden />
          </TooltipIconButton>
        ) : null}
        <TooltipIconButton
          label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          onClick={onFullscreen}
          pressed={fullscreen}
        >
          {fullscreen ? <Minimize2 className="size-4" aria-hidden /> : <Maximize2 className="size-4" aria-hidden />}
        </TooltipIconButton>
        {/* Dev-only diagnostics (real-GPS status card + simulated-GPS
            controls). Never rendered in production builds — import.meta.env.DEV
            is statically false after Rollup's production pass. */}
        {import.meta.env.DEV && NavigationDiagnostics ? <NavigationDiagnostics /> : null}
        {/* NOVA chat — the round notch at the bottom of the map controls. */}
        <MapAssistantNotch open={assistantOpen} onToggle={onToggleAssistant} />
      </div>
    </div>
  );
}