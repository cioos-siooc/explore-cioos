"""Representative map point for a feature's bbox. The bbox stays what the DB
searches on; boxes wider than POINT_THRESHOLD_M still aggregate into hexes but
aren't drawn as individual dots."""

import math

# bbox diagonal, metres
POINT_THRESHOLD_M = 1000

_EARTH_RADIUS_M = 6_371_000


def _haversine_m(lat1, lon1, lat2, lon2):
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    )
    return 2 * _EARTH_RADIUS_M * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _wrap_lon(lon):
    return ((lon + 180) % 360) - 180


def classify_profile_location(lat_min, lat_max, lon_min, lon_max):
    """Return (latitude, longitude, show_as_point); any null coordinate yields
    (nan, nan, False) so the caller drops the row."""
    values = [lat_min, lat_max, lon_min, lon_max]
    if any(v is None or v != v for v in values):
        return (float("nan"), float("nan"), False)

    lat_min, lat_max = float(lat_min), float(lat_max)
    lon_min, lon_max = float(lon_min), float(lon_max)

    if lat_min == lat_max and lon_min == lon_max:
        return (lat_min, lon_min, True)

    # orderByMinMax reports a narrow box straddling +/-180 as a near-360 span;
    # shift the western edge so midpoint and diagonal go the short way around.
    if lon_max - lon_min > 180:
        eff_lon_a, eff_lon_b = lon_max, lon_min + 360
    else:
        eff_lon_a, eff_lon_b = lon_min, lon_max

    mid_lat = (lat_min + lat_max) / 2
    mid_lon = _wrap_lon((eff_lon_a + eff_lon_b) / 2)

    diagonal_m = _haversine_m(lat_min, eff_lon_a, lat_max, eff_lon_b)
    return (mid_lat, mid_lon, diagonal_m <= POINT_THRESHOLD_M)
