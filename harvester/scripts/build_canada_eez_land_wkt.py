"""Regenerate harvester/cde_harvester/data/canada_eez_land.wkt from Marine Regions.

Run by hand when the polygon needs refreshing (rarely). Output is committed
to git; the harvester loads the static file at run time and never calls
Marine Regions itself.

Usage:
    cd harvester
    uv run python scripts/build_canada_eez_land_wkt.py
"""
import json
import sys
from pathlib import Path

import requests
from shapely import wkt as shp_wkt
from shapely.geometry import shape
from shapely.ops import unary_union

WFS_URL = "https://geo.vliz.be/geoserver/MarineRegions/wfs"
TYPENAME = "MarineRegions:eez_land"
CQL_FILTER = "iso_sov1='CAN' OR iso_sov2='CAN' OR iso_sov3='CAN'"

OUTPUT_PATH = Path(__file__).resolve().parents[1] / "cde_harvester" / "data" / "canada_eez_land.wkt"

SIMPLIFY_TOLERANCE_DEG = 0.05  # ~5 km near the equator, ~3 km at 50°N

# Sanity-check anchor points (lon, lat) that must lie inside the final polygon.
INSIDE_ANCHORS = {
    "Halifax, NS":         (-63.57, 44.65),
    "Tofino, BC":          (-125.91, 49.15),
    "Iqaluit, NU":         (-68.52, 63.75),
    "Hudson Bay (mid)":    (-85.00, 60.00),
    "Halifax shelf (sea)": (-62.00, 43.50),
    "Beaufort Sea (sea)":  (-135.00, 71.00),
    "Lake Ontario (CAN)":  (-77.50, 43.85),
}
OUTSIDE_ANCHORS = {
    "Boston, MA":          (-71.06, 42.36),
    "Sydney, AU":          (151.21, -33.87),
    "Reykjavik, IS":       (-21.94, 64.15),
}


def fetch_features():
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeName": TYPENAME,
        "CQL_FILTER": CQL_FILTER,
        "outputFormat": "application/json",
    }
    print(f"Fetching {TYPENAME} for Canada from Marine Regions...")
    r = requests.get(WFS_URL, params=params, timeout=120)
    r.raise_for_status()
    data = r.json()
    features = data.get("features", [])
    print(f"  Got {len(features)} features:")
    for f in features:
        props = f.get("properties", {})
        print(f"    - {props.get('union')} (mrgid_eez={props.get('mrgid_eez')}, area_km2={props.get('area_km2')})")
    if not features:
        sys.exit("No Canadian features returned from Marine Regions.")
    return features


def build_polygon(features):
    geoms = [shape(f["geometry"]) for f in features]
    print(f"Unioning {len(geoms)} geometries...")
    merged = unary_union(geoms)
    print(f"  Pre-simplify vertex count: {count_vertices(merged)}")
    simplified = merged.simplify(SIMPLIFY_TOLERANCE_DEG, preserve_topology=True)
    print(f"  Post-simplify vertex count: {count_vertices(simplified)}")
    return simplified


def count_vertices(geom):
    if geom.geom_type == "Polygon":
        return len(geom.exterior.coords) + sum(len(r.coords) for r in geom.interiors)
    if geom.geom_type == "MultiPolygon":
        return sum(count_vertices(g) for g in geom.geoms)
    return 0


def validate(polygon, wkt_str):
    print("Validating polygon...")
    bounds = polygon.bounds
    print(f"  bounds: {bounds}")
    if not (-141 <= bounds[0] <= -50 and 41 <= bounds[1] <= 50 and
            -50 <= bounds[2] <= -49.9 + 1 and 70 <= bounds[3] <= 84):
        # Loose check; main goal is "looks like Canada"
        if not (bounds[0] < -100 and bounds[2] > -60 and bounds[3] > 60):
            sys.exit(f"  FAIL: bounds don't look like Canada: {bounds}")

    # Approximate area using equirectangular at 60°N. Just a sanity floor.
    # Marine Regions reports ~15.7M km²; we expect something in that ballpark
    # after simplification (could shrink or grow slightly).
    area_deg2 = polygon.area
    print(f"  area (deg²): {area_deg2:.2f}")
    if area_deg2 < 200:  # Canada should be ~600+ deg² in lat-lon space
        sys.exit(f"  FAIL: simplified area too small ({area_deg2} deg²)")

    # Round-trip
    parsed = shp_wkt.loads(wkt_str)
    if not parsed.is_valid:
        sys.exit("  FAIL: round-tripped polygon is not valid")
    if parsed.geom_type not in ("Polygon", "MultiPolygon"):
        sys.exit(f"  FAIL: unexpected geom type {parsed.geom_type}")

    # Anchor checks
    from shapely.geometry import Point
    failures = []
    for name, (lon, lat) in INSIDE_ANCHORS.items():
        if not parsed.contains(Point(lon, lat)):
            failures.append(f"  {name} ({lon}, {lat}) should be INSIDE but isn't")
    for name, (lon, lat) in OUTSIDE_ANCHORS.items():
        if parsed.contains(Point(lon, lat)):
            failures.append(f"  {name} ({lon}, {lat}) should be OUTSIDE but isn't")
    if failures:
        sys.exit("  FAIL: anchor-point checks:\n" + "\n".join(failures))
    print(f"  All {len(INSIDE_ANCHORS)} inside anchors and {len(OUTSIDE_ANCHORS)} outside anchors pass.")

    n_bytes = len(wkt_str.encode())
    print(f"  WKT byte length: {n_bytes}")
    if n_bytes > 200_000:
        sys.exit(f"  FAIL: WKT too large ({n_bytes} bytes)")


def main():
    features = fetch_features()
    polygon = build_polygon(features)
    wkt_str = polygon.wkt
    validate(polygon, wkt_str)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(wkt_str + "\n")
    print(f"\nWrote {OUTPUT_PATH} ({len(wkt_str)} chars)")


if __name__ == "__main__":
    main()
