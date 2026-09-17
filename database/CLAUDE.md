# database/

(SQL) — numbered SQL in schema `cde`; `1_schema.sql` (DDL) applies only on a fresh volume (no table migrations); `3_*.sql`–`9_*.sql` (functions) re-apply every deploy via `db_migrate`; map/trajectory coverage is append-only hex cells (`4_create_hexes.sql`), not stored geometry.
