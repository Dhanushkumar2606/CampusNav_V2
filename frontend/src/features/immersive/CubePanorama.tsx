/**
 * CubePanorama — the 360° viewer, now a real GPU cubemap.
 *
 * The scene is rendered by WebGL (Three.js): camera at the cube centre,
 * six outward-facing planes whose basis comes from the verified CUBE_FACES
 * config, sampled from inside with BackSide materials — geometrically a
 * cubemap as specified ("THREE.CubeTexture or equivalent custom cubemap").
 * Nothing else: no DOM cube, no CSS 3D, no iframe for cube providers.
 *
 * Tiles stream from the backend relay (same-origin → WebGL textures are
 * legal) in three quality levels: 512² renders immediately, then 1024²,
 * then 2048². Each face upgrades the moment its level lands; a failed
 * upgrade keeps the previous detail and never blocks the view.
 *
 * Controls: drag to look around (with inertia), wheel/pinch zoom, and a VR
 * mode that straps the DeviceOrientation sensor to the camera in fullscreen.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Headset, Loader2, Maximize, Minimize, Minus, Plus, RotateCcw, X } from "lucide-react";
import * as THREE from "three";

import type { ImmersiveScene } from "@/lib/navigation-types";
import {
  CUBE_FACES,
  CubemapTileLoader,
  faceTexture,
  LEVELS_DESC,
  LOAD_ORDER,
  type FaceName,
} from "./cubemap";

const PITCH_LIMIT = (82 * Math.PI) / 180;
const FOV_MIN = 35;
const FOV_DEFAULT = 75;
const FOV_MAX = 105;
const VR_SMOOTHING = 0.22;
/** Pitch (radians) past which the deep-quality up/down faces load. */
const VERTICAL_PITCH_RAD = (38 * Math.PI) / 180;
const DEV = import.meta.env.DEV;

/** Camera direction for a view state. yaw 0 = front face (+z),
 *  positive yaw turns right, positive pitch looks down. */
function lookVector(yaw: number, pitch: number): [number, number, number] {
  const cy = Math.cos(yaw);
  return [Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), cy * Math.cos(pitch)];
}

/** Shortest signed angular difference (radians), for wrap-safe damping. */
function angleDelta(from: number, to: number): number {
  return ((((to - from) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
}

export function CubePanorama({
  scene,
  placeLabel,
  onUnavailable,
  scenePosition,
  onPrevScene,
  onNextScene,
}: {
  scene: ImmersiveScene;
  /** Place label from the caller (may differ from the scene label). */
  placeLabel?: string;
  onUnavailable?: () => void;
  /** Scene-rail position — "3 of 7". Omit to hide prev/next. */
  scenePosition?: { index: number; total: number } | null;
  onPrevScene?: () => void;
  onNextScene?: () => void;
}) {
  const mediaId = scene.mediaId ?? "";

  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const cubeRef = useRef<THREE.Group | null>(null);
  const matsRef = useRef<Partial<Record<FaceName, THREE.MeshBasicMaterial>>>({});
  const loaderRef = useRef<CubemapTileLoader | null>(null);

  /** Instant view state (reads in the render loop) + smoothed drag target. */
  const viewRef = useRef({
    yaw: ((scene.initialHeading ?? 0) * Math.PI) / 180,
    pitch: ((scene.initialPitch ?? 0) * Math.PI) / 180,
    zoom: 1,
  });
  const targetRef = useRef({ ...viewRef.current });

  const [stage, setStage] = useState<"loading" | "ready" | "error">("loading");
  const [quality, setQuality] = useState(2);
  const [degraded, setDegraded] = useState(false);
  const [compassYaw, setCompassYaw] = useState(0);
  const [vrMode, setVrMode] = useState(false);
  const [vrDenied, setVrDenied] = useState(false);

  const dragRef = useRef({ x: 0, y: 0, active: false, vx: 0, vy: 0, lastT: 0 });
  const inertiaRef = useRef<number | null>(null);
  /** Set when the user looks near the ceiling/floor (or grabs the zoom) —
   *  gates the deep-quality u/d face upgrade. */
  const verticalPitchSeenRef = useRef(false);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  const vrRef = useRef({
    active: false,
    calibrated: false,
    calibYaw: 0,
    calibPitch: 0,
    targetYaw: 0,
    targetPitch: 0,
  });

  /* --------------------------------------------------------------- *
   * Renderer + cube (GPU cubemap geometry, set up once).             *
   * --------------------------------------------------------------- */

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    mount.appendChild(renderer.domElement);

    const threeScene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70);
    camera.near = 0.1;
    camera.far = 10;
    camera.position.set(0, 0, 0);

    const group = new THREE.Group();
    const mats: Partial<Record<FaceName, THREE.MeshBasicMaterial>> = {};

    (Object.keys(CUBE_FACES) as FaceName[]).forEach((face) => {
      const { u, v, n } = CUBE_FACES[face];
      const geo = new THREE.PlaneGeometry(2, 2);
      const mat = new THREE.MeshBasicMaterial({ side: THREE.BackSide });
      const mesh = new THREE.Mesh(geo, mat);
      // Local +x (image right) -> u, +y (image top) -> v, +z -> outward normal.
      mesh.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(
          new THREE.Vector3(...u),
          new THREE.Vector3(...v),
          new THREE.Vector3(...n),
        ),
      );
      mesh.position.set(...n);
      group.add(mesh);
      mats[face] = mat;
    });
    threeScene.add(group);

    // Apply initial FOV (clamped into the interactive range).
    camera.fov = Math.max(FOV_MIN, Math.min(FOV_MAX, (scene.initialFov ?? FOV_DEFAULT)));
    camera.updateProjectionMatrix();

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      // setSize(..., false) never touches the CSS size — the container owns
      // layout; the drawing buffer follows it 1:1 (× devicePixelRatio).
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    // Belt-and-braces for cases ResizeObserver misses (Safari fullscreen,
    // mobile URL-bar collapses, late layout): re-measure on window resize,
    // fullscreen toggles and after the first tiles land.
    window.addEventListener("resize", resize);
    document.addEventListener("fullscreenchange", resize);
    const readyRace = window.setTimeout(resize, 500);

    // Render loop: damped follow toward the drag/VR target, then draw.
    let lastCompassSync = 0;
    renderer.setAnimationLoop(() => {
      const v = viewRef.current;
      const vr = vrRef.current;
      if (vr.active && vr.calibrated) {
        // Head-tracked look (VR): damp toward the orientation target.
        v.yaw += angleDelta(v.yaw, vr.targetYaw) * VR_SMOOTHING;
        v.pitch += (vr.targetPitch - v.pitch) * VR_SMOOTHING;
      } else {
        const t = targetRef.current;
        const damping = vr.active ? VR_SMOOTHING : 0.18;
        v.yaw += angleDelta(v.yaw, t.yaw) * damping;
        v.pitch += (t.pitch - v.pitch) * damping;
      }
      camera.fov = Math.max(FOV_MIN, Math.min(FOV_MAX, FOV_DEFAULT / v.zoom));
      camera.updateProjectionMatrix();
      camera.lookAt(...lookVector(v.yaw, v.pitch));
      renderer.render(threeScene, camera);
      // Throttled sync of the cube-relative heading into React (compass).
      const now = performance.now();
      if (now - lastCompassSync > 120) {
        lastCompassSync = now;
        setCompassYaw(((v.yaw * 180) / Math.PI % 360 + 360) % 360);
      }
    });

    rendererRef.current = renderer;
    cameraRef.current = camera;
    cubeRef.current = group;
    matsRef.current = mats;

    return () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      window.removeEventListener("resize", resize);
      document.removeEventListener("fullscreenchange", resize);
      window.clearTimeout(readyRace);
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const m = obj.material as THREE.MeshBasicMaterial;
          m.map?.dispose();
          m.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      loaderRef.current?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* --------------------------------------------------------------- *
   * Progressive tile loading — 512² preview, then 1024², then 2048². *
   * --------------------------------------------------------------- */

  useEffect(() => {
    if (!mediaId) {
      setStage("error");
      onUnavailable?.();
      return;
    }
    const loader = new CubemapTileLoader(mediaId);
    loaderRef.current = loader;
    let cancelled = false;

    (async () => {
      for (const level of LEVELS_DESC) {
        let faces: Record<FaceName, HTMLCanvasElement>;
        try {
          faces = await loader.loadAllFaces(level);
        } catch (err) {
          if (cancelled) return;
          if (level === 2) {
            setStage("error");
            onUnavailable?.();
          } else {
            // A deeper level failed: keep the last good quality, and mark
            // the scene degraded so the "Improving quality…" chip settles.
            setDegraded(true);
          }
          return;
        }
        if (cancelled || !matsRef.current) return;

        // Upgrade per face, in priority order (ring first, then up/down).
        // The deep-quality up/down faces are gated: they only upgrade once
        // the user actually tilts toward the ceiling/floor (set by the
        // pointer/wheel/VR handlers), or after a short idle grace — so the
        // 2048² ceiling/floor tiles never delay ring-side quality.
        for (const face of LOAD_ORDER) {
          if (level === 0 && (face === "u" || face === "d")) {
            const deadline = performance.now() + 8000;
            while (!verticalPitchSeenRef.current && !cancelled) {
              if (performance.now() >= deadline) break;
              await new Promise((r) => setTimeout(r, 200));
            }
            if (cancelled || !matsRef.current) return;
          }
          const tex = faceTexture(faces[face]);
          const prev = matsRef.current[face]?.map;
          matsRef.current[face]!.map = tex;
          // A new map (or a new mipmap chain) needs a material recompile;
          // without it Three.js keeps drawing the mapless program.
          matsRef.current[face]!.needsUpdate = true;
          prev?.dispose();
        }
        setQuality(level);
        setStage((s) => (s === "error" ? s : "ready"));
      }
    })();

    return () => {
      cancelled = true;
      loaderRef.current = null;
      loader.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaId]);

  /* --------------------------------------------------------------- *
   * VR mode: DeviceOrientation -> head-tracked look.                 *
   * --------------------------------------------------------------- */

  const onDeviceOrientation = useCallback((e: DeviceOrientationEvent) => {
    const vr = vrRef.current;
    if (!vr.active || e.alpha === null || e.beta === null) return;
    const v = viewRef.current;
    if (!vr.calibrated) {
      vr.calibrated = true;
      vr.calibYaw = (((v.yaw - (e.alpha * Math.PI) / 180) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      vr.calibPitch = v.pitch - (((e.beta - 90) * Math.PI) / 180);
    }
    vr.targetYaw = (e.alpha * Math.PI) / 180 + vr.calibYaw;
    vr.targetPitch = Math.max(
      -PITCH_LIMIT,
      Math.min(PITCH_LIMIT, ((e.beta - 90) * Math.PI) / 180 + vr.calibPitch),
    );
    if (Math.abs(vr.targetPitch) > VERTICAL_PITCH_RAD) verticalPitchSeenRef.current = true;
  }, []);

  const exitVr = useCallback(() => {
    const vr = vrRef.current;
    if (!vr.active) return;
    vr.active = false;
    window.removeEventListener("deviceorientationabsolute", onDeviceOrientation, true);
    window.removeEventListener("deviceorientation", onDeviceOrientation, true);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    setVrMode(false);
  }, [onDeviceOrientation]);

  const enterVr = useCallback(async () => {
    const mount = mountRef.current;
    if (!mount) return;
    try {
      const DOE = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
        requestPermission?: () => Promise<string>;
      };
      if (typeof DOE !== "undefined" && DOE.requestPermission) {
        const res = await DOE.requestPermission();
        if (res !== "granted") {
          setVrDenied(true);
          return;
        }
      }
    } catch (err) {
      // No permission API (desktop etc.) — nothing to request.
    }
    const vr = vrRef.current;
    vr.active = true;
    vr.calibrated = false;
    window.addEventListener("deviceorientationabsolute", onDeviceOrientation, true);
    window.addEventListener("deviceorientation", onDeviceOrientation, true);
    setVrDenied(false);
    setVrMode(true);
    mount.requestFullscreen?.().catch(() => {});
  }, [onDeviceOrientation]);

  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement && vrRef.current.active) exitVr();
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, [exitVr]);

  // Tear down VR + any pending inertia on unmount.
  useEffect(() => {
    const vr = vrRef.current;
    return () => {
      if (vr.active) {
        window.removeEventListener("deviceorientationabsolute", onDeviceOrientation, true);
        window.removeEventListener("deviceorientation", onDeviceOrientation, true);
      }
      if (inertiaRef.current !== null) cancelAnimationFrame(inertiaRef.current);
    };
  }, [onDeviceOrientation]);

  /* --------------------------------------------------------------- *
   * Renderer diagnostics (development builds only) + fullscreen.    *
   * --------------------------------------------------------------- */

  const [diag, setDiag] = useState<{
    canvas: string;
    buffer: string;
    aspect: string;
    fov: string;
    yaw: string;
    pitch: string;
  } | null>(null);
  useEffect(() => {
    if (!DEV) return;
    const t = window.setInterval(() => {
      const r = rendererRef.current;
      const c = cameraRef.current;
      const v = viewRef.current;
      if (!r || !c) return;
      const b = r.getDrawingBufferSize(new THREE.Vector2());
      setDiag({
        canvas: `${r.domElement.clientWidth}×${r.domElement.clientHeight}`,
        buffer: `${b.x}×${b.y}`,
        aspect: c.aspect.toFixed(3),
        fov: c.fov.toFixed(0),
        yaw: ((v.yaw * 180) / Math.PI).toFixed(0),
        pitch: ((v.pitch * 180) / Math.PI).toFixed(0),
      });
    }, 300);
    return () => window.clearInterval(t);
  }, []);

  const [fullscreen, setFullscreen] = useState(false);
  const toggleFullscreen = useCallback(() => {
    const mount = mountRef.current;
    if (!mount) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    } else {
      mount.requestFullscreen?.().catch(() => {});
    }
  }, []);
  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const zoomBy = useCallback((delta: number) => {
    const z = Math.max(0.55, Math.min(1.6, viewRef.current.zoom + delta));
    viewRef.current.zoom = z;
    targetRef.current.zoom = z;
  }, []);

  const recenter = useCallback(() => {
    const t = targetRef.current;
    t.yaw = ((scene.initialHeading ?? 0) * Math.PI) / 180;
    t.pitch = ((scene.initialPitch ?? 0) * Math.PI) / 180;
    t.zoom = 1;
    viewRef.current.zoom = 1;
  }, [scene.initialHeading, scene.initialPitch]);

  const hintBottom = scenePosition || onPrevScene || onNextScene ? "bottom-20" : "bottom-3";
  const rail = scenePosition && scenePosition.total > 1;

  /* --------------------------------------------------------------- *
   * Pointer / touch controls.                                        *
   * --------------------------------------------------------------- */

  const onPointerDown = (e: React.PointerEvent) => {
    if (vrRef.current.active) {
      exitVr();
      return;
    }
    if (inertiaRef.current !== null) {
      cancelAnimationFrame(inertiaRef.current);
      inertiaRef.current = null;
    }
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragRef.current = { x: e.clientX, y: e.clientY, active: true, vx: 0, vy: 0, lastT: performance.now() };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const start = pointersRef.current.get(e.pointerId);
    if (!start) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const pts = [...pointersRef.current.values()];
    if (pts.length === 2) {
      // Two fingers → zoom.
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (pinchRef.current === null) {
        pinchRef.current = { dist, zoom: viewRef.current.zoom };
      } else {
        const scale = dist / Math.max(1, pinchRef.current.dist);
        viewRef.current.zoom = Math.max(0.55, Math.min(1.6, (pinchRef.current?.zoom ?? 1) * scale));
        targetRef.current.zoom = viewRef.current.zoom;
      }
      return;
    }
    pinchRef.current = null;

    if (!dragRef.current.active) return;
    const { x, y, lastT } = dragRef.current;
    const now = performance.now();
    const dt = Math.max(8, now - lastT);
    const dx = e.clientX - x;
    const dy = e.clientY - y;
    dragRef.current.x = e.clientX;
    dragRef.current.y = e.clientY;
    dragRef.current.lastT = now;
    dragRef.current.vx = (dx / dt) * 16.7;
    dragRef.current.vy = (dy / dt) * 16.7;

    const t = targetRef.current;
    t.yaw += (dx * Math.PI) / 180 / 2.5;
    t.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, t.pitch + (dy * Math.PI) / 180 / 2.5));
    if (Math.abs(t.pitch) > VERTICAL_PITCH_RAD) verticalPitchSeenRef.current = true;
  };

  const endDrag = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    pinchRef.current = null;
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    const { vx, vy } = dragRef.current;
    const speed = Math.hypot(vx, vy);
    if (speed < 1.5) return;
    const decay = (vel: number) => vel * 0.93;
    let vxi = vx;
    let vyi = vy;
    const step = () => {
      vxi = decay(vxi);
      vyi = decay(vyi);
      if (Math.hypot(vxi, vyi) < 0.05) {
        inertiaRef.current = null;
        return;
      }
      const t = targetRef.current;
      t.yaw += (vxi * Math.PI) / 180 / 2.5 / 60;
      t.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, t.pitch + (vyi * Math.PI) / 180 / 2.5 / 60));
      inertiaRef.current = requestAnimationFrame(step);
    };
    inertiaRef.current = requestAnimationFrame(step);
  };

  const onWheel = (e: React.WheelEvent) => {
    viewRef.current.zoom = Math.max(0.55, Math.min(1.6, viewRef.current.zoom + (e.deltaY > 0 ? -0.1 : 0.1)));
    targetRef.current.zoom = viewRef.current.zoom;
    // Zooming in = hunting for detail — let the deep up/down tiles through.
    verticalPitchSeenRef.current = true;
  };

  /* --------------------------------------------------------------- */

  const ready = stage === "ready";

  return (
    <div
      ref={mountRef}
      className="absolute inset-0 overflow-hidden bg-black select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onWheel={onWheel}
      role="application"
      aria-label={`360° panorama of ${scene.label}`}
    >
      {/* Loading veil — lifts as soon as the 512² preview is on screen.
          On error it becomes a calm dead-end message instead of a spinner. */}
      {!ready ? (
        stage === "error" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black">
            <p className="text-base font-medium text-brand-text">
              360° view unavailable for this block.
            </p>
            <p className="text-sm text-brand-subtle">
              The scene's imagery could not be loaded right now.
            </p>
          </div>
        ) : (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black">
            <Loader2 className="size-6 animate-spin text-brand-cyan" aria-hidden />
            <p className="text-sm text-brand-subtle">Loading 360° view…</p>
          </div>
        )
      ) : null}

      {/* Location chip + quality chip while sharper levels stream in. */}
      {placeLabel || scene.label ? (
        <div className="pointer-events-none absolute top-3 left-3 z-10 flex items-center gap-2 rounded-full bg-black/50 py-1 pr-3 pl-4 text-[11px] text-brand-text backdrop-blur">
          <span className="max-w-52 truncate font-medium">{placeLabel ?? scene.label}</span>
          <span className="rounded-full bg-brand-cyan px-2 py-0.5 font-semibold text-brand-deep">360°</span>
        </div>
      ) : null}
      {ready && !degraded && quality !== 0 ? (
        <div className="pointer-events-none absolute top-11 left-3 rounded-full bg-black/50 px-3 py-1 text-[11px] text-brand-subtle backdrop-blur">
          Improving quality…
        </div>
      ) : null}

      {/* Vignette — soft lens-style falloff once the view is live. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          opacity: ready ? 1 : 0,
          transition: "opacity 700ms ease",
          background:
            "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.35) 100%)",
        }}
      />

      {/* VR toggle — fullscreen + gyroscope head-tracked look. */}
      <button
        type="button"
        onClick={vrMode ? exitVr : () => void enterVr()}
        onPointerDown={(e) => e.stopPropagation()}
        aria-pressed={vrMode}
        aria-label={vrMode ? "Exit VR mode" : "Enter VR mode (fullscreen with head tracking)"}
        className={`absolute top-3 right-3 z-10 flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-medium shadow-lg backdrop-blur transition-colors ${
          vrMode ? "bg-brand-cyan text-brand-deep" : "bg-black/55 text-brand-text hover:bg-black/70"
        }`}
      >
        {vrMode ? <X className="size-4" aria-hidden /> : <Headset className="size-4" aria-hidden />}
        {vrMode ? "Exit VR" : "VR mode"}
      </button>

      {vrDenied ? (
        <div className="absolute top-14 right-3 z-10 rounded-lg bg-black/70 px-3 py-2 text-[11px] text-brand-subtle backdrop-blur">
          Motion access denied — drag still works.
        </div>
      ) : null}

      {/* Interaction hint. */}
      {!vrMode ? (
        <div className={`pointer-events-none absolute ${hintBottom} left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-[11px] text-brand-subtle backdrop-blur`}>
          Drag to look around · scroll to zoom
        </div>
      ) : (
        <div className={`pointer-events-none absolute ${hintBottom} left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-[11px] text-brand-subtle backdrop-blur`}>
          {vrDenied ? "Drag to look around · scroll to zoom" : "Move your device to look around · drag or Esc to exit VR"}
        </div>
      )}

      {/* Scene rail — browse the campus's other 360° viewpoints. */}
      {ready && rail ? (
        <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5">
          <button
            type="button"
            onClick={onPrevScene}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Previous 360° scene"
            className="rounded-full bg-black/55 p-2 text-brand-text shadow-lg backdrop-blur transition-colors hover:bg-black/75"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <span className="rounded-full bg-black/50 px-3 py-1.5 text-[11px] text-brand-subtle backdrop-blur">
            {scenePosition!.index + 1} / {scenePosition!.total}
          </span>
          <button
            type="button"
            onClick={onNextScene}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Next 360° scene"
            className="rounded-full bg-black/55 p-2 text-brand-text shadow-lg backdrop-blur transition-colors hover:bg-black/75"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}

      {/* Viewport controls — zoom, recenter, fullscreen. */}
      {ready ? (
        <div className="absolute right-3 bottom-3 z-10 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => zoomBy(-0.2)}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Zoom out"
            className="rounded-full bg-black/55 p-2 text-brand-text shadow-lg backdrop-blur transition-colors hover:bg-black/75"
          >
            <Minus className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => zoomBy(0.2)}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Zoom in"
            className="rounded-full bg-black/55 p-2 text-brand-text shadow-lg backdrop-blur transition-colors hover:bg-black/75"
          >
            <Plus className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={recenter}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Recenter view"
            className="rounded-full bg-black/55 p-2 text-brand-text shadow-lg backdrop-blur transition-colors hover:bg-black/75"
          >
            <RotateCcw className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            className="rounded-full bg-black/55 p-2 text-brand-text shadow-lg backdrop-blur transition-colors hover:bg-black/75"
          >
            {fullscreen ? <Minimize className="size-4" aria-hidden /> : <Maximize className="size-4" aria-hidden />}
          </button>
        </div>
      ) : null}

      {/* Development diagnostics — canvas/buffer sizes, aspect, heading. */}
      {DEV && diag ? (
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-lg bg-black/60 px-3 py-1.5 font-mono text-[10px] leading-relaxed text-brand-subtle backdrop-blur">
          <div>
            canvas {diag.canvas} · buffer {diag.buffer}
          </div>
          <div>
            aspect {diag.aspect} · fov {diag.fov}° · yaw {diag.yaw}° · pitch {diag.pitch}°
          </div>
        </div>
      ) : null}

      {/* Cube-relative compass — which face of the cube you're looking at.
          Derived from the verified CUBE_FACES basis, so its labels always
          match the imagery (yaw 0 = front face, +90° = right). */}
      {ready ? (
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-12 left-1/2 flex -translate-x-1/2 items-center overflow-hidden rounded-full bg-black/50 text-[11px] font-medium backdrop-blur"
        >
          {(["Back", "Left", "Front", "Right"] as const).map((label, i) => {
            const deg = i * 90;
            // Active when the look heading is within ±45° of this direction.
            const isActive = Math.abs(((compassYaw - deg + 540) % 360) - 180) <= 45;
            return (
              <span
                key={label}
                className={`border-r border-black/30 px-3 py-1 last:border-r-0 ${
                  isActive ? "text-brand-cyan" : "text-brand-subtle/70"
                }`}
              >
                {label}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}