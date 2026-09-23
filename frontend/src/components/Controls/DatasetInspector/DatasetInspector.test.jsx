import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";

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

function Harness({
  returnToList = () => {},
  dataset = DATASET,
  setInspectRecordID = () => {},
  selectedTrajectory,
  setSelectedTrajectory = () => {},
}) {
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
        setInspectRecordID={setInspectRecordID}
        query={{}}
        selectedTrajectory={selectedTrajectory}
        setSelectedTrajectory={setSelectedTrajectory}
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
  // A trajectory dataset used to get TWO card lists holding the same ids: a
  // "Platforms / Trajectories" section that drew a track on the map, above a
  // record list that opened the plot. The first one is what the user reached,
  // so a trajectory's graph and table were effectively unreachable.
  describe("a trajectory dataset's records", () => {
    const TRAJECTORY_DATASET = {
      ...DATASET,
      cdm_data_type: "Trajectory",
      trajectory_id_variable: "surveyID",
    };
    const RECORDS = [
      {
        profile_id: "Mai21",
        time_min: "2021-05-24T18:54:00Z",
        time_max: "2021-05-24T20:38:00Z",
        depth_min: 0,
        depth_max: 0,
        eovs: null,
      },
      {
        profile_id: "Oct22_1",
        time_min: "2022-10-25T17:42:00Z",
        time_max: "2022-10-25T19:30:00Z",
        depth_min: 0,
        depth_max: 0,
        eovs: null,
      },
    ];
    const PLATFORMS = [
      { trajectory_id: "Mai21", n_points: 9 },
      { trajectory_id: "Oct22_1", n_points: 12 },
    ];

    // The two endpoints this page joins have no fixture with rows in it, and a
    // recorded one per query would key on the whole filter string. Answer them
    // here and let the mock serve everything else.
    function serveRecords() {
      installMockFetch();
      const fixtures = globalThis.fetch;
      const json = (body) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input, init) => {
          const url = typeof input === "string" ? input : input.url;
          if (url.includes("/datasetRecordsList"))
            return json({ profiles: RECORDS });
          if (url.includes("/trajectories/platforms")) return json(PLATFORMS);
          return fixtures(input, init);
        }),
      );
    }

    // The cards carrying this id. One per list the page draws it in — which is
    // the whole point of the first test below.
    const cardsNamed = (id) =>
      waitFor(() => {
        const cards = screen
          .getAllByTitle(id)
          .map((label) => label.closest(".listCard"));
        expect(cards.length).toBeGreaterThan(0);
        return cards;
      });

    it("are listed once, not once per section", async () => {
      serveRecords();
      await renderReady({ dataset: TRAJECTORY_DATASET });
      expect(await cardsNamed("Mai21")).toHaveLength(1);
      expect(screen.getAllByTitle("Oct22_1")).toHaveLength(1);
      // The fixes count the platform list used to carry, kept on the one card.
      expect(screen.getByText("9")).toBeInTheDocument();
    });

    it("open the preview when the card is clicked", async () => {
      serveRecords();
      const setInspectRecordID = vi.fn();
      const { user } = await renderReady({
        dataset: TRAJECTORY_DATASET,
        setInspectRecordID,
      });
      await user.click((await cardsNamed("Mai21"))[0]);
      expect(setInspectRecordID).toHaveBeenCalledWith("Mai21");
    });

    it("draw the track from the card's own control, without opening anything", async () => {
      serveRecords();
      const setInspectRecordID = vi.fn();
      const setSelectedTrajectory = vi.fn();
      const { user } = await renderReady({
        dataset: TRAJECTORY_DATASET,
        setInspectRecordID,
        setSelectedTrajectory,
      });
      const [card] = await cardsNamed("Mai21");
      await user.click(
        within(card).getByLabelText("Draw this track on the map"),
      );
      expect(setSelectedTrajectory).toHaveBeenCalledWith({
        datasetPk: TRAJECTORY_DATASET.pk,
        datasetTitle: TRAJECTORY_DATASET.title,
        trajectoryId: "Mai21",
        frameView: true,
      });
      // The control is inside the card, so its click must not also navigate.
      expect(setInspectRecordID).not.toHaveBeenCalled();
    });

    it("clear the drawn track when its control is pressed again", async () => {
      serveRecords();
      const setSelectedTrajectory = vi.fn();
      const { user } = await renderReady({
        dataset: TRAJECTORY_DATASET,
        selectedTrajectory: {
          datasetPk: TRAJECTORY_DATASET.pk,
          trajectoryId: "Mai21",
        },
        setSelectedTrajectory,
      });
      const [card] = await cardsNamed("Mai21");
      const control = within(card).getByLabelText(
        "Clear this track from the map",
      );
      expect(control).toHaveAttribute("aria-pressed", "true");
      await user.click(control);
      expect(setSelectedTrajectory).toHaveBeenCalledWith(undefined);
    });

    it("carry no track control on a dataset that is not a trajectory", async () => {
      serveRecords();
      await renderReady();
      await cardsNamed("Mai21");
      expect(
        screen.queryByLabelText("Draw this track on the map"),
      ).not.toBeInTheDocument();
    });
  });
});
