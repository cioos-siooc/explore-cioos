import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { hoverWithMouse } from "../../test/hoverWithMouse.js";
import Checkbox from "./Checkbox.jsx";

describe("Checkbox", () => {
  it("toggles from a click anywhere on its label, and from Space", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Checkbox isSelected={false} onChange={onChange} title="Pick it">
        <span>Glider</span>
      </Checkbox>,
    );
    const box = screen.getByRole("checkbox", { name: "Glider" });
    expect(box.closest("label")).toHaveAttribute("title", "Pick it");
    await user.click(screen.getByText("Glider"));
    expect(onChange).toHaveBeenLastCalledWith(true);
    box.focus();
    await user.keyboard(" ");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("opens its tooltip from a hover on the label, described to the input", async () => {
    const user = userEvent.setup();
    render(
      <Checkbox tooltip="Sea surface temperature">
        <span>SST</span>
      </Checkbox>,
    );
    await hoverWithMouse(user, screen.getByText("SST"));
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Sea surface temperature");
    expect(screen.getByRole("checkbox")).toHaveAccessibleDescription(
      "Sea surface temperature",
    );
    await user.unhover(screen.getByText("SST"));
    await waitFor(() =>
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
    );
  });

  it("opens its tooltip on keyboard focus", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>before</button>
        <Checkbox tooltip="Sea surface temperature">
          <span>SST</span>
        </Checkbox>
      </>,
    );
    await user.click(screen.getByRole("button", { name: "before" }));
    await user.tab();
    expect(screen.getByRole("checkbox")).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toBeInTheDocument();
  });
});
