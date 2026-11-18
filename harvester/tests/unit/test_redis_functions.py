import logging
import os

from cde_harvester import redisFunctions


def test_reload_top_requests_skips_non_regular_log_files(tmp_path, monkeypatch):
    fifo = tmp_path / "stdout"
    os.mkfifo(fifo)
    linked = tmp_path / "access.log"
    linked.symlink_to(fifo)
    real = tmp_path / "access.log.1"
    real.write_text('1.2.3.4 - - [21/Oct/2026:09:00:00 +0000] "GET /api/datasets HTTP/1.1" 200\n')

    warmed = []
    monkeypatch.setattr(redisFunctions.glob, "glob", lambda _: [str(linked), str(real)])
    monkeypatch.setattr(redisFunctions, "default_view_routes", lambda _: [])
    monkeypatch.setattr(redisFunctions, "get_run_logger", lambda: logging.getLogger())
    monkeypatch.setattr(
        redisFunctions.requests,
        "get",
        lambda url, **_: warmed.append(url) or type("R", (), {"raise_for_status": lambda self: None})(),
    )

    redisFunctions.reloadTopRequests.fn()

    assert warmed == [redisFunctions.CACHE_WARM_URL + "/datasets"]


class _FakeRedis:
    def __init__(self, keys):
        self.keys = set(keys)
        self.unlink_calls = []

    def scan_iter(self, count=None):
        yield from sorted(self.keys)

    def unlink(self, *keys):
        self.unlink_calls.append(keys)
        self.keys.difference_update(keys)
        return len(keys)


def test_clear_redis_cache_keeps_basemap_tiles(monkeypatch):
    fake = _FakeRedis([
        b"/legend?metric=days",
        b"/tiles/2/0/1.mvt?metric=days",
        b"emodnet:tile:4/3/4",
        b"nonna-dem-water:tile:11/668/743",
    ])
    monkeypatch.setattr(redisFunctions, "_redis_client", lambda: fake)
    monkeypatch.setattr(redisFunctions, "get_run_logger", lambda: logging.getLogger())

    redisFunctions.clearRedisCache.fn()

    assert fake.keys == {b"emodnet:tile:4/3/4", b"nonna-dem-water:tile:11/668/743"}


def test_clear_redis_cache_deletes_in_batches(monkeypatch):
    fake = _FakeRedis([f"/datasets?q={i}".encode() for i in range(5)])
    monkeypatch.setattr(redisFunctions, "_redis_client", lambda: fake)
    monkeypatch.setattr(redisFunctions, "get_run_logger", lambda: logging.getLogger())
    monkeypatch.setattr(redisFunctions, "DELETE_BATCH", 2)

    redisFunctions.clearRedisCache.fn()

    assert fake.keys == set()
    assert [len(call) for call in fake.unlink_calls] == [2, 2, 1]


def _warm_with(monkeypatch, get):
    monkeypatch.setattr(redisFunctions.glob, "glob", lambda _: [])
    monkeypatch.setattr(
        redisFunctions,
        "default_view_routes",
        lambda _: ["/api/datasets", *redisFunctions.SLOW_DEFAULT_ROUTES],
    )
    monkeypatch.setattr(redisFunctions, "get_run_logger", lambda: logging.getLogger())
    monkeypatch.setattr(redisFunctions.requests, "get", get)
    redisFunctions.reloadTopRequests.fn()


_OK = type("R", (), {"raise_for_status": lambda self: None})()


def test_slow_default_routes_warm_first_with_a_longer_timeout(monkeypatch):
    calls = []
    _warm_with(monkeypatch, lambda url, timeout, **_: calls.append((url, timeout)) or _OK)

    url = redisFunctions.CACHE_WARM_URL
    slow = redisFunctions.CACHE_WARM_SLOW_TIMEOUT_SECONDS
    assert calls == [
        (f"{url}/legend?metric=days", slow),
        (f"{url}/coverageHistogram?groupBy=source&count=days&view=timeline&", slow),
        (f"{url}/datasets", redisFunctions.CACHE_WARM_TIMEOUT_SECONDS),
    ]


def test_a_timed_out_slow_route_is_not_requested_again(monkeypatch):
    calls = []

    def get(url, timeout, **_):
        calls.append(url)
        if timeout == redisFunctions.CACHE_WARM_SLOW_TIMEOUT_SECONDS:
            raise redisFunctions.requests.ReadTimeout("still computing")
        return _OK

    _warm_with(monkeypatch, get)

    assert len(calls) == 3
