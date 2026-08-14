# Frontend — Vite + React + TS + Tailwind + shadcn/ui

Premium campus-navigation UI: MapLibre map, A* routing panel, Explore
search + campus hub, rule-based assistant chat, favorites, preferences,
theme toggle, mobile-first layout. See the root `README.md` for the
phase-by-phase history.

## Run

```bash
npm install
npm run dev     # http://localhost:5173
npm run lint    # tsc -b typecheck
npm run build
```

The Vite dev server proxies `/auth`, `/health`, and `/api` to
`http://localhost:8000` so the app can call the backend without CORS.

### Optional env vars (`.env`)

- `VITE_SHOW_GRAPH_DEBUG=true` — render the raw campus graph (surveyed +
  estimated edges, node dots) on the map by default. Normal users see only
  the computed route; this reveals the routing network for debugging.

## Structure

- `src/pages/` — routed pages (Landing, MapViewHost/MapView, Explore,
  Assistant, Saved, Profile, Login).
- `src/features/` — domain code: map renderers (`features/map/`), routing
  (`features/routing/`), navigation session (`features/navigation/`),
  campus session state (`features/campus/CampusRouteContext.tsx`), the
  Explore campus hub (`features/explore/CampusHub.tsx`).
- `src/components/ui/` — shadcn-style primitives restyled against the brand
  CSS variables in `src/index.css` (Button, Card, Sheet, SearchableSelect,
  StateWrapper, …).
- `src/api/` — typed fetch wrappers; `src/lib/` — types + helpers.

## Adding more shadcn components

The shadcn CLI expects `components.json` at the project root (already
written). New components will pick up the same CSS variables in
`src/index.css` (light theme via the `.light` class, dark via `:root`).
