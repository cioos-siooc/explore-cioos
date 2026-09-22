import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../test/mockFetch.js";
import TipCard from "../../components/Controls/Tips/TipCard.jsx";
import { useUI } from "../ui/UIProvider.jsx";
import { useTips } from "./TipsProvider.jsx";

// Stands in for the components that offer tips (the map's draw handler, the
// time bar, …), plus a modal flag to hold them back with.
function Probe() {
  const { offerTip } = useTips();
  const { setShowFiltersModal } = useUI();
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
      <button type="button" onClick={() => setShowFiltersModal(true)}>
        open filters
      </button>
      <button type="button" onClick={() => setShowFiltersModal(false)}>
        close filters
      </button>
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
});
