import * as React from "react";
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import CardList from "./CardList.jsx";

const ITEMS = [
  { id: "b", n: 2 },
  { id: "a", n: 30 },
  { id: "c", n: 10 },
];

const SORT_FIELDS = [
  { id: "id", label: "ID", type: "string", value: (row) => row.id },
  { id: "n", label: "N", type: "number", value: (row) => row.n },
];

function renderList(props) {
  return renderWithProviders(
    <CardList
      items={ITEMS}
      keyOf={(row) => row.id}
      sortFields={SORT_FIELDS}
      defaultSort={{ field: "id", dir: "asc" }}
      filterPlaceholder="Filter…"
      emptyText="No results"
      pagerLabel="Page"
      perPageLabel="Per page"
      renderItem={(row) => (
        <div data-testid="row">
          {row.id}:{row.n}
        </div>
      )}
      {...props}
    />,
  );
}

describe("CardList", () => {
  it("renders every item sorted by the default field", () => {
    renderList();
    const rows = screen.getAllByTestId("row").map((el) => el.textContent);
    expect(rows).toEqual(["a:30", "b:2", "c:10"]);
  });

  it("shows the empty text when there are no items", () => {
    renderList({ items: [] });
    expect(screen.getByText("No results")).toBeInTheDocument();
    expect(screen.queryByTestId("row")).not.toBeInTheDocument();
  });

  it("filters items by the search box, matched against renderItem's text", async () => {
    const { user } = renderList();
    await user.type(screen.getByPlaceholderText("Filter…"), "a");
    const rows = screen.getAllByTestId("row").map((el) => el.textContent);
    expect(rows).toEqual(["a:30"]);
  });

  it("re-sorting by a numeric field orders rows numerically", async () => {
    const { user } = renderList();
    await user.selectOptions(screen.getByLabelText("Sort"), "n");
    const rows = screen.getAllByTestId("row").map((el) => el.textContent);
    expect(rows[0]).toBe("b:2");
  });

  it("holds pinnedKey's item at the top regardless of sort", () => {
    renderList({ pinnedKey: "c" });
    const rows = screen.getAllByTestId("row").map((el) => el.textContent);
    expect(rows[0]).toBe("c:10");
  });
});
