import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import VariableColorPicker from "./VariableColorPicker.jsx";
import { SWATCHES } from "../DatasetPreview/previewColors.js";

// The debounce is the point. React's onChange on <input type="color"> is the DOM
// `input` event, which fires on every pointer move inside the OS dialog — each
// one would rewrite the query string and re-plot every panel.
const DEFAULT_COLOR = "#1f77b4";

function open({ color = null, onPick = vi.fn() } = {}) {
  const user = userEvent.setup({ delay: null });
  renderWithProviders(
    <VariableColorPicker
      color={color}
      defaultColor={DEFAULT_COLOR}
      onPick={onPick}
      label="Color: temperature"
    />,
  );
  return { user, onPick };
}

describe("VariableColorPicker", () => {
  describe("picking a preset", () => {
    it("commits the swatch immediately", async () => {
      const { user, onPick } = open();
      await user.click(
        screen.getByRole("button", { name: "Color: temperature" }),
      );
      await user.click(screen.getByRole("button", { name: SWATCHES[2] }));
      expect(onPick).toHaveBeenCalledWith(SWATCHES[2]);
    });

    it("clears the override rather than storing the default colour", async () => {
      const { user, onPick } = open({ color: SWATCHES[0] });
      await user.click(
        screen.getByRole("button", { name: "Color: temperature" }),
      );
      await user.click(screen.getByText(/default/i));
      // null, not DEFAULT_COLOR: dropping the entry is what deletes it from the
      // link, so "back to what the dataset says" leaves no trace.
      expect(onPick).toHaveBeenCalledWith(null);
    });
  });

  describe("dragging in the native field", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("does not commit while the pointer is still moving", async () => {
      const { onPick } = open();
      fireEvent.click(
        screen.getByRole("button", { name: "Color: temperature" }),
      );
      const field = screen.getByLabelText(/custom/i);

      ["#111111", "#222222", "#333333"].forEach((hex) =>
        fireEvent.change(field, { target: { value: hex } }),
      );

      expect(onPick).not.toHaveBeenCalled();
    });

    it("commits once the pointer has been still", async () => {
      const { onPick } = open();
      fireEvent.click(
        screen.getByRole("button", { name: "Color: temperature" }),
      );
      const field = screen.getByLabelText(/custom/i);

      fireEvent.change(field, { target: { value: "#111111" } });
      fireEvent.change(field, { target: { value: "#abcdef" } });
      await vi.advanceTimersByTimeAsync(300);

      // Once, and with the colour it came to rest on.
      await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
      expect(onPick).toHaveBeenCalledWith("#abcdef");
    });
  });
});
