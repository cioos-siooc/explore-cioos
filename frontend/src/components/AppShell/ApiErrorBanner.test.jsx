import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../test/mockFetch.js";
import ApiErrorBanner from "./ApiErrorBanner.jsx";
import { useMapState } from "../../state/map/MapStateProvider.jsx";

let latestMap;
function Probe() {
  latestMap = useMapState();
  return null;
}

describe("ApiErrorBanner", () => {
  beforeEach(() => {
    installMockFetch();
  });

  // A tile the retries gave up on is a hole that reads as "no data here".
  it("says when map tiles failed, and its Retry asks the map to try again", async () => {
    renderWithProviders(
      <>
        <ApiErrorBanner />
        <Probe />
      </>,
      { providers: "app" },
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    act(() => latestMap.setTilesFailed(true));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Part of the map didn't load",
    );

    const before = latestMap.tileRetryRequest;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(latestMap.tileRetryRequest).toBe(before + 1);

    act(() => latestMap.setTilesFailed(false));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
