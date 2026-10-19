"""The dataset page's metadata: each source normalized, then merged CKAN-first."""

import json

from cde_harvester.core.record_metadata import (
    from_cioos_record,
    from_ckan,
    from_erddap_globals,
    merge,
)


def _csl(**fields):
    # CKAN serializes the CSL list with its quotes backslash-escaped.
    return json.dumps([{"type": "dataset", **fields}]).replace('"', '\\"')


# Trimmed from a catalogue.cioos.ca package_show record.
CKAN_PACKAGE = {
    "notes": "Résumé",
    "notes_translated": {"en": "Abstract", "fr": "Résumé"},
    "citation": {
        "en": _csl(
            author=[{"given": "Laísa", "family": "Peixoto Ramos"}, {"literal": "ONC"}],
            issued=[{"date-parts": ["2026", "09", "24"]}],
            title="Groundwater flow",
            publisher="",
            DOI="10.26071/d27287f7",
        ),
    },
    "unique-resource-identifier-full": [{"code": "https://doi.org/10.26071/d27287f7"}],
    "license_title": "None",
    "license_url": None,
    "cited-responsible-party": [
        {
            "individual-name": "Peixoto Ramos, Laísa",
            "organisation-name": "ISMER",
            "contact-info_email": "",
            "individual-uri_code": "https://orcid.org/0000-0001-5782-0876",
            "role": ["author", "owner"],
        },
        {"individual-name": "Chaillou, G", "role": "coAuthor"},
        {"individual-name": "", "organisation-name": "", "role": ["custodian"]},
    ],
    "distributor": [{"organisation-name": "ISMER Data Office"}],
    "keywords": {"en": ["oceans", "Oceans", "ctd"], "fr": []},
    "dataset-reference-date": [{"type": "creation", "value": "2023-02-21"}],
    "temporal-extent": [{"begin": "2023-02-21", "end": "2023-10-27"}],
    "vertical-extent": [{"min": "0.0", "max": "nan"}],
    "progress": "completed",
    "frequency-of-update": "asNeeded",
    "projects": [],
    "resources": [
        {
            "name": "ERDDAP",
            "name_translated": {"en": "ERDDAP", "fr": "ERDDAP (fr)"},
            "description": "Data access",
            "url": "https://erddap.example/tabledap/x.html",
            "format": "ERDDAP",
        },
        {"name": "Same link again", "url": "https://erddap.example/tabledap/x.html"},
        {"name": "No link", "url": ""},
    ],
    "harvest_document_content": "<mdb:MD_Metadata/>",
}


def test_ckan_record_normalized():
    assert from_ckan(CKAN_PACKAGE) == {
        "abstract": {"en": "Abstract", "fr": "Résumé"},
        "citation": {
            "en": "Peixoto Ramos, Laísa; ONC (2026). Groundwater flow. "
            "https://doi.org/10.26071/d27287f7",
        },
        "doi": "https://doi.org/10.26071/d27287f7",
        "contacts": [
            {
                "name": "Peixoto Ramos, Laísa",
                "organization": "ISMER",
                "url": "https://orcid.org/0000-0001-5782-0876",
                "roles": ["author", "owner"],
                "cited": True,
            },
            {"name": "Chaillou, G", "roles": ["coAuthor"], "cited": True},
            {"organization": "ISMER Data Office", "roles": ["distributor"], "cited": False},
        ],
        "keywords": {"en": ["oceans", "ctd"]},
        "dates": {"created": "2023-02-21"},
        "temporal_extent": {"begin": "2023-02-21", "end": "2023-10-27"},
        "vertical_extent": {"min": 0.0},
        "progress": "completed",
        "update_frequency": "asNeeded",
        "resources": [
            {
                "name": {"en": "ERDDAP", "fr": "ERDDAP (fr)"},
                "description": {"en": "Data access"},
                "url": "https://erddap.example/tabledap/x.html",
                "format": "ERDDAP",
            },
        ],
    }


def test_unparseable_ckan_citation_is_dropped():
    assert "citation" not in from_ckan({"citation": {"en": "not json"}})


def test_converted_obis_record_keeps_english_only():
    record = {
        "abstract": {"en": "An abstract", "fr": "Traduction française actuellement indisponible"},
        "datasetIdentifier": "10.1234/abc",
        "license": "This work is licensed under CC-BY 4.0",
        "contacts": [
            {"indName": "Ashley Burton", "orgName": "DFO", "indEmail": "a@dfo", "role": ["author"],
             "inCitation": True},
            {"indName": "", "orgName": ""},
        ],
        "keywords": {"en": ["Samplingevent"], "fr": ["Samplingevent"]},
        "datePublished": "2022-03-23T18:27:19Z",
        "dateStart": "",
        "distribution": [
            {"url": "https://ipt.example/archive.do?r=x",
             "name": {"en": "Darwin Core Archive", "fr": "Traduction française actuellement indisponible"}},
        ],
    }
    assert from_cioos_record(record, citation="Burton A (2021): Herring.") == {
        "abstract": {"en": "An abstract"},
        "citation": {"en": "Burton A (2021): Herring."},
        "doi": "https://doi.org/10.1234/abc",
        "license": {"title": "This work is licensed under CC-BY 4.0"},
        "contacts": [
            {"name": "Ashley Burton", "organization": "DFO", "email": "a@dfo", "roles": ["author"],
             "cited": True},
        ],
        "keywords": {"en": ["Samplingevent"]},
        "dates": {"published": "2022-03-23T18:27:19Z"},
        "resources": [
            {"name": {"en": "Darwin Core Archive"}, "url": "https://ipt.example/archive.do?r=x"},
        ],
    }


def test_erddap_globals_normalized():
    globals_ = {
        "summary": "Summary",
        "summary_fr": "Sommaire",
        "license": "https://creativecommons.org/licenses/by/4.0/",
        "creator_name": "Hakai Institute",
        "creator_email": "data@hakai.org",
        "contributor_name": "Ann, Bob",
        "contributor_role": "editor,pointOfContact",
        "keywords": "temperature, salinity,Temperature",
        "date_created": "2020-01-01",
        "time_coverage_start": "2019-01-01T00:00:00Z",
        "geospatial_vertical_max": "250",
        "project": "Juvenile Salmon, Oceanography",
        "history": "created by script",
        "infoUrl": "https://hakai.org",
        "references": "https://doi.org/10.1/x not-a-url",
    }
    assert from_erddap_globals(globals_) == {
        "abstract": {"en": "Summary", "fr": "Sommaire"},
        "license": {"url": "https://creativecommons.org/licenses/by/4.0/"},
        "contacts": [
            {"name": "Hakai Institute", "email": "data@hakai.org", "roles": ["author"], "cited": True},
            {"name": "Ann", "roles": ["editor"], "cited": False},
            {"name": "Bob", "roles": ["pointOfContact"], "cited": False},
        ],
        "keywords": {"en": ["temperature", "salinity"]},
        "dates": {"created": "2020-01-01"},
        "temporal_extent": {"begin": "2019-01-01T00:00:00Z"},
        "vertical_extent": {"max": 250.0},
        "projects": ["Juvenile Salmon", "Oceanography"],
        "lineage": "created by script",
        "resources": [
            {"name": {"en": "infoUrl"}, "url": "https://hakai.org"},
            {"url": "https://doi.org/10.1/x"},
        ],
    }


def test_mismatched_contributor_lists_stay_one_contact():
    contacts = from_erddap_globals(
        {"contributor_name": "Smith, Jane", "contributor_role": "editor"}
    )["contacts"]
    assert contacts == [{"name": "Smith, Jane", "roles": ["editor"], "cited": False}]


def test_merge_first_source_wins_and_dicts_merge_one_level():
    ckan = {"abstract": {"en": "CKAN"}, "contacts": [{"name": "A"}]}
    erddap = {"abstract": {"en": "ERDDAP", "fr": "FR"}, "contacts": [{"name": "B"}], "lineage": "L"}
    assert merge(ckan, None, erddap) == {
        "abstract": {"en": "CKAN", "fr": "FR"},
        "contacts": [{"name": "A"}],
        "lineage": "L",
    }


def test_erddap_escapes_decoded():
    metadata = from_erddap_globals(
        {"summary": "Para one.\\nPara two.", "creator_name": "La\\u00edsa Peixoto Ramos"}
    )
    assert metadata["abstract"] == {"en": "Para one.\nPara two."}
    assert metadata["contacts"] == [{"name": "Laísa Peixoto Ramos", "roles": ["author"], "cited": True}]


def test_cioos_semicolon_contributors_and_repeated_contact_merged():
    contacts = from_erddap_globals({
        "creator_name": "Hakai Institute",
        "creator_email": "data@hakai.org",
        "publisher_name": "Hakai Institute",
        "publisher_email": "data@hakai.org",
        "contributor_name": "Hare, Alex;Tula Foundation",
        "contributor_role": "processor,custodian;funder",
    })["contacts"]
    assert contacts == [
        {"name": "Hakai Institute", "email": "data@hakai.org", "roles": ["author", "publisher"],
         "cited": True},
        {"name": "Hare, Alex", "roles": ["processor", "custodian"], "cited": False},
        {"name": "Tula Foundation", "roles": ["funder"], "cited": False},
    ]


def test_abstract_html_becomes_markdown():
    record = {"abstract": {"en": (
        "<p>Objective: larvae &amp; scallops</p><p>See:<ul><li>one</li><li>two</li></ul>"
        "<https://example.org> **kept**</p>"
    )}}
    assert from_cioos_record(record)["abstract"] == {
        "en": "Objective: larvae & scallops\n\nSee:\n- one\n- two\n\n<https://example.org> **kept**",
    }


def test_abstract_html_source_indentation_is_not_a_code_block():
    record = {"abstract": {"en": "\n    <p>First.\n    More.</p>\n    <p>Second.</p>\n  "}}
    assert from_cioos_record(record)["abstract"] == {"en": "First.\nMore.\n\nSecond."}


def test_keywords_are_unescaped():
    record = {"keywords": {"en": ["EARTH SCIENCE &gt; ANIMALS/VERTEBRATES &gt; FISH"]}}
    assert from_cioos_record(record)["keywords"] == {
        "en": ["EARTH SCIENCE > ANIMALS/VERTEBRATES > FISH"],
    }
