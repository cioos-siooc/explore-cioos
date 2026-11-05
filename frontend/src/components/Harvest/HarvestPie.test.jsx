import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import HarvestPie, {
  datasetFailures,
  reasonShades,
  serverFailures,
} from "./HarvestPie.jsx";

function renderPie(harvested, failures, props = {}) {
  return renderWithProviders(
    <HarvestPie
      harvested={harvested}
      failures={failures}
      shades={reasonShades([failures])}
      {...props}
    />,
  );
}

describe("reasonShades", () => {
  it("ranks reasons within their status across every server", () => {
    const shades = reasonShades([
      [{ status: "error", reason_code: "HTTP_ERROR", n: 2 }],
      [
        { status: "error", reason_code: "LOAD_FAILED", n: 5 },
        { status: "error", reason_code: "HTTP_ERROR", n: 1 },
        { status: "skipped", reason_code: "ON_SKIP_LIST", n: 1 },
      ],
    ]);
    expect(shades.get("error|LOAD_FAILED")).toBe(0);
    expect(shades.get("error|HTTP_ERROR")).toBe(1);
    expect(shades.get("skipped|ON_SKIP_LIST")).toBe(0);
  });
});

describe("reasonShades and disabled skips", () => {
  it("keeps ingest-disabled skips off the skip shades", () => {
    const shades = reasonShades([
      [
        { status: "skipped", reason_code: "INGEST_FLAG_FALSE", n: 9 },
        { status: "skipped", reason_code: "ON_SKIP_LIST", n: 1 },
      ],
    ]);
    expect(shades.has("skipped|INGEST_FLAG_FALSE")).toBe(false);
    expect(shades.get("skipped|ON_SKIP_LIST")).toBe(0);
  });
});

describe("serverFailures", () => {
  it("falls back to skipped/error counts for a row without reasons", () => {
    expect(serverFailures({ n_skipped: "4", n_error: "2" })).toEqual([
      { status: "skipped", reason_code: null, n: 4 },
      { status: "error", reason_code: null, n: 2 },
    ]);
  });
});

describe("datasetFailures", () => {
  it("tallies non-success dataset rows by status and reason", () => {
    expect(
      datasetFailures([
        { status: "success" },
        { status: "error", reason_code: "HTTP_ERROR" },
        { status: "error", reason_code: "HTTP_ERROR" },
        { status: "skipped", reason_code: null },
      ]),
    ).toEqual([
      { status: "error", reason_code: "HTTP_ERROR", n: 2 },
      { status: "skipped", reason_code: null, n: 1 },
    ]);
  });
});

describe("HarvestPie", () => {
  it("shows harvested first, then errors, then skips, one legend row each", () => {
    renderPie(6, [
      { status: "skipped", reason_code: "ON_SKIP_LIST", n: 2 },
      { status: "error", reason_code: "HTTP_ERROR", n: 3 },
      { status: "error", reason_code: null, n: 1 },
    ]);

    expect(
      screen.getByRole("img", {
        name: "6 of 12 datasets harvested in the last run",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((r) => r.textContent)).toEqual([
      "Harvested6 · 50%",
      "HTTP error3 · 25%",
      "Error1 · 8%",
      "On skip list2 · 17%",
    ]);
  });

  it("folds reasons past a status's shades into one Other slice", () => {
    const reasons = Array.from({ length: 5 }, (_, i) => ({
      status: "error",
      reason_code: `R${i}`,
      n: 10 - i,
    }));
    renderPie(0, reasons);

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(within(rows[3]).getByText("Other reasons")).toBeInTheDocument();
    expect(rows[3]).toHaveTextContent("13 ·");
  });

  it("reports the clicked legend row's status and reason", async () => {
    const onSelect = vi.fn();
    renderPie(3, [{ status: "error", reason_code: "HTTP_ERROR", n: 1 }], {
      onSelect,
    });

    await userEvent.click(screen.getByRole("button", { name: /HTTP error/ }));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error", reason: "HTTP_ERROR" }),
    );
  });

  it("marks the selected slice's legend row as pressed", () => {
    renderPie(3, [{ status: "error", reason_code: "HTTP_ERROR", n: 1 }], {
      onSelect: () => {},
      selected: "error|HTTP_ERROR",
    });
    expect(screen.getByRole("button", { name: /HTTP error/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /Harvested/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("greys out ingest-disabled skips and lists them last", () => {
    renderPie(1, [
      { status: "skipped", reason_code: "INGEST_FLAG_FALSE", n: 5 },
      { status: "error", reason_code: "HTTP_ERROR", n: 1 },
    ]);
    const rows = screen.getAllByRole("listitem");
    expect(rows[2]).toHaveTextContent("Ingest disabled");
    expect(rows[2]).toHaveClass("harvest-pie-disabled");
    expect(rows[1]).not.toHaveClass("harvest-pie-disabled");
  });

  it("draws nothing for a server with no attempts", () => {
    const { container } = renderPie(0, []);
    expect(container.querySelector(".harvest-pie")).toBeNull();
  });
});
