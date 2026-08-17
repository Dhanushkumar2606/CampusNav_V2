/**
 * NavigationDiagnostics — dev-only engineering panel for the location stack.
 *
 * Two cards:
 *  1. GPS STATUS — live readout of the REAL location pipeline (permission
 *     state, provider, watch activity, fix, accuracy, heading, speed,
 *     staleness, error kind, secure context, browser) so a device that
 *     cannot obtain a fix can be diagnosed on the spot.
 *  2. SIM CONTROLS — the deterministic simulated-GPS replay surface
 *     (scenarios, speed, transport/GPS-state buttons). Shown only when the
 *     dev server runs with VITE_SIMULATED_GPS=true.
 *
 * Mounted by MapControls in every dev build (import.meta.env.DEV), so
 * real-device GPS problems can be diagnosed even without the simulator.
 * Like the rest of the simulation/diagnostics code this is dead code in
 * production builds — Rollup eliminates the DEV branch and the module.
 */
import { useEffect, useState } from "react";
import {
  Activity,
  Pause,
  Play,
  RotateCcw,
  ShieldOff,
  Target,
  Wrench,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { createSimulatedLocationSource, type SimulatorControl } from "@/sim/locationSim";
import { SCENARIOS } from "@/sim/scenarios";
import { isSimulatedLocationEnabled } from "@/lib/locationSource";
import { useCampusRoute } from "@/features/campus/CampusRouteContext";
import { runGpsSmokeTest, browserName, secureContextDetail, type GpsSmokeReport } from "@/sim/gpsSmoke";
import { cn } from "@/lib/utils";

const SPEEDS = [1, 5, 10, 30];
const chip = "h-7 px-2 text-[11px] font-medium";

function usePermissionState(): string {
  const [state, setState] = useState("UNKNOWN");
  useEffect(() => {
    if (!navigator.permissions || !("query" in navigator.permissions)) {
      setState("UNKNOWN");
      return;
    }
    let cancelled = false;
    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((status) => {
        if (cancelled) return;
        setState(status.state.toUpperCase());
        status.addEventListener("change", () => setState(status.state.toUpperCase()));
      })
      .catch(() => {
        if (!cancelled) setState("UNKNOWN");
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

export function NavigationDiagnostics() {
  const [control, setControl] = useState<SimulatorControl | null>(null);
  const [open, setOpen] = useState(false);
  const [, forceTick] = useState(0);
  const { locate } = useCampusRoute();
  const [smoke, setSmoke] = useState<GpsSmokeReport | null>(null);
  const [smokeRunning, setSmokeRunning] = useState(false);
  const permission = usePermissionState();

  // Refresh the real-GPS readout every second while the panel is open.
  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => forceTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [open]);

  useEffect(() => {
    if (!isSimulatedLocationEnabled()) return;
    const sim = createSimulatedLocationSource();
    setControl(sim.control);
    return sim.control.onChange(() => forceTick((t) => t + 1));
  }, []);

  // Escape closes the panel. Closing never touches the engine — a running
  // replay keeps streaming fixes while the panel is hidden.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const lastUpdateSec =
    locate.coords && locate.status === "ok"
      ? Math.max(0, Math.round((Date.now() - locate.coords.timestamp) / 1000))
      : null;

  const runSmoke = async () => {
    setSmokeRunning(true);
    setSmoke(null);
    try {
      setSmoke(await runGpsSmokeTest());
    } finally {
      setSmokeRunning(false);
    }
  };

  const provider = isSimulatedLocationEnabled() ? "SIMULATED" : "REAL GPS";
  const watchState = locate.watchActive ? "ACTIVE" : "INACTIVE";
  const sim = control;
  const track = sim?.getTrack() ?? null;
  const cursor = sim?.cursor() ?? -1;
  const running = sim?.isRunning() ?? false;
  const total = track?.fixes.length ?? 0;
  const speed = sim?.speed() ?? 1;
  const simStatus = running ? "RUNNING" : track ? "PAUSED" : "IDLE";

  const row = (label: string, value: string, ok?: boolean) => (
    <div className="flex items-center justify-between gap-2 px-1 text-[11px]">
      <span className="text-brand-subtle">{label}</span>
      <span className={cn("font-semibold", ok === true && "text-brand-green", ok === false && "text-brand-red")}>
        {value}
      </span>
    </div>
  );

  return (
    <>
      <TooltipIconButton
        label="Navigation diagnostics"
        onClick={() => setOpen((v) => !v)}
        pressed={open}
        aria-expanded={open}
      >
        <Wrench className="size-4" aria-hidden />
      </TooltipIconButton>

      {open ? (
        <div
          role="dialog"
          aria-label="Navigation diagnostics"
          className="absolute bottom-0 right-full z-40 mr-2 w-[min(20rem,calc(100vw-4rem))] rounded-xl border border-brand-muted bg-brand-deep/95 shadow-float backdrop-blur"
        >
          {/* Header — provider + watch at a glance. */}
          <div className="flex items-center justify-between gap-2 border-b border-brand-muted/60 px-3 py-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-brand-text">
              Navigation Diagnostics
            </span>
            <span className="flex items-center gap-1.5 text-[10px] font-medium text-brand-subtle">
              <span
                aria-hidden
                className={cn(
                  "size-1.5 rounded-full",
                  watchState === "ACTIVE" ? "bg-brand-green shadow-glow" : "bg-brand-muted",
                )}
              />
              {provider} · WATCH {watchState}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation diagnostics"
                className="ml-1 rounded p-0.5 text-brand-subtle transition-colors hover:bg-brand-surface hover:text-brand-text"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </span>
          </div>

          <div className="max-h-[min(60dvh,28rem)] space-y-2 overflow-y-auto p-2.5">
            {/* ---- REAL GPS status card ---------------------------------- */}
            <div className="rounded-lg border border-brand-muted/50 p-1.5">
              <p className="flex items-center gap-1 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-brand-cyan">
                <Activity className="size-3" aria-hidden /> GPS Status
              </p>
              {row("Permission", permission)}
              {row("Provider", provider)}
              {row("Watch", watchState, locate.watchActive)}
              {row("Secure context", secureContextDetail(), window.isSecureContext === true)}
              {row("Browser", browserName())}
              {row(
                "Status",
                locate.status.toUpperCase() + (locate.retrying ? " (RETRYING)" : ""),
                locate.status === "ok",
              )}
              {row(
                "Position",
                locate.coords
                  ? `${locate.coords.lat.toFixed(6)}, ${locate.coords.lng.toFixed(6)}`
                  : "—",
                !!locate.coords,
              )}
              {row(
                "Accuracy",
                locate.coords ? `${Math.round(locate.coords.accuracyM)} m` : "—",
                !!locate.coords,
              )}
              {row("Altitude", locate.coords?.altitudeM !== undefined ? `${locate.coords.altitudeM.toFixed(1)} m` : "—")}
              {row(
                "Heading",
                locate.coords?.headingDeg !== undefined ? `${Math.round(locate.coords.headingDeg)}°` : "—",
              )}
              {row("Speed", locate.coords?.speedMps !== undefined ? `${locate.coords.speedMps.toFixed(1)} m/s` : "—")}
              {row("Last update", lastUpdateSec !== null ? `${lastUpdateSec} s ago` : "—")}
              {row(
                "Error",
                locate.errorKind ? locate.errorKind.toUpperCase().replace("_", " ") : "NONE",
                !locate.errorKind,
              )}
              {locate.error ? (
                <p className="px-1 pt-1 text-[10px] leading-snug text-brand-amber">{locate.error}</p>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-1.5 w-full"
                onClick={runSmoke}
                disabled={smokeRunning}
              >
                {smokeRunning ? "Running REAL GPS smoke test…" : "Run REAL GPS smoke test"}
              </Button>
              {smoke ? (
                <div className="mt-1.5 space-y-0.5 rounded-md border border-brand-muted/40 p-1.5">
                  <p className="px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-subtle">
                    Smoke results
                  </p>
                  {[
                    ["Geolocation API", smoke.geolocationApi],
                    ["Secure context", smoke.secureContext],
                    ["Permission", { pass: true, detail: `${smoke.permission.state}: ${smoke.permission.detail}` }],
                    ["Initial position", smoke.initialPosition],
                    ["Watch position", smoke.watch],
                    ["Cleanup", smoke.cleanup],
                  ].map(([label, r]) => (
                    <div key={String(label)} className="flex items-start justify-between gap-2 px-1 text-[10px]">
                      <span className="shrink-0 text-brand-subtle">{String(label)}</span>
                      <span
                        className={cn(
                          "text-right",
                          (r as { pass: boolean }).pass ? "text-brand-green" : "text-brand-red",
                        )}
                      >
                        {(r as { pass: boolean }).pass ? "PASS" : "FAIL"}
                      </span>
                    </div>
                  ))}
                  {!smoke.initialPosition.pass && smoke.initialPosition.detail ? (
                    <p className="px-1 pt-1 text-[10px] leading-snug text-brand-amber">
                      {smoke.initialPosition.detail}
                    </p>
                  ) : null}
                  {!smoke.watch.pass && smoke.watch.detail ? (
                    <p className="px-1 text-[10px] leading-snug text-brand-amber">{smoke.watch.detail}</p>
                  ) : null}
                  {!smoke.secureContext.pass ? (
                    <p className="px-1 text-[10px] leading-snug text-brand-red">
                      Open the app over HTTPS or localhost for geolocation to work.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* ---- Simulated GPS controls (dev + VITE_SIMULATED_GPS) ------- */}
            {sim ? (
              <div className="rounded-lg border border-brand-muted/50 p-1.5">
                <p className="flex items-center gap-1 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-brand-cyan">
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 rounded-full",
                      running ? "bg-brand-green shadow-glow" : "bg-brand-muted",
                    )}
                  />
                  Simulated GPS · {simStatus}
                  {speed > 1 ? <span className="text-brand-cyan">· {speed}×</span> : null}
                </p>
                {track ? (
                  <p className="px-1 text-[11px] text-brand-subtle">
                    {track.label} · fix {Math.max(0, cursor + 1)}/{total} · {track.totalM} m
                  </p>
                ) : (
                  <p className="px-1 text-[11px] text-brand-subtle">
                    No track loaded — pick a scenario to replay a deterministic GPS walk.
                  </p>
                )}
                <div className="mt-1 flex flex-wrap gap-1">
                  {SCENARIOS.map((s) => (
                    <Button
                      key={s.id}
                      type="button"
                      variant="secondary"
                      size="sm"
                      className={chip}
                      title={s.needsBackend ? "triggers an automatic re-route via the backend" : undefined}
                      onClick={() => {
                        sim.loadTrack(s.build());
                        sim.start();
                      }}
                    >
                      {s.label}
                    </Button>
                  ))}
                </div>
                <div className="mt-1 flex items-center gap-1 px-1">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-brand-subtle">
                    Speed
                  </span>
                  {SPEEDS.map((s) => (
                    <Button
                      key={s}
                      type="button"
                      variant="secondary"
                      size="sm"
                      className={cn(
                        chip,
                        speed === s && "border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan",
                      )}
                      onClick={() => sim.setSpeed(s)}
                    >
                      {s}×
                    </Button>
                  ))}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Button type="button" variant="secondary" size="sm" className={chip} onClick={() => sim.start()}>
                    <Play className="size-3" aria-hidden /> Start
                  </Button>
                  <Button type="button" variant="secondary" size="sm" className={chip} onClick={() => sim.pause()}>
                    <Pause className="size-3" aria-hidden /> Pause
                  </Button>
                  <Button type="button" variant="secondary" size="sm" className={chip} onClick={() => sim.start()}>
                    <Play className="size-3" aria-hidden /> Resume
                  </Button>
                  <Button type="button" variant="secondary" size="sm" className={chip} onClick={() => sim.seek(0)}>
                    <RotateCcw className="size-3" aria-hidden /> Restart
                  </Button>
                  <Button type="button" variant="secondary" size="sm" className={chip} onClick={() => sim.reset()}>
                    <X className="size-3" aria-hidden /> Clear
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className={chip}
                    onClick={() => sim.pushError("denied")}
                  >
                    <ShieldOff className="size-3" aria-hidden /> Deny
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className={chip}
                    onClick={() => sim.setAccuracy(8)}
                  >
                    <Target className="size-3" aria-hidden /> Fine
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className={chip}
                    onClick={() => sim.setAccuracy(55)}
                  >
                    <Target className="size-3" aria-hidden /> Coarse
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}