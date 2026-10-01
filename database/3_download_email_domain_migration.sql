-- Add download_jobs.email_domain to databases created before it existed (the
-- canonical DDL is in 1_schema.sql, which only runs on a fresh volume).
--
-- The address itself is cleared 7 days after a job finishes (the download
-- scheduler's forget_expired_emails); the domain outlives it so download usage
-- can still be counted by institution. The backfill covers jobs whose address
-- has not been cleared yet. Idempotent.
ALTER TABLE cde.download_jobs ADD COLUMN IF NOT EXISTS email_domain text;

UPDATE cde.download_jobs
SET email_domain = lower(split_part(email, '@', 2))
WHERE email_domain IS NULL AND email IS NOT NULL;
