import * as React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../test/mockFetch.js";
import { MOBILE_WIDTH, setViewportWidth } from "../../test/viewport.js";
import TipCard from "../../components/Controls/Tips/TipCard.jsx";
import FiltersModal from "../../components/AppShell/Modals/FiltersModal.jsx";
import { useUI } from "../ui/UIProvider.jsx";
import { useMapState } from "../map/MapStateProvider.jsx";
import { TIPS, useTips } from "./TipsProvider.jsx";

// Stands in for the components that offer tips (the filter chips, the time
// bar, …), plus a modal flag to hold them back with.
function Probe() {
  const { offerTip, tipHighlight, startTour } = useTips();
  const {
    setShowFiltersModal,
    quickFiltersCollapsed,
    setQuickFiltersCollapsed,
  } = useUI();
  return (
    <>
      <button type="button" onClick={() => offerTip("exclude")}>
        offer exclude
      </button>
      <button type="button" onClick={() => offerTip("matchAll")}>
        offer match all
      </button>
      <button type="button" onClick={() => offerTip(["exclude", "matchAll"])}>
        offer either
      </button>
      <button type="button" onClick={() => startTour("timeCoverage")}>
        start tour
      </button>
      <button type="button" onClick={() => setQuickFiltersCollapsed(true)}>
        fold quick filters
      </button>
      <span data-testid="feature-query-request">
        {useMapState().featureQueryRequest?.lngLat.join(",") ?? "none"}
      </span>
      <span data-testid="quick-filters">
        {quickFiltersCollapsed ? "folded" : "shown"}
      </span>
      <button type="button" onClick={() => setShowFiltersModal(true)}>
        open filters
      </button>
      <button type="button" onClick={() => setShowFiltersModal(false)}>
        close filters
      </button>
      <span
        data-testid="exclude-target"
        data-tip-highlight={tipHighlight("exclude")}
      />
      <span
        data-testid="match-all-target"
        data-tip-highlight={tipHighlight("matchAll")}
      />
      <TipCard />
      {/* Where the filter tips' tour steps show (see TIP_MODALS). */}
      <FiltersModal />
    </>
  );
}

// A returning visitor: one who has closed the intro before.
function returningVisitor() {
  window.localStorage.setItem("cde.introSeen", "true");
}

const renderProbe = () => renderWithProviders(<Probe />, { providers: "app" });
const card = () => screen.queryByTestId("tip-card");

describe("contextual tips", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("shows the offered tip once, and remembers it as seen", async () => {
    returningVisitor();
    const { user } = renderProbe();
    await user.click(screen.getByText("offer exclude"));
    expect(card()).toHaveTextContent(/leave things out/);
    expect(JSON.parse(window.localStorage.getItem("cde.seenTips"))).toEqual([
      "exclude",
    ]);
  });

  it("highlights only the active tip's control, until dismissed", async () => {
    returningVisitor();
    const { user } = renderProbe();
    const exclude = screen.getByTestId("exclude-target");
    const matchAll = screen.getByTestId("match-all-target");
    expect(exclude).not.toHaveAttribute("data-tip-highlight");
    await user.click(screen.getByText("offer exclude"));
    expect(exclude).toHaveAttribute("data-tip-highlight");
    expect(matchAll).not.toHaveAttribute("data-tip-highlight");
    await user.click(screen.getByRole("button", { name: "Close tip" }));
    expect(exclude).not.toHaveAttribute("data-tip-highlight");
  });

  it("points at the highlighted control once it has a size on screen", async () => {
    returningVisitor();
    const rect = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function () {
        return this.hasAttribute("data-tip-highlight")
          ? {
              left: 100,
              top: 40,
              width: 30,
              height: 30,
              right: 130,
              bottom: 70,
            }
          : { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
      });
    const { user } = renderProbe();
    expect(screen.queryByTestId("tip-pointer")).toBeNull();
    await user.click(screen.getByText("offer exclude"));
    expect(await screen.findByTestId("tip-pointer")).toHaveStyle({
      left: "115px",
      top: "70px",
    });
    expect(card()).toHaveClass("tipCardAnchored");
    expect(card()).toHaveStyle({ left: "12px", top: "128px" });
    rect.mockRestore();
  });

  it("shows at most one tip per visit", async () => {
    returningVisitor();
    const { user } = renderProbe();
    await user.click(screen.getByText("offer exclude"));
    await user.click(screen.getByRole("button", { name: "Close tip" }));
    await user.click(screen.getByText("offer match all"));
    expect(card()).toBeNull();
  });

  it("never repeats a tip already seen", async () => {
    returningVisitor();
    window.localStorage.setItem("cde.seenTips", JSON.stringify(["exclude"]));
    const { user } = renderProbe();
    await user.click(screen.getByText("offer exclude"));
    expect(card()).toBeNull();
    await user.click(screen.getByText("offer match all"));
    expect(card()).toHaveTextContent(/Match all/);
  });

  it("offers the first unseen tip of a priority list", async () => {
    returningVisitor();
    window.localStorage.setItem("cde.seenTips", JSON.stringify(["exclude"]));
    const { user } = renderProbe();
    await user.click(screen.getByText("offer either"));
    expect(card()).toHaveTextContent(/Match all/);
  });

  it("stays quiet on a first visit, where the intro covers the basics", async () => {
    const { user } = renderProbe();
    await user.click(screen.getByText("offer exclude"));
    expect(card()).toBeNull();
  });

  it("stays quiet when tips are turned off", async () => {
    returningVisitor();
    window.localStorage.setItem("cde.tipsEnabled", "false");
    const { user } = renderProbe();
    await user.click(screen.getByText("offer exclude"));
    expect(card()).toBeNull();
  });

  it("keeps a tip up until closed", async () => {
    returningVisitor();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderProbe();
    fireEvent.click(screen.getByText("offer match all"));
    act(() => vi.advanceTimersByTime(60000));
    expect(card()).toHaveTextContent(/Match all/);
    vi.useRealTimers();
  });

  it("holds an offer made behind a modal until it closes", async () => {
    returningVisitor();
    const { user } = renderProbe();
    await user.click(screen.getByText("open filters"));
    await user.click(screen.getByText("offer match all"));
    expect(card()).toBeNull();
    await user.click(screen.getByText("close filters"));
    expect(card()).toHaveTextContent(/Match all/);
  });

  it("“Don't show tips” turns them off for good", async () => {
    returningVisitor();
    const { user } = renderProbe();
    await user.click(screen.getByText("offer exclude"));
    await user.click(screen.getByRole("button", { name: "Don't show tips" }));
    expect(card()).toBeNull();
    expect(window.localStorage.getItem("cde.tipsEnabled")).toBe("false");
  });

  describe("on a phone", () => {
    beforeEach(() => setViewportWidth(MOBILE_WIDTH));

    it("waits as a lightbulb until tapped, then shows the card", async () => {
      returningVisitor();
      const { user } = renderProbe();
      await user.click(screen.getByText("offer match all"));
      expect(card()).toBeNull();
      await user.click(
        screen.getByRole("button", { name: "A tip is available" }),
      );
      expect(card()).toHaveTextContent(/Match all/);
    });

    it("opens a tour straight away", async () => {
      returningVisitor();
      const { user } = renderProbe();
      await user.click(screen.getByText("start tour"));
      expect(card()).toHaveTextContent(/Time coverage/);
    });
  });

  describe("tour", () => {
    it("runs past the offer rules: first visit, tips off, already seen", async () => {
      window.localStorage.setItem("cde.tipsEnabled", "false");
      window.localStorage.setItem(
        "cde.seenTips",
        JSON.stringify(["timeCoverage"]),
      );
      const { user } = renderProbe();
      await user.click(screen.getByText("start tour"));
      expect(card()).toHaveTextContent(/Time coverage/);
      expect(card()).toHaveTextContent(
        `Tip ${TIPS.indexOf("timeCoverage") + 1} of ${TIPS.length}`,
      );
    });

    it("steps both ways, wrapping round, and ends on close", async () => {
      returningVisitor();
      const { user } = renderProbe();
      await user.click(screen.getByText("start tour"));
      await user.click(screen.getByRole("button", { name: "Next tip" }));
      expect(card()).toHaveTextContent(
        `Tip ${TIPS.indexOf("timeCoverage") + 2} of ${TIPS.length}`,
      );
      await user.click(screen.getByRole("button", { name: "Previous tip" }));
      await user.click(screen.getByRole("button", { name: "Previous tip" }));
      expect(card()).toHaveTextContent(
        `Tip ${TIPS.indexOf("timeCoverage")} of ${TIPS.length}`,
      );
      await user.click(screen.getByRole("button", { name: "Close tip" }));
      expect(card()).toBeNull();
    });

    it("starts from an offered tip", async () => {
      returningVisitor();
      const { user } = renderProbe();
      await user.click(screen.getByText("offer exclude"));
      expect(card()).toHaveTextContent(
        `Tip ${TIPS.indexOf("exclude") + 1} of ${TIPS.length}`,
      );
      await user.click(screen.getByRole("button", { name: "Next tip" }));
      expect(card()).toHaveTextContent(/Match all/);
      expect(card()).not.toHaveTextContent("Don't show tips");
    });

    it("holds back offered tips while it runs", async () => {
      returningVisitor();
      const { user } = renderProbe();
      await user.click(screen.getByText("start tour"));
      await user.click(screen.getByText("offer exclude"));
      expect(card()).toHaveTextContent(/Time coverage/);
    });

    it("asks the map for a what's here card on that tip's step", async () => {
      returningVisitor();
      const { user } = renderProbe();
      await user.click(screen.getByText("start tour"));
      for (
        let i = TIPS.indexOf("timeCoverage");
        i > TIPS.indexOf("whatsHere");
        i -= 1
      )
        await user.click(screen.getByRole("button", { name: "Previous tip" }));
      expect(card()).toHaveTextContent(/adds a dataset to your selection/);
      expect(screen.getByTestId("feature-query-request")).not.toHaveTextContent(
        "none",
      );
    });

    it("sets up the step so its control is on screen", async () => {
      returningVisitor();
      const { user } = renderProbe();
      await user.click(screen.getByText("fold quick filters"));
      await user.click(screen.getByText("start tour"));
      for (
        let i = TIPS.indexOf("timeCoverage");
        i > TIPS.indexOf("inView");
        i -= 1
      )
        await user.click(screen.getByRole("button", { name: "Previous tip" }));
      expect(card()).toHaveTextContent(/In view button/);
      expect(screen.getByTestId("quick-filters")).toHaveTextContent("shown");
    });
  });

  describe("tour steps inside the Filters window", () => {
    function FiltersHarness() {
      const { startTour, offerTip } = useTips();
      const { setShowFiltersModal } = useUI();
      return (
        <>
          <button type="button" onClick={() => startTour("exclude")}>
            tour from exclude
          </button>
          <button type="button" onClick={() => offerTip("exclude")}>
            offer exclude
          </button>
          <button type="button" onClick={() => setShowFiltersModal(true)}>
            open filters
          </button>
          <TipCard />
          <FiltersModal />
        </>
      );
    }
    const modal = () => screen.queryByTestId("filters-modal");

    it("opens the window on the filter and shows the tip inside it, at the control", async () => {
      returningVisitor();
      const { user } = renderWithProviders(<FiltersHarness />, {
        providers: "app",
      });
      await user.click(screen.getByText("tour from exclude"));
      expect(modal()).toBeInTheDocument();
      expect(within(modal()).getByTestId("tip-card")).toHaveTextContent(
        /leave things out/,
      );
      expect(screen.getAllByTestId("tip-card")).toHaveLength(1);
      const [first, second] = await within(modal()).findAllByRole("button", {
        name: /^Exclude: /,
      });
      expect(first).toHaveAttribute("data-tip-highlight");
      expect(second).not.toHaveAttribute("data-tip-highlight");

      await user.click(screen.getByRole("button", { name: "Next tip" }));
      expect(within(modal()).getByTestId("tip-card")).toHaveTextContent(
        /Match all/,
      );
      expect(
        within(modal())
          .getByTestId("eovs-match-all")
          .closest("[data-tip-highlight]"),
      ).not.toBeNull();
    });

    it("hangs the tip by its control inside the window", async () => {
      returningVisitor();
      const rect = vi
        .spyOn(Element.prototype, "getBoundingClientRect")
        .mockImplementation(function () {
          return this.hasAttribute("data-tip-highlight")
            ? {
                left: 300,
                top: 600,
                width: 30,
                height: 30,
                right: 330,
                bottom: 630,
              }
            : { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
        });
      const { user } = renderWithProviders(<FiltersHarness />, {
        providers: "app",
      });
      await user.click(screen.getByText("tour from exclude"));
      const tip = within(modal()).getByTestId("tip-card");
      await vi.waitFor(() => expect(tip).toHaveClass("tipCardAnchored"));
      expect(tip).toHaveClass("tipCardAbove");
      rect.mockRestore();
    });

    it("closes the window it opened once the tour moves off it, or ends", async () => {
      returningVisitor();
      const { user } = renderWithProviders(<FiltersHarness />, {
        providers: "app",
      });
      await user.click(screen.getByText("tour from exclude"));
      await user.click(screen.getByRole("button", { name: "Next tip" }));
      await user.click(screen.getByRole("button", { name: "Next tip" }));
      expect(card()).toHaveTextContent(/Real-time button/);
      expect(modal()).toBeNull();

      await user.click(screen.getByRole("button", { name: "Previous tip" }));
      expect(modal()).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Close tip" }));
      expect(modal()).toBeNull();
    });

    it("moves an offered tip into a window the user opens, and leaves it open on close", async () => {
      returningVisitor();
      const { user } = renderWithProviders(<FiltersHarness />, {
        providers: "app",
      });
      await user.click(screen.getByText("offer exclude"));
      expect(modal()).toBeNull();
      expect(card()).toBeInTheDocument();
      await user.click(screen.getByText("open filters"));
      expect(within(modal()).getByTestId("tip-card")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Close tip" }));
      expect(modal()).toBeInTheDocument();
      expect(card()).toBeNull();
    });
  });
});
