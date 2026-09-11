import * as React from "react";
import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import QuestionIconTooltip from "./QuestionIconTooltip.jsx";

describe("QuestionIconTooltip", () => {
  it("shows the tooltip text on hover", async () => {
    const { user } = renderWithProviders(
      <QuestionIconTooltip
        tooltipText="Explains the thing"
        tooltipPlacement="right"
        size={16}
      />,
    );
    await user.hover(document.querySelector(".helpIcon"));
    await waitFor(() =>
      expect(screen.getByText("Explains the thing")).toBeInTheDocument(),
    );
  });

  it("applies the given className alongside helpIcon", () => {
    renderWithProviders(
      <QuestionIconTooltip tooltipText="x" className="myExtraClass" />,
    );
    const icon = document.querySelector(".helpIcon");
    expect(icon).toHaveClass("myExtraClass");
  });
});
