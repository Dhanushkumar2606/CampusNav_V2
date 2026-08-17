/**
 * ImmersiveViewer — full-screen 360° viewer backed by an external provider.
 * Scene-linked: the scene shown belongs to exactly one building/block —
 * never a whole-site tour.
 *
 * Rules:
 *  - Content is NEVER hosted by CampusNav; the scene's URL is embedded
 *    when the provider allows framing and opened in a new tab otherwise.
 *  - If the embed fails or is blocked, the app never leaves a dead iframe
 *    on screen: it falls back to a clear message + "Open 360° view".
 *  - No immersive failure can break the map or routing — this component is
 *    purely additive and unmounts cleanly.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ExternalLink, Loader2, Navigation, Orbit, RotateCcw, X } from "lucide-react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { immersiveProviderMeta } from "@/lib/immersive";
import type { ImmersiveScene } from "@/lib/navigation-types";
import { prettyLabel } from "@/lib/brand";
import { CubePanorama } from "./CubePanorama";

/** Give a slow tour a little grace before declaring the embed dead. */
const EMBED_WATCHDOG_MS = 20_000;

export interface ImmersiveViewerProps {
  open: boolean;
  scene: ImmersiveScene | null;
  /** Place label shown in the header (falls back to the scene label). */
  placeLabel?: string;
  onClose: () => void;
  /** Optional "Navigate here" action: closes the viewer and routes the user
   *  to this place (the caller decides what that means — set destination,
   *  start routing, etc.). Omit to hide the button. */
  onNavigateHere?: () => void;
  /** Scene-rail position — "3 of 7". Pass along with onPrev/onNextScene to
   *  let users browse the campus's other 360° viewpoints. */
  scenePosition?: { index: number; total: number } | null;
  onPrevScene?: () => void;
  onNextScene?: () => void;
}

type EmbedState = "loading" | "ready" | "error";

export function ImmersiveViewer({
  open,
  scene,
  placeLabel,
  onClose,
  onNavigateHere,
  scenePosition,
  onPrevScene,
  onNextScene,
}: ImmersiveViewerProps) {
  const reduceMotion = useReducedMotion();
  const [state, setState] = useState<EmbedState>("idle" as EmbedState);
  const [attempt, setAttempt] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const provider = immersiveProviderMeta(scene?.provider);
  const title = scene?.label ?? placeLabel ?? "360° View";
  const embedAllowed = provider.embed === "iframe" && !!scene?.url;
  const isCubeScene = provider.embed === "tiles" && !!scene?.mediaId;
  const [cubeUnavailable, setCubeUnavailable] = useState(false);
  // Remounting the cube (fresh texture pipeline) powers "Try again".
  const [cubeKey, setCubeKey] = useState(0);
  const retryCube = useCallback(() => {
    setCubeKey((k) => k + 1);
    setCubeUnavailable(false);
  }, []);

  // Watchdog: if the provider never signals a successful load (blocked,
  // offline, slow), fail over to the external action instead of showing a
  // permanently blank pane. Reset on open / provider / retry.
  useEffect(() => {
    if (!open || !embedAllowed) return;
    setState("loading");
    const t = window.setTimeout(() => {
      // `ready` is set by onLoad; anything else after the grace period is
      // treated as an unavailable embed.
      setState((prev) => (prev === "loading" ? "error" : prev));
    }, EMBED_WATCHDOG_MS);
    return () => window.clearTimeout(t);
  }, [open, embedAllowed, attempt]);

  const onIframeLoad = useCallback(() => setState("ready"), []);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // Escape closes the viewer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Any state left over from a previous session (error panel, retry) must
  // not leak into a fresh open or a different scene. Kept above the
  // early return: hook order must be identical whether or not open.
  useEffect(() => {
    if (open) {
      setCubeUnavailable(false);
      setCubeKey((k) => k + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scene?.mediaId, attempt]);

  if (!open) return null;

  const external = () => {
    if (scene?.url) window.open(scene.url, "_blank", "noopener,noreferrer");
  };

  const viewer = (
    <div className="absolute inset-0 z-[60] flex flex-col bg-brand-deep">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-brand-muted bg-brand-navy px-4 py-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-surface">
          <Orbit className="size-4 text-brand-cyan" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-brand-text">{prettyLabel(title)}</h2>
          <p className="truncate text-xs text-brand-subtle">{provider.label}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close 360° view">
          <X className="size-4" />
        </Button>
      </div>

      {/* Body */}
      <div className="relative min-h-0 flex-1 bg-black">
        {isCubeScene ? (
          cubeUnavailable ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <Orbit className="size-8 text-brand-subtle" aria-hidden />
              <p className="text-base font-medium text-brand-text">
                360° view unavailable for this block.
              </p>
              <p className="text-sm text-brand-subtle">
                The scene's imagery could not be loaded right now.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button variant="outline" onClick={retryCube}>
                  <RotateCcw className="size-4" aria-hidden />
                  Try again
                </Button>
                <Button variant="ghost" onClick={onClose}>
                  Close
                </Button>
              </div>
            </div>
          ) : (
            <CubePanorama
              key={cubeKey}
              scene={scene!}
              placeLabel={placeLabel}
              onUnavailable={() => setCubeUnavailable(true)}
              scenePosition={scenePosition}
              onPrevScene={onPrevScene}
              onNextScene={onNextScene}
            />
          )
        ) : embedAllowed ? (
          <>
            <iframe
              ref={iframeRef}
              key={`${scene!.url}|${attempt}`}
              src={scene!.url!}
              title={title}
              onLoad={onIframeLoad}
              allow="gyroscope; accelerometer; magnetometer; xr-spatial-tracking"
              referrerPolicy="no-referrer-when-downgrade"
              className="absolute inset-0 h-full w-full border-0"
            />
            {/* Loading veil — replaced by the iframe content once loaded. */}
            {state === "loading" ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-brand-deep">
                <Loader2 className="size-6 animate-spin text-brand-cyan" aria-hidden />
                <p className="text-sm text-brand-subtle">Loading 360° view…</p>
              </div>
            ) : null}
          </>
        ) : null}

        {/* Embed unavailable / opens externally — never a dead iframe. */}
        {!isCubeScene && (!embedAllowed || state === "error") ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
            <Orbit className="size-8 text-brand-subtle" aria-hidden />
            <div>
              <p className="text-base font-medium text-brand-text">
                {scene?.url ? "This 360° view opens in a new tab." : "360° view unavailable for this location."}
              </p>
              <p className="mt-1 text-sm text-brand-subtle">
                {scene?.url
                  ? "Imagery is hosted by the campus 360° provider — CampusNav only links to it."
                  : "No 360° scene has been provided for this block yet."}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {scene?.url ? (
                <Button onClick={external}>
                  <ExternalLink className="size-4" aria-hidden />
                  Open 360° view
                </Button>
              ) : null}
              {embedAllowed ? (
                <Button variant="outline" onClick={retry}>
                  <RotateCcw className="size-4" aria-hidden />
                  Try again
                </Button>
              ) : null}
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-brand-muted bg-brand-navy px-4 py-2.5">
        <p className="min-w-0 truncate text-xs text-brand-subtle">
          Scene provided by {provider.label} — CampusNav only links to it.
        </p>
        {onNavigateHere ? (
          <Button
            size="sm"
            onClick={() => {
              onClose();
              onNavigateHere();
            }}
            className="shrink-0"
          >
            <Navigation className="size-3.5" aria-hidden />
            Navigate here
          </Button>
        ) : null}
        {scene?.url ? (
          <Button variant="ghost" size="sm" onClick={external} className="shrink-0">
            <ExternalLink className="size-3.5" aria-hidden />
            Open in new tab
          </Button>
        ) : null}
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.15 }}
    >
      {viewer}
    </motion.div>,
    document.body,
  );
}
