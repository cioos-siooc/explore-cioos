import * as React from "react";
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import DatasetPreviewTable from "./DatasetPreviewTable.jsx";

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
    await user.type(screen.getByRole("textbox"), "31");
    // Nothing matches 31, so both rows go rather than one staying by accident.
    expect(screen.queryByText("10")).not.toBeInTheDocument();
    expect(screen.queryByText("9")).not.toBeInTheDocument();
  });

  it("renders an empty shell before the payload arrives", () => {
    const { container } = open(null, []);
    expect(container.querySelector("table")).toBeNull();
  });
});
