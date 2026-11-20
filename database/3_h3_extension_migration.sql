-- H3 (equal-area hex grid) for databases created before 1_schema.sql
-- installed it. Must sort before 4_create_hexes.sql: its SQL-language
-- functions are validated against h3's at creation. Keep in step with
-- 1_schema.sql.
CREATE EXTENSION IF NOT EXISTS h3 WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS h3_postgis WITH SCHEMA public CASCADE;
