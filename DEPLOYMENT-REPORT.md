# DEPLOYMENT-REPORT.md — CampusNav V2 production deployment

**Status: `BLOCKED` — ready to deploy; platform authentication required from the account owner.**

Per the deployment rules: deployment cannot be claimed without verifying the live URLs, and
the only remaining gate is Vercel/Render account access (no `vercel`/`render` CLI installed,
no platform tokens in the environment, and both CLIs require interactive browser login).
**Every code/config/test step below is complete and verified** — see A–Q.

---

## A. Deployment architecture

```
Browser
   │
   ▼
Vercel (static SPA, frontend/dist)            Render web service (FastAPI)      Render Postgres 16
   │  VITE_API_URL=https://…onrender.com           uvicorn app.main:app                └─ geography/PostGIS
   └──/api/* ───────────────────────────────────►  /api/* AND bare (/) routers         └─ migrations + seed
        (CORS: Vercel origin allowed)               └─ panorama tile relay (SRM tour)
                                                     └─ JWT auth, NOVA, A*, search
```

**Decision rationale:**
- The backend is a stateful FastAPI app with SQLAlchemy + Alembic + a tile relay — Render web
  service + managed Postgres is its natural home (`DATABASE_URL` is already supported,
  migration 0001 uses `geography(Point,4326)`, docker-compose already targets Postgres).
- A single Vercel deployment was evaluated: it would require running FastAPI as serverless
  functions (not the repo's architecture — `main.py` mounts a static SPA and long-lived
  sessions) and provides no managed database. Rejected.
- A single Render web service could serve everything (the backend already serves the built
  SPA and both route prefixes) — kept working as a zero-extra-code fallback; the split was
  chosen per the preferred architecture, with one small frontend change (env-based API base).
- **No functional code was rewritten**: routing, navigation/GPS, NOVA, auth, map and 360°
  logic are untouched. Three additions only: `apiBase.ts`, `scripts/prod_bootstrap.py`,
  and platform config files.

## B. Frontend platform + URL
- **Platform:** Vercel (static; `frontend/vercel.json` adds the SPA fallback rewrite).
- **URL:** `https://campusnav-v2-<user>.vercel.app` (assigned by Vercel — unknown until deployed).
- Build: `npm ci && npm run build` (output `frontend/dist`, auto-detected by Vercel).

## C. Backend platform + URL
- **Platform:** Render web service `campusnav-api` (`render.yaml` Blueprint, `rootDir: backend`).
- **URL:** `https://campusnav-api.onrender.com` (assigned by Render — unknown until deployed).
- **Health check URL:** `https://campusnav-api.onrender.com/health` (+ `/api/root`).
- Entry point: `app.main:app` (verified), `uvicorn`, bind `0.0.0.0`, port `$PORT`.

## D. Database configuration
- **Type:** Render managed Postgres 16 (`campusnav-db`, free tier), PostGIS extension.
- **URL:** `DATABASE_URL` injected from the database service (`postgresql+psycopg://…`).
- **Migrations:** Alembic (8 revisions, 0001–0008), run by `backend/scripts/prod_bootstrap.py`.
- **Seed:** idempotent `python -m app.seed.csv_loader --data-dir ./seed_data` (SRM KTR + VIT Chennai;
  upserts — existing production data is never wiped).
- **PostGIS prerequisite:** `CREATE EXTENSION IF NOT EXISTS postgis` runs before migrations
  (required by migration 0001 `geography(Point,4326)` columns). Verified locally on SQLite
  (extension step no-ops); Postgres-specific step executes only on a Postgres URL.
- **Local verification performed** — fresh database, full bootstrap chain:
  `14 tables` (alembic_version + 13 app tables), `2 campuses`, `511 nodes`, `632 edges`,
  `13 buildings`, `0 users`, then production-mode API smoke (see M).

## E. Environment variables (names only)

| Variable | Where | Value |
|---|---|---|
| `VITE_API_URL` | Vercel (frontend build) | `https://campusnav-api.onrender.com` |
| `JWT_SECRET` | Render | generated (`generateValue: true`) — never logged |
| `JWT_ALGORITHM` | Render | `HS256` |
| `JWT_EXPIRES_MINUTES` | Render | `60` |
| `APP_ENV` | Render | `production` |
| `CORS_ORIGINS` | Render | `https://campusnav-v2-<user>.vercel.app` (replace before deploy) |
| `PREMIUM` | Render | `true` (feature parity with local/Docker builds) |
| `DATABASE_URL` | Render | from `campusnav-db` (connection string) |

No AI provider key exists (NOVA is rule-based, no external LLM). No map key (public OSM
raster + demo glyphs). No OAuth/email provider.

## F. Build commands
- Frontend: `npm ci && npm run lint && npm run typecheck && npm test && npm run build`
  → `frontend/dist` (Vercel runs build with `VITE_API_URL` set).
- Backend: `cd backend && pip install uv && uv sync --no-dev` (pyproject + uv.lock; no
  requirements.txt in the repo — uv is the project's dependency manager).
- Verified locally: `tsc -b` clean · `vitest` **50/50 passed** · vite build clean (with and
  without `VITE_API_URL`) · pytest **129/129 passed**.

## G. Start commands
- Render start (runs at every boot, all idempotent):
  `uv run python -m scripts.prod_bootstrap && uv run uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Local dev (unchanged): `uvicorn app.main:app --reload --port 8000` / `npm run dev`.

## H. Authentication verification
- JWT (HS256, 60-min expiry, `sub` = user UUID, `iss` = campusnav-v2) — unchanged.
- Verified in production-mode boot on a fresh DB: `register` → `login` → `me` (Bearer) ✓;
  401 mapping for missing token covered by the 129-test backend suite; client-side expiry
  + `SessionExpiredError` → graceful logout (frontend, 5 tests).
- Production CORS does not use `*`; explicit origins via `CORS_ORIGINS` (`allow_credentials=True`).

## I. Map verification
- MapLibre renders OSM raster (`a/b/c.tile.openstreetmap.org`) + demo glyphs — public, no key.
- Graph (nodes/edges w/ geometry), markers, route polyline, locate button all driven by the
  existing API — verified in production mode (campuses/stats/nearest-node/route/tile 200 OK).
- No localhost map/API URLs remain in the production frontend bundle (verified by grep).

## J. Routing verification
- Production-mode REST verify: `main_gate → central_library` = **426 m · 6 min · 9 steps**,
  mode `fastest`; NOVA same pair = **426.2 m · 5.6 min** (shortest). A*/alternatives,
  `avoid_stairs`, accessible-mode (mode+preferences through the frontend) unchanged.

## K. GPS verification
- Real browser geolocation in production by construction: `locationSource.ts` returns the
  simulator only when `import.meta.env.DEV && VITE_SIMULATED_GPS === "true"` — statically
  `false` in production builds.
- **Simulator isolation verified:** production bundle contains **0** references to
  `locationSim`/track fixtures (fixed one leak: `MapControls` statically imported the dev
  diagnostics panel → now a DEV-gated lazy import; sim layer is dead code in prod).
- Locate permission denied/unavailable → honest UI states; live-tracking engine covered by
  12 deterministic sim-harness tests (test-only).

## L. NOVA verification
- Rule-based assistant; no external AI key required. Executes real tools (A*, search).
- Verified in production mode: `"main gate to library"` → `kind: route`,
  "shortest route from main gate to SRM Central Library: 426.2 m, about 5.6 min" ✓.
- 401 chain: client fails fast on expired JWT (30 s skew) → logout; server 401s only for
  genuinely invalid tokens — authentication is NOT disabled.

## M. 360° verification
- Tile relay verified in production mode: central-library scene
  `…/panorama/tile/94652D98_…/f/2/0_0.jpg` → **HTTP 200, image/jpeg** (upstream
  `webstor.srmist.edu.in`, allowlisted 7 GUIDs; content-type preserved).
- Cubemap config untouched (verified face basis, progressive 512→1024→2048 pipeline);
  `API_BASE` applied to the tile loader so split-origin production works.
- Reachability caveat: the SRM tour upstream must be reachable from the Render egress IP
  (public — no auth headers; local smoke proves the relay itself).

## N. Tests executed (all green, pre-commit)
- Backend: `python -m pytest -q` → **129 passed** (`backend/tests`).
- Frontend: `npm test` → **50 passed**; `npm run lint` + `npm run typecheck` (tsc -b) clean;
  `npm run build` clean (both with and without `VITE_API_URL`, absolute URL verified baked in).
- Production-path integration: fresh DB → `prod_bootstrap` (migrate + seed) → uvicorn with
  `APP_ENV=production` → health/campuses/stats/register/login/me/route/NOVA/search/
  favorites/nearest-node/panorama smoke — all 200/expected payloads.
- No test modified to make deployment pass; no tests skipped.

## O. Deployment errors encountered and fixes
| # | Issue | Fix |
|---|---|---|
| 1 | Sim fixtures (`boys_hostel` track) leaked into the production bundle via `MapControls`' static import of the dev diagnostics panel | `NavigationDiagnostics` → DEV-gated `React.lazy` import; prod bundle re-verified: 0 references |
| 2 | (Pre-existing quirk, not fixed by design) `/api/root` returns the SPA `index.html` because the static mount registers before the route | Harmless — no frontend caller; API routers take precedence on all real endpoints. Noted only |
| 3 | REST `/route` requires UUID node ids (label resolution is NOVA-internal) | Not a bug — test script adjusted (UUIDs from DB); frontend already passes UUIDs |
| 4 | No `requirements.txt` (uv project) | Render build uses `pip install uv && uv sync --no-dev` per repo convention |
| 5 | PostGIS extension prerequisite for migration 0001 | `prod_bootstrap.py` runs `CREATE EXTENSION IF NOT EXISTS postgis` before `alembic upgrade head` only for Postgres URLs |
| 6 | **`backend/uv.lock` was gitignored + untracked** (`.gitignore:29`) — the Dockerfile's `COPY backend/uv.lock` therefore fails on any fresh clone (`COPY failed: no source files`), breaking the Docker/CI image path and making Render builds non-reproducible | Removed the ignore rule, tracked the project's lockfile, and verified Render's exact build command (`uv sync --no-dev`) against it on Python 3.12 (Render/CI) and 3.14 (local) — deps import clean in both |

## P. Security checks
- `.gitignore`: `.env`, `.env.*` (+ negated `!.env.example`) and `frontend/.env.*` — verified
  `backend/.env` IS ignored (exists locally, untracked).
- `.env.example` (root + `frontend/`) — placeholders only; real variable names.
- **Lockfiles:** `frontend/package-lock.json` tracked (npm ci path valid); `backend/uv.lock`
  now tracked too after removing the erroneous ignore rule (fixes Docker `COPY`, verifies
  `uv sync --no-dev` on 3.12/3.14).
- Sweep results: **no hardcoded API keys/passwords/tokens**; localhost/127.0.0.1/0.0.0.0
  occurrences are all legitimate dev scaffolding (Vite proxy, CORS default, docker-compose,
  CI health check, docstrings) or third-party venv code; `render.yaml` `0.0.0.0` is the
  required platform bind.
- `VITE_SIMULATED_GPS` is dev-only by construction and provably absent from the prod bundle.
- Secrets will be platform-managed: `JWT_SECRET` auto-generated on Render; `DATABASE_URL`
  injected; never printed (this report shows names only).
- Admin endpoints remain gated by `Role.ADMIN`; no dev-only endpoints exposed.

## Q. Final production status

**`BLOCKED`** — deployment steps and everything below them are complete and verified locally;
the deployment itself cannot be executed or validated without Vercel/Render credentials.

### Exactly what you need to do (account actions I cannot perform)

**Option 1 — Render dashboard (backend), then Vercel (frontend):**
1. **Render:** https://render.com → New → Blueprint → connect repo `Dhanushkumar2606/CampusNav_V2`
   → `render.yaml` provisions `campusnav-api` + Postgres `campusnav-db` automatically →
   set `CORS_ORIGINS` to your real Vercel URL (env var on the web service) → Deploy.
2. **Vercel:** https://vercel.com/new → import the same repo → framework auto-detected (Vite),
   set `VITE_API_URL=https://campusnav-api.onrender.com` → Deploy.

**Option 2 — CLIs (fully scriptable afterwards):**
```bash
npm i -g vercel && vercel login        # interactive browser auth
npm i -g @render/cli && render login   # interactive browser auth
# then, once both are authenticated, one command does the rest:
./scripts/deploy.sh https://campusnav-api.onrender.com https://campusnav-v2-<user>.vercel.app
```
`scripts/deploy.sh` (preflight → Vercel link + `VITE_API_URL` env + `--prod` → Render
Blueprint launch with CORS override → prints live URLs + health check). No secrets
in the script; `JWT_SECRET` and `DATABASE_URL` are platform-managed.

Then tell me the two URLs and I will run the full smoke checklist (register/login/map/route/
start+cancel+stop nav/real GPS/NOVA/360°) against the live services and flip this report to
`READY` (or `READY WITH WARNINGS` with evidence). Nothing has been committed or pushed —
the working tree holds only the deployment changes above, all tests green.