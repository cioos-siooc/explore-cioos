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

  it("reads a negative depth as an elevation above the datum", () => {
    renderWithProviders(
      <DepthProbe reading={{ depth: -1.5, resolution: 10, source: "nonna" }} />,
    );
    expect(probe()).toHaveTextContent("Elevation 1.5 m");
    expect(probe()).toHaveTextContent("CHS NONNA · 10 m grid");
  });

  it("names GEBCO where it answered", () => {
    renderWithProviders(
      <DepthProbe reading={{ depth: 58, resolution: 463, source: "gebco" }} />,
    );
    expect(probe()).toHaveTextContent(/^58 mGEBCO 2026 · ~463 m grid$/);
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
