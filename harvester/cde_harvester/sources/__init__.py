"""Harvest sources.

One subpackage per kind of source the CDE pipeline harvests from:
``erddap`` (one instance per configured server URL), ``obis`` (one monolithic
source) and ``ckan`` (metadata enrichment, not a BaseHarvester). All
harvesters implement :class:`cde_harvester.sources.base.BaseHarvester` and
return a :class:`~cde_harvester.sources.base.HarvestResult`.
"""

import base64
from urllib.parse import urlparse

# OBIS is harvested as one monolithic source; in the audit it is recorded
# under this sentinel erddap_url (sources.obis.harvester.OBIS_SOURCE_URL).
# Accept a few spellings so a dashboard/UI caller can ask for OBIS without
# knowing the exact sentinel.
OBIS_ALIASES = {"obis", "https://obis.org", "http://obis.org", "obis.org"}


def resolve_source(source, erddap_urls_list):
    """Resolve a requested ``source`` to a single ERDDAP url or the literal 'obis'.

    Lenient on input: accepts the full configured URL, its hostname, the
    dashboard's urlsafe-base64 slug, or an OBIS alias. Returns None when
    ``source`` is falsy (= full harvest, no narrowing).

    Raises ValueError if it does not resolve to exactly one configured source.
    A typo MUST hard-fail before any harvest or DB write — a silently-empty
    single-source harvest could otherwise be mistaken for "this source has no
    datasets".
    """
    if not source:
        return None
    s = str(source).strip()
    candidates = {s, s.rstrip("/")}
    # The dashboard slugifies erddap_url as urlsafe-base64 (slug.py); accept it.
    try:
        decoded = base64.urlsafe_b64decode(s + "=" * (-len(s) % 4)).decode("utf-8").strip()
        candidates.update({decoded, decoded.rstrip("/")})
    except Exception:
        pass
    if candidates & OBIS_ALIASES:
        return "obis"

    def _host(u):
        try:
            return urlparse(u if "://" in u else "https://" + u).hostname
        except Exception:
            return None

    cand_norm = {c.rstrip("/") for c in candidates}
    cand_hosts = {_host(c) for c in candidates if c}
    matches = []
    for url in erddap_urls_list:
        if url.rstrip("/") in cand_norm or (_host(url) and _host(url) in cand_hosts):
            matches.append(url)
    matches = list(dict.fromkeys(matches))
    if len(matches) == 1:
        return matches[0]
    raise ValueError(
        f"source {source!r} did not resolve to exactly one configured source "
        f"(matched {matches}; configured ERDDAP urls: {erddap_urls_list})"
    )
