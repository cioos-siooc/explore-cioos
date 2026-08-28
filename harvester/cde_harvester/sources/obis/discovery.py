"""Dataset discovery for the OBIS harvester.

Answers "which OBIS datasets should we harvest?" by querying the OBIS dataset
API instead of reading a static list of UUIDs. The default selection is the
union of:

  * every dataset contributed via the OBIS Canada node
  * every dataset contributed via the OTN-OBIS node
  * every dataset with occurrences inside the Canadian EEZ + land boundary

The OBIS ``geometry`` filter is record-level exact — a dataset is returned only
if it has occurrences inside the polygon, not merely an overlapping extent — so
this is a much tighter selection than a bounding-box list.

Two API quirks drive the implementation:

  * ``/v3/dataset`` **ignores the ``from`` offset param**, so there is no
    pagination. ``size`` large enough to cover ``total`` returns everything in
    one response; we assert ``total == len(results)`` and fail loudly rather
    than silently truncating.
  * ``geometry`` WKT over roughly 6 KB in the query string returns HTTP 400,
    and the packaged boundary polygon is ~11 KB. ``simplify_for_query`` reduces
    it to fit while guaranteeing the result still *contains* the original, so
    the query can only over-select — never clip a coastal dataset out.

Discovery is all-or-nothing: if any single query fails, the whole thing raises.
A partial union (say, the two node queries without the geometry query) would
look like a legitimate but much smaller dataset list, and the db-loader's
``prune_stale_datasets`` would then delete hundreds of real datasets.
"""
import logging
from dataclasses import dataclass, field

import requests
from requests.adapters import HTTPAdapter
from shapely import wkt as shp_wkt
from urllib3.util.retry import Retry

from cde_harvester.sources.obis.geo_filter import (
    DEFAULT_EXEMPT_NODE_IDS,
    load_boundary_polygon,
)

logger = logging.getLogger(__name__)

API_URL = "https://api.obis.org/v3/dataset"

# Transient statuses worth retrying.
_RETRY_STATUSES = (408, 429, 500, 502, 503, 504, 520, 522, 524)

# Hard ceiling on the `size` param used by the retry-once path.
_MAX_PAGE_SIZE = 20000

_VALID_KEYS = {
    "enabled",
    "nodes",
    "geometry",
    "areas",
    "include",
    "exclude",
    "min_datasets",
    "page_size",
    "geometry_max_bytes",
    "geometry_simplify_tolerance",
    "timeout",
}


class ObisDiscoveryError(RuntimeError):
    """Discovery could not produce a trustworthy dataset list."""


def _as_tuple(value, key):
    """Coerce a YAML scalar/list into a tuple of stripped strings."""
    if value is None:
        return ()
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, (list, tuple)):
        raise ValueError(f"obis_discovery.{key} must be a string or a list, got {type(value).__name__}")
    return tuple(str(v).strip() for v in value if str(v).strip())


@dataclass(frozen=True)
class ObisDiscoveryConfig:
    """Declarative discovery spec, parsed from the ``obis_discovery`` config block."""

    enabled: bool = False
    node_ids: tuple = ()
    geometry: str = "eez"          # "eez" | "none" | inline WKT
    area_ids: tuple = ()
    include: tuple = ()
    exclude: tuple = ()
    min_datasets: int = 700
    page_size: int = 3000
    geometry_max_bytes: int = 4500
    geometry_simplify_tolerance: float = 0.25
    timeout: int = 120

    @classmethod
    def from_config(cls, raw=None):
        if not raw:
            return cls(enabled=False)
        if not isinstance(raw, dict):
            raise ValueError(f"obis_discovery must be a mapping, got {type(raw).__name__}")

        unknown = set(raw) - _VALID_KEYS
        if unknown:
            # A typo'd `min_dataset` silently defaulting to 700 is exactly the
            # kind of thing that later prunes the database.
            raise ValueError(
                f"Unknown obis_discovery key(s): {sorted(unknown)}. "
                f"Valid keys: {sorted(_VALID_KEYS)}"
            )

        geometry = raw.get("geometry", "eez")
        geometry = "none" if geometry is None else str(geometry).strip()

        cfg = cls(
            enabled=bool(raw.get("enabled", True)),
            node_ids=_as_tuple(raw.get("nodes"), "nodes"),
            geometry=geometry,
            area_ids=_as_tuple(raw.get("areas"), "areas"),
            include=_as_tuple(raw.get("include"), "include"),
            exclude=_as_tuple(raw.get("exclude"), "exclude"),
            min_datasets=int(raw.get("min_datasets", 700)),
            page_size=int(raw.get("page_size", 3000)),
            geometry_max_bytes=int(raw.get("geometry_max_bytes", 4500)),
            geometry_simplify_tolerance=float(raw.get("geometry_simplify_tolerance", 0.25)),
            timeout=int(raw.get("timeout", 120)),
        )

        if cfg.enabled and not cfg.has_any_query:
            raise ValueError(
                "obis_discovery.enabled is true but nothing would be queried: set at "
                "least one of nodes, geometry (eez or WKT), areas, or include."
            )
        return cfg

    @property
    def wants_geometry(self) -> bool:
        return self.geometry.lower() not in ("", "none")

    @property
    def has_any_query(self) -> bool:
        return bool(self.node_ids or self.area_ids or self.include) or self.wants_geometry


@dataclass
class DiscoveryResult:
    dataset_ids: list = field(default_factory=list)   # sorted, deduped
    per_query: dict = field(default_factory=dict)     # {"node:7dfb...": 305, "geometry": 868}
    geometry_bytes: int = None
    geometry_tolerance: float = None


def _build_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=4,
        backoff_factor=1.0,         # 0s, 2s, 4s, 8s between attempts
        status_forcelist=_RETRY_STATUSES,
        allowed_methods=frozenset(["GET"]),
        raise_on_status=False,      # let raise_for_status() give a clean error
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


def simplify_for_query(polygon, tolerance=0.25, max_bytes=4500, max_attempts=6):
    """Reduce ``polygon`` to a WKT string that fits OBIS's query-string limit.

    Simplifies, then buffers *outward* by the same tolerance so the result is a
    strict superset of the input — the query can only over-select, and the
    full-resolution polygon still does the real filtering downstream. The mitre
    join with ``quad_segs=1`` keeps the buffer from re-inflating the vertex
    count, and a final light simplify cleans up the seams.

    Returns ``(wkt, tolerance_used)``. Raises ObisDiscoveryError if no tolerance
    in the escalation gets under ``max_bytes``.
    """
    if polygon is None or polygon.is_empty:
        raise ObisDiscoveryError("Cannot build a discovery geometry from an empty polygon")

    tol = tolerance
    for _ in range(max_attempts):
        reduced = (
            polygon.simplify(tol, preserve_topology=True)
            .buffer(tol, join_style="mitre", quad_segs=1)
            .buffer(0)
        )
        reduced = reduced.simplify(tol / 4, preserve_topology=True).buffer(0)
        wkt = reduced.wkt
        n_bytes = len(wkt.encode())
        if n_bytes <= max_bytes:
            if not reduced.contains(polygon):
                # Buffering outward should make this impossible; if it ever
                # happens the query would silently miss coastal datasets.
                raise ObisDiscoveryError(
                    f"Reduced discovery geometry (tolerance {tol}) does not contain the "
                    "original polygon; refusing to use it"
                )
            return wkt, tol
        tol *= 2

    raise ObisDiscoveryError(
        f"Could not reduce the boundary polygon below {max_bytes} bytes "
        f"(best effort {n_bytes} bytes at tolerance {tol / 2}). Raise "
        "obis_discovery.geometry_max_bytes or geometry_simplify_tolerance."
    )


class ObisDatasetDiscovery:
    """Resolves the set of OBIS dataset IDs to harvest."""

    def __init__(self, config, geo_filter=None, logger=None, session=None):
        self.config = config
        self.geo_filter = geo_filter
        self.logger = logger or globals()["logger"]
        self.session = session or _build_session()

    # -- geometry ---------------------------------------------------------

    def _query_geometry(self):
        """(wkt, tolerance) for the geometry query, or (None, None) when disabled."""
        cfg = self.config
        if not cfg.wants_geometry:
            return None, None

        if cfg.geometry.lower() != "eez":
            # Inline WKT: use verbatim, but still refuse an over-long string
            # rather than letting OBIS answer 400 mid-harvest.
            wkt = cfg.geometry
            n_bytes = len(wkt.encode())
            if n_bytes > cfg.geometry_max_bytes:
                raise ObisDiscoveryError(
                    f"obis_discovery.geometry is {n_bytes} bytes, over the "
                    f"{cfg.geometry_max_bytes} byte limit for the OBIS query string"
                )
            try:
                shp_wkt.loads(wkt)
            except Exception as e:
                raise ObisDiscoveryError(f"obis_discovery.geometry is not valid WKT: {e}") from e
            return wkt, None

        # "eez": reuse the polygon the geo filter already loaded when it can.
        # Under mode="none" the filter holds no polygon, so load it directly —
        # disabling occurrence clipping must not disable discovery.
        polygon = getattr(self.geo_filter, "polygon", None)
        if polygon is None:
            polygon_file = getattr(self.geo_filter, "polygon_file", None)
            polygon = load_boundary_polygon(polygon_file)

        return simplify_for_query(
            polygon,
            tolerance=cfg.geometry_simplify_tolerance,
            max_bytes=cfg.geometry_max_bytes,
        )

    # -- querying ---------------------------------------------------------

    def _query(self, label, params, allow_empty=False):
        """One /v3/dataset query -> list of dataset ids. Raises on anything suspect."""
        cfg = self.config
        request_params = dict(params, size=cfg.page_size)

        def fetch(p):
            response = self.session.get(API_URL, params=p, timeout=cfg.timeout)
            response.raise_for_status()
            payload = response.json()
            return payload.get("total", 0), (payload.get("results") or [])

        try:
            total, results = fetch(request_params)
        except requests.RequestException as e:
            raise ObisDiscoveryError(f"OBIS discovery query {label!r} failed: {e}") from e

        # `from` is ignored by this endpoint, so a short response is not
        # paginated — it is truncated. Retry once with a bigger `size`.
        if total > len(results):
            bigger = min(total + 1000, _MAX_PAGE_SIZE)
            self.logger.warning(
                "OBIS discovery query %s returned %d of %d datasets; retrying with size=%d",
                label, len(results), total, bigger,
            )
            try:
                total, results = fetch(dict(params, size=bigger))
            except requests.RequestException as e:
                raise ObisDiscoveryError(f"OBIS discovery query {label!r} retry failed: {e}") from e
            if total > len(results):
                raise ObisDiscoveryError(
                    f"OBIS discovery query {label!r} returned {len(results)} of {total} "
                    f"datasets even at size={bigger}. The /v3/dataset endpoint ignores "
                    "'from', so there is no pagination fallback — refusing to harvest a "
                    "truncated list."
                )

        ids = [r["id"] for r in results if r.get("id")]
        if not ids and not allow_empty:
            # A typo'd node/area id must not silently shrink the union.
            raise ObisDiscoveryError(
                f"OBIS discovery query {label!r} returned no datasets. Check the "
                "configured node/area id."
            )

        self.logger.info("OBIS discovery %s -> %d datasets", label, len(ids))
        return ids

    def discover(self) -> DiscoveryResult:
        """Resolve the dataset list. All-or-nothing: any query failure raises."""
        cfg = self.config
        if not cfg.enabled:
            raise ObisDiscoveryError("discover() called with obis_discovery disabled")

        geometry_wkt, tolerance = self._query_geometry()

        # Build every query first, then run them all. Nothing is unioned until
        # every one has succeeded.
        queries = []
        for node_id in cfg.node_ids:
            queries.append((f"node:{node_id}", {"nodeid": node_id}, False))
        for area_id in cfg.area_ids:
            queries.append((f"area:{area_id}", {"areaid": area_id}, False))
        if geometry_wkt:
            self.logger.info(
                "OBIS discovery geometry: %d bytes%s",
                len(geometry_wkt.encode()),
                f" (simplify tolerance {tolerance})" if tolerance else " (inline WKT)",
            )
            # A geometry that legitimately matches nothing is possible (a small
            # inline test polygon), so an empty result here is not an error.
            queries.append(("geometry", {"geometry": geometry_wkt}, True))

        per_query = {}
        found = set()
        for label, params, allow_empty in queries:
            ids = self._query(label, params, allow_empty=allow_empty)
            per_query[label] = len(ids)
            found.update(ids)

        if cfg.include:
            before = len(found)
            found.update(cfg.include)
            per_query["include"] = len(found) - before
        if cfg.exclude:
            excluded = found & set(cfg.exclude)
            found -= excluded
            per_query["exclude"] = -len(excluded)

        dataset_ids = sorted(found)
        self.logger.info(
            "OBIS discovery resolved %d datasets from %d queries: %s",
            len(dataset_ids), len(queries), per_query,
        )

        if len(dataset_ids) < cfg.min_datasets:
            raise ObisDiscoveryError(
                f"OBIS discovery found only {len(dataset_ids)} datasets, below the "
                f"min_datasets floor of {cfg.min_datasets}. Refusing to harvest — a "
                "short list would prune real datasets from the database. Per-query "
                f"counts: {per_query}"
            )

        return DiscoveryResult(
            dataset_ids=dataset_ids,
            per_query=per_query,
            geometry_bytes=len(geometry_wkt.encode()) if geometry_wkt else None,
            geometry_tolerance=tolerance,
        )


def default_discovery_config(**overrides):
    """The shipped default spec: OBIS Canada + OTN-OBIS + the Canadian EEZ."""
    raw = {
        "enabled": True,
        "nodes": sorted(DEFAULT_EXEMPT_NODE_IDS),
        "geometry": "eez",
    }
    raw.update(overrides)
    return ObisDiscoveryConfig.from_config(raw)
