import { describe, it, expect } from "vitest";

import {
  ERDDAP_FORMATS,
  buildDownloadLinks,
  downloadConstraints,
  erddapDownloadUrl,
  linksToCsv,
  localizedCkanUrl,
  localizedErddapUrl,
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
  erddap_url: "https://obis.org/dataset/5422689c-d83d-44e8-87f4-a4b0a5117181",
  archive_url: "https://ipt.example.org/archive.do?r=occurrences",
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
    expect(none).toEqual({
      startDate: undefined,
      endDate: undefined,
      startDepth: undefined,
      endDepth: undefined,
      polygon: false,
    });
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

  it("maps the clippable formats to their ERDDAP file type and passes the rest through", () => {
    expect(ERDDAP_FORMATS).toMatchObject({
      csv: "csv",
      parquet: "parquetWMeta",
      odv: "odvTxt",
      nccf: "ncCF",
      json: "json",
      mat: "mat",
    });
  });

  it("links a raw ERDDAP file type as itself", () => {
    expect(erddapDownloadUrl(erddapRow, ERDDAP_FORMATS.geoJson)).toContain(
      ".geoJson?",
    );
  });
});

describe("buildDownloadLinks", () => {
  it("routes each row to its own source", () => {
    const links = buildDownloadLinks([erddapRow, obisRow], "csv", allFilters);
    expect(links.map((link) => link.source)).toEqual(["erddap", "obis"]);
    expect(links[0].url).toContain("/tabledap/");
    expect(links[1].url).toBe(obisRow.archive_url);
  });

  it("asks ERDDAP for the package format's file type, OBIS for its DwC-A", () => {
    const [erddap, obis] = buildDownloadLinks(
      [erddapRow, obisRow],
      "parquet",
      allFilters,
    );
    expect(erddap.url).toContain("/tabledap/ios_ctd_profiles.parquetWMeta?");
    expect(obis.format).toBe("dwca");
    expect(obis.recordUrl).toBe(obisRow.erddap_url);
  });

  it("keeps an OBIS row with no harvested archive, linking only its record", () => {
    const [obis] = buildDownloadLinks(
      [{ ...obisRow, archive_url: null }],
      "csv",
      {},
    );
    expect(obis.url).toBeNull();
    expect(obis.recordUrl).toBe(obisRow.erddap_url);
  });

  it("flags every filter on an OBIS archive, which is the whole dataset", () => {
    const [obis] = buildDownloadLinks([obisRow], "csv", {
      ...allFilters,
      polygon: true,
    });
    expect(obis.unapplied).toEqual(["time", "depth", "polygon"]);
    const [whole] = buildDownloadLinks([obisRow], "csv", {});
    expect(whole.unapplied).toEqual([]);
  });

  it("flags a polygon on ERDDAP links, which carry time and depth only", () => {
    const [erddap] = buildDownloadLinks([erddapRow], "csv", {
      ...allFilters,
      polygon: true,
    });
    expect(erddap.unapplied).toEqual(["polygon"]);
  });

  it("skips grids, which have no constraint-based subsetting", () => {
    const links = buildDownloadLinks(
      [{ ...erddapRow, cdm_data_type: "Grid" }],
      "csv",
      allFilters,
    );
    expect(links).toEqual([]);
  });

  it("flags a depth filter the link could not carry", () => {
    const [depthless] = buildDownloadLinks(
      [{ ...erddapRow, has_depth: false }],
      "csv",
      allFilters,
    );
    expect(depthless.unapplied).toEqual(["depth"]);
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

describe("linksToCsv", () => {
  const links = buildDownloadLinks([erddapRow, obisRow], "csv", allFilters);

  it("lists each dataset's query, catalogue page, licence and citation", () => {
    const csv = linksToCsv(links, [
      {
        pk: 1,
        license: "CC-BY 4.0",
        license_url: "https://cc.org/by/4.0",
        citation: "IOS (2020). CTD.",
      },
    ]);
    const [header, erddap, obis] = csv.trim().split("\n");
    expect(header).toBe(
      '"dataset_id","title","source","format","download_url","filters_not_applied","record_url","catalogue_url","license","license_url","citation"',
    );
    expect(erddap).toBe(
      `"ios_ctd_profiles","IOS CTD Profiles","erddap","csv","${links[0].url}","","","https://catalogue.cioos.ca/dataset/ff21-4d1e","CC-BY 4.0","https://cc.org/by/4.0","IOS (2020). CTD."`,
    );
    // No catalogue entry and no citation answer: empty cells, not a dropped row.
    expect(obis.endsWith(',"","","",""')).toBe(true);
  });

  it("keeps a cell whole across commas and quotes", () => {
    const csv = linksToCsv(
      buildDownloadLinks(
        [{ ...erddapRow, title: 'Profiles, "inshore"' }],
        "csv",
        allFilters,
      ),
    );
    expect(csv.trim().split("\n")[1]).toContain('"Profiles, ""inshore"""');
  });
});
