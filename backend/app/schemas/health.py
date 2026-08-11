"""Health check schema."""

from __future__ import annotations

from pydantic import BaseModel, Field


class HealthOut(BaseModel):
    status: str = Field(description="'ok' or 'degraded'")
    db: str = Field(description="'ok' or 'error:<message>'")
    version: str
