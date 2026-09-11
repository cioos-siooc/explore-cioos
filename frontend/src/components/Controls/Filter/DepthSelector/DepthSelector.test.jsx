import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../../test/mockFetch.js";
import DepthSelector from "./DepthSelector.jsx";
import { useFilters } from "../../../../state/filters/FilterProvider.jsx";

function Harness() {
  const { catalogLoaded, startDepth, endDepth, setStartDepth, setEndDepth } =
    useFilters();
  if (!catalogLoaded) return <span data-testid="state">loading</span>;
  return (
    <>
      <span data-testid="state">loaded</span>
      <DepthSelector
        startDepth={startDepth}
        endDepth={endDepth}
        setStartDepth={setStartDepth}
        setEndDepth={setEndDepth}
      />
    </>
  );
}

async function renderReady() {
  const result = renderWithProviders(<Harness />, { providers: "app" });
  await waitFor(() =>
    expect(screen.getByTestId("state")).toHaveTextContent("loaded"),
  );
  return result;
}

// The field's accessible name (from its wrapping <label>) is the same text as
// the rail handle beside it (both "Start Depth (m)"/"End Depth (m)" — the
// field's label and the handle's aria-label read the same translation key),
// so getByLabelText matches both — narrow to the <input>, which is the field.
const startInput = () =>
  screen
    .getAllByLabelText("Start Depth (m)")
    .find((el) => el.tagName === "INPUT");
const endInput = () =>
  screen
    .getAllByLabelText("End Depth (m)")
    .find((el) => el.tagName === "INPUT");

describe("DepthSelector", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("renders start/end depth fields and a rail with two handles", async () => {
    await renderReady();
    expect(startInput()).toBeInTheDocument();
    expect(endInput()).toBeInTheDocument();
    expect(screen.getAllByRole("slider")).toHaveLength(2);
  });

  it("choosing a band preset sets both depths", async () => {
    const { user } = await renderReady();
    await user.selectOptions(screen.getByLabelText("Band"), "0-500");
    await waitFor(() => {
      expect(startInput().value).toBe("0");
      expect(endInput().value).toBe("500");
    });
  });

  it("typing a valid start depth commits it", async () => {
    await renderReady();
    const input = startInput();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "250" } });
    await waitFor(() => expect(input.value).toBe("250"));
  });
});
