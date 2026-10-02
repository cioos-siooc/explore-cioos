import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

let showPreviewModal;

vi.mock("../../../state/selection/SelectionProvider.jsx", () => ({
  useSelection: () => ({ showPreviewModal }),
}));
vi.mock("../../Controls/DatasetPreview/DatasetPreview.jsx", () => ({
  default: ({ showModal }) => (
    <div data-testid="preview" data-open={String(showModal)} />
  ),
}));

import PreviewHost from "./PreviewHost.jsx";

describe("PreviewHost", () => {
  it("loads nothing until the preview first opens", () => {
    showPreviewModal = false;
    render(<PreviewHost />);
    expect(screen.queryByTestId("preview")).not.toBeInTheDocument();
  });

  it("mounts the preview on open and keeps it mounted after it closes", async () => {
    showPreviewModal = false;
    const { rerender } = render(<PreviewHost />);

    showPreviewModal = true;
    rerender(<PreviewHost />);
    expect(await screen.findByTestId("preview")).toHaveAttribute(
      "data-open",
      "true",
    );

    showPreviewModal = false;
    rerender(<PreviewHost />);
    expect(screen.getByTestId("preview")).toHaveAttribute("data-open", "false");
  });
});
