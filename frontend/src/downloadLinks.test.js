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
  polygon: [
    [-140, 40],
    [-120, 40],
    [-120, 60],
    [-140, 60],
    [-140, 40],
  ],
  byTime: true,
  byDepth: true,
  byPolygon: true,
});

const formats = { erddapFormat: "csv", obisFormat: "obisJson" };

describe("downloadConstraints", () => {
  it("drops each filter the download switches turn off", () => {
    const none = downloadConstraints({
      query: { startDate: "2020-01-01", endDate: "2020-12-31", startDepth: 0 },
      polygon: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
      byTime: false,
      byDepth: false,
      byPolygon: false,
    });
    expect(none.startDate).toBeUndefined();
    expect(none.startDepth).toBeUndefined();
    expect(none.bounds).toBeNull();
    expect(none.polygon).toBeUndefined();
  });

  it("reduces a polygon to bounds while keeping the ring for OBIS", () => {
    expect(allFilters.bounds).toEqual([
      [-140, 40],
      [-120, 60],
    ]);
    expect(allFilters.polygon).toHaveLength(5);
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

  it("constrains latitude and longitude from the polygon's bounds", () => {
    const url = decodeURIComponent(
      erddapDownloadUrl(erddapRow, "nc", allFilters),
    );
    expect(url).toContain("latitude>=40");
    expect(url).toContain("latitude<=60");
    expect(url).toContain("longitude>=-140");
    expect(url).toContain("longitude<=-120");
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

  it("offers only file formats, each with a saved extension", () => {
    for (const format of ERDDAP_FORMATS) {
      expect(format.ext).toMatch(/^\w+$/);
    }
  });
});

describe("obisDownloadUrl", () => {
  it("sends the polygon itself, and pins the page size to the API maximum", () => {
    const url = new URL(obisDownloadUrl(obisRow, "obisJson", allFilters));
    const params = url.searchParams;
    expect(params.get("datasetid")).toBe(obisRow.dataset_id);
    expect(params.get("startdate")).toBe("2020-01-01");
    expect(params.get("enddate")).toBe("2020-12-31");
    expect(params.get("startdepth")).toBe("0");
    expect(params.get("enddepth")).toBe("100");
    expect(params.get("geometry")).toBe(
      "POLYGON((-140 40, -120 40, -120 60, -140 60, -140 40))",
    );
    expect(params.get("size")).toBe(String(OBIS_RECORD_CAP));
  });

  it("ignores every filter for the full-dataset snapshot", () => {
    expect(obisDownloadUrl(obisRow, "obisParquet", allFilters)).toBe(
      `https://obis-open-data.s3.amazonaws.com/occurrence/${obisRow.dataset_id}.parquet`,
    );
  });
});

describe("buildDownloadLinks", () => {
  it("routes each row to its own source", () => {
    const links = buildDownloadLinks([erddapRow, obisRow], formats, allFilters);
    expect(links.map((link) => link.source)).toEqual(["erddap", "obis"]);
    expect(links[0].url).toContain("/tabledap/");
    expect(links[1].url).toContain("api.obis.org");
  });

  it("skips grids, which have no constraint-based subsetting", () => {
    const links = buildDownloadLinks(
      [{ ...erddapRow, cdm_data_type: "Grid" }],
      formats,
      allFilters,
    );
    expect(links).toEqual([]);
  });

  it("names files by server and dataset, and never twice the same", () => {
    const links = buildDownloadLinks(
      [erddapRow, { ...erddapRow, pk: 3 }],
      formats,
      allFilters,
    );
    expect(links[0].filename).toBe(
      "data-cioospacific-ca-erddap_ios_ctd_profiles.csv",
    );
    expect(links[1].filename).toBe(
      "data-cioospacific-ca-erddap_ios_ctd_profiles_2.csv",
    );
  });

  it("flags what a link could not carry", () => {
    const [depthless, obis] = buildDownloadLinks(
      [{ ...erddapRow, has_depth: false }, obisRow],
      { ...formats, obisFormat: "obisParquet" },
      allFilters,
    );
    expect(depthless.depthDropped).toBe(true);
    expect(depthless.polygonSquared).toBe(true);
    expect(obis.unfiltered).toBe(true);
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

describe("filterSummaryText", () => {
  it("says what the URLs were filtered by, in the URLs' own terms", () => {
    expect(filterSummaryText(allFilters)).toBe(
      "time 2020-01-01 to 2020-12-31; depth 0 to 100 m; bbox -140, 40, -120, 60",
    );
  });

  it("is empty when nothing was applied, which the header reads as 'none'", () => {
    expect(filterSummaryText({})).toBe("");
    // Depth 0 is a depth, not an absent filter.
    expect(filterSummaryText({ startDepth: 0 })).toBe("depth 0 to … m");
  });
});

describe("the exported list", () => {
  const links = buildDownloadLinks([erddapRow, obisRow], formats, allFilters);
  const meta = { generatedAt: "2026-09-10T00:00:00Z", filterSummary: "time" };

  it("is one URL per line under a commented header", () => {
    const lines = linksToText(links, meta).trim().split("\n");
    expect(lines.filter((line) => line.startsWith("#"))).toHaveLength(3);
    // Two data URLs, plus the catalogue record of the one dataset that has one.
    expect(lines.filter((line) => line.startsWith("http"))).toHaveLength(3);
  });

  it("is a curl script that fails loudly and resumes", () => {
    const script = linksToCurlScript(links, meta);
    expect(script.split("\n")[0]).toBe("#!/usr/bin/env bash");
    expect(script).toContain("set -euo pipefail");
    expect(script).toContain("--fail");
    expect(script).toContain("--continue-at -");
    // Every URL is quoted: '&' unquoted would background the command.
    for (const link of links) expect(script).toContain(`'${link.url}'`);
  });

  it("warns about the OBIS page cap only when an OBIS API link is in it", () => {
    expect(linksToCurlScript(links, meta)).toContain(
      `at most ${OBIS_RECORD_CAP} records`,
    );
    const erddapOnly = buildDownloadLinks([erddapRow], formats, allFilters);
    expect(linksToCurlScript(erddapOnly, meta)).not.toContain(
      "records per request",
    );
  });

  it("escapes quotes rather than breaking the shell word", () => {
    const quoted = buildDownloadLinks(
      [{ ...erddapRow, title: "it's here" }],
      formats,
      allFilters,
    );
    expect(linksToCurlScript(quoted, meta)).toContain("# it's here");
  });

  it("fetches each catalogue record beside its dataset", () => {
    const script = linksToCurlScript(links, meta);
    expect(script).toContain(
      "'https://catalogue.cioos.ca/api/3/action/package_show?id=ff21-4d1e'",
    );
    expect(script).toContain(
      "'data-cioospacific-ca-erddap_ios_ctd_profiles.ckan.json'",
    );
    // Resuming a complete metadata file would 416; only the data file resumes.
    const metadataLine = script
      .split("\n")
      .find((line) => line.includes("package_show"));
    expect(metadataLine).not.toContain("--continue-at");
    // The OBIS row has no catalogue entry, so it contributes no second line.
    expect(script.match(/package_show/g)).toHaveLength(1);

    const urls = linksToText(links, meta).trim().split("\n");
    expect(
      urls.indexOf(
        "https://catalogue.cioos.ca/api/3/action/package_show?id=ff21-4d1e",
      ),
    ).toBe(urls.findIndex((line) => line.includes("/tabledap/")) + 1);
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
        formats,
        allFilters,
      ),
    );
    const [header, row] = csv.trim().split("\n");
    expect(header).toBe(
      '"dataset_id","title","source","format","filename","url","catalogue_url"',
    );
    expect(row).toContain('"Profiles, ""inshore"""');
  });
});
