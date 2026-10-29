import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import * as React from "react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import DownloadLinks from "./DownloadLinks.jsx";
import {
  buildDownloadLinks,
  downloadConstraints,
} from "../../../downloadLinks.js";

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
  dataset_id: "5422689c",
  title: "Some occurrences",
  source_type: "obis",
  erddap_server_url: "https://obis.org",
  cdm_data_type: "Point",
  erddap_url: "https://obis.org/dataset/5422689c",
  archive_url: "https://ipt.example.org/archive.do?r=occurrences",
};

const query = {
  startDate: "2020-01-01",
  endDate: "2020-12-31",
  startDepth: 0,
  endDepth: 100,
};

const citations = [
  {
    pk: 1,
    license: "CC-BY 4.0",
    license_url: "https://cc.org/by/4.0",
    citation: "IOS (2020). CTD.",
  },
];

// Replaces the setup file's global createObjectURL stub with one that keeps
// the Blob it was given.
let saved;

// Stands in for DownloadDetails, which builds the links from the package
// format and the time/depth/polygon switches.
function Harness({
  rows = [erddapRow, obisRow],
  polygonFiltered = false,
  filtered = true,
}) {
  const constraints = downloadConstraints({
    query,
    byTime: filtered,
    byDepth: filtered,
    byPolygon: polygonFiltered,
  });
  const links = buildDownloadLinks(rows, "csv", constraints);
  return (
    <DownloadLinks
      count={rows.length}
      links={links}
      polygonFiltered={polygonFiltered}
    />
  );
}

function open(props = {}) {
  return renderWithProviders(<Harness {...props} />);
}

const csvButton = () => screen.getByRole("button", { name: /dataset list/i });
const panel = () => screen.getByTestId("download-links");

describe("DownloadLinks", () => {
  beforeEach(() => {
    saved = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      saved.push(blob);
      return "blob:test";
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(citations))),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("saves a CSV of each dataset's download, record, catalogue page, licence and citation", async () => {
    const { user } = open();
    await user.click(csvButton());

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(fetch.mock.calls[0][0]).toMatch(
      /\/datasets\/citations\?datasetPKs=1,2&lang=\w+$/,
    );
    const [header, erddap, obis] = (await saved[0].text()).trim().split("\n");
    expect(header).toContain(
      '"download_url","filters_not_applied","record_url","catalogue_url","license"',
    );
    expect(erddap).toContain("/tabledap/ios_ctd_profiles.csv?&time%3E=");
    expect(erddap).toContain('"CC-BY 4.0","https://cc.org/by/4.0"');
    expect(erddap).toContain('"IOS (2020). CTD."');
    expect(obis).toContain(
      '"https://ipt.example.org/archive.do?r=occurrences","time depth","https://obis.org/dataset/5422689c"',
    );
    expect(obis).not.toContain("api.obis.org");
  });

  it("saves nothing and says so when the citations can't be fetched", async () => {
    fetch.mockResolvedValueOnce(new Response("", { status: 500 }));
    const { user } = open();
    await user.click(csvButton());

    expect(await screen.findByText(/couldn't build/i)).toBeVisible();
    expect(saved).toEqual([]);
    expect(csvButton()).toBeEnabled();
  });

  it("is still offered under a polygon filter, flagged as not applying it", () => {
    open({ polygonFiltered: true });
    expect(panel()).toHaveTextContent(/polygon isn't applied/i);
    expect(csvButton()).toBeEnabled();
  });

  it("says what the links could not carry", () => {
    open({ rows: [{ ...erddapRow, has_depth: false }, obisRow] });
    expect(panel()).toHaveTextContent(/no depth variable/i);
    expect(panel()).toHaveTextContent(/whole Darwin Core Archive/i);
  });

  it("says nothing of OBIS archives when no filter subsets the request", () => {
    open({ rows: [obisRow], filtered: false });
    expect(panel()).not.toHaveTextContent(/filters aren.t applied/i);
  });

  it("stays quiet about filters that were carried in full", () => {
    open({ rows: [erddapRow] });
    expect(panel()).not.toHaveTextContent(/depth variable/i);
    expect(panel()).not.toHaveTextContent(/filters aren.t applied/i);
  });

  it("has nothing to offer for an empty selection", () => {
    open({ rows: [] });
    expect(panel()).toHaveTextContent("No datasets selected");
    expect(csvButton()).toBeDisabled();
  });
});
