import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import * as React from "react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import DirectDownloadLinks from "./DirectDownloadLinks.jsx";
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
// format and the time/depth switches.
function Harness({ rows = [erddapRow, obisRow], format = "csv" }) {
  const constraints = downloadConstraints({
    query,
    byTime: true,
    byDepth: true,
  });
  const links = buildDownloadLinks(rows, format, constraints);
  return <DirectDownloadLinks links={links} constraints={constraints} />;
}

function open(props = {}) {
  return renderWithProviders(<Harness {...props} />);
}

const button = (name) => screen.getByRole("button", { name });
async function saveAs(user, name) {
  await user.click(button(/save as/i));
  await user.click(button(name));
}
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
      "'ios_ctd_profiles_data_cioospacific_ca/ios_ctd_profiles_data_cioospacific_ca.parquet'",
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
    await user.click(button(/copy urls/i));

    const copied = await navigator.clipboard.readText();
    expect(copied.trim().split("\n")).toHaveLength(5);
    expect(
      await screen.findByRole("button", { name: /copied/i }),
    ).toBeVisible();
  });

  it("says what the links could not carry", () => {
    open({ rows: [{ ...erddapRow, has_depth: false }, obisRow] });
    const panel = screen.getByTestId("direct-links");
    expect(panel).toHaveTextContent(/no depth variable/i);
    expect(panel).toHaveTextContent(/OBIS API/i);
  });

  it("stays quiet about filters that were carried in full", () => {
    open({ rows: [erddapRow] });
    const panel = screen.getByTestId("direct-links");
    expect(panel).not.toHaveTextContent(/depth variable/i);
    expect(panel).not.toHaveTextContent(/OBIS/i);
  });

  it("has nothing to offer for an empty selection", () => {
    open({ rows: [] });
    expect(screen.getByTestId("direct-links")).toHaveTextContent(
      "No datasets selected",
    );
    expect(button(/save as/i)).toBeDisabled();
    expect(button(/copy urls/i)).toBeDisabled();
  });
});
