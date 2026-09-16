import * as React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import Sparkline from "./Sparkline.jsx";

describe("Sparkline", () => {
  it("shows an em dash placeholder without history", () => {
    const { container } = render(<Sparkline statuses={undefined} />);
    expect(container.querySelector(".harvest-spark-empty")).toHaveTextContent(
      "—",
    );
  });

  it("shows an em dash placeholder for an empty history", () => {
    const { container } = render(<Sparkline statuses={[]} />);
    expect(container.querySelector(".harvest-spark-empty")).toBeInTheDocument();
  });

  it("renders one glyph per status, newest first, with a status-keyed class", () => {
    const { container } = render(
      <Sparkline statuses={["success", "skipped", "error"]} />,
    );
    const dots = container.querySelectorAll(".harvest-spark-dot");
    expect(dots).toHaveLength(3);
    expect(dots[0]).toHaveClass("harvest-spark-success");
    expect(dots[0]).toHaveTextContent("✓");
    expect(dots[1]).toHaveClass("harvest-spark-skipped");
    expect(dots[1]).toHaveTextContent("·");
    expect(dots[2]).toHaveClass("harvest-spark-error");
    expect(dots[2]).toHaveTextContent("✗");
  });

  it("shows a '?' glyph for an unrecognized status rather than throwing", () => {
    const { container } = render(<Sparkline statuses={["mystery"]} />);
    expect(container.querySelector(".harvest-spark-dot")).toHaveTextContent(
      "?",
    );
  });
});
