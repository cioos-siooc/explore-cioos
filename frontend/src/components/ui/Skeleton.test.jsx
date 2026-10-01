import * as React from "react";
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import Skeleton, { SkeletonGroup } from "./Skeleton.jsx";

describe("Skeleton", () => {
  it("announces the group once and hides its blocks", () => {
    const { container } = renderWithProviders(
      <SkeletonGroup label="Loading runs…">
        <Skeleton />
        <Skeleton width="40%" />
      </SkeletonGroup>,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading runs…");
    expect(status).toHaveAttribute("aria-busy", "true");
    const blocks = container.querySelectorAll(".cioosSkeleton");
    expect(blocks).toHaveLength(2);
    blocks.forEach((block) =>
      expect(block).toHaveAttribute("aria-hidden", "true"),
    );
    expect(blocks[1]).toHaveStyle({ width: "40%" });
  });

  it("falls back to the generic loading label", () => {
    renderWithProviders(
      <SkeletonGroup>
        <Skeleton />
      </SkeletonGroup>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
  });
});
