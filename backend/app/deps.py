"""FastAPI dependencies — currently the authenticated user resolver.

`AUTH_DEBUG=1` enables one-line failure diagnostics (header presence,
decodability, expiry, user state) for troubleshooting auth chains. The JWT
itself is NEVER logged — only booleans and the (token-free) jose error text.
"""

from __future__ import annotations

import logging
import os
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.user import User
from app.security import decode_token

# Used by FastAPI's OAuth2 password flow. The tokenUrl is the login endpoint.
# auto_error=False keeps the header-check inside get_current_user so failure
# diagnostics can run; the resulting 401 behavior is identical.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)

_auth_logger = logging.getLogger("app.auth")


def _auth_debug(message: str) -> None:
    if os.environ.get("AUTH_DEBUG") == "1":
        _auth_logger.warning("AUTH DEBUG: %s", message)


def get_current_user(
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    """Resolve the JWT to a User row, or 401."""
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        _auth_debug("authorization header present: false")
        raise credentials_exc
    _auth_debug("authorization header present: true")

    try:
        payload = decode_token(token)
    except ValueError as exc:
        _auth_debug(f"token format valid: false (reason: {exc})")
        raise credentials_exc

    _auth_debug("token format valid: true, token decoded: true")

    sub = payload.get("sub")
    if not isinstance(sub, str):
        _auth_debug("user id present: false (malformed sub)")
        raise credentials_exc
    _auth_debug("user id present: true")

    try:
        user_id = UUID(sub)
    except (ValueError, TypeError):
        _auth_debug("user id present: false (sub is not a UUID)")
        raise credentials_exc

    user = db.get(User, user_id)
    if user is None or user.disabled_at is not None:
        _auth_debug(
            "user id present: true; token expired: false; "
            f"user found: {user is not None}; user disabled: {user is not None and user.disabled_at is not None}"
        )
        raise credentials_exc
    _auth_debug(f"user found: true; token expired: false; role: {user.role.value}")
    return user