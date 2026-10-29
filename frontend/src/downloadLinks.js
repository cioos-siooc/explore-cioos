// Direct links to each dataset's source server, offered only when no polygon
// filters the download: without one, what the source returns is what the
// package holds. The ERDDAP query is deliberately variable-less, returning
// every variable: a user following a link to the source wants the source.

// The ERDDAP file type behind each package format (FORMATS in
// downloader/cioos_downloader/download_erddap.py).
export const ERDDAP_FORMATS = {
  csv: "csv",
  parquet: "parquetWMeta",
  odv: "odvTxt",
  nccf: "ncCF",
};

// OBIS has no raw rendition of the package's filtered table: its v3 API
// applies every filter but caps records per request.
export const OBIS_RECORD_CAP = 10000;
const OBIS_FORMAT = "obisJson";

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

const CKAN_DATASET_PATH = "/dataset/";

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

// Grids are skipped: griddap subsets by index ranges, so the map's filters
// can't be carried into one.
export function buildDownloadLinks(rows, packageFormat, constraints) {
  return (rows || [])
    .filter((row) => row?.cdm_data_type !== "Grid")
    .map((row) => {
      const obis = isObis(row);
      const format = obis ? OBIS_FORMAT : ERDDAP_FORMATS[packageFormat];
      if (!format || !erddapServerBase(row)) return null;

      const url = obis
        ? obisDownloadUrl(row, constraints)
        : erddapDownloadUrl(row, format, constraints);
      if (!url) return null;

      return {
        pk: row.pk,
        datasetId: row.dataset_id,
        title: row.title,
        source: obis ? "obis" : "erddap",
        format,
        url,
        ckanUrl: row.ckan_url || null,
        // What this link could not carry, for the row to say so.
        depthDropped:
          !obis && !row.has_depth && constraints?.startDepth != null,
      };
    })
    .filter(Boolean);
}

const csvCell = (value) => `"${String(value).replace(/"/g, '""')}"`;

// `citations` is GET /datasets/citations' answer; a dataset it lacks still
// gets its row.
export function linksToCsv(links, citations = []) {
  const byPk = new Map(citations.map((entry) => [entry.pk, entry]));
  const rows = [
    [
      "dataset_id",
      "title",
      "source",
      "format",
      "query_url",
      // The human page, not the API record: CSVs are read in spreadsheets.
      "catalogue_url",
      "license",
      "license_url",
      "citation",
    ],
    ...links.map((link) => {
      const cited = byPk.get(link.pk) || {};
      return [
        link.datasetId,
        link.title || "",
        link.source,
        link.format,
        link.url,
        link.ckanUrl || "",
        cited.license || "",
        cited.license_url || "",
        cited.citation || "",
      ];
    }),
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
