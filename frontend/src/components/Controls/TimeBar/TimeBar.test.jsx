import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import { MOBILE_WIDTH, setViewportWidth } from "../../../test/viewport.js";
import TimeBar from "./TimeBar.jsx";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";

function Harness() {
  const { catalogLoaded } = useFilters();
  if (!catalogLoaded) return <span data-testid="state">loading</span>;
  return (
    <>
      <span data-testid="state">loaded</span>
      <TimeBar />
    </>
  );
}

async function renderReady(options) {
  const result = renderWithProviders(<Harness />, {
    providers: "app",
    ...options,
  });
  await waitFor(() =>
    expect(screen.getByTestId("state")).toHaveTextContent("loaded"),
  );
  return result;
}

describe("TimeBar", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("renders nothing while the time filter is inactive (the default)", async () => {
    await renderReady();
    expect(document.querySelector(".timeBar")).not.toBeInTheDocument();
  });

  it("renders the bar once the time filter is active via the URL", async () => {
    await renderReady({ url: "/?timeMin=2015-01-01T00:00:00Z" });
    expect(document.querySelector(".timeBar")).toBeInTheDocument();
    expect(screen.getAllByRole("slider")).toHaveLength(2);
  });

  it("renders nothing on a phone-width viewport even with the filter active", async () => {
    setViewportWidth(MOBILE_WIDTH);
    await renderReady({ url: "/?timeMin=2015-01-01T00:00:00Z" });
    expect(document.querySelector(".timeBar")).not.toBeInTheDocument();
  });

  it("Reset restores the default start/end dates", async () => {
    const { user } = await renderReady({
      url: "/?timeMin=2015-01-01T00:00:00Z",
    });
    await user.click(screen.getByTitle("Reset the time range to all dates"));
    await waitFor(() =>
      expect(document.querySelector(".timeBar")).not.toBeInTheDocument(),
    );
  });

  it("typing a valid start date commits it", async () => {
    await renderReady({ url: "/?timeMin=2015-01-01" });
    const input = screen.getByLabelText("Start Date");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "2016-06-15" } });
    await waitFor(() => expect(input.value).toBe("2016-06-15"));
  });

  it("choosing an interval locks the range, so dragging a handle slides the whole window", async () => {
    const { user } = await renderReady({ url: "/?timeMin=2015-01-01" });
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
    await renderReady({ url: "/?timeMin=2015-01-01&timeMax=2015-06-01" });
    const endBefore = screen.getByLabelText("End Date").value;

    fireEvent.keyDown(
      screen.getByRole("slider", { name: "Time range start" }),
      { key: "ArrowRight" },
    );

    await waitFor(() => {
      const start = screen.getByLabelText("Start Date").value;
      expect(start).toBe("2015-01-02");
    });
    // The end date is untouched — this range isn't one of the ready-made
    // windows, so a drag moves only the handle that moved.
    expect(screen.getByLabelText("End Date").value).toBe(endBefore);
  });
});
