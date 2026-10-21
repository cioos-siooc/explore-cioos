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
        lambda url, timeout: warmed.append(url) or type("R", (), {"raise_for_status": lambda self: None})(),
    )

    redisFunctions.reloadTopRequests.fn()

    assert warmed == [redisFunctions.CACHE_WARM_BASE_URL + "/api/datasets"]
