import * as React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import DatasetPreview from "./DatasetPreview.jsx";
import { PREVIEW_ERROR } from "./previewErrors.js";

// Plotly draws to a real canvas and probes media queries jsdom's stub does not
// answer. The stand-in reads the context instead, so what these assert is the
// thing the modal is actually responsible for: that the plot is reached, and
// reached with the settings the record opened on.
vi.mock("../DatasetPreviewPlot/DatasetPreviewPlot.jsx", async () => {
  const { usePreviewPlot } = await import("./PreviewPlotProvider.jsx");
  return {
    default: function MockPlot() {
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
  recordLoading = false,
  setInspectRecordID = vi.fn(),
  url = "/",
} = {}) {
  const user = userEvent.setup({ delay: null });
  const result = renderWithProviders(
    <DatasetPreview
      datasetPreview={table ? { table } : null}
      previewError={previewError}
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
  });

  describe("which of the five states the body shows", () => {
    it("reaches the plot, carrying the settings the record opened on", async () => {
      open();
      await waitFor(() =>
        expect(screen.getByTestId("preview-plot")).toBeInTheDocument(),
      );
      // The provider is what hands these over — the plot takes no props.
      expect(screen.getByTestId("preview-plot")).toHaveTextContent(
        "depth|temperature|markers|number",
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
      open({ recordLoading: true });
      expect(screen.queryByTestId("preview-plot")).not.toBeInTheDocument();
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

    it("titles itself with the dataset and the record", () => {
      open();
      expect(screen.getByText("Test dataset:")).toBeInTheDocument();
      expect(screen.getByText("record-1")).toBeInTheDocument();
    });
  });
});
