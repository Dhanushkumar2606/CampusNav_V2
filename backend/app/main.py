"""FastAPI entrypoint for the CampusNav V2 backend."""

from __future__ import annotations

import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.config import get_settings
from app.routers import admin, assistant, auth, discovery, favorites, health, navigation, preferences

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

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(navigation.router)
app.include_router(discovery.router)
app.include_router(favorites.router)
app.include_router(preferences.router)
app.include_router(admin.router)
app.include_router(assistant.router)

# Serve frontend SPA (mounted after API routes so API takes precedence)
if os.path.isdir("frontend/dist"):
    app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="static")


@app.get("/api/root", tags=["root"])
def root() -> dict[str, str]:
    return {
        "service": "campusnav-v2-backend",
        "version": __version__,
        "env": settings.app_env,
        "docs": "/docs",
    }
