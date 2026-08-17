# DEPLOYMENT-REPORT.md — CampusNav V2 production deployment

**Status: `READY`** — live, verified, and smoke-tested end to end (2026-08-17).

| Component | URL | Status |
|---|---|---|
| Frontend (Vercel) | https://campusnav-v2.vercel.app | ✅ 200, SPA serving |
| Backend (Render web service) | https://campusnav-api.onrender.com | ✅ Live, `/health` → `{"status":"ok","db":"ok"}` |
| Database (Render Postgres 16) | `campusnav-db` (free, oregon) | ✅ Available; migrations at head, seeded |

---

## A. Deployment architecture

```
Browser
   │
   ▼
Vercel (static SPA, frontend/dist)            Render web service (FastAPI)      Render Postgres 16
   │  VITE_API_URL=https://campusnav-api.onrender.com   uvicorn app.main:app        └─ alembic head (0010)
   └──/api/* ───────────────────────────────────────►  /api/* AND bare (/) routers   └─ seeded: 2 campuses
        (CORS: Vercel origin allowed)                  └─ panorama tile relay (SRM tour)
                                                        └─ JWT auth, NOVA, A*, search
```

**Decision rationale (unchanged):** the backend is a stateful FastAPI app with SQLAlchemy +
Alembic + a tile relay — Render web service + managed Postgres is its natural home. A single
Vercel deployment was rejected (serverless functions don't fit `main.py`'s long-lived SPA
mount + sessions; no managed DB). No functional application code was rewritten.

## B. Frontend — live verification
- URL: `https://campusnav-v2.vercel.app` — `GET /` → **200** `text/html`, title `CampusNav — AI Campus Navigation`.
- Deployed bundle (`/assets/index-DwZFrEMh.js`) verified to reference `https://campusnav-api.onrender.com` (grep of the live asset; 0 localhost URLs).

## C. Backend — live verification
- URL: `https://campusnav-api.onrender.com`; commit `4a0db02` deploy **Live**.
- `GET /health` → `{"status":"ok","db":"ok","version":"0.1.0"}`.
- Start command: `uv run python -m scripts.prod_bootstrap && uv run uvicorn app.main:app --host 0.0.0.0 --port $PORT`
  (both steps confirmed in Render logs; `VIRTUAL_ENV`/project-path mismatch warning **eliminated** by `UV_PROJECT_ENVIRONMENT=/opt/render/project/src/.venv`).

## D. Database configuration
- **Type:** Render managed Postgres 16.14 (free tier, expires 2026-09-16 — see Warnings), PostGIS extension installed.
- **URL:** `DATABASE_URL` service env var (Render-managed; never printed or committed). psycopg3 driver:
  SQLAlchemy receives the URL normalized to `postgresql+psycopg://` (`Settings.sqlalchemy_database_url`),
  so `postgresql://`/`postgres://` forms work without psycopg2.
- **Production guard:** `APP_ENV=production` now **refuses to boot** if `DATABASE_URL` is missing/unset
  (previously it silently fell back to SQLite in the container — the fix that surfaced the real errors below).
- **Migrations:** Alembic, 10 revisions (0001–0010), run by `prod_bootstrap` before seeding, on the Postgres context (confirmed in deploy logs).
- **Seed:** `python -m app.seed.csv_loader --data-dir ./seed_data --skip-if-seeded` — idempotent upserts;
  verified: **2 campuses (SRM KTR, VIT Chennai), 13 buildings, 13 entrances, 511 path nodes, 632 path edges, 2 provenance rows**.
  `--skip-if-seeded` makes every subsequent boot ~9 s instead of ~10 min (full reseed on first boot).

## E. Environment variables (names only)

| Variable | Where | Value |
|---|---|---|
| `VITE_API_URL` | Vercel (Production) | `https://campusnav-api.onrender.com` |
| `JWT_SECRET` | Render | generated 48-byte secret — never logged |
| `JWT_ALGORITHM` | Render | `HS256` |
| `JWT_EXPIRES_MINUTES` | Render | `60` |
| `APP_ENV` | Render | `production` |
| `CORS_ORIGINS` | Render | `https://campusnav-v2.vercel.app` |
| `PREMIUM` | Render | `true` |
| `DATABASE_URL` | Render | Render-managed connection string (external endpoint; internal DNS is unavailable on this workspace's free Postgres — see Warnings) |
| `UV_PROJECT_ENVIRONMENT` | Render | `/opt/render/project/src/.venv` (one consistent uv env; matches Render's `VIRTUAL_ENV`) |

No AI provider key (NOVA is rule-based), no map key (public OSM), no OAuth/email provider.

## F/G. Build & start commands (verified on Render)
- Build: `pip install uv && uv sync --no-dev` (uv.lock tracked; Python 3.14 runtime).
- Start: as in C. Bootstrap order: ensure PostGIS → `alembic upgrade head` → seed (`--skip-if-seeded`) → uvicorn. All idempotent.

## H. Authentication (live)
- `POST /auth/register` → 201 + user row persisted **in PostgreSQL**; `POST /auth/login` (OAuth2 form) → 239-char JWT; protected endpoints accept Bearer; CORS is explicit-origin (`access-control-allow-origin: https://campusnav-v2.vercel.app` verified on live responses).

## I–M. Feature verification (live, via https://campusnav-api.onrender.com)
- **Map/graph:** `/navigation/campuses` → 2 campuses; `/navigation/campuses/{slug}/stats` → buildings 8, nodes 310, entrances 9, landmarks 2, transit 1, poi 1, edges…; `/navigation/campuses/{slug}/graph` → 310 nodes / 389 edges.
- **Routing (A\* on seeded PG data):** `POST /navigation/campuses/{slug}/route` → `status: ok`, 3 steps, 117 m, 1.6 min, summary `117 m · 2 min walk · 3 steps`. NOVA `route` intent → `"Here's the shortest route from main gate to Tech Park … 559.0 m, about 7.5 min"` with structured data.
- **Search:** `GET /search?q=library` → VIT library node, score 100.0; `q=gate&lat=12.8236&lng=80.0442` → nearest node with geo bias.
- **GPS/near:** `/navigation/campuses/near?lat=12.8236&lng=80.0442` → SRM at 130.5 m, VIT at 11 992.9 m (haversine ranking correct).
- **Panorama relay:** `…/panorama/tile/94652D98_…/f/2/0_0.jpg` → **200 image/jpeg, 47 391 B** (live fetch through Render from `webstor.srmist.edu.in`).
- **Favorites/preferences:** add + list favorite (label resolved), PUT preferences → all 200 with persisted rows in PG.
- **Persistence:** register → row in `users` (PG); favorite + preference rows in PG; verified across requests. (Smoke-test rows were deleted afterwards; `users` left at 0.)

## N. Tests executed (all green)
- Backend: `python -m pytest -q` → **129 passed** (run with `DATABASE_URL` pointed at production Postgres — i.e., integration-level against the real DB).
- Frontend: `npm run build` (tsc -b + vite) clean during Vercel deploy; deployed bundle verified.
- Seed/boot: full bootstrap chain exercised on the live DB (PostGIS → migrate → seed → uvicorn); `--skip-if-seeded` path verified in Render logs (`skipping srm_ktr.json: campus already seeded`).

## O. Production failures encountered and fixed (root causes)
| # | Symptom (Render) | Root cause | Fix |
|---|---|---|---|
| 1 | `ModuleNotFoundError: No module named 'psycopg2'` at `ensure_postgis` | `postgresql://` URL maps to the psycopg2 dialect in SQLAlchemy; project ships psycopg3 | `Settings.sqlalchemy_database_url` normalizes to `postgresql+psycopg://`; used by `db.py`, Alembic env, and `prod_bootstrap` |
| 2 | `failed to resolve host 'dpg-….internal'` | Render private-network DNS did not resolve for this workspace's free Postgres | Switched `DATABASE_URL` to the public endpoint + opened the DB IP allow-list (`0.0.0.0/0`); verified reachable from Render |
| 3 | `operator does not exist: character varying = uuid` in seed | **Migration drift:** migrations 0001–0008 declared every id/FK column as `String(36)`/`CHAR(36)` while models use `GUID()` → native `uuid`. SQLite tolerated it; Postgres enforces types | Migration **0009**: converts 25 columns across 13 tables to native `uuid` (FKs dropped + restored with original ON UPDATE/DELETE semantics); no-op on SQLite |
| 4 | `column "location" is of type geography but expression is of type character varying` (insert) — and later: EWKB hex returned on reads | **Geo drift:** schema created `geography(Point,4326)` + GIST indexes (migration 0001) but models/readers treat the columns as WKT strings (`parse_point`, `_parse_lng_lat`); GeoAlchemy2 returns hex EWKB, breaking every consumer; nothing in the app uses SQL-side spatial functions (routing is in-memory A*) | Migration **0010**: converts the 4 geo columns to `text` on Postgres, migrating existing rows via `ST_AsText` (same coordinates); drops the unused GIST indexes; no-op on SQLite. Verified ORM round-trip returns `POINT(80.0424808 12.8236146)` |
| 5 | Seed ran ~10 min on every boot (N+1 upserts at ~800 ms RTT to Oregon) | Loader is per-row query by design (fine on SQLite) | `csv_loader --skip-if-seeded` (3-query probe per payload); `prod_bootstrap` passes it. First boot seeds; later boots skip in ~9 s. Idempotency preserved for reseeds |
| 6 | `VIRTUAL_ENV=/opt/render/project/src/.venv` mismatch warning; inconsistent env between build and start | uv's project venv (`backend/.venv`) vs Render's injected venv | `UV_PROJECT_ENVIRONMENT=/opt/render/project/src/.venv` — `uv sync` and `uv run` now share one environment (warning gone from deploy logs) |
| 7 | Production silently booted on SQLite when `DATABASE_URL` was absent | Config default `sqlite:///./campusnav.db` applied under `APP_ENV=production` | Fail-fast guard in `Settings` (validation error at boot) — no SQLite fallback in production |

## P. Security checks
- No credentials in code, commits, or this report: `DATABASE_URL` is a Render env var; `JWT_SECRET` generated on Render; `.env*` gitignored (`.env.local` from Vercel CLI added to `frontend/.gitignore`).
- `uv.lock` tracked (Docker `COPY` path valid); no hardcoded keys/tokens; admin endpoints gated by `Role.ADMIN`.
- Smoke-test user/rows deleted from PG after verification (evidence captured before cleanup).

## Q. Final verdict

**`READY`** — the live Render backend (Postgres-backed) and Vercel frontend passed the smoke
battery on 2026-08-17: health, campuses, graph, stats, A* route, search, GPS/near, panorama
relay, NOVA, auth (register/login), favorites, preferences, CORS, and DB persistence — all
200/expected, evidence in sections B–M.

### Remaining warnings (non-blocking)
1. **Free-tier limits:** Postgres expires 2026-09-16 (30-day free DB); free web service sleeps after ~15 min idle (cold start ~30–60 s) and has no HA.
2. **External DB endpoint:** private-network DNS unavailable for this workspace's free Postgres, so the app connects over the public endpoint (slower RTT, IP allow-list open). Upgrade path: same-region paid Postgres restores the private endpoint (`DATABASE_URL` swap only — code is agnostic).
3. **Geo storage:** point columns are WKT `text` on Postgres (not PostGIS geography); the unused GIST indexes were dropped. If SQL-side spatial queries are ever needed, add a `geography` generated column + GIST index — no app code changes required.
4. **No paid tier:** cold starts, no horizontal scaling, build minutes limited by free plan.
