import * as React from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { act, screen } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { setTouchScreen } from "../../../test/viewport.js";
import DrawHint from "./DrawHint.jsx";

function fakeMap() {
  const handlers = {};
  return {
    on: (type, fn) => (handlers[type] = fn),
    off: (type) => delete handlers[type],
    emit: (type, e) => act(() => handlers[type](e)),
  };
}

describe("DrawHint", () => {
  afterEach(() => vi.useRealTimers());

  it("shows the current step beside the pointer and hides when done", () => {
    const map = fakeMap();
    renderWithProviders(<DrawHint map={map} />);
    expect(screen.queryByTestId("draw-hint")).toBeNull();

    map.emit("draw.hint", { hint: "boxStart" });
    const hint = screen.getByTestId("draw-hint");
    expect(hint).toHaveTextContent("Click one corner of the box.");
    expect(hint).toHaveClass("drawHintDocked");

    map.emit("mousemove", { originalEvent: { clientX: 30, clientY: 40 } });
    map.emit("draw.hint", { hint: "boxEnd" });
    expect(hint).toHaveTextContent("Click the opposite corner");
    expect(hint).toHaveStyle({ left: "30px", top: "40px" });
    expect(hint).not.toHaveClass("drawHintDocked");

    map.emit("draw.hint", { hint: null });
    expect(screen.queryByTestId("draw-hint")).toBeNull();
  });

  it("stays docked with touch wording on a touch screen", () => {
    setTouchScreen(true);
    const map = fakeMap();
    renderWithProviders(<DrawHint map={map} />);
    map.emit("draw.hint", { hint: "polygonFinish" });
    map.emit("mousemove", { originalEvent: { clientX: 30, clientY: 40 } });
    const hint = screen.getByTestId("draw-hint");
    expect(hint).toHaveTextContent("Double-tap or tap the first point");
    expect(hint).not.toHaveTextContent("Enter");
    expect(hint).toHaveClass("drawHintDocked");
  });

  it("says how to reshape a finished shape, for a few seconds", () => {
    vi.useFakeTimers();
    const map = fakeMap();
    renderWithProviders(<DrawHint map={map} />);
    map.emit("draw.hint", { hint: "boxEnd" });
    map.emit("draw.hint", { hint: null });
    map.emit("draw.create", {});
    expect(screen.getByTestId("draw-hint")).toHaveTextContent(
      "Drag any corner to reshape it.",
    );
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByTestId("draw-hint")).toBeNull();
  });
});
