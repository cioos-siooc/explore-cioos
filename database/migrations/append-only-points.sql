-- Append-only points: give cde.points its natural key (geom) so point pks are
-- stable across loads.
--
-- Background: profile_process() used to DELETE FROM cde.points and reinsert
-- every distinct geometry with new serial pks on every load — which forced
-- full-table relinks of profiles, obis_cells and trajectory_cells (the
-- largest tables in the DB) on every single harvest, however small. With
-- UNIQUE (geom) as the identity, the rewritten processing functions
-- (5_profile_process.sql / 4_create_hexes.sql, re-applied after migrations on
-- every deploy) insert only unseen geometries, never delete or renumber, and
-- scope every relink to rows with a NULL link. Orphaned points/hex cells are
-- collected out of band by gc_orphan_points_and_hexes() (db-loader,
-- post-commit).
--
-- Existing rows need no backfill: current point pks and links are valid and
-- simply stop being churned. The only structural change is the unique index.
--
-- Idempotent: the dedup pass only runs if duplicate geoms exist (the old
-- rebuild inserted DISTINCT geometries, so none are expected — this is
-- defense so the unique index below can never fail a deploy), and the index
-- creation is IF NOT EXISTS. Wrapped in one transaction.

BEGIN;

-- 1. Defensive dedup: repoint referrers of duplicate-geom rows to the lowest
-- pk, then drop the duplicates. No-op when there are none.
DO $$
DECLARE
  n bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM cde.points GROUP BY geom HAVING count(*) > 1) THEN
    CREATE TEMP TABLE _dup_points ON COMMIT DROP AS
    SELECT p.pk, k.keeper
    FROM cde.points p
    JOIN (
      SELECT geom, min(pk) AS keeper
      FROM cde.points GROUP BY geom HAVING count(*) > 1
    ) k ON k.geom = p.geom AND p.pk <> k.keeper;

    UPDATE cde.profiles t SET point_pk = d.keeper
      FROM _dup_points d WHERE t.point_pk = d.pk;
    UPDATE cde.obis_cells t SET point_pk = d.keeper
      FROM _dup_points d WHERE t.point_pk = d.pk;
    UPDATE cde.trajectory_cells t SET point_pk = d.keeper
      FROM _dup_points d WHERE t.point_pk = d.pk;

    DELETE FROM cde.points p USING _dup_points d WHERE p.pk = d.pk;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'append-only-points: removed % duplicate point row(s)', n;
  END IF;
END $$;

-- 2. Identity of a point; the arbiter for the loaders' ON CONFLICT (geom).
CREATE UNIQUE INDEX IF NOT EXISTS points_geom_key ON cde.points (geom);

COMMIT;
