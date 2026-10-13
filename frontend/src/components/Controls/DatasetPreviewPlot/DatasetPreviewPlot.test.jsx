import * as React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import DatasetPreview from "../DatasetPreview/DatasetPreview.jsx";

// Plotly itself is stubbed at the factory, so the real tree — DatasetPreview ->
// the provider -> the lazy plot -> its controls — is what runs. What the figure
// DRAWS is asserted in previewFacetFigure.test.mjs; what this covers is the
// controls, and the settings reaching the figure at all.
vi.mock("plotly.js-basic-dist-min", () => ({
  default: { register: () => {} },
}));
vi.mock("plotly.js-locales/fr", () => ({ default: {} }));
vi.mock("react-plotly.js/factory", () => ({
  default: () =>
    function MockPlot({ data, layout }) {
      return (
        <div
          data-testid="plotly"
          data-traces={data.length}
          data-hovermode={layout.hovermode}
        />
      );
    },
}));

// No columnMeta: this is the pre-reharvest case, where every label falls back to
// the column name the publisher used.
const TABLE = {
  columnNames: ["depth", "temperature", "salinity", "time"],
  columnTypes: ["float", "float", "float", "String"],
  columnUnits: ["m", "degree_C", "PSU", "UTC"],
  rows: [
    [0, 10, 30, "2024-01-01T00:00:00Z"],
    [5, 9, 31, "2024-01-01T00:05:00Z"],
  ],
};

const DATASET = {
  dataset_id: "d1",
  title: "Test dataset",
  cdm_data_type: "Profile",
  first_eov_column: "temperature",
};

function open(url = "/", dataset = DATASET) {
  const user = userEvent.setup({ delay: null });
  renderWithProviders(
    <DatasetPreview
      datasetPreview={{ table: TABLE }}
      previewError={null}
      inspectDataset={dataset}
      inspectRecordID="record-1"
      setInspectRecordID={vi.fn()}
      showModal
      recordLoading={false}
      setRecordLoading={vi.fn()}
    />,
    { url },
  );
  return user;
}

const plotted = async () => {
  await waitFor(() => expect(screen.getByTestId("plotly")).toBeInTheDocument());
  return screen.getByTestId("plotly");
};
const rowCaptioned = (caption) =>
  screen.getByText(caption).closest(".controlRow");
const traceCount = () =>
  Number(screen.getByTestId("plotly").getAttribute("data-traces"));

describe("DatasetPreviewPlot", () => {
  beforeEach(() => {
    global.fetch = vi.fn(() => Promise.reject(new Error("no profile list")));
  });

  it("opens on the record's default panel, drawn against the shared axis", async () => {
    open();
    const plot = await plotted();
    expect(traceCount()).toBe(1);
    // A profile's panels share the vertical axis, so its hover is the unified
    // one — the arrangement reaching the figure.
    expect(plot).toHaveAttribute("data-hovermode", "y unified");
  });

  it("offers every control the pane is responsible for", async () => {
    open();
    await plotted();
    ["Plot type", "X axis", "Y axis", "Color by"].forEach((caption) =>
      expect(screen.getByText(caption)).toBeInTheDocument(),
    );
    // The colour scale row is withheld until there is something to scale.
    expect(screen.queryByText("Color scale")).not.toBeInTheDocument();
  });

  it("captions a profile's vertical shared axis Y and its panels X", async () => {
    open();
    await plotted();
    expect(rowCaptioned("Y axis")).toHaveTextContent("depth");
    expect(rowCaptioned("X axis")).toHaveTextContent("temperature");
  });

  it("captions a time series' horizontal shared axis X and its panels Y", async () => {
    open("/", { ...DATASET, cdm_data_type: "TimeSeries" });
    await plotted();
    expect(rowCaptioned("X axis")).toHaveTextContent("time");
    expect(rowCaptioned("Y axis")).toHaveTextContent("temperature");
  });

  it("hints that the panels axis takes more than one variable", async () => {
    open();
    await plotted();
    expect(rowCaptioned("X axis")).toHaveTextContent("(+/-)");
    expect(rowCaptioned("Y axis")).not.toHaveTextContent("(+/-)");
  });

  it("adds a panel when a second variable is ticked", async () => {
    const user = open();
    await plotted();
    await user.click(screen.getByRole("button", { name: "temperature" }));
    await user.click(screen.getByLabelText("salinity ( PSU )"));
    await waitFor(() => expect(traceCount()).toBe(2));
  });

  it("says so rather than drawing nothing when every variable is unticked", async () => {
    open("/?pvars=-");
    await waitFor(() =>
      expect(
        screen.getByText("Pick at least one variable to plot."),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("plotly")).not.toBeInTheDocument();
  });

  it("switches the mode every panel is drawn in", async () => {
    const user = open();
    await plotted();
    await user.click(screen.getByRole("button", { name: "Markers + Line" }));
    await user.click(screen.getByText("Markers"));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Markers" }),
      ).toBeInTheDocument(),
    );
  });

  it("reveals the colour scale once a colour column is picked", async () => {
    const user = open();
    await plotted();
    await user.click(screen.getByRole("button", { name: "None" }));
    await user.click(screen.getByText("salinity ( PSU )"));
    await waitFor(() =>
      expect(screen.getByText("Color scale")).toBeInTheDocument(),
    );
  });

  it("draws the colour scale below the plot, outside its scroller", async () => {
    const user = open();
    await plotted();
    await user.click(screen.getByRole("button", { name: "None" }));
    await user.click(screen.getByText("salinity ( PSU )"));

    const legend = await waitFor(() => {
      const found = document.querySelector(".colorScaleLegend");
      expect(found).not.toBeNull();
      return found;
    });
    const plotArea = document.querySelector(".datasetPreviewPlotArea");
    expect(plotArea.contains(legend)).toBe(false);
    expect(
      plotArea.compareDocumentPosition(legend) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps a rename across the Table/Plot flip that unmounts the plot", async () => {
    const user = open();
    await plotted();
    await user.click(screen.getByRole("button", { name: "Customize plot ▾" }));
    await user.type(screen.getByLabelText("temperature ( degree_C )"), "Temp");

    await user.click(screen.getByRole("button", { name: "Table" }));
    await user.click(screen.getByRole("button", { name: "Plot" }));
    await plotted();
    await user.click(screen.getByRole("button", { name: "Customize plot ▾" }));

    // Held by the provider, which outlives the component that was unmounted.
    expect(screen.getByLabelText("temperature ( degree_C )")).toHaveValue(
      "Temp",
    );
  });

  it("collapses the settings pane and expands it again", async () => {
    const user = open();
    await plotted();
    const hide = screen.getByRole("button", {
      name: "Hide the plot settings panel",
    });
    expect(hide).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("separator")).toBeInTheDocument();

    await user.click(hide);
    const show = screen.getByRole("button", {
      name: "Show the plot settings panel",
    });
    expect(show).toHaveAttribute("aria-expanded", "false");
    // Nothing left to resize while the pane is hidden.
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();

    await user.click(show);
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("keeps the pane collapsed across the Table/Plot flip", async () => {
    const user = open();
    await plotted();
    await user.click(
      screen.getByRole("button", { name: "Hide the plot settings panel" }),
    );

    await user.click(screen.getByRole("button", { name: "Table" }));
    await user.click(screen.getByRole("button", { name: "Plot" }));
    await plotted();

    expect(
      screen.getByRole("button", { name: "Show the plot settings panel" }),
    ).toHaveAttribute("aria-expanded", "false");
  });
});
