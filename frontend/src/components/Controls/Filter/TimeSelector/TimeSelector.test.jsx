import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../../test/mockFetch.js";
import TimeSelector from "./TimeSelector.jsx";
import { useFilters } from "../../../../state/filters/FilterProvider.jsx";

function Harness() {
  const { catalogLoaded, startDate, endDate, setStartDate, setEndDate } =
    useFilters();
  if (!catalogLoaded) return <span data-testid="state">loading</span>;
  return (
    <>
      <span data-testid="state">loaded</span>
      <TimeSelector
        startDate={startDate}
        endDate={endDate}
        setStartDate={setStartDate}
        setEndDate={setEndDate}
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

describe("TimeSelector", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("renders start/end date fields and a rail with two handles", async () => {
    await renderReady();
    expect(screen.getByLabelText("Start Date")).toBeInTheDocument();
    expect(screen.getByLabelText("End Date")).toBeInTheDocument();
    expect(screen.getAllByRole("slider")).toHaveLength(2);
  });

  it("choosing an interval sets both dates via the shared FilterProvider state", async () => {
    const { user } = await renderReady();
    await user.selectOptions(screen.getByLabelText("Interval"), "30");
    await waitFor(() => {
      const start = screen.getByLabelText("Start Date").value;
      const end = screen.getByLabelText("End Date").value;
      expect(start < end).toBe(true);
    });
  });

  it("typing a valid start date commits it", async () => {
    await renderReady();
    const input = screen.getByLabelText("Start Date");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "2015-06-15" } });
    await waitFor(() => expect(input.value).toBe("2015-06-15"));
  });
});
