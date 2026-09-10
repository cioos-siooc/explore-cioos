import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

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
});
