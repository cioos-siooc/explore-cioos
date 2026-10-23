import * as React from "react";
import { describe, it, expect } from "vitest";
import { act, screen } from "@testing-library/react";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import DepthProbe from "./DepthProbe.jsx";

const probe = () => screen.getByTestId("depth-probe");

describe("DepthProbe", () => {
  it("shows the depth and its source, nothing more", () => {
    renderWithProviders(
      <DepthProbe
        reading={{ depth: 26.43, resolution: 10, source: "nonna" }}
      />,
    );
    expect(probe()).toHaveTextContent(/^26.4 mCHS NONNA · 10 m grid$/);
  });

  it("reads a negative depth as a drying height", () => {
    renderWithProviders(
      <DepthProbe
        reading={{ depth: -1.5, resolution: 100, source: "nonna" }}
      />,
    );
    expect(probe()).toHaveTextContent("Dries 1.5 m");
    expect(probe()).toHaveTextContent("CHS NONNA · 100 m grid");
  });

  it("names ETOPO where it answered, and reads its negative depth as land elevation", () => {
    const { rerender } = renderWithProviders(
      <DepthProbe reading={{ depth: 58, resolution: 450, source: "etopo" }} />,
    );
    expect(probe()).toHaveTextContent(/^58 mNOAA ETOPO 2022 · ~450 m grid$/);
    rerender(
      <DepthProbe
        reading={{ depth: -9.7, resolution: 450, source: "etopo" }}
      />,
    );
    expect(probe()).toHaveTextContent("Elevation 9.7 m");
  });

  it("says so while reading and where CHS has no sounding", () => {
    const { rerender } = renderWithProviders(
      <DepthProbe reading={{ pending: true }} />,
    );
    expect(probe()).toHaveTextContent("Reading depth…");
    rerender(<DepthProbe reading={{ depth: null, resolution: null }} />);
    expect(probe()).toHaveTextContent("No depth here");
  });

  it("writes the depth with the page language's decimal mark", async () => {
    const { i18n } = renderWithProviders(
      <DepthProbe
        reading={{ depth: 26.43, resolution: 10, source: "nonna" }}
      />,
    );
    await act(() => i18n.changeLanguage("fr"));
    expect(probe()).toHaveTextContent("26,4 m");
    await act(() => i18n.changeLanguage("en"));
  });
});
