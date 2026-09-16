import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import Rail from "./Rail.jsx";

// A trivial linear axis over 0..100, so pixel positions map to round values.
const axis = {
  min: 0,
  max: 100,
  toPos: (v) => v / 100,
  toValue: (pos) => pos * 100,
};

function stubTrackRect(width = 200, height = 40) {
  Element.prototype.getBoundingClientRect = function () {
    return {
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      x: 0,
      y: 0,
    };
  };
}

describe("Rail", () => {
  it("renders one slider handle per entry in handles, positioned by axis.toPos", () => {
    render(
      <Rail
        axis={axis}
        handles={[
          { key: "start", value: 20, label: "Start" },
          { key: "end", value: 80, label: "End" },
        ]}
        onCommit={() => {}}
      />,
    );
    const sliders = screen.getAllByRole("slider");
    expect(sliders).toHaveLength(2);
    expect(sliders[0]).toHaveStyle({ left: "20%" });
    expect(sliders[1]).toHaveStyle({ left: "80%" });
    expect(sliders[0]).toHaveAttribute("aria-valuenow", "20");
  });

  it("renders bands as spans between their from/to positions", () => {
    render(
      <Rail
        axis={axis}
        handles={[{ key: "a", value: 0, label: "A" }]}
        bands={[{ key: "range", from: 10, to: 60, className: "railFill" }]}
        onCommit={() => {}}
      />,
    );
    const band = document.querySelector(".railFill");
    expect(band).toHaveStyle({ left: "10%", width: "50%" });
  });

  it("ArrowRight steps a handle forward by stepFor's amount, clamped to axis.max", () => {
    const onCommit = vi.fn();
    render(
      <Rail
        axis={axis}
        handles={[{ key: "a", value: 95, label: "A" }]}
        stepFor={() => 10}
        onCommit={onCommit}
      />,
    );
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
    expect(onCommit).toHaveBeenCalledWith("a", 100);
  });

  it("ArrowLeft steps a handle backward, clamped to axis.min", () => {
    const onCommit = vi.fn();
    render(
      <Rail
        axis={axis}
        handles={[{ key: "a", value: 5, label: "A" }]}
        stepFor={() => 10}
        onCommit={onCommit}
      />,
    );
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowLeft" });
    expect(onCommit).toHaveBeenCalledWith("a", 0);
  });

  it("Home/End jump to axis.min/axis.max", () => {
    const onCommit = vi.fn();
    render(
      <Rail
        axis={axis}
        handles={[{ key: "a", value: 50, label: "A" }]}
        onCommit={onCommit}
      />,
    );
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "End" });
    expect(onCommit).toHaveBeenLastCalledWith("a", 100);
    fireEvent.keyDown(slider, { key: "Home" });
    expect(onCommit).toHaveBeenLastCalledWith("a", 0);
  });

  it("applies snap to a committed value", () => {
    const onCommit = vi.fn();
    render(
      <Rail
        axis={axis}
        handles={[{ key: "a", value: 50, label: "A" }]}
        stepFor={() => 3}
        snap={(v) => Math.round(v / 10) * 10}
        onCommit={onCommit}
      />,
    );
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
    // 50 + 3 = 53, snapped to nearest 10 -> 50
    expect(onCommit).toHaveBeenCalledWith("a", 50);
  });

  it("a track pointerdown moves the nearest handle to the pointer position", () => {
    stubTrackRect(200, 40);
    const onCommit = vi.fn();
    render(
      <Rail
        axis={axis}
        handles={[
          { key: "start", value: 0, label: "Start" },
          { key: "end", value: 100, label: "End" },
        ]}
        onCommit={onCommit}
      />,
    );
    const track = document.querySelector(".railTrack");
    // clientX=170 -> pos 0.85 -> value 85, closer to "end" (100) than "start" (0)
    fireEvent.pointerDown(track, { clientX: 170, clientY: 20 });
    expect(onCommit).toHaveBeenCalledWith("end", 85);
  });

  it("renders vertical orientation with railVertical class and top-based positioning", () => {
    render(
      <Rail
        axis={axis}
        orientation="vertical"
        handles={[{ key: "a", value: 25, label: "A" }]}
        onCommit={() => {}}
      />,
    );
    expect(document.querySelector(".rail")).toHaveClass("railVertical");
    expect(screen.getByRole("slider")).toHaveStyle({ top: "25%" });
    expect(screen.getByRole("slider")).toHaveAttribute(
      "aria-orientation",
      "vertical",
    );
  });

  it("renders tick labels from ticksFor, given the measured rail length", () => {
    stubTrackRect(300, 10);
    render(
      <Rail
        axis={axis}
        handles={[{ key: "a", value: 0, label: "A" }]}
        ticksFor={(length) => [{ key: "t", value: 50, label: `len=${length}` }]}
        onCommit={() => {}}
      />,
    );
    expect(document.querySelector(".railTick")).toBeInTheDocument();
  });
});
