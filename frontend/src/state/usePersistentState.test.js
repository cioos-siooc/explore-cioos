import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

import {
  clearLegacyCookies,
  usePersistentState,
  useUrlSeededPersistentState,
} from "./usePersistentState.js";

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

describe("usePersistentState", () => {
  it("reads the stored value, ignoring the URL", () => {
    window.history.replaceState({}, "", "/?tipsEnabled=true");
    window.localStorage.setItem("cde.tipsEnabled", JSON.stringify(false));
    const { result } = renderHook(() =>
      usePersistentState("tipsEnabled", true),
    );
    expect(result.current[0]).toBe(false);
  });

  it("persists what it is set to", () => {
    const { result } = renderHook(() => usePersistentState("seenTips", []));
    act(() => result.current[1](["shareLink"]));
    expect(JSON.parse(window.localStorage.getItem("cde.seenTips"))).toEqual([
      "shareLink",
    ]);
  });
});

describe("clearLegacyCookies", () => {
  it("expires the cookies earlier versions set, the email among them", () => {
    document.cookie = "email=diver@example.com";
    document.cookie = "introModalOpen=false; path=/";
    document.cookie = "i18next=fr; path=/";
    clearLegacyCookies();
    expect(document.cookie).toBe("");
  });
});
