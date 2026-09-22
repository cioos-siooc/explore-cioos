import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import { TIPS } from "../../../state/tips/TipsProvider.jsx";
import IntroModal from "./IntroModal.jsx";

// FeedbackButton calls Sentry.getFeedback() on click, which is undefined
// outside a real Sentry init — mock it out so the button renders inert.
vi.mock("@sentry/react", () => ({ getFeedback: () => undefined }));

// The modal reads UI and tips state (the selection-help link, the tips
// switch), so it renders under the app's providers, with the same open flag
// the app hands it.
function Harness({ setShowModal = () => {} }) {
  const { showSelectionHelpModal } = useUI();
  return (
    <>
      <IntroModal showModal setShowModal={setShowModal} />
      <span data-testid="selection-help">
        {showSelectionHelpModal ? "open" : "closed"}
      </span>
    </>
  );
}

const renderIntro = (props) =>
  renderWithProviders(<Harness {...props} />, { providers: "app" });

const stepInfo = () => screen.getByTestId("intro-step-info").textContent;
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

  it("opens on the welcome and the first step", () => {
    renderIntro();
    expect(screen.getByText("CIOOS Data Explorer")).toBeInTheDocument();
    expect(screen.getByText(/brings ocean data/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Filter/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(stepInfo()).toMatch(/Filters button/);
  });

  it("clicking a step shows that step's explanation", async () => {
    const { user } = renderIntro();
    await user.click(screen.getByRole("button", { name: /Select/ }));
    expect(stepInfo()).toMatch(/Draw a box or a polygon/);
    await user.click(screen.getByRole("button", { name: /Inspect/ }));
    expect(stepInfo()).toMatch(/Datasets button/);
    await user.click(screen.getByRole("button", { name: /^\d?Download/ }));
    expect(stepInfo()).toMatch(/1 GB/);
    expect(screen.getByRole("button", { name: /Select/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("the Download step opens the selection help", async () => {
    const { user } = renderIntro();
    await user.click(screen.getByRole("button", { name: /^\d?Download/ }));
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

  it("shows the French CIOOS logo link when the language is French", async () => {
    const { i18n } = renderIntro();
    await act(async () => {
      await i18n.changeLanguage("fr");
    });
    expect(document.querySelector(".introLogo.french")).toBeInTheDocument();
    expect(document.querySelector(".introLogo.english")).toBeNull();
  });

  it("closing (X) calls setShowModal(false)", async () => {
    const setShowModal = vi.fn();
    const { user } = renderIntro({ setShowModal });
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(setShowModal).toHaveBeenCalledWith(false);
  });
});
