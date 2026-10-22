"""The default-view warm set must match the frontend's URLs byte-for-byte:
apicache keys on the exact URL, so a near miss warms nothing."""

from datetime import date

from cde_harvester.redisFunctions import default_view_routes


def test_default_view_tiles_cover_the_world_to_z3():
    routes = default_view_routes(date(2026, 10, 20))
    hexes = [r for r in routes if r.startswith("/api/tiles/") and "tracks" not in r]
    assert len(hexes) == 1 + 4 + 16 + 64
    assert "/api/tiles/2/1/0.mvt?metric=days" in hexes


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
