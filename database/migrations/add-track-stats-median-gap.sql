-- Add per-trajectory median inter-fix gap to the track summary.
--
-- The /tiles/tracks gap-splitting rule needs the trajectory's TYPICAL
-- reporting cadence. The lifetime mean (span / n_points) conflates sailing
-- and idle time: a DFO monitoring vessel that sails a few days per year at
-- ~48min cadence averages out to a "cadence" of days-to-weeks, so
-- between-cruise gaps sat under the split threshold and rendered as long
-- connector chords stacking along the shipping corridor (seen live on
-- mpoSgdoTsg: 27 in-window "tracks" averaging ~2,600km each). The MEDIAN
-- gap is the sailing cadence, so idle periods split correctly, while a
-- genuinely slow reporter (Argo, median ~10 days) keeps its high threshold.
--
-- Value is populated by trajectory_refresh_track_stats() (5_profile_process
-- .sql), which rebuilds this table on every load; NULL until the first
-- post-migration load and handled by COALESCE in the tile query.
ALTER TABLE cde.trajectory_track_stats
  ADD COLUMN IF NOT EXISTS median_gap_secs double precision;
