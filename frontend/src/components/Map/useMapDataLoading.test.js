import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import useMapDataLoading from "./useMapDataLoading.js";

function fakeMap() {
  const handlers = {};
  const loaded = { "cde-tiles": true };
  return {
    loaded,
    on: (type, fn) => (handlers[type] ??= new Set()).add(fn),
    off: (type, fn) => handlers[type]?.delete(fn),
    getSource: (id) => (id in loaded ? {} : undefined),
    isSourceLoaded: (id) => loaded[id],
    fire: (type, event = {}) =>
      handlers[type]?.forEach((fn) =>
        fn({ dataType: "source", sourceId: "cde-tiles", ...event }),
      ),
  };
}

function setup() {
  const map = fakeMap();
  const setDataLoading = vi.fn();
  const { result, unmount } = renderHook(() =>
    useMapDataLoading({ current: map }, setDataLoading),
  );
  const loading = (busy) => {
    map.loaded["cde-tiles"] = !busy;
    map.fire(busy ? "dataloading" : "data");
  };
  return { map, setDataLoading, loading, result, unmount };
}

describe("useMapDataLoading", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("announces a load that outlasts the delay, and clears once settled", () => {
    const { setDataLoading, loading } = setup();
    loading(true);
    act(() => vi.advanceTimersByTime(299));
    expect(setDataLoading).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(setDataLoading).toHaveBeenLastCalledWith(true);

    loading(false);
    act(() => vi.advanceTimersByTime(250));
    expect(setDataLoading).toHaveBeenLastCalledWith(false);
  });

  it("never announces a cache hit", () => {
    const { setDataLoading, loading } = setup();
    loading(true);
    act(() => vi.advanceTimersByTime(50));
    loading(false);
    act(() => vi.advanceTimersByTime(1000));
    expect(setDataLoading).not.toHaveBeenCalled();
  });

  it("counts short gaps between waves as one load", () => {
    const { setDataLoading, loading } = setup();
    loading(true);
    act(() => vi.advanceTimersByTime(200));
    loading(false);
    act(() => vi.advanceTimersByTime(100));
    loading(true);
    act(() => vi.advanceTimersByTime(0));
    expect(setDataLoading).toHaveBeenLastCalledWith(true);
  });

  it("announces a pending WMS image and clears on unmount", () => {
    const { setDataLoading, result, unmount } = setup();
    act(() => result.current(true));
    act(() => vi.advanceTimersByTime(300));
    expect(setDataLoading).toHaveBeenLastCalledWith(true);
    unmount();
    expect(setDataLoading).toHaveBeenLastCalledWith(false);
  });
});
