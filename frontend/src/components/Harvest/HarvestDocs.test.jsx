import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { Routes, Route } from "react-router-dom";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import HarvestDocs from "./HarvestDocs.jsx";

const mermaidRun = vi.fn();
vi.mock("mermaid", () => ({
  default: { initialize: vi.fn(), run: (...args) => mermaidRun(...args) },
}));

function renderDocs(url) {
  return renderWithProviders(
    <Routes>
      <Route path="/harvest/docs/:doc" element={<HarvestDocs />} />
    </Routes>,
    { url },
  );
}

describe("HarvestDocs", () => {
  it("renders the requested doc with a tab per doc", async () => {
    renderDocs("/harvest/docs/obis");
    expect(
      screen.getByRole("heading", { level: 1, name: "OBIS harvest strategy" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Workflow" })).toHaveAttribute(
      "href",
      "/harvest/docs/workflow",
    );
    expect(screen.getByRole("link", { name: "OBIS" })).toHaveClass("active");
  });

  it("hands the flowchart to mermaid", async () => {
    renderDocs("/harvest/docs/workflow");
    await vi.waitFor(() => expect(mermaidRun).toHaveBeenCalled());
    const { nodes } = mermaidRun.mock.calls.at(-1)[0];
    expect(nodes[0]).toHaveClass("mermaid");
    expect(nodes[0].textContent).toMatch(/^flowchart TD/);
  });

  it("follows a cross-doc link in-app, keeping the query string", async () => {
    const { user } = renderDocs("/harvest/docs/workflow?lang=en");
    const link = screen
      .getAllByRole("link", { name: "ERDDAP" })
      .find((a) => a.dataset.route);
    await user.click(link);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "ERDDAP harvest strategy",
      }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/harvest/docs/erddap");
    expect(window.location.search).toBe("?lang=en");
  });

  it("says so for an unknown doc", () => {
    renderDocs("/harvest/docs/ckan");
    expect(screen.getByText("Document not found.")).toBeInTheDocument();
  });
});
