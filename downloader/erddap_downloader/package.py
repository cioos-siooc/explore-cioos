"""The self-describing files of a download package, all rendered from the
downloader report plus the query that produced it.

- README.md: the human summary (what's included, what isn't and why).
- datapackage.json: Frictionless Data Package v2 over the data files.
- ro-crate-metadata.json: RO-Crate 1.2; one CreateAction per subset records
  the request URLs, timing and outcome, failures included.
- citations.txt/.bib/.ris, CITATION.cff, rights.txt: GBIF-style citation and
  licence files; each dataset folder also carries its own citation.txt.

Each subset citation follows ESIP / RDA dynamic-data-citation practice: the
source's own citation, then the subset and the UTC time and URL it was
retrieved from.
"""

import hashlib
import json
import re
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path

from erddap_downloader.download_erddap import COMPLETED, EMPTY, FAILED, IGNORED, PARTIAL
from erddap_downloader.formats import FORMATS

INCLUDED = (COMPLETED, PARTIAL)
SOFTWARE_URL = "https://github.com/cioos-siooc/explore-cioos"
FRICTIONLESS_PROFILE = "https://datapackage.org/profiles/2.0/datapackage.json"
RO_CRATE = "https://w3id.org/ro/crate/1.2"

REASONS = {
    "en": {
        FAILED: "could not be retrieved from its source",
        EMPTY: "had no data matching your selection",
        IGNORED: "was skipped because the download size limit was reached",
        PARTIAL: "was cut off at the per-dataset size limit",
        "fallback": "was delivered as CSV: {format} is not available for this source",
    },
    "fr": {
        FAILED: "n'a pas pu être récupéré depuis sa source",
        EMPTY: "ne contenait aucune donnée correspondant à votre sélection",
        IGNORED: "a été ignoré car la limite de taille de téléchargement a été atteinte",
        PARTIAL: "a été tronqué à la limite de taille par jeu de données",
        "fallback": "a été livré en CSV : {format} n'est pas disponible pour cette source",
    },
}

_TEXT = {
    "en": {
        "title": "CIOOS Data Explorer download",
        "created": "Created",
        "summary": "{n} of {m} datasets included.",
        "selection": "Your selection",
        "time": "Time",
        "depth": "Depth (m)",
        "area": "Area",
        "polygon": "polygon (WKT): {wkt}",
        "box": "latitude {lat_min} to {lat_max}, longitude {lon_min} to {lon_max}",
        "anywhere": "anywhere",
        "format": "Format",
        "filters": "Other filters (as sent by the Data Explorer)",
        "datasets": "Datasets",
        "status": "Status",
        "rows": "Rows",
        "issues": "Not included or incomplete",
        "server": "Source response",
        "retry": "Request URL",
        "cite": "How to cite",
        "cite_text": (
            "Cite every dataset you use. Each dataset folder has its own citation.txt; all citations are in "
            "citations.txt, citations.bib, citations.ris and CITATION.cff. Each citation names the subset and "
            "when and where it was retrieved."
        ),
        "licences": "Licences",
        "licences_text": "Each dataset keeps its own licence (also listed in rights.txt):",
        "no_licence": "no licence recorded; check the source",
        "contents": "Package contents",
        "contents_text": (
            "- `<dataset folder>/`: the data subset, its citation.txt, and the source's own metadata records "
            "(metadata.json as shown in the Data Explorer, erddap.nccsvMetadata, ckan_iso19115.xml, "
            "obis_dataset.json, eml.xml where available).\n"
            "- `datapackage.json`: Frictionless Data Package v2 describing the data files (checksums, "
            "columns, request URLs, licences).\n"
            "- `ro-crate-metadata.json`: RO-Crate 1.2 provenance: one action per dataset with its request "
            "URLs, timing and outcome."
        ),
        "warnings": "Notes",
    },
    "fr": {
        "title": "Téléchargement de l'Explorateur de données du SIOOC",
        "created": "Créé le",
        "summary": "{n} jeux de données sur {m} inclus.",
        "selection": "Votre sélection",
        "time": "Temps",
        "depth": "Profondeur (m)",
        "area": "Zone",
        "polygon": "polygone (WKT) : {wkt}",
        "box": "latitude {lat_min} à {lat_max}, longitude {lon_min} à {lon_max}",
        "anywhere": "partout",
        "format": "Format",
        "filters": "Autres filtres (tels qu'envoyés par l'Explorateur)",
        "datasets": "Jeux de données",
        "status": "Statut",
        "rows": "Lignes",
        "issues": "Non inclus ou incomplets",
        "server": "Réponse de la source",
        "retry": "URL de la requête",
        "cite": "Comment citer",
        "cite_text": (
            "Citez chaque jeu de données utilisé. Chaque dossier contient son citation.txt; toutes les "
            "citations sont dans citations.txt, citations.bib, citations.ris et CITATION.cff. Chaque citation "
            "précise le sous-ensemble, la date et l'URL de récupération."
        ),
        "licences": "Licences",
        "licences_text": "Chaque jeu de données conserve sa licence (aussi dans rights.txt) :",
        "no_licence": "aucune licence enregistrée; consultez la source",
        "contents": "Contenu du paquet",
        "contents_text": (
            "- `<dossier du jeu de données>/` : le sous-ensemble, son citation.txt et les fiches de métadonnées "
            "de la source (metadata.json tel qu'affiché dans l'Explorateur, erddap.nccsvMetadata, "
            "ckan_iso19115.xml, obis_dataset.json, eml.xml selon le cas).\n"
            "- `datapackage.json` : Frictionless Data Package v2 décrivant les fichiers de données (sommes de "
            "contrôle, colonnes, URL des requêtes, licences).\n"
            "- `ro-crate-metadata.json` : provenance RO-Crate 1.2 : une action par jeu de données avec ses "
            "URL de requête, sa durée et son résultat."
        ),
        "warnings": "Remarques",
    },
}


def _lang(user_query):
    return "fr" if user_query.get("language") == "fr" else "en"


def _sha256(path: Path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1024**2), b""):
            digest.update(block)
    return digest.hexdigest()


def landing_url(row):
    if row["source_type"] == "obis":
        return f"https://obis.org/dataset/{row['dataset_id']}"
    return f"{row['erddap_url']}/info/{row['dataset_id']}/index.html"


def _localized(field, lang):
    field = field or {}
    return field.get(lang) or field.get("en") or field.get("fr")


def _authors(metadata):
    contacts = metadata.get("contacts") or []
    cited = [c for c in contacts if c.get("cited")] or contacts
    return [c.get("name") or c.get("organization") for c in cited if c.get("name") or c.get("organization")]


def _year(metadata):
    dates = metadata.get("dates") or {}
    for key in ("published", "created", "revised"):
        if dates.get(key):
            return str(dates[key])[:4]
    return None


def _title(row, lang):
    return (lang == "fr" and row.get("title_fr")) or row.get("title") or row["dataset_id"]


def subset_note(row, user_query):
    parts = []
    if user_query.get("time_min") or user_query.get("time_max"):
        parts.append(f"time {user_query.get('time_min') or '…'} to {user_query.get('time_max') or '…'}")
    if user_query.get("depth_min") is not None or user_query.get("depth_max") is not None:
        parts.append(f"depth {user_query.get('depth_min')} to {user_query.get('depth_max')} m")
    if user_query.get("polygon_region"):
        parts.append("polygon area (see README.md)")
    urls = row["download_url_list"]
    more = f" (+{len(urls) - 1} more requests, see datapackage.json)" if len(urls) > 1 else ""
    retrieved = f"Retrieved {row['finished_at']} from {urls[0]}{more}" if urls else f"Retrieved {row['finished_at']}"
    return ("Subset: " + "; ".join(parts) + ". " if parts else "") + retrieved + "."


def source_citation(row, metadata, lang):
    """The source's own citation text, else one built from its metadata."""
    own = _localized(metadata.get("citation"), lang)
    if own:
        return own.strip()
    authors = "; ".join(_authors(metadata))
    year = _year(metadata)
    head = authors + (f" ({year})" if year else "") if authors else (year or "")
    parts = [head, _title(row, lang), metadata.get("doi") or landing_url(row)]
    return ". ".join(p.rstrip(".") for p in parts if p) + "."


def citation(row, metadata, user_query, lang):
    return f"{source_citation(row, metadata, lang)} {subset_note(row, user_query)}"


def _bibtex(row, metadata, user_query, lang):
    key = re.sub(r"[^A-Za-z0-9]+", "_", row["dataset_id"]).strip("_")
    fields = {
        "author": " and ".join("{" + a + "}" for a in _authors(metadata)) or None,
        "title": "{" + _title(row, lang) + "}",
        "year": _year(metadata),
        "doi": (metadata.get("doi") or "").removeprefix("https://doi.org/") or None,
        "url": metadata.get("doi") or landing_url(row),
        "urldate": (row["finished_at"] or "")[:10],
        "note": subset_note(row, user_query),
    }
    body = ",\n".join(f"  {k} = {{{v}}}" for k, v in fields.items() if v)
    return f"@misc{{{key},\n{body}\n}}"


def _ris(row, metadata, user_query, lang):
    lines = ["TY  - DATA"]
    lines += [f"AU  - {a}" for a in _authors(metadata)]
    lines += [f"TI  - {_title(row, lang)}"]
    if _year(metadata):
        lines.append(f"PY  - {_year(metadata)}")
    if metadata.get("doi"):
        lines.append(f"DO  - {metadata['doi'].removeprefix('https://doi.org/')}")
    lines += [
        f"UR  - {metadata.get('doi') or landing_url(row)}",
        f"Y2  - {(row['finished_at'] or '')[:10]}",
        f"N1  - {subset_note(row, user_query)}",
        "ER  - ",
    ]
    return "\n".join(lines)


def _yaml_string(value):
    return json.dumps(value, ensure_ascii=False)


def _citation_cff(entries, user_query, created):
    lines = [
        "cff-version: 1.2.0",
        "message: >-",
        "  This download combines subsets of the datasets listed under references; cite each one you use.",
        "type: dataset",
        f"title: {_yaml_string('CIOOS Data Explorer download ' + user_query['job_id'])}",
        "authors:",
        f"  - name: {_yaml_string('CIOOS Data Explorer')}",
        f"date-released: {created[:10]}",
        f"url: {_yaml_string(SOFTWARE_URL)}",
        "references:",
    ]
    for row, metadata, lang in entries:
        lines += [
            "  - type: data",
            f"    title: {_yaml_string(_title(row, lang))}",
            "    authors:",
            *[f"      - name: {_yaml_string(a)}" for a in _authors(metadata) or ["Unknown"]],
            f"    url: {_yaml_string(landing_url(row))}",
            f"    notes: {_yaml_string(subset_note(row, user_query))}",
        ]
        if metadata.get("doi"):
            lines.append(f"    doi: {_yaml_string(metadata['doi'].removeprefix('https://doi.org/'))}")
        if _year(metadata):
            lines.append(f"    year: {_year(metadata)}")
    return "\n".join(lines) + "\n"


def _licence(metadata):
    licence = metadata.get("license") or {}
    return licence if licence.get("title") or licence.get("url") else None


def _frictionless_licence(licence):
    if licence.get("url"):
        return {"path": licence["url"], **({"title": licence["title"]} if licence.get("title") else {})}
    # A bare SPDX-style ID ("CC-BY-4.0") is a valid Open Definition name.
    if re.fullmatch(r"[A-Za-z0-9.\-]+", licence["title"]):
        return {"name": licence["title"]}
    return None


def _odv_comment_rows(path: Path):
    with open(path, encoding="utf-8") as f:
        count = 0
        for line in f:
            if not line.startswith("//"):
                break
            count += 1
    return list(range(1, count + 1))


def _resource(root, row, file, licence):
    form = FORMATS[row["format"]]
    path = root / file["path"]
    name = re.sub(r"[^a-z0-9._-]+", "-", Path(file["path"]).stem.lower())
    resource = {
        "name": name,
        "path": file["path"],
        "title": row.get("title") or row["dataset_id"],
        "format": path.suffix.lstrip("."),
        "mediatype": form.mediatype,
        "bytes": file["bytes"],
        "hash": "sha256:" + file["sha256"],
        "sources": [{"title": "Request URL", "path": url} for url in row["download_url_list"]],
    }
    if licence and _frictionless_licence(licence):
        resource["licenses"] = [_frictionless_licence(licence)]
    if row["format"] != "nccf":
        resource["type"] = "table"
        resource["schema"] = {
            "fields": [
                {"name": c["name"], **({"description": f"Units: {c['unit']}"} if c["unit"] else {})}
                for c in file["columns"]
            ]
        }
    if row["format"] == "csv" and row["source_type"] != "obis":
        resource["dialect"] = {"commentRows": [2]}
    elif row["format"] == "odv":
        resource["dialect"] = {"delimiter": "\t", "commentRows": _odv_comment_rows(path)}
    return resource


def _outcome(row, lang):
    reasons = REASONS[lang]
    notes = []
    if row["status"] not in INCLUDED or row["status"] == PARTIAL:
        notes.append(reasons[row["status"]])
    if row.get("format_fallback") and row["files"]:
        notes.append(reasons["fallback"].format(format=FORMATS[row["requested_format"]].label))
    return notes


def _readme(root, user_query, entries, created, lang):
    t = _TEXT[lang]
    included = [e for e in entries if e[0]["status"] in INCLUDED]
    lines = [
        f"# {t['title']} {user_query['job_id']}",
        "",
        f"{t['created']}: {created}",
        "",
        f"**{t['summary'].format(n=len(included), m=len(entries))}**",
        "",
        f"## {t['selection']}",
        "",
    ]
    if user_query.get("time_min") or user_query.get("time_max"):
        lines.append(f"- {t['time']}: {user_query.get('time_min') or '…'} – {user_query.get('time_max') or '…'}")
    if user_query.get("depth_min") is not None or user_query.get("depth_max") is not None:
        lines.append(f"- {t['depth']}: {user_query.get('depth_min')} – {user_query.get('depth_max')}")
    if user_query.get("polygon_region"):
        area = t["polygon"].format(wkt=user_query["polygon_region"])
    elif all(user_query.get(k) is not None for k in ("lat_min", "lat_max", "lon_min", "lon_max")):
        area = t["box"].format(**user_query)
    else:
        area = t["anywhere"]
    lines.append(f"- {t['area']}: {area}")
    lines.append(f"- {t['format']}: {FORMATS[user_query.get('format') or 'csv'].label}")
    filters = user_query.get("filters") or {}
    if filters:
        lines.append(f"- {t['filters']}:")
        lines += [f"  - `{k}`: {v}" for k, v in sorted(filters.items())]

    lines += ["", f"## {t['datasets']}", "", f"| Dataset | {t['status']} | {t['rows']} | Folder |", "|---|---|---|---|"]
    for row, _, _ in entries:
        title = (row.get("title") or row["dataset_id"]).replace("|", "\\|")
        # A folder with nothing in it isn't kept in the zip.
        folder = f"`{row['folder']}/`" if any((root / row["folder"]).iterdir()) else "—"
        lines.append(f"| {title} | {row['status']} | {row['n_records']} | {folder} |")

    issues = [(row, _outcome(row, lang)) for row, _, _ in entries if _outcome(row, lang) or row["warnings"]]
    if issues:
        lines += ["", f"## {t['issues']}", ""]
        for row, notes in issues:
            lines.append(f"- **{row.get('title') or row['dataset_id']}** (`{row['dataset_id']}`)")
            lines += [f"  - {n}." for n in notes]
            if row["erddap_error"]:
                lines.append(f"  - {t['server']}: {row['erddap_error'].replace(chr(10), '; ')}")
            if row["status"] not in INCLUDED or row["status"] == PARTIAL:
                lines += [f"  - {t['retry']}: <{url}>" for url in row["download_url_list"]]
            lines += [f"  - {t['warnings']}: {w}" for w in row["warnings"]]

    lines += ["", f"## {t['cite']}", "", t["cite_text"], ""]
    lines += [f"- {citation(row, metadata, user_query, lng)}" for row, metadata, lng in included]
    lines += ["", f"## {t['licences']}", "", t["licences_text"], ""]
    for row, metadata, _ in included:
        licence = _licence(metadata)
        text = " ".join(filter(None, [licence.get("title"), licence.get("url")])) if licence else t["no_licence"]
        lines.append(f"- {row.get('title') or row['dataset_id']}: {text}")
    lines += ["", f"## {t['contents']}", "", t["contents_text"], ""]
    return "\n".join(lines)


# description, encodingFormat for every non-data file the package can hold.
_FILE_KINDS = {
    "README.md": ("Summary of this download: what is included, what is not and why", "text/markdown"),
    "datapackage.json": ("Frictionless Data Package v2 descriptor of the data files", "application/json"),
    "citations.txt": ("A citation for each included dataset subset", "text/plain"),
    "citations.bib": ("The citations in BibTeX", "application/x-bibtex"),
    "citations.ris": ("The citations in RIS", "application/x-research-info-systems"),
    "CITATION.cff": ("Citation File Format record of this download and its sources", "application/x-yaml"),
    "rights.txt": ("The licence of each included dataset", "text/plain"),
    "citation.txt": ("Citation for this dataset subset", "text/plain"),
    "metadata.json": ("The dataset's metadata as shown in the CIOOS Data Explorer", "application/json"),
    "erddap.nccsvMetadata": ("The dataset's ERDDAP global and variable attributes (NCCSV)", "text/csv"),
    "ckan_iso19115.xml": ("The dataset's ISO 19115-3 record from the CIOOS catalogue", "application/xml"),
    "ckan_package.json": ("The dataset's CIOOS catalogue (CKAN) record", "application/json"),
    "obis_dataset.json": ("The dataset's OBIS record", "application/json"),
    "eml.xml": ("The dataset's Ecological Metadata Language record from its IPT", "application/xml"),
}
_ACTION_STATUSES = {"CompletedActionStatus": "Completed", "FailedActionStatus": "Failed"}


def _file_entity(file_id, name, size, data_files, row):
    if name in data_files:
        description = f"Subset of {row.get('title') or row['dataset_id']}"
        encoding = FORMATS[row["format"]].mediatype
    else:
        description, encoding = _FILE_KINDS[name]
    return {
        "@id": file_id,
        "@type": "File",
        "name": name,
        "description": description,
        "encodingFormat": encoding,
        "contentSize": str(size),
    }


def _compact(refs):
    """RO-Crate prefers a single value over a one-item list."""
    return refs[0] if len(refs) == 1 else refs


def _status_iri(row):
    status = "CompletedActionStatus" if row["status"] in INCLUDED else "FailedActionStatus"
    return {"@id": f"http://schema.org/{status}"}


def _ro_crate(root: Path, user_query, entries, created, root_files):
    graph = [
        {
            "@id": "ro-crate-metadata.json",
            "@type": "CreativeWork",
            "conformsTo": {"@id": RO_CRATE},
            "about": {"@id": "./"},
        },
        {
            "@id": "#cde-downloader",
            "@type": "SoftwareApplication",
            "name": "CIOOS Data Explorer downloader",
            "version": version("downloader"),
            "url": SOFTWARE_URL,
        },
        {"@id": "https://cioos.ca", "@type": "Organization", "name": "CIOOS"},
        {
            "@id": "#mixed-licences",
            "@type": "CreativeWork",
            "name": "Each dataset keeps its own licence",
            "description": "See rights.txt and each dataset folder's license.",
        },
        *[
            {"@id": f"http://schema.org/{status}", "@type": "ActionStatusType", "name": name}
            for status, name in _ACTION_STATUSES.items()
        ],
    ]
    has_part = [{"@id": f} for f in root_files]
    seen = set()

    def add(entity):
        if entity["@id"] not in seen:
            seen.add(entity["@id"])
            graph.append(entity)

    for i, (row, metadata, lang) in enumerate(entries):
        folder = root / row["folder"]
        files = sorted(p for p in folder.iterdir() if p.is_file())
        file_ids = [f"{row['folder']}/{p.name}" for p in files]
        source_id = metadata.get("doi") or landing_url(row)
        # A CreativeWork, not a Dataset: a Dataset is a data entity, which
        # RO-Crate requires to be inside the crate.
        add({"@id": source_id, "@type": "CreativeWork", "name": _title(row, lang), "url": landing_url(row)})
        action = {
            "@id": f"#subset-{i}",
            "@type": "CreateAction",
            "name": f"Subset of {_title(row, lang)}",
            "instrument": {"@id": "#cde-downloader"},
            "object": {"@id": source_id},
            "startTime": row["started_at"],
            "endTime": row["finished_at"],
            "actionStatus": _status_iri(row),
            "description": "\n".join(row["download_url_list"]),
        }
        if row["files"]:
            action["result"] = _compact([{"@id": f["path"]} for f in row["files"]])
        if row["erddap_error"] or row["status"] not in INCLUDED:
            action["error"] = row["erddap_error"] or REASONS["en"][row["status"]]
        graph.append(action)
        # An empty folder isn't kept in the zip, so it can't be in the crate.
        if not files:
            continue
        licence = _licence(metadata)
        folder_entity = {
            "@id": f"{row['folder']}/",
            "@type": "Dataset",
            "name": _title(row, lang),
            "description": f"Data and metadata for the subset of {row['dataset_id']}",
            "isBasedOn": {"@id": source_id},
            "hasPart": _compact([{"@id": f} for f in file_ids]),
        }
        if licence:
            licence_id = licence.get("url") or f"#licence-{i}"
            add({"@id": licence_id, "@type": "CreativeWork", "name": licence.get("title") or licence_id})
            folder_entity["license"] = {"@id": licence_id}
        if row["status"] in INCLUDED:
            folder_entity["creditText"] = citation(row, metadata, user_query, lang)
        graph.append(folder_entity)
        has_part.append({"@id": f"{row['folder']}/"})
        data_files = {Path(f["path"]).name for f in row["files"]}
        for path, file_id in zip(files, file_ids, strict=True):
            graph.append(_file_entity(file_id, path.name, path.stat().st_size, data_files, row))

    graph.insert(
        1,
        {
            "@id": "./",
            "@type": "Dataset",
            "name": f"CIOOS Data Explorer download {user_query['job_id']}",
            "description": "Subsets of ocean datasets selected in the CIOOS Data Explorer.",
            "datePublished": created,
            "license": {"@id": "#mixed-licences"},
            "publisher": {"@id": "https://cioos.ca"},
            "hasPart": has_part,
            "mentions": [{"@id": f"#subset-{i}"} for i in range(len(entries))],
        },
    )
    for name in root_files:
        graph.append(_file_entity(name, name, (root / name).stat().st_size, (), {}))
    return {"@context": f"{RO_CRATE}/context", "@graph": graph}


def write_package(root: Path, json_query, report):
    """Write the package files into ``root`` (the folder that gets zipped)."""
    user_query = json_query["user_query"]
    lang = _lang(user_query)
    created = datetime.now(UTC).isoformat(timespec="seconds")
    requested = user_query.get("format") or "csv"

    entries = []
    for dataset, row in zip(json_query["cache_filtered"], report["erddap_report"], strict=True):
        metadata = dataset.get("metadata") or {}
        row["title_fr"] = dataset.get("title_fr")
        row["requested_format"] = requested
        folder = root / row["folder"]
        if metadata:
            (folder / "metadata.json").write_text(json.dumps(metadata, indent=2, ensure_ascii=False))
        for file in row["files"]:
            file["sha256"] = _sha256(root / file["path"])
        if row["status"] in INCLUDED:
            (folder / "citation.txt").write_text(citation(row, metadata, user_query, lang) + "\n")
        entries.append((row, metadata, lang))
    included = [e for e in entries if e[0]["status"] in INCLUDED]

    (root / "README.md").write_text(_readme(root, user_query, entries, created, lang))
    (root / "citations.txt").write_text("\n\n".join(citation(r, m, user_query, lg) for r, m, lg in included) + "\n")
    (root / "citations.bib").write_text("\n\n".join(_bibtex(*e[:2], user_query, e[2]) for e in included) + "\n")
    (root / "citations.ris").write_text("\n\n".join(_ris(*e[:2], user_query, e[2]) for e in included) + "\n")
    (root / "CITATION.cff").write_text(_citation_cff(included, user_query, created))
    rights = []
    for row, metadata, _ in included:
        licence = _licence(metadata) or {}
        rights.append(
            f"{row.get('title') or row['dataset_id']} ({landing_url(row)}): "
            + (" ".join(filter(None, [licence.get("title"), licence.get("url")])) or "no licence recorded")
        )
    (root / "rights.txt").write_text("\n".join(rights) + "\n")

    resources = [{"name": "readme", "path": "README.md", "mediatype": "text/markdown"}]
    for row, metadata, _ in included:
        resources += [_resource(root, row, file, _licence(metadata)) for file in row["files"]]
    failed = [
        {
            "dataset_id": row["dataset_id"],
            "title": row.get("title"),
            "status": row["status"],
            "reason_code": row["reason_code"],
            "error": row["erddap_error"],
            "request_urls": row["download_url_list"],
        }
        for row, _, _ in entries
        if row["status"] not in INCLUDED
    ]
    datapackage = {
        "$schema": FRICTIONLESS_PROFILE,
        "name": f"cde-download-{user_query['job_id'].lower()}",
        "title": f"CIOOS Data Explorer download {user_query['job_id']}",
        "created": created,
        "resources": resources,
        "x-cde-query": {k: v for k, v in user_query.items() if k not in ("email",)},
        "x-cde-failed": failed,
    }
    (root / "datapackage.json").write_text(json.dumps(datapackage, indent=2, ensure_ascii=False))

    root_files = [
        "README.md",
        "datapackage.json",
        "citations.txt",
        "citations.bib",
        "citations.ris",
        "CITATION.cff",
        "rights.txt",
    ]
    crate = _ro_crate(root, user_query, entries, created, root_files)
    (root / "ro-crate-metadata.json").write_text(json.dumps(crate, indent=2, ensure_ascii=False))
