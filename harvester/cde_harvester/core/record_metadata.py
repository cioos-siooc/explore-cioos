"""The dataset page's descriptive metadata, normalized across sources.

CKAN (ckanext-scheming fields), the CIOOS-form record cioos-metadata-conversion
builds for OBIS datasets, and ERDDAP's ACDD globals each describe a dataset in
their own shape. These turn each into one small dict for ``datasets.metadata``
(jsonb), and ``merge`` combines them with the first source winning per field:

    abstract {en, fr} · citation {en, fr} · doi · license {title, url}
    contacts [{name, organization, email, url, roles, cited}] · keywords {en, fr}
    dates {created, published, revised} · temporal_extent {begin, end}
    vertical_extent {min, max} · progress · update_frequency · projects
    lineage · acknowledgement
    resources [{name {en, fr}, description {en, fr}, url, format, language}]

Empty values are dropped rather than stored, so a field a better source leaves
blank falls through to the next one.
"""

import html
import json
import math
import re

# CKAN writes the literal string "None" for an unset license/constraint.
_EMPTY_STRINGS = {"", "none", "null", "n/a"}
# cioos-metadata-conversion's add_fr fills every French field with this.
_UNTRANSLATED_FR = "Traduction française actuellement indisponible"
_DOI = re.compile(r"(10\.\d{4,9}/\S+)")
_URL = re.compile(r"^https?://\S+$")
_ESCAPED_UNICODE = re.compile(r"\\u([0-9a-fA-F]{4})")
_PARAGRAPH_END = re.compile(r"<\s*/\s*(p|div|ul|ol)\s*>", re.IGNORECASE)
_LINE_BREAK = re.compile(r"<\s*br\s*/?\s*>", re.IGNORECASE)
_LIST_ITEM = re.compile(r"<\s*li\b[^>]*>", re.IGNORECASE)
# Any tag, but not a markdown autolink like <https://example.org>.
_TAG = re.compile(r"<(?!https?://|mailto:)[^>]+>")


def _text(value):
    if value is None:
        return None
    text = str(value).strip()
    return None if text.lower() in _EMPTY_STRINGS else text


def _prune(value):
    """Drop empty strings, lists and dicts, recursively."""
    if isinstance(value, dict):
        pruned = {k: _prune(v) for k, v in value.items()}
        return {k: v for k, v in pruned.items() if v not in (None, "", [], {})} or None
    if isinstance(value, list):
        pruned = [_prune(v) for v in value]
        return [v for v in pruned if v not in (None, "", [], {})] or None
    if isinstance(value, str):
        return _text(value)
    return value


def _unique(values):
    seen, out = set(), []
    for value in values:
        # OBIS keywords arrive entity-encoded ("EARTH SCIENCE &gt; ...").
        text = _text(html.unescape(value) if isinstance(value, str) else value)
        if text and text.lower() not in seen:
            seen.add(text.lower())
            out.append(text)
    return out


def _doi_url(value):
    match = _DOI.search(_text(value) or "")
    return f"https://doi.org/{match.group(1)}" if match else None


def _number(value):
    """NaN/inf would survive neither the CSV's literal_eval nor jsonb."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _first(items):
    return items[0] if items else {}


def _plain(text):
    """Abstracts are rendered as markdown, but some publishers (OBIS IPT
    especially) send HTML: keep its paragraphs, breaks and list items as
    markdown and drop the rest of the markup."""
    if not isinstance(text, str):
        return text
    is_html = bool(_TAG.search(text))
    text = _PARAGRAPH_END.sub("\n\n", text)
    text = _LINE_BREAK.sub("\n", text)
    text = _LIST_ITEM.sub("\n- ", text)
    text = html.unescape(_TAG.sub("", text))
    if is_html:
        # The markup's source indentation would read as markdown code blocks.
        text = re.sub(r"^[ \t]+", "", text, flags=re.MULTILINE)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _abstract(value):
    return {lang: _plain(text) for lang, text in (value or {}).items()}


def _who(contacts):
    """Contacts with a person or organization to name, one entry per contact:
    a source that lists the same contact under several roles (ACDD's creator
    and publisher are often one organization) gets one entry with all of them,
    cited if any of them is."""
    merged = {}
    for contact in contacts:
        if not (_text(contact.get("name")) or _text(contact.get("organization"))):
            continue
        key = tuple(_text(contact.get(k)) for k in ("name", "organization", "email"))
        if key in merged:
            roles = merged[key]["roles"]
            roles += [r for r in contact.get("roles") or [] if r not in roles]
            merged[key]["cited"] = merged[key]["cited"] or contact.get("cited", False)
        else:
            merged[key] = {
                **contact,
                "roles": list(contact.get("roles") or []),
                "cited": bool(contact.get("cited")),
            }
    return list(merged.values())


def _as_list(value):
    """CKAN gives a single contact role as a bare string."""
    if not value:
        return []
    return value if isinstance(value, list) else [value]


def _links(resources):
    """Resources with a link, each link once."""
    seen, out = set(), []
    for resource in resources:
        url = _text(resource.get("url"))
        if url and url not in seen:
            seen.add(url)
            out.append(resource)
    return out


def _translated(translated, fallback):
    """CKAN's {en, fr} field, else its single-language one as English."""
    return translated or {"en": fallback}


def merge(*partials):
    """First non-empty value per field; dict fields ({en, fr}, dates, ...)
    merge one level down, so CKAN's English abstract and ERDDAP's French one
    can both survive."""
    merged = {}
    for partial in partials:
        for key, value in (partial or {}).items():
            if key not in merged:
                merged[key] = value
            elif isinstance(merged[key], dict) and isinstance(value, dict):
                merged[key] = {**value, **merged[key]}
    return merged


# --- CKAN ----------------------------------------------------------------


def _csl_citation(raw):
    """CKAN's citation is a CSL-JSON list serialized with escaped quotes."""
    if not raw:
        return None
    try:
        items = json.loads(raw)
    except ValueError:
        try:
            items = json.loads(raw.replace('\\"', '"'))
        except ValueError:
            return None
    csl = _first(items) if isinstance(items, list) else items
    if not isinstance(csl, dict):
        return None
    authors = [
        a.get("literal") or ", ".join(filter(None, [a.get("family"), a.get("given")]))
        for a in csl.get("author") or []
    ]
    date_parts = _first(csl.get("issued") or []).get("date-parts") or []
    year = date_parts[0] if date_parts else None
    parts = [
        "; ".join(filter(None, authors)) + (f" ({year})" if year else ""),
        _text(csl.get("title")),
        _text(csl.get("edition")),
        _text(csl.get("publisher")),
        _doi_url(csl.get("DOI")) or _text(csl.get("URL")),
    ]
    return ". ".join(p.strip().rstrip(".") for p in parts if p and p.strip()) or None


def _ckan_contact(party, cited, default_role=None):
    return {
        "name": party.get("individual-name"),
        "organization": party.get("organisation-name"),
        "email": party.get("contact-info_email"),
        "url": party.get("individual-uri_code")
        or party.get("contact-info_online-resource")
        or party.get("organisation-uri_code"),
        "roles": _as_list(party.get("role")) or _as_list(default_role),
        "cited": cited,
    }


def _ckan_lineage(steps):
    """CKAN's lineage is a list of ISO lineage records (the schema's own
    "statment" spelling); the page shows one text, as ERDDAP's history is."""
    statements = [
        _text(s.get("en") or s.get("fr"))
        for s in (step.get("statment") or {} for step in steps or [])
    ]
    return "\n\n".join(filter(None, statements)) or None


def from_ckan(package):
    citation = package.get("citation") or {}
    dates = {d.get("type"): d.get("value") for d in package.get("dataset-reference-date") or []}
    temporal = _first(package.get("temporal-extent") or [])
    vertical = _first(package.get("vertical-extent") or [])
    keywords = package.get("keywords") or {}
    identifiers = package.get("unique-resource-identifier-full") or []
    return _prune({
        "abstract": _abstract(package.get("notes_translated") or {"en": package.get("notes")}),
        "citation": {lang: _csl_citation(citation.get(lang)) for lang in ("en", "fr")},
        "doi": next(filter(None, (_doi_url(i.get("code")) for i in identifiers)), None),
        "license": {"title": package.get("license_title"), "url": package.get("license_url")},
        "contacts": _who([
            *(_ckan_contact(p, True) for p in package.get("cited-responsible-party") or []),
            *(
                _ckan_contact(p, False, "pointOfContact")
                for p in package.get("metadata-point-of-contact") or []
            ),
            *(_ckan_contact(p, False, "distributor") for p in package.get("distributor") or []),
        ]),
        "keywords": {lang: _unique(keywords.get(lang) or []) for lang in ("en", "fr")},
        "dates": {
            "created": dates.get("creation"),
            "published": dates.get("publication"),
            "revised": dates.get("revision"),
        },
        "temporal_extent": {"begin": temporal.get("begin"), "end": temporal.get("end")},
        "vertical_extent": {"min": _number(vertical.get("min")), "max": _number(vertical.get("max"))},
        "progress": package.get("progress"),
        "update_frequency": package.get("frequency-of-update"),
        "projects": _unique(package.get("projects") or []),
        "lineage": _ckan_lineage(package.get("lineage")),
        "resources": _links([
            {
                "name": _translated(r.get("name_translated"), r.get("name")),
                "description": _translated(
                    r.get("description_translated"), r.get("description")
                ),
                "url": r.get("url"),
                "format": r.get("format"),
                "language": r.get("language"),
            }
            for r in package.get("resources") or []
        ]),
    }) or {}


# --- CIOOS-form record (OBIS conversion) -----------------------------------


def _english(value):
    """The converter's {en, fr} fields carry only English; its French is a placeholder."""
    if isinstance(value, dict):
        fr = value.get("fr")
        return {"en": value.get("en"), "fr": None if fr == _UNTRANSLATED_FR else fr}
    return {"en": value}


def from_cioos_record(record, citation=None):
    """``citation`` is the OBIS dataset's own citation string: the CIOOS-form
    record has no citation field."""
    keywords = record.get("keywords") or {}
    return _prune({
        "abstract": _abstract(_english(record.get("abstract"))),
        "citation": {"en": citation},
        "doi": _doi_url(record.get("datasetIdentifier")),
        "license": {"url": record.get("license")}
        if _URL.match(record.get("license") or "")
        else {"title": record.get("license")},
        "contacts": _who([
            {
                "name": c.get("indName"),
                "organization": c.get("orgName"),
                "email": c.get("indEmail"),
                "url": c.get("orgURL"),
                "roles": c.get("role") or [],
                "cited": bool(c.get("inCitation")),
            }
            for c in record.get("contacts") or []
        ]),
        "keywords": {"en": _unique(keywords.get("en") or [])},
        "dates": {
            "created": record.get("created"),
            "published": record.get("datePublished"),
            "revised": record.get("dateRevised"),
        },
        "temporal_extent": {"begin": record.get("dateStart"), "end": record.get("dateEnd")},
        "progress": record.get("progress"),
        "projects": _unique(record.get("projects") or []),
        "resources": _links([
            {
                "name": _english(d.get("name")),
                "description": _english(d.get("description")),
                "url": d.get("url"),
            }
            for d in record.get("distribution") or []
        ]),
    }) or {}


# --- ERDDAP ACDD globals ---------------------------------------------------


def _erddap_text(value):
    """ERDDAP's CSV spells non-ASCII as \\uXXXX and newlines as \\n."""
    if not isinstance(value, str):
        return value
    value = _ESCAPED_UNICODE.sub(lambda m: chr(int(m.group(1), 16)), value)
    return value.replace("\\n", "\n")


def _split(value, separator):
    return [part.strip() for part in (value or "").split(separator)]


def _acdd_contacts(globals_):
    contacts = []
    # ACDD's creator is who a citation names; publisher and contributors are not.
    for prefix, role, cited in (("creator", "author", True), ("publisher", "publisher", False)):
        contacts.append({
            "name": globals_.get(f"{prefix}_name"),
            "organization": globals_.get(f"{prefix}_institution"),
            "email": globals_.get(f"{prefix}_email"),
            "url": globals_.get(f"{prefix}_url"),
            "roles": [role],
            "cited": cited,
        })
    # contributor_name/contributor_role are parallel lists: ";"-separated in
    # CIOOS ERDDAPs (each role slot then a comma list), ","-separated elsewhere.
    # Split only when the two line up, since "Last, First" has a comma too.
    names, roles = globals_.get("contributor_name"), globals_.get("contributor_role")
    separator = ";" if ";" in (names or "") else ","
    split_names, split_roles = _split(names, separator), _split(roles, separator)
    if len(split_names) != len(split_roles):
        split_names, split_roles = [names], [roles]
    contacts += [
        {"name": n, "roles": _split(r, ",") if separator == ";" else [r]}
        for n, r in zip(split_names, split_roles, strict=True)
    ]
    return contacts


def from_erddap_globals(globals_):
    g = {k: _erddap_text(v) for k, v in (globals_ or {}).items()}
    license_text = _text(g.get("license"))
    return _prune({
        "abstract": _abstract({"en": g.get("summary"), "fr": g.get("summary_fr") or g.get("summary_fra")}),
        "citation": {"en": g.get("citation")},
        "doi": _doi_url(g.get("doi")),
        "license": {"url": license_text}
        if _URL.match(license_text or "")
        else {"title": license_text},
        "contacts": _who(_acdd_contacts(g)),
        "keywords": {
            "en": _unique((g.get("keywords") or "").split(",")),
            "fr": _unique((g.get("keywords_fr") or "").split(",")),
        },
        "dates": {
            "created": g.get("date_created"),
            "published": g.get("date_issued"),
            "revised": g.get("date_modified"),
        },
        "temporal_extent": {"begin": g.get("time_coverage_start"), "end": g.get("time_coverage_end")},
        "vertical_extent": {
            "min": _number(g.get("geospatial_vertical_min")),
            "max": _number(g.get("geospatial_vertical_max")),
        },
        "projects": _unique((g.get("project") or "").split(",")),
        "lineage": g.get("history"),
        "acknowledgement": g.get("acknowledgement") or g.get("acknowledgment"),
        "resources": _links([
            {"name": {"en": "infoUrl"}, "url": g.get("infoUrl")},
            *[{"url": url} for url in (g.get("references") or "").split() if _URL.match(url)],
        ]),
    }) or {}
