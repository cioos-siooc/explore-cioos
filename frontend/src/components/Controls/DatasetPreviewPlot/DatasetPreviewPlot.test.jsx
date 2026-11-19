import * as React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import {
  MOBILE_WIDTH,
  TABLET_WIDTH,
  setTouchScreen,
  setViewportWidth,
} from "../../../test/viewport.js";
import DatasetPreview from "../DatasetPreview/DatasetPreview.jsx";

// Plotly itself is stubbed at the factory, so the real tree — DatasetPreview ->
// the provider -> the lazy plot -> its controls — is what runs. What the figure
// DRAWS is asserted in previewFacetFigure.test.mjs; what this covers is the
// controls, and the settings reaching the figure at all.
vi.mock("./previewPlotly.js", () => ({
  default: { Icons: {} },
}));
vi.mock("react-plotly.js/factory", () => ({
  default: () =>
    function MockPlot({ data, layout, config }) {
      return (
        <div
          data-testid="plotly"
          data-traces={data.length}
          data-hovermode={layout.hovermode}
          data-y-autorange={layout.yaxis.autorange}
          data-dragmode={String(layout.dragmode)}
          data-modebar={String(config.displayModeBar)}
          data-removed-buttons={config.modeBarButtonsToRemove?.join(" ")}
          data-added-buttons={config.modeBarButtonsToAdd
            ?.map((button) => button.name)
            .join(" ")}
        >
          {config.modeBarButtonsToAdd?.map((button) => (
            <button
              key={button.name}
              type="button"
              aria-label={button.title}
              onClick={() => button.click()}
            />
          ))}
        </div>
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

// A record holding many profiles.
const STATION = { ...DATASET, cdm_data_type: "TimeSeriesProfile" };

function open(url = "/", dataset = DATASET, table = TABLE, sample) {
  const user = userEvent.setup({ delay: null });
  renderWithProviders(
    <DatasetPreview
      datasetPreview={{ table, sample }}
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

// The first test pays for the lazy plot chunk's cold import, which can pass
// waitFor's 1 s default when the whole suite runs in parallel.
const plotted = async () => {
  await waitFor(
    () => expect(screen.getByTestId("plotly")).toBeInTheDocument(),
    { timeout: 5000 },
  );
  return screen.getByTestId("plotly");
};
const rowCaptioned = (caption) =>
  screen.getByText(caption).closest(".controlRow");
const variableSearch = (axis = "X axis") =>
  screen.getByRole("combobox", { name: axis });
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

  it("swaps Plotly's camera for one that exports the legend, and adds a help button", async () => {
    open();
    const plot = await plotted();
    expect(plot.getAttribute("data-removed-buttons")).toContain("toImage");
    expect(plot).toHaveAttribute(
      "data-added-buttons",
      "downloadPlotPng plotInteractionHelp",
    );
  });

  it("opens the interaction help in a dialog from the modebar's help button", async () => {
    const user = open();
    await plotted();
    await user.click(
      screen.getByRole("button", { name: "How to use the plot" }),
    );
    const help = screen.getByTestId("plot-interaction-help-modal");
    expect(help).toHaveTextContent("Double-click to reset the view.");
    expect(help.querySelectorAll("li")).toHaveLength(6);
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

  it("inverts a lone Y axis from the row that picks it, pressed for a depth", async () => {
    const user = open();
    const plot = await plotted();
    const invert = within(rowCaptioned("Y axis")).getByRole("checkbox", {
      name: "Reverse axis direction: depth (m)",
    });
    expect(invert).toBeChecked();
    expect(plot).toHaveAttribute("data-y-autorange", "reversed");

    await user.click(invert);

    expect(invert).not.toBeChecked();
    expect(screen.getByTestId("plotly")).not.toHaveAttribute(
      "data-y-autorange",
    );
    // One axis, one control: More options repeats no checkbox for it.
    await user.click(screen.getByRole("button", { name: "More options" }));
    expect(
      within(document.querySelector(".labelEditor")).queryByRole("checkbox", {
        name: /Reverse axis direction/,
      }),
    ).not.toBeInTheDocument();
  });

  it("inverts each panel's own Y axis from More options once there are several", async () => {
    const user = open("/?pvars=temperature,salinity", {
      ...DATASET,
      cdm_data_type: "TimeSeries",
    });
    await plotted();
    expect(
      within(rowCaptioned("Y axis")).queryByRole("checkbox", {
        name: /Reverse axis direction/,
      }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "More options" }));
    expect(
      screen.getAllByRole("checkbox", { name: /Reverse axis direction/ }),
    ).toHaveLength(2);
  });

  it("pins a profile's shared axis left of the scroller, outside it", async () => {
    open();
    await plotted();
    const strip = document.querySelector(".pinnedAxis");
    expect(
      document.querySelector(".datasetPreviewPlotArea").contains(strip),
    ).toBe(false);
    expect(strip.parentElement).toHaveClass("isPinnedLeft");
    expect(strip).toHaveStyle({ width: "88px" });
  });

  it("pins a stack's shared axis below the scroller", async () => {
    open("/", { ...DATASET, cdm_data_type: "TimeSeries" });
    await plotted();
    const strip = document.querySelector(".pinnedAxis");
    expect(strip.parentElement).toHaveClass("isPinnedBelow");
    expect(strip).toHaveStyle({ height: "68px" });
  });

  it("names a record of many casts in a header row above the figure", async () => {
    open("/", { ...DATASET, cdm_data_type: "TimeSeriesProfile" });
    await plotted();
    expect(
      screen.getByRole("heading", { name: "Profile: record-1" }),
    ).toBeInTheDocument();
  });

  it("names the header's record by the cf_role of the column holding it", async () => {
    open(
      "/",
      { ...STATION, timeseries_id_variable: "station" },
      {
        ...TABLE,
        columnNames: [...TABLE.columnNames, "station"],
        columnTypes: [...TABLE.columnTypes, "String"],
        columnUnits: [...TABLE.columnUnits, null],
        rows: TABLE.rows.map((row) => [...row, "record-1"]),
      },
    );
    await plotted();
    expect(
      screen.getByRole("heading", {
        name: "station (timeseries_id): record-1",
      }),
    ).toBeInTheDocument();
  });

  it("opens a record of many casts as a section, with a cast slider", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            column: "profile",
            steps: [{ value: "cast-1" }, { value: "cast-2" }],
            count: 2,
            truncated: false,
          }),
      }),
    );
    open("/", STATION);
    const plot = await plotted();
    expect(plot).toHaveAttribute("data-hovermode", "x");
    expect(rowCaptioned("X axis")).toHaveTextContent("time");
    expect(rowCaptioned("Y axis")).toHaveTextContent("depth");
    expect(rowCaptioned("Color by")).toHaveTextContent("temperature");
    expect(
      await screen.findByRole("button", { name: "Previous profile" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Layout")).not.toBeInTheDocument();
  });

  it("draws no header row for a record holding a single cast", async () => {
    open();
    await plotted();
    expect(screen.queryByText("Profile: record-1")).not.toBeInTheDocument();
  });

  it("opens the settings from the corner's gear on a phone, over the plot", async () => {
    setViewportWidth(MOBILE_WIDTH);
    const user = open();
    await plotted();
    const gear = screen.getByRole("button", { name: "Plot settings" });
    expect(gear).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog", { name: "Plot settings" })).toBeNull();

    await user.click(gear);
    const sheet = await screen.findByRole("dialog", { name: "Plot settings" });
    expect(within(sheet).getByText("Plot type")).toBeInTheDocument();

    // Escape closes an open menu first, and only then the sheet.
    await user.click(within(sheet).getByRole("combobox", { name: "Color by" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Plot settings" })).toBeVisible();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Plot settings" }),
      ).toBeNull(),
    );
    expect(gear).toHaveFocus();
  });

  it("lets a finger pan the plot, with the pan tool kept to return to", async () => {
    setTouchScreen(true);
    open();
    const plot = await plotted();
    expect(plot).toHaveAttribute("data-dragmode", "pan");
    expect(plot.dataset.removedButtons.split(" ")).not.toContain("pan2d");
    // No hover to reveal the toolbar, which is where zooming went.
    expect(plot).toHaveAttribute("data-modebar", "true");
  });

  it("describes the figure to a screen reader and points to the table", async () => {
    open();
    await plotted();
    expect(
      screen.getByRole("figure", { name: /^Plot of .+ against .+Table view/ }),
    ).toBeInTheDocument();
  });

  it("keeps drag-to-zoom for a mouse, with the toolbar always shown", async () => {
    open();
    const plot = await plotted();
    expect(plot).toHaveAttribute("data-dragmode", "zoom");
    expect(plot.dataset.removedButtons.split(" ")).toContain("pan2d");
    // Export and the help live in it: a hover-only toolbar hid both.
    expect(plot).toHaveAttribute("data-modebar", "true");
  });

  it("names the record above the plot on a tablet, not inside the figure", async () => {
    const table = {
      ...TABLE,
      columnNames: [...TABLE.columnNames, "cast"],
      columnTypes: [...TABLE.columnTypes, "String"],
      columnUnits: [...TABLE.columnUnits, null],
      columnMeta: [
        {},
        {},
        {},
        {},
        { long_name: "Cast", cf_role: "profile_id" },
      ],
      rows: TABLE.rows.map((row) => [...row, "cast-7"]),
    };
    setViewportWidth(TABLET_WIDTH);
    open("/", DATASET, table);
    await plotted();
    expect(
      screen.getByRole("heading", { name: "Cast (profile_id): cast-7" }),
    ).toBeInTheDocument();
  });

  it("gives a phone's plot no header row, its gear in the corner", async () => {
    setViewportWidth(MOBILE_WIDTH);
    open();
    const plot = await plotted();
    const gear = screen.getByRole("button", { name: "Plot settings" });
    expect(gear).toHaveClass("paneCollapseToggle");
    expect(plot.contains(gear)).toBe(false);
    expect(document.querySelector(".previewProfileHeader")).toBeNull();
  });

  it("has no gear beside the settings pane", async () => {
    open();
    await plotted();
    expect(screen.queryByRole("button", { name: "Plot settings" })).toBeNull();
  });

  it("lets only one axis hold several variables", async () => {
    const user = open("/?pvars=temperature,salinity");
    await waitFor(() => expect(traceCount()).toBe(2));
    const pills = (caption) =>
      rowCaptioned(caption).querySelectorAll(".variableSelect__multi-value");
    const offersAdd = (caption) =>
      within(rowCaptioned(caption)).queryByText("Add variable") !== null;
    expect(pills("Y axis")).toHaveLength(1);
    expect(offersAdd("X axis")).toBe(true);
    expect(offersAdd("Y axis")).toBe(false);
    expect(offersAdd("Color by")).toBe(false);

    // X holds two, so picking on Y replaces its one variable.
    await user.click(variableSearch("Y axis"));
    await user.click(screen.getByRole("option", { name: "time (UTC)" }));

    await waitFor(() =>
      expect(rowCaptioned("Y axis")).toHaveTextContent("time"),
    );
    expect(rowCaptioned("Y axis")).not.toHaveTextContent("depth");
    expect(traceCount()).toBe(2);
    expect(rowCaptioned("X axis")).toHaveTextContent("temperature");
    expect(rowCaptioned("X axis")).toHaveTextContent("salinity");
  });

  it("repeats every panel once per colour column, each with its own legend", async () => {
    open("/?pz=salinity,time&pmode=markers");
    await waitFor(() => expect(traceCount()).toBe(2));
    expect(
      [...document.querySelectorAll(".colorScaleLegendLabel")].map(
        (label) => label.textContent,
      ),
    ).toEqual(["salinity (PSU)", "time (UTC)"]);
  });

  it("captions the colour scales once, with one picker each until shared", async () => {
    const user = open("/?pz=salinity,time&pmode=markers");
    await waitFor(() => expect(traceCount()).toBe(2));
    await user.click(screen.getByRole("button", { name: "More options" }));
    expect(screen.getAllByText("Color scale")).toHaveLength(1);
    const row = rowCaptioned("Color scale");
    expect(row.querySelectorAll(".colorScaleItem")).toHaveLength(2);

    await user.click(within(row).getByRole("button", { name: "Shared" }));
    await waitFor(() =>
      expect(row.querySelectorAll(".colorScaleItem")).toHaveLength(0),
    );
    expect(row.querySelectorAll(".colorScaleChip").length).toBeGreaterThan(0);
  });

  it("offers no panel direction control", async () => {
    open("/?pz=salinity,time&pmode=markers");
    await waitFor(() => expect(traceCount()).toBe(2));
    expect(screen.queryByText("Panels")).not.toBeInTheDocument();
  });

  it("moves the panels to the other axis when it takes a second variable", async () => {
    const user = open();
    await plotted();
    await user.click(variableSearch("Y axis"));
    await user.click(screen.getByRole("option", { name: "salinity (PSU)" }));

    await waitFor(() => expect(traceCount()).toBe(2));
    expect(rowCaptioned("Y axis")).toHaveTextContent("depth");
    expect(rowCaptioned("Y axis")).toHaveTextContent("salinity");
    expect(rowCaptioned("X axis")).toHaveTextContent("temperature");
  });

  it("adds a panel when a second variable is ticked", async () => {
    const user = open();
    await plotted();
    await user.click(variableSearch());
    await user.click(screen.getByRole("option", { name: "salinity (PSU)" }));
    await waitFor(() => expect(traceCount()).toBe(2));
  });

  it("tags the variables the record leaves empty and lists them last", async () => {
    const user = open("/", DATASET, {
      ...TABLE,
      columnNames: [...TABLE.columnNames, "oxygen"],
      columnTypes: [...TABLE.columnTypes, "float"],
      columnUnits: [...TABLE.columnUnits, "ml/l"],
      rows: TABLE.rows.map((row) => [...row, null]),
    });
    await plotted();
    await user.click(variableSearch());
    expect(
      screen
        .getAllByRole("option")
        .map((option) => option.getAttribute("aria-label")),
    ).toEqual(["salinity (PSU)", "time (UTC)", "oxygen (ml/l), no data"]);
    expect(screen.getByText("no data")).toBeInTheDocument();
    expect(document.querySelectorAll(".variableSelect__group")).toHaveLength(2);
  });

  it("shows a removable pill per picked variable", async () => {
    const user = open("/?pvars=temperature,salinity");
    await waitFor(() => expect(traceCount()).toBe(2));
    expect(rowCaptioned("X axis")).toHaveTextContent("temperature");
    expect(rowCaptioned("X axis")).toHaveTextContent("salinity");

    await user.click(screen.getByRole("button", { name: "Remove salinity" }));
    await waitFor(() => expect(traceCount()).toBe(1));
    expect(rowCaptioned("X axis")).not.toHaveTextContent("salinity");
  });

  it("reorders the picked variables from the keyboard", async () => {
    const user = open("/?pvars=temperature,salinity");
    await waitFor(() => expect(traceCount()).toBe(2));
    const pills = () =>
      [
        ...rowCaptioned("X axis").querySelectorAll(
          ".variableSelect__multi-value__label",
        ),
      ].map((pill) => pill.textContent);
    expect(pills()).toEqual(["temperature", "salinity"]);

    screen.getByRole("button", { name: "Reorder salinity" }).focus();
    await user.keyboard(" ");
    await user.keyboard("{ArrowLeft}");
    await user.keyboard(" ");
    await waitFor(() => expect(pills()).toEqual(["salinity", "temperature"]));
  });

  it("puts a drag grip in each pill only once there are two to order", async () => {
    open("/?pvars=temperature,salinity");
    await waitFor(() => expect(traceCount()).toBe(2));
    expect(screen.getAllByRole("button", { name: /^Reorder / })).toHaveLength(
      2,
    );
  });

  it("gives a lone pick no drag grip", async () => {
    open("/?pvars=temperature");
    await plotted();
    expect(
      screen.queryByRole("button", { name: /^Reorder / }),
    ).not.toBeInTheDocument();
  });

  it("lists each variable as its column name, then its unit and long_name", async () => {
    const user = open("/", DATASET, {
      ...TABLE,
      columnMeta: [null, null, { long_name: "Sea Water Salinity" }, null],
    });
    await plotted();
    await user.click(variableSearch());
    const option = screen.getByRole("option", {
      name: "salinity (PSU) Sea Water Salinity",
    });
    expect(within(option).getByText("salinity")).toHaveClass(
      "variableOptionColumn",
    );
  });

  it("filters the variable list by what is typed", async () => {
    const user = open("/?pvars=temperature");
    await plotted();
    await user.type(variableSearch(), "sal");
    expect(
      screen.getByRole("option", { name: "salinity (PSU)" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /^time/ }),
    ).not.toBeInTheDocument();

    await user.clear(variableSearch());
    await user.type(variableSearch(), "oxygen");
    expect(screen.getByText("No matching variables")).toBeInTheDocument();
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

  it("switches the mode every panel is drawn in from its menu", async () => {
    const user = open();
    await plotted();
    await user.click(screen.getByRole("button", { name: "Markers + Line" }));
    await user.click(screen.getByRole("button", { name: "Markers" }));
    expect(screen.getByRole("button", { name: "Markers" })).toHaveAttribute(
      "aria-haspopup",
    );
    expect(
      screen.queryByRole("button", { name: "Markers + Line" }),
    ).not.toBeInTheDocument();
  });

  it("resets every plot setting and rename, disabled until there is one", async () => {
    const user = open("/?pz=salinity&pmode=lines");
    await plotted();
    await user.click(screen.getByRole("button", { name: "More options" }));
    await user.type(screen.getByLabelText("temperature (degree_C)"), "Temp");

    await user.click(screen.getByRole("button", { name: "Reset plot" }));

    await waitFor(() =>
      expect(screen.queryByText("Color scale")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Markers + Line" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("temperature (degree_C)")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Reset plot" })).toBeDisabled();
  });

  it("reveals the colour scale once a colour column is picked", async () => {
    const user = open();
    await plotted();
    await user.click(screen.getByRole("button", { name: "More options" }));
    await user.click(variableSearch("Color by"));
    await user.click(screen.getByRole("option", { name: "salinity (PSU)" }));
    await waitFor(() =>
      expect(screen.getByText("Color scale")).toBeInTheDocument(),
    );
  });

  it("turns the colour column back off from its pill", async () => {
    const user = open("/?pz=salinity");
    await plotted();
    await user.click(screen.getByRole("button", { name: "More options" }));
    await waitFor(() =>
      expect(screen.getByText("Color scale")).toBeInTheDocument(),
    );
    expect(rowCaptioned("Color by")).toHaveTextContent("salinity");

    await user.click(screen.getByRole("button", { name: /^Remove salinity/ }));
    await waitFor(() =>
      expect(screen.queryByText("Color scale")).not.toBeInTheDocument(),
    );
    expect(rowCaptioned("Color by")).toHaveTextContent("None");
  });

  it("draws the colour scale below the plot, outside its scroller", async () => {
    const user = open();
    await plotted();
    await user.click(variableSearch("Color by"));
    await user.click(screen.getByRole("option", { name: "salinity (PSU)" }));

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
    await user.click(screen.getByRole("button", { name: "More options" }));
    await user.type(screen.getByLabelText("temperature (degree_C)"), "Temp");

    await user.click(screen.getByRole("button", { name: "Table" }));
    await user.click(screen.getByRole("button", { name: "Plot" }));
    await plotted();
    await user.click(screen.getByRole("button", { name: "More options" }));

    // Held by the provider, which outlives the component that was unmounted.
    expect(screen.getByLabelText("temperature (degree_C)")).toHaveValue("Temp");
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

  it("opens with the settings beside the plot on a large screen", async () => {
    open();
    await plotted();
    expect(screen.getByText("Plot type")).toBeVisible();
    expect(screen.getByRole("separator")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Plot settings" })).toBeNull();
  });
});

describe("a window of the record", () => {
  const TIMESERIES = { ...DATASET, cdm_data_type: "TimeSeries" };
  const PARTIAL = { rowCount: 2, totalRowCount: 26131 };
  const search = () => new URLSearchParams(window.location.search);

  it("pages back from above the plot", async () => {
    const user = open("/", TIMESERIES, TABLE, PARTIAL);
    await plotted();
    await user.click(screen.getByRole("button", { name: "Earlier" }));
    expect(search().get("pbefore")).toBe("2024-01-01T00:00:00.000Z");
  });

  it("sets the row count in the parameters pane, writing only a non-default one", async () => {
    const user = open("/", TIMESERIES, TABLE, PARTIAL);
    await plotted();
    const rows = within(screen.getByTestId("preview-row-limit"));
    await user.click(rows.getByRole("button", { name: "20,000" }));
    expect(search().get("prows")).toBe("20000");
    await user.click(rows.getByRole("button", { name: "5,000" }));
    expect(search().get("prows")).toBeNull();
  });

  it("offers neither when the rows are the whole record", async () => {
    open("/", TIMESERIES, TABLE, { rowCount: 2, totalRowCount: 2 });
    await plotted();
    expect(
      screen.queryByRole("button", { name: "Earlier" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("preview-row-limit")).not.toBeInTheDocument();
  });
});
