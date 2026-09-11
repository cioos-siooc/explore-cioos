import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";

import { useChanged } from "./utilities.jsx";

// useChanged adjusts state DURING render (React's documented "derived state"
// pattern): calling setPrevious mid-render makes React immediately re-render
// the component again, synchronously, before returning control to the caller.
// So `true` is only ever observable from WITHIN that same render pass (which
// is how every real caller uses it — see ActivityProvider.jsx's
// `if (useChanged(busy) && !busy) setAnnounced(false)`) — checking
// renderHook's `result.current` after the fact only ever sees the settled,
// final render, where it has already flipped back to false. Recording every
// render-time value into an external array sidesteps that.
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
    // The render-phase adjustment means this rerender pass shows up as two
    // renders in the recorder: true (the change is seen), then false (React's
    // immediate re-render, now that `previous` has caught up).
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
    recorder.length = 0; // drop the mount render, only care about the change below
    rerender({ a: 1, b: 2 });
    expect(recorder[0]).toBe(true);
  });
});
