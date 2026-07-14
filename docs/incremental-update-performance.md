# Speed up `process_incremental_update()` — it is not actually incremental, and it takes the site down

## Summary

`process_incremental_update()` (`database/9_incremental_upsert.sql:257`) only ingests incrementally. Its **processing** phase (steps 8–9) is a **full global rebuild of every derived table**, regardless of how few datasets changed.

Three compounding problems follow:

1. **Runtime scales with total DB size, not with the size of the delta.** Harvesting one ERDDAP server (183 datasets) rewrites all 197k points, 244k profiles, and 778k trajectory_cells.
2. **The whole site 504s while it runs.** The load holds `AccessExclusiveLock` on `datasets`, `profiles`, `points`, `hexes_zoom_0`, `hexes_zoom_1` — which blocks even plain `SELECT`s — for the entire multi-minute transaction.
3. **It hammers the DB host.** The repeated whole-table `UPDATE` passes generate large write amplification, WAL, and dead tuples, which then trigger autovacuum storms that compete with the load itself for IO.

## Evidence

Observed during a routine `cioosatlantic-ca` harvest on a dev stack:

- `SELECT process_incremental_update()` ran for **minutes**, pegging the DB container at **114% CPU**.
- Every frontend catalog route (`datasets`, `platforms`, `oceanVariables`, `obisNodes`, `erddapServers`, `legend`) returned **504** for the whole duration. Blocked backends climbed steadily until the API's connection pool was exhausted and it stopped responding at all.
- Table stats show the write-amplification damage — `points` carries **20x more dead tuples than live rows**:

```
     relname      | n_live_tup | n_dead_tup |   sz
------------------+------------+------------+---------
 trajectory_cells |     777858 |          0 | 1081 MB
 profiles         |     244432 |          0 | 2280 MB
 points           |     197210 |    3881458 | 3232 MB   <-- 3.2 GB for 197k rows
 hexes_zoom_1     |      48719 |          0 |   63 MB
```

## Root causes

### 1. The processing functions rebuild everything, unconditionally

`profile_process()` (`database/5_profile_process.sql`) starts with:

```sql
DELETE FROM cde.points;              -- ALL points, not just changed datasets
INSERT INTO cde.points (geom) ...    -- rebuilt from ALL profiles
```

`create_hexes()` (`database/4_create_hexes.sql`) then does a full re-tiling:

```sql
DELETE FROM cde.hexes_zoom_0;
DELETE FROM cde.hexes_zoom_1;
UPDATE cde.points SET hex_zoom_0 = ...  -- spatial join of EVERY point against ST_HexagonGrid
UPDATE cde.points SET hex_zoom_1 = ...  -- again, at the finer zoom
INSERT INTO cde.hexes_zoom_0 (geom) SELECT DISTINCT hex_zoom_0 FROM cde.points;
INSERT INTO cde.hexes_zoom_1 (geom) SELECT DISTINCT hex_zoom_1 FROM cde.points;
UPDATE cde.points SET hex_0_pk = ...    -- every point, again
UPDATE cde.points SET hex_1_pk = ...    -- every point, again
UPDATE cde.profiles SET hex_0_pk, hex_1_pk ...          -- all 244k
UPDATE cde.obis_cells SET hex_0_pk, hex_1_pk ...        -- all
UPDATE cde.trajectory_cells SET point_pk ...            -- all 778k
```

That is roughly six full-table rewrites of `points`, plus full rewrites of `profiles`, `obis_cells`, and `trajectory_cells` — **on every single-server harvest**. This is the dominant cost and the source of the dead-tuple bloat.

### 2. The hex grid is derived from a moving extent, which is *why* a full rebuild seems necessary

`create_hexes()` tiles with:

```sql
ST_HexagonGrid(100000, ST_SetSRID(ST_EstimatedExtent('cde', 'points', 'geom'), 3857))
```

Because the grid's origin/extent derives from the *current estimated extent of `points`*, the tiling **shifts whenever the data extent changes**. That invalidates every previously-assigned hex, which forces the delete-and-recompute-everything approach.

This is the keystone: until the grid is made stable, incremental hex assignment is impossible.

### 3. `drop_constraints()` / `set_constraints()` make the load reader-blocking

Steps 3 and 10 of `process_incremental_update()` call `drop_constraints()` and `set_constraints()`, which issue `ALTER TABLE`. `ALTER TABLE` takes `ACCESS EXCLUSIVE`, and because the whole function runs in one transaction, that lock is **held until COMMIT** — blanketing the entire multi-minute processing phase.

This is what turns a slow background job into a **hard outage**. Ordinary bulk `INSERT`/`UPDATE`/`DELETE` under MVCC would let readers continue; the `ALTER TABLE` is what stops them.

## What needs to be done

In order of payoff:

### A. Pin the hex grid to a fixed origin/extent *(enabler — do this first)*

Replace `ST_EstimatedExtent(...)` with a **constant, hardcoded extent** (e.g. the full Web Mercator world, or a fixed CIOOS-relevant bbox). Once the grid is deterministic, a point's hex is a pure function of its geometry and can be computed **at INSERT time** — no global re-tiling, and hexes stay stable across runs. Everything below depends on this.

### B. Scope processing to the changed datasets only

`profile_process()`, `obis_process()`, `trajectory_process()`, and `create_hexes()` should operate only on rows belonging to datasets present in `temp_datasets`, not the entire table:

- `points`: delete and reinsert only points for changed datasets, instead of `DELETE FROM cde.points`.
- `hex_*_pk`: compute on insert (per A), rather than by full-table `UPDATE` passes.
- `hexes_zoom_*`: reconcile incrementally — insert hexes that are newly occupied, and (optionally, out of band) GC hexes that no longer have any points.

This should collapse runtime from "proportional to the whole database" to "proportional to the delta."

### C. Get `ALTER TABLE` out of the load transaction

The `NOT NULL` constraints on the hex columns are only dropped because hex values aren't known at insert time. Once (A) lets us compute them at insert time, `drop_constraints()`/`set_constraints()` can be **removed entirely** — and with them, the `AccessExclusiveLock` and the outage. Failing that, make those columns permanently nullable and validate in the loader instead.

Even with no other change, this alone converts a full site outage into a merely-slow background job.

### D. Reduce load on the DB host

- The whole-table `UPDATE` passes are the source of the 3.88M dead tuples on `points`; (B) removes most of them at the root.
- Tune autovacuum on `points` / `trajectory_cells` — vacuum currently fights the loader for IO mid-run.
- Consider `maintenance_work_mem` / batching for the remaining bulk operations.

### E. Operational guardrails (cheap, independent of the above)

- Set `lock_timeout` / `statement_timeout` on the loader session so a wedged load can never hold the site hostage indefinitely.
- Add an explicit `pool` config to `web-api/db.js` (currently the knex default, max 10) so a slow DB degrades rather than hard-fails.
- Revisit the nginx proxy timeout.

## Acceptance criteria

- A single-server incremental harvest completes in time proportional to the number of changed datasets, not total DB size.
- **The frontend serves normally throughout an incremental load** — no `AccessExclusiveLock` on `datasets`/`profiles`/`points`/`hexes_*`, no 504s.
- Hex assignments are stable across runs (a point that didn't move keeps its hex pk).
- `points` dead-tuple count stays in the same order of magnitude as its live-tuple count.
- The full-reload path and the incremental path still produce identical derived tables (regression test).

## Notes / risks

- (A) renumbers hex pks once, on the migration run — any cached tiles or persisted hex references need invalidating.
- The full-reload path shares these functions, so changes must keep it correct. The existing advisory-lock serialization (`harvester/cde_harvester/loading/loader.py:37`) stays as-is.
