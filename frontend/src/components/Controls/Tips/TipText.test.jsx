import * as React from "react";
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import TipText from "./TipText.jsx";

describe("TipText", () => {
  it("draws the add glyph where the tip names it", () => {
    renderWithProviders(<TipText tip="whatsHere" />);
    expect(
      screen.getByRole("img", { name: "Add to selection" }),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("<add");
  });

  it("draws the exclude glyph where the tip names it", () => {
    renderWithProviders(<TipText tip="exclude" />);
    expect(screen.getByRole("img", { name: "Exclude" })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("<exclude");
  });
});
