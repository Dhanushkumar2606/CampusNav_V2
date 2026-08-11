"""Auth request/response schemas.

Pydantic v2 throughout. `from_attributes=True` so the same shapes work as
response_model_for_orm and as the input/output schemas for the Phase 3
Claude tool calls.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.user import Role


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=1, max_length=255)


class LoginIn(BaseModel):
    # The /auth/login endpoint accepts application/x-www-form-urlencoded via
    # OAuth2PasswordRequestForm (FastAPI's built-in), so we don't validate
    # the body as JSON here. This schema exists for symmetry / future JSON login.
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int = Field(
        description="Token lifetime in seconds (mirrors JWT_EXPIRES_MINUTES)."
    )


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    full_name: str
    role: Role
    created_at: datetime
    disabled_at: datetime | None = None
