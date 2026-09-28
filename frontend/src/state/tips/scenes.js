import { TRAJECTORY_TYPE_KEYS } from "../dataLayers.js";

// Map views set up for the user, shared by the About dialog's showcases and the
// tips tour (see useTourStages): each one drives the same actions the controls
// do.

// Halifax Harbour: charted by CHS in detail, so the NONNA soundings are there
// to see as soon as the camera lands.
const NONNA_AREA = {
  type: "Polygon",
  coordinates: [
    [
      [-63.62, 44.6],
      [-63.5, 44.6],
      [-63.5, 44.7],
      [-63.62, 44.7],
      [-63.62, 44.6],
    ],
  ],
};

// A glider mission off the west coast of Vancouver Island, with its track
// drawn and the camera where it reads best. Catalogues without
// it fall back to the first trajectory dataset, framed on its footprint.
const TRAJECTORY_SHOWCASE = {
  datasetId: "colin_1142_20260708_R",
  trajectoryId: "colin_1142_20260708",
  centre: { type: "Point", coordinates: [-127.598, 48.273] },
  zoom: 6.6,
};

const isTrajectory = (dataset) =>
  TRAJECTORY_TYPE_KEYS.some(([, type]) => type === dataset.cdm_data_type);
const footprint = (dataset) =>
  dataset.filtered_bbox_geojson || dataset.coverage_bbox_geojson;

// The dataset showTrajectory opens, if the catalogue has one.
export const findTrajectory = (pointsData) =>
  pointsData.find(
    (dataset) => dataset.dataset_id === TRAJECTORY_SHOWCASE.datasetId,
  ) ||
  pointsData.find((dataset) => isTrajectory(dataset) && footprint(dataset));

export function showTrajectory(
  dataset,
  { selectTrajectoryFromMap, setInspectDataset, zoomToGeometry },
) {
  if (dataset.dataset_id === TRAJECTORY_SHOWCASE.datasetId) {
    selectTrajectoryFromMap(
      dataset.pk,
      TRAJECTORY_SHOWCASE.trajectoryId,
      dataset.title,
    );
    zoomToGeometry(TRAJECTORY_SHOWCASE.centre, {
      maxZoom: TRAJECTORY_SHOWCASE.zoom,
    });
    return;
  }
  setInspectDataset(dataset);
  zoomToGeometry(footprint(dataset));
}

export function showNonna({ setBathymetryVisible, zoomToGeometry }) {
  setBathymetryVisible(true);
  zoomToGeometry(NONNA_AREA, { maxZoom: 12 });
}

// Opening a gridded dataset's page draws its WMS overlay by itself (see
// GriddapDetails).
export function showGridded(dataset, { setInspectDataset, zoomToGeometry }) {
  setInspectDataset(dataset);
  zoomToGeometry(footprint(dataset));
}

// The Gulf of St. Lawrence, thick with stations, framed at a zoom where hexes
// are drawn: the cell under the centre always has datasets to list.
const WHATS_HERE_SPOT = [-63.914, 49.038];

// Asks the "what's here" card's question of that cell, once the camera lands.
export function showWhatsHere({ zoomToGeometry, requestFeatureQueryAt }) {
  zoomToGeometry(
    { type: "Point", coordinates: WHATS_HERE_SPOT },
    { maxZoom: 5 },
  );
  requestFeatureQueryAt(WHATS_HERE_SPOT);
}
