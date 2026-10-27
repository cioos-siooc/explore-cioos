"""OBIS occurrences as Darwin Core: the term URIs of the occurrence core and
the OBIS extensions, the archive's meta.xml, and the archive itself.

darwin_core_terms.json is Simple Darwin Core plus the GBIF registry's
ExtendedMeasurementOrFact and DNADerivedData extensions; a column without a
term there stays in the CSV/Parquet tables but is left out of the archive.
"""

import json
import shutil
import zipfile
from pathlib import Path
from xml.sax.saxutils import quoteattr

_TERMS = json.loads((Path(__file__).parent / "darwin_core_terms.json").read_text())
OCCURRENCE = "http://rs.tdwg.org/dwc/terms/Occurrence"
OCCURRENCE_TERMS = _TERMS["occurrence"]
# Row type: (file name stem, {column: term URI}).
EXTENSIONS = {
    "http://rs.iobis.org/obis/terms/ExtendedMeasurementOrFact": (
        "extendedmeasurementorfact",
        _TERMS["http://rs.iobis.org/obis/terms/ExtendedMeasurementOrFact"],
    ),
    "http://rs.gbif.org/terms/1.0/DNADerivedData": (
        "dnaderiveddata",
        _TERMS["http://rs.gbif.org/terms/1.0/DNADerivedData"],
    ),
}
# A fixed timestamp keeps the archive's bytes, and so its checksum, reproducible.
_ZIP_DATE = (1980, 1, 1, 0, 0, 0)


def _table(tag, row_type, location, id_tag, columns, terms):
    fields = [
        f'    <field index="{i}" term={quoteattr(terms[name])}/>' for i, name in enumerate(columns) if name in terms
    ]
    return [
        f'  <{tag} encoding="UTF-8" fieldsTerminatedBy="\\t" linesTerminatedBy="\\n" fieldsEnclosedBy=\'"\' '
        f'ignoreHeaderLines="1" rowType={quoteattr(row_type)}>',
        f"    <files><location>{location}</location></files>",
        f'    <{id_tag} index="0"/>',
        *fields,
        f"  </{tag}>",
    ]


def meta_xml(core_columns, extensions, eml):
    """``extensions`` is [(row type, columns)]; column 0 of every table is the
    occurrence's id."""
    metadata = ' metadata="eml.xml"' if eml else ""
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<archive xmlns="http://rs.tdwg.org/dwc/text/"{metadata}>',
        *_table("core", OCCURRENCE, "occurrence.txt", "id", core_columns, OCCURRENCE_TERMS),
    ]
    for row_type, columns in extensions:
        stem, terms = EXTENSIONS[row_type]
        lines += _table("extension", row_type, f"{stem}.txt", "coreid", columns, terms)
    return "\n".join([*lines, "</archive>", ""])


def write_archive(path: Path, files, meta, eml: Path | None):
    """Zip ``files`` ({name in the archive: path}), meta.xml and eml.xml."""
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(zipfile.ZipInfo("meta.xml", _ZIP_DATE), meta, zipfile.ZIP_DEFLATED)
        if eml:
            files = {"eml.xml": eml, **files}
        for name, source in files.items():
            info = zipfile.ZipInfo(name, _ZIP_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            with open(source, "rb") as src, archive.open(info, "w") as dst:
                shutil.copyfileobj(src, dst)
