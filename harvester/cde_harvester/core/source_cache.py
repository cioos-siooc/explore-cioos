"""Locations for persisted upstream-source caches.

``HARVEST_SOURCE_CACHE_DIR`` lets a deployment mount every upstream cache at
one shared root.  Keeping the source-specific directories separate avoids
collisions between the two diskcache databases and makes a cache-format bump a
simple directory-name change.  With the variable unset, retain the historical
working-directory-relative locations for CLI users.
"""

import os


def source_cache_path(name, legacy_path):
    """Return a source-cache subdirectory, or its backwards-compatible path."""
    root = os.environ.get("HARVEST_SOURCE_CACHE_DIR")
    return os.path.join(root, name) if root else legacy_path
