"""One Sentry policy, whichever logging library the service happens to use."""

import logging
from unittest.mock import patch

import pytest

from cde_common import observability


@pytest.fixture
def init_kwargs(monkeypatch):
    """The kwargs init_sentry() passes to sentry_sdk.init()."""
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    monkeypatch.delenv("SENTRY_TRACES_SAMPLE_RATE", raising=False)
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    with patch("cde_common.observability.sentry_sdk.init") as init:
        yield lambda: (observability.init_sentry(), init.call_args.kwargs)[1]


def _event_level(integration):
    """Where the integration turns a log record into a Sentry event, or None.

    The two integrations expose the same setting differently: the stdlib one
    keeps a per-instance event handler (absent when disabled), loguru's stores
    the level on the class.
    """
    if hasattr(integration, "_handler"):
        return None if integration._handler is None else integration._handler.level
    return type(integration).event_level


def _breadcrumb_level(integration):
    """Where the integration starts recording breadcrumbs. See _event_level."""
    if hasattr(integration, "_breadcrumb_handler"):
        return integration._breadcrumb_handler.level
    return type(integration).level


def test_log_records_never_become_events(init_kwargs):
    """The whole point of configuring the integrations explicitly: sentry_sdk
    auto-enables them at event_level=ERROR, which meant an alert per failed
    dataset per run. Failures are reported grouped by cde_common.issues instead.
    """
    integrations = init_kwargs()["integrations"]
    assert integrations
    for integration in integrations:
        assert _event_level(integration) is None


def test_both_logging_stacks_are_configured_when_available(init_kwargs):
    """The harvester logs with stdlib and the scheduler with loguru; the policy
    must not depend on which file the init was copied from."""
    names = {type(i).__name__ for i in init_kwargs()["integrations"]}
    assert "LoggingIntegration" in names
    if observability.LoguruIntegration is not None:
        assert "LoguruIntegration" in names


def test_a_service_without_loguru_still_initialises(init_kwargs, monkeypatch):
    """The harvester installs no loguru, and sentry_sdk signals that by raising
    its own DidNotEnable rather than ImportError — catching only ImportError
    killed every harvester container at import."""
    monkeypatch.setattr(observability, "LoguruIntegration", None)
    names = {type(i).__name__ for i in init_kwargs()["integrations"]}
    assert names == {"LoggingIntegration"}


def test_breadcrumbs_start_at_info(init_kwargs):
    for integration in init_kwargs()["integrations"]:
        assert _breadcrumb_level(integration) == logging.INFO


def test_operator_interrupts_are_not_incidents(init_kwargs):
    assert KeyboardInterrupt in init_kwargs()["ignore_errors"]


def test_environment_defaults_to_development(init_kwargs):
    assert init_kwargs()["environment"] == "development"


def test_trace_sample_rate_is_overridable(init_kwargs, monkeypatch):
    assert init_kwargs()["traces_sample_rate"] == observability.DEFAULT_TRACES_SAMPLE_RATE
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")
    assert init_kwargs()["traces_sample_rate"] == 0.1
