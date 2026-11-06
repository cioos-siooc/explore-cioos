import * as React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, act, within } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  setViewportWidth,
} from "../../../test/viewport.js";
import FeatureCard from "./FeatureCard.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import pointQueryFixture from "../../../../e2e/fixtures/api/pointQuery.json";

let latestMap;
let latestSelection;
let latestUI;
function Probe() {
  latestMap = useMapState();
  latestSelection = useSelection();
  latestUI = useUI();
  const { initialPointsQueryComplete } = latestSelection;
  return (
    <span data-testid="state">
      {initialPointsQueryComplete ? "ready" : "loading"}
    </span>
  );
}

async function renderReady(width = MOBILE_WIDTH) {
  // FeatureCard waits out the datasets sidebar where it can't stand beside it
  // (see the component's own comment), so the default is the phone-width
  // "sidebar starts closed" case, which exercises the card on its own.
  setViewportWidth(width);
  const result = renderWithProviders(
    <>
      <FeatureCard />
      <Probe />
    </>,
    { providers: "app" },
  );
  await waitFor(() =>
    expect(screen.getByTestId("state")).toHaveTextContent("ready"),
  );
  return result;
}

// What hitTest's buildFeatureQuery derives from the items; the card lists the
// results' rows for these pks, as the datasets list pins them.
const click = (query) =>
  act(() => {
    latestMap.setFeatureQuery({
      lngLat: [0, 0],
      datasetPks: [...new Set((query.items || []).map((item) => item.pk))],
      ...query,
    });
  });

const cardRows = () => [
  ...document.querySelectorAll(
    '[data-testid="feature-card"] [data-testid="dataset-card"]',
  ),
];

const cardFor = (row) =>
  cardRows().find((card) => card.dataset.datasetPk === String(row.pk));

describe("FeatureCard", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("renders nothing without a featureQuery", async () => {
    await renderReady();
    expect(screen.queryByTestId("feature-card")).not.toBeInTheDocument();
  });

  it("shows the empty state when nothing under the click resolves against pointsData", async () => {
    await renderReady();
    click({
      nonce: 1,
      items: [{ kind: "observation", pk: 999999, count: 3 }],
    });
    expect(
      screen.getByText(
        "Nothing here is in the current results because the filters have excluded it.",
      ),
    ).toBeInTheDocument();
  });

  it("is never open at the same time as the datasets sidebar", async () => {
    await renderReady(DESKTOP_WIDTH);
    act(() => latestUI.setSidebarOpen(true));
    act(() => latestMap.setFeatureQuery({ nonce: 1, lngLat: [0, 0] }));
    expect(screen.getByTestId("feature-card")).not.toHaveClass("open");
    act(() => latestUI.setSidebarOpen(false));
    expect(screen.getByTestId("feature-card")).toHaveClass("open");
  });

  it("stays shut while a dataset is open, even with the sidebar closed", async () => {
    await renderReady();
    act(() => latestMap.setFeatureQuery({ nonce: 1, lngLat: [0, 0] }));
    act(() => latestSelection.setInspectDataset(pointQueryFixture[0]));
    act(() => latestUI.setSidebarOpen(false));
    await waitFor(() =>
      expect(screen.getByTestId("feature-card")).not.toHaveClass("open"),
    );
    act(() => latestSelection.returnToDatasetList());
    await waitFor(() =>
      expect(screen.getByTestId("feature-card")).toHaveClass("open"),
    );
  });

  it("resolves an observation row against pointsData and shows its title", async () => {
    await renderReady();
    const row = pointQueryFixture[0];
    click({
      nonce: 2,
      items: [{ kind: "observation", pk: row.pk, count: 4, title: row.title }],
    });
    expect(screen.getByTitle(row.title)).toBeInTheDocument();
  });

  it("gives a row the same second row as the datasets list's card", async () => {
    await renderReady();
    const row = pointQueryFixture[0];
    click({
      nonce: 13,
      items: [{ kind: "observation", pk: row.pk, count: 4, title: row.title }],
    });
    const meta = cardFor(row).querySelector(".datasetCardMeta");
    expect(meta).toHaveTextContent("Time series profile");
    expect(meta).toHaveTextContent(String(row.profiles_count));
  });

  it("closing (X) clears the featureQuery", async () => {
    const { user } = await renderReady();
    const row = pointQueryFixture[0];
    click({
      nonce: 3,
      items: [{ kind: "observation", pk: row.pk, count: 1, title: row.title }],
    });
    await user.click(screen.getByTitle("Close"));
    expect(latestMap.featureQuery).toBeNull();
  });

  it("Escape closes the card", async () => {
    const { user } = await renderReady();
    const row = pointQueryFixture[0];
    click({
      nonce: 4,
      items: [{ kind: "observation", pk: row.pk, count: 1, title: row.title }],
    });
    await user.keyboard("{Escape}");
    expect(latestMap.featureQuery).toBeNull();
  });

  it("toggles a dataset in and out of the selection, like the list, without closing the card", async () => {
    const { user } = await renderReady();
    const row =
      pointQueryFixture.find((r) => !r.selected) || pointQueryFixture[0];
    click({
      nonce: 5,
      items: [{ kind: "observation", pk: row.pk, count: 1, title: row.title }],
    });
    const toggle = screen.getByRole("checkbox", {
      name: new RegExp(`: ${RegExp.escape(row.title)}$`),
    });
    await user.click(toggle);
    await waitFor(() =>
      expect(latestSelection.selectedPks.has(row.pk)).toBe(true),
    );
    expect(latestMap.featureQuery).not.toBeNull();
    await user.click(toggle);
    await waitFor(() =>
      expect(latestSelection.selectedPks.has(row.pk)).toBe(false),
    );
  });

  it("opening a dataset with one track under the click selects that track and closes the card", async () => {
    const { user } = await renderReady();
    const row = pointQueryFixture[0];
    click({
      nonce: 6,
      items: [{ kind: "track", pk: row.pk, trajectoryId: "traj-a" }],
    });
    expect(cardRows()[0]).toHaveTextContent("traj-a");
    await user.click(screen.getByRole("button", { name: row.title }));
    await waitFor(() =>
      expect(latestSelection.selectedTrajectory).toMatchObject({
        datasetPk: row.pk,
        trajectoryId: "traj-a",
      }),
    );
    expect(latestMap.featureQuery).toBeNull();
  });

  it("opening a dataset with several tracks under the click opens its page", async () => {
    const { user } = await renderReady();
    const row = pointQueryFixture[0];
    click({
      nonce: 7,
      items: ["traj-a", "traj-b"].map((trajectoryId) => ({
        kind: "track",
        pk: row.pk,
        trajectoryId,
      })),
    });
    expect(cardRows()).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: row.title }));
    await waitFor(() =>
      expect(latestSelection.inspectDataset?.pk).toBe(row.pk),
    );
    expect(latestSelection.selectedTrajectory).toBeFalsy();
  });

  it("drops what the click found outside the current results, as the list does", async () => {
    await renderReady();
    const row = pointQueryFixture[0];
    click({
      nonce: 8,
      items: [
        { kind: "observation", pk: row.pk },
        { kind: "track", pk: 111, trajectoryId: "t1", title: "A track" },
        { kind: "grid", pk: 222, title: "A gridded dataset" },
      ],
    });
    expect(cardRows()).toHaveLength(1);
    expect(cardRows()[0]).toHaveTextContent(row.title);
  });

  it("shows a Show more button past the visible-row cap, and expands the list", async () => {
    const { user } = await renderReady();
    const rows = pointQueryFixture.slice(0, 7);
    click({
      nonce: 9,
      items: rows.map((row) => ({
        kind: "observation",
        pk: row.pk,
        count: 1,
        title: row.title,
      })),
    });
    const moreButton = await screen.findByText("Show 2 more");
    expect(cardRows()).toHaveLength(5);
    await user.click(moreButton);
    await waitFor(() => expect(cardRows()).toHaveLength(7));
  });

  it("lists the rows in the datasets list's order, following its sort", async () => {
    await renderReady();
    const rows = pointQueryFixture.slice(0, 6);
    click({
      nonce: 10,
      items: [...rows]
        .reverse()
        .map((row) => ({ kind: "observation", pk: row.pk })),
    });
    const byTitle = [...rows]
      .sort((a, b) => a.title.localeCompare(b.title, "en"))
      .slice(0, 5)
      .map((row) => String(row.pk));
    expect(cardRows().map((card) => card.dataset.datasetPk)).toEqual(byTitle);

    act(() => latestSelection.setListSort({ field: "days", dir: "desc" }));
    const byDays = [...rows]
      .sort((a, b) => Number(b.days) - Number(a.days))
      .slice(0, 5)
      .map((row) => String(row.pk));
    expect(cardRows().map((card) => card.dataset.datasetPk)).toEqual(byDays);
  });

  it("follows the datasets list's density, with no toggle of its own", async () => {
    window.localStorage.setItem("cde.listDensity", '"compact"');
    await renderReady();
    const row = pointQueryFixture[0];
    click({ nonce: 14, items: [{ kind: "observation", pk: row.pk }] });
    const list = document.querySelector(".featureCardList");
    expect(list).toHaveClass("compact");
    expect(
      screen.queryByTestId("datasets-density-toggle"),
    ).not.toBeInTheDocument();
    act(() => latestUI.setListDensity("full"));
    expect(list).not.toHaveClass("compact");
  });

  // The tile carries one `count` for the whole cell; each dataset needs its
  // own.
  it("gives each dataset in a cell its own day count, not the cell's total", async () => {
    await renderReady();
    const [a, b, c] = pointQueryFixture;
    click({
      nonce: 11,
      // No `count` on the items: the cell total is deliberately not the
      // per-dataset figure, so it is not carried here at all.
      items: [a, b, c].map((row) => ({
        kind: "observation",
        pk: row.pk,
        aggregate: true,
        title: row.title,
      })),
      observationCount: 1121,
      buckets: { hexPks: [970], pointPks: [], source: "main", z: 6 },
    });

    // Fixture: pk 7 -> 1115, pk 8 -> 5, pk 9 -> 1.
    await waitFor(() =>
      expect(cardFor(a)).toHaveTextContent("1,115 days of data"),
    );
    expect(cardFor(b)).toHaveTextContent("5 days of data");
    expect(cardFor(c)).toHaveTextContent("1 day of data");
  });

  // A coverage hex at marker zoom lists the stations inside it too. Those are
  // profiles, which /tiles/datasets only has under source=main, so the hex and
  // its markers are asked of their own sources and the answers merged.
  it("asks a coverage hex's markers of the main source and the hex of cells", async () => {
    await renderReady();
    const hexFetch = globalThis.fetch;
    globalThis.fetch = vi.fn((input, init) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      if (url.pathname.endsWith("/tiles/datasets")) {
        const rows =
          url.searchParams.get("source") === "cells"
            ? [{ pk: 7, count: 30 }]
            : [{ pk: 10, count: 4 }];
        return Promise.resolve(Response.json(rows));
      }
      return hexFetch(input, init);
    });
    const hexRow = pointQueryFixture[0];
    const markerRow = pointQueryFixture[3];
    click({
      nonce: 13,
      items: [
        { kind: "observation", pk: hexRow.pk, aggregate: true },
        { kind: "observation", pk: markerRow.pk, aggregate: false },
      ],
      buckets: { hexPks: [5], pointPks: [42], source: "cells", z: 9 },
    });

    await waitFor(() =>
      expect(cardFor(markerRow)).toHaveTextContent("4 days of data"),
    );
    expect(cardFor(hexRow)).toHaveTextContent("30 days of data");
    const asked = globalThis.fetch.mock.calls
      .map(([input]) => new URL(input).searchParams)
      .filter((params) => params.has("source"));
    expect(asked.map((params) => params.toString())).toEqual([
      expect.stringMatching(/source=cells&hexes=5$/),
      expect.stringMatching(/source=main&points=42$/),
    ]);
  });

  it("shows no day count for a dataset the breakdown has not answered for", async () => {
    await renderReady();
    const row = pointQueryFixture[0];
    click({
      nonce: 12,
      items: [{ kind: "observation", pk: row.pk, title: row.title }],
      // No buckets: nothing to ask about, so no figure is claimed.
      buckets: { hexPks: [], pointPks: [], source: "main", z: 6 },
    });
    expect(cardFor(row)).not.toHaveTextContent(/days? of data/);
  });

  describe("tips", () => {
    const seenTips = () =>
      JSON.parse(window.localStorage.getItem("cde.seenTips") || "[]");
    const openOn = (row) =>
      click({
        nonce: 3,
        items: [{ kind: "observation", pk: row.pk, title: row.title }],
      });

    beforeEach(() => {
      window.localStorage.setItem("cde.introSeen", "true");
    });

    it("offers the what's here tip for a cell of stations", async () => {
      await renderReady();
      openOn(pointQueryFixture[0]);
      await waitFor(() => expect(seenTips()).toEqual(["whatsHere"]));
    });

    it("offers species search first when the cell holds OBIS records", async () => {
      // The recorded catalogue has no OBIS dataset; mark one as such.
      const fixtureFetch = globalThis.fetch;
      vi.stubGlobal("fetch", async (input) => {
        const response = await fixtureFetch(input);
        const url = typeof input === "string" ? input : input.url;
        if (!url.includes("pointQuery")) return response;
        const rows = await response.json();
        rows[0] = { ...rows[0], source_type: "obis" };
        return new Response(JSON.stringify(rows), {
          headers: { "content-type": "application/json" },
        });
      });
      await renderReady();
      openOn(pointQueryFixture[0]);
      await waitFor(() => expect(seenTips()).toEqual(["speciesName"]));
    });
  });
});

describe("FeatureCard with grids under the click", () => {
  const GRID_ROW = {
    ...pointQueryFixture[0],
    pk: 99001,
    dataset_id: "sst_grid",
    title: "SST grid",
    title_translated: { en: "SST grid", fr: "SST grid" },
    cdm_data_type: "Grid",
    grid_dimensions: [],
  };
  beforeEach(() => {
    installMockFetch();
    const mocked = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) => {
        const url = typeof input === "string" ? input : input.url;
        if (!url.includes("/pointQuery")) return mocked(input);
        const response = await mocked(input);
        const rows = await response.json();
        return new Response(JSON.stringify([...rows, GRID_ROW]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
  });

  it("folds them into one row ahead of the stations, opened on demand", async () => {
    await renderReady();
    await waitFor(() =>
      expect(
        latestSelection.filteredDatasets.some((row) => row.pk === GRID_ROW.pk),
      ).toBe(true),
    );
    const station = pointQueryFixture[0];
    click({
      items: [
        { kind: "observation", pk: station.pk },
        { kind: "grid", pk: GRID_ROW.pk, title: "SST grid" },
      ],
    });
    const header = await screen.findByTestId("grid-group-header");
    expect(header).toHaveTextContent("1");
    expect(cardRows()).toHaveLength(1);

    await userEvent.click(within(header).getByRole("button"));
    expect(cardRows()[0]).toHaveTextContent("SST grid");
    expect(cardRows()).toHaveLength(2);
  });
});
