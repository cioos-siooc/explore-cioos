import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { act, screen } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import IntroModal from "./IntroModal.jsx";

// FeedbackButton calls Sentry.getFeedback() on click, which is undefined
// outside a real Sentry init — mock it out so the button renders inert.
vi.mock("@sentry/react", () => ({ getFeedback: () => undefined }));

describe("IntroModal", () => {
  it("renders nothing (Modal unmounts its body) when show is false", () => {
    renderWithProviders(
      <IntroModal showModal={false} setShowModal={() => {}} />,
    );
    expect(screen.queryByText("CIOOS Data Explorer")).not.toBeInTheDocument();
  });

  it("shows the welcome message by default when open", () => {
    renderWithProviders(<IntroModal showModal setShowModal={() => {}} />);
    expect(screen.getByText("CIOOS Data Explorer")).toBeInTheDocument();
    expect(
      screen.getByText(/Welcome to the CIOOS Data Explorer/),
    ).toBeInTheDocument();
  });

  it("hovering a step shows that step's info instead of the welcome message", async () => {
    const { user } = renderWithProviders(
      <IntroModal showModal setShowModal={() => {}} />,
    );
    await user.hover(screen.getByText("Filter", { selector: ".stepImage" }));
    expect(
      screen.getAllByText("Filter").some((el) => el.closest(".stepInfo")),
    ).toBe(true);
    expect(
      screen.queryByText(/Welcome to the CIOOS Data Explorer/),
    ).not.toBeInTheDocument();
  });

  it("hovering the select step shows the selection-tools info", async () => {
    const { user } = renderWithProviders(
      <IntroModal showModal setShowModal={() => {}} />,
    );
    await user.hover(screen.getByText("Select", { selector: ".stepImage" }));
    expect(
      screen.getAllByText("Select").some((el) => el.closest(".stepInfo")),
    ).toBe(true);
  });

  it("hovering the inspect step shows the inspect info", async () => {
    const { user } = renderWithProviders(
      <IntroModal showModal setShowModal={() => {}} />,
    );
    await user.hover(screen.getByText("Inspect", { selector: ".stepImage" }));
    expect(
      screen.getAllByText("Inspect").some((el) => el.closest(".stepInfo")),
    ).toBe(true);
  });

  it("hovering the download step shows the download info", async () => {
    const { user } = renderWithProviders(
      <IntroModal showModal setShowModal={() => {}} />,
    );
    await user.hover(screen.getByText("Download", { selector: ".stepImage" }));
    expect(
      screen.getAllByText("Download").some((el) => el.closest(".stepInfo")),
    ).toBe(true);
  });

  it("moving off the steps reverts back to the welcome message", async () => {
    const { user } = renderWithProviders(
      <IntroModal showModal setShowModal={() => {}} />,
    );
    await user.hover(screen.getByText("Filter", { selector: ".stepImage" }));
    expect(
      screen.queryByText(/Welcome to the CIOOS Data Explorer/),
    ).not.toBeInTheDocument();

    await user.unhover(screen.getByText("Filter", { selector: ".stepImage" }));
    expect(
      screen.getByText(/Welcome to the CIOOS Data Explorer/),
    ).toBeInTheDocument();
  });

  it("shows the French CIOOS logo link when the language is French", async () => {
    // providers: "none" doesn't mount UrlSync, so a ?lang= in the URL alone
    // doesn't drive i18n — flip the returned instance's language directly,
    // same as IntroModal reads it (i18n.language), and let the component
    // re-render off that.
    const { i18n } = renderWithProviders(
      <IntroModal showModal setShowModal={() => {}} />,
    );
    await act(async () => {
      await i18n.changeLanguage("fr");
    });
    expect(document.querySelector(".introLogo.french")).toBeInTheDocument();
    expect(document.querySelector(".introLogo.english")).toBeNull();
  });

  it("closing (X) calls setShowModal(false)", async () => {
    const setShowModal = vi.fn();
    const { user } = renderWithProviders(
      <IntroModal showModal setShowModal={setShowModal} />,
    );
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(setShowModal).toHaveBeenCalledWith(false);
  });
});
