-- Full-text search over each dataset's descriptive text: the `search` filter
-- (web-api/utils/dbFilter.js) matches cde.datasets.search_tsv.
--
-- Owned here rather than in 1_schema.sql because the generated column needs
-- the configs and function below to exist first. Every path applies this file:
-- the fresh-volume entrypoint, db_migrate and Rebuild Database. ADD COLUMN
-- fills existing rows on the spot, so no re-harvest is needed. A change to
-- dataset_search_tsv() is NOT re-applied to stored rows: follow it with a
-- table rewrite (e.g. drop and re-add the column) in the same change.
--
-- Weights are the search scopes (ts_filter): A titles, B keywords/EOVs/
-- platform/organizations/projects, C abstracts, D variables and dataset_id.

CREATE EXTENSION IF NOT EXISTS unaccent;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'english_unaccent') THEN
    CREATE TEXT SEARCH CONFIGURATION public.english_unaccent (COPY = english);
    ALTER TEXT SEARCH CONFIGURATION public.english_unaccent
      ALTER MAPPING FOR hword, hword_part, word WITH unaccent, english_stem;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'french_unaccent') THEN
    CREATE TEXT SEARCH CONFIGURATION public.french_unaccent (COPY = french);
    ALTER TEXT SEARCH CONFIGURATION public.french_unaccent
      ALTER MAPPING FOR hword, hword_part, word WITH unaccent, french_stem;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION dataset_search_tsv(
  title text, title_fr text, metadata jsonb, eovs text[], platform text,
  organizations text[], dataset_id text, table_variables jsonb,
  grid_variables jsonb
) RETURNS tsvector LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT
    setweight(to_tsvector('public.english_unaccent', coalesce(title, '')), 'A')
    || setweight(to_tsvector('public.french_unaccent', coalesce(title_fr, '')), 'A')
    || setweight(to_tsvector('public.english_unaccent', concat_ws(' ',
         (SELECT string_agg(k, ' ') FROM jsonb_array_elements_text(metadata->'keywords'->'en') k),
         -- camelCase EOV ids, so "salinity" finds subSurfaceSalinity
         regexp_replace(array_to_string(eovs, ' '), '([a-z])([A-Z])', '\1 \2', 'g'),
         platform,
         array_to_string(organizations, ' '),
         (SELECT string_agg(p, ' ') FROM jsonb_array_elements_text(
            CASE jsonb_typeof(metadata->'projects') WHEN 'array' THEN metadata->'projects' END) p))), 'B')
    || setweight(to_tsvector('public.french_unaccent',
         coalesce((SELECT string_agg(k, ' ') FROM jsonb_array_elements_text(metadata->'keywords'->'fr') k), '')), 'B')
    || setweight(to_tsvector('public.english_unaccent', coalesce(metadata->'abstract'->>'en', '')), 'C')
    || setweight(to_tsvector('public.french_unaccent', coalesce(metadata->'abstract'->>'fr', '')), 'C')
    || setweight(to_tsvector('simple', concat_ws(' ', dataset_id,
         (SELECT string_agg(concat_ws(' ', v->>'name', v->>'long_name', v->>'standard_name'), ' ')
            FROM jsonb_array_elements(
              CASE jsonb_typeof(table_variables) WHEN 'array' THEN table_variables ELSE '[]' END
              || CASE jsonb_typeof(grid_variables) WHEN 'array' THEN grid_variables ELSE '[]' END) v))), 'D')
$$;

-- Both language configs, so either language's stemming of the terms can hit;
-- the last term is a prefix so a half-typed word still matches.
CREATE OR REPLACE FUNCTION dataset_search_query(q text) RETURNS tsquery
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  english tsquery := websearch_to_tsquery('public.english_unaccent', q);
  french tsquery := websearch_to_tsquery('public.french_unaccent', q);
BEGIN
  IF q ~ '[[:alnum:]]$' THEN
    english := regexp_replace(english::text, '''$', ''':*')::tsquery;
    french := regexp_replace(french::text, '''$', ''':*')::tsquery;
  END IF;
  RETURN english || french;
END $$;

ALTER TABLE cde.datasets ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (dataset_search_tsv(
    title, title_fr, metadata, eovs, platform, organizations, dataset_id,
    table_variables, grid_variables)) STORED;

CREATE INDEX IF NOT EXISTS datasets_search_tsv_gin ON cde.datasets USING gin (search_tsv);
