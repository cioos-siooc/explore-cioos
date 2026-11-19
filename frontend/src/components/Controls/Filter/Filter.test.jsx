import * as React from "react";
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import Filter from "./Filter.jsx";

// The panel's single open page, as FiltersPanel keeps it in the UI state.
function Panel({ children }) {
  const [open, setOpen] = useState();
  return React.Children.map(children, (child) =>
    React.cloneElement(child, {
      openFilter: open === child.props.filterName,
      setOpenFilter: setOpen,
    }),
  );
}

const render = (ui) => renderWithProviders(<Panel>{ui}</Panel>);

describe("Filter", () => {
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

  // A page beside the list, not a popover: only picking another row (or the
  // panel's search) leaves it, so the URL and the screen always agree.
  it("stays open on a second click and on a click elsewhere", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <Panel>
          <Filter badgeTitle="Ocean variables" filterName="eovs">
            <div>options here</div>
          </Filter>
        </Panel>
        <button>elsewhere</button>
      </>,
    );
    await user.click(screen.getByTestId("filter-header"));
    await user.click(screen.getByTestId("filter-header"));
    await user.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(screen.getByTestId("filter-options")).toBeInTheDocument();
    expect(screen.getByTestId("filter-header")).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("puts the cursor in the search of the row just picked", async () => {
    const user = userEvent.setup();
    render(
      <Filter
        badgeTitle="Ocean variables"
        filterName="eovs"
        searchable
        searchTerms=""
        setSearchTerms={() => {}}
        searchPlaceholder="Search"
      >
        <div>options here</div>
      </Filter>,
    );
    await user.click(screen.getByTestId("filter-header"));
    expect(screen.getByPlaceholderText("Search")).toHaveFocus();
  });

  it("leaves focus alone for a page it was opened on", () => {
    renderWithProviders(
      <Filter
        badgeTitle="Ocean variables"
        filterName="eovs"
        openFilter
        setOpenFilter={() => {}}
        searchable
        searchTerms=""
        setSearchTerms={() => {}}
        searchPlaceholder="Search"
      >
        <div>options here</div>
      </Filter>,
    );
    expect(screen.getByPlaceholderText("Search")).not.toHaveFocus();
  });

  it("keeps its controls outside the scrolling options body", async () => {
    const user = userEvent.setup();
    render(
      <Filter
        badgeTitle="Ocean variables"
        filterName="eovs"
        controls={<button>match all</button>}
      >
        <div>options here</div>
      </Filter>,
    );
    await user.click(screen.getByTestId("filter-header"));
    const controls = screen.getByRole("button", { name: "match all" });
    expect(controls.closest(".filterOptionsBody")).toBeNull();
    expect(screen.getByTestId("filter-options")).toContainElement(controls);
  });

  it("keeps its legend outside the scrolling options body", async () => {
    const user = userEvent.setup();
    render(
      <Filter
        badgeTitle="Ocean variables"
        filterName="eovs"
        legend={<p>what the rows mean</p>}
      >
        <div>options here</div>
      </Filter>,
    );
    await user.click(screen.getByTestId("filter-header"));
    const legend = screen.getByText("what the rows mean");
    expect(legend.closest(".filterOptionsBody")).toBeNull();
    expect(screen.getByTestId("filter-options")).toContainElement(legend);
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

describe("Filter, several in a panel", () => {
  function Harness() {
    const [openFilter, setOpenFilter] = useState();
    return (
      <>
        <Filter
          badgeTitle="Ocean variables"
          filterName="eovs"
          openFilter={openFilter === "eovs"}
          setOpenFilter={setOpenFilter}
        >
          <div>eov options</div>
        </Filter>
        <Filter
          badgeTitle="Platforms"
          filterName="platforms"
          openFilter={openFilter === "platforms"}
          setOpenFilter={setOpenFilter}
        >
          <div>platform options</div>
        </Filter>
      </>
    );
  }

  it("opening one filter closes the other — only one pane at a time", async () => {
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
  // A facet row: its search re-filters and re-renders a list thousands of
  // options long, so the box publishes once typing pauses rather than per
  // keystroke — typing a word used to do that once per character.
  function SearchHarness({ onPublish, ...props }) {
    const [terms, setTerms] = useState("");
    return (
      <Filter
        badgeTitle="Ocean variables"
        filterName="eovs"
        searchable
        searchTerms={terms}
        setSearchTerms={(next) => {
          onPublish(next);
          setTerms(next);
        }}
        searchPlaceholder="Search"
        {...props}
      >
        <div>options</div>
      </Filter>
    );
  }

  it("publishes the typed text once, after typing pauses — not per keystroke", async () => {
    // No inter-keystroke delay, so the whole word is typed well inside the
    // debounce however loaded the machine running this is.
    const user = userEvent.setup({ delay: null });
    const onPublish = vi.fn();
    render(<SearchHarness onPublish={onPublish} />);

    await user.click(screen.getByTestId("filter-header"));
    await user.type(screen.getByPlaceholderText("Search"), "oxy");

    expect(screen.getByPlaceholderText("Search")).toHaveValue("oxy");
    expect(onPublish).not.toHaveBeenCalled();

    await waitFor(() => expect(onPublish).toHaveBeenCalledWith("oxy"));
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  // Clearing is the exception to the pause: it publishes there and then, which
  // is what this asserts by never waiting.
  it("Clear empties the search immediately", async () => {
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

  it("offers Clear only once something is set", async () => {
    const user = userEvent.setup();
    render(
      <Filter
        badgeTitle="Ocean variables"
        filterName="eovs"
        resetButton={vi.fn()}
      >
        <div>options</div>
      </Filter>,
    );
    await user.click(screen.getByTestId("filter-header"));
    expect(screen.queryByText("Clear")).not.toBeInTheDocument();
  });

  it("the reset button calls resetButton", async () => {
    const user = userEvent.setup();
    const resetButton = vi.fn();
    render(
      <Filter
        active
        badgeTitle="Ocean variables"
        filterName="eovs"
        resetButton={resetButton}
      >
        <div>options</div>
      </Filter>,
    );
    await user.click(screen.getByTestId("filter-header"));
    await user.click(screen.getByText("Clear"));
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
