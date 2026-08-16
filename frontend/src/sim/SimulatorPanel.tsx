/**
 * SimulatorPanel — dev-only control surface for the simulated GPS.
 *
 * Mounted by MapView ONLY when the dev server runs with
 * VITE_SIMULATED_GPS=true; the import is dead code in production builds
 * (locationSource gates the whole feature behind import.meta.env.DEV).
 *
 * Replays the committed deterministic tracks via the simulated
 * LocationSource so the full navigation flow (route -> start navigation ->
 * tracking -> step turns -> arrival / off-route -> re-route / GPS loss /
 * permission denied) can be driven without moving. The panel itself is
 * inert in tests — the headless driver talks to the same control surface.
 */
import { useEffect, useState } from "react";
import { createSimulatedLocationSource } from "@/sim/locationSim";
import { SCENARIOS } from "@/sim/scenarios";
import { isSimulatedLocationEnabled } from "@/lib/locationSource";
import type { SimulatorControl } from "@/sim/locationSim";

export function SimulatorPanel() {
  const [control, setControl] = useState<SimulatorControl | null>(null);
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!isSimulatedLocationEnabled()) return;
    const sim = createSimulatedLocationSource();
    setControl(sim.control);
    return sim.control.onChange(() => forceTick((t) => t + 1));
  }, []);

  if (!isSimulatedLocationEnabled() || !control) return null;

  const track = control.getTrack();
  const cursor = control.cursor();
  const running = control.isRunning();
  const total = track?.fixes.length ?? 0;

  return (
    <div className="absolute bottom-3 left-1/2 z-40 w-[280px] -translate-x-1/2 rounded-lg border border-cyan-400/50 bg-slate-950/95 p-3 text-xs text-cyan-100 shadow-float [&_button]:rounded [&_button]:border [&_button]:border-cyan-400/40 [&_button]:bg-slate-900 [&_button]:px-2 [&_button]:py-1 [&_button]:text-cyan-100 hover:[&_button]:bg-slate-800">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-cyan-300">GPS SIMULATOR (dev)</span>
        <span className="text-cyan-400/70">{running ? "RUNNING" : track ? "PAUSED" : "IDLE"}{control.speed() > 1 ? ` · ${control.speed()}×` : ""}</span>
      </div>
      {track ? (
        <div className="mb-2 text-cyan-300/80">
          {track.label} · fix {Math.max(0, cursor + 1)}/{total} · {track.totalM} m
        </div>
      ) : null}
      <div className="mb-1 flex flex-wrap gap-1">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              control.loadTrack(s.build());
              control.start();
            }}
            title={s.needsBackend ? "triggers an automatic re-route via the backend" : undefined}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        <button type="button" onClick={() => control.setSpeed(30)}>⚡ 30×</button>
        <button type="button" onClick={() => control.setSpeed(1)}>1×</button>
        <button type="button" onClick={() => control.start()}>▶ Resume</button>
        <button type="button" onClick={() => control.pause()}>⏸ Pause</button>
        <button type="button" onClick={() => control.seek(0)}>⏮ Restart</button>
        <button type="button" onClick={() => control.reset()}>✕ Clear</button>
        <button type="button" onClick={() => control.pushError("denied")}>🚫 Deny</button>
        <button type="button" onClick={() => control.setAccuracy(8)}>◉ Fine</button>
        <button type="button" onClick={() => control.setAccuracy(55)}>◐ Coarse</button>
      </div>
    </div>
  );
}