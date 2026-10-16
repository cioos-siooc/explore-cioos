import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";

import { useChanged } from "./utilities.jsx";

// `true` is only observable within the render pass itself: React re-renders
// immediately after the render-phase setState, so result.current only sees the
// settled `false`. Hence recording every render-time value.
function recordEachRender(recorder, value) {
  const changed = useChanged(value);
  recorder.push(changed);
  return changed;
}

function recordEachRenderMulti(recorder, a, b) {
  const changed = useChanged(a, b);
  recorder.push(changed);
  return changed;
}

describe("useChanged", () => {
  it("is false on the first render", () => {
    const recorder = [];
    renderHook(() => recordEachRender(recorder, "a"));
    expect(recorder).toEqual([false]);
  });

  it("is true on the render pass where a tracked value first differs", () => {
    const recorder = [];
    const { rerender } = renderHook(
      ({ value }) => recordEachRender(recorder, value),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "b" });
    // Two renders: true, then React's immediate re-render with `previous` caught up.
    expect(recorder).toEqual([false, true, false]);
  });

  it("stays false across a rerender with the same value", () => {
    const recorder = [];
    const { rerender } = renderHook(
      ({ value }) => recordEachRender(recorder, value),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "a" });
    expect(recorder).toEqual([false, false]);
  });

  it("compares every tracked value, not just the first", () => {
    const recorder = [];
    const { rerender } = renderHook(
      ({ a, b }) => recordEachRenderMulti(recorder, a, b),
      { initialProps: { a: 1, b: 1 } },
    );
    recorder.length = 0;
    rerender({ a: 1, b: 2 });
    expect(recorder[0]).toBe(true);
  });
});
