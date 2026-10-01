import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import PaneDivider from "./PaneDivider.jsx";

const BOUNDS = { min: 200, max: 400, reset: 240 };

function setup(overrides = {}) {
  const onChange = vi.fn();
  const onDragChange = vi.fn();
  render(
    <PaneDivider
      label="Resize the settings panel"
      controls="somePane"
      value={280}
      onChange={onChange}
      onDragChange={onDragChange}
      {...BOUNDS}
      {...overrides}
    />,
  );
  return { divider: screen.getByRole("separator"), onChange, onDragChange };
}

describe("PaneDivider", () => {
  it("is a focusable separator that states the width it is set to", () => {
    const { divider } = setup();
    expect(divider).toHaveAttribute("aria-orientation", "vertical");
    expect(divider).toHaveAttribute("aria-label", "Resize the settings panel");
    expect(divider).toHaveAttribute("aria-controls", "somePane");
    expect(divider).toHaveAttribute("aria-valuenow", "280");
    expect(divider).toHaveAttribute("aria-valuemin", "200");
    expect(divider).toHaveAttribute("aria-valuemax", "400");
    expect(divider).toHaveAttribute("tabindex", "0");
  });

  it("resizes from the keyboard, so the drag is never the only way", () => {
    const { divider, onChange } = setup();
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(296);
    fireEvent.keyDown(divider, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(264);
    fireEvent.keyDown(divider, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(BOUNDS.min);
    fireEvent.keyDown(divider, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(BOUNDS.max);
    fireEvent.keyDown(divider, { key: "a" });
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it("a double-click puts the pane back to its default width", () => {
    const { divider, onChange } = setup();
    fireEvent.doubleClick(divider);
    expect(onChange).toHaveBeenCalledWith(BOUNDS.reset);
  });

  it("drags without pointer capture, which jsdom does not implement", () => {
    const { divider, onChange, onDragChange } = setup();
    expect(divider).not.toHaveProperty("setPointerCapture");

    fireEvent.pointerDown(divider, { button: 0, pointerId: 1, clientX: 500 });
    expect(onDragChange).toHaveBeenLastCalledWith(true);
    fireEvent.pointerMove(divider, { pointerId: 1, clientX: 540 });
    expect(onChange).toHaveBeenLastCalledWith(320);
    fireEvent.pointerUp(divider, { pointerId: 1 });
    expect(onDragChange).toHaveBeenLastCalledWith(false);
  });

  it("reports where the pointer is, not how far it last moved", () => {
    // The width the caller commits may be clamped; reporting deltas would bank
    // the clamped-away pixels, so a pointer that overshoots a bound and comes
    // back would leave the pane short by however far it went past.
    const { divider, onChange } = setup();
    fireEvent.pointerDown(divider, { button: 0, pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(divider, { pointerId: 1, clientX: 540 });
    fireEvent.pointerMove(divider, { pointerId: 1, clientX: 520 });
    expect(onChange).toHaveBeenLastCalledWith(300);
  });

  it("ignores a pointer move that no drag started", () => {
    const { divider, onChange } = setup();
    fireEvent.pointerMove(divider, { pointerId: 1, clientX: 540 });
    expect(onChange).not.toHaveBeenCalled();
  });
});
