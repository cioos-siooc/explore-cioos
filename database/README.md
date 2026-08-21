# CDE database (PostgreSQL + PostGIS, schema `cde`)

Plain numbered SQL files, applied in filename order by the postgis image's
initdb on a **fresh volume** (see `Dockerfile`). Live databases are never
re-initialized: the one-shot `db_migrate` compose service re-applies only the
numbered function files (`3_*.sql`–`9_*.sql`, all pure `CREATE OR REPLACE`) on
each deploy, so stored-procedure changes ship without a rebuild. **Table/schema
changes are not migrated** — `1_schema.sql` runs only on a fresh volume, so a
schema change means dropping the volume and re-harvesting.

## Changing the schema — the two touchpoints

A change to a table the pipeline writes must be made in two places, kept in
sync by hand:

1. **`1_schema.sql`** — the canonical DDL and the only place table schema is
   defined. It runs only on a fresh volume, so **a table change requires
   dropping the DB volume and re-harvesting** — there are no incremental table
   migrations.
2. **`harvester/cde_harvester/core/schemas.py`** — the Python side of the
   contract: the Pandera schemas describing the harvester's CSV output and
   the array-dtype maps the db-loader uses to write PostgreSQL arrays.

If the change touches stored procedures, update the matching numbered file
(`5_profile_process.sql`, `9_incremental_upsert.sql`, ...); `db_migrate`
re-applies these on every deploy, so live DBs pick them up without a volume
reset.

Adding a **nullable** column is the one case that need not cost a volume reset:
put the canonical definition in `1_schema.sql` *and* an idempotent
`ALTER TABLE cde.datasets ADD COLUMN IF NOT EXISTS ...` at the top of
`9_incremental_upsert.sql` (see the "Schema top-up" block there), so `db_migrate`
adds it to live DBs at deploy. That is metadata-only and takes only a brief
lock at deploy time — never do DDL inside a load. Anything that rewrites the
table (`NOT NULL`, defaults, type changes, dropped columns) still means
dropping the volume and re-harvesting.

`harvester/tests/unit/test_schema_drift.py` cross-checks the Pandera schemas
against `1_schema.sql` and fails when a schema column is missing from the DDL.

## File map

| File | Contents |
|---|---|
| `1_schema.sql` | All tables, indexes, materialized views |
| `3_ckan_process.sql` | `ckan_process()` — organization denormalization |
| `4_create_hexes.sql` | `hex_cell()` + `create_hexes()` — origin-anchored hex binning (100 km + 10 km), append-only cells keyed on (i, j); `trajectory_gap_secs()` / `trajectory_segments()` / `trajectory_build_hexes()` — trajectory coverage swept from the track through that grid |
| `5_profile_process.sql` | `profile_process()`, `obis_*()`, `trajectory_*()` post-load processing; `gc_orphan_points_and_hexes()` |
| `6_remove_all_data.sql` | `remove_all_data()` — full-reload TRUNCATE |
| `7_contraints.sql` | `drop_constraints()` / `set_constraints()` |
| `7_/8_range_functions.sql` | `range_intersection_length()` (download estimates); `day_union_days()` (the map's distinct-day ramp) |
| `9_incremental_upsert.sql` | temp tables + `process_incremental_update()` |
