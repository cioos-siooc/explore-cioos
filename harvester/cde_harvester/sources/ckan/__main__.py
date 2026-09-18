"""Dump the CKAN catalogue snapshot to CSV, for inspecting it outside a harvest."""

import argparse

from cde_harvester.core.config import ckan_url
from cde_harvester.sources.ckan.create_ckan_erddap_link import fetch_ckan_catalogue

output_file = "ckan_records.csv"


def main(cache, limit=None):
    print(f"Enumerating the CKAN catalogue at {ckan_url()}")

    # .fn bypasses the Prefect task wrapper: this script runs outside any flow.
    df = fetch_ckan_catalogue.fn(cache=cache, limit=limit)
    df.to_csv(output_file, index=False)

    print(f"Wrote {output_file} ({len(df)} rows)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--cache", help="Cache requests, for testing only", action="store_true"
    )
    parser.add_argument(
        "--limit", type=int, default=None, help="stop after this many CKAN records"
    )

    args = parser.parse_args()

    main(args.cache, args.limit)
