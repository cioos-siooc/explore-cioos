"""Dry-run OBIS dataset discovery: resolve the list, print it, diff it. No harvest.

Run this before flipping a config to discovery, and again whenever the boundary
polygon or the node list changes — it is the check that answers "what would this
actually harvest, and what would it stop harvesting?"

Usage:
    cd harvester
    uv run python scripts/discover_obis_datasets.py -f ../harvest_config.yaml
    uv run python scripts/discover_obis_datasets.py -f ../harvest_config.yaml \
        --compare ../Obis_Datasets.json --cells ../harvest/obis_cells.csv
    uv run python scripts/discover_obis_datasets.py -f ../harvest_config.yaml --json
"""
import argparse
import collections
import csv
import json
import logging
import sys
from pathlib import Path

from cde_harvester.core.config import load_config, resolve_obis_config
from cde_harvester.sources.obis.discovery import (
    ObisDatasetDiscovery,
    ObisDiscoveryConfig,
    ObisDiscoveryError,
    simplify_for_query,
)
from cde_harvester.sources.obis.geo_filter import ObisGeoFilter, load_boundary_polygon


def count_vertices(geom):
    if geom.geom_type == "Polygon":
        return len(geom.exterior.coords) + sum(len(r.coords) for r in geom.interiors)
    if geom.geom_type == "MultiPolygon":
        return sum(count_vertices(g) for g in geom.geoms)
    return 0


def report_geometry(cfg, geo_filter):
    """Print what the reduced discovery geometry looks like."""
    if not cfg.wants_geometry:
        print("Geometry query: disabled (geometry: none)")
        return
    if cfg.geometry.lower() != "eez":
        print(f"Geometry query: inline WKT ({len(cfg.geometry.encode())} bytes)")
        return

    polygon = geo_filter.polygon or load_boundary_polygon(geo_filter.polygon_file)
    wkt, tol = simplify_for_query(
        polygon,
        tolerance=cfg.geometry_simplify_tolerance,
        max_bytes=cfg.geometry_max_bytes,
    )
    reduced = __import__("shapely.wkt", fromlist=["loads"]).loads(wkt)
    print("Geometry query: packaged boundary polygon, reduced for the query string")
    print(f"  original:  {len(polygon.wkt.encode()):>7,} bytes  {count_vertices(polygon):>6,} vertices")
    print(f"  reduced:   {len(wkt.encode()):>7,} bytes  {count_vertices(reduced):>6,} vertices"
          f"   (tolerance {tol}, budget {cfg.geometry_max_bytes:,})")
    print(f"  contains original: {reduced.contains(polygon)}"
          "   <- must be True, or the query could clip coastal datasets")


def load_comparison_ids(path):
    """Dataset ids from a JSON list file or a datasets.csv."""
    p = Path(path)
    if p.suffix == ".json":
        return set(json.loads(p.read_text()).get("datasets", []))
    with p.open() as f:
        return {row["dataset_id"] for row in csv.DictReader(f) if row.get("dataset_id")}


def load_cell_counts(path):
    """{dataset_id: n_cells} from an obis_cells.csv, i.e. what actually produced data."""
    counts = collections.Counter()
    with Path(path).open() as f:
        for row in csv.DictReader(f):
            counts[row["dataset_id"]] += 1
    return counts


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-f", "--file", required=True, help="harvest config YAML")
    parser.add_argument("--compare", default=None,
                        help="JSON list or datasets.csv to diff the result against")
    parser.add_argument("--cells", default=None,
                        help="obis_cells.csv from a previous harvest, to report how many "
                             "datasets that actually produced data would be dropped")
    parser.add_argument("--json", action="store_true",
                        help="print the resolved id list as JSON (suitable for "
                             "obis_datasets_file) instead of a report")
    args = parser.parse_args()

    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")

    config = load_config(args.file)
    if config is None:
        sys.exit(f"Could not parse {args.file}")

    obis = resolve_obis_config(config)
    if obis.mode != "discovery":
        sys.exit(
            f"Config {args.file} resolves to OBIS mode {obis.mode!r}, not 'discovery'. "
            "Enable obis_discovery (and clear obis_dataset_ids) to dry-run it."
        )

    cfg = ObisDiscoveryConfig.from_config(obis.discovery)
    geo_filter = ObisGeoFilter.from_config(obis.geo_filter)

    if not args.json:
        print(f"Config: {args.file}")
        print(f"Nodes:  {list(cfg.node_ids) or '(none)'}")
        print(f"Areas:  {list(cfg.area_ids) or '(none)'}")
        print(f"Floor:  min_datasets = {cfg.min_datasets}")
        print()
        report_geometry(cfg, geo_filter)
        print()

    try:
        result = ObisDatasetDiscovery(cfg, geo_filter=geo_filter).discover()
    except ObisDiscoveryError as e:
        sys.exit(f"FAIL: {e}")

    if args.json:
        print(json.dumps({"datasets": result.dataset_ids}, indent=2))
        return

    print("Per-query results:")
    for label, count in result.per_query.items():
        print(f"  {label:<50} {count:>6,}")
    print(f"  {'TOTAL (deduped)':<50} {len(result.dataset_ids):>6,}")
    print(f"\nmin_datasets floor: PASS ({len(result.dataset_ids):,} >= {cfg.min_datasets:,})")

    if args.compare:
        current = load_comparison_ids(args.compare)
        discovered = set(result.dataset_ids)
        added, removed = discovered - current, current - discovered
        print(f"\nDiff vs {args.compare} ({len(current):,} ids):")
        print(f"  + {len(added):,} added")
        print(f"  - {len(removed):,} removed")
        for label, ids in (("added", added), ("removed", removed)):
            for did in sorted(ids)[:20]:
                print(f"    {label[0]} {did}")
            if len(ids) > 20:
                print(f"    ... and {len(ids) - 20:,} more {label}")

        if args.cells:
            counts = load_cell_counts(args.cells)
            productive = set(counts)
            lost = removed & productive
            print(f"\nAgainst {args.cells}:")
            print(f"  datasets that produced cells:        {len(productive):,}")
            print(f"  ... still covered by discovery:      {len(productive & discovered):,}")
            print(f"  ... DROPPED (real data lost):        {len(lost):,}"
                  f"  ({sum(counts[d] for d in lost):,} of {sum(counts.values()):,} cells)")
            for did in sorted(lost, key=lambda d: -counts[d])[:20]:
                print(f"      {did}  {counts[did]:,} cells")


if __name__ == "__main__":
    main()
