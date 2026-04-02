-- Migration: add source_type to datasets table
-- Run this against an existing database that was created before this column was added.

ALTER TABLE cde.datasets
    ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'erddap';
