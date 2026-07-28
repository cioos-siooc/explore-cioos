"""Shared building blocks for the CDE pipeline.

Everything both the harvest side (``sources``) and the load side (``loading``)
need: the CSV/DataFrame contract (``schemas``), DB connection handling (``db``),
Sentry/logging setup (``observability``), harvest reason codes (``errors``) and
config-file parsing (``config``).
"""
