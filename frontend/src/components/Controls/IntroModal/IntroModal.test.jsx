import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import TipCard from "../Tips/TipCard.jsx";
import IntroModal from "./IntroModal.jsx";

// FeedbackButton calls Sentry.getFeedback() on click, which is undefined
// outside a real Sentry init — mock it out so the button renders inert.
vi.mock("@sentry/react", () => ({ getFeedback: () => undefined }));

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
    expect(screen.queryByText("Data Explorer")).not.toBeInTheDocument();
  });

  it("leaves the brand to the logo beside the title, not the title itself", () => {
    renderIntro();
    expect(
      screen.getByRole("dialog", { name: "CIOOS Data Explorer" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Data Explorer")).toHaveClass("introTitleName");
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

  it("Go to the map closes the dialog", async () => {
    const setShowModal = vi.fn();
    const { user } = renderIntro({ setShowModal });
    await user.click(screen.getByRole("button", { name: "Go to the map" }));
    expect(setShowModal).toHaveBeenCalledWith(false);
  });

  describe("New feature highlights", () => {
    it("High-resolution bathymetry turns the NONNA layer on", async () => {
      window.localStorage.setItem(
        "cde.bathymetryVisible",
        JSON.stringify(false),
      );
      const setShowModal = vi.fn();
      const { user } = renderIntro({ setShowModal });
      expect(screen.getByTestId("bathymetry")).toHaveTextContent("off");
      await user.click(
        screen.getByRole("button", {
          name: /High-resolution bathymetry/,
        }),
      );
      expect(setShowModal).toHaveBeenCalledWith(false);
      expect(screen.getByTestId("bathymetry")).toHaveTextContent("on");
    });

    it("See when data was collected opens the time coverage chart", async () => {
      const setShowModal = vi.fn();
      const { user } = renderIntro({ setShowModal });
      await user.click(
        screen.getByRole("button", { name: /See when data was collected/ }),
      );
      expect(setShowModal).toHaveBeenCalledWith(false);
      expect(screen.getByTestId("coverage-modal")).toHaveTextContent("open");
    });

    // The fixture catalogue has no dataset with a WMS server.
    it("hides the gridded showcase when no dataset has a WMS server", async () => {
      renderIntro();
      await screen.findByText("datasets");
      expect(
        screen.queryByRole("button", { name: /Draw gridded data on the map/ }),
      ).not.toBeInTheDocument();
    });
  });

  it("the download card opens the selection help", async () => {
    const { user } = renderIntro();
    await user.click(screen.getByRole("button", { name: "How to download" }));
    expect(screen.getByTestId("selection-help")).toHaveTextContent("open");
  });

  it("Start the walkthrough closes the dialog and starts the tour at the first tip", async () => {
    const setShowModal = vi.fn();
    const { user } = renderIntro({ setShowModal });
    await user.click(
      screen.getByRole("button", { name: "Start the walkthrough" }),
    );
    expect(setShowModal).toHaveBeenCalledWith(false);
    expect(screen.getByTestId("tip-card")).toHaveTextContent(/Tip 1 of \d+/);
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

  it("the whole feedback card is the feedback button", () => {
    renderIntro();
    expect(screen.getByRole("button", { name: /^Feedback/ })).toHaveClass(
      "introFooterCard",
    );
  });

  it("names both data sources, ERDDAP™ and OBIS", () => {
    renderIntro();
    expect(screen.getByText(/Data comes from ERDDAP™/)).toHaveTextContent(
      "OBIS",
    );
  });

  it("clicking anywhere on the tips card toggles tips and persists the choice", async () => {
    const { user } = renderIntro();
    const toggle = screen.getByRole("switch", { name: "Tips as you go" });
    expect(toggle).toBeChecked();
    await user.click(screen.getByText(/Short tips pop up/));
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
