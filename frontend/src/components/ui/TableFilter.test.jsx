import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TableFilter, { filterRows } from "./TableFilter.jsx";

describe("filterRows", () => {
  const rows = [
    { title: "Killer whale sightings", platform: "vessel" },
    { title: "Salinity profile", platform: "mooring" },
    { title: "Temperature series", platform: null },
  ];

  it("returns every row unfiltered when there is no filter text", () => {
    expect(filterRows(rows, "")).toBe(rows);
    expect(filterRows(rows, undefined)).toBe(rows);
  });

  it("matches case-insensitively, across every column", () => {
    expect(filterRows(rows, "KILLER")).toEqual([rows[0]]);
    expect(filterRows(rows, "mooring")).toEqual([rows[1]]);
  });

  it("skips null/undefined values rather than throwing", () => {
    expect(filterRows(rows, "temperature")).toEqual([rows[2]]);
  });

  it("returns an empty array for no match", () => {
    expect(filterRows(rows, "nonexistent")).toEqual([]);
  });

  it("handles a missing rows array", () => {
    expect(filterRows(undefined, "x")).toEqual([]);
  });
});

describe("TableFilter", () => {
  it("renders the current value and placeholder", () => {
    render(<TableFilter value="orca" onChange={() => {}} placeholder="Search" />);
    expect(screen.getByPlaceholderText("Search")).toHaveValue("orca");
  });

  it("calls onChange with the new text as the user types", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TableFilter value="" onChange={onChange} placeholder="Search" />);
    await user.type(screen.getByPlaceholderText("Search"), "x");
    expect(onChange).toHaveBeenCalledWith("x");
  });
});
