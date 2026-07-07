"""Per-feature location classification for the tabledap profile pipeline.

Each profile/timeseries feature has a lat/lon bounding box (min/max on each
axis). The box itself is what the DB stores and spatial search matches against;
from it we derive a single representative *point* for map display and a flag
deciding whether the feature is drawn as an individual dot:

- exact point (min == max on both axes) -> that point, shown as a dot
- small box (diagonal <= POINT_THRESHOLD_M) -> box midpoint, shown as a dot
- larger box -> box midpoint (still searchable via the stored bbox, still
  aggregates into the zoomed-out hexes) but NOT drawn as an individual dot
  (show_as_point=False).
"""

import math

# Box diagonal at or below this (metres) is represented by its midpoint as a
# single map dot. Above it the feature spans a region and isn't drawn as a dot.
POINT_THRESHOLD_M = 1000

_EARTH_RADIUS_M = 6_371_000


def _haversine_m(lat1, lon1, lat2, lon2):
    """Great-circle distance in metres between two points given in degrees."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    )
    return 2 * _EARTH_RADIUS_M * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _wrap_lon(lon):
    """Wrap a longitude into [-180, 180)."""
    return ((lon + 180) % 360) - 180


def classify_profile_location(lat_min, lat_max, lon_min, lon_max):
    """Return (latitude, longitude, show_as_point) for one feature's bbox.

    Any null coordinate yields (nan, nan, False) so the caller drops the row.
    Handles antimeridian-crossing boxes (raw longitude span > 180 deg), where
    orderByMinMax reports e.g. lon_min ~ -179, lon_max ~ +179 for a narrow box.
    """
    values = [lat_min, lat_max, lon_min, lon_max]
    # v != v is True only for NaN; also catch None.
    if any(v is None or v != v for v in values):
        return (float("nan"), float("nan"), False)

    lat_min, lat_max = float(lat_min), float(lat_max)
    lon_min, lon_max = float(lon_min), float(lon_max)

    if lat_min == lat_max and lon_min == lon_max:
        return (lat_min, lon_min, True)

    # Antimeridian: a narrow box straddling +/-180 shows as a near-360 span.
    # Shift the western (negative) edge up by 360 so midpoint and diagonal are
    # measured the short way around.
    if lon_max - lon_min > 180:
        eff_lon_a, eff_lon_b = lon_max, lon_min + 360
    else:
        eff_lon_a, eff_lon_b = lon_min, lon_max

    mid_lat = (lat_min + lat_max) / 2
    mid_lon = _wrap_lon((eff_lon_a + eff_lon_b) / 2)

    diagonal_m = _haversine_m(lat_min, eff_lon_a, lat_max, eff_lon_b)
    return (mid_lat, mid_lon, diagonal_m <= POINT_THRESHOLD_M)
