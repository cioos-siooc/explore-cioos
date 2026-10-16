-- Convert cde.harvest_attempts.warnings from free text to a jsonb list of
-- {code, message, count?, items?}. Applied by db_migrate on every deploy, so it
-- only acts while the column is still text. Every pre-existing text warning
-- came from one producer: features hidden from the map.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'cde'
          AND table_name = 'harvest_attempts'
          AND column_name = 'warnings'
          AND data_type = 'text'
    ) THEN
        ALTER TABLE cde.harvest_attempts
            ALTER COLUMN warnings TYPE jsonb
            USING CASE
                WHEN warnings IS NULL OR warnings = '' THEN NULL
                ELSE jsonb_build_array(jsonb_build_object(
                    'code', 'FEATURES_HIDDEN', 'message', warnings
                ))
            END;
    END IF;
END $$;
