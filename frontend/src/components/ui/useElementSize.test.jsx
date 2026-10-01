import * as React from "react";
import { describe, it, expect } from "vitest";
import { act, render, screen } from "@testing-library/react";

import useElementSize from "./useElementSize.js";

// jsdom never computes real layout, so clientWidth/clientHeight are 0 unless
// explicitly stubbed — this stands in for "the element actually has a box".
function stubClientBox(el, width, height) {
  Object.defineProperty(el, "clientWidth", {
    value: width,
    configurable: true,
  });
  Object.defineProperty(el, "clientHeight", {
    value: height,
    configurable: true,
  });
}

function Harness({ onSize }) {
  const [ref, size] = useElementSize();
  onSize?.(size);
  return (
    <div ref={ref} data-testid="box">
      {size.width}x{size.height}
    </div>
  );
}

// The measured element behind a flag, because that is the real shape of the
// caller this hook exists for: DatasetPreview is mounted for the whole session
// and its box only appears once a record is opened.
function LateHarness({ mounted }) {
  const [ref, size] = useElementSize();
  return (
    <>
      <span data-testid="size">
        {size.width}x{size.height}
      </span>
      {mounted && <div ref={ref} data-testid="box" />}
    </>
  );
}

describe("useElementSize", () => {
  it("starts at zero before anything is measured", () => {
    render(<Harness />);
    // ResizeObserver is a no-op stub under jsdom (setup.js), and jsdom itself
    // never lays out a real box, so the mount-time measure reads 0x0 here —
    // this just pins that starting point.
    expect(screen.getByTestId("box")).toHaveTextContent("0x0");
  });

  it("re-measures on a window resize", () => {
    render(<Harness />);
    const box = screen.getByTestId("box");
    stubClientBox(box, 320, 240);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(box).toHaveTextContent("320x240");
  });

  it("does not re-render when a resize reports the same size", () => {
    let renders = 0;
    render(<Harness onSize={() => renders++} />);
    const box = screen.getByTestId("box");
    stubClientBox(box, 100, 50);
    act(() => window.dispatchEvent(new Event("resize")));
    const rendersAfterFirstResize = renders;
    act(() => window.dispatchEvent(new Event("resize")));
    expect(renders).toBe(rendersAfterFirstResize);
  });

  it("measures an element that mounted after the hook did", () => {
    const { rerender } = render(<LateHarness mounted={false} />);
    rerender(<LateHarness mounted />);
    stubClientBox(screen.getByTestId("box"), 640, 480);
    act(() => window.dispatchEvent(new Event("resize")));
    // Sized from an element that did not exist when the hook first ran. This is
    // the whole point: the preview plot's box appears only once a record is
    // opened, and an effect reading ref.current on mount never saw it.
    expect(screen.getByTestId("size")).toHaveTextContent("640x480");
  });

  it("stops measuring once the element goes away", () => {
    const { rerender } = render(<LateHarness mounted />);
    stubClientBox(screen.getByTestId("box"), 100, 50);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(screen.getByTestId("size")).toHaveTextContent("100x50");

    rerender(<LateHarness mounted={false} />);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(screen.getByTestId("size")).toHaveTextContent("100x50");
  });

  it("hands the node back on .current, for callers measuring a rect", () => {
    let captured;
    function RefHarness({ mounted }) {
      const [ref] = useElementSize();
      captured = ref;
      return mounted ? <div ref={ref} data-testid="box" /> : null;
    }
    // Rail.jsx reads trackRef.current.getBoundingClientRect() for its pointer
    // maths, so the callback ref has to keep answering like an object one.
    const { rerender } = render(<RefHarness mounted />);
    expect(captured.current).toBe(screen.getByTestId("box"));
    rerender(<RefHarness mounted={false} />);
    expect(captured.current).toBeNull();
  });
});
