# CampusNav V2

AI-native campus navigation. Users state an intent
("I have class in 15 minutes, I'm at the library, get me the accessible route")
and the AI agent resolves location, destination, and route type automatically —
now with an in-app 360° panorama viewer for scene-linked campus locations.

**Current phase: post-release stabilization + OSM network rebuild + in-app 360° panorama viewer.**

## What CampusNav V2 can do

- **Interactive campus maps** (MapLibre) with real OpenStreetMap walking networks,
  GeoJSON-style edge geometry, auto campus detection from GPS, and a live
  "use my location" ranking.
- **Real route planning**: A\* over the actual walkable network with modes
  (shortest / fastest / accessible), `avoid_stairs` penalties, restricted-edge
  exclusion, alternative routes (0–3), turn-by-turn instructions, honest
  ETA/distance, and a live turn-by-turn navigation session with GPS progress,
  off-route detection and arrival state.
- **AI assistant** that executes real campus tools: route calculation through
  the A\* engine, building lookup, nearby places, campus info — no LLM key
  required; answers only from real data, never invented.
- **Scored campus search** (exact / prefix / boundary / substring / token-fraction
  with rare-token tie-breaks), building details (entrances, floors), campus
  categories hub with live stats.
- **Favorites & preferences** (auth-scoped), dark/light theming, responsive
  mobile-first shell.
- **In-app 360° panorama**: scene-linked cubes from the official campus tour —
  a backend tile relay (allowlisted scene GUIDs) proxies tile pyramids; the
  frontend assembles faces and renders a GPU cubemap in-app with progressive
  quality (512 → 1024 → 2048) and VR head-tracked viewing (gyroscope).
- **Honesty by design**: every data point is real and verifiable; everything
  unavailable is shown as unavailable, never approximated silently.

## How it's different from other campus navigation apps

| Other campus apps | CampusNav V2 |
|---|---|
| Static map pins or drawn-on-top-of-Google routes | Route over the **real OSM walkable network** (nodes where ways meet, entrance connectors), rebuilt with Overpass, edge geometry included |
| Hardcoded "accessible" claims | Honest accessibility: `is_accessible` is real, `accessibility_verified=false` is shown as "Unverified campus data"; `avoid_stairs` is a real A\* penalty |
| Chatbots that hallucinate answers | Rule-based assistant that **executes real tools** (A\* routing, search, building details) and says "already there", "no canteen found", or offers real candidates instead of guessing |
| Fake distances/hours/GPS | Every number is computed from real data; GPS states are explicit (idle/locating/ok/denied/unavailable); missing data → unavailable UI states |
| Embed the whole tour site or nothing | **Scene-linked 360°**: each building maps to exactly one panorama scene (media_id GUID) of the official tour; tiles are streamed at view time, never stored or mirrored, and only when a scene is known for that node |
| One campus, one hardcoded layout | Multi-campus catalog (SRM KTR, VIT Chennai), per-campus config, geo-detection, searchable campuses |
| Monolith with all features bundled | Code-split chunks (three/maplibre/motion/icons/radix), lazy routes, Docker + GitHub Actions CI |
| No fallbacks when WebGL breaks | Map pre-checks WebGL and degrades to an honest "map unavailable" panel; error boundaries catch MapLibre crashes |

## Status

| Phase | Work | Status |
|-------|------|--------|
| 0 | Git init + baseline checkpoint (`3013556`) | ✅ Done |
| 1 | Premium design system + app shell | ✅ Done (`016add9`) |
| 2 | Interactive map (MapLibre) | ✅ Done (`4bff333`) |
| 3 | Routing engine: modes, alternatives, instructions, honest accessibility | ✅ Done (`9747182`) |
| 4 | Search, building details, explore, favorites, preferences | ✅ Done |
| 5 | Rule-based AI assistant (backend + chat UI) | ✅ Done |
| 6 | Mobile UX + premium polish (theme toggle, badge, responsive, state wrappers) | ✅ Done |
| 7 | Performance (code splitting, manualChunks, lazy routes) | ✅ Done |
| 8 | Tests + CI pipeline (backend, frontend, Docker) | ✅ Done |
| 9 | Accessibility audit, docs, final report, release tag | ✅ Done (`v1.0.0-premium`) |
| 10 | Stabilization: design-system tokens, campus hub + auto-detect, WebGL fallback | ✅ Done (`0e9d2d5`) |
| 11 | Assistant with real A\* routing + honest intent resolution | ✅ Done (`b0480d3`, `10dd3c6`) |
| 12 | OSM network rebuild (Overpass), VIT Chennai campus, theme/favicon fixes | ✅ Done (`09c91ef`) |
| 13 | In-app 360° panorama viewer (scene-linked immersive layer) | ✅ Done (`0a3074c`) |

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
- **Frontend**: `src/api/search.ts`, `src/api/favorites.ts`, `src/api/preferences.ts` wrappers.
- **Frontend pages**: `Explore.tsx` (live search, category chips, recent searches, keyboard nav, bottom-sheet detail), `Saved.tsx` (favorites list with remove/navigate), `Profile.tsx` (preferences UI with units, mode, accessibility toggles).

### Phase 5 — Rule-based AI Assistant (completed)
- Backend `app/services/assistant.py`: rule-based intent engine over real search/routing (no LLM key required).
- Backend `app/routers/assistant.py`: `POST /assistant/query` endpoint.
- Frontend `src/api/assistant.ts` wrapper + `Assistant.tsx` chat UI: suggested prompts, message bubbles, route/search result cards, typing indicator, `aria-live` conversation log.

### Phase 6 — Mobile UX + Premium Polish (completed)
- `ThemeProvider` + `ThemeToggle` with dark/light mode persistence (localStorage + `prefers-color-scheme`).
- `PremiumBadge` component shown in header when `PREMIUM=true`.
- `StateWrapper` component for consistent loading/empty/error/offline states across pages.
- Responsive design: mobile-first bottom nav, side nav drawer, touch-friendly hit targets.
- Added `Switch` UI primitive for toggle controls.
- CSS variables for both themes in `src/index.css`; Tailwind `warning` color added.

### Phase 7 — Performance (completed)
- `React.lazy` + `Suspense` code-splits every page (Landing → MapViewHost chunks of 2.7–28 kB).
- `manualChunks` isolates maplibre (single heavy, cached), three, framer-motion, lucide icons, and the Radix primitives.
- Main entry bundle reduced from ~1.3 MB to ~61 kB gzip 21 kB.

### Phase 8 — Tests + CI Pipeline (completed)
- Backend: 113 tests passing (health, auth, routing, discovery, search, assistant, A\*, immersive metadata, panorama).
- Frontend: TypeScript build passes, ESLint clean.
- GitHub Actions workflow (`.github/workflows/ci.yml`): backend tests → frontend lint/typecheck/build → Docker build + health check.
- Docker multi-stage build (Node 20 → Python 3.12) with `PREMIUM` build arg.
- `docker-compose.yml` for local dev/prod with hot-reload.

### Phase 9 — Accessibility + Docs + Final Report (completed)
- A11y audit & fixes: skip-to-content link, `main` landmark, ARIA pass (tabs, switch, listbox, dialog, live regions), keyboard nav audit, focus rings, `prefers-reduced-motion`.
- Docs: `docs/API.md`, `docs/USER_GUIDE.md`, `docs/FINAL_REPORT.md`. OpenAPI served at `/docs`.
- Tagged `v1.0.0-premium` with a GitHub release.

### Phase 10 — Stabilization (post-release)
- **Design-system tokens**: brand palette as CSS variables (`:root` dark + `.light` overrides); `card`, `popover`, `destructive` tokens; `SearchableSelect` primitive; `PageTransition` remount; `BottomSheet` focus trap + `aria-modal`; `StateWrapper` wired into Explore/Saved/Profile.
- **Campus hub + auto-detect**: migration `0007` (`campuses.featured`, `center_lat/lng`); `GET /navigation/campuses/near` (haversine geo-ranking, honest `distance_m`); `GET /navigation/campuses/{slug}/stats`; Explore home campus hub; map auto-detects nearest campus (URL param → last-used → geo → featured); multi-file seed directories.
- **WebGL resilience** (`0e9d2d5`): `MapCanvas` pre-checks WebGL and falls back to an honest "map unavailable" panel; `MapErrorBoundary` catches MapLibre crashes without unmounting the React tree.

### Phase 11 — Assistant with real execution (post-release)
- Assistant now runs real campus tools instead of a scripted LLM (`b0480d3`):
  `calculate_route` calls the A\* router (shortest/fastest/accessible) with label or UUID endpoints; honest responses ("already there", "no canteen found") instead of unrelated nearby nodes; building detail, nearby places, campus info and categories cards; frontend passes live browser coordinates.
- Honest destination resolution + rare-token ranking (`10dd3c6`): IDF-style tie-break ranks candidates matching rare query tokens ("Tech Park" beats every generic "Block" for "cse block"); `_first_result` only treats strong matches (≥60) as THE destination; leading articles stripped; ambiguous phrases return the real candidate list; info intent resolves entrance nodes to their building details.
- 82 backend tests green at this point.

### Phase 12 — OSM network rebuild + multi-campus (`09c91ef`)
- Routing networks rebuilt from real OpenStreetMap walkways via Overpass (`build_network_graph.py`: per-campus CLI, component snap + fragment bridging, honest estimated links, edge geometry).
- VIT Chennai seed added (201 nodes / 243 edges) + raw OSM cache; SRM network intact (310 nodes / 389 edges).
- Path-edge geometry + campus catalog migrations and seed loader tests.
- Profile theme fix: server preference only seeds theme when no local choice exists; persisted theme kept on navigation.
- Campusverse compass icon registered as favicon + apple-touch-icon.

### Phase 13 — In-app 360° panorama viewer (`0a3074c`)
- **Backend tile relay** (`backend/app/routers/panorama.py`): allowlisted 7 scene GUIDs (SRM tour), strict input validation (path params, int ranges, orientation whitelist), proxies real JPEG tiles from the official tour's 512 px pyramid; registered on both `/api` and bare prefixes; honest 400/404/502 error mapping.
- **Scene-linked immersive layer**: per-campus JSON config (`0008_campus_immersive` migration; `immersive_json` on campuses), inflated per-node by `/navigation` graph as `metadata.immersive` — a node gets immersive content **only when ITS OWN scene has a url/media_id** (never a whole-site tour); navigation engine ignores it entirely (purely additive).
- **Frontend GPU cubemap** (`frontend/src/features/immersive/`): Three.js renderer, six `PlaneGeometry` faces on the verified `CUBE_FACES` basis (cross-correlated 0.99+ on all 12 cube edges), `MeshBasicMaterial` BackSide from inside; progressive pyramid loader (512² → 1024² → 2048², per-face upgrade in `LOAD_ORDER`, tiles cached, `AbortController` disposal).
- **`ImmersiveViewer` portal** + entry points: "Explore 360°" in `BuildingDetails`, route-aware chips in `NavStatusBar` + `NavigationSteps` (node = current step endpoint).
- **Fixed white screen**: every map swap now sets `material.needsUpdate = true` so Three.js recompiles the shader program — without it the mapless program kept drawing solid white (textures never uploaded).
- **VR head tracking**: render loop damps toward the orientation target (`vr.targetYaw/targetPitch`) with smooth calibration on first event; exit on touch/Esc/fullscreen change.
- 7 panorama tests + immersive metadata tests; full backend suite 113 passing; frontend tsc + vite build clean.

## Guardrails (all phases)

- **No fake data**: no invented buildings/routes/accessibility/hours/GPS/AI answers. Unavailable data → explicit unavailable states.
- Accessibility is honest: current edges are `is_accessible=true` but `accessibility_verified=false` → UI shows "Unverified campus data".
- The 360° layer is scene-linked and additive: it only streams a single scene's tiles for nodes that have one, never embeds or mirrors the whole-site tour, and never affects routing.

## Layout

```
CampusNav_V2/
├── README.md              # this file
├── BRANDING.md            # premium palette (deep navy + emerald/teal)
├── .env.example           # copy to .env and fill in
├── .github/workflows/     # CI pipeline (ci.yml)
├── Dockerfile             # multi-stage build (Node 20 → Python 3.12)
├── docker-compose.yml     # local dev/prod with hot-reload
├── backend/               # FastAPI + SQLAlchemy + Alembic + A* routing
│   ├── app/
│   │   ├── routing/       # astar.py (modes, alternatives, instructions)
│   │   ├── services/      # search.py, navigation.py, assistant.py
│   │   ├── routers/       # health, auth, navigation, discovery, favorites,
│   │   │                  # preferences, assistant, admin, panorama
│   │   ├── models/        # user, campus, graph, provenance, timetable, user_data
│   │   └── config.py      # settings + PREMIUM flag
│   ├── migrations/        # alembic (0004 accessibility … 0008 immersive)
│   ├── seed_data/         # per-campus JSON seed (SRM KTR, VIT Chennai)
│   ├── scripts/           # build_network_graph.py (Overpass rebuild)
│   └── tests/             # 113 tests
└── frontend/              # Vite + React + TS + Tailwind + MapLibre + Three.js
    ├── src/
    │   ├── components/ui/       # skeleton, chip, toast, bottom-sheet, switch, ...
    │   ├── features/            # routing/, map/, immersive/ (360° viewer)
    │   ├── pages/               # Explore, Assistant, Saved, Profile, MapView
    │   ├── api/                 # auth, search, favorites, preferences, assistant
    │   ├── lib/                 # brand.ts, navigation-types.ts, immersive.ts
    │   └── auth/                # AuthContext, RequireAuth
    ├── index.html
    ├── vite.config.ts
    ├── tailwind.config.ts
    └── tsconfig.json
```

## Docs

- [API reference](docs/API.md) — every endpoint, auth, request/response shapes
- [User guide](docs/USER_GUIDE.md) — how to use the app
- [Final report](docs/FINAL_REPORT.md) — phase-by-phase summary

## Quickstart

### 1. Backend

Install with uv, then migrate + seed + run:

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

The API (including the panorama tile relay and the SPA itself) is served on
`http://localhost:8000`. The SPA static mount resolves `frontend/dist`
relative to the repo root — build the frontend first (below) or use `npm run dev`.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
# -> http://localhost:5173 (dev server, proxies /api to :8000)
```

For a production-style build served by the backend itself:

```bash
cd frontend
npm run build
# then open http://localhost:8000 (uvicorn serves frontend/dist as the SPA)
```

### 3. Tests

```bash
cd backend
uv run pytest            # 113 tests
```

Frontend checks: `npm run lint` (tsc), `npm run build` (tsc + vite).

### 4. Seed data / campuses

- SRM Kattankulathur: real OSM walkable network (310 nodes / 389 edges) + immersive 360° scenes.
- VIT Chennai: 201 nodes / 243 edges.
- Re-seed any campus any time: `uv run python -m app.seed.csv_loader --data-dir ./seed_data`
  (idempotent — updates in place, keeps unlisted data).

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
- **In-app 360° panorama viewer** (scene-linked cubes + VR head tracking)
- **Admin endpoints** (`/admin/feature-flags`, `/admin/seed`) protected by `Role.ADMIN`
- **Docker-ready** multi-stage build (Node 20 + Python 3.12)
- **CI pipeline** (GitHub Actions) validating frontend, backend, and Docker build

## API surface

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | — | health check |
| POST | `/auth/register`, `/auth/login`; GET `/auth/me` | token | auth |
| GET | `/navigation/campuses` | — | list campuses |
| GET | `/navigation/campuses/{slug}/graph` | — | graph (nodes+edges, incl. `metadata.immersive`) |
| GET | `/navigation/campuses/{slug}/buildings` | — | building list |
| POST | `/navigation/campuses/{slug}/route` | — | route (mode, avoid_stairs, alternatives) |
| GET | `/panorama/tile/{mediaId}/{face}/{level}/{row}_{col}.jpg` | — | 360° tile relay (allowlisted mediaIds) |
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

- SRM Kattankulathur: campus buildings, 310 path nodes, 389 path edges —
  real walkways rebuilt from OpenStreetMap; `is_estimated=true` only for
  short entrance connectors; `accessibility_verified=false` (unverified,
  shown honestly in the UI).
- VIT Chennai: 201 nodes / 243 edges, same honest conventions.
- Immersive config: scene-linked only — each mapped block has its own
  panorama scene GUID; the whole-site tour is never embedded and no imagery
  is stored or mirrored.