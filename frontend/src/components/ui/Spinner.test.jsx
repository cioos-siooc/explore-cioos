import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import Spinner from "./Spinner.jsx";

describe("Spinner", () => {
  it("defaults to role=status and size md", () => {
    render(<Spinner />);
    const el = screen.getByRole("status");
    expect(el).toHaveClass("cioosSpinner", "cioosSpinner-md");
  });

  it("accepts a role override (e.g. presentation, for a row that already speaks)", () => {
    render(<Spinner role="presentation" />);
    expect(screen.getByRole("presentation")).toBeInTheDocument();
  });

  it("renders the simplified three-dot mark at xs/sm sizes", () => {
    const { container } = render(<Spinner size="xs" />);
    expect(container.querySelectorAll(".cioosSpinnerNode")).toHaveLength(3);
  });

  it("renders the full mesh mark at every other size", () => {
    const { container } = render(<Spinner size="lg" />);
    expect(container.querySelector(".cioosSpinnerMesh")).toBeTruthy();
    expect(container.querySelectorAll(".cioosSpinnerNode")).toHaveLength(5);
  });
});
