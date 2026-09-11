import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../../test/mockFetch.js";
import TimeSelector from "./TimeSelector.jsx";
import { useFilters } from "../../../../state/filters/FilterProvider.jsx";

function Harness() {
  const { catalogLoaded, startDate, endDate, setStartDate, setEndDate } =
    useFilters();
  if (!catalogLoaded) return <span data-testid="state">loading</span>;
  return (
    <>
      <span data-testid="state">loaded</span>
      <TimeSelector
        startDate={startDate}
        endDate={endDate}
        setStartDate={setStartDate}
        setEndDate={setEndDate}
      />
    </>
  );
}

async function renderReady() {
  const result = renderWithProviders(<Harness />, { providers: "app" });
  await waitFor(() =>
    expect(screen.getByTestId("state")).toHaveTextContent("loaded"),
  );
  return result;
}

describe("TimeSelector", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("renders start/end date fields and a rail with two handles", async () => {
    await renderReady();
    expect(screen.getByLabelText("Start Date")).toBeInTheDocument();
    expect(screen.getByLabelText("End Date")).toBeInTheDocument();
    expect(screen.getAllByRole("slider")).toHaveLength(2);
  });

  it("choosing an interval sets both dates via the shared FilterProvider state", async () => {
    const { user } = await renderReady();
    await user.selectOptions(screen.getByLabelText("Interval"), "30");
    await waitFor(() => {
      const start = screen.getByLabelText("Start Date").value;
      const end = screen.getByLabelText("End Date").value;
      expect(start < end).toBe(true);
    });
  });

  it("typing a valid start date commits it", async () => {
    await renderReady();
    const input = screen.getByLabelText("Start Date");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "2015-06-15" } });
    await waitFor(() => expect(input.value).toBe("2015-06-15"));
  });

  it("choosing an interval locks the range, so dragging a handle slides the whole window", async () => {
    const { user } = await renderReady();
    await user.selectOptions(screen.getByLabelText("Interval"), "30");
    const startBefore = screen.getByLabelText("Start Date").value;
    const endBefore = screen.getByLabelText("End Date").value;
    expect(startBefore < endBefore).toBe(true);

    // The picked window ends today, so it's already flush against the axis's
    // right edge — ArrowLeft (earlier) is what moves it without clamping.
    fireEvent.keyDown(
      screen.getByRole("slider", { name: "Time range start" }),
      { key: "ArrowLeft" },
    );

    await waitFor(() => {
      const start = screen.getByLabelText("Start Date").value;
      const end = screen.getByLabelText("End Date").value;
      // The window kept its length (30 days) rather than just the start
      // handle moving on its own.
      expect(start < startBefore).toBe(true);
      expect(end < endBefore).toBe(true);
    });
  });

  it("dragging a handle on a hand-set (unlocked) range moves only that end", async () => {
    await renderReady();
    const input = screen.getByLabelText("Start Date");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "2015-01-01" } });
    fireEvent.blur(input);
    await waitFor(() => expect(input.value).toBe("2015-01-01"));
    const endInput = screen.getByLabelText("End Date");
    fireEvent.focus(endInput);
    fireEvent.change(endInput, { target: { value: "2015-06-01" } });
    fireEvent.blur(endInput);
    await waitFor(() => expect(endInput.value).toBe("2015-06-01"));
    const endBefore = endInput.value;

    fireEvent.keyDown(
      screen.getByRole("slider", { name: "Time range start" }),
      { key: "ArrowRight" },
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Start Date").value).toBe("2015-01-02"),
    );
    // The end date is untouched — this range isn't one of the ready-made
    // windows, so a drag moves only the handle that moved.
    expect(screen.getByLabelText("End Date").value).toBe(endBefore);
  });
});
