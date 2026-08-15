"""FastAPI entrypoint for the CampusNav V2 backend."""

from __future__ import annotations

import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import __version__
from app.config import get_settings
from app.routers import admin, assistant, auth, discovery, favorites, health, navigation, panorama, preferences

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

settings = get_settings()

app = FastAPI(
    title="CampusNav V2 API",
    version=__version__,
    description=(
        "AI-native campus navigation. Phase 1 ships the foundation — repo, "
        "schema, JWT auth, seed script, health check."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# The API is registered twice: bare (`/auth/login`, used by the Vite dev
# proxy, which strips the `/api` prefix) and under `/api` (`/api/auth/login`,
# used by the built SPA in production where no proxy exists).
_BARE_ROUTERS = [
    health.router,
    auth.router,
    navigation.router,
    discovery.router,
    favorites.router,
    preferences.router,
    admin.router,
    assistant.router,
    panorama.router,
]
for router in _BARE_ROUTERS:
    app.include_router(router)
    app.include_router(router, prefix="/api")

# Serve frontend SPA (mounted after API routes so API takes precedence).
# SPA fallback: any unknown path (e.g. refreshing /register or /map) gets
# index.html so the client-side router can render it, instead of a 404.
# StaticFiles raises HTTPException(404) for missing files rather than
# returning a 404 response, so the catch is on the exception.
class SPAStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope) -> Response:
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404:
                raise
            return await super().get_response("index.html", scope)


# Resolve the built SPA relative to the repo root (backend/../frontend/dist),
# independent of the process CWD — uvicorn is commonly started from backend/.
# main.py lives at backend/app/main.py, so three parent dirs up is the root.
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_DIST = os.path.join(_REPO_ROOT, "frontend", "dist")
if os.path.isdir(_DIST):
    app.mount("/", SPAStaticFiles(directory=_DIST, html=True), name="static")


@app.get("/api/root", tags=["root"])
def root() -> dict[str, str]:
    return {
        "service": "campusnav-v2-backend",
        "version": __version__,
        "env": settings.app_env,
        "docs": "/docs",
    }
