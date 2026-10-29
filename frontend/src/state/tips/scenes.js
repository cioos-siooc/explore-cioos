import { TRAJECTORY_TYPE_KEYS } from "../dataLayers.js";

// Shared by the About dialog's showcases and the tips tour.

// Charted by CHS in detail, so the NONNA soundings show on landing.
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

// Catalogues without it fall back to the first trajectory dataset.
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

export const findGridded = (pointsData) =>
  pointsData.find((dataset) => dataset.wms_url);

// The page draws its WMS overlay by itself (see GriddapDetails).
export function showGridded(dataset, { setInspectDataset, zoomToGeometry }) {
  setInspectDataset(dataset);
  zoomToGeometry(footprint(dataset));
}

// Thick with stations, so the cell under the centre always has datasets.
const WHATS_HERE_SPOT = [-63.914, 49.038];

export function showWhatsHere({ zoomToGeometry, requestFeatureQueryAt }) {
  zoomToGeometry(
    { type: "Point", coordinates: WHATS_HERE_SPOT },
    { maxZoom: 5 },
  );
  requestFeatureQueryAt(WHATS_HERE_SPOT);
}
