import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import * as React from "react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import DownloadScript from "./DownloadScript.jsx";
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
};

const query = {
  startDate: "2020-01-01",
  endDate: "2020-12-31",
  startDepth: 0,
  endDepth: 100,
};

// Replaces the setup file's global createObjectURL stub with one that keeps
// the Blob it was given.
let saved;

// Stands in for DownloadDetails, which builds the links from the package
// format and the time/depth switches, and drops them under a polygon.
function Harness({
  rows = [erddapRow, obisRow],
  format = "csv",
  polygonFiltered = false,
}) {
  const constraints = downloadConstraints({
    query,
    byTime: true,
    byDepth: true,
  });
  const links = polygonFiltered
    ? []
    : buildDownloadLinks(rows, format, constraints);
  return (
    <DownloadScript
      url="/api/download/script?datasetPKs=1,2&format=csv"
      count={rows.length}
      links={links}
      constraints={constraints}
      polygonFiltered={polygonFiltered}
    />
  );
}

function open(props = {}) {
  return renderWithProviders(<Harness {...props} />);
}

const button = (name) => screen.getByRole("button", { name });
async function saveAs(user, name) {
  await user.click(button(/script or links/i));
  await user.click(button(name));
}
const savedText = () => saved.at(-1).text();

describe("DownloadScript", () => {
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

  it("saves the Python script from the package's script URL", async () => {
    const clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function () {
        clicked.push(this.getAttribute("href"));
      },
    );
    const { user } = open();
    await saveAs(user, /python script/i);
    expect(clicked).toEqual(["/api/download/script?datasetPKs=1,2&format=csv"]);
  });

  it("offers only the Python script under a polygon filter, and says why", async () => {
    const { user } = open({ polygonFiltered: true });
    expect(screen.getByTestId("download-script")).toHaveTextContent(
      /only the Python script/i,
    );
    await user.click(button(/script or links/i));
    expect(button(/python script/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: /curl/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /copy urls/i })).toBeNull();
  });

  it("writes a curl script carrying the map's filters", async () => {
    const { user } = open();
    await saveAs(user, /curl script/i);

    const script = await savedText();
    expect(script.split("\n")[0]).toBe("#!/usr/bin/env bash");
    expect(script).toContain(
      "# Filters: time 2020-01-01 to 2020-12-31; depth 0 to 100 m",
    );
    expect(script).toContain("/tabledap/ios_ctd_profiles.csv?&time%3E=");
    expect(script).toContain("api.obis.org");
  });

  it("fetches the package's format", async () => {
    const { user } = open({ format: "parquet" });
    await saveAs(user, /curl script/i);

    const script = await savedText();
    expect(script).toContain("/tabledap/ios_ctd_profiles.parquetWMeta?");
    expect(script).toContain(
      "'data/ios_ctd_profiles_data_cioospacific_ca/ios_ctd_profiles_data_cioospacific_ca.parquet'",
    );
  });

  it("fetches the catalogue record beside the data", async () => {
    const { user } = open();
    await saveAs(user, /curl script/i);

    const script = await savedText();
    expect(script).toContain(
      "https://catalogue.cioos.ca/api/3/action/package_show?id=ff21-4d1e",
    );
    expect(script).toContain("/ckan_package.json");
  });

  it("has nothing extra to fetch for a dataset with no catalogue record", async () => {
    const { user } = open({ rows: [obisRow] });
    await saveAs(user, /curl script/i);
    expect(await savedText()).not.toContain("package_show");
  });

  it("puts the URL list on the clipboard", async () => {
    const { user } = open();
    await saveAs(user, /copy urls/i);

    const copied = await navigator.clipboard.readText();
    expect(copied.trim().split("\n")).toHaveLength(5);
    expect(await screen.findByText("URLs copied.")).toBeVisible();
  });

  it("says what the links could not carry", () => {
    open({ rows: [{ ...erddapRow, has_depth: false }, obisRow] });
    const panel = screen.getByTestId("download-script");
    expect(panel).toHaveTextContent(/no depth variable/i);
    expect(panel).toHaveTextContent(/OBIS API/i);
  });

  it("stays quiet about filters that were carried in full", () => {
    open({ rows: [erddapRow] });
    const panel = screen.getByTestId("download-script");
    expect(panel).not.toHaveTextContent(/depth variable/i);
    expect(panel).not.toHaveTextContent(/OBIS/i);
  });

  it("has nothing to offer for an empty selection", () => {
    open({ rows: [] });
    expect(screen.getByTestId("download-script")).toHaveTextContent(
      "No datasets selected",
    );
    expect(button(/script or links/i)).toBeDisabled();
  });
});
