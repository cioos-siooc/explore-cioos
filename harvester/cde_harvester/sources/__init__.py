"""Harvest sources: ``erddap`` (one per server URL), ``obis`` (one monolithic
source) and ``ckan`` (metadata enrichment, not a BaseHarvester)."""

import base64
from urllib.parse import urlparse

# Spellings of the OBIS sentinel erddap_url (sources.obis.harvester.OBIS_SOURCE_URL)
# so a dashboard caller needn't know it exactly.
OBIS_ALIASES = {"obis", "https://obis.org", "http://obis.org", "obis.org"}


def resolve_source(source, erddap_urls_list):
    """Resolve ``source`` (URL, hostname, dashboard slug or OBIS alias) to one
    ERDDAP url or 'obis'; None when falsy (= full harvest).

    Raises ValueError unless exactly one source matches: a typo MUST hard-fail
    before any DB write, or an empty harvest could read as "no datasets".
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
