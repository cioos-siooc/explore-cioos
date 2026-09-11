import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Tooltip from "./Tooltip.jsx";

describe("Tooltip", () => {
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

  it("shows the tooltip on hover, and hides it on mouse-leave", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Helpful text">
        <button>hover me</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: "hover me" });
    await user.hover(trigger);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Helpful text");

    await user.unhover(trigger);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows on focus and hides on blur, for keyboard users", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Helpful text">
        <button>focus me</button>
      </Tooltip>,
    );
    await user.tab();
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    await user.tab();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("delays showing by the given number of ms, and cancels if the pointer leaves first", () => {
    vi.useFakeTimers();
    try {
      render(
        <Tooltip content="Helpful text" delay={150}>
          <button>hover me</button>
        </Tooltip>,
      );
      const trigger = screen.getByRole("button", { name: "hover me" });

      // Fires and cancels before the delay elapses: no tooltip.
      act(() => {
        fireEvent.mouseEnter(trigger);
        fireEvent.mouseLeave(trigger);
        vi.advanceTimersByTime(150);
      });
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

      // This time it's left alone for the full delay.
      act(() => {
        fireEvent.mouseEnter(trigger);
        vi.advanceTimersByTime(150);
      });
      expect(screen.getByRole("tooltip")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("still calls the child's own event handlers", async () => {
    const user = userEvent.setup();
    const onMouseEnter = vi.fn();
    render(
      <Tooltip content="Helpful text">
        <button onMouseEnter={onMouseEnter}>hover me</button>
      </Tooltip>,
    );
    await user.hover(screen.getByRole("button", { name: "hover me" }));
    expect(onMouseEnter).toHaveBeenCalled();
  });
});
