"""Deprecated shim — use ``python -m cde_harvester.loading`` instead."""

import warnings

from cde_harvester.loading.__main__ import run_cli
from cde_harvester.loading.loader import (  # noqa: F401 — re-exported for old imports
    DATASET_ARRAY_DTYPES,
    DB_LOADER_ADVISORY_LOCK_KEY,
    OBIS_ARRAY_DTYPES,
    ensure_organization_pks,
    load_obis_cells_copy,
    main,
    prepare_obis_cells_dataframe,
    prepare_profiles_dataframe,
)

if __name__ == "__main__":
    warnings.warn(
        "python -m cde_db_loader is deprecated; use python -m cde_harvester.loading",
        DeprecationWarning,
        stacklevel=2,
    )
    run_cli()
