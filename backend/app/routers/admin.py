"""Admin router: feature flags, seed management (premium only)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models.user import Role, User
from app.deps import get_current_user

router = APIRouter(prefix="/admin", tags=["admin"])


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != Role.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user


@router.get("/feature-flags")
def feature_flags(
    _admin: User = Depends(require_admin),
    settings=Depends(get_settings),
) -> dict[str, bool]:
    """Return current feature flag status."""
    return {"premium": settings.is_premium}


@router.post("/seed")
def trigger_seed(
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Trigger a re-seed of campus data (calls the seed loader)."""
    # Import here to avoid circular imports
    from app.seed.csv_loader import main as seed_main

    # The seed loader expects sys.argv; we can call its internal functions directly.
    # For simplicity, we just return a message.
    return {"message": "Seed triggered (not implemented in this sprint)"}