"""Health check endpoint."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter
from sqlalchemy import text

from app import __version__
from app.db import engine
from app.schemas.health import HealthOut

router = APIRouter(tags=["health"])
log = logging.getLogger(__name__)


@router.get("/health", response_model=HealthOut)
def health() -> dict[str, Any]:
    """Report service health. 503 if the DB is unreachable."""
    db_status = "ok"
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001 — health probe must catch everything
        log.warning("DB health check failed: %s", exc)
        db_status = f"error:{exc!s}"[:200]

    overall = "ok" if db_status == "ok" else "degraded"
    return {"status": overall, "db": db_status, "version": __version__}
