import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import DatasetsTable from "./DatasetsTable.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import translationFR from "../../../locales/fr/translation.json";

function makeRow(overrides) {
  return {
    pk: 1,
    title: "Alpha station",
    platform: "mooring",
    cdm_data_type: "TimeSeries",
    profiles_count: 1,
    n_profiles: 1,
    organizations: [],
    ...overrides,
  };
}

let filters;
function FiltersProbe() {
  filters = useFilters();
  return null;
}

const ROWS = [
  makeRow({ pk: 1, title: "Beta station", profiles_count: 5, n_profiles: 5 }),
  makeRow({ pk: 2, title: "Alpha station", profiles_count: 2, n_profiles: 2 }),
  makeRow({
    pk: 3,
    title: "Gamma grid",
    cdm_data_type: "Grid",
    grid_dimensions: [],
  }),
];

describe("DatasetsTable (standalone rows, sidebar context)", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("renders one card per dataset, sorted by title ascending by default", async () => {
    renderWithProviders(
      <DatasetsTable
        datasets={ROWS}
        selectAll={false}
        handleSelectAllDatasets={() => {}}
        handleSelectDataset={() => {}}
      />,
      { providers: "app" },
    );
    const cards = await screen.findAllByTestId("dataset-card");
    expect(
      cards.map((c) => c.querySelector(".datasetCardTitle").textContent),
    ).toEqual(["Alpha station", "Beta station", "Gamma grid"]);
  });

  it("sorts by days of data, grids included", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <DatasetsTable
        datasets={[
          makeRow({ pk: 1, title: "Short", days: 12 }),
          makeRow({ pk: 2, title: "Long", days: 3650 }),
          makeRow({
            pk: 3,
            title: "Grid",
            cdm_data_type: "Grid",
            grid_dimensions: [],
            days: 400,
          }),
        ]}
        selectAll={false}
        handleSelectAllDatasets={() => {}}
        handleSelectDataset={() => {}}
      />,
      { providers: "app" },
    );
    await user.selectOptions(
      await screen.findByLabelText("Sort"),
      "Days of data",
    );
    await user.click(screen.getByTitle("Sorted ascending (tap to reverse)"));
    const cards = screen.getAllByTestId("dataset-card");
    expect(
      cards.map((c) => c.querySelector(".datasetCardTitle").textContent),
    ).toEqual(["Long", "Grid", "Short"]);
    expect(cards[0]).toHaveTextContent("3,650");
  });

  it("labels and sorts types in the reader's language", async () => {
    const { i18n, user } = renderWithProviders(
      <DatasetsTable
        datasets={[
          makeRow({ pk: 1, title: "A", cdm_data_type: "Profile" }),
          makeRow({ pk: 2, title: "B", cdm_data_type: "TimeSeries" }),
          makeRow({ pk: 3, title: "C", cdm_data_type: "TrajectoryProfile" }),
        ]}
        selectAll={false}
        handleSelectAllDatasets={() => {}}
        handleSelectDataset={() => {}}
      />,
      { providers: "app" },
    );
    await screen.findAllByTestId("dataset-card");
    // The test i18n instance only carries the English bundle.
    await act(async () => {
      i18n.addResourceBundle("fr", "translation", translationFR);
      await i18n.changeLanguage("fr");
    });
    expect(screen.getAllByTitle("Type").map((el) => el.textContent)).toEqual([
      "Profil",
      "Série temporelle",
      "Profil de trajectoire",
    ]);

    await user.selectOptions(await screen.findByLabelText("Tri"), "Type");
    expect(
      screen
        .getAllByTestId("dataset-card")
        .map((c) => c.querySelector(".datasetCardTitle").textContent),
    ).toEqual(["A", "C", "B"]);
  });

  // The list has no search of its own; its Filters button opens the modal's.
  it("the Filters button opens the Filters modal's search", async () => {
    let ui;
    function Probe() {
      ui = useUI();
      return null;
    }
    const user = userEvent.setup({ delay: null });
    renderWithProviders(
      <>
        <DatasetsTable
          datasets={ROWS}
          selectAll={false}
          handleSelectAllDatasets={() => {}}
          handleSelectDataset={() => {}}
        />
        <Probe />
      </>,
      { providers: "app" },
    );
    await screen.findAllByTestId("dataset-card");
    await user.click(screen.getByTestId("datasets-filters-button"));

    expect(ui.showFiltersModal).toBe(true);
    expect(ui.openFilter).toBeUndefined();
  });

  it("shows the no-results message when the datasets prop is empty", async () => {
    renderWithProviders(
      <DatasetsTable
        datasets={[]}
        selectAll={false}
        handleSelectAllDatasets={() => {}}
        handleSelectDataset={() => {}}
      />,
      { providers: "app" },
    );
    expect(
      await screen.findByText("No datasets match your search."),
    ).toBeInTheDocument();
  });

  // Sidebar selection persists through SelectionProvider's own selectedPks
  // rather than a bulk toggle — a row selects itself into the shortlist, and
  // there is no sidebar-wide "select all" (that control is download-modal
  // only, where handleSelectAllDatasets/selectAll still apply).
  it("clicking a card's own select checkbox calls handleSelectDataset with that row", async () => {
    const handleSelectDataset = vi.fn();
    const { user } = renderWithProviders(
      <DatasetsTable
        datasets={ROWS.slice(0, 2)}
        selectAll={false}
        handleSelectAllDatasets={() => {}}
        handleSelectDataset={handleSelectDataset}
      />,
      { providers: "app" },
    );
    const cards = await screen.findAllByTestId("dataset-card");
    const betaCard = cards.find((c) => c.textContent.includes("Beta station"));
    await user.click(
      screen
        .getAllByRole("checkbox", { name: /^Add to selection/ })
        .find((b) => betaCard.contains(b)),
    );
    expect(handleSelectDataset).toHaveBeenCalledWith(
      expect.objectContaining({ pk: 1 }),
    );
  });

  it("paginates: only PAGE_SIZES[0] rows render per page", async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      makeRow({ pk: i + 1, title: `Station ${String(i).padStart(2, "0")}` }),
    );
    renderWithProviders(
      <DatasetsTable
        datasets={many}
        selectAll={false}
        handleSelectAllDatasets={() => {}}
        handleSelectDataset={() => {}}
      />,
      { providers: "app" },
    );
    const cards = await screen.findAllByTestId("dataset-card");
    expect(cards.length).toBeLessThan(many.length);
    expect(document.querySelector(".pager")).toBeInTheDocument();
  });

  it("grouping by platform renders group headers with counts", async () => {
    const { user } = renderWithProviders(
      <DatasetsTable
        datasets={ROWS}
        selectAll={false}
        handleSelectAllDatasets={() => {}}
        handleSelectDataset={() => {}}
      />,
      { providers: "app" },
    );
    await screen.findAllByTestId("dataset-card");
    await user.selectOptions(screen.getByLabelText("Group by"), "platform");
    await waitFor(() => {
      expect(
        document.querySelector(".datasetsCardGroupHeader"),
      ).toBeInTheDocument();
    });
  });

  it("grouping sorts by group size, largest first, and ungrouping sorts by title again", async () => {
    const rows = [
      makeRow({ pk: 1, title: "A", platform: "buoy" }),
      makeRow({ pk: 2, title: "B", platform: "mooring" }),
      makeRow({ pk: 3, title: "C", platform: "mooring" }),
    ];
    const { user } = renderWithProviders(
      <DatasetsTable
        datasets={rows}
        selectAll={false}
        handleSelectAllDatasets={() => {}}
        handleSelectDataset={() => {}}
      />,
      { providers: "app" },
    );
    await screen.findAllByTestId("dataset-card");
    await user.selectOptions(screen.getByLabelText("Group by"), "platform");

    expect(screen.getByLabelText("Sort")).toHaveValue("groupSize");
    await waitFor(() =>
      expect(
        [...document.querySelectorAll(".datasetsCardGroupCount")].map(
          (el) => el.textContent,
        ),
      ).toEqual(["2", "1"]),
    );
    expect(
      [...document.querySelectorAll(".datasetsCardGroupHeader")].map((h) =>
        h.style.getPropertyValue("--group-share"),
      ),
    ).toEqual(["1", "0.5"]);

    await user.selectOptions(screen.getByLabelText("Group by"), "none");
    expect(screen.getByLabelText("Sort")).toHaveValue("title");
    expect(
      screen.queryByRole("option", { name: "Group size" }),
    ).not.toBeInTheDocument();
  });

  it("starts every group closed past one page, and a header opens its group", async () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      makeRow({ pk: i + 1, platform: i % 2 ? "buoy" : "mooring" }),
    );
    const { user } = renderWithProviders(
      <DatasetsTable
        datasets={rows}
        selectAll={false}
        handleSelectAllDatasets={() => {}}
        handleSelectDataset={() => {}}
      />,
      { providers: "app" },
    );
    await screen.findAllByTestId("dataset-card");
    await user.selectOptions(screen.getByLabelText("Group by"), "platform");

    const toggles = await screen.findAllByRole("button", { expanded: false });
    expect(screen.queryAllByTestId("dataset-card")).toHaveLength(0);
    expect(screen.queryAllByRole("button", { expanded: true })).toHaveLength(0);

    await user.click(toggles[0]);
    expect(toggles[0]).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByTestId("dataset-card").length).toBeGreaterThan(0);
  });

  it("starts every group open when its rows fit on one page, and a header closes its group", async () => {
    const { user } = renderWithProviders(
      <DatasetsTable
        datasets={ROWS}
        selectAll={false}
        handleSelectAllDatasets={() => {}}
        handleSelectDataset={() => {}}
      />,
      { providers: "app" },
    );
    await screen.findAllByTestId("dataset-card");
    await user.selectOptions(screen.getByLabelText("Group by"), "platform");

    const toggles = await screen.findAllByRole("button", { expanded: true });
    expect(screen.queryAllByRole("button", { expanded: false })).toHaveLength(
      0,
    );
    expect(screen.getAllByTestId("dataset-card")).toHaveLength(ROWS.length);

    await user.click(toggles[0]);
    expect(toggles[0]).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByTestId("dataset-card").length).toBeLessThan(
      ROWS.length,
    );
  });

  it("groups by data portal under ERDDAP and OBIS", async () => {
    const erddap = "https://erddap.ogsl.ca/erddap";
    const rows = [
      makeRow({ pk: 1, title: "A", erddap_server_url: erddap }),
      makeRow({ pk: 2, title: "B", erddap_server_url: erddap }),
      makeRow({
        pk: 3,
        title: "C",
        source_type: "obis",
        obis_nodes: ["OBIS Canada", "OTN-OBIS"],
      }),
    ];
    const { user } = renderWithProviders(
      <>
        <DatasetsTable
          datasets={rows}
          selectAll={false}
          handleSelectAllDatasets={() => {}}
          handleSelectDataset={() => {}}
        />
        <FiltersProbe />
      </>,
      { providers: "app" },
    );
    await screen.findAllByTestId("dataset-card");
    await user.selectOptions(screen.getByLabelText("Group by"), "source");

    const headers = () =>
      [...document.querySelectorAll(".datasetsCardGroupHeader")].map((h) => [
        h.querySelector(".datasetsCardGroupTitle").textContent,
        h.querySelector(".datasetsCardGroupCount").textContent,
        h.classList.contains("nested"),
      ]);
    // The OBIS dataset sits in both nodes but counts once for OBIS.
    await waitFor(() =>
      expect(headers()).toEqual([
        ["ERDDAP", "2", false],
        ["SLGO", "2", true],
        ["OBIS", "1", false],
        ["OBIS Canada", "1", true],
        ["OTN-OBIS", "1", true],
      ]),
    );
    // The OBIS dataset is listed under each of its nodes.
    expect(screen.getAllByTestId("dataset-card")).toHaveLength(4);

    await user.click(screen.getByRole("button", { name: /OTN-OBIS/ }));
    expect(screen.getAllByTestId("dataset-card")).toHaveLength(3);

    // A parent sets its whole source list, as the Filters modal's OBIS row
    // does; a node the catalogue doesn't know offers no filter.
    await user.click(screen.getByRole("button", { name: "Exclude: OBIS" }));
    await waitFor(() =>
      expect(filters.obisNodesSelected.every((n) => n.isExcluded)).toBe(true),
    );
    expect(
      [...document.querySelectorAll(".datasetsCardGroupHeader.excluded")].map(
        (h) => h.querySelector(".datasetsCardGroupTitle").textContent,
      ),
    ).toEqual(["OBIS"]);
    expect(
      screen.queryByRole("button", { name: "Exclude: OTN-OBIS" }),
    ).not.toBeInTheDocument();
  });

  it("groups by ocean variable under open categories; a category header sets it whole", async () => {
    const rows = [
      makeRow({ pk: 1, title: "A", eovs: ["oxygen", "nutrients"] }),
      makeRow({ pk: 2, title: "B", eovs: ["seaState"] }),
      makeRow({ pk: 3, title: "C", eovs: [] }),
    ];
    const { user } = renderWithProviders(
      <>
        <DatasetsTable
          datasets={rows}
          selectAll={false}
          handleSelectAllDatasets={() => {}}
          handleSelectDataset={() => {}}
        />
        <FiltersProbe />
      </>,
      { providers: "app" },
    );
    await screen.findAllByTestId("dataset-card");
    await user.selectOptions(screen.getByLabelText("Group by"), "eov");

    const headers = () =>
      [...document.querySelectorAll(".datasetsCardGroupHeader")].map((h) => [
        h.querySelector(".datasetsCardGroupTitle").textContent,
        h.querySelector(".datasetsCardGroupCount").textContent,
        h.classList.contains("nested"),
      ]);
    // A dataset without an EOV sits beside the categories, not inside one.
    await waitFor(() =>
      expect(headers()).toEqual([
        ["Biogeochemical", "1", false],
        ["Nutrients", "1", true],
        ["Oxygen", "1", true],
        ["Physical", "1", false],
        ["Sea State", "1", true],
        ["Uncategorized", "1", false],
      ]),
    );

    await user.click(
      await screen.findByRole("button", { name: "Add filter: Biogeochemical" }),
    );
    await waitFor(() =>
      expect(
        filters.eovsSelected
          .filter((o) => o.category === "Biogeochemical")
          .every((o) => o.isSelected),
      ).toBe(true),
    );
    expect(
      filters.eovsSelected.some(
        (o) => o.category !== "Biogeochemical" && o.isSelected,
      ),
    ).toBe(false);
  });

  it("a group header includes or excludes its group in the main filters", async () => {
    const { user } = renderWithProviders(
      <>
        <DatasetsTable
          datasets={ROWS}
          selectAll={false}
          handleSelectAllDatasets={() => {}}
          handleSelectDataset={() => {}}
        />
        <FiltersProbe />
      </>,
      { providers: "app" },
    );
    await screen.findAllByTestId("dataset-card");
    await user.selectOptions(screen.getByLabelText("Group by"), "platform");
    const mooring = () =>
      filters.platformsSelected.find((p) => p.title === "mooring");

    const include = await screen.findByRole("button", {
      name: "Add filter: mooring",
    });
    await user.click(include);
    await waitFor(() => expect(mooring().isSelected).toBe(true));
    expect(include).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Exclude: mooring" }));
    await waitFor(() => expect(mooring().isExcluded).toBe(true));
    expect(mooring().isSelected).toBe(false);

    await user.click(screen.getByRole("button", { name: "Exclude: mooring" }));
    await waitFor(() => expect(mooring().isExcluded).toBe(false));
  });

  it("keeps the groups a header's own filter took out, empty, until the grouping changes", async () => {
    const vessel = makeRow({
      pk: 4,
      title: "Delta",
      platform: "surface vessel",
    });
    const table = (datasets) => (
      <>
        <DatasetsTable
          datasets={datasets}
          selectAll={false}
          handleSelectAllDatasets={() => {}}
          handleSelectDataset={() => {}}
        />
        <FiltersProbe />
      </>
    );
    const { user, rerender } = renderWithProviders(table([...ROWS, vessel]), {
      providers: "app",
    });
    await screen.findAllByTestId("dataset-card");
    await user.selectOptions(screen.getByLabelText("Group by"), "platform");
    const header = (name) =>
      [...document.querySelectorAll(".datasetsCardGroupHeader")].find(
        (h) => h.querySelector(".datasetsCardGroupTitle").textContent === name,
      );
    const platform = (name) =>
      filters.platformsSelected.find((p) => p.title === name);

    // Including mooring narrows the results to it; surface vessel stays
    // listed, empty and last, so it can be added too.
    await user.click(
      await screen.findByRole("button", { name: "Add filter: mooring" }),
    );
    rerender(table(ROWS));
    expect(header("surface vessel")).toHaveClass("empty");
    expect(
      header("surface vessel").querySelector(".datasetsCardGroupCount"),
    ).toHaveTextContent("0");
    expect(
      header("surface vessel").querySelector(".datasetsCardGroupToggle"),
    ).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "Add filter: surface vessel" }),
    );
    await waitFor(() =>
      expect(platform("surface vessel").isSelected).toBe(true),
    );
    expect(platform("mooring").isSelected).toBe(true);

    // An excluded group stays listed with its undo, and clearing the filter
    // keeps it until the results bring it back.
    await user.click(
      screen.getByRole("button", { name: "Add filter: mooring" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Add filter: surface vessel" }),
    );
    await user.click(screen.getByRole("button", { name: "Exclude: mooring" }));
    rerender(table([vessel]));
    expect(header("mooring")).toHaveClass("empty", "excluded");
    expect(header("mooring").style.getPropertyValue("--group-share")).toBe("0");
    await user.click(screen.getByRole("button", { name: "Exclude: mooring" }));
    await waitFor(() => expect(platform("mooring").isExcluded).toBe(false));
    expect(header("mooring")).toHaveClass("empty");

    rerender(table([...ROWS, vessel]));
    expect(header("mooring")).not.toHaveClass("empty");

    await user.selectOptions(screen.getByLabelText("Group by"), "type");
    await user.selectOptions(screen.getByLabelText("Group by"), "platform");
    expect(
      document.querySelectorAll(".datasetsCardGroupHeader.empty"),
    ).toHaveLength(0);
  });

  it("a page opened mid-group re-shows both its parent and its group header", async () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      makeRow({
        pk: i + 1,
        title: `Station ${String(i).padStart(2, "0")}`,
        erddap_server_url: "https://erddap.ogsl.ca/erddap",
      }),
    );
    const { user } = renderWithProviders(
      <DatasetsTable
        datasets={rows}
        selectAll={false}
        handleSelectAllDatasets={() => {}}
        handleSelectDataset={() => {}}
      />,
      { providers: "app" },
    );
    await screen.findAllByTestId("dataset-card");
    await user.selectOptions(screen.getByLabelText("Group by"), "source");
    await user.click(await screen.findByRole("button", { name: /SLGO/ }));
    await user.click(screen.getByRole("button", { name: /next/i }));

    expect(
      [...document.querySelectorAll(".datasetsCardGroupTitle")].map(
        (el) => el.textContent,
      ),
    ).toEqual(["ERDDAP", "SLGO"]);
    expect(screen.getAllByTestId("dataset-card")).toHaveLength(5);
  });
});

describe("DatasetsTable (download modal)", () => {
  beforeEach(() => {
    installMockFetch();
  });

  // The modal's own checkbox (handleSelectDataset prop) only ticks a dataset
  // in or out of this particular batch — it never takes the row off the
  // list. Removing it from the order outright goes through SelectionProvider
  // instead, the same state the sidebar's checkbox writes to.
  it("a card's remove button drops the dataset from the selection entirely, without touching the batch checkbox", async () => {
    const row = makeRow({ pk: 1, title: "Beta station", selected: true });
    let selection;
    function Probe() {
      selection = useSelection();
      return null;
    }
    const handleSelectDataset = vi.fn();
    const { user } = renderWithProviders(
      <>
        <DatasetsTable
          isDownloadModal
          datasets={[row]}
          selectAll
          handleSelectAllDatasets={() => {}}
          handleSelectDataset={handleSelectDataset}
        />
        <Probe />
      </>,
      { providers: "app" },
    );
    await screen.findAllByTestId("dataset-card");

    // Seed the shortlist so the dataset actually starts out selected.
    act(() => selection.handleSelectDataset(row));
    await waitFor(() => expect(selection.selectedPks.has(1)).toBe(true));

    await user.click(
      screen.getByRole("button", {
        name: "Remove from the download selection: Beta station",
      }),
    );

    await waitFor(() => expect(selection.selectedPks.has(1)).toBe(false));
    expect(handleSelectDataset).not.toHaveBeenCalled();
  });
});
