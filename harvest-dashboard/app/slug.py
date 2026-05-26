"""Stable, reversible slugs for ERDDAP URLs used in dashboard route paths.

URL-encoding (percent-escaping) breaks here because Starlette decodes %2F
to / before route matching, so a percent-encoded URL collides with the
{slug} path parameter boundary. URL-safe base64 sidesteps that — it
produces an ASCII string with no '/' that round-trips back to the
original URL.
"""

import base64


def slugify(erddap_url: str) -> str:
    return base64.urlsafe_b64encode(erddap_url.encode("utf-8")).decode("ascii").rstrip("=")


def unslug(slug: str) -> str:
    # urlsafe_b64encode strips '=' padding above; add it back.
    padding = "=" * (-len(slug) % 4)
    return base64.urlsafe_b64decode(slug + padding).decode("utf-8")
