import * as React from "react";
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import HarvestLayout from "./HarvestLayout.jsx";

describe("HarvestLayout", () => {
  it("renders the back link, title and children", () => {
    renderWithProviders(
      <HarvestLayout>
        <p>page content</p>
      </HarvestLayout>,
    );
    expect(screen.getByText("← Data Explorer")).toHaveAttribute("href", "/");
    expect(screen.getByText("Harvest Status")).toBeInTheDocument();
    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  it("renders breadcrumbs when given", () => {
    renderWithProviders(
      <HarvestLayout breadcrumbs={<span>a / b</span>}>x</HarvestLayout>,
    );
    expect(screen.getByText("a / b")).toBeInTheDocument();
  });

  it("omits the breadcrumb nav entirely when none are given", () => {
    renderWithProviders(<HarvestLayout>x</HarvestLayout>);
    expect(
      document.querySelector(".harvest-breadcrumb"),
    ).not.toBeInTheDocument();
  });

  it("the language toggle switches the ?lang= param and shows the other language", async () => {
    const { user } = renderWithProviders(<HarvestLayout>x</HarvestLayout>, {
      url: "/harvest",
    });
    const toggle = screen.getByRole("button", { name: "FR" });
    await user.click(toggle);
    expect(new URL(window.location.href).searchParams.get("lang")).toBe("fr");
  });
});
