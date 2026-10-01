import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import PreviewHost from "./PreviewHost.jsx";

// The host exists so the modal stays mounted at shell level and survives panel
// swaps, which means it is mounted on every page — including every page with no
// record open. That it draws nothing there is the thing worth holding.
describe("PreviewHost", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("draws nothing while no record is open", () => {
    const { container } = renderWithProviders(<PreviewHost />, {
      providers: "app",
    });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stays silent for a ?preview= that names no dataset", () => {
    // The modal opens on inspectDataset AND inspectRecordID; a link carrying
    // only half of that must not open an empty dialog.
    renderWithProviders(<PreviewHost />, {
      url: "/?preview=record-1",
      providers: "app",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
