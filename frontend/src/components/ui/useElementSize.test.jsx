import * as React from "react";
import { describe, it, expect } from "vitest";
import { act, render, screen } from "@testing-library/react";

import useElementSize from "./useElementSize.js";

// jsdom never computes real layout, so clientWidth/clientHeight are 0 unless
// explicitly stubbed — this stands in for "the element actually has a box".
function stubClientBox(el, width, height) {
  Object.defineProperty(el, "clientWidth", { value: width, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: height, configurable: true });
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
});
