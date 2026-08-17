"""Alembic env — wires SQLAlchemy metadata and respects DATABASE_URL."""

from __future__ import annotations

import os
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

# Make `app.*` importable when alembic is invoked from backend/.
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from app.config import get_settings  # noqa: E402
from app.db import Base  # noqa: E402

# Pull metadata from the app's Base — same models as the runtime app.
target_metadata = Base.metadata

config = context.config

# If alembic.ini's sqlalchemy.url is empty, fall back to the env DATABASE_URL.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def _resolve_url() -> str:
    return get_settings().sqlalchemy_database_url


config.set_main_option("sqlalchemy.url", _resolve_url())


def run_migrations_offline() -> None:
    context.configure(
        url=_resolve_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,  # SQLite needs batch mode for column changes
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    cfg_section = config.get_section(config.config_ini_section, {})
    cfg_section["sqlalchemy.url"] = _resolve_url()
    connectable = engine_from_config(cfg_section, prefix="sqlalchemy.", poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()