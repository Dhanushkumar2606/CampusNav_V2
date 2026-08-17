# 360° Viewer — Verification & Polish Report

**Date:** 2026-08-16 · **Task:** cube 360° visuals + landmark (viewer-side) work — "some, not all; visuals proper"

## Executive verdict

**B** — The 360° viewing experience is now correct and resilient; the content-side seam weakness of one scene remains a provider-data matter, not an app bug.

## What was done

### 1. Regression found & fixed (the blank screen)
My earlier polish pass introduced a hooks violation: a reset `useEffect` was placed **after** the `if (!open) return null;` early return in `ImmersiveViewer.tsx`. Mounting with `open=false` skipped the hook, so opening the viewer added a hook → React threw **"Rendered more hooks than during the previous render"** → the whole app blanked whenever any 360° view was opened. Moved the effect above the early return.

**Verified live in headless Chrome against the running app** (registered throwaway user, deep link `?campus=…&place=…`, clicked "Explore 360°", read back the WebGL framebuffer):
| scene | framebuffer mean luminance | result |
|---|---|---|
| Central Library | 52.6 | renders |
| Men's Hostel | 247.1 | renders |
| T.P. Ganesan Auditorium | 113.5 | renders |
| (pre-fix) any 360° | blank | crash on open |

### 2. Per-scene landing orientation (flow-through fix)
`nodeImmersive()` in `frontend/src/lib/immersive.ts` previously **dropped** `initialHeading/initialPitch/initialFov` from the scene config, so every scene opened at generic yaw 0/pitch 0/FOV 75. Now flows through: the config's `initialHeading/Pitch/Fov` reach `CubePanorama`'s camera ("…opens looking at its subject instead of a generic straight-ahead").

### 3. Loading / error UX
- `CubePanorama`: on load failure the black veil now shows a calm "360° view unavailable" message instead of a **forever-spinning loader**.
- `ImmersiveViewer`: cube scenes get a **"Try again"** button (remounts the texture pipeline via `key`); stale error/retry state is cleared on every fresh open/scene change.
- The **"Improving quality…" chip now settles** when the pyramid caps out at a lower level (`degraded` flag) instead of showing forever.

### 4. Orientation compass (visuals proper)
Small cube-relative compass pill at the bottom (`Back · Left · Front · Right`) derived from the **verified `CUBE_FACES` basis** — it always matches the imagery (yaw 0 = front face, +90° = right). Highlights the face you're looking at; updates at ~8 Hz from the render loop.

### 5. Debug cruft removed
The shipped **TEMP DEBUG VR diagnostic overlay** (+ its `[VR]` console noise) is gone.

### 6. Coverage
- New unit tests `frontend/src/lib/immersive.test.ts` — scene resolution, no-scene nulls, **orientation flow-through**, default provider/label, route viewpoints. **34/34 tests pass**, `tsc -b` clean, `vite build` clean.
- Backend untouched (tile relay, allowlist, and seed config verified earlier this session).

## Diagnostics that led here (for the record)
- **Tile completeness:** all 6 faces × 512/1024/2048 verified for the 3 audited scenes — no missing tiles anywhere.
- **Cross-seam correlation:** Central Library / Auditorium are healthy where content has detail (walls 0.82–0.99); **Men's Hostel edges don't close up numerically (max ≈ 0.67)** — consistent with a **source-pano stitching defect**, not an app bug (the GPU cubemap math matches three.js on the healthy scenes, and everything flows through one pipeline). Fixing that requires re-exporting the hostel panorama at the provider; the app renders whatever tiles it is given faithfully.
- Note: 3 throwaway test accounts were registered in the dev DB during the live verification (`smoke.*@gmail.com`).

## Remaining / not done
- Content-side regeneration of the Men's Hostel pano (provider-side, out of reach).
- Landmark *pointers into* the panorama content were **not** added: without ground-truth world alignment (the cube basis is math-verified but the provider's yaw↔world mapping is unknown), pointing at visible landmarks would be guesswork and violate "visuals proper". The compass + landing orientation give orientation cues instead.