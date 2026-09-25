import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { TIPS } from "../../../state/tips/TipsProvider.jsx";
import TipCard from "../Tips/TipCard.jsx";
import IntroModal from "./IntroModal.jsx";

// FeedbackButton calls Sentry.getFeedback() on click, which is undefined
// outside a real Sentry init — mock it out so the button renders inert.
vi.mock("@sentry/react", () => ({ getFeedback: () => undefined }));

// The modal reads UI and tips state (the selection-help link, the tips
// switch), so it renders under the app's providers, with the same open flag
// the app hands it.
function Harness({ setShowModal = () => {} }) {
  const { showSelectionHelpModal, showCoverageModal } = useUI();
  const { bathymetryVisible } = useMapState();
  return (
    <>
      <IntroModal showModal setShowModal={setShowModal} />
      <span data-testid="selection-help">
        {showSelectionHelpModal ? "open" : "closed"}
      </span>
      <span data-testid="coverage-modal">
        {showCoverageModal ? "open" : "closed"}
      </span>
      <span data-testid="bathymetry">{bathymetryVisible ? "on" : "off"}</span>
      <TipCard />
    </>
  );
}

const renderIntro = (props) =>
  renderWithProviders(<Harness {...props} />, { providers: "app" });

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

  it("leads with the hero and the three steps of using the tool", () => {
    renderIntro();
    expect(
      screen.getByRole("heading", { level: 2, name: /on one map/ }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent),
    ).toEqual(["Look at the map", "Narrow it down", "Get the data"]);
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
    it("See the seafloor in Halifax Harbour turns the NONNA layer on", async () => {
      window.localStorage.setItem(
        "cde.bathymetryVisible",
        JSON.stringify(false),
      );
      const setShowModal = vi.fn();
      const { user } = renderIntro({ setShowModal });
      expect(screen.getByTestId("bathymetry")).toHaveTextContent("off");
      await user.click(
        screen.getByRole("button", {
          name: /See the seafloor in Halifax Harbour/,
        }),
      );
      expect(setShowModal).toHaveBeenCalledWith(false);
      expect(screen.getByTestId("bathymetry")).toHaveTextContent("on");
    });

    it("When was the data collected? opens the time coverage chart", async () => {
      const setShowModal = vi.fn();
      const { user } = renderIntro({ setShowModal });
      await user.click(
        screen.getByRole("button", { name: /When was the data collected/ }),
      );
      expect(setShowModal).toHaveBeenCalledWith(false);
      expect(screen.getByTestId("coverage-modal")).toHaveTextContent("open");
    });

    it("Zoom into the Gulf of St. Lawrence closes the dialog to show the map", async () => {
      const setShowModal = vi.fn();
      const { user } = renderIntro({ setShowModal });
      await user.click(
        screen.getByRole("button", {
          name: /Zoom into the Gulf of St. Lawrence/,
        }),
      );
      expect(setShowModal).toHaveBeenCalledWith(false);
    });
  });

  it("the download card opens the selection help", async () => {
    const { user } = renderIntro();
    await user.click(
      screen.getByRole("button", { name: "What can I download?" }),
    );
    expect(screen.getByTestId("selection-help")).toHaveTextContent("open");
  });

  it("Take a quick tour closes the dialog and starts the tour at the first tip", async () => {
    const setShowModal = vi.fn();
    const { user } = renderIntro({ setShowModal });
    await user.click(screen.getByRole("button", { name: "Take a quick tour" }));
    expect(setShowModal).toHaveBeenCalledWith(false);
    expect(screen.getByTestId("tip-card")).toHaveTextContent(
      `Tip 1 of ${TIPS.length}`,
    );
  });

  it("points at the real buttons: the tips lightbulb and the About ⓘ", () => {
    renderIntro();
    expect(
      screen.getByRole("img", { name: "A tip is available" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "About this tool" }),
    ).toBeInTheDocument();
  });

  it("the feedback card has a labelled Send feedback button", () => {
    renderIntro();
    expect(
      screen.getByRole("button", { name: "Send feedback" }),
    ).toBeInTheDocument();
  });

  it("names both data sources, ERDDAP™ and OBIS", () => {
    renderIntro();
    expect(screen.getByText(/Data comes from ERDDAP™/)).toHaveTextContent(
      "OBIS",
    );
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
