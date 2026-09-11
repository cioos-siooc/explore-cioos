import { describe, it, expect, vi, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import * as React from "react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import DownloadExports from "./DownloadExports.jsx";
import {
  buildDownloadLinks,
  defaultErddapFormat,
  defaultObisFormat,
  downloadConstraints,
} from "../../../downloadLinks.js";

const erddapDataset = {
  pk: 1,
  dataset_id: "ios_ctd_profiles",
  title: "IOS CTD Profiles",
  source_type: "erddap",
  erddap_server_url: "https://data.cioospacific.ca/erddap",
  cdm_data_type: "Profile",
  has_depth: true,
};

const obisDataset = {
  pk: 2,
  dataset_id: "5422689c-d83d-44e8-87f4-a4b0a5117181",
  title: "Benthic occurrences",
  source_type: "obis",
  erddap_server_url: "https://obis.org",
  cdm_data_type: "Point",
};

// A selection narrowed by all three filters, with every switch carrying it
// into the download — the state DownloadPanel hands this component.
const constraints = downloadConstraints({
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

const links = buildDownloadLinks(
  [erddapDataset, obisDataset],
  { erddapFormat: defaultErddapFormat, obisFormat: defaultObisFormat },
  constraints,
);

const open = (overrides = {}) =>
  renderWithProviders(
    <DownloadExports links={links} constraints={constraints} {...overrides} />,
  );

afterEach(() => vi.restoreAllMocks());

describe("DownloadExports", () => {
  it("says how many links 'all' is the whole of", () => {
    open();
    expect(screen.getByTestId("download-exports")).toHaveTextContent(
      "2 download links",
    );
  });

  it("copies the whole list, one URL per line", async () => {
    const { user } = open();
    await user.click(screen.getByText("Copy all URLs"));
    // userEvent installs its own clipboard, so the copied text is read back
    // through that rather than through a mock replacing it underneath.
    const copied = (await navigator.clipboard.readText()).trim().split("\n");
    expect(copied).toHaveLength(2);
    expect(copied.every((line) => line.startsWith("https://"))).toBe(true);
    expect(screen.getByText("Copied")).toBeTruthy();
  });

  it("hands over a runnable script, named so it can be run as one", async () => {
    const saved = [];
    const blobs = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      blobs.push(blob);
      return "blob:test";
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function click() {
        saved.push(this.download);
      },
    );

    const { user } = open();
    await user.click(screen.getByText("curl script (.sh)"));

    expect(saved).toEqual(["cde-download.sh"]);
    const script = await blobs[0].text();
    expect(script).toContain("#!/usr/bin/env bash");
    // The filters the file was built under, stamped in its header.
    expect(script).toContain("2020-01-01 – 2020-12-31");
  });

  it("stays out of the order bar when nothing can be linked to", () => {
    open({ links: [] });
    expect(screen.queryByTestId("download-exports")).toBeNull();
  });
});
