import * as React from "react";
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import HarvestModeBadge from "./HarvestModeBadge.jsx";

describe("HarvestModeBadge", () => {
  it("renders nothing when the mode can't be determined", () => {
    const { container } = renderWithProviders(
      <HarvestModeBadge dataset={{}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows 'file' with its explanatory tooltip for a hashable (incremental) dataset", () => {
    renderWithProviders(
      <HarvestModeBadge dataset={{ content_hash: "abc123" }} />,
    );
    const badge = screen.getByText("file");
    expect(badge).toHaveAttribute(
      "title",
      "File-based dataset — the harvester hashes its file list and skips re-querying ERDDAP when nothing has changed.",
    );
  });

  it("shows 'source' for a database-backed (full) dataset", () => {
    renderWithProviders(
      <HarvestModeBadge
        dataset={{ content_hash_reason: "HASH_NO_FILE_LIST" }}
      />,
    );
    expect(screen.getByText("source")).toBeInTheDocument();
  });
});
