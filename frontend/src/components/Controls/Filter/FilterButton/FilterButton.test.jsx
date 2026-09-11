import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../../test/renderWithProviders.jsx";
import FilterButton from "./FilterButton.jsx";

const OPTIONS = [
  { pk: 1, title: "Temperature", isSelected: false },
  { pk: 2, title: "Salinity", isSelected: true },
];

describe("FilterButton", () => {
  it("renders nothing when option is absent (undefined)", () => {
    const { container } = renderWithProviders(
      <FilterButton
        optionsSelected={OPTIONS}
        setOptionsSelected={() => {}}
        option={undefined}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the option's translated title and no X when unselected", () => {
    renderWithProviders(
      <FilterButton
        optionsSelected={OPTIONS}
        setOptionsSelected={() => {}}
        option={OPTIONS[0]}
      />,
    );
    const button = screen.getByTestId("filter-option");
    expect(button).toHaveTextContent("Temperature");
    expect(button).not.toHaveClass("selected");
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("shows selected styling and an X for a selected option", () => {
    renderWithProviders(
      <FilterButton
        optionsSelected={OPTIONS}
        setOptionsSelected={() => {}}
        option={OPTIONS[1]}
      />,
    );
    const button = screen.getByTestId("filter-option");
    expect(button).toHaveClass("selected");
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking toggles isSelected on the matching option and leaves others alone", async () => {
    const user = userEvent.setup();
    const setOptionsSelected = vi.fn();
    renderWithProviders(
      <FilterButton
        optionsSelected={OPTIONS}
        setOptionsSelected={setOptionsSelected}
        option={OPTIONS[0]}
      />,
    );
    await user.click(screen.getByTestId("filter-option"));
    expect(setOptionsSelected).toHaveBeenCalledWith([
      { pk: 1, title: "Temperature", isSelected: true },
      { pk: 2, title: "Salinity", isSelected: true },
    ]);
  });

  it("uses the localized hover_<lang> field for the tooltip when present", async () => {
    const user = userEvent.setup();
    const withHover = [
      {
        pk: 1,
        title: "Temperature",
        isSelected: false,
        hover_en: "Measured in Celsius",
      },
    ];
    renderWithProviders(
      <FilterButton
        optionsSelected={withHover}
        setOptionsSelected={() => {}}
        option={withHover[0]}
      />,
    );
    await user.hover(screen.getByTestId("filter-option"));
    expect(await screen.findByText("Measured in Celsius")).toBeInTheDocument();
  });
});
