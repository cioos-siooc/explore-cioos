import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Switch from "./Switch.jsx";

describe("Switch", () => {
  it("renders a checkbox with role=switch, reflecting checked/disabled", () => {
    render(<Switch id="s1" label="Bathymetry" checked disabled={false} onChange={() => {}} />);
    const input = screen.getByRole("switch", { name: "Bathymetry" });
    expect(input).toBeChecked();
    expect(input).not.toBeDisabled();
  });

  it("calls onChange when toggled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch id="s2" label="Bathymetry" checked={false} onChange={onChange} />);
    await user.click(screen.getByRole("switch", { name: "Bathymetry" }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("does not respond when disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch id="s3" label="Bathymetry" checked={false} disabled onChange={onChange} />);
    await user.click(screen.getByRole("switch", { name: "Bathymetry" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("falls back to the title as the accessible name when there is no visible label", () => {
    render(<Switch id="s4" title="Hide trajectories" checked={false} onChange={() => {}} />);
    expect(screen.getByRole("switch", { name: "Hide trajectories" })).toBeInTheDocument();
  });

  it("applies a data-testid when given one", () => {
    render(<Switch id="s5" title="Bathymetry" checked={false} onChange={() => {}} data-testid="bathy-switch" />);
    expect(screen.getByTestId("bathy-switch")).toBeInTheDocument();
  });
});
