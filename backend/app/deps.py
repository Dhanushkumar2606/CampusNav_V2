"""FastAPI dependencies — currently the authenticated user resolver."""

from __future__ import annotations

from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.user import User
from app.security import decode_token

# Used by FastAPI's OAuth2 password flow. The tokenUrl is the login endpoint.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=True)


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    """Resolve the JWT to a User row, or 401."""
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_token(token)
    except ValueError:
        raise credentials_exc

    sub = payload.get("sub")
    if not isinstance(sub, str):
        raise credentials_exc

    try:
        user_id = UUID(sub)
    except (ValueError, TypeError):
        raise credentials_exc

    user = db.get(User, user_id)
    if user is None or user.disabled_at is not None:
        raise credentials_exc
    return user
