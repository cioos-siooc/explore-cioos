import * as React from "react";
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import ActivityList from "./ActivityList.jsx";

describe("ActivityList", () => {
  it("renders nothing with an empty list", () => {
    const { container } = renderWithProviders(<ActivityList labelKeys={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one row per key, translated", () => {
    renderWithProviders(<ActivityList labelKeys={["activityCatalogText"]} />);
    expect(screen.getByRole("listitem")).toBeInTheDocument();
  });

  it("shows a spinner per row by default, and omits it when marks is false", () => {
    const { rerender } = renderWithProviders(
      <ActivityList labelKeys={["activityCatalogText"]} />,
    );
    expect(
      document.querySelector(".activityList li .cioosSpinner"),
    ).toBeTruthy();

    rerender(
      <ActivityList labelKeys={["activityCatalogText"]} marks={false} />,
    );
    expect(
      document.querySelector(".activityList li .cioosSpinner"),
    ).toBeFalsy();
  });
});
