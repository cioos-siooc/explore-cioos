-- Make download_jobs.job_id unique on databases created before it was (the
-- canonical DDL is in 1_schema.sql, which only runs on a fresh volume). The
-- job ID names the job's zip, so two jobs sharing one would share a file.
--
-- Job IDs used to be 6 hex characters and could collide. Each colliding job but
-- the newest gets its pk appended: the shared zip was the newest job's, and the
-- older ones expired after 7 days anyway. Idempotent; the index name matches
-- the one the UNIQUE column in 1_schema.sql creates.
UPDATE cde.download_jobs j
SET job_id = j.job_id || '-' || j.pk
WHERE EXISTS (
    SELECT 1 FROM cde.download_jobs newer
    WHERE newer.job_id = j.job_id AND newer.pk > j.pk
);

CREATE UNIQUE INDEX IF NOT EXISTS download_jobs_job_id_key ON cde.download_jobs (job_id);
