import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import ListCard, {
  CardField,
  CardTags,
  useExpandableList,
} from "./ListCard.jsx";

describe("ListCard", () => {
  it("renders its id and children as a description list", () => {
    renderWithProviders(
      <ListCard id="rec-1">
        <CardField label="Depth">10 m</CardField>
      </ListCard>,
    );
    expect(screen.getByText("rec-1")).toBeInTheDocument();
    expect(screen.getByText("Depth")).toBeInTheDocument();
    expect(screen.getByText("10 m")).toBeInTheDocument();
  });

  it("does nothing on a click of its own; only its action buttons act", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    renderWithProviders(
      <ListCard
        id="rec-1"
        actions={
          <button type="button" onClick={onAction}>
            act
          </button>
        }
      >
        x
      </ListCard>,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    await user.click(screen.getByText("x"));
    await user.click(screen.getByText("rec-1"));
    expect(onAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "act" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("carries selected/pinned as classes", () => {
    renderWithProviders(
      <ListCard id="rec-1" selected pinned>
        x
      </ListCard>,
    );
    expect(document.querySelector(".listCard")).toHaveClass(
      "selected",
      "pinned",
    );
  });
});

describe("CardField", () => {
  it("renders nothing for null/undefined/empty/empty-array children", () => {
    for (const empty of [null, undefined, "", []]) {
      const { container, unmount } = renderWithProviders(
        <CardField label="X">{empty}</CardField>,
      );
      expect(container.querySelector(".listCardField")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("renders the label and value when children are present", () => {
    renderWithProviders(<CardField label="Depth">10 m</CardField>);
    expect(screen.getByText("Depth")).toBeInTheDocument();
    expect(screen.getByText("10 m")).toBeInTheDocument();
  });
});

describe("useExpandableList", () => {
  function Probe({ items, limit }) {
    const { shown, hidden, expanded, toggle } = useExpandableList(items, limit);
    return (
      <div>
        <span data-testid="shown">{shown.join(",")}</span>
        <span data-testid="hidden">{hidden}</span>
        <button onClick={toggle}>{expanded ? "less" : "more"}</button>
      </div>
    );
  }

  it("shows only the first `limit` items until toggled", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Probe items={["a", "b", "c", "d"]} limit={2} />);
    expect(screen.getByTestId("shown")).toHaveTextContent("a,b");
    expect(screen.getByTestId("hidden")).toHaveTextContent("2");
    await user.click(screen.getByText("more"));
    expect(screen.getByTestId("shown")).toHaveTextContent("a,b,c,d");
    expect(screen.getByTestId("hidden")).toHaveTextContent("0");
  });
});

describe("CardTags", () => {
  it("renders nothing without values", () => {
    const { container } = renderWithProviders(<CardTags values={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the first `limit` tags with a +n toggle for the rest", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CardTags values={["a", "b", "c", "d"]} limit={2} />);
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
    expect(screen.queryByText("c")).not.toBeInTheDocument();
    const more = screen.getByText("+2");
    await user.click(more);
    expect(screen.getByText("c")).toBeInTheDocument();
    expect(screen.getByText("d")).toBeInTheDocument();
  });
});
