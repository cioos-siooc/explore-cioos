import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import { MOBILE_WIDTH, setViewportWidth } from "../../../test/viewport.js";
import WmsLegend from "./WmsLegend.jsx";

const VAR_TEMP = { name: "temp", long_name: "Temperature", units: "C" };
const VAR_SALT = { name: "salt", long_name: "Salinity", units: "PSU" };

const OVERLAY = {
  pk: 1,
  title: "A griddap dataset",
  erddapUrl: "https://erddap.example/tabledap/foo.html",
  variables: [VAR_TEMP, VAR_SALT],
  variable: VAR_TEMP,
  dimensions: [],
};

describe("WmsLegend", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("renders the colorbar image and links to the dataset's ERDDAP page", async () => {
    renderWithProviders(<WmsLegend overlay={OVERLAY} onClose={() => {}} setActiveWmsOverlay={() => {}} />);
    await waitFor(() => {
      expect(document.querySelector(".wmsLegendImage")).toBeInTheDocument();
    });
    expect(document.querySelector(".wmsLegendFigure")).toHaveAttribute(
      "href",
      OVERLAY.erddapUrl,
    );
  });

  it("shows a variable picker only when there is more than one variable", () => {
    renderWithProviders(
      <WmsLegend
        overlay={{ ...OVERLAY, variables: [VAR_TEMP] }}
        onClose={() => {}}
        setActiveWmsOverlay={() => {}}
      />,
    );
    expect(screen.queryByTitle("Variable")).not.toBeInTheDocument();
  });

  it("the close button calls onClose", async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <WmsLegend overlay={OVERLAY} onClose={onClose} setActiveWmsOverlay={() => {}} />,
    );
    await user.click(screen.getByTitle("Hide overlay"));
    expect(onClose).toHaveBeenCalled();
  });

  it("falls back to a title-only card when the image fails to load", async () => {
    renderWithProviders(<WmsLegend overlay={OVERLAY} onClose={() => {}} setActiveWmsOverlay={() => {}} />);
    const img = await screen.findByAltText(/temp/);
    img.dispatchEvent(new Event("error"));
    await waitFor(() => {
      expect(document.querySelector(".wmsLegendFallback")).toBeInTheDocument();
    });
  });

  it("on a phone-width floating card, renders as a peek button until opened", () => {
    setViewportWidth(MOBILE_WIDTH);
    renderWithProviders(
      <WmsLegend overlay={OVERLAY} onClose={() => {}} setActiveWmsOverlay={() => {}} variant="floating" />,
    );
    expect(document.querySelector(".wmsLegendPeek")).toBeInTheDocument();
    expect(document.querySelector(".wmsLegendImage")).not.toBeInTheDocument();
  });

  it("an inline card (dataset page) is never collapsed to a peek button, even at phone width", async () => {
    setViewportWidth(MOBILE_WIDTH);
    renderWithProviders(
      <WmsLegend overlay={OVERLAY} onClose={() => {}} setActiveWmsOverlay={() => {}} variant="inline" />,
    );
    expect(document.querySelector(".wmsLegendPeek")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(document.querySelector(".wmsLegendImage")).toBeInTheDocument(),
    );
  });
});
