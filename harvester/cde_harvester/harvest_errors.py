CDM_DATA_TYPE_UNSUPPORTED = "CDM_DATA_TYPE_UNSUPPORTED"
HTTP_ERROR = "HTTP_ERROR"
MISSING_REQUIRED_VARS = "MISSING_REQUIRED_VARS"
NO_SUPPORTED_VARIABLES = "NO_SUPPORTED_VARIABLES"
INGEST_FLAG_FALSE = "INGEST_FLAG_FALSE"
DEPTH_AND_ALTITUDE = "DEPTH_AND_ALTITUDE"
UNKNOWN_ERROR = "UNKNOWN_ERROR"
NO_PROFILES_FOUND = "NO_PROFILES_FOUND"
ON_SKIP_LIST = "ON_SKIP_LIST"
RESPONSE_TOO_LARGE = "RESPONSE_TOO_LARGE"
UNCHANGED = "UNCHANGED"

# Why a dataset has no content_hash (stored on cde.datasets.content_hash_reason).
# Distinct from the harvest-status reason codes above: these explain hash *absence*,
# not why a harvest attempt was skipped/errored. A NULL reason means a hash was produced.
HASH_NO_FILE_LIST = "HASH_NO_FILE_LIST"                  # Croissant lists no files (database-backed) — benign
HASH_CROISSANT_HTTP_ERROR = "HASH_CROISSANT_HTTP_ERROR"  # .croissant endpoint returned non-200
HASH_CROISSANT_UNREADABLE = "HASH_CROISSANT_UNREADABLE"  # request/JSON parse failed (timeout, bad JSON)
HASH_FEDERATED_UNRESOLVED = "HASH_FEDERATED_UNRESOLVED"  # federated source not resolved within 3 hops


class ResponseTooLargeError(Exception):
    """An ERDDAP response exceeded MAX_RESPONSE_SIZE. Distinct from a generic
    error so the audit log can show RESPONSE_TOO_LARGE instead of UNKNOWN_ERROR
    (typically high-frequency datasets whose distinct()/enumeration is too big)."""
