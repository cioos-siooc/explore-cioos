/*
 * Direct download links.
 *
 * The CDE's own download is a queue: pick datasets, leave an address, wait for
 * a zip. That is the right answer for a large multi-dataset order, and the
 * wrong one for "I want this dataset, now, as CSV" — and it refuses outright
 * above 1 GB per dataset, which is exactly where a scripted download is most
 * wanted. This module builds the other answer: the URL that fetches a dataset
 * straight from the server that publishes it.
 *
 * The links carry the map's filters, because the selection they were built
 * from is a filtered one. Two things about that are worth knowing before
 * reading further:
 *
 *  - ERDDAP constrains by bounding box, not by polygon. A drawn polygon is
 *    reduced to its bounds here, so an ERDDAP link over a non-rectangular
 *    selection returns a superset of what the map showed. OBIS takes WKT and
 *    gets the polygon itself.
 *  - tabledap rejects a constraint on a variable the dataset does not declare
 *    ("Unrecognized constraint variable"), so the depth constraint is only
 *    emitted for datasets whose `has_depth` says they have one. Datasets that
 *    express depth as z or pressure get a link without it rather than a link
 *    that 400s.
 *
 * The ERDDAP query is deliberately variable-less (`.csv?&time>=…` rather than
 * `.csv?time,latitude,…&time>=…`), which returns every variable in the
 * dataset. The CDE's own downloader picks a variable subset instead
 * (downloader/erddap_downloader/download_erddap.py) because it is assembling a
 * uniform archive; a user following a link to the source wants the source.
 */

import {
  boundsFromGeoJson,
  erddapServerSlug,
  polygonToWkt,
} from "./utilities.jsx";

/*
 * tabledap response types offered for a direct link. ERDDAP serves a few dozen
 * (`/tabledap/documentation.html`); these are the ones a person downloading
 * data actually asks for, and every one of them is a file rather than a
 * viewer. `id` is ERDDAP's own file-type name and doubles as the URL
 * extension; `ext` is what the saved file should be called, which differs
 * wherever ERDDAP names a type after its shape rather than its format.
 *
 * Names are format names — CSV, netCDF, Parquet — so they are not translated.
 */
export const ERDDAP_FORMATS = [
  { id: "csv", ext: "csv", label: "CSV" },
  { id: "tsv", ext: "tsv", label: "TSV" },
  { id: "json", ext: "json", label: "JSON" },
  { id: "nc", ext: "nc", label: "netCDF" },
  { id: "ncCF", ext: "nc", label: "netCDF-CF" },
  { id: "odvTxt", ext: "txt", label: "ODV" },
  { id: "parquet", ext: "parquet", label: "Parquet" },
];

/*
 * OBIS publishes occurrences two ways, and they trade completeness against
 * filtering rather than differing only in encoding — so this is a real choice,
 * not a format dropdown, and each option says what it costs.
 *
 *  - The v3 API applies every filter the map has (including the drawn polygon,
 *    as WKT) but serves at most 10 000 records per request. Beyond that the
 *    response is a page, not the dataset.
 *  - The open-data snapshot is the whole dataset as one Parquet file, with no
 *    filtering at all. Same object the harvester reads.
 */
export const OBIS_RECORD_CAP = 10000;

export const OBIS_FORMATS = [
  {
    id: "obisJson",
    ext: "json",
    label: "JSON",
    filtered: true,
    noteKey: "directLinksObisApiNote",
  },
  {
    id: "obisParquet",
    ext: "parquet",
    label: "Parquet",
    filtered: false,
    noteKey: "directLinksObisSnapshotNote",
  },
];

export const defaultErddapFormat = ERDDAP_FORMATS[0].id;
export const defaultObisFormat = OBIS_FORMATS[0].id;

/*
 * Which of the map's filters the links carry, resolved once for the whole set.
 *
 * The three `by*` flags are the download panel's existing "apply this filter to
 * my download" checkboxes (state/download/DownloadProvider.jsx): the same
 * switches that decide what the queued zip contains decide what the links
 * contain, so the two delivery routes can never disagree about the order.
 *
 * Returns undefined for every filter that is switched off, which is what the
 * builders below test.
 */
export function downloadConstraints({
  query,
  polygon,
  byTime,
  byDepth,
  byPolygon,
}) {
  const bounds =
    byPolygon && polygon?.length
      ? boundsFromGeoJson({ coordinates: polygon })
      : null;

  return {
    startDate: byTime ? query?.startDate : undefined,
    endDate: byTime ? query?.endDate : undefined,
    startDepth: byDepth ? query?.startDepth : undefined,
    endDepth: byDepth ? query?.endDepth : undefined,
    polygon: bounds ? polygon : undefined,
    bounds,
  };
}

// ERDDAP wants an instant. The start of the first day and the END of the last
// one, so a range the user reads as "these dates" includes data recorded on
// the closing date — a midnight-to-midnight reading silently drops it.
const dayStart = (date) => `${date}T00:00:00Z`;
const dayEnd = (date) => `${date}T23:59:59Z`;

// tabledap's operators have to survive the query string: `>` and `<` are legal
// in a URL but ERDDAP's own examples percent-encode them, and a bare `>` is
// mangled by enough intermediaries (mail clients, chat, spreadsheet cells)
// that a link pasted out of this UI should not depend on it.
const constrain = (variable, operator, value) =>
  `${variable}${encodeURIComponent(operator)}=${encodeURIComponent(value)}`;

/*
 * The tabledap URL for one dataset.
 *
 * Every constraint must be preceded by `&`, including the first — with no
 * variable list in front of it the query opens `?&`, which looks like a typo
 * and is not: `?time>=…` is a 400 ("All constraints … must be preceded by
 * '&'").
 */
export function erddapDownloadUrl(row, formatId, constraints = {}) {
  const server = erddapServerBase(row);
  if (!server || !row?.dataset_id) return null;

  const parts = [];
  if (constraints.startDate) {
    parts.push(constrain("time", ">", dayStart(constraints.startDate)));
  }
  if (constraints.endDate) {
    parts.push(constrain("time", "<", dayEnd(constraints.endDate)));
  }
  // Only where the dataset declares the variable — see the header.
  if (row.has_depth) {
    if (constraints.startDepth != null) {
      parts.push(constrain("depth", ">", constraints.startDepth));
    }
    if (constraints.endDepth != null) {
      parts.push(constrain("depth", "<", constraints.endDepth));
    }
  }
  if (constraints.bounds) {
    const [[west, south], [east, north]] = constraints.bounds;
    parts.push(
      constrain("latitude", ">", south),
      constrain("latitude", "<", north),
      constrain("longitude", ">", west),
      constrain("longitude", "<", east),
    );
  }

  return `${server}/tabledap/${row.dataset_id}.${formatId}?${parts
    .map((part) => `&${part}`)
    .join("")}`;
}

/*
 * The OBIS URL for one dataset: either a filtered API query or the unfiltered
 * snapshot, per the chosen option.
 *
 * `size` is pinned to the API's own maximum rather than left at its default of
 * 10 — a link that quietly returns ten records would look like a dataset with
 * ten records.
 */
export function obisDownloadUrl(row, formatId, constraints = {}) {
  if (!row?.dataset_id) return null;
  if (formatId === "obisParquet") {
    return `https://obis-open-data.s3.amazonaws.com/occurrence/${row.dataset_id}.parquet`;
  }

  const params = new URLSearchParams({ datasetid: row.dataset_id });
  if (constraints.startDate) params.set("startdate", constraints.startDate);
  if (constraints.endDate) params.set("enddate", constraints.endDate);
  if (constraints.startDepth != null) {
    params.set("startdepth", constraints.startDepth);
  }
  if (constraints.endDepth != null) {
    params.set("enddepth", constraints.endDepth);
  }
  // OBIS takes the drawn shape itself, so an occurrence link over a polygon is
  // exactly the selection rather than its bounding box.
  if (constraints.polygon) {
    params.set("geometry", polygonToWkt(constraints.polygon));
  }
  params.set("size", String(OBIS_RECORD_CAP));

  return `https://api.obis.org/v3/occurrence?${params}`;
}

/*
 * The dataset's record in the CIOOS catalogue, as something a script can
 * fetch. `ckan_url` (built by shapeQuery from the harvested ckan_id) is the
 * human page — catalogue.cioos.ca/dataset/<id> — and that is what the UI
 * links to; the same record read through CKAN's package_show API is the same
 * page's content as JSON: licence, citation, contacts, attributes. A download
 * that keeps its metadata alongside its data wants the record, not the markup
 * that renders it, so the script and the URL list carry this form.
 *
 * Returns null for a dataset the harvest never matched to a catalogue entry
 * (ckan_id NULL makes the whole concatenation NULL upstream).
 */
const CKAN_DATASET_PATH = "/dataset/";

export function ckanRecordUrl(ckanUrl) {
  if (!ckanUrl) return null;
  const [origin, id] = ckanUrl.split(CKAN_DATASET_PATH);
  if (!id) return null;
  return `${origin}/api/3/action/package_show?id=${encodeURIComponent(id)}`;
}

// The server a dataset is served from. `erddap_server_url` is the base; older
// rows (and the download panel's own reshaping) may only carry the landing
// page, which is the base with /tabledap/<id>.html on the end.
function erddapServerBase(row) {
  const base = row?.erddap_server_url;
  if (base) return base.replace(/\/$/, "");
  const landing = row?.erddap_url;
  if (!landing) return null;
  return landing.replace(/\/(tabledap|griddap)\/.*$/, "");
}

const isObis = (row) => row?.source_type === "obis";

/*
 * One link per dataset, in list order.
 *
 * Grids are skipped: griddap subsetting is per-variable index ranges, not
 * constraints, so there is no honest way to carry the map's filters into one —
 * and they never reach the download selection anyway (SelectionProvider drops
 * them). A row that yields no URL is left out rather than emitted broken.
 */
export function buildDownloadLinks(
  rows,
  { erddapFormat, obisFormat },
  constraints,
) {
  const used = new Map();

  return (rows || [])
    .filter((row) => row?.cdm_data_type !== "Grid")
    .map((row) => {
      const obis = isObis(row);
      const formatId = obis ? obisFormat : erddapFormat;
      const format = (obis ? OBIS_FORMATS : ERDDAP_FORMATS).find(
        (candidate) => candidate.id === formatId,
      );
      if (!format) return null;

      const url = obis
        ? obisDownloadUrl(row, formatId, constraints)
        : erddapDownloadUrl(row, formatId, constraints);
      if (!url) return null;

      const filename = uniqueFilename(row, format, used);

      return {
        pk: row.pk,
        datasetId: row.dataset_id,
        title: row.title,
        source: obis ? "obis" : "erddap",
        format,
        url,
        filename,
        // The catalogue record, in both the form a person opens and the form
        // a script saves. Null together when the dataset has no CKAN entry.
        ckanUrl: row.ckan_url || null,
        ckanRecordUrl: ckanRecordUrl(row.ckan_url),
        // Alongside the data file rather than replacing its extension's
        // meaning: profiles.csv and profiles.ckan.json read as one pair.
        ckanFilename: `${filename.replace(/\.[^.]+$/, "")}.ckan.json`,
        // What this particular link could not carry, for the row to say so.
        // A depth filter is set but the dataset has no depth variable; an
        // ERDDAP link had to square off a polygon; the snapshot ignores
        // filters altogether.
        depthDropped:
          !obis && !row.has_depth && constraints?.startDepth != null,
        polygonSquared: !obis && Boolean(constraints?.bounds),
        unfiltered: obis && format.filtered === false,
      };
    })
    .filter(Boolean);
}

/*
 * The name to save a link's response under. Dataset IDs are unique per server,
 * not globally, so two servers publishing the same ID would otherwise write
 * over each other halfway through a scripted download; the server slug goes in
 * front, and a numeric suffix covers whatever slips past that.
 */
function uniqueFilename(row, format, used) {
  const slug = isObis(row) ? "obis" : erddapServerSlug(erddapServerBase(row));
  const stem = `${slug}_${row.dataset_id}`.replace(/[^\w.-]+/g, "_");
  const seen = used.get(stem) || 0;
  used.set(stem, seen + 1);
  return `${stem}${seen ? `_${seen + 1}` : ""}.${format.ext}`;
}

// ---------------------------------------------------------------------------
// The list, as a file

const csvCell = (value) => `"${String(value).replace(/"/g, '""')}"`;

// Single quotes, with the one escape sequence that can end a single-quoted
// bash word and start it again around a literal quote.
const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

/*
 * What the header line says the links were filtered by. Written here rather
 * than in the panel because it describes the same constraints the URLs were
 * built from — a file claiming "Filters: none" over URLs carrying a date range
 * is worse than no header at all. Plain technical notation rather than
 * translated prose: it is read beside the URLs, which are in that notation.
 */
export function filterSummaryText(constraints = {}) {
  const { startDate, endDate, startDepth, endDepth, bounds } = constraints;
  const parts = [];
  if (startDate || endDate) {
    parts.push(`time ${startDate || "…"} to ${endDate || "…"}`);
  }
  if (startDepth != null || endDepth != null) {
    parts.push(`depth ${startDepth ?? "…"} to ${endDepth ?? "…"} m`);
  }
  if (bounds) {
    const [[west, south], [east, north]] = bounds;
    parts.push(`bbox ${west}, ${south}, ${east}, ${north}`);
  }
  return parts.join("; ");
}

const header = (generatedAt, filterSummary) => [
  "# CIOOS Data Explorer — direct download URLs",
  `# Generated ${generatedAt}`,
  `# Filters: ${filterSummary || "none"}`,
];

/*
 * Every export carries the catalogue record of every dataset that has one:
 * licence, citation and contacts are what make a downloaded file usable
 * later, and a download that arrives without them is the thing this panel
 * exists to avoid. Only a dataset the harvest never matched to a CKAN entry
 * contributes nothing.
 */
export function linksToText(links, { generatedAt, filterSummary } = {}) {
  return [
    ...(generatedAt ? header(generatedAt, filterSummary) : []),
    // Each catalogue record directly under the data URL it describes: read top
    // to bottom the pair stays together, and piped to xargs they are fetched
    // in that order.
    ...links.flatMap((link) => [link.url, link.ckanRecordUrl].filter(Boolean)),
    "",
  ].join("\n");
}

/*
 * The same list as a runnable script, which is what the URLs are usually for.
 *
 * `--fail` matters more than it looks: ERDDAP answers a query that matches
 * nothing with 404 and a text body, so without it curl writes the error into
 * the .csv and exits 0. `--continue-at -` makes a re-run resume rather than
 * restart, since these are the downloads too big for the CDE's own queue.
 */
export function linksToCurlScript(links, { generatedAt, filterSummary } = {}) {
  const obisCapped = links.some(
    (link) => link.source === "obis" && link.format.filtered,
  );

  return [
    "#!/usr/bin/env bash",
    ...header(generatedAt, filterSummary),
    "#",
    "# ERDDAP answers a query that matches no data with 404 — --fail turns that",
    "# into a non-zero exit instead of a file full of error text.",
    ...(obisCapped
      ? [
          "#",
          `# OBIS API links return at most ${OBIS_RECORD_CAP} records per request. Where a`,
          "# dataset holds more, page with the 'after' parameter or take the",
          "# full-dataset Parquet snapshot instead.",
        ]
      : []),
    "set -euo pipefail",
    "",
    ...links.flatMap((link) => {
      const record = link.ckanRecordUrl;
      return [
        `# ${link.title || link.datasetId}`,
        `curl --fail --location --retry 3 --continue-at - --output ${shellQuote(
          link.filename,
        )} ${shellQuote(link.url)}`,
        // No --continue-at on the record: it is a few kilobytes, and asking to
        // resume a file already complete from an earlier run requests a range
        // the server answers 416, which --fail then turns into an exit 22.
        ...(record
          ? [
              `curl --fail --location --retry 3 --output ${shellQuote(
                link.ckanFilename,
              )} ${shellQuote(record)}`,
            ]
          : []),
      ];
    }),
    "",
  ].join("\n");
}

export function linksToCsv(links) {
  const rows = [
    [
      "dataset_id",
      "title",
      "source",
      "format",
      "filename",
      "url",
      // The human catalogue page here, not the API record: a CSV is read in a
      // spreadsheet, where the useful cell is the one you click.
      "catalogue_url",
    ],
    ...links.map((link) => [
      link.datasetId,
      link.title || "",
      link.source,
      link.format.id,
      link.filename,
      link.url,
      link.ckanUrl || "",
    ]),
  ];
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

/*
 * Hand the browser a generated file. Object URLs outlive the click, so the
 * revoke is what keeps a session of repeated exports from holding every
 * previous one in memory.
 */
export function downloadTextFile(filename, text, mimeType = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
