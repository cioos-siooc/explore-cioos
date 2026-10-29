"""The default-view warm set must match the frontend's URLs byte-for-byte:
apicache keys on the exact URL, so a near miss warms nothing."""

from datetime import date

from cde_harvester.redisFunctions import default_view_routes


def _hex_tiles(z):
    routes = default_view_routes(date(2026, 10, 20))
    return [r for r in routes if r.startswith(f"/api/tiles/{z}/")]


def test_default_view_tiles_cover_the_world_to_z3():
    assert [len(_hex_tiles(z)) for z in range(4)] == [1, 4, 16, 64]
    assert "/api/tiles/2/1/0.mvt?metric=days" in _hex_tiles(2)


def test_z4_to_z6_tiles_cover_north_america_only():
    z6 = _hex_tiles(6)
    # Halifax, Vancouver and Cambridge Bay; Europe stays out.
    assert "/api/tiles/6/20/23.mvt?metric=days" in z6
    assert "/api/tiles/6/10/21.mvt?metric=days" in z6
    assert "/api/tiles/6/13/14.mvt?metric=days" in z6
    assert "/api/tiles/6/32/21.mvt?metric=days" not in z6
    assert len(_hex_tiles(4)) < len(_hex_tiles(5)) < len(z6) < 4**6 / 4


def test_track_tiles_use_the_frontend_trailing_window():
    # tracksTimeWindow(today, 90) serialised by URLSearchParams.
    routes = default_view_routes(date(2026, 10, 20))
    assert (
        "/api/tiles/tracks/0/0/0.mvt?"
        "timeMin=2026-07-22T00%3A00%3A00Z&timeMax=2026-10-21T00%3A00%3A00Z"
    ) in routes


def test_coverage_histogram_keeps_the_trailing_ampersand():
    assert (
        "/api/coverageHistogram?groupBy=source&count=days&view=timeline&"
        in default_view_routes(date(2026, 10, 20))
    )
