import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { hoverWithMouse } from "../../test/hoverWithMouse.js";
import Tooltip, { TooltipTarget } from "./Tooltip.jsx";

describe("Tooltip", () => {
  // First: once any tooltip has shown, react-aria shows the next at once for a
  // short cooldown, which would skip the delay.
  it("waits out the delay before showing", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Helpful text" delay={150}>
        <button>hover me</button>
      </Tooltip>,
    );
    await hoverWithMouse(user, screen.getByRole("button"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(await screen.findByRole("tooltip")).toBeInTheDocument();
  });

  it("renders the child unmodified, with no tooltip, when content is empty", () => {
    render(
      <Tooltip content={null}>
        <button>hover me</button>
      </Tooltip>,
    );
    expect(
      screen.getByRole("button", { name: "hover me" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows on hover, described to the trigger, and hides on leave", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Helpful text">
        <button>hover me</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: "hover me" });
    await hoverWithMouse(user, trigger);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Helpful text");
    expect(trigger).toHaveAccessibleDescription("Helpful text");

    await user.unhover(trigger);
    await waitFor(() =>
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
    );
  });

  it("shows on keyboard focus, and Escape dismisses it", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Helpful text">
        <button>focus me</button>
      </Tooltip>,
    );
    await user.tab();
    expect(await screen.findByRole("tooltip")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
    );
  });

  it("still calls the child's own event handlers", async () => {
    const user = userEvent.setup();
    const onFocus = vi.fn();
    render(
      <Tooltip content="Helpful text">
        <button onFocus={onFocus}>hover me</button>
      </Tooltip>,
    );
    await user.tab();
    expect(onFocus).toHaveBeenCalled();
  });

  it("makes plain text a focusable target", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="What the count means">
        <TooltipTarget className="count">40 datasets</TooltipTarget>
      </Tooltip>,
    );
    await user.tab();
    const target = screen.getByRole("button", { name: "40 datasets" });
    expect(target).toHaveFocus();
    expect(target).toHaveClass("tooltipTarget", "count");
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "What the count means",
    );
  });
});
