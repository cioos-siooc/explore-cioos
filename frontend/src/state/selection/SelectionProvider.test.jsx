import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../test/mockFetch.js";
import { useSelection } from "./SelectionProvider.jsx";
import { erddapServerSlug } from "../../utilities.jsx";
import pointQueryFixture from "../../../e2e/fixtures/api/pointQuery.json";

let latest;

function Probe() {
  latest = useSelection();
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
      expect(latest.datasetsSelectedCount).toBe(1);
    });
  });

  it("handleSelectDataset is a no-op for a Grid (metadata-only) dataset", async () => {
    await renderLoaded();
    const grid = {
      ...latest.pointsData[0],
      pk: 999999,
      cdm_data_type: "Grid",
      selected: false,
    };
    act(() => latest.setPointsData([...latest.pointsData, grid]));
    await waitFor(() =>
      expect(latest.pointsData.find((p) => p.pk === 999999)).toBeTruthy(),
    );
    act(() => latest.handleSelectDataset(grid));
    expect(latest.pointsData.find((p) => p.pk === 999999).selected).toBe(false);
  });

  it("handleSelectAllDatasets selects every non-Grid dataset, and toggles back off", async () => {
    await renderLoaded();
    act(() => latest.handleSelectAllDatasets());
    await waitFor(() =>
      expect(latest.pointsData.every((p) => p.selected)).toBe(true),
    );
    act(() => latest.handleSelectAllDatasets());
    await waitFor(() =>
      expect(latest.pointsData.every((p) => !p.selected)).toBe(true),
    );
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

  it("addDatasetsToSelection puts the named pks aside, skipping Grid rows", async () => {
    await renderLoaded();
    const grid = {
      ...latest.pointsData[0],
      pk: 888888,
      cdm_data_type: "Grid",
      selected: false,
    };
    act(() => latest.setPointsData([...latest.pointsData, grid]));
    await waitFor(() =>
      expect(latest.pointsData).toHaveLength(pointQueryFixture.length + 1),
    );

    const target = latest.pointsData[0];
    act(() => latest.addDatasetsToSelection([target.pk, 888888]));
    await waitFor(() => {
      expect(latest.pointsData.find((p) => p.pk === target.pk).selected).toBe(
        true,
      );
      expect(latest.pointsData.find((p) => p.pk === 888888).selected).toBe(
        false,
      );
    });
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
