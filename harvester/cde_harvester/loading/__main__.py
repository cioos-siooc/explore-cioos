"""CLI entry point: python -m cde_harvester.loading --folder harvest [--incremental]"""

import argparse
import os
import sys

from cde_harvester.loading.loader import logger, main


def run_cli(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--folder",
        required=False,
        default="harvest",
        help="folder with the CSV output files from harvesting",
    )
    parser.add_argument(
        "--incremental",
        action="store_true",
        help="Use UPSERT instead of deleting all data - only update/insert changed datasets",
        default=os.environ.get("INCREMENTAL_MODE", "false").lower() == "true",
    )

    args = parser.parse_args(argv)
    try:
        main(args.folder, args.incremental)
    except Exception:
        logger.error("Failed to write to db", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    run_cli()
