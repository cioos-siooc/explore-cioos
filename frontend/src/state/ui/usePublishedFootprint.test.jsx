import * as React from "react";
import { useRef } from "react";
import { describe, it, expect } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import usePublishedFootprint from "./usePublishedFootprint.js";

const PROPERTY = "--test-footprint";
const measure = (rect) => rect.left;

function Surface() {
  const ref = useRef(null);
  usePublishedFootprint(ref, PROPERTY, measure);
  return <div ref={ref} data-testid="surface" />;
}

const published = () =>
  document.documentElement.style.getPropertyValue(PROPERTY);

// jsdom has no layout, so the surface's position is whatever this says.
function placeAt(el, left) {
  el.getBoundingClientRect = () => ({ left, top: 0, bottom: 0, height: 0 });
}

describe("usePublishedFootprint", () => {
  it("republishes when a class change moves the surface without resizing it", async () => {
    render(<Surface />);
    const el = screen.getByTestId("surface");
    expect(published()).toBe("0px");

    placeAt(el, 40);
    await act(async () => el.classList.add("moved"));

    expect(published()).toBe("40px");
  });

  it("republishes at the end of the surface's own transition only", () => {
    render(<Surface />);
    const el = screen.getByTestId("surface");
    const child = document.createElement("span");
    el.append(child);

    placeAt(el, 25);
    fireEvent.transitionEnd(child);
    expect(published()).toBe("0px");

    fireEvent.transitionEnd(el);
    expect(published()).toBe("25px");
  });

  it("removes the property on unmount", () => {
    const { unmount } = render(<Surface />);
    unmount();
    expect(published()).toBe("");
  });
});
