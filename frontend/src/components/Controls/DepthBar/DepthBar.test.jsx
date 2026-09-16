import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import { MOBILE_WIDTH, setViewportWidth } from "../../../test/viewport.js";
import DepthBar from "./DepthBar.jsx";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";

function Harness() {
  const { catalogLoaded } = useFilters();
  if (!catalogLoaded) return <span data-testid="state">loading</span>;
  return (
    <>
      <span data-testid="state">loaded</span>
      <DepthBar />
    </>
  );
}

async function renderReady(options) {
  const result = renderWithProviders(<Harness />, {
    providers: "app",
    ...options,
  });
  await waitFor(() =>
    expect(screen.getByTestId("state")).toHaveTextContent("loaded"),
  );
  return result;
}

describe("DepthBar", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("renders nothing while the depth filter is inactive (the default)", async () => {
    await renderReady();
    expect(document.querySelector(".depthBar")).not.toBeInTheDocument();
  });

  it("renders the bar once the depth filter is active via the URL", async () => {
    await renderReady({ url: "/?depthMin=100" });
    expect(document.querySelector(".depthBar")).toBeInTheDocument();
    expect(screen.getAllByRole("slider")).toHaveLength(2);
  });

  it("renders nothing on a phone-width viewport even with the filter active", async () => {
    setViewportWidth(MOBILE_WIDTH);
    await renderReady({ url: "/?depthMin=100" });
    expect(document.querySelector(".depthBar")).not.toBeInTheDocument();
  });

  it("Reset restores the default start/end depths", async () => {
    const { user } = await renderReady({ url: "/?depthMin=100" });
    await user.click(screen.getByTitle("Reset the depth range to all depths"));
    await waitFor(() =>
      expect(document.querySelector(".depthBar")).not.toBeInTheDocument(),
    );
  });

  // The start handle and the start field share one aria-label ("Start Depth
  // (m)") — one names the number input, the other the rail's slider — so
  // getByLabelText alone is ambiguous; scope to the input.
  const startInput = () =>
    document.querySelector(
      '.depthBarTagRange input[aria-label="Start Depth (m)"]',
    );

  it("typing a valid start depth commits it", async () => {
    await renderReady({ url: "/?depthMin=100" });
    const input = startInput();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "150" } });
    await waitFor(() => expect(input.value).toBe("150"));
  });

  it("dragging the start handle commits a clamped value via the rail", async () => {
    await renderReady({ url: "/?depthMin=100" });
    const [startHandle] = screen.getAllByRole("slider");
    fireEvent.keyDown(startHandle, { key: "ArrowDown" });
    await waitFor(() => expect(startInput().value).toBe("101"));
  });
});
