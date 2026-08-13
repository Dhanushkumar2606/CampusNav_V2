# CampusNav V2

AI-native campus navigation. Users state an intent
("I have class in 15 minutes, I'm at the library, get me the accessible route")
and the AI agent resolves location, destination, and route type automatically.

**Current phase: Phase 9 — Accessibility + Docs + Final Report (in progress).**

## Status

| Phase | Work | Status |
|-------|------|--------|
| 0 | Git init + baseline checkpoint (`3013556`) | ✅ Done |
| 1 | Premium design system + app shell | ✅ Done (`016add9`) |
| 2 | Interactive map (MapLibre) | ✅ Done (`4bff333`) |
| 3 | Routing engine: modes, alternatives, instructions, honest accessibility | ✅ Done (`9747182`) |
| 4 | Search, building details, explore, favorites, preferences | ✅ Done |
| 5 | Rule-based AI assistant (backend + frontend stub) | ✅ Done |
| 6 | Mobile UX + premium polish (theme toggle, badge, responsive, state wrappers) | ✅ Done |
| 7 | Performance (code splitting, manualChunks, lazy routes) | ✅ Configured |
| 8 | Tests + CI pipeline (backend, frontend, Docker) | ✅ Done |
| 9 | Accessibility audit, docs, final report | 🔄 In progress |

## Completed work

### Phase 0 — Baseline
- `git init` at repo root, baseline commit `3013556` of the verified Phase 1–2 foundation.

### Phase 1 — Premium design system + shell (`016add9`)
- Brand refresh: deep navy + emerald/teal premium palette in `tailwind.config.ts`, `src/index.css`, `src/lib/brand.ts`.
- UI primitives: `skeleton`, `chip`, `progress`, `tabs`, `empty-state`, `error-state`, `toast`, `bottom-sheet` (framer-motion).
- `AppShell` + `Header` / `SideNav` / `BottomNav`; routes `/explore /assistant /saved /profile` behind `RequireAuth`.
- `ToastProvider`; fixed lint script (`tsc -b`).

### Phase 2 — Interactive map (`4bff333`)
- `useNodeClick`, `useGeolocate` (honest idle/locating/ok/denied/unavailable states), `MapControls` (recenter/locate/edge toggle).
- `BuildingDetails` card (real data only, "Not available" for missing) + mobile `BottomSheet`.
- `MapView` selected-node state; `listBuildings` API.

### Phase 3 — Routing engine (`9747182`)
- Migration `0004`: `path_edges` accessibility fields (`surface_type`, `slope`, `path_type`, `is_indoor`, `is_outdoor`, `is_restricted`, `accessibility_verified`).
- A\* with `RouteMode` (shortest/fastest), `avoid_stairs` penalty ×10, restricted-edge exclusion in accessible mode, `find_alternatives`, human-readable `instruction` + `summary`; fixed g-score units bug.
- API: `RouteRequestIn` (`mode`, `avoid_stairs`, `alternatives` 0–3), `RouteOut.summary`, `RouteStepOut.instruction`, `PathEdgeOut` accessibility fields, `RouteResponse.alternatives`.
- Seed loader reads accessibility fields; idempotent re-seed.
- Frontend: `RoutePreferences`, `NavigationSteps`, `RoutingPanel` rewrite with alternatives tabs, honest `EstimatedBanner` ("Unverified campus data").
- 30 backend tests passing (incl. 12 in `test_routing_options.py`).

### Phase 4 — Search & Places (completed)
- Migration `0005` (applied): `favorites`, `user_preferences` tables.
- `app/models/user_data.py`: `Favorite`, `UserPreference`.
- `app/services/search.py`: scored fuzzy search over buildings + graph nodes + POIs (exact 100 / prefix 80 / word-boundary 70 / substring 45 / token fraction); entrance nodes deduped against building codes; unique entrances (gates, transit) searchable.
- `app/routers/discovery.py`: `GET /search`, `GET /campuses/{slug}/categories`, `GET /buildings/{id}`.
- `app/routers/favorites.py`: auth-scoped `GET/POST /favorites`, `DELETE /favorites/{id}` (idempotent add, target existence check).
- `app/routers/preferences.py`: auth-scoped `GET/PUT /preferences` (partial updates, defaults preserved).
- `app/schemas/discovery.py`: search/building detail/categories/favorites/preferences schemas.
- **Frontend**: `src/api/search.ts`, `src/api/favorites.ts`, `src/api/preferences.ts` wrappers.
- **Frontend pages**: `Explore.tsx` (live search, category chips, recent searches, keyboard nav, bottom-sheet detail), `Saved.tsx` (favorites list with remove/navigate), `Profile.tsx` (preferences UI with units, mode, accessibility toggles).

### Phase 5 — Rule-based AI Assistant (completed)
- Backend `app/services/assistant.py`: rule-based intent engine over real search/routing (no LLM key required).
- Backend `app/routers/assistant.py`: `POST /assistant/query` endpoint.
- Frontend `src/api/assistant.ts` wrapper + `Assistant.tsx` page with floating chat panel, suggested prompts, place/route cards.

### Phase 6 — Mobile UX + Premium Polish (completed)
- `ThemeProvider` + `ThemeToggle` with dark/light mode persistence (localStorage + `prefers-color-scheme`).
- `PremiumBadge` component shown in header when `PREMIUM=true`.
- `StateWrapper` component for consistent loading/empty/error/offline states across pages.
- Responsive design: mobile-first bottom nav, side nav drawer, touch-friendly hit targets.
- Added `Switch` UI primitive for toggle controls.
- CSS variables for both themes in `src/index.css`; Tailwind `warning` color added.

### Phase 7 — Performance (configured)
- Vite `build.rollupOptions.output.manualChunks` for maplibre, UI primitives, assistant modules.
- `React.lazy` + `Suspense` for heavy routes (Explore, Saved, Profile, Assistant).
- Bundle size within budget after chunking.

### Phase 8 — Tests + CI Pipeline (completed)
- Backend: 45 tests passing (health, auth, routing, discovery, A*).
- Frontend: TypeScript build passes, ESLint clean.
- GitHub Actions workflow (`.github/workflows/ci.yml`): backend tests → frontend lint/typecheck/build → Docker build + health check.
- Docker multi-stage build (Node 20 → Python 3.12) with `PREMIUM` build arg.
- `docker-compose.yml` for local dev/prod with hot-reload.

### Phase 9 — Accessibility + Docs + Final Report (in progress)
- [ ] A11y audit (keyboard nav, ARIA, color contrast, reduced motion).
- [ ] API docs (OpenAPI) + user-facing docs.
- [ ] Final report summarizing all phases.
- [ ] Tag `v1.0.0-premium` release.

## Guardrails (all phases)

- **No fake data**: no invented buildings/routes/accessibility/hours/GPS/AI answers. Unavailable data → explicit unavailable states.
- Accessibility is honest: current edges are `is_accessible=true` but `accessibility_verified=false` → UI shows "Unverified campus data".

## Layout

```
CampusNav_V2/
├── README.md              # this file
├── BRANDING.md            # premium palette (deep navy + emerald/teal)
├── .env.example           # copy to .env and fill in
├── .github/workflows/     # CI pipeline (ci.yml)
├── Dockerfile             # multi-stage build (Node 20 → Python 3.12)
├── docker-compose.yml     # local dev/prod with hot-reload
├── .dockerignore          # build context exclusions
├── backend/               # FastAPI + SQLAlchemy + Alembic + A* routing
│   ├── app/
│   │   ├── routing/       # astar.py (modes, alternatives, instructions)
│   │   ├── services/      # search.py, navigation.py, assistant.py
│   │   ├── routers/       # health, auth, navigation, discovery, favorites, preferences, assistant, admin
│   │   ├── models/        # user, campus, graph, provenance, timetable, user_data
│   │   ├── extensions/    # three_d/, ar/, indoor/, panorama/ (reserved)
│   │   └── config.py      # settings + PREMIUM flag
│   ├── migrations/        # alembic (0004 accessibility, 0005 favorites/preferences)
│   ├── seed_data/         # CSV seed (SRM Kattankulathur, honest/estimated)
│   └── tests/             # 45 tests (health, auth, routing, discovery, A*)
└── frontend/              # Vite + React + TS + Tailwind + MapLibre + framer-motion
    ├── src/
    │   ├── components/ui/       # skeleton, chip, toast, bottom-sheet, switch, ...
    │   ├── features/routing/    # RoutingPanel, NavigationSteps, RoutePreferences
    │   ├── pages/               # Explore, Assistant, Saved, Profile, MapView
    │   ├── api/                 # auth, search, favorites, preferences, assistant
    │   ├── lib/                 # brand.ts, navigation-types.ts, utils.ts
    │   ├── auth/                # AuthContext, RequireAuth
    │   └── extensions/          # 3d/, ar/, indoor/, panorama/ (reserved)
    ├── index.html
    ├── vite.config.ts
    ├── tailwind.config.ts
    └── tsconfig.json
```

## Quickstart

### 1. Backend

```bash
cd backend
uv sync
cp ../.env.example .env
uv run alembic upgrade head
uv run python -m app.seed.csv_loader --data-dir ./seed_data
uv run uvicorn app.main:app --reload --port 8000
```

Verify:

```bash
curl http://localhost:8000/health
# -> {"status":"ok","db":"ok","version":"0.1.0"}
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
# -> http://localhost:5173
```

### 3. Tests

```bash
cd backend
uv run pytest
```

## Premium Build

CampusNav V2 includes a **Premium** feature flag that enables enhanced UI/UX, theme switching, and extension points for future 3D/AR/indoor/panorama capabilities.

### Enable Premium

Set the environment variable `PREMIUM=true` (or add `PREMIUM=true` to your `.env` file) before building or running.

#### Development

```bash
# Backend
cd backend
PREMIUM=true uv run uvicorn app.main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
PREMIUM=true npm run dev
```

#### Docker (Production)

```bash
# Build the multi-stage image
docker build -t campusnav:premium .

# Run with premium flag
docker run -e PREMIUM=true -p 8000:8000 campusnav:premium
```

The premium build includes:
- **Premium badge** in the header
- **Dark/Light theme toggle** with persistence
- **Responsive premium UI** with polished loading/empty/error/offline states
- **Extension directories** for future 3D, AR, indoor navigation, and 360° panorama layers
- **Admin endpoints** (`/admin/feature-flags`, `/admin/seed`) protected by `Role.ADMIN`
- **Docker-ready** multi-stage build (Node 20 + Python 3.12)
- **CI pipeline** (GitHub Actions) validating frontend, backend, and Docker build

### Architecture Extension Points

The following empty directories are reserved for future capabilities without restructuring the core:

**Backend**
```
backend/app/extensions/
├── three_d/
├── ar/
├── indoor/
└── panorama/
```

**Frontend**
```
frontend/src/extensions/
├── 3d/
├── ar/
├── indoor/
└── panorama/
```

These modules are intentionally empty; they establish clean boundaries so future work can be added without rewriting existing code.

## API surface

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | — | health check |
| POST | `/auth/register`, `/auth/login`; GET `/auth/me` | token | auth |
| GET | `/navigation/campuses` | — | list campuses |
| GET | `/navigation/campuses/{slug}/graph` | — | graph (nodes+edges) |
| GET | `/navigation/campuses/{slug}/buildings` | — | building list |
| POST | `/navigation/campuses/{slug}/route` | — | route (mode, avoid_stairs, alternatives) |
| GET | `/search?q=&campus=&limit=` | — | scored campus search |
| GET | `/campuses/{slug}/categories` | — | real category counts |
| GET | `/buildings/{id}` | — | building detail (entrances, floors, nodes) |
| GET/POST | `/favorites`; DELETE `/favorites/{id}` | token | saved places |
| GET/PUT | `/preferences` | token | user preferences |
| POST | `/assistant/query` | token | AI assistant query |
| GET | `/admin/feature-flags` | admin | feature flag status |
| POST | `/admin/seed` | admin | re-seed database |

## Database

Default in `.env.example` is SQLite (`sqlite:///./campusnav.db`) so the
first run works without Docker. Geo columns are written as nullable
strings on SQLite; against Postgres+PostGIS they become `geography(Point,4326)`.

When you have Docker Desktop running, flip `DATABASE_URL` to:

```
postgresql+psycopg://campusnav:campusnav@localhost:5433/campusnav
```

and bring up a PostGIS container.

## Seed data (honest)

Real SRM Kattankulathur campus: 8 buildings, 13 path nodes, 16 path edges —
all `is_estimated=true`, `is_accessible=true` but `accessibility_verified=false`
(unverified, shown honestly in the UI).
