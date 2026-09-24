import * as React from "react";
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import TipText from "./TipText.jsx";

describe("TipText", () => {
  it("draws the download glyph where the tip names it", () => {
    renderWithProviders(<TipText tip="whatsHere" />);
    expect(screen.getByRole("img", { name: "Download" })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("<download");
  });
});
