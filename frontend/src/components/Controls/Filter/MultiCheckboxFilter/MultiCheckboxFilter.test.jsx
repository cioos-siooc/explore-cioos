import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../../test/renderWithProviders.jsx";
import MultiCheckboxFilter from "./MultiCheckboxFilter.jsx";

const OPTIONS = [
  { pk: 1, title: "seaSurfaceTemperature", isSelected: false },
  { pk: 2, title: "salinity", isSelected: true },
];

const render = (ui) => renderWithProviders(ui);

describe("MultiCheckboxFilter", () => {
  it("renders one checkbox row per option", () => {
    render(
      <MultiCheckboxFilter
        optionsSelected={OPTIONS}
        setOptionsSelected={() => {}}
        allOptions={OPTIONS}
      />,
    );
    expect(screen.getAllByTestId("filter-option")).toHaveLength(2);
  });

  it("reflects isSelected via aria-checked", () => {
    render(
      <MultiCheckboxFilter
        optionsSelected={OPTIONS}
        setOptionsSelected={() => {}}
        allOptions={OPTIONS}
      />,
    );
    const checked = screen
      .getAllByTestId("filter-option")
      .find((el) => el.dataset.optionPk === "2");
    expect(checked).toHaveAttribute("aria-checked", "true");
  });

  it("shows the 'no filter options' message when there are none", () => {
    render(
      <MultiCheckboxFilter
        optionsSelected={[]}
        setOptionsSelected={() => {}}
        allOptions={[]}
      />,
    );
    expect(screen.getByText("No filter options")).toBeInTheDocument();
  });

  it("clicking an option flips only that option, over the FULL universe, without mutating the caller's array", async () => {
    const user = userEvent.setup();
    const setOptionsSelected = vi.fn();
    const original = [...OPTIONS];
    render(
      <MultiCheckboxFilter
        optionsSelected={OPTIONS}
        setOptionsSelected={setOptionsSelected}
        allOptions={OPTIONS}
      />,
    );
    const option = screen
      .getAllByTestId("filter-option")
      .find((el) => el.dataset.optionPk === "1");
    await user.click(option);
    expect(setOptionsSelected).toHaveBeenCalledWith([
      { pk: 1, title: "seaSurfaceTemperature", isSelected: true },
      { pk: 2, title: "salinity", isSelected: true }, // pk 2 untouched
    ]);
    // The mutation bug this guards against: sorting for display must not
    // reorder (or otherwise touch) the array the caller still holds.
    expect(OPTIONS).toEqual(original);
  });

  it("is keyboard-operable: Enter toggles the focused option", async () => {
    const user = userEvent.setup();
    const setOptionsSelected = vi.fn();
    render(
      <MultiCheckboxFilter
        optionsSelected={OPTIONS}
        setOptionsSelected={setOptionsSelected}
        allOptions={OPTIONS}
      />,
    );
    const option = screen
      .getAllByTestId("filter-option")
      .find((el) => el.dataset.optionPk === "1");
    option.focus();
    await user.keyboard("{Enter}");
    expect(setOptionsSelected).toHaveBeenCalled();
  });

  it('offers "select search results" only when the visible subset is narrower than the full universe', () => {
    const allOptions = [
      ...OPTIONS,
      { pk: 3, title: "oxygen", isSelected: false },
    ];
    const { rerender } = render(
      <MultiCheckboxFilter
        optionsSelected={OPTIONS}
        setOptionsSelected={() => {}}
        allOptions={allOptions}
      />,
    );
    expect(screen.getByTestId("filter-select-all-results")).toBeInTheDocument();

    rerender(
      <MultiCheckboxFilter
        optionsSelected={allOptions}
        setOptionsSelected={() => {}}
        allOptions={allOptions}
      />,
    );
    expect(
      screen.queryByTestId("filter-select-all-results"),
    ).not.toBeInTheDocument();
  });

  it('"select search results" selects every visible option, leaving the rest of the universe untouched', async () => {
    const user = userEvent.setup();
    const setOptionsSelected = vi.fn();
    const allOptions = [
      ...OPTIONS,
      { pk: 3, title: "oxygen", isSelected: false },
    ];
    render(
      <MultiCheckboxFilter
        optionsSelected={OPTIONS}
        setOptionsSelected={setOptionsSelected}
        allOptions={allOptions}
      />,
    );
    await user.click(screen.getByTestId("filter-select-all-results"));
    expect(setOptionsSelected).toHaveBeenCalledWith([
      { pk: 1, title: "seaSurfaceTemperature", isSelected: true },
      { pk: 2, title: "salinity", isSelected: true },
      { pk: 3, title: "oxygen", isSelected: false },
    ]);
  });
});
