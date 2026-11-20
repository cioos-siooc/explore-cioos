import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  Dropdown,
  DropdownButton,
  Menu,
  MenuButton,
  MenuItem,
  MenuTrigger,
  PopoverButton,
} from "./Dropdown.jsx";

const renderSort = (props = {}) =>
  render(
    <DropdownButton title="Sort" data-testid="sort" {...props}>
      <Dropdown.Item id="az">A-Z</Dropdown.Item>
      <Dropdown.Item id="za">Z-A</Dropdown.Item>
    </DropdownButton>,
  );

describe("DropdownButton / Dropdown.Item", () => {
  it("renders the toggle closed, with the menu absent", () => {
    renderSort();
    const toggle = screen.getByRole("button", { name: "Sort" });
    expect(toggle).toHaveAttribute("aria-haspopup", "true");
    expect(toggle).not.toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens a menu of items on toggle click", async () => {
    const user = userEvent.setup();
    renderSort();
    await user.click(screen.getByRole("button", { name: "Sort" }));
    expect(screen.getByTestId("sort-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual(
      ["A-Z", "Z-A"],
    );
  });

  it("walks the items with the arrow keys and closes on Escape, back on the toggle", async () => {
    const user = userEvent.setup();
    renderSort();
    screen.getByRole("button", { name: "Sort" }).focus();
    await user.keyboard("{Enter}");
    const [first, second] = screen.getAllByRole("menuitem");
    expect(first).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(second).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    // react-aria restores focus on the next frame.
    await waitFor(() =>
      expect(screen.getByTestId("sort-toggle")).toHaveFocus(),
    );
  });

  it("closes the menu on an outside click", async () => {
    const user = userEvent.setup();
    renderSort();
    await user.click(screen.getByRole("button", { name: "Sort" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await user.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("an item's action fires and closes the menu", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <DropdownButton title="Sort">
        <Dropdown.Item onAction={onAction}>A-Z</Dropdown.Item>
      </DropdownButton>,
    );
    await user.click(screen.getByRole("button", { name: "Sort" }));
    await user.click(screen.getByRole("menuitem", { name: "A-Z" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("reports open/close through onOpenChange", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderSort({ onOpenChange });
    await user.click(screen.getByTestId("sort-toggle"));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("checks the selected item", async () => {
    const user = userEvent.setup();
    renderSort({ selectedKey: "az" });
    await user.click(screen.getByTestId("sort-toggle"));
    expect(screen.getByRole("menuitemradio", { name: "A-Z" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: "Z-A" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("floors the menu at the toggle's width unless menuClassName sizes it", async () => {
    const user = userEvent.setup();
    const { unmount } = renderSort();
    await user.click(screen.getByTestId("sort-toggle"));
    expect(
      document
        .querySelector(".dropdown-menu")
        .style.getPropertyValue("min-width"),
    ).toBe("var(--trigger-width)");
    unmount();

    renderSort({ menuClassName: "wideMenu" });
    await user.click(screen.getByTestId("sort-toggle"));
    const menu = document.querySelector(".dropdown-menu");
    expect(menu).toHaveClass("wideMenu");
    expect(menu.style.getPropertyValue("min-width")).toBe("");
  });

  it("puts the tooltip on hover and an icon toggle's name on aria-label", () => {
    render(
      <DropdownButton title={<span />} tooltip="Colour" aria-label="Colour">
        <Dropdown.Item>Red</Dropdown.Item>
      </DropdownButton>,
    );
    expect(screen.getByRole("button", { name: "Colour" })).toBeInTheDocument();
    expect(document.querySelector(".dropdown")).toHaveAttribute(
      "title",
      "Colour",
    );
  });
});

describe("PopoverButton", () => {
  it("holds content a menu can't, and closes from inside", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(
      <PopoverButton title="Colour">
        {({ close }) => (
          <>
            <Dropdown.Option
              isSelected
              onChange={() => {
                onPick("red");
                close();
              }}
            >
              Red
            </Dropdown.Option>
            <input aria-label="Custom" />
          </>
        )}
      </PopoverButton>,
    );
    await user.click(screen.getByRole("button", { name: "Colour" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Custom" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Red" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Red" }));
    expect(onPick).toHaveBeenCalledWith("red");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("MenuTrigger (nonModal)", () => {
  function Area({ onOpenChange }) {
    const [open, setOpen] = React.useState(false);
    return (
      <>
        <MenuTrigger
          isOpen={open}
          nonModal
          onOpenChange={(next, reason) => {
            setOpen(next);
            onOpenChange(next, reason);
          }}
        >
          <MenuButton>Area</MenuButton>
          <Menu>
            <MenuItem id="box">Box</MenuItem>
          </Menu>
        </MenuTrigger>
        <button>map</button>
      </>
    );
  }

  it("leaves the page usable and tells an outside close apart", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onMap = vi.fn();
    render(<Area onOpenChange={onOpenChange} />);
    screen.getByRole("button", { name: "map" }).onclick = onMap;

    await user.click(screen.getByRole("button", { name: "Area" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "map" }));

    expect(onMap).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onOpenChange).toHaveBeenLastCalledWith(false, "outside");
  });

  it("hands focus back to the trigger after a pick", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Area onOpenChange={onOpenChange} />);
    await user.click(screen.getByRole("button", { name: "Area" }));
    await user.click(screen.getByRole("menuitem", { name: "Box" }));

    expect(screen.getByRole("button", { name: "Area" })).toHaveFocus();
    expect(onOpenChange).toHaveBeenLastCalledWith(false, undefined);
  });
});
