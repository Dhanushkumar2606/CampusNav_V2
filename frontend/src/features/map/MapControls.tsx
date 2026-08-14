/**
 * MapControls — floating map controls (recenter, locate, edge layers,
 * fullscreen, north). Renderer-agnostic: every action goes through the
 * active MapController registered by MapCanvas/LeafletCanvas, and
 * geolocation state lives in CampusRouteContext — one instance serves
 * both renderer branches.
 */
import { useEffect, useRef, useState } from "react";
import { Compass, Focus, Loader2, LocateFixed, LocateOff, Maximize2, Minimize2, Route as RouteIcon } from "lucide-react";

import { useToast } from "@/components/ui/toast";
import type { Bounds2D } from "@/features/campus/CampusRouteContext";
import { useCampusRoute } from "@/features/campus/CampusRouteContext";
import type { LocateStatus } from "./useLiveLocation";

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

export function MapControls({ campusBounds }: { campusBounds: Bounds2D }) {
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
  // GPS accuracy halo so the estimate's honesty is visible.
  useEffect(() => {
    if (!mapController) return;
    if (locate.status === "ok" && locate.coords) {
      mapController.setUserMarker(locate.coords.lat, locate.coords.lng);
      mapController.setUserAccuracy(locate.coords.lat, locate.coords.lng, locate.coords.accuracyM);
    } else if (locate.status === "denied" || locate.status === "unavailable") {
      mapController.clearUserMarker();
      mapController.setUserAccuracy(0, 0, null);
    }
  }, [mapController, locate.status, locate.coords]);

  const onLocate = () => {
    if (locate.status === "locating") return;
    if (locate.status === "ok" && locate.coords) {
      mapController?.flyTo(locate.coords.lat, locate.coords.lng, 16);
      return;
    }
    if (locate.status === "denied") {
      // Chromium lets a page re-request a permission that was denied in the
      // same session — try that before giving up with just a toast.
      const req = (navigator.permissions as { request?: (d: { name: PermissionName }) => Promise<PermissionStatus> } | undefined)
        ?.request;
      if (req) {
        void req({ name: "geolocation" })
          .then(() => locate.locate())
          .catch(() => undefined);
        return;
      }
    }
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

  const btn =
    "flex h-9 w-9 items-center justify-center rounded-md text-brand-subtle transition-colors hover:bg-brand-surface hover:text-brand-text";

  return (
    <div className="absolute bottom-4 right-3 z-30 flex flex-col gap-1.5">
      <div className="flex flex-col overflow-hidden rounded-lg border border-brand-muted bg-brand-deep/90 shadow-float backdrop-blur">
        <button type="button" className={btn} onClick={onRecenter} aria-label="Recenter on campus" title="Recenter">
          <Focus className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          className={btn}
          onClick={onLocate}
          aria-label="Show my location"
          title="Show my location"
        >
          {locate.status === "locating" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : locate.status === "denied" || locate.status === "unavailable" ? (
            <LocateOff className="size-4 text-brand-amber" aria-hidden />
          ) : (
            <LocateFixed className="size-4" aria-hidden />
          )}
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => setEdgesVisible(!edgesVisible)}
          aria-label={edgesVisible ? "Hide campus pathways" : "Show campus pathways"}
          aria-pressed={edgesVisible}
          title="Toggle pathways"
        >
          <RouteIcon className={edgesVisible ? "size-4 text-brand-cyan" : "size-4"} aria-hidden />
        </button>
        {mapController?.supportsBearing ? (
          <button
            type="button"
            className={btn}
            onClick={() => mapController.resetBearing()}
            aria-label="Reset map north"
            title="Reset north"
          >
            <Compass className="size-4" aria-hidden />
          </button>
        ) : null}
        <button
          type="button"
          className={btn}
          onClick={onFullscreen}
          aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          {fullscreen ? <Minimize2 className="size-4" aria-hidden /> : <Maximize2 className="size-4" aria-hidden />}
        </button>
      </div>
    </div>
  );
}