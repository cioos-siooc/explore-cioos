# Trajectory coverage: swept from the track, counted in days

How Trajectory / TrajectoryProfile datasets (gliders, drifters, ships underway)
reach the map, and why the previous design was replaced in 2026-08.

## The problem with the old design

Coverage used to be `cde.trajectory_cells`: one row per (trajectory,
1/12-degree lat/lon bin), produced by asking ERDDAP to group positions onto that
grid (`orderByMinMax`/`orderByCount` with `latitude/0.08333333,longitude/…`).
Each bin was stored as a single **centre point**, and `create_hexes()` lit the
one hex containing it.

Three defects followed from that, all of them structural:

**1. Gaps at high latitude.** The hex grid lives in EPSG:3857, where a
10 km-edge hexagon has a fixed 17.3 km row pitch, while 1/12° of *latitude* is
9.28 km / cos(lat) in those same metres. The two are equal at ~57°N; north of it
the sample pitch exceeds the hex row pitch and whole rows along a track are
never sampled. On screen that is horizontal striping through every Arctic track
(the longitude direction never gapped: 9.28 km < the 15 km column pitch at every
latitude). Latitude-independent version of the same defect: a ship reporting
hourly at 20 kn moves ~37 km between records and skips bins outright.

**2. `days` was a span, not a count.** Per cell it was
`time_max - time_min + 1`, and `hexMetric.js` summed it over the ~23 cells in a
hex. A ship crossing the same place each January contributed the eleven months
between visits, every time. One hex in the live catalogue read **18,992 days**.

**3. `n_records` was silently ~zero.** For an interval group, ERDDAP's
`orderByCount` returns the **bucket index** in the grouped column, not the
bucket's value — `latitude/0.08333333` comes back as `531.0`, not `44.25`
(verified live, ERDDAP 2.x; `orderByMin`/`orderByMax` are unaffected and do
return real values). The old code read those indices as coordinates, merged on
them, matched nothing, and fell back to the 2-row min/max count. Every
`trajectory_cells.n_records` in production sat between 1 and 7, so the map's
`records` metric never meant anything for trajectories.

## The current design

Two tables, one harvested and one derived.

### `cde.trajectory_days` — harvested attributes

One row per (trajectory, UTC day): `n_records`, `n_profiles`, `depth_min`,
`depth_max`. **No geometry** — where the platform was that day is not this
table's job. Produced by `extract_day_stats()`
(`harvester/cde_harvester/dataset_types/trajectory_features.py`) from two
server-side reductions:

- `orderByCount("<traj>,time/86400")` — records per trajectory-day. The grouped
  column is decoded by `_bucket_index_to_day()`, which handles both the bucket
  index above and a real timestamp (they differ by five orders of magnitude, so
  the magnitude decides).
- `orderByMinMax("<traj>,time/86400,depth")` — depth range per trajectory-day.

`n_profiles` (TrajectoryProfile only) is counted per day from the per-profile
fixes `extract_track_points()` already downloads — one cached request serves
both, so the old per-cell profile query is gone with no replacement. Servers
without interval grouping fall back to the monthly chunked raw download and
reduce by day locally.

Response sizes shrank by orders of magnitude: `mpoSgdoTsg` used to answer the
per-cell queries with ~624k rows; per trajectory-day it is roughly 16k.

### `cde.trajectory_hexes` — derived geometry

One row per (dataset, trajectory, `hex_tier`, `hex_pk`), built by
`trajectory_build_hexes(p_dataset_pks)` in `database/4_create_hexes.sql`:

1. **Segments** from `cde.trajectory_points` (`trajectory_segments()`), dropping
   the ones whose path is unknown — the same three break conditions
   `/tiles/tracks` uses for the drawn lines: antimeridian, a gap beyond the
   trajectory's cadence, and a >50 km chord under 96 h. The threshold itself is
   one SQL function, `trajectory_gap_secs()`, called by both the route and the
   sweep: a chord the map refuses to draw must not light hexes either.
2. **Hex crossings** via `ST_HexagonGrid(<size>, segment)` + `ST_Intersects`,
   with entry/exit times interpolated from the fraction of the segment inside
   each hexagon (a hexagon is convex, so the intersection is a single
   LineString). Zero-length segments — a vessel holding position — keep their
   whole interval in one hex; every retained fix also contributes an
   instantaneous occupancy, so single-fix trajectories and the far side of a
   dropped segment are not lost.
3. **Days**: each occupancy interval is split at UTC midnight, so
   `days = count(distinct day)` per hex — a real count, whatever the gaps
   between visits.
4. **Attributes**: joined from `cde.trajectory_days` by day and apportioned
   across the hexes visited that day by time spent in each. Per-dataset record
   totals are preserved to within integer rounding (~0.001% on a 24M-record
   catalogue).

Both hex tiers (0 = 100 km, 1 = 10 km) are aggregated **independently**, which
is why the tier is a column instead of the two `hex_0_pk`/`hex_1_pk` columns the
other tables carry: summing the 10 km rows into a 100 km hex would count a day
once per 10 km hex the platform crossed that day. Consumers therefore select
`hex_pk as zoom_pk` with `WHERE hex_tier = <0|1>`; the non-tile consumers
(`shapeQuery`, `timeExtent`, `download`) read tier 1 only and use the hex
polygon as `search_geom`, so a drawn polygon smaller than a hex still selects
what the track left inside it.

Because coverage is swept from the track, `cde.trajectory_points` is now the
resolution-determining table — `MAX_TRACK_POINTS_CAP` is a coverage parameter,
not just a line-smoothness one. Trajectories no longer insert into `cde.points`
at all, which removes ~660k rows and one large post-load UPDATE from every load.

## Load paths

- **Full reload** (`loading/loader.py`): `trajectory_link_dataset_pk`, then
  `trajectory_points_link_dataset_pk` → `trajectory_refresh_track_stats` →
  `trajectory_build_hexes` (NULL = whole corpus). Order matters: the sweep reads
  each trajectory's gap threshold from `trajectory_track_stats` and joins
  `trajectory_days` for the attributes.
- **Incremental** (`process_incremental_update()`): the same steps, with
  `trajectory_build_hexes(<pks of datasets whose days or points changed>)`, and
  skipped entirely when no trajectory data changed. Pure DML — no `ALTER`,
  `TRUNCATE` or `DROP INDEX` — so it runs against a live web-api without
  deadlocking readers.

Measured on the dev catalogue (251k track points, 21 datasets): 110 s for the
whole corpus across both tiers, ~9 s for a single dataset.

## Effect

| | before | after |
|---|---|---|
| hexes lit at 10 km | 28,298 | 39,636 |
| max `days` in one hex | 18,992 | 2,107 |
| rows | 659,465 cells | 515,646 (tier 1) + 49,160 (tier 0) |
| hexes lit at 45°N / 70°N / 85°N | — | +10% / +45% / +113% |

The latitude profile of the gain is the striping being filled in, which is the
diagnosis confirming itself.

## Known trade-offs

- Per-hex `n_records` is apportioned, not exact per bin. Dataset totals are
  exact. (The alternative was the old exact-per-bin count, which never actually
  worked — see defect 3.)
- Coverage inherits the track's decimation: a hex the true track clipped by less
  than the 0.5 km Douglas-Peucker tolerance may not light. Measured against the
  old cell-derived footprint for `amundsen12715`, every hex that stopped
  lighting (3,694 of 23,797) sits 1.4–21 km from the nearest real fix, 94% of
  them within one hex width — they were artifacts of snapping a position up to
  ~6.5 km to its bin centre, not coverage.
- Segments crossing the antimeridian are dropped, as they already were for the
  drawn lines: in EPSG:3857 such a segment would otherwise sweep a band of hexes
  across the whole world.
- A schema change, so it needs a volume reset and a re-harvest
  (`database/README.md`); `cde.trajectory_days` is empty until trajectory
  datasets are harvested again, and until then the derived rows carry correct
  geometry and days with NULL records/depth.
