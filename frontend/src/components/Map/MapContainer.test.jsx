import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../test/mockFetch.js";
import { useMapState } from "../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../state/selection/SelectionProvider.jsx";
import pointQueryFixture from "../../../e2e/fixtures/api/pointQuery.json";

// MapContainer is the adapter between the state providers and the imperative
// Map.jsx (out of scope for unit tests — see src/test/stubs/maplibre.js's own
// comment: real map rendering is e2e territory). This stub exposes the
// callback props MapContainer hands to Map as plain buttons, so the tests
// below exercise MapContainer's OWN logic (handleFeatureQuery, onMarkerClick)
// without needing a real map.
let latestMapProps;
vi.mock("./Map.jsx", () => ({
  default: (props) => {
    latestMapProps = props;
    return <div data-testid="mock-map" />;
  },
}));

import MapContainer from "./MapContainer.jsx";

const ROW = pointQueryFixture[0];

let latestMapState;
let latestSelection;
function Probe() {
  latestMapState = useMapState();
  latestSelection = useSelection();
  const { initialPointsQueryComplete } = latestSelection;
  return (
    <span data-testid="state">
      {initialPointsQueryComplete ? "ready" : "loading"}
    </span>
  );
}

async function renderReady() {
  const result = renderWithProviders(
    <>
      <MapContainer />
      <Probe />
    </>,
    { providers: "app" },
  );
  await waitFor(() =>
    expect(screen.getByTestId("state")).toHaveTextContent("ready"),
  );
  return result;
}

describe("MapContainer", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("renders Map with the provider state wired into its props", async () => {
    await renderReady();
    expect(screen.getByTestId("mock-map")).toBeInTheDocument();
    expect(latestMapProps.mapQueryString).toBeDefined();
    expect(typeof latestMapProps.onMarkerClick).toBe("function");
    expect(typeof latestMapProps.onFeatureQuery).toBe("function");
  });

  it("handleFeatureQuery returns to the dataset list when a page is open and the query found something", async () => {
    await renderReady();
    latestSelection.setInspectDataset(ROW);
    await waitFor(() => expect(latestSelection.inspectDataset?.pk).toBe(ROW.pk));

    latestMapProps.onFeatureQuery({
      nonce: 1,
      lngLat: [0, 0],
      items: [{ kind: "observation" }],
    });

    await waitFor(() => expect(latestSelection.inspectDataset).toBeUndefined());
    expect(latestMapState.featureQuery).toEqual({
      nonce: 1,
      lngLat: [0, 0],
      items: [{ kind: "observation" }],
    });
  });

  it("handleFeatureQuery does not touch the open dataset page for a null (cleared) query", async () => {
    await renderReady();
    latestSelection.setInspectDataset(ROW);
    await waitFor(() => expect(latestSelection.inspectDataset?.pk).toBe(ROW.pk));

    latestMapProps.onFeatureQuery(null);

    await waitFor(() => expect(latestMapState.featureQuery).toBeNull());
    expect(latestSelection.inspectDataset?.pk).toBe(ROW.pk);
  });

  it("onMarkerClick opens the dataset page immediately, replacing history", async () => {
    await renderReady();
    await latestMapProps.onMarkerClick(ROW.pk, 123);
    await waitFor(() =>
      expect(latestSelection.inspectDataset?.pk).toBe(ROW.pk),
    );
  });

  it("onMarkerClick does nothing for a pk not in the current results", async () => {
    await renderReady();
    await latestMapProps.onMarkerClick(999999999, 123);
    expect(latestSelection.inspectDataset).toBeUndefined();
  });

  it("onMarkerClick highlights the resolved record when exactly one profile matches the point", async () => {
    const realFetch = global.fetch;
    global.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/datasetRecordsList")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ profiles: [{ profile_id: "profile-42" }] }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      return realFetch(input, init);
    };

    await renderReady();
    await latestMapProps.onMarkerClick(ROW.pk, 123);

    await waitFor(() =>
      expect(latestSelection.highlightedRecord).toEqual({
        datasetPk: ROW.pk,
        profileId: "profile-42",
      }),
    );
  });

  it("onMarkerClick leaves highlightedRecord unset when the point resolves to more than one record", async () => {
    const realFetch = global.fetch;
    global.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/datasetRecordsList")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              profiles: [{ profile_id: "a" }, { profile_id: "b" }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      return realFetch(input, init);
    };

    await renderReady();
    await latestMapProps.onMarkerClick(ROW.pk, 123);
    await waitFor(() => expect(latestSelection.inspectDataset?.pk).toBe(ROW.pk));
    expect(latestSelection.highlightedRecord).toBeUndefined();
  });

  it("onMarkerClick reports rather than throws when the record lookup fails", async () => {
    const realFetch = global.fetch;
    global.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/datasetRecordsList")) {
        return Promise.resolve(new Response(null, { status: 500 }));
      }
      return realFetch(input, init);
    };

    await renderReady();
    await expect(
      latestMapProps.onMarkerClick(ROW.pk, 123),
    ).resolves.not.toThrow();
    await waitFor(() => expect(latestSelection.inspectDataset?.pk).toBe(ROW.pk));
  });
});
