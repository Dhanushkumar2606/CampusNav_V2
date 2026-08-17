"""Production database bootstrap — run once at container start.

Order: ensure PostGIS extension -> apply Alembic migrations -> seed the
campuses. All steps are idempotent (the seed loader upserts), so re-running
them on every boot is safe for existing deployments — nothing is wiped.

Usage (from backend/, with DATABASE_URL set):

    uv run python -m scripts.prod_bootstrap

Exits non-zero on any failure so a broken boot fails loudly in the platform
logs instead of starting a half-initialized API.
"""

from __future__ import annotations

import os
import subprocess
import sys


def _postgres_url() -> str | None:
    url = os.environ.get("DATABASE_URL", "")
    if url.startswith("postgresql") or url.startswith("postgres+"):
        return url
    return None


def ensure_postgis(url: str) -> None:
    """CREATE EXTENSION IF NOT EXISTS postgis — required by migration 0001's
    geography(Point,4326) columns. Non-destructive; no-op when already present."""
    import sqlalchemy as sa

    engine = sa.create_engine(url)
    try:
        with engine.connect() as conn:
            conn.execute(sa.text("CREATE EXTENSION IF NOT EXISTS postgis"))
            conn.commit()
        print("prod_bootstrap: postgis ensured")
    finally:
        engine.dispose()


def run(cmd: list[str]) -> None:
    print(f"prod_bootstrap: running {cmd[0]} ...")
    subprocess.run(cmd, check=True)


def main() -> int:
    url = _postgres_url()
    if url:
        ensure_postgis(url)
    else:
        print("prod_bootstrap: non-Postgres DATABASE_URL — skipping postgis")

    run([sys.executable, "-m", "alembic", "upgrade", "head"])
    run(
        [
            sys.executable,
            "-m",
            "app.seed.csv_loader",
            "--data-dir",
            os.path.join(os.getcwd(), "seed_data"),
        ]
    )
    print("prod_bootstrap: done — database migrated and seeded")
    return 0


if __name__ == "__main__":
    sys.exit(main())