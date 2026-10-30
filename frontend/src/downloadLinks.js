// Direct links to each dataset's source server, offered only when no polygon
// filters the download: without one, what the source returns is what the
// package holds. Files are named as in the package (data/<dataset folder>/,
// source metadata records in its metadata/); citations need the package code, so the Python script. The ERDDAP query is deliberately variable-less, returning
// every variable: a user following a link to the source wants the source.

// The ERDDAP file type behind each package format (FORMATS in
// downloader/cioos_downloader/download_erddap.py); `ext` is the saved file's.
export const ERDDAP_FORMATS = {
  csv: { id: "csv", ext: "csv" },
  parquet: { id: "parquetWMeta", ext: "parquet" },
  odv: { id: "odvTxt", ext: "txt" },
  nccf: { id: "ncCF", ext: "nc" },
};

// OBIS has no raw rendition of the package's filtered table: its v3 API
// applies every filter but caps records per request.
export const OBIS_RECORD_CAP = 10000;
const OBIS_FORMAT = { id: "obisJson", ext: "json" };

// The `by*` flags are the same checkboxes that filter the queued zip, so the
// two delivery routes can never disagree.
export function downloadConstraints({ query, byTime, byDepth }) {
  return {
    startDate: byTime ? query?.startDate : undefined,
    endDate: byTime ? query?.endDate : undefined,
    startDepth: byDepth ? query?.startDepth : undefined,
    endDepth: byDepth ? query?.endDepth : undefined,
  };
}

// End of the last day, or data recorded on the closing date is dropped.
const dayStart = (date) => `${date}T00:00:00Z`;
const dayEnd = (date) => `${date}T23:59:59Z`;

// A bare `>` gets mangled by mail clients, chat and spreadsheets.
const constrain = (variable, operator, value) =>
  `${variable}${encodeURIComponent(operator)}=${encodeURIComponent(value)}`;

// The leading `?&` is not a typo: ERDDAP 400s on `?time>=…` without it.
export function erddapDownloadUrl(row, fileType, constraints = {}) {
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
  return `${server}/tabledap/${row.dataset_id}.${fileType}?${parts
    .map((part) => `&${part}`)
    .join("")}`;
}

// `size` is pinned to the API maximum: the default of 10 would look like a
// ten-record dataset.
export function obisDownloadUrl(row, constraints = {}) {
  if (!row?.dataset_id) return null;
  const params = new URLSearchParams({ datasetid: row.dataset_id });
  if (constraints.startDate) params.set("startdate", constraints.startDate);
  if (constraints.endDate) params.set("enddate", constraints.endDate);
  if (constraints.startDepth != null) {
    params.set("startdepth", constraints.startDepth);
  }
  if (constraints.endDepth != null) {
    params.set("enddepth", constraints.endDepth);
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

// Both CKAN and ERDDAP (2.12+) default to whatever language their manager
// set, so the page's language is always named in the URL.
const urlLanguage = (language) => (language?.startsWith("fr") ? "fr" : "en");

export function localizedCkanUrl(ckanUrl, language) {
  if (!ckanUrl) return ckanUrl;
  const [origin, id] = ckanUrl.split(CKAN_DATASET_PATH);
  if (!id) return ckanUrl;
  return `${origin}/${urlLanguage(language)}${CKAN_DATASET_PATH}${id}`;
}

const isObis = (row) => row?.source_type === "obis";

// ERDDAP takes the language as the first segment after the server base.
// obis.org has no French UI.
export function localizedErddapUrl(row, url, language) {
  if (!url || isObis(row)) return url;
  const base = erddapServerBase(row);
  if (!base || !url.startsWith(`${base}/`)) return url;
  return `${base}/${urlLanguage(language)}${url.slice(base.length)}`;
}

// Some rows (and the download panel's reshaping) only carry the landing page.
export function erddapServerBase(row) {
  const base = row?.erddap_server_url;
  if (base) return base.replace(/\/$/, "");
  const landing = row?.erddap_url;
  if (!landing) return null;
  return landing.replace(/\/(tabledap|griddap)\/.*$/, "");
}

// dataset_folder_name in downloader/cioos_downloader/download_erddap.py.
function datasetFolder(row) {
  const host = new URL(erddapServerBase(row)).host.replace(/\./g, "_");
  return `${row.dataset_id}_${host}`;
}

// Each source's own metadata record, under the name the package gives it
// (source_metadata.py); the package keeps CKAN's ISO record where it has one.
function metadataRecords(row, folder, obis) {
  const records = [
    obis
      ? {
          path: `${folder}/metadata/obis_dataset.json`,
          url: `https://api.obis.org/v3/dataset/${row.dataset_id}`,
        }
      : {
          path: `${folder}/metadata/erddap.nccsvMetadata`,
          url: `${erddapServerBase(row)}/tabledap/${row.dataset_id}.nccsvMetadata`,
        },
  ];
  const ckan = ckanRecordUrl(row.ckan_url);
  if (ckan)
    records.push({ path: `${folder}/metadata/ckan_package.json`, url: ckan });
  return records;
}

// Grids are skipped: griddap subsets by index ranges, so the map's filters
// can't be carried into one.
export function buildDownloadLinks(rows, packageFormat, constraints) {
  return (rows || [])
    .filter((row) => row?.cdm_data_type !== "Grid")
    .map((row) => {
      const obis = isObis(row);
      // The package's CSV fallback, for a format ERDDAP has no rendition of.
      const format = obis
        ? OBIS_FORMAT
        : (ERDDAP_FORMATS[packageFormat] ?? ERDDAP_FORMATS.csv);
      if (!format || !erddapServerBase(row)) return null;

      const url = obis
        ? obisDownloadUrl(row, constraints)
        : erddapDownloadUrl(row, format.id, constraints);
      if (!url) return null;

      const name = datasetFolder(row);
      const folder = `data/${name}`;
      return {
        pk: row.pk,
        datasetId: row.dataset_id,
        title: row.title,
        source: obis ? "obis" : "erddap",
        format,
        url,
        folder,
        path: `${folder}/${name}.${format.ext}`,
        records: metadataRecords(row, folder, obis),
        ckanUrl: row.ckan_url || null,
        // What this link could not carry, for the row to say so.
        depthDropped:
          !obis && !row.has_depth && constraints?.startDepth != null,
      };
    })
    .filter(Boolean);
}

const csvCell = (value) => `"${String(value).replace(/"/g, '""')}"`;

const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

// Built from the same constraints as the URLs so the header can't contradict
// them; untranslated technical notation, read beside the URLs.
export function filterSummaryText(constraints = {}) {
  const { startDate, endDate, startDepth, endDepth } = constraints;
  const parts = [];
  if (startDate || endDate) {
    parts.push(`time ${startDate || "…"} to ${endDate || "…"}`);
  }
  if (startDepth != null || endDepth != null) {
    parts.push(`depth ${startDepth ?? "…"} to ${endDepth ?? "…"} m`);
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
    ...links.flatMap((link) => [link.url, ...link.records.map((r) => r.url)]),
    "",
  ].join("\n");
}

const USER_AGENT = "CIOOS-CDE-Downloader/1.0 (+https://catalogue.cioos.ca)";

// Writes the package's folder layout under cde_download/. One file failing
// (an empty match is a 404) is reported and skipped, never the whole run.
export function linksToCurlScript(links, { generatedAt, filterSummary } = {}) {
  const obisCapped = links.some((link) => link.source === "obis");

  return [
    "#!/usr/bin/env bash",
    ...header(generatedAt, filterSummary),
    "#",
    "# Writes cde_download/ laid out like the Data Explorer's download package:",
    "# data/<dataset folder>/ with its data and, in metadata/, its sources' records.",
    "# Citations, licences and the polygon filter are not included: the Data",
    "# Explorer's Python script builds the full package (uv run <script>).",
    ...(obisCapped
      ? [
          "#",
          `# OBIS API links return at most ${OBIS_RECORD_CAP} records per request. Where a`,
          "# dataset holds more, page with the 'after' parameter or use the Python",
          "# script, which reads the full OBIS export.",
        ]
      : []),
    "set -uo pipefail",
    "",
    // Some servers' firewalls refuse curl's default User-Agent.
    `UA=${shellQuote(USER_AGENT)}`,
    "fetch() {",
    '  mkdir -p "$(dirname "$1")"',
    '  if curl --fail --silent --show-error --location --retry 3 --user-agent "$UA" --output "$1" "$2"; then',
    '    echo "ok      $1"',
    "  else",
    '    rm -f "$1"',
    '    echo "skipped $1 (no matching data, or the server refused)"',
    "  fi",
    "}",
    "",
    "mkdir -p cde_download && cd cde_download",
    "",
    ...links.flatMap((link) => [
      `# ${link.title || link.datasetId}`,
      `fetch ${shellQuote(link.path)} ${shellQuote(link.url)}`,
      ...link.records.map(
        (record) =>
          `fetch ${shellQuote(record.path)} ${shellQuote(record.url)}`,
      ),
    ]),
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
      "path",
      "url",
      // The human page, not the API record: CSVs are read in spreadsheets.
      "catalogue_url",
    ],
    ...links.map((link) => [
      link.datasetId,
      link.title || "",
      link.source,
      link.format.id,
      link.path,
      link.url,
      link.ckanUrl || "",
    ]),
  ];
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

export function saveUrl(url, filename = "") {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function downloadTextFile(filename, text, mimeType = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  saveUrl(url, filename);
  URL.revokeObjectURL(url);
}
