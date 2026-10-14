"""Non-fatal, per-dataset harvest warnings recorded in harvest_attempts.warnings.

Each warning is ``{code, message, count?, items?}`` so the harvest dashboard can
label it and summarize a server's datasets by code. Documented in
docs/harvesting/workflow.md.
"""

import json

FEATURES_HIDDEN = "FEATURES_HIDDEN"
FEATURES_DROPPED = "FEATURES_DROPPED"
OCCURRENCES_DROPPED = "OCCURRENCES_DROPPED"
NON_CF_STANDARD_NAMES = "NON_CF_STANDARD_NAMES"
UNKNOWN_PLATFORM_VOCABULARY = "UNKNOWN_PLATFORM_VOCABULARY"
DAY_COUNT_FALLBACK = "DAY_COUNT_FALLBACK"
RECORD_COUNT_ESTIMATED = "RECORD_COUNT_ESTIMATED"
DEPTH_RANGE_UNAVAILABLE = "DEPTH_RANGE_UNAVAILABLE"
PROFILE_COUNT_UNAVAILABLE = "PROFILE_COUNT_UNAVAILABLE"
TRACKS_UNAVAILABLE = "TRACKS_UNAVAILABLE"
TRAJECTORY_DATA_INCOMPLETE = "TRAJECTORY_DATA_INCOMPLETE"

MAX_ITEMS = 20


class HarvestWarnings:
    def __init__(self, logger):
        self.logger = logger
        self._by_code = {}

    def add(self, code, message, items=None, count=None):
        """Log ``message`` and record it; a repeated code merges into one entry."""
        # Pre-formatted: the logger may be loguru, which drops %-style args.
        self.logger.warning(message)
        entry = self._by_code.setdefault(code, {"code": code, "message": message})
        if message not in entry["message"]:
            entry["message"] += "; " + message
        if count is not None:
            entry["count"] = entry.get("count", 0) + int(count)
        if items:
            merged = entry.get("items", [])
            merged += [str(i) for i in items if str(i) not in merged]
            entry["items"] = merged[:MAX_ITEMS]

    def __bool__(self):
        return bool(self._by_code)

    def __iter__(self):
        return iter(self._by_code.values())

    def codes(self):
        return list(self._by_code)

    def to_json(self):
        return json.dumps(list(self._by_code.values())) if self._by_code else None
