import * as React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import {
  MOBILE_WIDTH,
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

// The colour plot is offered only for a record holding many profiles.
const STATION = { ...DATASET, cdm_data_type: "TimeSeriesProfile" };

function open(url = "/", dataset = DATASET, table = TABLE) {
  const user = userEvent.setup({ delay: null });
  renderWithProviders(
    <DatasetPreview
      datasetPreview={{ table }}
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

  it("swaps to the colour plot's controls when its layout is picked", async () => {
    const user = open("/", STATION);
    await plotted();
    const layout = screen.getByTestId("preview-layout-toggle");
    expect(screen.getByRole("button", { name: "Panels" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Color plot" }));
    expect(layout).toContainElement(
      screen.getByRole("button", { name: "Color plot", pressed: true }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("plotly")).toHaveAttribute(
        "data-hovermode",
        "closest",
      ),
    );
    expect(rowCaptioned("X axis")).toHaveTextContent("time");
    expect(rowCaptioned("Y axis")).toHaveTextContent("depth");
    // The same searchable pickers as the panel layout's axes.
    expect(variableSearch("X axis")).toBeInTheDocument();
    expect(variableSearch("Y axis")).toBeInTheDocument();
    // Color by is the multi-pick now, and the single colour dimension's scale
    // row is not offered.
    expect(rowCaptioned("Color by")).toHaveTextContent("temperature");
    expect(screen.queryByText("Color scale")).not.toBeInTheDocument();
    // A filled colour plot has no markers or line to choose between.
    expect(screen.queryByText("Plot type")).not.toBeInTheDocument();
  });

  it("caps the colour plot at five variables, a link's extras dropped", async () => {
    const measurements = ["m1", "m2", "m3", "m4", "m5", "m6", "m7"];
    const wideTable = {
      columnNames: ["depth", "time", ...measurements],
      columnTypes: ["float", "String", ...measurements.map(() => "float")],
      columnUnits: ["m", "UTC", ...measurements.map(() => null)],
      rows: [
        [0, "2024-01-01T00:00:00Z", ...measurements.map(() => 1)],
        [5, "2024-01-01T00:05:00Z", ...measurements.map(() => 2)],
      ],
    };
    const user = open(
      "/?playout=color&pvars=m1,m2,m3,m4,m5,m6",
      { ...STATION, first_eov_column: "m1" },
      wideTable,
    );
    await plotted();
    expect(rowCaptioned("Color by")).toHaveTextContent("m5");
    expect(rowCaptioned("Color by")).not.toHaveTextContent("m6");

    await user.click(variableSearch("Color by"));
    expect(screen.getByText("Up to 5 variables")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "m6" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("grids the colour plot across several X, unpinned", async () => {
    const user = open("/?playout=color", STATION);
    await plotted();
    expect(document.querySelector(".pinnedAxis")).not.toBeNull();

    await user.click(variableSearch("X axis"));
    await user.click(screen.getByRole("option", { name: "salinity ( PSU )" }));

    await waitFor(() => expect(traceCount()).toBe(2));
    expect(rowCaptioned("X axis")).toHaveTextContent("time");
    expect(rowCaptioned("X axis")).toHaveTextContent("salinity");
    expect(document.querySelector(".pinnedAxis")).toBeNull();
  });

  it("offers a scale per colour variable in More options, not a colour", async () => {
    const user = open("/?playout=color", STATION);
    await plotted();
    await user.click(screen.getByRole("button", { name: "More options" }));
    const row = document
      .querySelector('label[for="rename-temperature"]')
      .closest(".labelEditorRow");
    expect(row.querySelector(".colorScaleChip")).not.toBeNull();
    expect(row.querySelector(".dropdownButtonSwatch")).toBeNull();
  });

  it("inverts a lone Y axis from the row that picks it, pressed for a depth", async () => {
    const user = open();
    const plot = await plotted();
    const invert = within(rowCaptioned("Y axis")).getByRole("button", {
      name: "Invert Y axis: depth ( m )",
    });
    expect(invert).toHaveAttribute("aria-pressed", "true");
    expect(plot).toHaveAttribute("data-y-autorange", "reversed");

    await user.click(invert);

    expect(invert).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("plotly")).not.toHaveAttribute(
      "data-y-autorange",
    );
    // One axis, one control: More options repeats no checkbox for it.
    await user.click(screen.getByRole("button", { name: "More options" }));
    expect(
      screen.queryByRole("checkbox", { name: /Invert Y axis/ }),
    ).not.toBeInTheDocument();
  });

  it("inverts each panel's own Y axis from More options once there are several", async () => {
    const user = open("/?pvars=temperature,salinity", {
      ...DATASET,
      cdm_data_type: "TimeSeries",
    });
    await plotted();
    expect(
      within(rowCaptioned("Y axis")).queryByRole("button", {
        name: /Invert Y axis/,
      }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "More options" }));
    expect(
      screen.getAllByRole("checkbox", { name: /Invert Y axis/ }),
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
    expect(strip).toHaveStyle({ width: "96px" });
  });

  it("pins a stack's shared axis below the scroller", async () => {
    open("/", { ...DATASET, cdm_data_type: "TimeSeries" });
    await plotted();
    const strip = document.querySelector(".pinnedAxis");
    expect(strip.parentElement).toHaveClass("isPinnedBelow");
    expect(strip).toHaveStyle({ height: "76px" });
  });

  it("names a record of many casts in a header row above the figure", async () => {
    open("/", { ...DATASET, cdm_data_type: "TimeSeriesProfile" });
    await plotted();
    expect(
      screen.getByRole("heading", { name: "Profile: record-1" }),
    ).toBeInTheDocument();
  });

  it("offers no layout for a record of one profile, its link's included", async () => {
    open("/?playout=color");
    const plot = await plotted();
    expect(screen.queryByText("Layout")).not.toBeInTheDocument();
    expect(plot).toHaveAttribute("data-hovermode", "y unified"); // still panels
  });

  it("draws every profile in the colour plot, so it has no cast slider", async () => {
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
    const user = open("/", STATION);
    await plotted();
    expect(
      await screen.findByRole("button", { name: "Previous profile" }),
    ).toBeInTheDocument();

    const layout = screen.getByTestId("preview-layout-toggle");
    expect(screen.getByRole("button", { name: "Panels" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Color plot" }));
    expect(layout).toContainElement(
      screen.getByRole("button", { name: "Color plot", pressed: true }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Previous profile" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("heading", { name: "Profile: record-1" }),
    ).toBeInTheDocument();
  });

  it("draws no header row for a record holding a single cast", async () => {
    open();
    await plotted();
    expect(screen.queryByText("Profile: record-1")).not.toBeInTheDocument();
  });

  it("opens the settings from a gear on a phone, over the plot", async () => {
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

  it("lets a finger scroll the plot rather than zoom it", async () => {
    setTouchScreen(true);
    open();
    const plot = await plotted();
    expect(plot).toHaveAttribute("data-dragmode", "false");
    // No hover to reveal the toolbar, which is where zooming went.
    expect(plot).toHaveAttribute("data-modebar", "true");
  });

  it("keeps drag-to-zoom and a hover toolbar for a mouse", async () => {
    open();
    const plot = await plotted();
    expect(plot).toHaveAttribute("data-dragmode", "zoom");
    expect(plot).toHaveAttribute("data-modebar", "hover");
  });

  it("names the record above the plot on a phone, not inside the figure", async () => {
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
    setViewportWidth(MOBILE_WIDTH);
    open("/", DATASET, table);
    await plotted();
    expect(
      screen.getByRole("heading", { name: "Cast: cast-7" }),
    ).toBeInTheDocument();
  });

  it("lets only one axis hold several variables", async () => {
    const user = open("/?pvars=temperature,salinity");
    await waitFor(() => expect(traceCount()).toBe(2));

    // X holds two, so picking on Y replaces its one variable.
    await user.click(variableSearch("Y axis"));
    await user.click(screen.getByRole("option", { name: "time ( UTC )" }));

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
    ).toEqual(["salinity ( PSU )", "time ( UTC )"]);
  });

  it("captions the colour scales once, with one picker each until shared", async () => {
    const user = open("/?pz=salinity,time&pmode=markers");
    await waitFor(() => expect(traceCount()).toBe(2));
    expect(screen.getAllByText("Color scale")).toHaveLength(1);
    const row = rowCaptioned("Color scale");
    expect(row.querySelectorAll(".colorScaleItem")).toHaveLength(2);

    await user.click(within(row).getByRole("button", { name: "Shared" }));
    await waitFor(() =>
      expect(row.querySelectorAll(".colorScaleItem")).toHaveLength(0),
    );
    expect(row.querySelectorAll(".colorScaleChip").length).toBeGreaterThan(0);
  });

  it("moves the panels to the other axis when it takes a second variable", async () => {
    const user = open();
    await plotted();
    await user.click(variableSearch("Y axis"));
    await user.click(screen.getByRole("option", { name: "salinity ( PSU )" }));

    await waitFor(() => expect(traceCount()).toBe(2));
    expect(rowCaptioned("Y axis")).toHaveTextContent("depth");
    expect(rowCaptioned("Y axis")).toHaveTextContent("salinity");
    expect(rowCaptioned("X axis")).toHaveTextContent("temperature");
  });

  it("adds a panel when a second variable is ticked", async () => {
    const user = open();
    await plotted();
    await user.click(variableSearch());
    await user.click(screen.getByRole("option", { name: "salinity ( PSU )" }));
    await waitFor(() => expect(traceCount()).toBe(2));
  });

  it("tags the variables the record leaves empty, in their usual place", async () => {
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
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["salinity ( PSU )", "oxygen ( ml/l )no data", "time ( UTC )"]);
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

  it("filters the variable list by what is typed", async () => {
    const user = open("/?pvars=temperature");
    await plotted();
    await user.type(variableSearch(), "sal");
    expect(
      screen.getByRole("option", { name: "salinity ( PSU )" }),
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

  it("switches the mode every panel is drawn in with one click", async () => {
    const user = open();
    await plotted();
    expect(
      screen.getByRole("button", { name: "Markers + Line" }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Markers" }));
    expect(screen.getByRole("button", { name: "Markers" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "Markers + Line" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("resets every plot setting and rename, disabled until there is one", async () => {
    const user = open("/?pz=salinity&pmode=lines");
    await plotted();
    await user.click(screen.getByRole("button", { name: "More options" }));
    await user.type(screen.getByLabelText("temperature ( degree_C )"), "Temp");

    await user.click(screen.getByRole("button", { name: "Reset plot" }));

    await waitFor(() =>
      expect(screen.queryByText("Color scale")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Markers + Line" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("temperature ( degree_C )")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Reset plot" })).toBeDisabled();
  });

  it("reveals the colour scale once a colour column is picked", async () => {
    const user = open();
    await plotted();
    await user.click(variableSearch("Color by"));
    await user.click(screen.getByRole("option", { name: "salinity ( PSU )" }));
    await waitFor(() =>
      expect(screen.getByText("Color scale")).toBeInTheDocument(),
    );
  });

  it("turns the colour column back off from its pill", async () => {
    const user = open("/?pz=salinity");
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
    await user.click(screen.getByRole("option", { name: "salinity ( PSU )" }));

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
    await user.type(screen.getByLabelText("temperature ( degree_C )"), "Temp");

    await user.click(screen.getByRole("button", { name: "Table" }));
    await user.click(screen.getByRole("button", { name: "Plot" }));
    await plotted();
    await user.click(screen.getByRole("button", { name: "More options" }));

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

  it("opens with the settings beside the plot on a large screen", async () => {
    open();
    await plotted();
    expect(screen.getByText("Plot type")).toBeVisible();
    expect(screen.getByRole("separator")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Plot settings" })).toBeNull();
  });
});
