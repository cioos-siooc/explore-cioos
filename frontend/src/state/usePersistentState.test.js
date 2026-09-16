import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useUrlSeededPersistentState } from "./usePersistentState.js";

const parseBool = (raw) => raw === "true";

afterEach(() => {
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
});

describe("useUrlSeededPersistentState", () => {
  it("falls back to the default when neither the URL nor localStorage has it", () => {
    const { result } = renderHook(() =>
      useUrlSeededPersistentState(
        "bathymetryVisible",
        "bathy",
        false,
        parseBool,
      ),
    );
    expect(result.current[0]).toBe(false);
  });

  it("reads from localStorage when the URL carries no param", () => {
    window.localStorage.setItem("cde.bathymetryVisible", JSON.stringify(true));
    const { result } = renderHook(() =>
      useUrlSeededPersistentState(
        "bathymetryVisible",
        "bathy",
        false,
        parseBool,
      ),
    );
    expect(result.current[0]).toBe(true);
  });

  it("prefers the URL param over a stored value — a share link wins", () => {
    window.localStorage.setItem("cde.bathymetryVisible", JSON.stringify(false));
    window.history.replaceState({}, "", "/?bathy=true");
    const { result } = renderHook(() =>
      useUrlSeededPersistentState(
        "bathymetryVisible",
        "bathy",
        false,
        parseBool,
      ),
    );
    expect(result.current[0]).toBe(true);
  });

  it("persists under the cde. namespace whenever the value changes", () => {
    const { result } = renderHook(() =>
      useUrlSeededPersistentState(
        "bathymetryVisible",
        "bathy",
        false,
        parseBool,
      ),
    );
    act(() => result.current[1](true));
    expect(
      JSON.parse(window.localStorage.getItem("cde.bathymetryVisible")),
    ).toBe(true);
  });

  it("falls back to the default rather than throwing on corrupted stored JSON", () => {
    window.localStorage.setItem("cde.bathymetryVisible", "{not json");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useUrlSeededPersistentState(
        "bathymetryVisible",
        "bathy",
        false,
        parseBool,
      ),
    );
    expect(result.current[0]).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
