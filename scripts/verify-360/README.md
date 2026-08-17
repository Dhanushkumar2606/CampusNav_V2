# verify-360 — 360° upgrade verification suite

E2E + forensics scripts used by the 360° upgrade (see
`CAMPUSNAV-360-UPGRADE-REPORT.md` at the repo root). All four scripts drive a
real headless Chrome via puppeteer-core against a running stack; they are
CommonJS scripts (use a `.cjs`/`.js` run with `node`, not ESM).

## Prerequisites

1. Backend up, with the panorama tile relay configured:
   `backend/.venv/bin/python -m uvicorn app.main:app --port 8000`
2. Frontend dev server: `npm run dev` in `frontend/` (port 5173, `/api` proxied
   to the backend).
3. `puppeteer-core` installed in this directory
   (`npm i puppeteer-core` — the suite pins the system Chrome path in
   `verify-360.js`; override via editing `CHROME`).
4. Google Chrome installed at the path in `CHROME`.

## Scripts

| script | purpose |
|---|---|
| `verify-360.js` | Full E2E: prod-build gating of `/dev/360-test`, diagnostic harness (deep faces, seam chips/verdict, live stats, scene switching), auth + map flow, viewer HUD/controls/drag/zoom/scene rail/navigate-here, resize, Escape, no uncaught errors. Exits 1 on any failure; writes PNG evidence into the CWD. |
| `seamforensic.js` | Reference seam forensics (level-2 single tiles, 12 cube edges × 64 symmetry combos, max forward/reverse parity). Source of the per-scene tables in the upgrade report. Base URL override: `APP_URL=http://localhost:8000`. |
| `isolate.js` | Level-vs-level seam comparison (L2 direct / L2 via 1024 / L1 assembled) plus per-L1-tile quadrant localization against L2. |
| `tileorder.js` | Whole-face correlation of every L1 tile permutation vs the L2 face — the decisive proof of the provider's 2×2 assembly order. |

## Run

```sh
node verify-360.js          # needs both servers up (defaults: APP_URL=:5173, PROD_URL=:8000)
node seamforensic.js        # defaults to the backend directly (:8000)
node isolate.js
node tileorder.js
```

Notes: the E2E registers a throwaway account each run; the viewer path drives
the map's mobile BottomSheet because its full-screen backdrop covers the
desktop details card (known issue, see report §5.2). `seamlevels.js` from the
original investigation is deliberately not vendored — its downscale path
diverged from the forensic method and its numbers are superseded by
`seamforensic.js`/`isolate.js`.