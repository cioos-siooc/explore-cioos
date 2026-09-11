import * as React from "react";
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import Filter from "./Filter.jsx";

const render = (ui) => renderWithProviders(ui);

describe("Filter (uncontrolled)", () => {
  it("starts closed and opens on click", async () => {
    const user = userEvent.setup();
    render(
      <Filter badgeTitle="Ocean variables" filterName="eovs">
        <div>options here</div>
      </Filter>,
    );
    expect(screen.queryByTestId("filter-options")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("filter-header"));
    expect(screen.getByTestId("filter-options")).toBeInTheDocument();
    expect(screen.getByText("options here")).toBeInTheDocument();
  });

  it("closes again on a second click", async () => {
    const user = userEvent.setup();
    render(
      <Filter badgeTitle="Ocean variables" filterName="eovs">
        <div>options here</div>
      </Filter>,
    );
    await user.click(screen.getByTestId("filter-header"));
    await user.click(screen.getByTestId("filter-header"));
    expect(screen.queryByTestId("filter-options")).not.toBeInTheDocument();
  });

  it("closes on an outside click", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Filter badgeTitle="Ocean variables" filterName="eovs">
          <div>options here</div>
        </Filter>
        <button>elsewhere</button>
      </>,
    );
    await user.click(screen.getByTestId("filter-header"));
    expect(screen.getByTestId("filter-options")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(screen.queryByTestId("filter-options")).not.toBeInTheDocument();
  });

  it("truncates a long badge title, keeping the full text in the title attribute", async () => {
    const long = "A".repeat(50);
    render(
      <Filter badgeTitle={long} filterName="eovs">
        <div>x</div>
      </Filter>,
    );
    const badge = document.querySelector(".badgeTitle");
    expect(badge).toHaveAttribute("title", long);
    expect(badge.textContent.length).toBeLessThan(long.length);
  });
});

describe("Filter (disabled)", () => {
  it("never opens, and shows the disabled explanation instead", async () => {
    const user = userEvent.setup();
    render(
      <Filter
        badgeTitle="Scientific name"
        filterName="scientificName"
        disabled
        disabledTooltip="Turn off the source filter to search by name"
      >
        <div>options here</div>
      </Filter>,
    );
    await user.click(screen.getByTestId("filter-header"));
    expect(screen.queryByTestId("filter-options")).not.toBeInTheDocument();
    expect(
      screen.getByText("Turn off the source filter to search by name"),
    ).toBeInTheDocument();
  });
});

describe("Filter (controlled)", () => {
  function Harness() {
    const [openFilter, setOpenFilter] = useState();
    return (
      <>
        <Filter
          badgeTitle="Ocean variables"
          filterName="eovs"
          controlled
          openFilter={openFilter === "eovs"}
          setOpenFilter={setOpenFilter}
        >
          <div>eov options</div>
        </Filter>
        <Filter
          badgeTitle="Platforms"
          filterName="platforms"
          controlled
          openFilter={openFilter === "platforms"}
          setOpenFilter={setOpenFilter}
        >
          <div>platform options</div>
        </Filter>
      </>
    );
  }

  it("opening one controlled filter closes the other — only one pane at a time", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const [eovHeader, platformHeader] = screen.getAllByTestId("filter-header");
    await user.click(eovHeader);
    expect(screen.getByText("eov options")).toBeInTheDocument();
    expect(screen.queryByText("platform options")).not.toBeInTheDocument();

    await user.click(platformHeader);
    expect(screen.queryByText("eov options")).not.toBeInTheDocument();
    expect(screen.getByText("platform options")).toBeInTheDocument();
  });
});

describe("Filter search / reset / info", () => {
  it("the search box calls setSearchTerms as the user types, and Clear resets it", async () => {
    const user = userEvent.setup();
    const setSearchTerms = vi.fn();
    render(
      <Filter
        badgeTitle="Ocean variables"
        filterName="eovs"
        searchable
        searchTerms="oxy"
        setSearchTerms={setSearchTerms}
        searchPlaceholder="Search"
      >
        <div>options</div>
      </Filter>,
    );
    await user.click(screen.getByTestId("filter-header"));
    await user.click(screen.getByLabelText("Clear search terms"));
    expect(setSearchTerms).toHaveBeenCalledWith("");
  });

  it("the reset button calls resetButton", async () => {
    const user = userEvent.setup();
    const resetButton = vi.fn();
    render(
      <Filter
        badgeTitle="Ocean variables"
        filterName="eovs"
        resetButton={resetButton}
      >
        <div>options</div>
      </Filter>,
    );
    await user.click(screen.getByTestId("filter-header"));
    await user.click(screen.getByText("Reset"));
    expect(resetButton).toHaveBeenCalled();
  });

  it("the info button links out to the given URL", async () => {
    const user = userEvent.setup();
    render(
      <Filter
        badgeTitle="Platforms"
        filterName="platforms"
        infoButton="http://vocab.nerc.ac.uk/collection/L06/current/"
      >
        <div>options</div>
      </Filter>,
    );
    await user.click(screen.getByTestId("filter-header"));
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute(
      "href",
      "http://vocab.nerc.ac.uk/collection/L06/current/",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });
});
