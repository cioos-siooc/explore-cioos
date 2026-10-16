// Direct links to each dataset's source server, carrying the map's filters.
// ERDDAP constrains by bounding box, so a drawn polygon is squared off (OBIS
// gets the WKT). The ERDDAP query is deliberately variable-less, returning
// every variable: a user following a link to the source wants the source.

import {
  boundsFromGeoJson,
  erddapServerSlug,
  polygonToWkt,
} from "./utilities.jsx";

// `id` is ERDDAP's file type (the URL extension); `ext` is the saved file's.
// Labels are format names, so not translated.
export const ERDDAP_FORMATS = [
  { id: "csv", ext: "csv", label: "CSV" },
  { id: "tsv", ext: "tsv", label: "TSV" },
  { id: "json", ext: "json", label: "JSON" },
  { id: "nc", ext: "nc", label: "netCDF" },
  { id: "ncCF", ext: "nc", label: "netCDF-CF" },
  { id: "odvTxt", ext: "txt", label: "ODV" },
  { id: "parquet", ext: "parquet", label: "Parquet" },
];

// Not just encodings: the v3 API applies every filter but caps records per
// request; the Parquet snapshot is the whole dataset, unfiltered.
export const OBIS_RECORD_CAP = 10000;

export const OBIS_FORMATS = [
  {
    id: "obisJson",
    ext: "json",
    label: "JSON",
    filtered: true,
    noteKey: "downloadFormatObisApiNote",
  },
  {
    id: "obisParquet",
    ext: "parquet",
    label: "Parquet",
    filtered: false,
    noteKey: "downloadFormatObisSnapshotNote",
  },
];

export const defaultErddapFormat = ERDDAP_FORMATS[0].id;
export const defaultObisFormat = OBIS_FORMATS[0].id;

// The `by*` flags are the same checkboxes that filter the queued zip, so the
// two delivery routes can never disagree.
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

// End of the last day, or data recorded on the closing date is dropped.
const dayStart = (date) => `${date}T00:00:00Z`;
const dayEnd = (date) => `${date}T23:59:59Z`;

// A bare `>` gets mangled by mail clients, chat and spreadsheets.
const constrain = (variable, operator, value) =>
  `${variable}${encodeURIComponent(operator)}=${encodeURIComponent(value)}`;

// The leading `?&` is not a typo: ERDDAP 400s on `?time>=…` without it.
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
  // tabledap 400s on a constraint for an undeclared variable.
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

// `size` is pinned to the API maximum: the default of 10 would look like a
// ten-record dataset.
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
  if (constraints.polygon) {
    params.set("geometry", polygonToWkt(constraints.polygon));
  }
  params.set("size", String(OBIS_RECORD_CAP));

  return `https://api.obis.org/v3/occurrence?${params}`;
}

// The CKAN package_show JSON behind `ckan_url`'s human page, for scripts.
const CKAN_DATASET_PATH = "/dataset/";

export function ckanRecordUrl(ckanUrl) {
  if (!ckanUrl) return null;
  const [origin, id] = ckanUrl.split(CKAN_DATASET_PATH);
  if (!id) return null;
  return `${origin}/api/3/action/package_show?id=${encodeURIComponent(id)}`;
}

// Some rows (and the download panel's reshaping) only carry the landing page.
function erddapServerBase(row) {
  const base = row?.erddap_server_url;
  if (base) return base.replace(/\/$/, "");
  const landing = row?.erddap_url;
  if (!landing) return null;
  return landing.replace(/\/(tabledap|griddap)\/.*$/, "");
}

const isObis = (row) => row?.source_type === "obis";

// Grids are skipped: griddap subsets by index ranges, so the map's filters
// can't be carried into one.
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
        ckanUrl: row.ckan_url || null,
        ckanRecordUrl: ckanRecordUrl(row.ckan_url),
        ckanFilename: `${filename.replace(/\.[^.]+$/, "")}.ckan.json`,
        // What this link could not carry, for the row to say so.
        depthDropped:
          !obis && !row.has_depth && constraints?.startDepth != null,
        // Rectangles too, deliberately: the reader needs to know the link
        // constrains by a lat/lon box either way.
        polygonSquared: !obis && Boolean(constraints?.bounds),
        unfiltered: obis && format.filtered === false,
      };
    })
    .filter(Boolean);
}

// Dataset IDs are unique per server only, so the slug prefix and suffix keep
// a scripted download from overwriting its own files.
function uniqueFilename(row, format, used) {
  const slug = isObis(row) ? "obis" : erddapServerSlug(erddapServerBase(row));
  const stem = `${slug}_${row.dataset_id}`.replace(/[^\w.-]+/g, "_");
  const seen = used.get(stem) || 0;
  used.set(stem, seen + 1);
  return `${stem}${seen ? `_${seen + 1}` : ""}.${format.ext}`;
}

const csvCell = (value) => `"${String(value).replace(/"/g, '""')}"`;

const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

// Built from the same constraints as the URLs so the header can't contradict
// them; untranslated technical notation, read beside the URLs.
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

export function linksToText(links, { generatedAt, filterSummary } = {}) {
  return [
    ...(generatedAt ? header(generatedAt, filterSummary) : []),
    ...links.flatMap((link) => [link.url, link.ckanRecordUrl].filter(Boolean)),
    "",
  ].join("\n");
}

// --fail: ERDDAP answers an empty match with a 404 text body that curl would
// otherwise save as the .csv. --continue-at - lets a re-run resume.
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
        // No --continue-at: resuming an already-complete file gets a 416,
        // which --fail turns into exit 22.
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
      // The human page, not the API record: CSVs are read in spreadsheets.
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
