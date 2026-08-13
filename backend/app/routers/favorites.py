"""Favorites router — auth-scoped saved places."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user
from app.models.campus import Building
from app.models.graph import PathNode
from app.models.user import User
from app.models.user_data import Favorite
from app.schemas.discovery import FavoriteIn, FavoriteOut

router = APIRouter(prefix="/favorites", tags=["favorites"])

_DB = Annotated[Session, Depends(get_db)]
_USER = Annotated[User, Depends(get_current_user)]


def _resolve_label(db: Session, target_type: str, target_id: UUID) -> tuple[str, str] | None:
    """(label, category) for a favorite target, or None if it's gone."""
    if target_type == "building":
        b = db.get(Building, target_id)
        return (b.name, "building") if b else None
    n = db.get(PathNode, target_id)
    return (n.label, n.kind.value) if n else None


@router.get("", response_model=list[FavoriteOut])
def list_favorites(db: _DB, user: _USER) -> list[FavoriteOut]:
    rows = db.execute(
        select(Favorite).where(Favorite.user_id == user.id).order_by(Favorite.created_at.desc())
    ).scalars().all()
    out: list[FavoriteOut] = []
    for f in rows:
        resolved = _resolve_label(db, f.target_type, f.target_id)
        if resolved is None:
            continue  # target deleted — skip rather than show a broken row
        item = FavoriteOut.model_validate(f)
        item.label, item.category = resolved
        out.append(item)
    return out


@router.post("", response_model=FavoriteOut, status_code=status.HTTP_201_CREATED)
def add_favorite(payload: FavoriteIn, db: _DB, user: _USER) -> FavoriteOut:
    # Target must exist — never save a pointer to nothing.
    exists = _resolve_label(db, payload.target_type, payload.target_id)
    if exists is None:
        raise HTTPException(status_code=404, detail="place not found")

    existing = db.execute(
        select(Favorite).where(
            Favorite.user_id == user.id,
            Favorite.target_type == payload.target_type,
            Favorite.target_id == payload.target_id,
        )
    ).scalar_one_or_none()
    if existing is not None:
        # Idempotent add — return the existing favorite.
        item = FavoriteOut.model_validate(existing)
        item.label, item.category = exists
        return item

    fav = Favorite(
        user_id=user.id,
        target_type=payload.target_type,
        target_id=payload.target_id,
        note=payload.note,
    )
    db.add(fav)
    db.commit()
    db.refresh(fav)
    item = FavoriteOut.model_validate(fav)
    item.label, item.category = exists
    return item


@router.delete("/{favorite_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_favorite(
    favorite_id: Annotated[UUID, Path()],
    db: _DB,
    user: _USER,
) -> None:
    fav = db.execute(
        select(Favorite).where(Favorite.id == favorite_id, Favorite.user_id == user.id)
    ).scalar_one_or_none()
    if fav is None:
        raise HTTPException(status_code=404, detail="favorite not found")
    db.delete(fav)
    db.commit()
