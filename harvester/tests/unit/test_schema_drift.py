"""Guardrail: the Pandera CSV contract must stay a subset of database/1_schema.sql.

The harvester->db-loader column contract lives in cde_harvester/core/schemas.py
and must be mirrored by the DDL (see database/README.md for the change
procedure). This test parses the CREATE TABLE statements out of 1_schema.sql
and fails when a Pandera schema declares a column the DDL doesn't have —
catching the "updated the schema, forgot the SQL" drift before it reaches a
deploy. The reverse (DDL columns absent from the Pandera schemas) is fine:
several DB columns are filled by stored procedures, not the CSVs.
"""

import re
from pathlib import Path

import pytest

from cde_harvester.core.schemas import (
    DatasetSchema,
    HarvestAttemptSchema,
    HarvestRunSchema,
    ObisCellSchema,
    ProfileSchema,
    SkippedDatasetSchema,
)

SCHEMA_SQL = Path(__file__).resolve().parents[3] / "database" / "1_schema.sql"

# Pandera schema -> cde table its CSV loads into.
SCHEMA_TO_TABLE = {
    ProfileSchema: "profiles",
    ObisCellSchema: "obis_cells",
    DatasetSchema: "datasets",
    SkippedDatasetSchema: "skipped_datasets",
    HarvestRunSchema: "harvest_runs",
    HarvestAttemptSchema: "harvest_attempts",
}


def _ddl_columns():
    """{table: {column, ...}} parsed from the CREATE TABLE statements."""
    sql = SCHEMA_SQL.read_text()
    tables = {}
    # Terminator: the first line whose first non-blank character is the
    # closing paren (some tables in 1_schema.sql indent it).
    pattern = re.compile(
        r"CREATE TABLE (?:IF NOT EXISTS )?(?:cde\.)?(\w+)\s*\((.*?)\n[ \t]*\)", re.S
    )
    for name, body in pattern.findall(sql):
        cols = set()
        depth = 0
        for line in body.splitlines():
            line = line.strip()
            in_continuation = depth > 0
            depth += line.count("(") - line.count(")")
            if in_continuation or not line or line.startswith("--"):
                continue
            first = line.split()[0].strip('",')
            if first.upper() in ("PRIMARY", "UNIQUE", "CONSTRAINT", "FOREIGN", "CHECK"):
                continue
            cols.add(first.lower())
        tables[name] = cols
    return tables


@pytest.mark.parametrize(
    "schema,table", SCHEMA_TO_TABLE.items(), ids=[t for t in SCHEMA_TO_TABLE.values()]
)
def test_schema_columns_exist_in_ddl(schema, table):
    ddl = _ddl_columns()
    assert table in ddl, f"CREATE TABLE {table} not found in {SCHEMA_SQL}"
    missing = set(schema.to_schema().columns) - ddl[table]
    assert not missing, (
        f"{schema.__name__} declares columns missing from cde.{table} in "
        f"1_schema.sql: {sorted(missing)} — see database/README.md for the "
        "schema-change procedure"
    )
