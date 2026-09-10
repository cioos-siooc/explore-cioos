import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { installMockHarvestFetch } from "../../test/mockHarvestFetch.js";
import useHarvestFetch from "./useHarvestFetch.js";

describe("useHarvestFetch", () => {
  beforeEach(() => {
    installMockHarvestFetch({ "/servers": [{ erddap_url: "https://a" }] });
  });

  it("starts loading, then resolves with the fetched data", async () => {
    const { result } = renderHook(() => useHarvestFetch("/servers"));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([{ erddap_url: "https://a" }]);
    expect(result.current.error).toBeNull();
  });

  it("sets error and clears loading on a non-2xx response", async () => {
    installMockHarvestFetch({ "/servers": null });
    const { result } = renderHook(() => useHarvestFetch("/servers"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/404/);
    expect(result.current.data).toBeNull();
  });

  it("re-fetches when the path changes", async () => {
    installMockHarvestFetch({
      "/servers": [{ erddap_url: "https://a" }],
      "/runs/recent": [{ run_id: "r1" }],
    });
    const { result, rerender } = renderHook(
      ({ path }) => useHarvestFetch(path),
      { initialProps: { path: "/servers" } },
    );
    await waitFor(() =>
      expect(result.current.data).toEqual([{ erddap_url: "https://a" }]),
    );

    rerender({ path: "/runs/recent" });
    expect(result.current.loading).toBe(true);
    await waitFor(() =>
      expect(result.current.data).toEqual([{ run_id: "r1" }]),
    );
  });

  it("does nothing (no fetch, stays loading) without a path", () => {
    const { result } = renderHook(() => useHarvestFetch(undefined));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
  });
});
