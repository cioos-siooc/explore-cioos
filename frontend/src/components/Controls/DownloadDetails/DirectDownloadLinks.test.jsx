import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import * as React from "react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import DirectDownloadLinks from "./DirectDownloadLinks.jsx";
import DownloadFormats from "./DownloadFormats.jsx";
import {
  buildDownloadLinks,
  defaultErddapFormat,
  defaultObisFormat,
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

// Deliberately not a rectangle — the notch at the top is what makes the ERDDAP
// links a squared-off approximation of it, which is the caveat the strip warns
// about. Its extent is still -140,40 to -120,60, which the export headers
// below quote.
const polygon = [
  [-140, 40],
  [-120, 40],
  [-120, 60],
  [-130, 55],
  [-140, 60],
  [-140, 40],
];

// The same extent drawn with the rectangle tool: its bounding box IS the
// selection, so nothing was squared off.
const rectangle = [
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

// The links column is handed its links rather than building them
// (DownloadDetails owns that, so the cards above can show the same ones), and
// the format pickers that decide what the links ask for now live on the
// datasets toolbar. This stands in for that parent: the same rows and filters,
// and the one piece of format state the pickers drive and the exports read —
// which is the pairing these tests are about.
function Harness({
  rows = [erddapRow, obisRow],
  polygon: shape = polygon,
  filterDownloadByPolygon = true,
}) {
  const [erddapFormat, setErddapFormat] = React.useState(defaultErddapFormat);
  const [obisFormat, setObisFormat] = React.useState(defaultObisFormat);
  const constraints = downloadConstraints({
    query,
    polygon: shape,
    byTime: true,
    byDepth: true,
    byPolygon: filterDownloadByPolygon,
  });
  const links = buildDownloadLinks(
    rows,
    { erddapFormat, obisFormat },
    constraints,
  );
  return (
    <>
      <DownloadFormats
        links={links}
        erddapFormat={erddapFormat}
        setErddapFormat={setErddapFormat}
        obisFormat={obisFormat}
        setObisFormat={setObisFormat}
      />
      <DirectDownloadLinks links={links} constraints={constraints} />
    </>
  );
}

function open(props = {}) {
  return renderWithProviders(<Harness {...props} />);
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
    expect(panel).toHaveTextContent(/latitude\/longitude box/i);
    expect(panel).toHaveTextContent(/no depth variable/i);
  });

  it("warns about the box for a rectangle too, which is also one", () => {
    open({ rows: [erddapRow], polygon: rectangle });
    expect(screen.getByTestId("direct-links")).toHaveTextContent(
      /latitude\/longitude box/i,
    );
  });

  it("stays quiet about filters that were carried in full", () => {
    open({
      rows: [erddapRow],
      polygon: undefined,
      filterDownloadByPolygon: false,
    });
    const panel = screen.getByTestId("direct-links");
    expect(panel).not.toHaveTextContent(/latitude\/longitude box/i);
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
