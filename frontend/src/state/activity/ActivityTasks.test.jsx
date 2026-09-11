import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../test/mockFetch.js";
import { useActivity } from "./ActivityProvider.jsx";

// ActivityTasks (mounted inside AppProviders, like UrlSync) is the only thing
// that reads the providers' independent loading flags and registers them with
// ActivityProvider — nothing renders it standalone.
function Probe() {
  const { labelKeys } = useActivity();
  return <span data-testid="keys">{[...labelKeys].sort().join(",")}</span>;
}

const keys = () =>
  screen.getByTestId("keys").textContent.split(",").filter(Boolean);

describe("ActivityTasks", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("registers activityCatalogText while the catalog is still loading, and clears it once loaded", async () => {
    renderWithProviders(<Probe />, { providers: "app" });
    expect(keys()).toContain("activityCatalogText");
    await waitFor(() => expect(keys()).not.toContain("activityCatalogText"));
  });

  it("registers activityDatasetsText while the initial /pointQuery is in flight, and clears it once it lands", async () => {
    renderWithProviders(<Probe />, { providers: "app" });
    await waitFor(() => expect(keys()).not.toContain("activityCatalogText"));
    await waitFor(() => expect(keys()).not.toContain("activityDatasetsText"));
  });
});
