import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../test/mockFetch.js";
import { useSelection } from "./SelectionProvider.jsx";
import { useMapState } from "../map/MapStateProvider.jsx";
import { erddapServerSlug } from "../../utilities.jsx";
import pointQueryFixture from "../../../e2e/fixtures/api/pointQuery.json";

let latest;
// The map side of the same render, so the suite can assert that a narrowing
// made here actually reaches the queries the map draws from.
let latestMapState;

function Probe() {
  latest = useSelection();
  latestMapState = useMapState();
  return (
    <span data-testid="state">
      {latest.initialPointsQueryComplete ? "loaded" : "loading"}
    </span>
  );
}

async function renderLoaded(options) {
  renderWithProviders(<Probe />, { providers: "app", ...options });
  await waitFor(() =>
    expect(screen.getByTestId("state")).toHaveTextContent("loaded"),
  );
}

describe("SelectionProvider", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("fetches /pointQuery once the catalog is loaded, translating titles", async () => {
    await renderLoaded();
    expect(latest.pointsData).toHaveLength(pointQueryFixture.length);
    const row = latest.pointsData.find(
      (p) => p.dataset_id === pointQueryFixture[0].dataset_id,
    );
    expect(row.title).toBe(pointQueryFixture[0].title_translated.en);
  });

  it("resolves inspectDataset from a ?dataset=&server= share link", async () => {
    const fixtureRow = pointQueryFixture[0];
    const slug = erddapServerSlug(fixtureRow.erddap_url);
    await renderLoaded({
      url: `/?dataset=${fixtureRow.dataset_id}&server=${slug}`,
    });
    expect(latest.inspectDataset?.dataset_id).toBe(fixtureRow.dataset_id);
  });

  it("resolves a legacy ?dataset= link with no server param, on dataset_id alone", async () => {
    const fixtureRow = pointQueryFixture[0];
    await renderLoaded({ url: `/?dataset=${fixtureRow.dataset_id}` });
    expect(latest.inspectDataset?.dataset_id).toBe(fixtureRow.dataset_id);
  });

  it("leaves inspectDataset unresolved for an unknown dataset id", async () => {
    await renderLoaded({ url: "/?dataset=does-not-exist" });
    expect(latest.inspectDataset).toBeUndefined();
  });

  it("handleSelectDataset toggles a dataset into pointsToReview and counts it", async () => {
    await renderLoaded();
    const target = latest.pointsData[0];
    act(() => latest.handleSelectDataset(target));
    await waitFor(() => {
      expect(latest.pointsToReview.some((p) => p.pk === target.pk)).toBe(true);
      expect(latest.selectedPks.size).toBe(1);
    });
  });

  it("handleSelectDataset is a no-op for a Grid (metadata-only) dataset", async () => {
    await renderLoaded();
    const grid = {
      ...latest.pointsData[0],
      pk: 999999,
      cdm_data_type: "Grid",
    };
    act(() => latest.handleSelectDataset(grid));
    expect(latest.selectedPks.has(999999)).toBe(false);
    expect(latest.pointsToReview.some((p) => p.pk === 999999)).toBe(false);
  });

  it("datasetTitleSearchText narrows filteredDatasets by title", async () => {
    await renderLoaded();
    const target = latest.pointsData[0];
    const needle = target.title.slice(0, 6);
    act(() => latest.setDatasetTitleSearchText(needle));
    await waitFor(() => {
      expect(latest.filteredDatasets.length).toBeGreaterThan(0);
      expect(
        latest.filteredDatasets.every((row) =>
          row.title.toLowerCase().includes(needle.toLowerCase()),
        ),
      ).toBe(true);
    });
  });

  it("datasetTitleSearchText narrows the map's queries too, not just the list", async () => {
    await renderLoaded();
    const target = latest.pointsData[0];
    const needle = target.title.slice(0, 6);
    const excluded = latest.pointsData.find(
      (row) => !row.title.toLowerCase().includes(needle.toLowerCase()),
    );
    expect(
      new URLSearchParams(latestMapState.mapQueryString).get("datasetPKs"),
    ).toBeNull();

    act(() => latest.setDatasetTitleSearchText(needle));
    await waitFor(() => {
      const drawn = new URLSearchParams(latestMapState.mapQueryString)
        .get("datasetPKs")
        ?.split(",");
      expect(drawn).toContain(String(target.pk));
      expect(drawn).toEqual(
        latest.filteredDatasets.map((row) => String(row.pk)),
      );
    });
    if (excluded) {
      expect(
        new URLSearchParams(latestMapState.mapQueryString)
          .get("datasetPKs")
          .split(","),
      ).not.toContain(String(excluded.pk));
    }

    act(() => latest.setDatasetTitleSearchText(""));
    await waitFor(() =>
      expect(
        new URLSearchParams(latestMapState.mapQueryString).get("datasetPKs"),
      ).toBeNull(),
    );
  });

  it("\"only in view\" narrows the coverage figure's dataset list, not the map's", async () => {
    await renderLoaded();
    expect(latest.filteredDatasetPks).toBeUndefined();

    act(() => latest.setOnlyInView(true));
    // No fixture row carries a bbox, so nothing is in view: the figure is
    // asked for an empty dataset list rather than left unnarrowed, which is
    // what stops it answering for the datasets the filter just removed.
    await waitFor(() => expect(latest.filteredDatasetPks).toEqual([]));
    // The map deliberately ignores this one — feeding the viewport back into
    // the tile queries would rewrite every one of them on every pan.
    expect(
      new URLSearchParams(latestMapState.mapQueryString).get("datasetPKs"),
    ).toBeNull();

    act(() => latest.setOnlyInView(false));
    await waitFor(() => expect(latest.filteredDatasetPks).toBeUndefined());
  });

  it("fetches a record preview once inspectRecordID is set on an inspected dataset", async () => {
    const fixtureRow = pointQueryFixture[0];
    await renderLoaded({ url: `/?dataset=${fixtureRow.dataset_id}` });
    act(() => latest.setInspectRecordID("STATION_001"));
    await waitFor(() => {
      expect(latest.showPreviewModal).toBe(true);
      expect(latest.recordLoading).toBe(false);
    });
    expect(latest.datasetPreview).toBeDefined();
  });

  const previewUrls = () =>
    fetch.mock.calls
      .map(([input]) => (typeof input === "string" ? input : input.url))
      .filter((url) => url.includes("/preview?"));

  it("a chosen profile rides the preview fetch as `at`", async () => {
    // The one plot param that changes what is FETCHED rather than how it is
    // drawn, which is why the provider reads it at all.
    const fixtureRow = pointQueryFixture[0];
    await renderLoaded({
      url: `/?dataset=${fixtureRow.dataset_id}&preview=STATION_001&pstep=cast-1`,
    });
    await waitFor(() => expect(latest.recordLoading).toBe(false));
    expect(previewUrls().at(-1)).toContain("at=cast-1");
  });

  it("no chosen profile asks for the record exactly as it always did", async () => {
    const fixtureRow = pointQueryFixture[0];
    await renderLoaded({
      url: `/?dataset=${fixtureRow.dataset_id}&preview=STATION_001`,
    });
    await waitFor(() => expect(latest.recordLoading).toBe(false));
    expect(previewUrls().at(-1)).not.toContain("at=");
  });

  it("opening another record drops the profile chosen for the previous one", async () => {
    // A cast id belongs to the station it came from; carried across, it names a
    // profile the new station never took and /preview answers NO_DATA.
    const fixtureRow = pointQueryFixture[0];
    await renderLoaded({
      url: `/?dataset=${fixtureRow.dataset_id}&preview=STATION_001&pstep=cast-1`,
    });
    await waitFor(() => expect(latest.recordLoading).toBe(false));

    act(() => latest.setInspectRecordID("STATION_002"));
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get("preview")).toBe(
        "STATION_002",
      ),
    );
    expect(new URLSearchParams(window.location.search).get("pstep")).toBeNull();
    await waitFor(() =>
      expect(previewUrls().at(-1)).toContain("profile=STATION_002"),
    );
    expect(previewUrls().at(-1)).not.toContain("at=");
  });

  it("groups by a dimension and hides datasets belonging only to hidden groups", async () => {
    await renderLoaded();
    act(() => latest.setGroupBy("platform"));
    await waitFor(() => expect(latest.groupBy).toBe("platform"));

    const target = latest.pointsData[0];
    act(() => latest.toggleGroupHidden(target.platform));
    await waitFor(() => {
      const stillHidingTarget = latest.pointsData
        .filter((p) => p.platform === target.platform)
        .every((p) => latest.hiddenDatasetPks.has(p.pk));
      expect(stillHidingTarget).toBe(true);
    });

    act(() => latest.showAllGroups());
    await waitFor(() => expect(latest.hiddenDatasetPks.size).toBe(0));
  });

  it("switching groupBy drops whatever was hidden under the old dimension", async () => {
    await renderLoaded();
    act(() => latest.setGroupBy("platform"));
    await waitFor(() => expect(latest.groupBy).toBe("platform"));
    act(() => latest.toggleGroupHidden(latest.pointsData[0].platform));
    await waitFor(() => expect(latest.hiddenGroups.size).toBe(1));

    act(() => latest.setGroupBy("type"));
    await waitFor(() => expect(latest.hiddenGroups.size).toBe(0));
  });

  it("addDatasetsToSelection puts the named pks aside, ignoring one absent from the results", async () => {
    await renderLoaded();
    const target = latest.pointsData[0];
    // 888888 is not a pk in pointsData at all — addDatasetsToSelection only
    // adds pks it can resolve to a row, so it's silently dropped, the same
    // way a Grid row's pk would be (see the callback's own comment).
    act(() => latest.addDatasetsToSelection([target.pk, 888888]));
    await waitFor(() => {
      expect(latest.selectedPks.has(target.pk)).toBe(true);
    });
    expect(latest.selectedPks.has(888888)).toBe(false);
  });

  it("selectTrajectoryFromMap opens the dataset's page and selects the track", async () => {
    await renderLoaded();
    const target = latest.pointsData[0];
    act(() =>
      latest.selectTrajectoryFromMap(target.pk, "track-1", target.title),
    );
    await waitFor(() => {
      expect(latest.selectedTrajectory).toEqual({
        datasetPk: target.pk,
        datasetTitle: target.title,
        trajectoryId: "track-1",
      });
      expect(latest.inspectDataset?.pk).toBe(target.pk);
    });
  });

  it("re-clicking the already-selected track is a no-op, not a toggle", async () => {
    await renderLoaded();
    const target = latest.pointsData[0];
    act(() =>
      latest.selectTrajectoryFromMap(target.pk, "track-1", target.title),
    );
    await waitFor(() =>
      expect(latest.selectedTrajectory?.trajectoryId).toBe("track-1"),
    );

    const selectionBefore = latest.selectedTrajectory;
    act(() =>
      latest.selectTrajectoryFromMap(target.pk, "track-1", target.title),
    );
    // A toggle would have cleared it; the guard leaves it exactly as it was.
    expect(latest.selectedTrajectory).toBe(selectionBefore);
  });
});
