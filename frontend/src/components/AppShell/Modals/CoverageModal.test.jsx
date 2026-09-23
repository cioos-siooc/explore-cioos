import * as React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import CoverageModal from "./CoverageModal.jsx";

// Plotly draws to a real canvas and probes media queries jsdom's stub does not
// answer (src/test/viewport.js). Nothing here is about what it renders, so it
// stands in as the marker that the plot is mounted at all.
vi.mock(
  "../../Controls/CoverageHistogramPlot/CoverageHistogramPlot.jsx",
  () => ({
    default: ({ histogram }) => (
      <div data-testid="coverage-plot">{histogram.count}</div>
    ),
  }),
);

/*
 * The figure's queries are the most expensive the API answers — seconds each
 * when its own cache is cold — and the two dropdowns are the controls people
 * move most. So what this covers is not what the figure draws but how often it
 * asks: a combination already looked at must not be fetched again.
 */
describe("CoverageModal", () => {
  beforeEach(() => {
    installMockFetch();
  });

  function open() {
    function Opener() {
      const { setShowCoverageModal } = useUI();
      React.useEffect(() => setShowCoverageModal(true), [setShowCoverageModal]);
      return null;
    }
    const user = userEvent.setup({ delay: null });
    renderWithProviders(
      <>
        <Opener />
        <CoverageModal />
      </>,
      { providers: "app" },
    );
    return user;
  }

  const histogramCalls = () =>
    global.fetch.mock.calls
      .map(([input]) => (typeof input === "string" ? input : input.url))
      .filter((url) => url.includes("/coverageHistogram"));

  async function chooseCount(user, label) {
    await user.click(screen.getByTestId("coverage-count-dropdown-toggle"));
    const option = screen
      .getAllByTestId("coverage-count-option")
      .find((el) => el.textContent === label);
    await user.click(option);
  }

  it("does not refetch a count it has already loaded", async () => {
    const user = open();
    await waitFor(() => expect(histogramCalls()).toHaveLength(1));
    const first = histogramCalls()[0];
    expect(first).toContain("count=days");

    await chooseCount(user, "Datasets");
    await waitFor(() => expect(histogramCalls()).toHaveLength(2));
    expect(histogramCalls()[1]).toContain("count=datasets");

    // Back to the one already held: answered from memory, no third request.
    await chooseCount(user, "Days of data");
    await waitFor(() =>
      expect(
        screen.getByTestId("coverage-count-dropdown-toggle"),
      ).toHaveTextContent("Days of data"),
    );
    expect(histogramCalls()).toHaveLength(2);
  });

  it("keeps the previous figure on screen while the next one loads", async () => {
    const user = open();
    await waitFor(() => expect(histogramCalls()).toHaveLength(1));
    await waitFor(() =>
      expect(document.querySelector(".coveragePlotCurrent")).not.toBeNull(),
    );

    // Hold the next response open so the in-flight state is observable.
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const realFetch = global.fetch;
    global.fetch = (...args) => pending.then(() => realFetch(...args));

    await chooseCount(user, "Datasets");

    // The bars are still drawn, dimmed and marked busy — not swapped for a
    // spinner over an empty area.
    await waitFor(() =>
      expect(document.querySelector(".coveragePlotStale")).not.toBeNull(),
    );
    expect(document.querySelector(".coveragePlotStale")).toHaveAttribute(
      "aria-busy",
      "true",
    );

    release();
    await waitFor(() =>
      expect(document.querySelector(".coveragePlotCurrent")).not.toBeNull(),
    );
  });
});
