import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import * as React from "react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import DirectDownloadLinks from "./DirectDownloadLinks.jsx";

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
};

const query = {
  startDate: "2020-01-01",
  endDate: "2020-12-31",
  startDepth: 0,
  endDepth: 100,
};

const polygon = [
  [-140, 40],
  [-120, 40],
  [-120, 60],
  [-140, 60],
  [-140, 40],
];

// What the browser was handed to save. The component asks downloadTextFile for
// a Blob and an object URL; the setup file stubs createObjectURL globally, so
// this replaces that stub with one that keeps what it was given.
let saved;

function open(props = {}) {
  return renderWithProviders(
    <DirectDownloadLinks
      rows={[erddapRow, obisRow]}
      query={query}
      polygon={polygon}
      filterDownloadByTime
      filterDownloadByDepth
      filterDownloadByPolygon
      {...props}
    />,
  );
}

const button = (name) => screen.getByRole("button", { name });
const savedText = () => saved.at(-1).text();

describe("DirectDownloadLinks", () => {
  beforeEach(() => {
    saved = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      saved.push(blob);
      return "blob:test";
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("counts the links it would hand over", () => {
    open();
    expect(screen.getByTestId("direct-links")).toHaveTextContent("2 links");
  });

  it("writes a curl script carrying the map's filters", async () => {
    const { user } = open();
    await user.click(button(/curl script/i));

    const script = await savedText();
    expect(script.split("\n")[0]).toBe("#!/usr/bin/env bash");
    // The header states the filters the URLs were built from, so a script read
    // months later says what it is a download of.
    expect(script).toContain(
      "# Filters: time 2020-01-01 to 2020-12-31; depth 0 to 100 m; bbox -140, 40, -120, 60",
    );
    expect(script).toContain("/tabledap/ios_ctd_profiles.csv?&time%3E=");
    expect(script).toContain("api.obis.org");
  });

  it("rebuilds every link when the format changes", async () => {
    const { user } = open();
    await user.selectOptions(
      screen.getByTestId("direct-links-erddap-format").querySelector("select"),
      "parquet",
    );
    await user.click(button(/curl script/i));

    const script = await savedText();
    expect(script).toContain("/tabledap/ios_ctd_profiles.parquet?");
    expect(script).toContain(
      "'data-cioospacific-ca-erddap_ios_ctd_profiles.parquet'",
    );
  });

  it("fetches the catalogue record beside the data", async () => {
    const { user } = open();
    await user.click(button(/curl script/i));

    const script = await savedText();
    expect(script).toContain(
      "https://catalogue.cioos.ca/api/3/action/package_show?id=ff21-4d1e",
    );
    expect(script).toContain(".ckan.json");
  });

  it("has nothing extra to fetch for a dataset with no catalogue record", async () => {
    const { user } = open({ rows: [obisRow] });
    await user.click(button(/curl script/i));
    expect(await savedText()).not.toContain("package_show");
  });

  it("puts the URL list on the clipboard", async () => {
    const { user } = open();
    await user.click(button(/copy urls/i));

    const copied = await navigator.clipboard.readText();
    // Both data URLs, plus the catalogue record the ERDDAP dataset has.
    expect(copied.trim().split("\n")).toHaveLength(3);
    expect(
      await screen.findByRole("button", { name: /copied/i }),
    ).toBeVisible();
  });

  it("says what the links could not carry", () => {
    open({ rows: [{ ...erddapRow, has_depth: false }] });
    const panel = screen.getByTestId("direct-links");
    // The polygon became a bounding box, and a dataset with no depth variable
    // got a link without the depth constraint rather than one that 400s.
    expect(panel).toHaveTextContent(/bounding box/i);
    expect(panel).toHaveTextContent(/no depth variable/i);
  });

  it("stays quiet about filters that were carried in full", () => {
    open({
      rows: [erddapRow],
      polygon: undefined,
      filterDownloadByPolygon: false,
    });
    const panel = screen.getByTestId("direct-links");
    expect(panel).not.toHaveTextContent(/bounding box/i);
    expect(panel).not.toHaveTextContent(/depth variable/i);
  });

  it("has nothing to offer for an empty selection", () => {
    open({ rows: [] });
    expect(screen.getByTestId("direct-links")).toHaveTextContent(
      "No datasets selected",
    );
    expect(button(/curl script/i)).toBeDisabled();
    expect(button(/copy urls/i)).toBeDisabled();
  });
});
