/**
 * Debug360 — DEVELOPMENT-ONLY (route registered only when DEV is true):
 * machine-checkable diagnostic for the GPU cubemap 360° renderer.
 *
 * What it proves:
 *  - Scene loading: the six faces at pyramid level 2/1/0, per-face loaded
 *    level shown live.
 *  - Face continuity: the 12 geometric seam pairs, cross-correlated
 *    in-browser (same method as the forensic audit) — green chips mean the
 *    basis + tiles agree at that edge.
 *  - Per-face implied transforms: read from each face's 4 seams; a scene
 *    where faces disagree internally is a CONTENT defect (the renderer is
 *    fine) — e.g. Mans hostel's mixed transforms.
 *  - Orientation sanity: drag to orbit (turntable), toggle the diagnostic
 *    overlay (labels R/L/U/D/F/B, world axes, wireframe), dip inside the
 *    cube to compare against the product view.
 *
 * Deliberately side-by-side with the real pipeline: it reuses the exact
 * CubemapTileLoader + CUBE_FACES basis the app uses.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Box, CheckCircle2, Loader2, XCircle } from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { CampusRouteProvider, useCampusRoute } from "@/features/campus/CampusRouteContext";
import { campusImmersiveBlocks } from "@/lib/immersive";
import type { ImmersiveScene } from "@/lib/navigation-types";
import { prettyLabel } from "@/lib/brand";
import { cn } from "@/lib/utils";
import {
  CUBE_FACES,
  CubemapTileLoader,
  faceTexture,
  LEVELS_DESC,
  LOAD_ORDER,
  type FaceName,
} from "@/features/immersive/cubemap";

const FACE_LETTER: Record<FaceName, string> = { f: "F", r: "R", l: "L", b: "B", u: "U", d: "D" };
const FACE_WORLD: Record<FaceName, string> = {
  f: "+z", r: "+x", l: "-x", b: "-z", u: "+y", d: "-y",
};

/* ------------------------------------------------------------------ *
 * Seam forensics (ported 1:1 from the audit's method, run in-browser)
 * ------------------------------------------------------------------ */

const SEAM_PAIRS: Array<[string, [FaceName, string], [FaceName, string]]> = [
  ["f.right–r.left", ["f", "right"], ["r", "left"]],
  ["f.left–l.right", ["f", "left"], ["l", "right"]],
  ["b.left–r.right", ["b", "left"], ["r", "right"]],
  ["b.right–l.left", ["b", "right"], ["l", "left"]],
  ["f.top–u.bottom", ["f", "top"], ["u", "bottom"]],
  ["r.top–u.right", ["r", "top"], ["u", "right"]],
  ["b.top–u.front", ["b", "top"], ["u", "front"]],
  ["l.top–u.left", ["l", "top"], ["u", "left"]],
  ["f.bottom–d.front", ["f", "bottom"], ["d", "front"]],
  ["r.bottom–d.right", ["r", "bottom"], ["d", "right"]],
  ["b.bottom–d.back", ["b", "bottom"], ["d", "back"]],
  ["l.bottom–d.left", ["l", "bottom"], ["d", "left"]],
];

const SQUARE_SYMMETRIES: Record<string, (u: number, v: number) => [number, number]> = {
  id: (u, v) => [u, v],
  r90: (u, v) => [1 - v, u],
  r180: (u, v) => [1 - u, 1 - v],
  r270: (u, v) => [v, 1 - u],
  fh: (u, v) => [1 - u, v],
  fv: (u, v) => [u, 1 - v],
  fh90: (u, v) => [v, u],
  fv90: (u, v) => [1 - v, 1 - u],
};

function edgeParam(face: FaceName, eName: string): (t: number) => [number, number] {
  const ring: Record<string, (t: number) => [number, number]> = {
    right: (t) => [1, t], left: (t) => [0, t], top: (t) => [t, 1], bottom: (t) => [t, 0],
  };
  const upDown: Record<string, (t: number) => [number, number]> = {
    "u.bottom": (t) => [t, 0], "u.right": (t) => [1, t], "u.front": (t) => [t, 1], "u.left": (t) => [0, t],
    "d.front": (t) => [t, 1], "d.right": (t) => [1, t], "d.back": (t) => [t, 0], "d.left": (t) => [0, t],
  };
  return upDown[`${face}.${eName}`] ?? ring[eName];
}

function corr(a: number[], b: number[]): number {
  const n = a.length;
  const m1 = a.reduce((s, x) => s + x, 0) / n;
  const m2 = b.reduce((s, x) => s + x, 0) / n;
  let c = 0, d1 = 0, d2 = 0;
  for (let i = 0; i < n; i++) {
    c += (a[i] - m1) * (b[i] - m2);
    d1 += (a[i] - m1) ** 2;
    d2 += (b[i] - m2) ** 2;
  }
  return d1 && d2 ? c / Math.sqrt(d1 * d2) : 0;
}

const N_SAMPLES = 33;

type SeamResult = { name: string; r: number; ta: string; tb: string };

/** Cross-correlate the 12 geometric seams of the assembled faces (level 1). */
function seamCheck(faces: Record<FaceName, HTMLCanvasElement>): SeamResult[] {
  const px: Record<FaceName, Uint8ClampedArray> = {} as Record<FaceName, Uint8ClampedArray>;
  for (const k of Object.keys(CUBE_FACES) as FaceName[]) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(faces[k], 0, 0, 64, 64);
    px[k] = ctx.getImageData(0, 0, 64, 64).data;
  }
  const lum = (k: FaceName, u: number, v: number) => {
    const i = (((1 - v) * 63) | 0) * 64 + ((u * 63) | 0);
    const j = i * 4;
    return 0.2126 * px[k][j] + 0.7152 * px[k][j + 1] + 0.0722 * px[k][j + 2];
  };
  const strip = (face: FaceName, eName: string, tr: string, reverse: boolean) => {
    const f = edgeParam(face, eName);
    const out: number[] = [];
    for (let i = 0; i <= N_SAMPLES; i++) {
      let t = i / N_SAMPLES;
      if (reverse) t = 1 - t;
      const [u, v] = f(t);
      const [tu, tv] = SQUARE_SYMMETRIES[tr](u, v);
      out.push(lum(face, tu, tv));
    }
    return out;
  };
  const T = Object.keys(SQUARE_SYMMETRIES);
  return SEAM_PAIRS.map(([name, [fa, ea], [fb, eb]]) => {
    let best = { r: -2, ta: "id", tb: "id" };
    for (const ta of T) {
      for (const tb of T) {
        const fwd = corr(strip(fa, ea, ta, false), strip(fb, eb, tb, false));
        const rev = corr(strip(fa, ea, ta, false), strip(fb, eb, tb, true));
        const r = Math.max(fwd, rev);
        if (r > best.r) best = { r, ta, tb };
      }
    }
    return { name, ...best };
  });
}

/** A face is content-defective when its 4 seam legs imply >1 transform. */
function inconsistentFaces(results: SeamResult[]): FaceName[] {
  const withPair = results.map((s, i) => ({ s, pair: SEAM_PAIRS[i]! }));
  const perFace: Record<string, Set<string>> = {};
  for (const { s, pair } of withPair) {
    const [, [fa], [fb]] = pair;
    (perFace[fa] ??= new Set()).add(s.ta);
    (perFace[fb] ??= new Set()).add(s.tb);
  }
  return (Object.keys(CUBE_FACES) as FaceName[]).filter((f) => (perFace[f]?.size ?? 0) > 1);
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

/** Canvas sprite holding a letter (outer labels) — always faces the camera. */
function labelSprite(text: string, dark: boolean): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  if (dark) {
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 18;
  }
  ctx.font = "900 84px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (dark) ctx.strokeText(text, 64, 66);
  ctx.fillStyle = dark ? "rgba(8,12,20,0.85)" : "rgba(255,255,255,0.92)";
  ctx.fillText(text, 64, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.5, 0.5, 1);
  return sprite;
}

/* ------------------------------------------------------------------ */

function Debug360Inner() {
  const ctx = useCampusRoute();
  const blocks = useMemo(() => campusImmersiveBlocks(ctx.graph), [ctx.graph]);

  const [selected, setSelected] = useState<ImmersiveScene | null>(blocks[0]?.scene ?? null);
  // The graph may arrive after the first render — adopt the first block as
  // soon as scenes exist.
  useEffect(() => {
    if (!selected && blocks.length > 0) setSelected(blocks[0].scene);
  }, [blocks, selected]);
  const selectedBlock = useMemo(
    () => blocks.find((b) => b.scene.mediaId === selected?.mediaId) ?? blocks[0],
    [blocks, selected?.mediaId],
  );

  const mountRef = useRef<HTMLDivElement | null>(null);
  const [levels, setLevels] = useState<Partial<Record<FaceName, number>>>({});
  const [stage, setStage] = useState<"loading" | "ready" | "error">("loading");
  const [seams, setSeams] = useState<SeamResult[] | null>(null);
  const [seamBusy, setSeamBusy] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [stats, setStats] = useState<string[]>([]);

  // Toggles are read inside the render loop via refs so they never restart
  // the scene (which would re-stream every tile).
  const showDiagnosticsRef = useRef(showDiagnostics);
  const autoRotateRef = useRef(autoRotate);
  useEffect(() => {
    showDiagnosticsRef.current = showDiagnostics;
  }, [showDiagnostics]);
  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);

  // Scene switch resets the harness.
  const sceneKey = selected?.mediaId ?? null;
  useEffect(() => {
    setLevels({});
    setStage("loading");
    setSeams(null);
  }, [sceneKey]);

  // GPU diagnostic cube — same basis and loader pipeline as the app's cube.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let cancelled = false;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0b1220, 1);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 100);
    camera.position.set(4.2, 3.1, 6.2);
    camera.lookAt(0, 0, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.6;
    controls.maxDistance = 20;

    // The cube — six planes at the CUBE_FACES basis; DoubleSide so it is
    // readable from outside (mirrored, like the real inside-out surface)
    // *and* from inside, where it matches the product view exactly.
    const group = new THREE.Group();
    const mats: Partial<Record<FaceName, THREE.MeshBasicMaterial>> = {};
    for (const face of Object.keys(CUBE_FACES) as FaceName[]) {
      const { u, v, n } = CUBE_FACES[face];
      const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
      mesh.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(
          new THREE.Vector3(...u), new THREE.Vector3(...v), new THREE.Vector3(...n),
        ),
      );
      mesh.position.set(...n);
      group.add(mesh);
      mats[face] = mat;
    }
    scene.add(group);

    // Wireframe + world axes + face letters (diagnostic overlay group).
    const overlay = new THREE.Group();
    overlay.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(2.001, 2.001, 2.001)),
        new THREE.LineBasicMaterial({ color: 0x53f0e1, transparent: true, opacity: 0.5 }),
      ),
    );
    const axes = new THREE.AxesHelper(1.6);
    overlay.add(axes);
    for (const face of Object.keys(CUBE_FACES) as FaceName[]) {
      const { n } = CUBE_FACES[face];
      const outer = labelSprite(FACE_LETTER[face], false);
      outer.position.set(n[0] * 1.45, n[1] * 1.45, n[2] * 1.45);
      overlay.add(outer);
      const inner = labelSprite(FACE_LETTER[face], true);
      inner.position.set(n[0] * 0.9995, n[1] * 0.9995, n[2] * 0.9995);
      overlay.add(inner);
    }
    overlay.visible = showDiagnostics;
    scene.add(overlay);
    const overlayRef = { group: overlay };

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    controls.autoRotate = false;
    const loop = () => {
      overlayRef.group.visible = showDiagnosticsRef.current;
      controls.autoRotate = autoRotateRef.current;
      controls.update();
      renderer.render(scene, camera);
    };
    renderer.setAnimationLoop(loop);

    // Live stats, ~3 Hz.
    const statsTimer = window.setInterval(() => {
      const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
      const sph = new THREE.Spherical().setFromVector3(camera.position);
      setStats([
        `canvas ${renderer.domElement.clientWidth}×${renderer.domElement.clientHeight}`,
        `buffer ${buf.x}×${buf.y}`,
        `aspect ${camera.aspect.toFixed(3)} · fov ${camera.fov.toFixed(0)}°`,
        `cam r ${sph.radius.toFixed(2)} · θ ${((sph.theta * 180) / Math.PI).toFixed(0)}° · φ ${((sph.phi * 180) / Math.PI).toFixed(0)}°`,
      ]);
    }, 300);

    // Load the scene's faces through the real pipeline (2 → 1 → 0).
    (async () => {
      if (!selected?.mediaId) return;
      try {
        const loader = new CubemapTileLoader(selected!.mediaId!);
        for (const level of LEVELS_DESC) {
          const faces = await loader.loadAllFaces(level);
          if (cancelled) {
            loader.dispose();
            return;
          }
          for (const face of LOAD_ORDER) {
            const prev = mats[face]?.map;
            mats[face]!.map = faceTexture(faces[face]);
            mats[face]!.needsUpdate = true;
            prev?.dispose();
          }
          setLevels(LOAD_ORDER.reduce((acc, f) => ({ ...acc, [f]: level }), {}));
          setStage((s) => (s === "error" ? s : "ready"));
          if (level === 1) {
            setSeamBusy(true);
            try {
              const results = seamCheck(faces);
              if (!cancelled) setSeams(results);
            } finally {
              if (!cancelled) setSeamBusy(false);
            }
          }
        }
      } catch {
        if (!cancelled) setStage("error");
      }
    })();

    return () => {
      cancelled = true;
      renderer.setAnimationLoop(null);
      window.clearInterval(statsTimer);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [sceneKey, selected]);

  const allLoaded = LOAD_ORDER.every((f) => levels[f] === 0);
  const badFaces = seams ? inconsistentFaces(seams) : [];
  const weakSeams = seams ? seams.filter((s) => s.r < 0.9) : [];
  const basisOk = seams !== null && weakSeams.length === 0;

  return (
    <div className="min-h-screen bg-brand-deep text-brand-text">
      <header className="flex items-center gap-3 border-b border-brand-muted bg-brand-navy px-4 py-3">
        <Link
          to="/map"
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-brand-subtle transition-colors hover:bg-brand-surface hover:text-brand-text"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Map
        </Link>
        <h1 className="text-sm font-semibold tracking-wide text-brand-text uppercase">
          360° Diagnostic
        </h1>
        <span className="rounded-full bg-brand-cyan/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-brand-cyan uppercase">
          Dev only
        </span>
      </header>

      <main className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* ---- Diagnostic cube ---- */}
        <section className="rounded-xl border border-brand-muted bg-black p-2">
          <div ref={mountRef} className="aspect-square w-full rounded-lg" />
        </section>

        {/* ---- HUD ---- */}
        <aside className="flex flex-col gap-3">
          {/* Scene selector */}
          <div className="rounded-xl border border-brand-muted bg-brand-surface/60 p-3">
            <label className="mb-2 block text-xs font-semibold tracking-wide text-brand-subtle uppercase">
              Scene
            </label>
            <select
              value={selected?.mediaId ?? ""}
              onChange={(e) => {
                const b = blocks.find((x) => x.scene.mediaId === e.target.value);
                if (b) setSelected(b.scene);
              }}
              className="w-full rounded-lg border border-brand-muted bg-brand-deep px-2.5 py-2 text-sm text-brand-text outline-none focus:border-brand-cyan"
            >
              {blocks.map((b, i) => (
                <option key={b.scene.mediaId} value={b.scene.mediaId ?? ""}>
                  {i + 1}. {prettyLabel(b.label)}
                </option>
              ))}
            </select>
            {selectedBlock ? (
              <dl className="mt-2 space-y-1 font-mono text-[11px] text-brand-subtle">
                <div className="flex justify-between gap-2">
                  <dt>node</dt>
                  <dd className="truncate text-brand-text">{selectedBlock.nodeId}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>lat · lng</dt>
                  <dd className="text-brand-text">
                    {selectedBlock.scene.lat?.toFixed(6) ?? "—"} · {selectedBlock.scene.lng?.toFixed(6) ?? "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>mediaId</dt>
                  <dd className="max-w-56 truncate text-right text-brand-text">{selectedBlock.scene.mediaId}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>heading · pitch · fov</dt>
                  <dd className="text-brand-text">
                    {selectedBlock.scene.initialHeading ?? 0}° · {selectedBlock.scene.initialPitch ?? 0}° ·{" "}
                    {selectedBlock.scene.initialFov ?? 75}°
                  </dd>
                </div>
              </dl>
            ) : null}
          </div>

          {/* Cube controls */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowDiagnostics((v) => !v)}
              aria-pressed={showDiagnostics}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                showDiagnostics
                  ? "bg-brand-cyan text-brand-deep"
                  : "border border-brand-muted text-brand-subtle hover:border-brand-cyan/50 hover:text-brand-text",
              )}
            >
              Cubemap diagnostics
            </button>
            <button
              type="button"
              onClick={() => setAutoRotate((v) => !v)}
              aria-pressed={autoRotate}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                autoRotate
                  ? "bg-brand-cyan text-brand-deep"
                  : "border border-brand-muted text-brand-subtle hover:border-brand-cyan/50 hover:text-brand-text",
              )}
            >
              Turntable
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-brand-subtle">
            Drag to orbit · scroll to zoom · zoom far in to step inside the cube (matches the
            product view). Labels R/L/U/D/F/B sit outside each face; axes: <span className="text-brand-cyan">X cyan</span>,{" "}
            <span className="text-brand-green">Y green</span>, <span className="text-brand-amber">Z amber</span>.
          </p>

          {/* Renderer stats */}
          <div className="rounded-xl border border-brand-muted bg-brand-surface/60 p-3 font-mono text-[11px] leading-relaxed text-brand-subtle">
            {stage === "error" ? (
              <p className="text-brand-red">Failed to load scene tiles.</p>
            ) : (
              <>
                {stats.map((line) => (
                  <p key={line}>{line}</p>
                ))}
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {LOAD_ORDER.map((f) => (
                    <span
                      key={f}
                      title={`${FACE_LETTER[f]} — world ${FACE_WORLD[f]}`}
                      className={cn(
                        "rounded px-1.5 py-0.5 font-mono",
                        levels[f] === 0
                          ? "bg-brand-green/15 text-brand-green"
                          : levels[f] !== undefined
                            ? "bg-brand-amber/15 text-brand-amber"
                            : "bg-brand-muted/40 text-brand-subtle",
                      )}
                    >
                      {FACE_LETTER[f]} {levels[f] ?? "–"}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Seam check results */}
          <div className="rounded-xl border border-brand-muted bg-brand-surface/60 p-3">
            <div className="mb-2 flex items-center gap-2">
              <Box className="size-4 text-brand-cyan" aria-hidden />
              <h2 className="text-xs font-semibold tracking-wide text-brand-subtle uppercase">
                Face continuity (12 seams)
              </h2>
              {seamBusy ? <Loader2 className="ml-auto size-3.5 animate-spin text-brand-cyan" aria-hidden /> : null}
            </div>
            {seams === null && !seamBusy ? (
              <p className="text-[11px] text-brand-subtle">Waiting for level 1…</p>
            ) : (
              <ul className="grid grid-cols-2 gap-1.5">
                {seams?.map((s) => (
                  <li
                    key={s.name}
                    title={`A:${s.ta} · B:${s.tb}`}
                    className={cn(
                      "flex items-center justify-between gap-1 rounded px-2 py-1 font-mono text-[10.5px]",
                      s.r >= 0.9
                        ? "bg-brand-green/10 text-brand-green"
                        : s.r >= 0.5
                          ? "bg-brand-amber/10 text-brand-amber"
                          : "bg-brand-red/10 text-brand-red",
                    )}
                  >
                    <span className="truncate">{s.name}</span>
                    <span className="shrink-0">{s.r.toFixed(3)}</span>
                  </li>
                ))}
              </ul>
            )}
            {seams !== null ? (
              <div className="mt-2.5 flex items-center gap-2 border-t border-brand-muted pt-2.5">
                {basisOk && badFaces.length === 0 ? (
                  <>
                    <CheckCircle2 className="size-4 text-brand-green" aria-hidden />
                    <p className="text-[11px] text-brand-green">
                      12/12 seams ≥ 0.9 — basis verified for this scene; no content defect.
                    </p>
                  </>
                ) : (
                  <>
                    <XCircle className="size-4 shrink-0 text-brand-amber" aria-hidden />
                    <p className="text-[11px] leading-snug text-brand-amber">
                      {badFaces.length > 0 ? (
                        <>
                          Scene content is defective: face{`${badFaces.length > 1 ? "s" : ""}`}{" "}
                          {badFaces.map((f) => FACE_LETTER[f]).join(", ")} implied conflicting
                          transforms. Renderer basis is fine — check tile sources.
                        </>
                      ) : (
                        <>
                          {weakSeams.length} seam{weakSeams.length > 1 ? "s" : ""} below 0.9 —
                          possible wrong basis for this scene.
                        </>
                      )}
                    </p>
                  </>
                )}
              </div>
            ) : null}
          </div>

          {!allLoaded ? (
            <p className="flex items-center gap-2 text-[11px] text-brand-subtle">
              <Loader2 className="size-3.5 animate-spin text-brand-cyan" aria-hidden />
              Streaming pyramid levels (2048² → 1024² → 512²)… deep u/d last.
            </p>
          ) : null}
        </aside>
      </main>
    </div>
  );
}

export function Debug360() {
  return (
    <CampusRouteProvider>
      <Debug360Inner />
    </CampusRouteProvider>
  );
}

export default Debug360;