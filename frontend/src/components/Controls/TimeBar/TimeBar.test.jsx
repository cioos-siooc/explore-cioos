import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import { MOBILE_WIDTH, setViewportWidth } from "../../../test/viewport.js";
import TimeBar from "./TimeBar.jsx";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";

function Harness() {
  const { catalogLoaded } = useFilters();
  if (!catalogLoaded) return <span data-testid="state">loading</span>;
  return (
    <>
      <span data-testid="state">loaded</span>
      <TimeBar />
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

describe("TimeBar", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("renders nothing while the time filter is inactive (the default)", async () => {
    await renderReady();
    expect(document.querySelector(".timeBar")).not.toBeInTheDocument();
  });

  it("renders the bar once the time filter is active via the URL", async () => {
    await renderReady({ url: "/?timeMin=2015-01-01T00:00:00Z" });
    expect(document.querySelector(".timeBar")).toBeInTheDocument();
    expect(screen.getAllByRole("slider")).toHaveLength(2);
  });

  it("renders nothing on a phone-width viewport even with the filter active", async () => {
    setViewportWidth(MOBILE_WIDTH);
    await renderReady({ url: "/?timeMin=2015-01-01T00:00:00Z" });
    expect(document.querySelector(".timeBar")).not.toBeInTheDocument();
  });

  it("Reset restores the default start/end dates", async () => {
    const { user } = await renderReady({ url: "/?timeMin=2015-01-01T00:00:00Z" });
    await user.click(screen.getByTitle("Reset the time range to all dates"));
    await waitFor(() =>
      expect(document.querySelector(".timeBar")).not.toBeInTheDocument(),
    );
  });
});
