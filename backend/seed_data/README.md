# Seed data

This directory holds the campus data the seed loader reads. Two campuses are
seeded:

- `srm_ktr.json` — SRM Institute of Science and Technology, Kattankulathur
  (featured; surveyed walkway network from OpenStreetMap).
- `vit_chennai.json` — VIT Chennai (block centroids from Google Places; the
  walkway network is all straight-line **estimates** until surveyed). Places
  connect to `jn_*` corridor junctions — estimated vertices where the
  pedestrian paths plausibly cross — so routes turn at real network joints
  instead of drawing centre-to-centre chords.

Add more campuses as additional `*.json` files (the loader handles a
directory of them) and flag `"featured": true` on the ones the Explore hub
should surface first. Non-campus JSON (e.g. the OSM raw cache written by
`build_network_graph.py`) is skipped.

## Run

```
uv run python -m app.seed.csv_loader --data-dir ./seed_data
# or, equivalently, point at the file directly:
uv run python -m app.seed.csv_loader --data-dir ./seed_data/srm_ktr.json

# wipe seeded tables first (users preserved):
uv run python -m app.seed.csv_loader --data-dir ./seed_data --reset
```

The loader is **idempotent** — re-running upserts.

## Provenance

Per the source dataset:

| Field                  | Source                                                            |
|------------------------|-------------------------------------------------------------------|
| Node names & floors    | SRM official facilities PDF (`webstor.srmist.edu.in`)             |
| Node coordinates       | Google Places (geocoded, verified)                                 |
| Edges                  | Footways traced from OpenStreetMap via Overpass for 14/16 edges; the remaining 2 are straight-line estimates (`estimated: true`) |

The current `srm_ktr.json` carries `data_provenance` that the loader writes
into the `data_provenance` table, and each edge's `estimated` flag is
recorded as `path_edges.is_estimated` so the UI styles surveyed paths
differently from estimates.

If you re-survey or correct any edge, update the JSON's `estimated` field
for that row and re-run the loader with `--reset`.

## Schema mapping (for review)

The seed splits nodes between `Building` and `PathNode` based on
`category`:

| JSON `category`  | Lands on                                  |
|------------------|-------------------------------------------|
| `academic`       | `Building` (G+N floors from name) + `PathNode(kind=entrance)` |
| `library`        | `Building` + `PathNode(kind=entrance)`    |
| `admin`          | `Building` + `PathNode(kind=entrance)`    |
| `campus_center`  | `PathNode(kind=landmark)` (campus main pin) |
| `landmark`       | `PathNode(kind=landmark)`                 |
| `transit`        | `PathNode(kind=transit)`                  |
| `entrance`       | `PathNode(kind=entrance)` (e.g. main gate)|
| `hostel` / `accommodation` | `PathNode(kind=poi)`             |
| `medical` / `recreation` / `sports` / `food` / `parking` / `bank` | `PathNode(kind=poi)` |
| `junction`       | `PathNode(kind=junction)` — walkway network vertex (hidden from the place picker) |

Re-seeding a campus is **authoritative**: the loader upserts everything from
the JSON, then prunes that campus's nodes / buildings / edges that no longer
appear in the file (rename or remove a pin, re-run, and the old one
disappears — other campuses are untouched).

Per-campus JSON may also carry:

- `"featured": true` — surface in the Explore hub first.
- `"center": {"lat": ..., "lng": ...}` — catalog centroid used for the
  map's initial camera view; otherwise computed from node coordinates.
- `"slug": "..."` — explicit slug override (otherwise derived from name).
- `"previously": "old name or slug"` — rename support: the loader matches
  the old campus row and migrates name + slug in place (no duplicate).

Floors and rooms are not seeded — the `floors` and `rooms` tables are empty
for this campus until you add room-level data later.
