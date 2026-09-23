import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { TIPS } from "../../../state/tips/TipsProvider.jsx";
import IntroModal from "./IntroModal.jsx";

// FeedbackButton calls Sentry.getFeedback() on click, which is undefined
// outside a real Sentry init — mock it out so the button renders inert.
vi.mock("@sentry/react", () => ({ getFeedback: () => undefined }));

// The modal reads UI and tips state (the selection-help link, the tips
// switch), so it renders under the app's providers, with the same open flag
// the app hands it.
function Harness({ setShowModal = () => {} }) {
  const { showSelectionHelpModal, showDownloadModal, showCoverageModal } =
    useUI();
  const { pointsToReview } = useSelection();
  const { bathymetryVisible } = useMapState();
  return (
    <>
      <IntroModal showModal setShowModal={setShowModal} />
      <span data-testid="selection-help">
        {showSelectionHelpModal ? "open" : "closed"}
      </span>
      <span data-testid="download-modal">
        {showDownloadModal ? "open" : "closed"}
      </span>
      <span data-testid="coverage-modal">
        {showCoverageModal ? "open" : "closed"}
      </span>
      <span data-testid="download-count">{pointsToReview?.length ?? 0}</span>
      <span data-testid="bathymetry">{bathymetryVisible ? "on" : "off"}</span>
    </>
  );
}

const renderIntro = (props) =>
  renderWithProviders(<Harness {...props} />, { providers: "app" });

const tip = () => screen.getByTestId("intro-tip").textContent;

describe("IntroModal", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("renders nothing (Modal unmounts its body) when show is false", () => {
    renderWithProviders(
      <IntroModal showModal={false} setShowModal={() => {}} />,
      { providers: "app" },
    );
    expect(screen.queryByText("CIOOS Data Explorer")).not.toBeInTheDocument();
  });

  it("leads with the hero and the three things the tool does", () => {
    renderIntro();
    expect(
      screen.getByRole("heading", { level: 2, name: /all on one map/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/ERDDAP™ servers and OBIS/)).toBeInTheDocument();
    expect(
      screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent),
    ).toEqual([
      "Explore the map",
      "Search across everything",
      "Download it, or take the link",
    ]);
  });

  it("shows the catalogue's live size once it has loaded", async () => {
    renderIntro();
    const label = await screen.findByText("datasets");
    await waitFor(() =>
      expect(
        Number(label.previousSibling.textContent.replace(/\D/g, "")),
      ).toBeGreaterThan(0),
    );
  });

  it("Start exploring closes the dialog", async () => {
    const setShowModal = vi.fn();
    const { user } = renderIntro({ setShowModal });
    await user.click(screen.getByRole("button", { name: "Start exploring" }));
    expect(setShowModal).toHaveBeenCalledWith(false);
  });

  describe("See it in action", () => {
    it("Build a download adds a dataset and opens the order window", async () => {
      const setShowModal = vi.fn();
      const { user } = renderIntro({ setShowModal });
      await user.click(
        await screen.findByRole("button", { name: /Build a download/ }),
      );
      expect(setShowModal).toHaveBeenCalledWith(false);
      expect(screen.getByTestId("download-modal")).toHaveTextContent("open");
      await waitFor(() =>
        expect(screen.getByTestId("download-count")).toHaveTextContent("1"),
      );
    });

    it("Seafloor depth up close turns the NONNA layer on", async () => {
      window.localStorage.setItem(
        "cde.bathymetryVisible",
        JSON.stringify(false),
      );
      const setShowModal = vi.fn();
      const { user } = renderIntro({ setShowModal });
      expect(screen.getByTestId("bathymetry")).toHaveTextContent("off");
      await user.click(
        screen.getByRole("button", { name: /Seafloor depth up close/ }),
      );
      expect(setShowModal).toHaveBeenCalledWith(false);
      expect(screen.getByTestId("bathymetry")).toHaveTextContent("on");
    });

    it("When was data collected? opens the time coverage chart", async () => {
      const setShowModal = vi.fn();
      const { user } = renderIntro({ setShowModal });
      await user.click(
        screen.getByRole("button", { name: /When was data collected/ }),
      );
      expect(setShowModal).toHaveBeenCalledWith(false);
      expect(screen.getByTestId("coverage-modal")).toHaveTextContent("open");
    });

    it("Stations up close closes the dialog to show the map", async () => {
      const setShowModal = vi.fn();
      const { user } = renderIntro({ setShowModal });
      await user.click(
        screen.getByRole("button", { name: /Stations up close/ }),
      );
      expect(setShowModal).toHaveBeenCalledWith(false);
    });

    // The recorded fixtures carry no gridded dataset with a WMS server, which
    // is the case the rule exists for: no link to a view that can't be shown.
    it("leaves out the gridded link when nothing in the catalogue has WMS", async () => {
      renderIntro();
      await screen.findByRole("button", { name: /Build a download/ });
      expect(
        screen.queryByRole("button", { name: /Gridded data on the map/ }),
      ).toBeNull();
    });
  });

  it("the download card opens the selection help", async () => {
    const { user } = renderIntro();
    await user.click(
      screen.getByRole("button", { name: "What can I download?" }),
    );
    expect(screen.getByTestId("selection-help")).toHaveTextContent("open");
  });

  it("pages through the tips, wrapping round at the end", async () => {
    const { user } = renderIntro();
    const first = tip();
    expect(first).toMatch(`Tip 1 of ${TIPS.length}`);
    await user.click(screen.getByRole("button", { name: "Next tip" }));
    expect(tip()).toMatch(`Tip 2 of ${TIPS.length}`);
    for (let i = 1; i < TIPS.length; i += 1)
      await user.click(screen.getByRole("button", { name: "Next tip" }));
    expect(tip()).toBe(first);
  });

  it("the tips switch persists the choice", async () => {
    const { user } = renderIntro();
    const toggle = screen.getByRole("switch", { name: /Show tips/ });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(window.localStorage.getItem("cde.tipsEnabled")).toBe("false");
  });

  it("links the brand to the organisation's site in the current language", async () => {
    const { i18n } = renderIntro();
    expect(document.querySelector(".introBrand")).toHaveAttribute(
      "href",
      "https://cioos.ca/",
    );
    await act(async () => {
      await i18n.changeLanguage("fr");
    });
    expect(document.querySelector(".introBrand")).toHaveAttribute(
      "href",
      "https://siooc.ca/",
    );
  });

  it("closing (X) calls setShowModal(false)", async () => {
    const setShowModal = vi.fn();
    const { user } = renderIntro({ setShowModal });
    await user.click(screen.getByRole("button", { name: /^close/i }));
    expect(setShowModal).toHaveBeenCalledWith(false);
  });
});
