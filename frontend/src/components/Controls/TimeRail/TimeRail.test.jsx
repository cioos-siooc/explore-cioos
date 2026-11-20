import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import TimeRail, {
  QUICK_PICKS,
  lastDaysRange,
  matchQuickPick,
  slideRange,
  IntervalSelect,
  useTimeAxis,
} from "./TimeRail.jsx";
import { createTimeAxis, todayIso } from "./timeAxis.js";

describe("QUICK_PICKS / lastDaysRange / matchQuickPick / slideRange", () => {
  it("lastDaysRange ends today and starts `days` earlier", () => {
    const { start, end } = lastDaysRange(10);
    expect(end).toBe(todayIso());
    expect(start < end).toBe(true);
  });

  it("matchQuickPick recognizes 'all' as the default range through today", () => {
    expect(matchQuickPick("1900-01-01", todayIso(), "1900-01-01")).toBe("all");
  });

  it("matchQuickPick matches a range by its length, wherever it sits", () => {
    const { start, end } = lastDaysRange(30);
    expect(matchQuickPick(start, end, "1900-01-01")).toBe("30");
  });

  it("matchQuickPick returns '' for a range matching no quick pick", () => {
    expect(matchQuickPick("2010-01-01", "2010-01-08", "1900-01-01")).toBe("");
  });

  it("slideRange keeps the window's length while moving its start", () => {
    const result = slideRange("start", "2010-06-01", {
      startDate: "2010-01-01",
      endDate: "2010-01-31",
      minIso: "1900-01-01",
      maxIso: "2025-01-01",
    });
    expect(result.start).toBe("2010-06-01");
    expect(result.end).toBe("2010-07-01");
  });

  it("slideRange fills the whole domain when the window is longer than it", () => {
    const result = slideRange("start", "2010-06-01", {
      startDate: "1900-01-01",
      endDate: "2025-01-01",
      minIso: "1900-01-01",
      maxIso: "2025-01-01",
    });
    expect(result).toEqual({ start: "1900-01-01", end: "2025-01-01" });
  });

  it("QUICK_PICKS has the four documented windows", () => {
    expect(QUICK_PICKS.map((p) => p.days)).toEqual([10, 30, 365, 3652]);
  });
});

describe("IntervalSelect", () => {
  it("selecting 'all' calls onSelect with the default start and maxIso", async () => {
    const onSelect = vi.fn();
    const { user } = renderWithProviders(
      <IntervalSelect
        startDate="2010-01-01"
        endDate="2010-01-08"
        defaultStart="1900-01-01"
        maxIso="2025-01-01"
        onSelect={onSelect}
        ariaLabel="Interval"
      />,
    );
    await user.selectOptions(screen.getByLabelText("Interval"), "all");
    expect(onSelect).toHaveBeenCalledWith("1900-01-01", "2025-01-01");
  });

  it("selecting a quick pick calls onSelect with a range of that length ending today", async () => {
    const onSelect = vi.fn();
    const { user } = renderWithProviders(
      <IntervalSelect
        startDate="2010-01-01"
        endDate="2010-01-08"
        defaultStart="1900-01-01"
        maxIso="2025-01-01"
        onSelect={onSelect}
        ariaLabel="Interval"
      />,
    );
    await user.selectOptions(screen.getByLabelText("Interval"), "30");
    expect(onSelect).toHaveBeenCalledWith(...Object.values(lastDaysRange(30)));
  });
});

describe("useTimeAxis", () => {
  function Probe(props) {
    const { axis, domainStart, domainEnd } = useTimeAxis(props);
    return (
      <span data-testid="out">
        {domainStart}|{domainEnd}|{axis.minIso}|{axis.maxIso}
      </span>
    );
  }

  it("defaults the domain to the data extent when the filter is inactive", () => {
    render(
      <Probe
        timeExtent={{
          min: "2010-01-01T00:00:00+00:00",
          max: "2015-06-01T00:00:00+00:00",
        }}
        timeFilterActive={false}
        startDate="1900-01-01"
        endDate={todayIso()}
      />,
    );
    const [domainStart, domainEnd] = screen
      .getByTestId("out")
      .textContent.split("|");
    expect(domainStart).toBe("2010-01-01");
    expect(domainEnd).toBe("2015-06-01");
  });

  it("widens the domain to an active filter's start when it reaches earlier than the data", () => {
    render(
      <Probe
        timeExtent={{
          min: "2010-01-01T00:00:00+00:00",
          max: "2015-06-01T00:00:00+00:00",
        }}
        timeFilterActive
        startDate="1950-01-01"
        endDate="2012-01-01"
      />,
    );
    const [domainStart] = screen.getByTestId("out").textContent.split("|");
    expect(domainStart).toBe("1950-01-01");
  });
});

describe("TimeRail (component)", () => {
  it("renders range handles for startDate/endDate and a scrub handle when given", () => {
    const axis = createTimeAxis("2010-01-01", "2020-01-01");
    render(
      <TimeRail
        axis={axis}
        startDate="2012-01-01"
        endDate="2018-01-01"
        scrub={{ value: "2015-06-01", trailStartMs: 0 }}
        onCommit={() => {}}
      />,
    );
    expect(screen.getAllByRole("slider")).toHaveLength(3);
  });

  it("renders only the two range handles when scrub is absent", () => {
    const axis = createTimeAxis("2010-01-01", "2020-01-01");
    render(
      <TimeRail
        axis={axis}
        startDate="2012-01-01"
        endDate="2018-01-01"
        onCommit={() => {}}
      />,
    );
    expect(screen.getAllByRole("slider")).toHaveLength(2);
  });

  it("Home on the start handle commits the axis minimum as an ISO date", async () => {
    const axis = createTimeAxis("2010-01-01", "2020-01-01");
    const onCommit = vi.fn();
    render(
      <TimeRail
        axis={axis}
        startDate="2012-01-01"
        endDate="2018-01-01"
        onCommit={onCommit}
      />,
    );
    const [startHandle] = screen.getAllByRole("slider");
    fireEvent.keyDown(startHandle, { key: "Home" });
    await waitFor(() =>
      expect(onCommit).toHaveBeenCalledWith("start", "2010-01-01"),
    );
  });
});
