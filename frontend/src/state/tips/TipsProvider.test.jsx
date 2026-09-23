import * as React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../test/mockFetch.js";
import TipCard from "../../components/Controls/Tips/TipCard.jsx";
import { useUI } from "../ui/UIProvider.jsx";
import { useMapState } from "../map/MapStateProvider.jsx";
import { TIPS, useTips } from "./TipsProvider.jsx";

// Stands in for the components that offer tips (the map's draw handler, the
// time bar, …), plus a modal flag to hold them back with.
function Probe() {
  const { offerTip, tipHighlight, startTour } = useTips();
  const {
    setShowFiltersModal,
    quickFiltersCollapsed,
    setQuickFiltersCollapsed,
  } = useUI();
  return (
    <>
      <button type="button" onClick={() => offerTip("reshapeArea")}>
        offer reshape
      </button>
      <button type="button" onClick={() => offerTip("sliderKeys")}>
        offer slider
      </button>
      <button
        type="button"
        onClick={() => offerTip(["reshapeArea", "sliderKeys"])}
      >
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
        data-testid="reshape-target"
        data-tip-highlight={tipHighlight("reshapeArea")}
      />
      <span
        data-testid="slider-target"
        data-tip-highlight={tipHighlight("sliderKeys")}
      />
      <TipCard />
    </>
  );
}

// A returning visitor: the intro cookie is what says the intro has been seen.
function returningVisitor() {
  document.cookie = "introModalOpen=false; path=/";
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
    await user.click(screen.getByText("offer reshape"));
    expect(card()).toHaveTextContent(/Drag the corners/);
    expect(JSON.parse(window.localStorage.getItem("cde.seenTips"))).toEqual([
      "reshapeArea",
    ]);
  });

  it("highlights only the active tip's control, until dismissed", async () => {
    returningVisitor();
    const { user } = renderProbe();
    const reshape = screen.getByTestId("reshape-target");
    const slider = screen.getByTestId("slider-target");
    expect(reshape).not.toHaveAttribute("data-tip-highlight");
    await user.click(screen.getByText("offer reshape"));
    expect(reshape).toHaveAttribute("data-tip-highlight");
    expect(slider).not.toHaveAttribute("data-tip-highlight");
    await user.click(screen.getByRole("button", { name: "Close tip" }));
    expect(reshape).not.toHaveAttribute("data-tip-highlight");
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
    await user.click(screen.getByText("offer reshape"));
    expect(await screen.findByTestId("tip-pointer")).toHaveStyle({
      left: "115px",
      top: "70px",
    });
    rect.mockRestore();
  });

  it("shows at most one tip per visit", async () => {
    returningVisitor();
    const { user } = renderProbe();
    await user.click(screen.getByText("offer reshape"));
    await user.click(screen.getByRole("button", { name: "Close tip" }));
    await user.click(screen.getByText("offer slider"));
    expect(card()).toBeNull();
  });

  it("never repeats a tip already seen", async () => {
    returningVisitor();
    window.localStorage.setItem(
      "cde.seenTips",
      JSON.stringify(["reshapeArea"]),
    );
    const { user } = renderProbe();
    await user.click(screen.getByText("offer reshape"));
    expect(card()).toBeNull();
    await user.click(screen.getByText("offer slider"));
    expect(card()).toHaveTextContent(/time bar/);
  });

  it("offers the first unseen tip of a priority list", async () => {
    returningVisitor();
    window.localStorage.setItem(
      "cde.seenTips",
      JSON.stringify(["reshapeArea"]),
    );
    const { user } = renderProbe();
    await user.click(screen.getByText("offer either"));
    expect(card()).toHaveTextContent(/time bar/);
  });

  it("stays quiet on a first visit, where the intro covers the basics", async () => {
    const { user } = renderProbe();
    await user.click(screen.getByText("offer reshape"));
    expect(card()).toBeNull();
  });

  it("stays quiet when tips are turned off", async () => {
    returningVisitor();
    window.localStorage.setItem("cde.tipsEnabled", "false");
    const { user } = renderProbe();
    await user.click(screen.getByText("offer reshape"));
    expect(card()).toBeNull();
  });

  it("holds an offer made behind a modal until it closes", async () => {
    returningVisitor();
    const { user } = renderProbe();
    await user.click(screen.getByText("open filters"));
    await user.click(screen.getByText("offer slider"));
    expect(card()).toBeNull();
    await user.click(screen.getByText("close filters"));
    expect(card()).toHaveTextContent(/time bar/);
  });

  it("“Don't show tips” turns them off for good", async () => {
    returningVisitor();
    const { user } = renderProbe();
    await user.click(screen.getByText("offer reshape"));
    await user.click(screen.getByRole("button", { name: "Don't show tips" }));
    expect(card()).toBeNull();
    expect(window.localStorage.getItem("cde.tipsEnabled")).toBe("false");
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
      expect(card()).toHaveTextContent(`Tip 6 of ${TIPS.length}`);
    });

    it("steps both ways, wrapping round, and ends on close", async () => {
      returningVisitor();
      const { user } = renderProbe();
      await user.click(screen.getByText("start tour"));
      await user.click(screen.getByRole("button", { name: "Next tip" }));
      expect(card()).toHaveTextContent(`Tip 7 of ${TIPS.length}`);
      await user.click(screen.getByRole("button", { name: "Previous tip" }));
      await user.click(screen.getByRole("button", { name: "Previous tip" }));
      expect(card()).toHaveTextContent(`Tip 5 of ${TIPS.length}`);
      await user.click(screen.getByRole("button", { name: "Close tip" }));
      expect(card()).toBeNull();
    });

    it("holds back offered tips while it runs", async () => {
      returningVisitor();
      const { user } = renderProbe();
      await user.click(screen.getByText("start tour"));
      await user.click(screen.getByText("offer reshape"));
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
      expect(card()).toHaveTextContent(/What's here card/);
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
      expect(card()).toHaveTextContent(/eye button/);
      expect(screen.getByTestId("quick-filters")).toHaveTextContent("shown");
    });
  });
});
