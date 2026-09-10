import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import DepthRail, {
  DepthField,
  isCommittable,
  DEPTH_PRESETS,
  matchDepthPreset,
  DepthPresetSelect,
  useDepthAxis,
} from "./DepthRail.jsx";
import { createDepthAxis } from "./depthAxis.js";

describe("isCommittable", () => {
  it("requires a plain integer within range", () => {
    expect(isCommittable("500", 0, 1000)).toBe(true);
    expect(isCommittable("1500", 0, 1000)).toBe(false);
    expect(isCommittable("-5", 0, 1000)).toBe(false);
    expect(isCommittable("5.5", 0, 1000)).toBe(false);
    expect(isCommittable("", 0, 1000)).toBe(false);
  });
});

describe("DepthField", () => {
  it("commits as soon as a complete in-range integer is typed", () => {
    const onCommit = vi.fn();
    render(<DepthField value={0} min={0} max={1000} label="Start" onCommit={onCommit} />);
    const input = screen.getByLabelText("Start");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "500" } });
    expect(onCommit).toHaveBeenCalledWith(500);
  });

  it("restores the committed value on blur when left incomplete", () => {
    render(<DepthField value={100} min={0} max={1000} label="Start" onCommit={() => {}} />);
    const input = screen.getByLabelText("Start");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(input.value).toBe("100");
  });
});

describe("DEPTH_PRESETS / matchDepthPreset", () => {
  it("matches 'all' when the range spans the full domain", () => {
    expect(matchDepthPreset(0, 12000, 0, 12000)).toBe("all");
  });

  it("matches a named preset by its exact bounds", () => {
    expect(matchDepthPreset(0, 500, 0, 12000)).toBe("0-500");
  });

  it("returns '' for a range matching no preset", () => {
    expect(matchDepthPreset(10, 200, 0, 12000)).toBe("");
  });

  it("has the four documented bands", () => {
    expect(DEPTH_PRESETS.map((p) => p.key)).toEqual([
      "0-100",
      "0-500",
      "0-1000",
      "1000+",
    ]);
  });
});

describe("DepthPresetSelect", () => {
  it("selecting a preset calls onSelect with its start/end", async () => {
    const onSelect = vi.fn();
    const { user } = renderWithProviders(
      <DepthPresetSelect
        startDepth={0}
        endDepth={12000}
        min={0}
        max={12000}
        onSelect={onSelect}
        ariaLabel="Band"
      />,
    );
    await user.selectOptions(screen.getByLabelText("Band"), "0-100");
    expect(onSelect).toHaveBeenCalledWith(0, 100);
  });
});

describe("useDepthAxis", () => {
  it("builds an axis spanning the given min/max", () => {
    function Probe() {
      const axis = useDepthAxis(0, 12000);
      return <span data-testid="out">{axis.min}-{axis.max}</span>;
    }
    render(<Probe />);
    expect(screen.getByTestId("out")).toHaveTextContent("0-12000");
  });
});

describe("DepthRail (component)", () => {
  it("renders start/end handles at the given depths", () => {
    const axis = createDepthAxis(0, 12000);
    render(
      <DepthRail axis={axis} startDepth={100} endDepth={500} onCommit={() => {}} />,
    );
    const [start, end] = screen.getAllByRole("slider");
    expect(start).toHaveAttribute("aria-valuenow", "100");
    expect(end).toHaveAttribute("aria-valuenow", "500");
  });

  it("End on the end handle commits the axis maximum", () => {
    const axis = createDepthAxis(0, 12000);
    const onCommit = vi.fn();
    render(
      <DepthRail axis={axis} startDepth={100} endDepth={500} onCommit={onCommit} />,
    );
    const [, end] = screen.getAllByRole("slider");
    fireEvent.keyDown(end, { key: "End" });
    expect(onCommit).toHaveBeenCalledWith("end", 12000);
  });

  it("renders vertically when orientation='vertical'", () => {
    const axis = createDepthAxis(0, 12000);
    render(
      <DepthRail
        axis={axis}
        orientation="vertical"
        startDepth={0}
        endDepth={12000}
        onCommit={() => {}}
      />,
    );
    expect(document.querySelector(".rail")).toHaveClass("railVertical");
  });
});
