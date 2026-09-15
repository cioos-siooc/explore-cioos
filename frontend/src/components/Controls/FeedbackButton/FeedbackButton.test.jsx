import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import FeedbackButton from "./FeedbackButton.jsx";

const { getFeedback } = vi.hoisted(() => ({ getFeedback: vi.fn() }));
vi.mock("@sentry/react", () => ({ getFeedback }));

beforeEach(() => {
  getFeedback.mockReset();
});

describe("FeedbackButton", () => {
  it("renders with the feedback title as its accessible name", () => {
    renderWithProviders(<FeedbackButton />);
    expect(
      screen.getByRole("button", {
        name: "Please provide feedback on your experience using CIOOS Data Explorer",
      }),
    ).toBeInTheDocument();
  });

  it("does nothing when Sentry never initialised (getFeedback returns undefined)", async () => {
    getFeedback.mockReturnValue(undefined);
    const { user } = renderWithProviders(<FeedbackButton />);
    await user.click(screen.getByRole("button"));
    expect(getFeedback).toHaveBeenCalled();
  });

  it("builds and opens the Sentry feedback form, translating every label", async () => {
    const form = {
      removeFromDom: vi.fn(),
      appendToDom: vi.fn(),
      open: vi.fn(),
    };
    const createForm = vi.fn().mockResolvedValue(form);
    getFeedback.mockReturnValue({ createForm });

    const { user } = renderWithProviders(<FeedbackButton />);
    await user.click(screen.getByRole("button"));

    expect(createForm).toHaveBeenCalledWith(
      expect.objectContaining({
        formTitle: "Send us feedback",
        messageLabel: "Your feedback",
        onFormClose: expect.any(Function),
        onFormSubmitted: expect.any(Function),
      }),
    );
    expect(form.appendToDom).toHaveBeenCalled();
    expect(form.open).toHaveBeenCalled();

    // Both the "closed without submitting" and "submitted" callbacks tear the
    // form back out of the DOM.
    const { onFormClose, onFormSubmitted } = createForm.mock.calls[0][0];
    onFormClose();
    onFormSubmitted();
    expect(form.removeFromDom).toHaveBeenCalledTimes(2);
  });

  it("passes className and size through to the button and icon", () => {
    renderWithProviders(
      <FeedbackButton className="feedbackButton" size={30} />,
    );
    const button = screen.getByRole("button");
    expect(button).toHaveClass("feedbackButton");
    expect(button.querySelector("svg")).toHaveAttribute("width", "30");
  });
});
