# Seed data

This directory holds the campus data the seed loader reads. Right now there is
one file: `srm_ktr.json` — SRM Institute of Science and Technology, Kattankulathur.

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

This dataset is **partially estimated**. The seed payload includes a
`data_provenance` block that the loader writes into the `data_provenance`
table. Every edge carries an `estimated: true` flag (recorded as
`path_edges.is_estimated`) so Phase 2 can style estimated routes
differently from surveyed ones.

Per the source dataset:

| Field                  | Source                                                            |
|------------------------|-------------------------------------------------------------------|
| Node names & floors    | SRM official facilities PDF (`webstor.srmist.edu.in`)             |
| Node coordinates       | Google Places (geocoded, verified)                                 |
| Edges                  | **ESTIMATED** — straight-line distances, not surveyed footpaths   |

The edge topology (which buildings connect to which) is a reasonable guess
based on relative position, **not ground-truth pathway data**.

If you re-survey or correct any edge, update the JSON's `estimated` field
for that row and re-run the loader with `--reset`.

## Schema mapping (for review)

The seed splits nodes between `Building` and `PathNode` based on
`category`:

| JSON `category`  | Lands on                                  |
|------------------|-------------------------------------------|
| `academic`       | `Building` (G+N floors from name) + `PathNode(kind=entrance)` |
| `library`        | `Building` + `PathNode(kind=entrance)`    |
| `landmark`       | `PathNode(kind=landmark)`                 |
| `transit`        | `PathNode(kind=transit)`                  |
| `entrance`       | `PathNode(kind=entrance)` (e.g. main_gate)|
| `hostel`         | `PathNode(kind=poi)`                      |

Floors and rooms are not seeded — the `floors` and `rooms` tables are empty
for this campus until you add room-level data later.
