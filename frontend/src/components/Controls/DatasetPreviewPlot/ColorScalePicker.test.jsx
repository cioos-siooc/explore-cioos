import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import ColorScalePicker from "./ColorScalePicker.jsx";
import {
  COLOR_SCALES,
  swatchStopsFor,
} from "../DatasetPreview/previewColorScales.js";

function open({ value = null, autoName = "KT_thermal" } = {}) {
  const onPick = vi.fn();
  const user = userEvent.setup({ delay: null });
  const result = renderWithProviders(
    <ColorScalePicker value={value} autoName={autoName} onPick={onPick} />,
  );
  return { user, onPick, ...result };
}

describe("ColorScalePicker", () => {
  it("shows the scale in use, which is the publisher's until one is picked", () => {
    open();
    // The cmocean prefix is the .cpt file's author, not anything to read.
    expect(screen.getByRole("button", { name: /thermal/ })).toBeInTheDocument();
    expect(screen.queryByText("KT_thermal")).not.toBeInTheDocument();
  });

  it("shows the user's pick over the publisher's once there is one", () => {
    open({ value: "Cividis" });
    expect(screen.getByRole("button", { name: /Cividis/ })).toBeInTheDocument();
  });

  it("offers every scale the catalogue allows", async () => {
    const { user } = open();
    await user.click(screen.getByRole("button", { name: /thermal/ }));
    // getAllByText: the scale in use is named in the toggle as well as the menu.
    COLOR_SCALES.forEach((name) =>
      expect(
        screen.getAllByText(name.replace(/^KT_/, "")).length,
      ).toBeGreaterThan(0),
    );
  });

  it("clears the override rather than storing the automatic scale", async () => {
    const { user, onPick } = open({ value: "Cividis" });
    await user.click(screen.getByRole("button", { name: /Cividis/ }));
    await user.click(screen.getByText(/default/i));
    expect(onPick).toHaveBeenCalledWith(null);
  });

  it("paints each chip from the stops that scale really is", async () => {
    const { user } = open();
    await user.click(screen.getByRole("button", { name: /thermal/ }));

    // The menu portals to document.body, so it is not under the render root.
    const chips = [...document.querySelectorAll(".colorScaleChip")];
    expect(chips.length).toBeGreaterThan(COLOR_SCALES.length);
    // A scale with no stops would paint an empty chip, which is the bug this
    // catches: every offered scale has to resolve to a ramp.
    COLOR_SCALES.forEach((name) =>
      expect(swatchStopsFor(name).length).toBeGreaterThan(0),
    );
  });
});
