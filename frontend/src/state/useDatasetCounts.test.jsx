import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../test/renderWithProviders.jsx";
import { installMockFetch } from "../test/mockFetch.js";
import useDatasetCounts from "./useDatasetCounts.js";

function Probe() {
  const { ready, updating, filteredCount, total, allDatasetsShown, label } =
    useDatasetCounts();
  if (!ready) return <span data-testid="state">not ready</span>;
  return (
    <span data-testid="state">
      {JSON.stringify({ updating, filteredCount, total, allDatasetsShown, label })}
    </span>
  );
}

const isReady = () => screen.getByTestId("state").textContent !== "not ready";
const state = () => JSON.parse(screen.getByTestId("state").textContent);

describe("useDatasetCounts", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("is not ready until the initial pointQuery has completed", () => {
    renderWithProviders(<Probe />, { providers: "app" });
    expect(isReady()).toBe(false);
  });

  it("becomes ready with the fixture's filtered and total counts, matching", async () => {
    renderWithProviders(<Probe />, { providers: "app" });
    await waitFor(() => expect(isReady()).toBe(true));
    const result = state();
    expect(result.total).toBeGreaterThan(0);
    expect(result.filteredCount).toBeGreaterThan(0);
    expect(result.label).toBeTruthy();
  });

  it("reports allDatasetsShown once nothing has narrowed the list", async () => {
    renderWithProviders(<Probe />, { providers: "app" });
    await waitFor(() => expect(isReady()).toBe(true));
    expect(state().allDatasetsShown).toBe(true);
  });
});
