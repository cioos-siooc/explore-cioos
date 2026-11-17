import * as React from "react";
import { describe, it, expect } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import DatasetPreviewTable from "./DatasetPreviewTable.jsx";
import {
  DESKTOP_WIDTH,
  TABLET_WIDTH,
  setViewportWidth,
} from "../../../test/viewport.js";

const TABLE = {
  columnNames: ["depth", "temperature"],
  columnUnits: ["m", "degree_C"],
  rows: [
    [0, 10],
    [5, 9],
  ],
};

// The rows the component takes are already objects — DatasetPreview turns
// /preview's parallel arrays into these.
const ROWS = [
  { depth: 0, temperature: 10 },
  { depth: 5, temperature: 9 },
];

const open = (datasetPreview = { table: TABLE }, data = ROWS) => {
  const user = userEvent.setup({ delay: null });
  const result = renderWithProviders(
    <DatasetPreviewTable datasetPreview={datasetPreview} data={data} />,
  );
  return { user, ...result };
};

describe("DatasetPreviewTable", () => {
  it("heads each column with its name and the unit the publisher gave it", () => {
    open();
    expect(screen.getByText(/degree_C/)).toBeInTheDocument();
    expect(screen.getByText(/\(m\)/)).toBeInTheDocument();
  });

  it("shows every row of the window", () => {
    open();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
  });

  it("narrows the rows to the filter text", async () => {
    const { user } = open();
    await user.type(screen.getByRole("searchbox"), "31");
    // Nothing matches 31, so both rows go rather than one staying by accident.
    expect(screen.queryByText("10")).not.toBeInTheDocument();
    expect(screen.queryByText("9")).not.toBeInTheDocument();
  });

  const SHARED_TABLE = {
    columnNames: ["platform", "depth"],
    columnUnits: [null, "m"],
  };
  const SHARED_ROWS = [
    { platform: "Amundsen", depth: 1.9791645060818657 },
    { platform: "Amundsen", depth: 2.9687395510331704 },
  ];

  it("says a column the same on every row once, in a pane beside the grid", () => {
    setViewportWidth(DESKTOP_WIDTH);
    open({ table: SHARED_TABLE }, SHARED_ROWS);
    const aside = screen.getByRole("complementary", {
      name: /Same on every row/,
    });
    expect(
      within(aside).getByRole("rowheader", { name: "platform" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Amundsen")).toHaveLength(1);
    // Rounded to read, the full value kept for whoever needs it.
    expect(screen.getByText("1.979165")).toHaveAttribute(
      "title",
      "1.9791645060818657",
    );
  });

  it("folds the shared columns above the grid when the modal is narrow", () => {
    setViewportWidth(TABLET_WIDTH);
    open({ table: SHARED_TABLE }, SHARED_ROWS);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    const folded = screen.getByText("Same on every row").closest("details");
    expect(folded).not.toHaveAttribute("open");
    expect(
      within(folded).getByRole("rowheader", { name: "platform" }),
    ).toBeInTheDocument();
  });

  it("renders an empty shell before the payload arrives", () => {
    const { container } = open(null, []);
    expect(container.querySelector("table")).toBeNull();
  });
});
