"""``sentry_sdk.init()`` — one policy, for every service in the Python tree.

There were two inits with three differences between them: the harvester wired up
the stdlib ``LoggingIntegration`` and no tracing, the scheduler wired up
``LoguruIntegration``, ``traces_sample_rate=1.0`` and
``ignore_errors=[KeyboardInterrupt]``. The split was an artifact of which
logging library each side happened to use, not a decision about either, so a
service picked up whichever policy its own file had been copied from.

Both integrations are configured here and each is installed when its logging
library is importable, so the policy is the same wherever it runs. That has to
be explicit: sentry_sdk auto-enables both integrations with their *defaults*
(``event_level=ERROR``), which turns every ERROR log record into its own Sentry
event — an alert per failed dataset per run, grouped by log message so unrelated
servers collapsed together. Failures are reported instead by
:func:`cde_common.issues.report_issues`, grouped by the error the server
actually returned; unhandled exceptions are still captured by Sentry's default
integrations.
"""

import logging
import os

import sentry_sdk
from sentry_sdk.integrations import DidNotEnable
from sentry_sdk.integrations.logging import LoggingIntegration

try:
    from sentry_sdk.integrations.loguru import LoguruIntegration
except (ImportError, DidNotEnable):
    # loguru is not installed in this service. sentry_sdk raises its own
    # DidNotEnable — not ImportError — from the integration module's import, and
    # catching only ImportError meant every harvester container (stdlib logging,
    # no loguru) died on `import cde_common.observability`.
    LoguruIntegration = None

# Same variable, and the same meaning, as web-api/instrument.js and the frontend
# read. These are batch processes rather than a request server, so there is no
# per-request burst to sample away and the default stays at everything.
DEFAULT_TRACES_SAMPLE_RATE = 1.0


def init_sentry():
    """Initialise Sentry from the environment. A missing SENTRY_DSN disables it."""
    integrations = [
        # Log records become breadcrumbs only (``event_level=None``).
        LoggingIntegration(level=logging.INFO, event_level=None),
    ]
    if LoguruIntegration is not None:
        integrations.append(LoguruIntegration(level=logging.INFO, event_level=None))

    sentry_sdk.init(
        dsn=os.environ.get("SENTRY_DSN"),
        integrations=integrations,
        environment=os.environ.get("ENVIRONMENT", "development"),
        traces_sample_rate=float(
            os.environ.get("SENTRY_TRACES_SAMPLE_RATE") or DEFAULT_TRACES_SAMPLE_RATE
        ),
        # Ctrl-C on a long-running harvest or a stopped scheduler container is an
        # operator action, not an incident.
        ignore_errors=[KeyboardInterrupt],
    )
