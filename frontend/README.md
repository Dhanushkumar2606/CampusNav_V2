# Frontend — Vite + React + TS + Tailwind + shadcn/ui

## Phase 1

Scaffold only. The single page is a landing screen using the placeholder DK
palette (navy + neon green/cyan/purple) documented in `../BRANDING.md`.

## Run

```bash
npm install
npm run dev     # http://localhost:5173
npm run build
```

The Vite dev server proxies `/auth`, `/health`, and `/api` to
`http://localhost:8000` so the landing page can call the backend without CORS.

## Adding more shadcn components

The shadcn CLI expects `components.json` at the project root (already
written). To add components:

```bash
npx shadcn@latest add card
npx shadcn@latest add dialog
```

The pre-generated `src/components/ui/button.tsx` is shadcn's standard Button
restyled against the brand palette; new components will pick up the same
CSS variables in `src/index.css`.

## What lands in Phase 2

- MapLibre GL JS map view (`src/features/map/...`).
- Routing panel.
- Real API integration (via `/api/...` proxied to backend).
