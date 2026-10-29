"""The self-describing files of a download package, all rendered from the
downloader report plus the query that produced it.

- README.md: the human summary (what's included, what isn't and why), and
  README.html, the same rendered as a standalone CIOOS-styled page.
- datapackage.json: Frictionless Data Package v2 over the data files.
- ro-crate-metadata.json: RO-Crate 1.2; one CreateAction per subset records
  the request URLs, timing and outcome, failures included.
- data/<folder>/: each subset's data, its citation.txt and, in metadata/, its
  source's own metadata records.
- citation/citations.txt/.bib/.ris, citation/licences.txt: GBIF-style citation
  and licence files for every included subset.
- reproduce.py: a uv script that installs the downloader that built the
  package from the public repository and re-fetches and re-filters every subset.

Each subset citation follows ESIP / RDA dynamic-data-citation practice: the
source's own citation, then the subset and the UTC time and URL it was
retrieved from.
"""

import base64
import html
import json
import re
from datetime import UTC, datetime
from importlib.metadata import version
from itertools import pairwise
from pathlib import Path
from string import Template
from urllib.parse import urlparse

from markdown_it import MarkdownIt

from cioos_downloader.download_erddap import COMPLETED, EMPTY, FAILED, FORMATS, IGNORED, PARTIAL
from cioos_downloader.formats import sha256

INCLUDED = (COMPLETED, PARTIAL)
SOFTWARE_URL = "https://github.com/cioos-siooc/explore-cioos"
FRICTIONLESS_PROFILE = "https://datapackage.org/profiles/2.0/datapackage.json"
RO_CRATE = "https://w3id.org/ro/crate/1.2"
README_TEMPLATE = Path(__file__).parent / "readme" / "readme.html"
README_LOGO = Path(__file__).parent / "readme" / "cioos-logo.svg"
# Titles, citations and server errors reach the README: never pass raw HTML.
_MARKDOWN = MarkdownIt("commonmark", {"html": False}).enable("table")
# The web API records the commit it was deployed from in the query; jobs
# queued before it did track the development branch.
DEFAULT_DOWNLOADER_URL = f"{SOFTWARE_URL}/archive/development-v2.tar.gz#subdirectory=downloader"

REASONS = {
    "en": {
        FAILED: "could not be retrieved from its source",
        EMPTY: "had no data matching your selection",
        IGNORED: "was skipped because the download size limit was reached",
        PARTIAL: "was cut off at the per-dataset size limit",
        "fallback": "was delivered as CSV: {format} is not available for this source",
        "polygon_box": "covers your polygon's bounding box: {format} can't be clipped to the polygon",
    },
    "fr": {
        FAILED: "n'a pas pu être récupéré depuis sa source",
        EMPTY: "ne contenait aucune donnée correspondant à votre sélection",
        IGNORED: "a été ignoré car la limite de taille de téléchargement a été atteinte",
        PARTIAL: "a été tronqué à la limite de taille par jeu de données",
        "fallback": "a été livré en CSV : {format} n'est pas disponible pour cette source",
        "polygon_box": (
            "couvre le rectangle englobant de votre polygone : {format} ne peut pas être découpé selon le polygone"
        ),
    },
}

_TEXT = {
    "en": {
        "title": "CIOOS Data Explorer download",
        "toc": "On this page:",
        "created": "Created",
        "explorer": "Open this selection in the CIOOS Data Explorer",
        "intro": (
            "The data you selected in the CIOOS Data Explorer are in `data/`: one folder per dataset with its "
            "data file, its citation and its source's metadata."
        ),
        "about": "About this package",
        "about_text": (
            "The Canadian Integrated Ocean Observing System (CIOOS) brings Canada's ocean observations together "
            "through its regional associations (CIOOS Atlantic, CIOOS Pacific and the St. Lawrence Global "
            "Observatory) and their partners. The Data Explorer searches their datasets, along with biodiversity "
            "records from the Ocean Biodiversity Information System (OBIS), on a map.\n\n"
            "When you asked for this download, each dataset was fetched directly from the server that "
            "publishes it (an ERDDAP server or OBIS), filtered to your selection, and saved here with its "
            "source's metadata, a citation and its licence. Each dataset stays under its provider's licence."
        ),
        "summary": "{n} of {m} datasets included.",
        "selection": "Your selection",
        "time": "Time",
        "depth": "Depth (m)",
        "area": "Area",
        "polygon": "polygon (WKT): {wkt}",
        "box": "latitude {lat_min} to {lat_max}, longitude {lon_min} to {lon_max}",
        "anywhere": "anywhere",
        "format": "Format",
        "obis_format": "OBIS format",
        "filters": "Other filters (as sent by the Data Explorer)",
        "data": "Data",
        "dataset": "Dataset",
        "rows": "Rows",
        "folder": "Folder",
        "catalogue": "CIOOS catalogue",
        "issues": "Not included or incomplete",
        "server": "Source response",
        "retry": "Request URL",
        "cite": "How to cite",
        "cite_text": (
            "Cite every dataset you use. The citation to copy, which also names the subset and the request it "
            "was retrieved with, is in each dataset folder's citation.txt; all of them are in "
            "citation/citations.txt, citation/citations.bib and citation/citations.ris."
        ),
        "retrieved": "Retrieved",
        "request": "Request",
        "citation_file": "Citation to copy",
        "licences_text": (
            "Each dataset keeps its own licence; check it before reusing the data (all in citation/licences.txt)."
        ),
        "licence": "Licence",
        "no_licence": "no licence recorded; check the source",
        "copy": "Copy citation",
        "copied": "Copied",
        "contents": "Files in this package",
        "contents_link": "What each file is and how to open it: [{section}](#{anchor}).",
        "documentation": "Documentation",
        "documentation_text": (
            "Each dataset folder's `metadata/` holds its source's own records (described under "
            "[{section}](#{anchor})); the other links open the dataset at its source."
        ),
        "contents_data": (
            "### Data: `data/<dataset folder>/`\n\n"
            "One folder per dataset, named after its ID and the server it came from:"
        ),
        "open": {
            "csv": (
                "`<dataset folder>.csv`: comma-separated text. It opens in any spreadsheet, or in Python with "
                "`pandas.read_csv`. Files from ERDDAP have the column names on the first row and their units on "
                "the second (skip it with `skiprows=[1]`); files from OBIS have no units row."
            ),
            "parquet": (
                "`<dataset folder>.parquet`: a compressed column table, much smaller and faster to read than "
                "CSV. Open it with `pandas.read_parquet`, DuckDB, or R's `arrow::read_parquet`; units, where the "
                "source gives them, are in the file's metadata."
            ),
            "odv": (
                "`<dataset folder>.txt`: an ODV spreadsheet, tab-separated text with `//` comment lines at the "
                "top. Open it in Ocean Data View (File > Open), or as tab-separated text in other tools."
            ),
            "nccf": (
                "`<dataset folder>.nc`: NetCDF following the CF discrete sampling geometry conventions, with "
                "every variable's attributes. Open it with `xarray.open_dataset`, Panoply or Ocean Data View. A "
                "subset fetched in several requests comes as `_part1.nc`, `_part2.nc`…"
            ),
        },
        "open_raw": (
            "Other formats are ERDDAP's own files, as the server wrote them; see "
            "<https://coastwatch.pfeg.noaa.gov/erddap/tabledap/documentation.html#fileType> for each one. A "
            "subset fetched in several requests comes as `_part1`, `_part2`…"
        ),
        "contents_dataset": (
            "- `citation.txt`: the citation of this subset, ready to paste into a reference list.\n"
            "- `metadata/`: the source's own description of the dataset, as published:\n"
            "  - `metadata.json`: what the Data Explorer shows (title, abstract, contacts, licence, keywords).\n"
            "  - `erddap.nccsvMetadata`: ERDDAP's global and variable attributes (units, long names, CF "
            "standard names), as text.\n"
            "  - `ckan_iso19115.xml` or `ckan_package.json`: the CIOOS catalogue record (ISO 19115-3), for "
            "metadata tools.\n"
            "  - `obis_dataset.json`, `eml.xml`: the OBIS record and the dataset's Ecological Metadata Language "
            "record.\n\n"
            "Each folder only has the records its source publishes."
        ),
        "contents_citation": (
            "### Citation and licences: `citation/`\n\n"
            "- `citations.txt`: every dataset's citation, one paragraph each.\n"
            "- `citations.bib`: the same in BibTeX, for LaTeX, or to import into Zotero, Mendeley or JabRef.\n"
            "- `citations.ris`: the same in RIS, to import into EndNote, Zotero or Mendeley.\n"
            "- `licences.txt`: each dataset's licence and its link; check it before sharing the data or "
            "publishing work built on it."
        ),
        "contents_package": "### About the package",
        "contents_html": "- `README.html`: this page, to open in a web browser.",
        "contents_text": (
            "- `README.md`: this page as plain text.\n"
            "- `reproduce.py`: rebuilds the data files from their sources (see "
            "[{reproduce}](#{reproduce_anchor})).\n"
            "- `datapackage.json`: a Frictionless Data Package describing each data file: checksum, columns "
            "and units, request URLs and licence. Check the files with `frictionless validate datapackage.json`, "
            "or load them with the Frictionless libraries.\n"
            "- `ro-crate-metadata.json`: RO-Crate provenance: which source each file came from, when, and with "
            "which request. Repositories and workflow tools that read RO-Crate use it."
        ),
        "reproduce": "Reproduce this download",
        "reproduce_text": (
            "You need **uv** installed on your computer: "
            "<https://docs.astral.sh/uv/getting-started/installation/>. "
            "It is the only requirement; uv fetches the right Python version, the Data Explorer's downloader at "
            "the version that built this package and the libraries it needs as they were when it was built, "
            "listed at the top of reproduce.py, in an isolated environment that leaves the rest of your system "
            "untouched.\n\n"
            "Then, in this folder, run `uv run reproduce.py`. It re-fetches every subset from its source, "
            "applies the same filter, writes the files to `reproduced/` and checks each one against its "
            "checksum in datapackage.json. Running it with plain `python` instead only works if you install "
            "the downloader yourself."
        ),
        "warnings": "Notes",
    },
    "fr": {
        "title": "Téléchargement de l'Explorateur de données du SIOOC",
        "toc": "Sur cette page :",
        "created": "Créé le",
        "explorer": "Ouvrir cette sélection dans l'Explorateur de données du SIOOC",
        "intro": (
            "Les données que vous avez sélectionnées dans l'Explorateur de données du SIOOC sont dans `data/` : "
            "un dossier par jeu de données avec son fichier de données, sa citation et les métadonnées de sa source."
        ),
        "about": "À propos de ce paquet",
        "about_text": (
            "Le Système intégré d'observation des océans du Canada (SIOOC) réunit les observations océaniques "
            "du pays grâce à ses associations régionales (SIOOC Atlantique, SIOOC Pacifique et l'Observatoire "
            "global du Saint-Laurent) et à leurs partenaires. L'Explorateur permet de chercher leurs jeux de "
            "données sur une carte, ainsi que les observations de biodiversité du Système d'information sur la "
            "biodiversité océanique (OBIS).\n\n"
            "Lors de votre demande, chaque jeu de données a été récupéré directement depuis le serveur qui le "
            "publie (un serveur ERDDAP ou OBIS), filtré selon votre sélection, puis enregistré ici avec les "
            "métadonnées de sa source, une citation et sa licence. Chaque jeu de données reste sous la licence "
            "de son fournisseur."
        ),
        "summary": "{n} jeux de données sur {m} inclus.",
        "selection": "Votre sélection",
        "time": "Temps",
        "depth": "Profondeur (m)",
        "area": "Zone",
        "polygon": "polygone (WKT) : {wkt}",
        "box": "latitude {lat_min} à {lat_max}, longitude {lon_min} à {lon_max}",
        "anywhere": "partout",
        "format": "Format",
        "obis_format": "Format OBIS",
        "filters": "Autres filtres (tels qu'envoyés par l'Explorateur)",
        "data": "Données",
        "dataset": "Jeu de données",
        "rows": "Lignes",
        "folder": "Dossier",
        "catalogue": "Catalogue SIOOC",
        "issues": "Non inclus ou incomplets",
        "server": "Réponse de la source",
        "retry": "URL de la requête",
        "cite": "Comment citer",
        "cite_text": (
            "Citez chaque jeu de données utilisé. La citation à copier, qui précise aussi le sous-ensemble et la "
            "requête qui l'a récupéré, est dans le citation.txt de chaque dossier; toutes sont dans "
            "citation/citations.txt, citation/citations.bib et citation/citations.ris."
        ),
        "retrieved": "Récupéré le",
        "request": "Requête",
        "citation_file": "Citation à copier",
        "licences_text": (
            "Chaque jeu de données conserve sa licence; vérifiez-la avant de réutiliser les données "
            "(toutes dans citation/licences.txt)."
        ),
        "licence": "Licence",
        "no_licence": "aucune licence enregistrée; consultez la source",
        "copy": "Copier la citation",
        "copied": "Copié",
        "contents": "Fichiers de ce paquet",
        "contents_link": "Le rôle de chaque fichier et comment l'ouvrir : [{section}](#{anchor}).",
        "documentation": "Documentation",
        "documentation_text": (
            "Le dossier `metadata/` de chaque jeu de données contient les fiches de sa source (décrites dans "
            "[{section}](#{anchor})); les autres liens ouvrent le jeu de données à sa source."
        ),
        "contents_data": (
            "### Données : `data/<dossier du jeu de données>/`\n\n"
            "Un dossier par jeu de données, nommé d'après son identifiant et le serveur d'où il provient :"
        ),
        "open": {
            "csv": (
                "`<dossier>.csv` : texte séparé par des virgules. Il s'ouvre dans tout tableur, ou en Python avec "
                "`pandas.read_csv`. Les fichiers d'ERDDAP ont les noms de colonnes sur la première ligne et leurs "
                "unités sur la deuxième (à ignorer avec `skiprows=[1]`); ceux d'OBIS n'ont pas de ligne d'unités."
            ),
            "parquet": (
                "`<dossier>.parquet` : une table compressée par colonnes, bien plus petite et rapide à lire qu'un "
                "CSV. Ouvrez-la avec `pandas.read_parquet`, DuckDB ou `arrow::read_parquet` en R; les unités, "
                "quand la source les donne, sont dans les métadonnées du fichier."
            ),
            "odv": (
                "`<dossier>.txt` : un tableur ODV, texte séparé par des tabulations avec des lignes de "
                "commentaires `//` en tête. Ouvrez-le dans Ocean Data View (File > Open), ou comme texte séparé "
                "par des tabulations dans d'autres outils."
            ),
            "nccf": (
                "`<dossier>.nc` : NetCDF selon les conventions CF de géométrie d'échantillonnage discrète, avec "
                "les attributs de chaque variable. Ouvrez-le avec `xarray.open_dataset`, Panoply ou Ocean Data "
                "View. Un sous-ensemble récupéré en plusieurs requêtes est livré en `_part1.nc`, `_part2.nc`…"
            ),
        },
        "open_raw": (
            "Les autres formats sont les fichiers d'ERDDAP, tels que le serveur les a écrits; voir "
            "<https://coastwatch.pfeg.noaa.gov/erddap/tabledap/documentation.html#fileType> pour chacun. Un "
            "sous-ensemble obtenu en plusieurs requêtes est livré en `_part1`, `_part2`…"
        ),
        "contents_dataset": (
            "- `citation.txt` : la citation de ce sous-ensemble, prête à coller dans une liste de références.\n"
            "- `metadata/` : la description du jeu de données publiée par sa source :\n"
            "  - `metadata.json` : ce qu'affiche l'Explorateur (titre, résumé, contacts, licence, mots-clés).\n"
            "  - `erddap.nccsvMetadata` : les attributs globaux et des variables d'ERDDAP (unités, noms longs, "
            "noms standard CF), en texte.\n"
            "  - `ckan_iso19115.xml` ou `ckan_package.json` : la fiche du catalogue SIOOC (ISO 19115-3), pour "
            "les outils de métadonnées.\n"
            "  - `obis_dataset.json`, `eml.xml` : la fiche OBIS et la fiche Ecological Metadata Language du "
            "jeu de données.\n\n"
            "Chaque dossier ne contient que les fiches que sa source publie."
        ),
        "contents_citation": (
            "### Citations et licences : `citation/`\n\n"
            "- `citations.txt` : la citation de chaque jeu de données, un paragraphe chacune.\n"
            "- `citations.bib` : les mêmes en BibTeX, pour LaTeX ou à importer dans Zotero, Mendeley ou JabRef.\n"
            "- `citations.ris` : les mêmes en RIS, à importer dans EndNote, Zotero ou Mendeley.\n"
            "- `licences.txt` : la licence de chaque jeu de données et son lien; vérifiez-la avant de partager "
            "les données ou de publier un travail qui s'en sert."
        ),
        "contents_package": "### À propos du paquet",
        "contents_html": "- `README.html` : cette page, à ouvrir dans un navigateur web.",
        "contents_text": (
            "- `README.md` : cette page en texte brut.\n"
            "- `reproduce.py` : reconstruit les fichiers de données depuis leurs sources (voir "
            "[{reproduce}](#{reproduce_anchor})).\n"
            "- `datapackage.json` : un Frictionless Data Package décrivant chaque fichier de données : somme de "
            "contrôle, colonnes et unités, URL des requêtes et licence. Vérifiez les fichiers avec "
            "`frictionless validate datapackage.json`, ou chargez-les avec les bibliothèques Frictionless.\n"
            "- `ro-crate-metadata.json` : provenance RO-Crate : la source de chaque fichier, quand et par quelle "
            "requête il a été récupéré. Les dépôts et outils de flux de travail qui lisent RO-Crate s'en servent."
        ),
        "reproduce": "Reproduire ce téléchargement",
        "reproduce_text": (
            "Il faut que **uv** soit installé sur votre ordinateur : "
            "<https://docs.astral.sh/uv/getting-started/installation/>. "
            "C'est le seul prérequis; uv récupère la bonne version de Python, le téléchargeur de l'Explorateur "
            "dans la version qui a construit ce paquet et les bibliothèques dont il a besoin telles qu'elles "
            "étaient à ce moment, indiqués en tête de reproduce.py, dans un environnement isolé qui ne modifie "
            "pas le reste de votre système.\n\n"
            "Ensuite, dans ce dossier, lancez `uv run reproduce.py`. Le script récupère de nouveau chaque "
            "sous-ensemble depuis sa source, applique le même filtre, écrit les fichiers dans `reproduced/` et "
            "vérifie chacun avec sa somme de contrôle dans datapackage.json. Avec `python` seul, il faut "
            "installer le téléchargeur vous-même."
        ),
        "warnings": "Remarques",
    },
}


def _lang(user_query):
    return "fr" if user_query.get("language") == "fr" else "en"


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
        # Harvested citations can carry HTML entities and ragged whitespace.
        own = " ".join(html.unescape(own).split())
        return own if own.endswith((".", "!", "?")) else own + "."
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


def _licence(metadata):
    licence = dict(metadata.get("license") or {})
    if licence.get("title"):
        licence["title"] = " ".join(html.unescape(licence["title"]).split())
    return licence if licence.get("title") or licence.get("url") else None


def _readme_licence(licence, t):
    if not licence:
        return f"*{t['no_licence']}*"
    title, url = licence.get("title"), licence.get("url")
    if title and url:
        return f"[{_cell(title)}](<{_md_url(url)}>)"
    return f"<{_md_url(url)}>" if url else _cell(title)


def _cell(text):
    return text.replace("|", "\\|")


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
    if file["columns"] and row["format"] != "nccf":
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
    if row.get("polygon_box_only") and row["files"]:
        notes.append(reasons["polygon_box"].format(format=FORMATS[row["format"]].label))
    return notes


def _source_links(row, metadata, t):
    links = [("OBIS" if row["source_type"] == "obis" else "ERDDAP", landing_url(row))]
    if row.get("ckan_url"):
        links.append((t["catalogue"], row["ckan_url"]))
    if metadata.get("doi"):
        links.append(("DOI", metadata["doi"]))
    return links


def _md_url(url):
    """A URL safe inside a Markdown <…> link: ERDDAP constraints carry raw '>'."""
    return url.replace("<", "%3C").replace(">", "%3E").replace(" ", "%20")


# A URL up to, not including, the punctuation that ends its sentence.
_URL = re.compile(r"https?://[^\s<>]+?(?=[.,;:)]?(?:\s|$))")


def _readme_citation(row, metadata, lang, t):
    lines = ["", f"### {_title(row, lang)}", "", "> " + _URL.sub(r"<\g<0>>", source_citation(row, metadata, lang)), ""]
    retrieved = datetime.fromisoformat(row["finished_at"]).astimezone(UTC).strftime("%Y-%m-%d %H:%M UTC")
    lines.append(f"- {t['retrieved']}: {retrieved}")
    urls = row["download_url_list"]
    if urls:
        # The request URL can run to thousands of characters: link it, don't print it.
        labels = [urlparse(urls[0]).netloc] if len(urls) == 1 else [str(i) for i in range(1, len(urls) + 1)]
        links = [f"[{label}](<{_md_url(url)}>)" for label, url in zip(labels, urls, strict=True)]
        lines.append(f"- {t['request']}: " + " · ".join(links))
    path = f"data/{row['folder']}/citation.txt"
    lines.append(f"- {t['citation_file']}: [`{path}`]({path})")
    return lines


def _readme_contents(included, t):
    formats = {row["format"] for row, _, _ in included}
    lines = [t["contents_data"], ""]
    lines += [f"- {t['open'][key]}" for key in FORMATS if key in formats and key in t["open"]]
    if formats - t["open"].keys():
        lines.append(f"- {t['open_raw']}")
    lines += [t["contents_dataset"], "", t["contents_citation"], "", t["contents_package"], ""]
    lines.append(t["contents_html"])
    lines.append(t["contents_text"].format(reproduce=t["reproduce"], reproduce_anchor=_slug(t["reproduce"])))
    return lines


def _readme(user_query, entries, created, lang):
    t = _TEXT[lang]
    included = [e for e in entries if e[0]["status"] in INCLUDED]
    contents = {"section": t["contents"], "anchor": _slug(t["contents"])}
    # Jobs queued before web-api recorded the explorer URL have none.
    explorer = user_query.get("explorer_url")
    lines = [
        f"# {t['title']} {user_query['job_id']}",
        "",
        f"{t['created']}: {created}",
        "",
        *([f"[{t['explorer']}](<{_md_url(explorer)}>)", ""] if explorer else []),
        f"**{t['summary'].format(n=len(included), m=len(entries))}** {t['intro']}",
        "",
        f"## {t['data']}",
        "",
    ]
    if included:
        lines += [
            f"| {t['dataset']} | {t['rows']} | {t['folder']} | {t['licence']} |",
            "|---|---|---|---|",
        ]
        for row, metadata, lng in included:
            folder = f"[`data/{row['folder']}/`](data/{row['folder']}/)"
            licence = _readme_licence(_licence(metadata), t)
            rows = "—" if row["n_records"] is None else row["n_records"]
            lines.append(f"| {_cell(_title(row, lng))} | {rows} | {folder} | {licence} |")
        lines += ["", t["licences_text"], "", t["contents_link"].format(**contents)]

    issues = [(row, _outcome(row, lang)) for row, _, _ in entries if _outcome(row, lang) or row["warnings"]]
    if issues:
        lines += ["", f"## {t['issues']}", ""]
        for row, notes in issues:
            lines.append(f"- **{row.get('title') or row['dataset_id']}** (`{row['dataset_id']}`)")
            lines += [f"  - {n}." for n in notes]
            if row["erddap_error"]:
                lines.append(f"  - {t['server']}: {row['erddap_error'].replace(chr(10), '; ')}")
            if row["status"] not in INCLUDED or row["status"] == PARTIAL:
                lines += [f"  - {t['retry']}: <{_md_url(url)}>" for url in row["download_url_list"]]
            lines += [f"  - {t['warnings']}: {w}" for w in row["warnings"]]

    lines += ["", f"## {t['contents']}", "", *_readme_contents(included, t)]
    lines += ["", f"## {t['selection']}", ""]
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
    if user_query.get("obis_format"):
        lines.append(f"- {t['obis_format']}: {FORMATS[user_query['obis_format']].label}")
    filters = user_query.get("filters") or {}
    if filters:
        lines.append(f"- {t['filters']}:")
        lines += [f"  - `{k}`: {v}" for k, v in sorted(filters.items())]

    if included:
        lines += ["", f"## {t['cite']}", "", t["cite_text"]]
        for row, metadata, lng in included:
            lines += _readme_citation(row, metadata, lng, t)
        lines += ["", f"## {t['documentation']}", "", t["documentation_text"].format(**contents), ""]
        for row, metadata, lng in included:
            records = f"[`metadata/`](data/{row['folder']}/metadata/)"
            sources = " · ".join(f"[{label}](<{_md_url(url)}>)" for label, url in _source_links(row, metadata, t))
            lines.append(f"- **{_title(row, lng)}**: {records} · {sources}")
    lines += ["", f"## {t['reproduce']}", "", t["reproduce_text"]]
    lines += ["", f"## {t['about']}", "", t["about_text"], ""]

    sections = [line.removeprefix("## ") for line in lines if line.startswith("## ")]
    toc = [t["toc"], "", *[f"- [{s}](#{_slug(s)})" for s in sections], ""]
    first_section = lines.index(f"## {t['data']}")
    return "\n".join(lines[:first_section] + toc + lines[first_section:])


def _slug(heading):
    """GitHub's heading anchor, so the README's links also work on GitHub."""
    return re.sub(r"[^\w\- ]", "", heading.lower()).replace(" ", "-")


# description, encodingFormat for every non-data file the package can hold.
_FILE_KINDS = {
    "README.md": ("Summary of this download: what is included, what is not and why", "text/markdown"),
    "README.html": ("The README as a web page", "text/html"),
    "datapackage.json": ("Frictionless Data Package v2 descriptor of the data files", "application/json"),
    "citations.txt": ("A citation for each included dataset subset", "text/plain"),
    "citations.bib": ("The citations in BibTeX", "application/x-bibtex"),
    "citations.ris": ("The citations in RIS", "application/x-research-info-systems"),
    "licences.txt": ("The licence of each included dataset", "text/plain"),
    "citation.txt": ("Citation for this dataset subset", "text/plain"),
    "metadata.json": ("The dataset's metadata as shown in the CIOOS Data Explorer", "application/json"),
    "erddap.nccsvMetadata": ("The dataset's ERDDAP global and variable attributes (NCCSV)", "text/csv"),
    "ckan_iso19115.xml": ("The dataset's ISO 19115-3 record from the CIOOS catalogue", "application/xml"),
    "ckan_package.json": ("The dataset's CIOOS catalogue (CKAN) record", "application/json"),
    "obis_dataset.json": ("The dataset's OBIS record", "application/json"),
    "eml.xml": ("The dataset's Ecological Metadata Language record from its IPT", "application/xml"),
    "reproduce.py": ("uv script that re-fetches and re-filters every subset of this package", "text/x-python"),
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
            "version": version("cioos-data-explorer-downloader"),
            "url": SOFTWARE_URL,
        },
        {"@id": "https://cioos.ca", "@type": "Organization", "name": "CIOOS"},
        {
            "@id": "#mixed-licences",
            "@type": "CreativeWork",
            "name": "Each dataset keeps its own licence",
            "description": "See citation/licences.txt and each dataset folder's license.",
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
        folder_id = f"data/{row['folder']}/"
        files = sorted(p for p in (root / folder_id).rglob("*") if p.is_file())
        file_ids = [folder_id + p.relative_to(root / folder_id).as_posix() for p in files]
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
            "@id": folder_id,
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
        has_part.append({"@id": folder_id})
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
        graph.append(_file_entity(name, Path(name).name, (root / name).stat().st_size, (), {}))
    return {"@context": f"{RO_CRATE}/context", "@graph": graph}


def _render_readme(markdown, toc_label):
    """(table of contents, body) as HTML: the page shows the table of contents
    beside the body, and section headings get the ids it links to."""
    tokens = _MARKDOWN.parse(markdown)
    for opening, inline in pairwise(tokens):
        if opening.type == "heading_open" and opening.tag == "h2":
            opening.attrSet("id", _slug(inline.content))
    start = next(i for i, token in enumerate(tokens) if token.content == toc_label) - 1
    end = next(i for i in range(start, len(tokens)) if tokens[i].type == "bullet_list_close") + 1
    tokens[start].attrSet("class", "toc-label")
    toc = _MARKDOWN.renderer.render(tokens[start:end], _MARKDOWN.options, {})
    body = _MARKDOWN.renderer.render(tokens[:start] + tokens[end:], _MARKDOWN.options, {})
    # A frame that scrolls a wide table sideways. Raw HTML is off, so every
    # <table> here comes from a Markdown table.
    return toc, body.replace("<table>", '<div class="table">\n<table>').replace("</table>", "</table>\n</div>")


def _readme_html(markdown, user_query, lang, citations):
    """``citations`` maps each dataset folder to the text its copy button copies."""
    t = _TEXT[lang]
    toc, body = _render_readme(markdown, t["toc"])
    return Template(README_TEMPLATE.read_text()).substitute(
        lang=lang,
        title=f"{t['title']} {user_query['job_id']}",
        logo=base64.b64encode(README_LOGO.read_bytes()).decode(),
        toc=toc,
        toc_label=t["toc"].rstrip(" :"),
        body=body,
        # Escaped so citation text can't end the <script> element.
        citations=json.dumps(citations, ensure_ascii=False).replace("<", "\\u003c"),
        copy=t["copy"],
        copied=t["copied"],
    )


def _reproduce_script(user_query, created):
    url = user_query.get("downloader_url") or DEFAULT_DOWNLOADER_URL
    return "\n".join(
        [
            "# /// script",
            '# requires-python = "==3.13.*"',
            f'# dependencies = ["cioos-data-explorer-downloader @ {url}"]',
            "# [tool.uv]",
            # Resolves the libraries as they were when the package was built.
            f'# exclude-newer = "{created}"',
            "# ///",
            '"""Rebuild this download\'s data files from their sources.',
            "",
            "Run `uv run reproduce.py` in this folder (https://docs.astral.sh/uv/). It",
            "re-fetches every dataset from the request URLs recorded in datapackage.json,",
            "applies the same polygon filter, writes the files to reproduced/ and checks",
            "each one against the checksum of the file you received.",
            '"""',
            "",
            "import sys",
            "from pathlib import Path",
            "",
            "from cioos_downloader.formats import reproduce",
            "",
            'if __name__ == "__main__":',
            "    sys.exit(reproduce(Path(__file__).resolve().parent))",
            "",
        ]
    )


def write_package(root: Path, json_query, report):
    """Write the package files into ``root`` (the folder that gets zipped)."""
    user_query = json_query["user_query"]
    lang = _lang(user_query)
    created = datetime.now(UTC).isoformat(timespec="seconds")

    entries = []
    for dataset, row in zip(json_query["cache_filtered"], report["erddap_report"], strict=True):
        metadata = dataset.get("metadata") or {}
        row["title_fr"] = dataset.get("title_fr")
        row["ckan_url"] = dataset.get("ckan_url")
        folder = root / "data" / row["folder"]
        if metadata:
            (folder / "metadata" / "metadata.json").write_text(json.dumps(metadata, indent=2, ensure_ascii=False))
        for file in row["files"]:
            file["sha256"] = sha256(root / file["path"])
        if row["status"] in INCLUDED:
            (folder / "citation.txt").write_text(citation(row, metadata, user_query, lang) + "\n")
        entries.append((row, metadata, lang))
    included = [e for e in entries if e[0]["status"] in INCLUDED]

    readme = _readme(user_query, entries, created, lang)
    (root / "README.md").write_text(readme)
    citations = {f"data/{row['folder']}": citation(row, metadata, user_query, lg) for row, metadata, lg in included}
    (root / "README.html").write_text(_readme_html(readme, user_query, lang, citations))
    cite = root / "citation"
    cite.mkdir(exist_ok=True)
    (cite / "citations.txt").write_text("\n\n".join(citation(r, m, user_query, lg) for r, m, lg in included) + "\n")
    (cite / "citations.bib").write_text("\n\n".join(_bibtex(*e[:2], user_query, e[2]) for e in included) + "\n")
    (cite / "citations.ris").write_text("\n\n".join(_ris(*e[:2], user_query, e[2]) for e in included) + "\n")
    licences = []
    for row, metadata, _ in included:
        licence = _licence(metadata) or {}
        licences.append(
            f"{row.get('title') or row['dataset_id']} ({landing_url(row)}): "
            + (" ".join(filter(None, [licence.get("title"), licence.get("url")])) or "no licence recorded")
        )
    (cite / "licences.txt").write_text("\n".join(licences) + "\n")

    resources = [
        {"name": "readme", "path": "README.md", "mediatype": "text/markdown"},
        {"name": "readme-html", "path": "README.html", "mediatype": "text/html"},
    ]
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
        "x-cde-subsets": [
            {
                "dataset_id": row["dataset_id"],
                "folder": row["folder"],
                "source_type": row["source_type"],
                "format": row["format"],
                "status": row["status"],
                "request_urls": row["download_url_list"],
            }
            for row, _, _ in included
        ],
    }
    (root / "datapackage.json").write_text(json.dumps(datapackage, indent=2, ensure_ascii=False))
    (root / "reproduce.py").write_text(_reproduce_script(user_query, created))

    root_files = [
        "README.md",
        "README.html",
        "datapackage.json",
        "citation/citations.txt",
        "citation/citations.bib",
        "citation/citations.ris",
        "citation/licences.txt",
        "reproduce.py",
    ]
    crate = _ro_crate(root, user_query, entries, created, root_files)
    (root / "ro-crate-metadata.json").write_text(json.dumps(crate, indent=2, ensure_ascii=False))
