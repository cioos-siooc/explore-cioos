import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import SortSelect from "./SortSelect.jsx";

const FIELDS = [
  { id: "title", label: "Title" },
  { id: "platform", label: "Platform" },
];

describe("SortSelect", () => {
  it("changing the field keeps the current direction", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(
      <SortSelect fields={FIELDS} sort={{ field: "title", dir: "desc" }} onChange={onChange} label="Sort" />,
    );
    await user.selectOptions(screen.getByLabelText("Sort"), "platform");
    expect(onChange).toHaveBeenCalledWith({ field: "platform", dir: "desc" });
  });

  it("the direction toggle flips dir without changing the field", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(
      <SortSelect fields={FIELDS} sort={{ field: "title", dir: "asc" }} onChange={onChange} label="Sort" />,
    );
    await user.click(screen.getByRole("button"));
    expect(onChange).toHaveBeenCalledWith({ field: "title", dir: "desc" });
  });

  it("labels the direction toggle for the CURRENT direction, not the one it switches to", () => {
    renderWithProviders(
      <SortSelect fields={FIELDS} sort={{ field: "title", dir: "asc" }} onChange={() => {}} label="Sort" />,
    );
    expect(
      screen.getByRole("button", { name: "Sorted ascending — tap to reverse" }),
    ).toBeInTheDocument();
  });

  it("falls back to the translated default label when none is given", () => {
    renderWithProviders(
      <SortSelect fields={FIELDS} sort={{ field: "title", dir: "asc" }} onChange={() => {}} />,
    );
    expect(screen.getByLabelText("Sort")).toBeInTheDocument();
  });
});
