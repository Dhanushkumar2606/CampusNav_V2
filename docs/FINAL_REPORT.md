# CampusNav V2 — Final Report

**Version:** v1.0.0-premium
**Date:** August 2026
**Repo:** https://github.com/Dhanushkumar2606/CampusNav_V2

## 1. What was built

CampusNav V2 is an AI-native campus navigation web app. Users state an intent
("I have a class in 15 minutes, I'm at the library, get me the accessible
route") and the system resolves location, destination and route type
automatically — from real campus data, with no invented answers.

Architecture: **FastAPI + SQLAlchemy + Alembic + A\*** backend,
**React + Vite + TypeScript + Tailwind + MapLibre GL** frontend,
**Docker multi-stage** deployment, **GitHub Actions** CI.

## 2. Phases delivered

| Phase | Work | Status |
|-------|------|--------|
| 0 | Git init + baseline checkpoint (`3013556`) | ✅ |
| 1 | Premium design system (deep navy + emerald/teal) + app shell | ✅ |
| 2 | Interactive MapLibre map: node click, geolocate, controls, details | ✅ |
| 3 | Routing engine: A\* with modes, alternatives, instructions, honest accessibility | ✅ |
| 4 | Scored fuzzy search, categories, building details, favorites, preferences | ✅ |
| 5 | Rule-based AI assistant — backend engine + full chat UI | ✅ |
| 6 | Mobile UX + premium polish: theme toggle, badge, responsive, state wrappers | ✅ |
| 7 | Performance: code splitting, manualChunks, lazy routes | ✅ |
| 8 | Tests + CI pipeline (backend, frontend, Docker) | ✅ |
| 9 | Accessibility audit, docs, final report, v1.0.0-premium release | ✅ |

## 3. Engineering highlights

### Routing (Phase 3)
- A\* over `path_edges` with `RouteMode` (shortest / fastest), stairs penalty
  (×10), restricted-edge exclusion for accessible routes, up to 3 alternatives.
- Human-readable per-step `instruction`s + route `summary`; fixed g-score
  units bug (distance vs. time).

### Honest data (all phases)
- **No fake data guardrail**: every building, node, edge, POI, and hours entry
  comes from `backend/seed_data/srm_ktr.json` (real SRM Kattankulathur campus).
- Accessibility is honest: edges are `is_accessible=true` but
  `accessibility_verified=false` → the UI explicitly shows "Unverified campus
  data" instead of pretending a route is wheelchair-safe.
- Favorites can never point at a deleted target (404 + row-skip on read).
- The assistant is rule-based — it resolves intents against the real search
  and routing engines, so it cannot hallucinate places.

### Search (Phase 4)
Scored fuzzy search (exact 100 / prefix 80 / word-boundary 70 / substring 45 /
token fraction), entrance-node deduplication, unique gates/transit searchable.

### Assistant (Phase 5)
Intent patterns (class-with-time, navigate-to, find, where-is, how-to-get-to)
→ structured `{kind, text, data}` responses; frontend renders route cards and
search results as tappable actions. No API key required.

### Performance (Phase 7)
- `manualChunks` splitting maplibre / UI primitives / assistant modules.
- `React.lazy` + `Suspense` on heavy routes; bundle within budget.

### Quality (Phase 8)
- **53 backend tests** (health, auth, routing options, discovery, assistant, A\*).
- Frontend: `tsc -b` typecheck + ESLint clean.
- CI: backend tests → frontend lint/typecheck/build → Docker build + health
  check (`.github/workflows/ci.yml`).
- Docker multi-stage (Node 20 → Python 3.12) with `PREMIUM` build arg;
  `docker-compose.yml` with hot reload.

## 4. Accessibility (Phase 9)

Audit performed across all pages and components:

- **Keyboard**: skip-to-content link, visible `:focus-visible` rings
  app-wide, arrow-key + Enter navigation in Explore search results, Escape to
  dismiss, full tab order through nav/map/panels.
- **ARIA**: `tablist/tab/tabpanel`, `switch` + `aria-checked`, `aria-pressed`
  on mode toggles, `listbox/option`, `list/listitem`, `dialog` on bottom
  sheets, `role="log"` + `aria-live="polite"` on the assistant conversation,
  `aria-live` toast region, labelled search inputs.
- **Contrast**: premium palette tuned for both themes; amber `warning` text
  only on dark surfaces with sufficient ratio; all interactive states
  hover/focus/selected distinct.
- **Reduced motion**: global `prefers-reduced-motion` CSS override plus
  framer-motion `useReducedMotion` in the bottom sheet.
- **Structure**: landmarks (`header`, `nav`, `main`), heading hierarchy,
  `sr-only` labels where icons carry meaning.

## 5. API surface

24 endpoints across 8 routers: health, auth, navigation (campuses/graph/
buildings/route), discovery (search/categories/building detail), favorites,
preferences, assistant, admin. OpenAPI docs auto-served at `/docs` and
`/redoc`. Full reference: [API.md](./API.md).

## 6. Operational notes

- SQLite by default (`campusnav.db`); Postgres + PostGIS supported via
  `DATABASE_URL` (geo columns become `geography(Point,4326)`).
- `PREMIUM=true` enables the premium badge, theme toggle and extension points
  (backend `app/extensions/{three_d,ar,indoor,panorama}` and frontend
  `src/extensions/` are reserved for future capabilities).
- Seed is idempotent (`/admin/seed` or `python -m app.seed.csv_loader`).

## 7. Known limitations

- Accessibility data unverified (surfaced honestly in UI).
- Single campus seeded (SRM Kattankulathur); multi-campus is designed in
  (`campus_slug` everywhere) but unseeded.
- Assistant is rule-based; an LLM backend can be swapped into
  `app/services/assistant.py` without changing the API contract.
- 3D / AR / indoor / panorama extension directories are placeholders.

## 8. Metrics

- Backend: 8 routers, 53 tests passing.
- Frontend: 5 pages, ~25 UI components, chunked bundle.
- CI: 3 stages green per push.
- Seed: 8 buildings, 13 path nodes, 16 path edges — all estimated/unverified, honest.