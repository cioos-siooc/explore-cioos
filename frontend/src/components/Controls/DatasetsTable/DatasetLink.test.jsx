import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import * as React from "react";
import { useTranslation } from "react-i18next";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import DatasetLink from "./DatasetLink.jsx";
import {
  buildDownloadLinks,
  defaultErddapFormat,
  defaultObisFormat,
  downloadConstraints,
} from "../../../downloadLinks.js";

const dataset = {
  pk: 1,
  dataset_id: "ios_ctd_profiles",
  title: "IOS CTD Profiles",
  source_type: "erddap",
  erddap_server_url: "https://data.cioospacific.ca/erddap",
  cdm_data_type: "Profile",
  has_depth: true,
};

// A drawn polygon and a depth filter, both carried into the download: the
// state that makes an ERDDAP link wider than the selection on screen.
const constraints = downloadConstraints({
  query: { startDepth: 0, endDepth: 100 },
  polygon: [
    [-140, 40],
    [-120, 40],
    [-120, 60],
    [-140, 60],
    [-140, 40],
  ],
  byDepth: true,
  byPolygon: true,
});

const linkFor = (overrides) =>
  buildDownloadLinks(
    [{ ...dataset, ...overrides }],
    { erddapFormat: defaultErddapFormat, obisFormat: defaultObisFormat },
    constraints,
  )[0];

// DatasetCard is handed `t` by the list that renders it, and passes it on.
function Subject({ link }) {
  const { t } = useTranslation();
  return <DatasetLink link={link} t={t} />;
}

const open = (overrides) =>
  renderWithProviders(<Subject link={linkFor(overrides)} />);

describe("DatasetLink", () => {
  it("shows the dataset's own download URL and what it returns", () => {
    open();
    expect(screen.getByTitle(/^https/).textContent).toContain(
      "data.cioospacific.ca/erddap/tabledap/ios_ctd_profiles.csv",
    );
    expect(screen.getByText("CSV")).toBeTruthy();
  });

  it("copies that one URL", async () => {
    const { user } = open();
    await user.click(screen.getByLabelText("Copy this URL"));
    expect(await navigator.clipboard.readText()).toContain(
      "tabledap/ios_ctd_profiles.csv",
    );
  });

  it("opens the link in a new tab rather than in the modal", () => {
    open();
    const anchor = screen.getByLabelText("Open in a new tab");
    expect(anchor.getAttribute("target")).toBe("_blank");
    expect(anchor.getAttribute("href")).toContain("ios_ctd_profiles.csv");
  });

  it("says where the link is wider than the selection on screen", () => {
    // A drawn polygon becomes a bounding box on ERDDAP, and the depth filter
    // cannot be carried by a dataset with no depth variable.
    open({ has_depth: false });
    expect(screen.getAllByText(/bounding box|no depth/)).toHaveLength(2);
  });
});
