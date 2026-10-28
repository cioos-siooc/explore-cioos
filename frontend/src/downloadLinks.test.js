import { describe, it, expect } from "vitest";

import {
  ERDDAP_FORMATS,
  OBIS_RECORD_CAP,
  buildDownloadLinks,
  ckanRecordUrl,
  downloadConstraints,
  erddapDownloadUrl,
  filterSummaryText,
  linksToCsv,
  linksToCurlScript,
  linksToText,
  localizedCkanUrl,
  localizedErddapUrl,
  obisDownloadUrl,
} from "./downloadLinks.js";

const erddapRow = {
  pk: 1,
  dataset_id: "ios_ctd_profiles",
  title: "IOS CTD Profiles",
  source_type: "erddap",
  erddap_server_url: "https://data.cioospacific.ca/erddap",
  cdm_data_type: "Profile",
  has_depth: true,
  ckan_url: "https://catalogue.cioos.ca/dataset/ff21-4d1e",
};

const obisRow = {
  pk: 2,
  dataset_id: "5422689c-d83d-44e8-87f4-a4b0a5117181",
  title: "Some occurrences",
  source_type: "obis",
  erddap_server_url: "https://obis.org",
  cdm_data_type: "Point",
};

const allFilters = downloadConstraints({
  query: {
    startDate: "2020-01-01",
    endDate: "2020-12-31",
    startDepth: 0,
    endDepth: 100,
  },
  byTime: true,
  byDepth: true,
});

describe("downloadConstraints", () => {
  it("drops each filter the download switches turn off", () => {
    const none = downloadConstraints({
      query: { startDate: "2020-01-01", endDate: "2020-12-31", startDepth: 0 },
      byTime: false,
      byDepth: false,
    });
    expect(Object.values(none).every((v) => v === undefined)).toBe(true);
  });
});

describe("erddapDownloadUrl", () => {
  it("opens the constraint list with '&', which tabledap requires", () => {
    const url = erddapDownloadUrl(erddapRow, "csv", allFilters);
    expect(url).toContain("/tabledap/ios_ctd_profiles.csv?&time%3E=");
    // Not `?time>=…`, which ERDDAP answers with 400.
    expect(url).not.toContain(".csv?time");
  });

  it("carries the whole closing day, not just its first instant", () => {
    const url = erddapDownloadUrl(erddapRow, "csv", allFilters);
    expect(decodeURIComponent(url)).toContain("time<=2020-12-31T23:59:59Z");
    expect(decodeURIComponent(url)).toContain("time>=2020-01-01T00:00:00Z");
  });

  it("omits the depth constraint for a dataset with no depth variable", () => {
    // tabledap 400s on `depth>=` there ("Unrecognized constraint variable"),
    // so the link is better off unfiltered by depth than broken.
    const url = erddapDownloadUrl(
      { ...erddapRow, has_depth: false },
      "csv",
      allFilters,
    );
    expect(url).not.toContain("depth");
    expect(url).toContain("time%3E=");
  });

  it("emits a bare dataset URL when no filter applies", () => {
    const url = erddapDownloadUrl(erddapRow, "parquet", {});
    expect(url).toBe(
      "https://data.cioospacific.ca/erddap/tabledap/ios_ctd_profiles.parquet?",
    );
  });

  it("falls back to the landing page's server when only that is known", () => {
    const url = erddapDownloadUrl(
      {
        dataset_id: "abc",
        erddap_url: "https://catalogue.hakai.org/erddap/tabledap/abc.html",
      },
      "csv",
      {},
    );
    expect(url).toBe("https://catalogue.hakai.org/erddap/tabledap/abc.csv?");
  });

  it("maps every package format to an ERDDAP file type", () => {
    expect(Object.keys(ERDDAP_FORMATS)).toEqual([
      "csv",
      "parquet",
      "odv",
      "nccf",
    ]);
    for (const format of Object.values(ERDDAP_FORMATS)) {
      expect(format.ext).toMatch(/^\w+$/);
    }
  });
});

describe("obisDownloadUrl", () => {
  it("carries time and depth, and pins the page size to the API maximum", () => {
    const url = new URL(obisDownloadUrl(obisRow, allFilters));
    const params = url.searchParams;
    expect(params.get("datasetid")).toBe(obisRow.dataset_id);
    expect(params.get("startdate")).toBe("2020-01-01");
    expect(params.get("enddate")).toBe("2020-12-31");
    expect(params.get("startdepth")).toBe("0");
    expect(params.get("enddepth")).toBe("100");
    expect(params.has("geometry")).toBe(false);
    expect(params.get("size")).toBe(String(OBIS_RECORD_CAP));
  });
});

describe("buildDownloadLinks", () => {
  it("routes each row to its own source", () => {
    const links = buildDownloadLinks([erddapRow, obisRow], "csv", allFilters);
    expect(links.map((link) => link.source)).toEqual(["erddap", "obis"]);
    expect(links[0].url).toContain("/tabledap/");
    expect(links[1].url).toContain("api.obis.org");
  });

  it("asks ERDDAP for the package format's file type, OBIS for API JSON", () => {
    const [erddap, obis] = buildDownloadLinks(
      [erddapRow, obisRow],
      "parquet",
      allFilters,
    );
    expect(erddap.url).toContain("/tabledap/ios_ctd_profiles.parquetWMeta?");
    expect(erddap.path).toMatch(/\.parquet$/);
    expect(obis.path).toMatch(/\.json$/);
  });

  it("skips grids, which have no constraint-based subsetting", () => {
    const links = buildDownloadLinks(
      [{ ...erddapRow, cdm_data_type: "Grid" }],
      "csv",
      allFilters,
    );
    expect(links).toEqual([]);
  });

  it("lays files out as the package does: one folder per dataset", () => {
    const [erddap, obis] = buildDownloadLinks(
      [erddapRow, obisRow],
      "csv",
      allFilters,
    );
    const name = "ios_ctd_profiles_data_cioospacific_ca";
    const folder = `data/${name}`;
    expect(erddap.path).toBe(`${folder}/${name}.csv`);
    expect(erddap.records).toEqual([
      {
        path: `${folder}/metadata/erddap.nccsvMetadata`,
        url: "https://data.cioospacific.ca/erddap/tabledap/ios_ctd_profiles.nccsvMetadata",
      },
      {
        path: `${folder}/metadata/ckan_package.json`,
        url: "https://catalogue.cioos.ca/api/3/action/package_show?id=ff21-4d1e",
      },
    ]);
    expect(obis.records).toEqual([
      {
        path: `data/${obisRow.dataset_id}_obis_org/metadata/obis_dataset.json`,
        url: `https://api.obis.org/v3/dataset/${obisRow.dataset_id}`,
      },
    ]);
  });

  it("flags a depth filter the link could not carry", () => {
    const [depthless] = buildDownloadLinks(
      [{ ...erddapRow, has_depth: false }],
      "csv",
      allFilters,
    );
    expect(depthless.depthDropped).toBe(true);
  });
});

describe("ckanRecordUrl", () => {
  it("reads the catalogue page as the record behind it", () => {
    expect(ckanRecordUrl("https://catalogue.cioos.ca/dataset/ff21-4d1e")).toBe(
      "https://catalogue.cioos.ca/api/3/action/package_show?id=ff21-4d1e",
    );
  });

  it("has nothing to offer for a dataset with no catalogue entry", () => {
    // ckan_id NULL makes the whole concatenation NULL upstream.
    expect(ckanRecordUrl(null)).toBeNull();
    expect(ckanRecordUrl("https://catalogue.cioos.ca/")).toBeNull();
  });
});

describe("localizedCkanUrl", () => {
  it("prefixes the catalogue page with the French locale", () => {
    expect(localizedCkanUrl(erddapRow.ckan_url, "fr")).toBe(
      "https://catalogue.cioos.ca/fr/dataset/ff21-4d1e",
    );
  });

  it("names English too, since the catalogue's default is configurable", () => {
    expect(localizedCkanUrl(erddapRow.ckan_url, "en")).toBe(
      "https://catalogue.cioos.ca/en/dataset/ff21-4d1e",
    );
  });

  it("has nothing to localize for a dataset with no catalogue entry", () => {
    expect(localizedCkanUrl(null, "fr")).toBeNull();
  });
});

describe("localizedErddapUrl", () => {
  const landing = "https://data.cioospacific.ca/erddap/tabledap/ios.html";

  it("puts the language right after the server base", () => {
    expect(localizedErddapUrl(erddapRow, landing, "fr")).toBe(
      "https://data.cioospacific.ca/erddap/fr/tabledap/ios.html",
    );
  });

  it("works from the landing page alone", () => {
    expect(localizedErddapUrl({ erddap_url: landing }, landing, "fr")).toBe(
      "https://data.cioospacific.ca/erddap/fr/tabledap/ios.html",
    );
  });

  it("names English too, since the server's default is configurable", () => {
    expect(localizedErddapUrl(erddapRow, landing, "en")).toBe(
      "https://data.cioospacific.ca/erddap/en/tabledap/ios.html",
    );
  });

  it("leaves OBIS pages as they are", () => {
    const obisPage = `https://obis.org/dataset/${obisRow.dataset_id}`;
    expect(localizedErddapUrl(obisRow, obisPage, "fr")).toBe(obisPage);
  });
});

describe("filterSummaryText", () => {
  it("says what the URLs were filtered by, in the URLs' own terms", () => {
    expect(filterSummaryText(allFilters)).toBe(
      "time 2020-01-01 to 2020-12-31; depth 0 to 100 m",
    );
  });

  it("is empty when nothing was applied, which the header reads as 'none'", () => {
    expect(filterSummaryText({})).toBe("");
    // Depth 0 is a depth, not an absent filter.
    expect(filterSummaryText({ startDepth: 0 })).toBe("depth 0 to … m");
  });
});

describe("the exported list", () => {
  const links = buildDownloadLinks([erddapRow, obisRow], "csv", allFilters);
  const meta = { generatedAt: "2026-09-10T00:00:00Z", filterSummary: "time" };

  it("is one URL per line under a commented header", () => {
    const lines = linksToText(links, meta).trim().split("\n");
    expect(lines.filter((line) => line.startsWith("#"))).toHaveLength(3);
    // Two data URLs, two source records and one catalogue record.
    expect(lines.filter((line) => line.startsWith("http"))).toHaveLength(5);
  });

  it("is a curl script that skips a failed file instead of stopping", () => {
    const script = linksToCurlScript(links, meta);
    expect(script.split("\n")[0]).toBe("#!/usr/bin/env bash");
    expect(script).toContain("set -uo pipefail");
    expect(script).not.toContain("set -e");
    expect(script).toContain("--fail");
    expect(script).toContain('--user-agent "$UA"');
    expect(script).toContain("mkdir -p cde_download && cd cde_download");
    // Every URL is quoted: '&' unquoted would background the command.
    for (const link of links) {
      expect(script).toContain(`fetch '${link.path}' '${link.url}'`);
    }
  });

  it("points to the Python script for what it can't build", () => {
    expect(linksToCurlScript(links, meta)).toMatch(/Citations.*Python script/s);
  });

  it("warns about the OBIS page cap only when an OBIS API link is in it", () => {
    expect(linksToCurlScript(links, meta)).toContain(
      `at most ${OBIS_RECORD_CAP} records`,
    );
    const erddapOnly = buildDownloadLinks([erddapRow], "csv", allFilters);
    expect(linksToCurlScript(erddapOnly, meta)).not.toContain(
      "records per request",
    );
  });

  it("escapes quotes rather than breaking the shell word", () => {
    const quoted = buildDownloadLinks(
      [{ ...erddapRow, title: "it's here" }],
      "csv",
      allFilters,
    );
    expect(linksToCurlScript(quoted, meta)).toContain("# it's here");
  });

  it("fetches each source record into its dataset's folder", () => {
    const script = linksToCurlScript(links, meta);
    const folder = "data/ios_ctd_profiles_data_cioospacific_ca/metadata";
    expect(script).toContain(
      `fetch '${folder}/ckan_package.json' 'https://catalogue.cioos.ca/api/3/action/package_show?id=ff21-4d1e'`,
    );
    expect(script).toContain(`fetch '${folder}/erddap.nccsvMetadata'`);
    // The OBIS row has no catalogue entry, so it contributes no CKAN line.
    expect(script.match(/package_show/g)).toHaveLength(1);
  });

  it("gives the CSV the page a person clicks, not the API record", () => {
    const csv = linksToCsv(links);
    const [header, erddap, obis] = csv.trim().split("\n");
    expect(header).toContain('"catalogue_url"');
    expect(erddap).toContain('"https://catalogue.cioos.ca/dataset/ff21-4d1e"');
    // A dataset the harvest never matched to a catalogue entry gets an empty
    // cell rather than a broken URL.
    expect(obis.endsWith('""')).toBe(true);
  });

  it("is a CSV whose cells survive a comma in the title", () => {
    const csv = linksToCsv(
      buildDownloadLinks(
        [{ ...erddapRow, title: 'Profiles, "inshore"' }],
        "csv",
        allFilters,
      ),
    );
    const [header, row] = csv.trim().split("\n");
    expect(header).toBe(
      '"dataset_id","title","source","format","path","url","catalogue_url"',
    );
    expect(row).toContain('"Profiles, ""inshore"""');
  });
});
