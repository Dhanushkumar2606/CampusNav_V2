"""Assistant router: POST /assistant/query."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.services.assistant import assistant_query

router = APIRouter(prefix="/assistant", tags=["assistant"])


class AssistantQueryIn(BaseModel):
    query: str = Field(..., min_length=1, max_length=500)
    campus_slug: str | None = None
    user_location: str | None = None  # node UUID
    time_constraint_min: int | None = Field(default=None, ge=1, le=1440)


class AssistantResponseOut(BaseModel):
    kind: str
    text: str
    data: dict | None = None


@router.post("/query", response_model=AssistantResponseOut)
def assistant_query_endpoint(
    payload: AssistantQueryIn,
    db: Session = Depends(get_db),
) -> AssistantResponseOut:
    """Rule-based AI assistant — resolves intent and returns structured response."""
    response = assistant_query(
        session=db,
        query=payload.query,
        campus_slug=payload.campus_slug,
        user_location=payload.user_location,
        time_constraint_min=payload.time_constraint_min,
    )
    return AssistantResponseOut(kind=response.kind, text=response.text, data=response.data)