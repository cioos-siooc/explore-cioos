import * as React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { MOBILE_WIDTH, setViewportWidth } from "../../../test/viewport.js";
import DatasetPreview from "./DatasetPreview.jsx";
import { PREVIEW_ERROR } from "./previewErrors.js";

// Plotly draws to a real canvas and probes media queries jsdom's stub does not
// answer. The stand-in reads the context instead, so what these assert is the
// thing the modal is actually responsible for: that the plot is reached, and
// reached with the settings the record opened on.
const plotCrash = vi.hoisted(() => ({ error: null }));
vi.mock("../DatasetPreviewPlot/DatasetPreviewPlot.jsx", async () => {
  const { usePreviewPlot } = await import("./PreviewPlotProvider.jsx");
  return {
    default: function MockPlot() {
      if (plotCrash.error) throw plotCrash.error;
      const { sharedAxis, panels, plotType, availableHeight } =
        usePreviewPlot();
      return (
        <div data-testid="preview-plot">
          {`${sharedAxis}|${panels.join(",")}|${plotType}|${typeof availableHeight}`}
        </div>
      );
    },
  };
});

const PROFILE_TABLE = {
  columnNames: ["depth", "temperature", "salinity"],
  columnTypes: ["float", "float", "float"],
  columnUnits: ["m", "degree_C", "PSU"],
  rows: [
    [0, 10, 30],
    [5, 9, 31],
  ],
};

// A Profile with no vertical coordinate: a plottable type whose record is
// missing the one column the layout needs.
const NO_AXIS_TABLE = {
  columnNames: ["temperature", "salinity"],
  columnTypes: ["float", "float"],
  columnUnits: ["degree_C", "PSU"],
  rows: [[10, 30]],
};

const DATASET = {
  dataset_id: "d1",
  title: "Test dataset",
  cdm_data_type: "Profile",
  first_eov_column: "temperature",
};

function open({
  table = PROFILE_TABLE,
  dataset = DATASET,
  previewError = null,
  previewQuery,
  recordLoading = false,
  setInspectRecordID = vi.fn(),
  retryPreview = vi.fn(),
  url = "/",
  sample,
} = {}) {
  const user = userEvent.setup({ delay: null });
  const result = renderWithProviders(
    <DatasetPreview
      datasetPreview={table ? { table, sample } : null}
      previewError={previewError}
      previewQuery={previewQuery}
      retryPreview={retryPreview}
      inspectDataset={dataset}
      inspectRecordID="record-1"
      setInspectRecordID={setInspectRecordID}
      showModal
      recordLoading={recordLoading}
      setRecordLoading={vi.fn()}
    />,
    { url },
  );
  return { user, setInspectRecordID, ...result };
}

describe("DatasetPreview", () => {
  beforeEach(() => {
    // The profile list is fetched separately and is allowed to fail: a record
    // whose list does not arrive simply gets no slider.
    global.fetch = vi.fn(() => Promise.reject(new Error("no profile list")));
    plotCrash.error = null;
  });

  describe("which of the five states the body shows", () => {
    it("reaches the plot, carrying the settings the record opened on", async () => {
      open();
      await waitFor(() =>
        expect(screen.getByTestId("preview-plot")).toBeInTheDocument(),
      );
      // The provider is what hands these over — the plot takes no props.
      expect(screen.getByTestId("preview-plot")).toHaveTextContent(
        "depth|temperature|markers+lines|number",
      );
    });

    it("shows the table instead once the user asks for it", async () => {
      const { user } = open();
      await waitFor(() =>
        expect(screen.getByTestId("preview-plot")).toBeInTheDocument(),
      );

      await user.click(screen.getByRole("button", { name: "Table" }));

      expect(screen.queryByTestId("preview-plot")).not.toBeInTheDocument();
      expect(screen.getByText("Test dataset:")).toBeInTheDocument();
    });

    it("shows only the loading scrim while the record is still arriving", () => {
      global.fetch = vi.fn(() => new Promise(() => {}));
      open({ recordLoading: true });
      expect(screen.queryByTestId("preview-plot")).not.toBeInTheDocument();
      // Names what it is waiting on, like the app's splash.
      const loading = screen.getByTestId("preview-loading");
      expect(loading).toHaveTextContent(/fetching the record/i);
      expect(loading).toHaveTextContent(/listing the profiles/i);
    });

    it("links the ERDDAP request while it is running", () => {
      global.fetch = vi.fn(() => new Promise(() => {}));
      const url = "https://erddap.example.com/erddap/tabledap/d1.json?&id=1";
      open({ recordLoading: true, previewQuery: url });
      expect(screen.getByTestId("preview-loading")).toHaveTextContent(
        /querying erddap/i,
      );
      const link = screen.getByRole("link", { name: url });
      expect(link).toHaveAttribute("href", url);
      expect(link).toHaveAttribute("target", "_blank");
      // The Table/Plot toggle is withheld too until there is something to show.
      expect(
        screen.queryByRole("button", { name: "Table" }),
      ).not.toBeInTheDocument();
    });

    it("names why /preview came back with nothing", () => {
      open({ table: null, previewError: { code: PREVIEW_ERROR.NO_DATA } });
      expect(
        screen.getByText(/no data in the preview window/i),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("preview-plot")).not.toBeInTheDocument();
    });

    it("gives the error code and the data server's status beneath the sentence", () => {
      open({
        table: null,
        previewError: {
          code: PREVIEW_ERROR.ERDDAP_UNAVAILABLE,
          upstreamStatus: 503,
          erddapQuery: "https://erddap.example.com/erddap/tabledap/d1.json",
        },
      });
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Error: ERDDAP_UNAVAILABLE (the data server answered HTTP 503)",
      );
      // The request that failed, so the reader can try it themselves.
      expect(
        screen.getByRole("link", {
          name: "https://erddap.example.com/erddap/tabledap/d1.json",
        }),
      ).toBeInTheDocument();
    });

    it("keeps a plot that throws inside the modal and says why", async () => {
      plotCrash.error = new Error("bad trace");
      vi.spyOn(console, "error").mockImplementation(() => {});
      open();
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/figure could not be drawn/i);
      expect(alert).toHaveTextContent("bad trace");
      // The Table view stays reachable.
      expect(screen.getByRole("button", { name: "Table" })).toBeInTheDocument();
    });

    it("offers a retry when the data server did not answer", async () => {
      const retryPreview = vi.fn();
      const { user } = open({
        table: null,
        previewError: { code: PREVIEW_ERROR.ERDDAP_UNAVAILABLE },
        retryPreview,
      });
      await user.click(screen.getByRole("button", { name: "Retry" }));
      expect(retryPreview).toHaveBeenCalledTimes(1);
    });

    it("offers no retry for a record that has no data to give", () => {
      open({ table: null, previewError: { code: PREVIEW_ERROR.NO_DATA } });
      expect(
        screen.queryByRole("button", { name: "Retry" }),
      ).not.toBeInTheDocument();
    });

    it("falls back to the generic sentence for a failure it has no words for", () => {
      open({ table: null, previewError: { code: PREVIEW_ERROR.UNKNOWN } });
      expect(screen.getByText(/can not be previewed/i)).toBeInTheDocument();
    });

    it("names the column the record is missing rather than blaming the type", () => {
      open({ table: NO_AXIS_TABLE });
      expect(
        screen.getByText(/it looked for a depth or altitude column/i),
      ).toBeInTheDocument();
      // And lists what the record does have, so the reader can see the gap.
      expect(
        screen.getByText(/Columns in this record: temperature, salinity/i),
      ).toBeInTheDocument();
    });
  });

  describe("the modal shell", () => {
    it("clears the record — and with it every plot param — on close", async () => {
      const { user, setInspectRecordID } = open();
      await user.click(screen.getByRole("button", { name: /close/i }));
      // Called with nothing: one write clears ?preview= and the plot params
      // together, because react-router drops one of two writes in a tick.
      expect(setInspectRecordID).toHaveBeenCalledWith();
    });

    it("puts the Plot button before the Table button", () => {
      open();
      const plot = screen.getByRole("button", { name: "Plot" });
      const table = screen.getByRole("button", { name: "Table" });
      expect(
        plot.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("copies the link from an icon-only button that still has a name", async () => {
      const { user } = open();
      const copy = screen.getByRole("button", { name: "Copy link" });
      expect(copy).toHaveTextContent("");
      expect(copy).toHaveAttribute("title", "Copy link");

      await user.click(copy);
      expect(
        screen.getByRole("button", { name: "Link copied!" }),
      ).toBeInTheDocument();
    });

    it("titles itself with the dataset and the record", () => {
      open({ url: "/?vis=table" });
      expect(screen.getByText("Test dataset:")).toBeInTheDocument();
      expect(screen.getByText("record-1")).toBeInTheDocument();
    });

    it("is named by that title for a screen reader", () => {
      open();
      expect(
        screen.getByRole("dialog", { name: /Test dataset: record-1/ }),
      ).toBeInTheDocument();
    });

    it("leaves the record to the plot's own title on a desktop plot", () => {
      open();
      expect(screen.getByText("record-1")).toHaveClass("sr-only");
    });

    it("keeps the record in sight over a table, which has no title", () => {
      open({ url: "/?vis=table" });
      expect(screen.getByText("record-1")).not.toHaveClass("sr-only");
    });

    it("keeps the record in sight on a phone, which hides the plot's heading", () => {
      setViewportWidth(MOBILE_WIDTH);
      open();
      expect(screen.getByText("record-1")).not.toHaveClass("sr-only");
    });
  });

  describe("saying when the rows are only part of the record", () => {
    const STATION_TABLE = {
      columnNames: ["profile", "time", "depth", "temperature"],
      columnTypes: ["String", "String", "float", "float"],
      columnUnits: [null, "UTC", "m", "degree_C"],
      rows: [
        ["cast-1", "2024-01-01T00:00:00Z", 0, 10],
        ["cast-1", "2024-01-01T00:00:00Z", 5, 9],
        ["cast-2", "2024-01-02T00:00:00Z", 0, 11],
      ],
    };
    const STATION = { ...DATASET, cdm_data_type: "TimeSeriesProfile" };
    const listsProfiles = () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              column: "profile",
              steps: [{ value: "cast-1" }, { value: "cast-2" }],
              count: 335,
              truncated: false,
            }),
        }),
      );
    };

    it("counts the rows beside the title", () => {
      open({ sample: { rowCount: 2, totalRowCount: 26131 } });
      expect(screen.getByText("Sample: 2 of 26,131 rows")).toBeInTheDocument();
    });

    it("counts nothing when the rows are all of the record", () => {
      open({ sample: { rowCount: 2, totalRowCount: 2 } });
      expect(screen.queryByText(/^Sample:/)).not.toBeInTheDocument();
      expect(screen.queryByText(/rows$/)).not.toBeInTheDocument();
    });

    it("explains what a sample holds", () => {
      open({ sample: { rowCount: 2, totalRowCount: 26131 } });
      expect(screen.getByText("Sample: 2 of 26,131 rows")).toHaveAttribute(
        "title",
        expect.stringMatching(/most recent/),
      );
    });

    it("counts the profiles too when the window holds several", async () => {
      listsProfiles();
      open({
        table: STATION_TABLE,
        dataset: STATION,
        url: "/?playout=panels",
        sample: { rowCount: 3, totalRowCount: 26131 },
      });
      expect(
        await screen.findByText("Sample: 2 of 335 profiles · 3 of 26,131 rows"),
      ).toBeInTheDocument();
    });

    it("says the colour plot draws every profile in the window", async () => {
      listsProfiles();
      open({
        table: STATION_TABLE,
        dataset: STATION,
        url: "/?playout=color",
        sample: { rowCount: 3, totalRowCount: 26131 },
      });
      expect(
        await screen.findByText(
          "Sample: every profile in the latest 3 of 26,131 rows (2 of 335 profiles)",
        ),
      ).toBeInTheDocument();
    });

    it("counts rows only while one chosen profile is drawn", async () => {
      listsProfiles();
      open({
        table: STATION_TABLE,
        dataset: STATION,
        url: "/?pstep=cast-1&playout=panels",
        sample: { rowCount: 3, totalRowCount: 1500 },
      });
      await waitFor(() => expect(global.fetch).toHaveBeenCalled());
      await act(() => new Promise((resolve) => setTimeout(resolve, 0))); // the list lands
      expect(screen.getByText("Sample: 3 of 1,500 rows")).toBeInTheDocument();
    });
  });

  // The plot is a stand-in here, so these go through the Table view; the
  // plot's own header and pane are covered in DatasetPreviewPlot.test.jsx.
  describe("paging a window of the record from the table", () => {
    const TIMESERIES_TABLE = {
      columnNames: ["time", "temperature"],
      columnTypes: ["String", "float"],
      columnUnits: ["UTC", "degree_C"],
      rows: [
        ["2024-03-01T12:00:00Z", 10],
        ["2024-03-01T06:00:00Z", 9],
      ],
    };
    const TIMESERIES = { ...DATASET, cdm_data_type: "TimeSeries" };
    const openWindow = ({ url = "/?vis=table", ...options } = {}) =>
      open({ table: TIMESERIES_TABLE, dataset: TIMESERIES, url, ...options });
    const search = () => new URLSearchParams(window.location.search);
    const earlier = () => screen.queryByRole("button", { name: "Earlier" });

    it("offers nothing when the rows are the whole record", () => {
      openWindow({ sample: { rowCount: 2, totalRowCount: 2 } });
      expect(earlier()).not.toBeInTheDocument();
    });

    it("pages back from the earliest row shown, then back to the latest", async () => {
      const { user } = openWindow({
        sample: { rowCount: 2, totalRowCount: 26131 },
      });
      await user.click(earlier());
      expect(search().get("pbefore")).toBe("2024-03-01T06:00:00.000Z");

      await user.click(await screen.findByRole("button", { name: "Latest" }));
      expect(search().get("pbefore")).toBeNull();
    });

    it("stops at the start of the record", () => {
      openWindow({
        url: "/?vis=table&pbefore=2024-03-02T00:00:00.000Z",
        sample: { rowCount: 2, totalRowCount: 26131, startOfRecord: true },
      });
      expect(earlier()).toBeDisabled();
    });

    it("does not page a period, whose window is fixed", () => {
      renderWithProviders(
        <DatasetPreview
          datasetPreview={{
            table: TIMESERIES_TABLE,
            sample: { rowCount: 2, totalRowCount: 900 },
          }}
          inspectDataset={TIMESERIES}
          inspectRecordID="record-1"
          inspectRecordPeriod={{ start: "2024-03-01", end: "2024-03-02" }}
          setInspectRecordID={vi.fn()}
          showModal
          recordLoading={false}
          setRecordLoading={vi.fn()}
        />,
        { url: "/?vis=table" },
      );
      expect(earlier()).not.toBeInTheDocument();
    });
  });
});
