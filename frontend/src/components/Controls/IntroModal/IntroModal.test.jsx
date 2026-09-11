import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";

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

  it("closing (X) calls setShowModal(false)", async () => {
    const setShowModal = vi.fn();
    const { user } = renderWithProviders(
      <IntroModal showModal setShowModal={setShowModal} />,
    );
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(setShowModal).toHaveBeenCalledWith(false);
  });
});
