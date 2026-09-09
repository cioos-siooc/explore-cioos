import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DropdownButton, Dropdown } from "./Dropdown.jsx";

describe("DropdownButton / Dropdown.Item", () => {
  it("renders the toggle closed, with the menu absent", () => {
    render(
      <DropdownButton title="Sort">
        <Dropdown.Item>A-Z</Dropdown.Item>
      </DropdownButton>,
    );
    expect(screen.getByRole("button", { name: "Sort" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText("A-Z")).not.toBeInTheDocument();
  });

  it("opens the menu on toggle click, closes it on a second click", async () => {
    const user = userEvent.setup();
    render(
      <DropdownButton title="Sort">
        <Dropdown.Item>A-Z</Dropdown.Item>
      </DropdownButton>,
    );
    const toggle = screen.getByRole("button", { name: "Sort" });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("A-Z")).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("A-Z")).not.toBeInTheDocument();
  });

  it("closes the menu on an outside click", async () => {
    const user = userEvent.setup();
    render(
      <>
        <DropdownButton title="Sort">
          <Dropdown.Item>A-Z</Dropdown.Item>
        </DropdownButton>
        <button>elsewhere</button>
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Sort" }));
    expect(screen.getByText("A-Z")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(screen.queryByText("A-Z")).not.toBeInTheDocument();
  });

  it("an item click fires onClick and closes the menu", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <DropdownButton title="Sort">
        <Dropdown.Item onClick={onClick}>A-Z</Dropdown.Item>
      </DropdownButton>,
    );
    await user.click(screen.getByRole("button", { name: "Sort" }));
    await user.click(screen.getByText("A-Z"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("A-Z")).not.toBeInTheDocument();
  });

  it("reports open/close through onOpenChange", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <DropdownButton title="Sort" onOpenChange={onOpenChange}>
        <Dropdown.Item>A-Z</Dropdown.Item>
      </DropdownButton>,
    );
    await user.click(screen.getByRole("button", { name: "Sort" }));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole("button", { name: "Sort" }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("marks the active item", async () => {
    const user = userEvent.setup();
    render(
      <DropdownButton title="Sort">
        <Dropdown.Item active>A-Z</Dropdown.Item>
        <Dropdown.Item>Z-A</Dropdown.Item>
      </DropdownButton>,
    );
    await user.click(screen.getByRole("button", { name: "Sort" }));
    expect(screen.getByText("A-Z")).toHaveClass("active");
    expect(screen.getByText("Z-A")).not.toHaveClass("active");
  });
});
