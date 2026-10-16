import * as React from "react";
import { useCallback, useMemo } from "react";
import { ZoomIn } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";

import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { boundsAreFramed, boundsFromGeoJson } from "../../../utilities.jsx";

// The one place the camera is asked to travel to a dataset: opening a page
// only highlights it. filtered_bbox_geojson follows the filters; grids have no
// features, so theirs is the coverage bbox (see shapeQuery.js).
export function useZoomToDataset() {
  const { inspectDataset } = useSelection();
  const { zoomToGeometry, mapInstance, mapView } = useMapState();

  const footprint =
    inspectDataset?.filtered_bbox_geojson ||
    inspectDataset?.coverage_bbox_geojson;
  const bounds = useMemo(() => boundsFromGeoJson(footprint), [footprint]);

  // mapView isn't read by boundsAreFramed; it changing is how this learns the
  // camera moved.
  const framed = useMemo(
    () => boundsAreFramed(mapInstance, bounds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mapInstance, bounds, mapView],
  );

  const zoomToDataset = useCallback(() => {
    if (footprint) zoomToGeometry(footprint);
  }, [footprint, zoomToGeometry]);

  return { zoomToDataset, canZoom: Boolean(bounds), framed };
}

export default function ZoomToDataset() {
  const { t } = useTranslation();
  const { zoomToDataset, canZoom, framed } = useZoomToDataset();

  return (
    <button
      type="button"
      className="zoomToDatasetButton"
      onClick={zoomToDataset}
      title={t("zoomToDatasetTitle")}
      disabled={!canZoom || framed}
    >
      <ZoomIn size={15} aria-hidden="true" />
      {t("zoomToDatasetText")}
    </button>
  );
}
