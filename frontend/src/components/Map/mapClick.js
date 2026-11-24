import * as helpers from "@turf/helpers";
import turfPointsWithinPolygon from "@turf/points-within-polygon";

import {
  buildFeatureQuery,
  datasetPksOf,
  griddapHitLayers,
  gridsCovering,
  isGriddapHit,
  nearestFeature,
  selectedTrackLayers,
  trackClickLayers,
  trackItemsIn,
} from "./hitTest.js";
import { emptyFeatureCollection } from "./mapLayers.js";

// One handler, one hit-test: report what's under the click and let the card
// offer the actions; nothing here changes the camera or a filter. Titles aren't
// on the tiles; the card resolves pks against the current results. Returns
// askAt(lngLat), which reproduces only the card a click there would open.
export function installClick(
  map,
  { popup, draw, latest, i18n, creatingPolygon },
) {
  const featureQueryContext = () => ({
    zoom: map.getZoom(),
    queryRendered: (options) => map.queryRenderedFeatures(options),
    language: i18n.language,
    gridGeometry: (pk) =>
      latest.current.griddapExtents?.features?.find(
        (feature) => Number(feature.properties.pk) === pk,
      )?.geometry,
    gridsAt: (lngLat) => gridsCovering(latest.current.griddapExtents, lngLat),
  });

  const clickLayerIds = [
    ...trackClickLayers,
    ...selectedTrackLayers,
    "points",
    "coverage-hexes",
    "hexes",
    ...griddapHitLayers,
  ];

  // Shared by a click and a share link's replay. Once a marker or track (a
  // precise geometry) is under the point, hex hits are dropped: the hexes lie
  // beneath every station and every metre of track.
  const hitsAt = (point) => {
    const layers = clickLayerIds.filter((id) => map.getLayer(id));
    const hits = layers.length
      ? map.queryRenderedFeatures(point, { layers })
      : [];
    const precise =
      hits.some((feature) => feature.layer.id === "points") ||
      trackItemsIn(hits).length > 0;
    return precise
      ? hits.filter(
          (feature) => !["hexes", "coverage-hexes"].includes(feature.layer.id),
        )
      : hits;
  };

  // A tap delivers 'touchend' then a synthesized 'click'; the second is the
  // same gesture and would re-open a card the first let the user dismiss.
  let lastClickHandledAt = 0;
  const TAP_ECHO_MS = 400;

  const handleMapClick = (e) => {
    const now = Date.now();
    if (now - lastClickHandledAt < TAP_ECHO_MS) return;
    lastClickHandledAt = now;

    // Drawing owns the canvas. A finished shape lands in direct_select, so
    // "done drawing" is "no longer in a draw_* mode".
    if (creatingPolygon.current) {
      if (!draw.getMode().includes("draw")) creatingPolygon.current = false;
      return;
    }
    if (draw.getMode().includes("draw")) return;

    // At every zoom: past NONNA's reach the API answers from GEBCO.
    if (latest.current.depthToolActive) {
      latest.current.onDepthQuery(e.lngLat.wrap());
      return;
    }

    // Outside the drawn shape is out of the selection.
    const ring = latest.current.polygon;
    if (
      ring &&
      !turfPointsWithinPolygon(
        helpers.point([e.lngLat.lng, e.lngLat.lat]),
        helpers.polygon([ring]),
      ).features.length
    ) {
      return;
    }

    const hits = hitsAt(e.point);
    const markerHits = hits.filter((feature) => feature.layer.id === "points");
    const tracks = trackItemsIn(hits);

    const nearestMarker = nearestFeature(markerHits, e.point, (lngLat) =>
      map.project(lngLat),
    );

    // Only markers under the click, and the nearest names one dataset: jump
    // straight to its record.
    const nonMarkerHits = hits.filter(
      (feature) => feature.layer.id !== "points",
    );
    if (nearestMarker && nonMarkerHits.length === 0) {
      const markerDatasetPks = datasetPksOf(nearestMarker);
      if (markerDatasetPks.length === 1) {
        popup.remove();
        // The shape buildFeatureQuery would use, so the ring matches the
        // marker exactly once the record is closed.
        const highlight = {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: nearestMarker.geometry,
              properties: {
                count: Number(nearestMarker.properties.count) || 0,
              },
            },
          ],
        };
        // Not through handleFeatureQuery: navigating there in the same tick
        // as the record jump races two navigations over a stale search-params
        // snapshot (see setInspectRecordID in SelectionProvider), so
        // onMarkerClick owns both.
        latest.current.onMarkerClick(
          markerDatasetPks[0],
          Number(nearestMarker.properties.pk),
          {
            datasetPks: markerDatasetPks,
            highlight,
            nonce: Date.now(),
            // useUrlSync's ?at= reads this; the marker's position stands in.
            lngLat: nearestMarker.geometry.coordinates,
          },
        );
        return;
      }
    }

    // Same shortcut for exactly one track (the hexes beneath it were dropped
    // above).
    const gridHits = hits.filter(isGriddapHit);
    if (
      tracks.length === 1 &&
      markerHits.length === 0 &&
      gridHits.length === 0
    ) {
      popup.remove();
      // The selected track's drawing is this click's highlight, and this path
      // skips the featureQuery effect that would clear an earlier region.
      map.getSource("click-highlight")?.setData(emptyFeatureCollection);
      const track = tracks[0];
      // The area the dataset page uses to list when the platform was here.
      latest.current.onTrackClick(track.pk, track.trajectoryId, track.title, {
        lngLat: [e.lngLat.lng, e.lngLat.lat],
        z: Math.floor(map.getZoom()),
      });
      return;
    }

    const query = buildFeatureQuery(e.lngLat, hits, featureQueryContext());

    popup.remove();
    latest.current.onFeatureQuery(query);

    // For empty water right after the marker path: React bails out of a no-op
    // setFeatureQuery(null), so the featureQuery effect wouldn't clear the
    // ring.
    if (!query) {
      map.getSource("click-highlight")?.setData(emptyFeatureCollection);
    }

    // A click on empty water is the touch user's only undo: it closes the
    // card and drops the spatial selection (not the download selection, which
    // is derived from the results). getLayer guard: a click before
    // 'style.load' would setFilter on a layer that doesn't exist yet.
    if (!query && draw.getAll().features.length === 0) {
      latest.current.setPolygon();
    }
  };

  // The draw modes are checked at the top of the handler, so the per-layer
  // touchend workaround for mapbox-gl-draw#617 isn't needed.
  map.on("click", handleMapClick);

  // A tap must be told apart from the end of a pan or pinch, or a map-wide
  // touchend would clear the selection after every drag.
  const TAP_SLOP_PX = 12;
  const TAP_TIMEOUT_MS = 500;
  let touchStart = null;
  map.on("touchstart", (e) => {
    touchStart =
      e.originalEvent.touches.length === 1
        ? { point: e.point, at: Date.now() }
        : null;
  });
  map.on("touchend", (e) => {
    const start = touchStart;
    touchStart = null;
    if (!start) return;
    if (Date.now() - start.at > TAP_TIMEOUT_MS) return;
    const dx = e.point.x - start.point.x;
    const dy = e.point.y - start.point.y;
    if (dx * dx + dy * dy > TAP_SLOP_PX ** 2) return;
    handleMapClick(e);
  });

  return (lngLat) => {
    const query = buildFeatureQuery(
      { lng: lngLat[0], lat: lngLat[1] },
      hitsAt(map.project(lngLat)),
      featureQueryContext(),
    );
    if (query) latest.current.onFeatureQuery(query);
  };
}
