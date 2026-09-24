import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import TopBarRow from "./TopBarRow.jsx";

// jsdom runs no CSS animations, so each phase settles at once: these cover
// what ends up on screen, not the slide itself.
describe("TopBarRow", () => {
  const row = (key) => (
    <TopBarRow contentKey={key}>
      <span>{key}</span>
    </TopBarRow>
  );

  it("renders nothing for a null key", () => {
    const { container } = render(row(null));
    expect(container).toBeEmptyDOMElement();
  });

  it("swaps to the new content and goes when the key is cleared", () => {
    const { rerender, container } = render(row("filters"));
    expect(screen.getByText("filters")).toBeInTheDocument();
    rerender(row("dataset"));
    expect(screen.getByText("dataset")).toBeInTheDocument();
    expect(screen.queryByText("filters")).toBeNull();
    rerender(row(null));
    expect(container).toBeEmptyDOMElement();
  });
});
