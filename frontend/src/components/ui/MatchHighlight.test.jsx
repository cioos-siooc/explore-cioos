import * as React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import MatchHighlight from "./MatchHighlight.jsx";

const marked = (container) =>
  [...container.querySelectorAll("mark")].map((m) => m.textContent);

describe("MatchHighlight", () => {
  it("marks every typed word, in any order and any case", () => {
    const { container } = render(
      <MatchHighlight text="Gadus morhua" query="MORH g." />,
    );
    expect(container.textContent).toBe("Gadus morhua");
    expect(marked(container)).toEqual(["G", "morh"]);
  });

  it("leaves the text alone without a query", () => {
    const { container } = render(
      <MatchHighlight text="Orcinus orca" query="" />,
    );
    expect(container.textContent).toBe("Orcinus orca");
    expect(marked(container)).toEqual([]);
  });

  it("treats regex characters in the query as text", () => {
    const { container } = render(
      <MatchHighlight text="Mytilus (Mytilus)" query="(myt" />,
    );
    expect(marked(container)).toEqual(["(Myt"]);
  });
});
