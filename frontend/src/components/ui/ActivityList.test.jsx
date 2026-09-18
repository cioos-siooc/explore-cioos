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

  it("leaves the mark to its caller rather than repeating it per row", () => {
    renderWithProviders(
      <ActivityList
        labelKeys={["activityCatalogText", "activityDatasetsText"]}
      />,
    );
    expect(document.querySelector(".activityList .cioosSpinner")).toBeFalsy();
  });
});
