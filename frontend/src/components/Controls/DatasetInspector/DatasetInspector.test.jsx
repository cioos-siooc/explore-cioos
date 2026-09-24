import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import DatasetInspector from "./DatasetInspector.jsx";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";

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

function Harness({
  returnToList = () => {},
  dataset = DATASET,
  setInspectRecordID = () => {},
}) {
  const { catalogLoaded } = useFilters();
  const { showDownloadModal } = useUI();
  const [selectedTrajectory, setSelectedTrajectory] = React.useState();
  const { mappedRecord } = useSelection();
  if (!catalogLoaded) return <span data-testid="state">loading</span>;

  return (
    <>
      <span data-testid="state">loaded</span>
      <span data-testid="download-modal-open">{String(showDownloadModal)}</span>
      <span data-testid="mapped-record">
        {mappedRecord?.recordId ?? "none"}
      </span>
      <span data-testid="drawn-track">
        {selectedTrajectory?.trajectoryId ?? "none"}
      </span>
      <DatasetInspector
        dataset={dataset}
        returnToList={returnToList}
        setHoveredDataset={() => {}}
        setInspectRecordID={setInspectRecordID}
        selectedTrajectory={selectedTrajectory}
        setSelectedTrajectory={setSelectedTrajectory}
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

  it("shows the no-features message once the (empty) feature list has loaded", async () => {
    await renderReady();
    await waitFor(() =>
      expect(
        screen.getByText("No features match your search."),
      ).toBeInTheDocument(),
    );
  });

  it("falls back to the generic Feature ID label when the dataset names no cf_role variable", async () => {
    await renderReady();
    await waitFor(() =>
      expect(document.querySelector(".recordIdCaption")).toHaveTextContent(
        "Feature ID",
      ),
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

  describe("a trajectory dataset", () => {
    const TRAJECTORY_DATASET = {
      ...DATASET,
      cdm_data_type: "Trajectory",
      trajectory_id_variable: "cruise",
    };

    beforeEach(() => {
      const fixtureFetch = globalThis.fetch;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input) => {
          if (!String(input).includes("/datasetRecordsList")) {
            return fixtureFetch(input);
          }
          return new Response(
            JSON.stringify({
              profiles: [
                { profile_id: "cruise-a", time_min: "2020-01-01T00:00:00Z" },
                { profile_id: "cruise-b", time_min: "2021-01-01T00:00:00Z" },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }),
      );
    });

    it("lists its trajectories once, as the record list", async () => {
      await renderReady({ dataset: TRAJECTORY_DATASET });
      await screen.findByText("cruise-a");
      expect(document.querySelectorAll(".recordSection")).toHaveLength(1);
      expect(screen.getAllByText("cruise-b")).toHaveLength(1);
    });

    it("Show on map draws that trajectory's track, and clears it again, without opening the preview", async () => {
      const setInspectRecordID = vi.fn();
      const { user } = await renderReady({
        dataset: TRAJECTORY_DATASET,
        setInspectRecordID,
      });
      const card = (await screen.findByText("cruise-b")).closest(".listCard");
      const show = within(card).getByRole("button", { name: /Show on map/ });

      await user.click(show);
      expect(screen.getByTestId("drawn-track")).toHaveTextContent("cruise-b");
      expect(show).toHaveAttribute("aria-pressed", "true");
      expect(card).toHaveClass("selected");

      await user.click(show);
      expect(screen.getByTestId("drawn-track")).toHaveTextContent("none");
      expect(setInspectRecordID).not.toHaveBeenCalled();
    });

    it("clicking the card itself opens its preview", async () => {
      const setInspectRecordID = vi.fn();
      const { user } = await renderReady({
        dataset: TRAJECTORY_DATASET,
        setInspectRecordID,
      });
      await user.click(await screen.findByText("cruise-a"));
      expect(setInspectRecordID).toHaveBeenCalledWith("cruise-a");
      expect(screen.getByTestId("drawn-track")).toHaveTextContent("none");
    });
  });

  it("Show on map on a time-series record rings it on the map, and clears it again", async () => {
    const fixtureFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) =>
        String(input).includes("/datasetRecordsList?")
          ? new Response(
              JSON.stringify({ profiles: [{ profile_id: "station-7" }] }),
              { status: 200, headers: { "content-type": "application/json" } },
            )
          : fixtureFetch(input),
      ),
    );
    const { user } = await renderReady();
    const card = (await screen.findByText("station-7")).closest(".listCard");
    const show = within(card).getByRole("button", { name: /Show on map/ });

    await user.click(show);
    expect(screen.getByTestId("mapped-record")).toHaveTextContent("station-7");
    expect(show).toHaveAttribute("aria-pressed", "true");
    expect(card).toHaveClass("selected");

    await user.click(show);
    expect(screen.getByTestId("mapped-record")).toHaveTextContent("none");
  });
});
