import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import DatasetsTable from "./DatasetsTable.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";

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

  // DatasetsTable's own search box writes to SelectionProvider's shared
  // datasetTitleSearchText rather than filtering its own `datasets` prop —
  // narrowing happens upstream (SelectionProvider's filteredDatasets), which
  // is what feeds `datasets` in the real app. This just sorts/pages whatever
  // it's handed (see the component's own comment), so exercise that wiring
  // directly rather than pretending typing narrows the static rows below.
  // …and it writes it when the search is submitted, not while it is typed:
  // that state narrows the map as well as this list, so a keystroke's worth of
  // it is a round of tile, legend and coverage requests.
  it("the search box writes to the shared datasetTitleSearchText state, on submit", async () => {
    let latest;
    const published = [];
    function Probe() {
      latest = useSelection();
      published.push(latest.datasetTitleSearchText);
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
    await user.type(screen.getByPlaceholderText("Search table"), "beta");
    expect(screen.getByPlaceholderText("Search table")).toHaveValue("beta");
    expect(latest.datasetTitleSearchText).toBe("");

    await user.type(screen.getByPlaceholderText("Search table"), "{Enter}");

    await waitFor(() => expect(latest.datasetTitleSearchText).toBe("beta"));
    // "bet", "be", "b" never reached the state the map reads.
    expect([...new Set(published)]).toEqual(["", "beta"]);
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
        .getAllByRole("checkbox", { name: "Add to selection" })
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
    await user.selectOptions(screen.getByLabelText("Group"), "platform");
    await waitFor(() => {
      expect(
        document.querySelector(".datasetsCardGroupHeader"),
      ).toBeInTheDocument();
    });
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
