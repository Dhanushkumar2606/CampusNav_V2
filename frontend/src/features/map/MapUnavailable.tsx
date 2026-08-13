/**
 * Honest unavailable-state for the interactive map. Shown instead of the
 * MapLibre canvas when WebGL can't be initialized (hardware acceleration
 * off, VM/remote desktop, GPU driver blocked) or when the map layer throws.
 */
import { MapPinOff } from "lucide-react";

export function MapUnavailable() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-sm rounded-xl border border-brand-muted bg-brand-navy/60 p-6 text-center">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-brand-amber/15 text-brand-amber">
          <MapPinOff className="size-6" aria-hidden />
        </div>
        <h2 className="text-base font-semibold text-brand-text">Interactive map unavailable</h2>
        <p className="mt-2 text-sm leading-relaxed text-brand-subtle">
          The map needs WebGL, which couldn't be initialized in this
          browser. Enable hardware acceleration (or use Chrome/Edge/Safari
          with it on) to see the campus map.
        </p>
        <p className="mt-3 text-xs text-brand-subtle">
          Routing, search and the assistant still work from the panel.
        </p>
      </div>
    </div>
  );
}