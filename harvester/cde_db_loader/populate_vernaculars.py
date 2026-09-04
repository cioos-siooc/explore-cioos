"""Deprecated shim — use ``python -m cde_harvester.loading.populate_vernaculars``."""

import sys
import warnings

from cde_harvester.loading.populate_vernaculars import (  # noqa: F401 — re-exported
    logger,
    main,
)

if __name__ == "__main__":
    warnings.warn(
        "python -m cde_db_loader.populate_vernaculars is deprecated; "
        "use python -m cde_harvester.loading.populate_vernaculars",
        DeprecationWarning,
        stacklevel=2,
    )
    try:
        main()
    except KeyboardInterrupt:
        logger.info("Interrupted")
        sys.exit(130)
    except Exception:
        logger.exception("populate_vernaculars failed")
        sys.exit(1)
