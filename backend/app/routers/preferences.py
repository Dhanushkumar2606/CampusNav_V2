"""User preferences router — auth-scoped, JSON storage."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user
from app.models.user import User
from app.models.user_data import UserPreference
from app.schemas.discovery import PreferencesIn, PreferencesOut

router = APIRouter(prefix="/preferences", tags=["preferences"])

_DB = Annotated[Session, Depends(get_db)]
_USER = Annotated[User, Depends(get_current_user)]

_DEFAULTS: dict[str, object] = {
    "units": "metric",
    "default_mode": "shortest",
    "default_avoid_stairs": False,
    "default_require_accessible": False,
    "theme": "dark",
}


def _row(db: Session, user_id) -> UserPreference:
    row = db.execute(
        select(UserPreference).where(UserPreference.user_id == user_id)
    ).scalar_one_or_none()
    if row is None:
        row = UserPreference(user_id=user_id, prefs=dict(_DEFAULTS))
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def _merged(row: UserPreference) -> dict[str, object]:
    return {**_DEFAULTS, **row.prefs}


@router.get("", response_model=PreferencesOut)
def get_preferences(db: _DB, user: _USER) -> PreferencesOut:
    return PreferencesOut.model_validate(_merged(_row(db, user.id)))


@router.put("", response_model=PreferencesOut)
def put_preferences(payload: PreferencesIn, db: _DB, user: _USER) -> PreferencesOut:
    row = _row(db, user.id)
    updated = dict(row.prefs)
    for key, value in payload.model_dump(exclude_none=True).items():
        updated[key] = value
    row.prefs = updated
    db.commit()
    return PreferencesOut.model_validate(_merged(row))
