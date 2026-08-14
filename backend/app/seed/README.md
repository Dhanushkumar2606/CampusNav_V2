# Seed loader

```
uv run python -m app.seed.csv_loader --data-dir ./seed_data [--reset]
```

- Reads **every `*.json` file** in `--data-dir` and upserts each into the
  configured DB — one campus per file, multi-campus directories supported.
  Point `--data-dir` at a single file to load just one campus.
- **Idempotent** — re-running is safe. Pass `--reset` to wipe seeded tables
  first (users are preserved).
- Honors `DATABASE_URL` from `.env`.

## Payload format

Each JSON file describes one campus:

```json
{
  "campus": "My Campus",
  "featured": true,
  "center": { "lat": 12.8232, "lng": 80.0442 },
  "data_provenance": { "dataset_name": "...", "source": "...", "notes": "..." },
  "nodes": [{ "id": "...", "label": "...", "lat": 12.8, "lng": 80.0, "category": "academic" }],
  "edges": [{ "from": "...", "to": "...", "distance_m": 100, "estimated": false, "geometry": [[lng, lat], ...] }]
}
```

- `featured` (optional, default `false`) pins the campus in the Explore hub.
- `slug` (optional) overrides the slug derived from the name — useful when
  renaming a campus to a short display name without breaking deep links.
- `previously` (optional) names the old campus name/slug. Together with
  `slug` it supports renames: re-running a renamed file updates the existing
  campus row (name + slug, and the `data_provenance` row) instead of seeding
  a duplicate.
- `center` (optional) is the catalog centroid used by
  `GET /navigation/campuses/near`. When absent, the loader computes it as the
  mean of the node coordinates.
- `edges[].geometry` is the real walkway shape as `[lng, lat]` pairs
  (OSM-traced); omit it for a straight-line edge. `estimated: false` means
  the edge is surveyed, not a straight-line guess.
- Nodes with `"category": "junction"` become network vertices (kind
  `junction`) that routes can turn at but that stay hidden from the place
  picker — used to wire estimated pedestrian corridors.

See the inline docstring at the top of `csv_loader.py` for the canonical
field list.
