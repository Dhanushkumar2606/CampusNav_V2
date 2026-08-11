"""FastAPI entrypoint for the CampusNav V2 backend."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.config import get_settings
from app.routers import auth, health, navigation

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


@app.get("/", tags=["root"])
def root() -> dict[str, str]:
    return {
        "service": "campusnav-v2-backend",
        "version": __version__,
        "env": settings.app_env,
        "docs": "/docs",
    }
