"""Application configuration loaded from the environment."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Settings loaded from environment variables / .env.

    Defaults are intentionally dev-friendly; production should set every field.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_env: str = Field(default="development", alias="APP_ENV")
    app_version: str = Field(default="0.1.0", alias="APP_VERSION")

    database_url: str = Field(default="sqlite:///./campusnav.db", alias="DATABASE_URL")

    jwt_secret: str = Field(default="change-me-please-not-for-production", alias="JWT_SECRET")
    jwt_algorithm: str = Field(default="HS256", alias="JWT_ALGORITHM")
    jwt_expires_minutes: int = Field(default=60, alias="JWT_EXPIRES_MINUTES")

    cors_origins: str = Field(
        default="http://localhost:5173,http://127.0.0.1:5173",
        alias="CORS_ORIGINS",
    )

    @field_validator("cors_origins")
    @classmethod
    def _strip_cors(cls, v: str) -> str:
        return v.strip()

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    return Settings()
