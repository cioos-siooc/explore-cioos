import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import TaxonomyChart from "./TaxonomyChart.jsx";

vi.mock("./TaxonomySunburst.jsx", () => ({
  default: ({ tree }) => <div data-testid="sunburst">{tree.total}</div>,
}));

const CHECKLIST = {
  total: 2,
  results: [
    {
      kingdom: "Animalia",
      phylum: "Chordata",
      class: "Teleostei",
      records: 5,
    },
    { kingdom: "Animalia", phylum: "Mollusca", records: 2 },
  ],
};

let obisResponses;

beforeEach(() => {
  installMockFetch();
  const apiFetch = globalThis.fetch;
  obisResponses = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) =>
      String(input).startsWith("https://api.obis.org/")
        ? Promise.resolve(obisResponses.shift() ?? json(CHECKLIST))
        : apiFetch(input, init),
    ),
  );
});

function json(body) {
  return new Response(JSON.stringify(body));
}

function params() {
  return new URL(window.location.href).searchParams;
}

describe("TaxonomyChart", () => {
  it("opens on the sunburst of the dataset's checklist", async () => {
    renderWithProviders(<TaxonomyChart datasetId="abc" />, {
      providers: "app",
    });
    expect(await screen.findByTestId("sunburst")).toHaveTextContent("7");
    expect(screen.getByRole("button", { name: "Sunburst" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("switches to the tree, and records the choice in the link", async () => {
    const { user } = renderWithProviders(<TaxonomyChart datasetId="abc" />, {
      providers: "app",
    });
    await screen.findByTestId("sunburst");

    await user.click(screen.getByRole("button", { name: "Tree" }));

    expect(screen.queryByTestId("sunburst")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Animalia" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await waitFor(() => expect(params().get("taxonomy")).toBe("tree"));
  });

  it("opens and closes a branch of the tree from its name", async () => {
    const { user } = renderWithProviders(<TaxonomyChart datasetId="abc" />, {
      providers: "app",
      url: "/?taxonomy=tree",
    });
    const chordata = await screen.findByRole("button", { name: "Chordata" });
    expect(screen.queryByText("Teleostei")).not.toBeInTheDocument();

    await user.click(chordata);
    expect(screen.getByText("Teleostei")).toBeInTheDocument();

    await user.click(chordata);
    expect(screen.queryByText("Teleostei")).not.toBeInTheDocument();
  });

  it("offers a retry when OBIS fails", async () => {
    obisResponses.push(new Response("", { status: 503 }));
    const { user } = renderWithProviders(<TaxonomyChart datasetId="abc" />, {
      providers: "app",
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be loaded",
    );

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByTestId("sunburst")).toBeInTheDocument();
  });
});
