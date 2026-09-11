import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import StatusBadge from "./StatusBadge.jsx";

describe("StatusBadge", () => {
  it("renders nothing without a status", () => {
    const { container } = render(<StatusBadge status={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the status text with a status-keyed class", () => {
    render(<StatusBadge status="error" />);
    const badge = screen.getByText("error");
    expect(badge).toHaveClass("harvest-status", "harvest-status-error");
  });
});
