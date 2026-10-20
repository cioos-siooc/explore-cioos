import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createTileRetry } from "./tileRetry.js";

const tile = { z: 3, x: 2, y: 1 };

describe("createTileRetry", () => {
  let refresh;
  let retry;

  beforeEach(() => {
    vi.useFakeTimers();
    refresh = vi.fn();
    retry = createTileRetry({ refresh, delays: [100, 300] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-requests a failed tile after the first delay", () => {
    retry.onError("cde-tiles", tile);
    vi.advanceTimersByTime(99);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledWith("cde-tiles", tile);
  });

  it("backs off, then gives up after the last delay", () => {
    retry.onError("cde-tiles", tile);
    vi.advanceTimersByTime(100);
    retry.onError("cde-tiles", tile);
    vi.advanceTimersByTime(299);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(2);

    retry.onError("cde-tiles", tile);
    vi.runAllTimers();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("counts each tile of each source on its own", () => {
    retry.onError("cde-tiles", tile);
    retry.onError("cde-cells", tile);
    retry.onError("cde-tiles", { ...tile, x: 9 });
    vi.advanceTimersByTime(100);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("reset cancels a source's pending retries and restarts its count", () => {
    retry.onError("cde-tiles", tile);
    retry.reset("cde-tiles");
    vi.runAllTimers();
    expect(refresh).not.toHaveBeenCalled();

    retry.onError("cde-tiles", tile);
    retry.onError("cde-tiles", tile);
    retry.onError("cde-tiles", tile);
    vi.runAllTimers();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("reset leaves other sources' retries alone", () => {
    retry.onError("cde-tiles", tile);
    retry.reset("tracks");
    vi.runAllTimers();
    expect(refresh).toHaveBeenCalledWith("cde-tiles", tile);
  });
});
