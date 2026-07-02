# CDE database (PostgreSQL + PostGIS, schema `cde`)

Plain numbered SQL files, applied in filename order by the postgis image's
initdb on a **fresh volume** (see `Dockerfile`). Live databases are never
re-initialized — they are patched by the one-shot `db_migrate` compose
service, which applies every file in `migrations/` on each deploy.

## Changing the schema — the three touchpoints

A change to a table the pipeline writes must be made in three places, kept in
sync by hand:

1. **`1_schema.sql`** — the canonical DDL, used only for fresh installs.
2. **`migrations/*.sql`** — an *idempotent* patch (guarded `ALTER TABLE ... IF
   NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, ...) so existing deployments
   converge to the same state. Every migration runs on every deploy, so it
   must be safe to re-run.
3. **`harvester/cde_harvester/core/schemas.py`** — the Python side of the
   contract: the Pandera schemas describing the harvester's CSV output and
   the array-dtype maps the db-loader uses to write PostgreSQL arrays.

If the change touches stored procedures, update the matching numbered file
(`5_profile_process.sql`, `9_incremental_upsert.sql`, ...) *and* add a
migration that `CREATE OR REPLACE`s the function — initdb files are not
re-applied to live databases.

`harvester/tests/unit/test_schema_drift.py` cross-checks the Pandera schemas
against `1_schema.sql` and fails when a schema column is missing from the DDL.

## File map

| File | Contents |
|---|---|
| `1_schema.sql` | All tables, indexes, materialized views |
| `3_ckan_process.sql` | `ckan_process()` — organization denormalization |
| `4_create_hexes.sql` | `create_hexes()` — PostGIS hex-grid binning (100 km + 10 km) |
| `5_profile_process.sql` | `profile_process()`, `obis_*()` post-load processing |
| `6_remove_all_data.sql` | `remove_all_data()` — full-reload TRUNCATE |
| `7_contraints.sql` | `drop_constraints()` / `set_constraints()` |
| `7_/8_range_functions.sql` | `range_intersection_length()` (download estimates) |
| `9_incremental_upsert.sql` | temp tables + `process_incremental_update()` |
| `migrations/` | idempotent patches for live databases |
