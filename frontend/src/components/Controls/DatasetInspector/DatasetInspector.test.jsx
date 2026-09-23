import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import DatasetInspector from "./DatasetInspector.jsx";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";

// pk 2337 / "Chicago Park District" / "mooring" come from the catalog fixtures
// (e2e/fixtures/api/datasets.json, organizations.json, platforms.json) that
// FilterProvider loads, so the dataset this page is handed is one the catalog
// also knows — which is what the title bar's filter toggle needs.
//
// This passes `dataset` directly rather than through
// useSelection().setInspectDataset/inspectDataset — pointsData (what
// inspectDataset resolves against) comes from the /pointQuery fixture, a
// third, separately-recorded set with no pk 2337 in it. Driving the real
// open-a-dataset-page flow end to end is covered by AppShell.test.jsx; this
// file is about DatasetInspector's own rendering given a dataset, which is
// exactly what the direct prop lets it test independent of that mismatch.
const DATASET = {
  pk: 2337,
  title: "A weather station",
  platform: "mooring",
  cdm_data_type: "TimeSeries",
  organizations: ["Chicago Park District"],
  eovs: ["oxygen", "subSurfaceTemperature"],
  profiles_count: 1,
  n_profiles: 1,
  erddap_url: "https://erddap.example/tabledap/foo.html",
  ckan_url: null,
};

function Harness({ returnToList = () => {}, dataset = DATASET }) {
  const { catalogLoaded } = useFilters();
  const { showDownloadModal } = useUI();
  if (!catalogLoaded) return <span data-testid="state">loading</span>;

  return (
    <>
      <span data-testid="state">loaded</span>
      <span data-testid="download-modal-open">{String(showDownloadModal)}</span>
      <DatasetInspector
        dataset={dataset}
        returnToList={returnToList}
        setHoveredDataset={() => {}}
        setInspectRecordID={() => {}}
        query={{}}
        activeWmsOverlay={undefined}
        setActiveWmsOverlay={() => {}}
      />
    </>
  );
}

async function renderReady(props) {
  const result = renderWithProviders(<Harness {...props} />, {
    providers: "app",
  });
  await waitFor(() =>
    expect(screen.getByTestId("state")).toHaveTextContent("loaded"),
  );
  return result;
}

describe("DatasetInspector", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("renders the dataset's title as its heading", async () => {
    await renderReady();
    expect(
      screen.getByRole("heading", { level: 2, name: DATASET.title }),
    ).toBeInTheDocument();
  });

  it("shows organizations, ocean variables, geometry, platform and sources", async () => {
    await renderReady();
    expect(screen.getByText("Chicago Park District")).toBeInTheDocument();
    expect(screen.getByText("Oxygen")).toBeInTheDocument();
    expect(screen.getByText("subSurfaceTemperature")).toBeInTheDocument();
    // TimeSeries maps to the "Time series" data-layer label.
    expect(screen.getByText("Time series")).toBeInTheDocument();
    expect(screen.getByText("Mooring")).toBeInTheDocument();
    const erddapLink = screen.getByRole("link", { name: /Dataset/ });
    expect(erddapLink).toHaveAttribute("href", DATASET.erddap_url);
  });

  it("renders organization, variable and platform values as plain chips, not filter toggles", async () => {
    await renderReady();
    for (const value of ["Chicago Park District", "Oxygen", "Mooring"]) {
      const chip = screen.getByText(value);
      expect(chip).toHaveClass("metadataChip");
      expect(chip.closest("button")).toBeNull();
    }
    expect(screen.queryAllByTestId("filter-option")).toHaveLength(0);
  });

  it("filtering to an excluded dataset includes it instead of leaving it excluded", async () => {
    function ExcludedFlag() {
      const { datasetsSelected } = useFilters();
      const option = datasetsSelected.find((d) => d.pk === DATASET.pk);
      return <span data-testid="excluded">{String(!!option?.isExcluded)}</span>;
    }
    const { user } = renderWithProviders(
      <>
        <Harness />
        <ExcludedFlag />
      </>,
      { providers: "app", url: `/?excludeDatasetPKs=${DATASET.pk}` },
    );
    await waitFor(() =>
      expect(screen.getByTestId("excluded")).toHaveTextContent("true"),
    );
    const button = screen.getByRole("button", {
      pressed: false,
      name: /filter/i,
    });
    await user.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByTestId("excluded")).toHaveTextContent("false");
  });

  it("Download adds the dataset to the selection and opens the download", async () => {
    const { user } = await renderReady();
    expect(screen.getByTestId("download-modal-open")).toHaveTextContent(
      "false",
    );
    await user.click(screen.getByRole("button", { name: /Download/ }));
    await waitFor(() =>
      expect(screen.getByTestId("download-modal-open")).toHaveTextContent(
        "true",
      ),
    );
  });

  it("clicking Download again unchecks the dataset from the selection", async () => {
    const { user } = await renderReady();
    const button = screen.getByRole("button", { name: /Download/ });

    await user.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "true"));

    await user.click(button);
    await waitFor(() =>
      expect(button).toHaveAttribute("aria-pressed", "false"),
    );
  });

  it("disables Download for a griddap dataset, which has none", async () => {
    await renderReady({
      dataset: { ...DATASET, cdm_data_type: "Grid" },
    });
    expect(screen.getByRole("button", { name: /Download/ })).toBeDisabled();
  });

  it("shows the no-records message once the (empty) record list has loaded", async () => {
    await renderReady();
    await waitFor(() =>
      expect(
        screen.getByText("No records match your search."),
      ).toBeInTheDocument(),
    );
  });

  it("falls back to the generic Record ID label when the dataset names no cf_role variable", async () => {
    await renderReady();
    await waitFor(() =>
      expect(document.querySelector(".recordIdCaption")).toHaveTextContent(
        "Record ID",
      ),
    );
  });

  it("toggling the filter button calls setDatasetsSelected for this dataset's pk", async () => {
    const { user } = await renderReady();
    const button = screen.getByTitle("Filter the map to this dataset");
    await user.click(button);
    await waitFor(() =>
      expect(
        screen.getByTitle("Stop filtering the map to this dataset"),
      ).toBeInTheDocument(),
    );
  });

  it("Backspace calls returnToList, except while typing in a field", async () => {
    const returnToList = vi.fn();
    const { user } = await renderReady({ returnToList });
    await user.keyboard("{Backspace}");
    expect(returnToList).toHaveBeenCalledTimes(1);

    returnToList.mockClear();
    await user.click(screen.getByPlaceholderText("Search table"));
    await user.keyboard("{Backspace}");
    expect(returnToList).not.toHaveBeenCalled();
  });
});
