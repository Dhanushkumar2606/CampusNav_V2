# Seed loader

```
uv run python -m app.seed.csv_loader --data-dir ./seed_data [--reset]
```

- Reads every CSV in `--data-dir` and upserts into the configured DB.
- **Idempotent** — re-running is safe. Pass `--reset` to wipe seeded tables
  first (users are preserved).
- Honors `DATABASE_URL` from `.env`.

## Required CSV headers

See the inline docstring at the top of `csv_loader.py` for the canonical
header list.

## Replacing the placeholder campus

1. Edit or replace the CSVs in `seed_data/`. Keep the headers.
2. Re-run the loader. Done.
