# CampusNav V2

AI-native campus navigation. Users state an intent
("I have class in 15 minutes, I'm at the library, get me the accessible route")
and the AI agent resolves location, destination, and route type automatically.

## Status

**Phase 1 — Foundation** (in progress). This phase ships:

- Monorepo scaffold (`/frontend`, `/backend`).
- PostgreSQL + PostGIS-shaped schema (works against SQLite for first run).
- JWT auth (`/auth/register`, `/auth/login`, `/auth/me`).
- CSV-driven seed script for a clearly-labeled placeholder campus.
- Health check (`/health`).

**Not in Phase 1** (per spec): MapLibre, A\* routing, Claude tool-use, admin UI,
real campus data, AR/3D, community features.

## Layout

```
CampusNav_V2/
├── README.md          # this file
├── BRANDING.md        # placeholder palette (swap-later)
├── .env.example       # copy to .env and fill in
├── backend/           # FastAPI + SQLAlchemy + Alembic
└── frontend/          # Vite + React + TS + Tailwind + shadcn/ui
```

## Quickstart (Phase 1)

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

## Database

Default in `.env.example` is SQLite (`sqlite:///./campusnav.db`) so the
first run works without Docker. The geo columns are written as nullable
strings on SQLite; against Postgres+PostGIS they become `geography(Point,4326)`.

When you have Docker Desktop running, flip `DATABASE_URL` to:

```
postgresql+psycopg://campusnav:campusnav@localhost:5433/campusnav
```

and bring up a PostGIS container (Phase 2 will ship a `docker-compose.yml`).

## Phase plan

- **Phase 1 (this phase)** — repo, schema, auth, seed, health.
- **Phase 2** — MapLibre tile rendering, A\* over `path_nodes` / `path_edges`.
- **Phase 3** — Claude tool-use agent for intent parsing + route orchestration.
- **Phase 4** — Polish and (optionally) deploy.

Confirm each phase before the next one starts.
