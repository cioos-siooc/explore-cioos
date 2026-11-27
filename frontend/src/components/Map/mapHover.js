import debounce from "lodash-es/debounce";

import { escapeHtml, formatInstant, formatInstantRange } from "../../utilities";
import { platformLabel } from "../../platformVocab.js";
import {
  dedupeGriddapByPk,
  griddapHitLayers,
  griddapTitle,
  isGriddapHit,
  isOnAPointIn,
  selectedTrackLayers,
} from "./hitTest.js";
import {
  HEX_HOVER_LAYERS,
  HEX_LAYER_IDS,
  NO_HEX_HOVERED,
} from "./mapLayers.js";

// Hit-testing and re-filtering the hover layers on every frame of a sweep
// trailed the cursor; settle first.
const HOVER_DEBOUNCE_MS = 50;

// The hover chip and outlines. `latest` is Map.jsx's latest-props ref.
export function installHover(
  map,
  { popup, draw, latest, i18n, getRadiusRange },
) {
  let hoveredGriddapIds = [];

  function setGriddapHovered(features) {
    if (!map.getSource("griddap-coverage")) return;
    const setHovered = (id, hovered) =>
      map.setFeatureState({ source: "griddap-coverage", id }, { hovered });
    hoveredGriddapIds.forEach((id) => setHovered(id, false));
    hoveredGriddapIds = features.map((feature) => feature.id);
    hoveredGriddapIds.forEach((id) => setHovered(id, true));
  }

  const pointHitContext = () => ({
    project: (lngLat) => map.project(lngLat),
    radiusRange: getRadiusRange(),
  });
  const metricCountLabel = (value) =>
    latest.current.t("mapHexCountDays", { count: Number(value || 0) });

  // Re-filtered only when the hovered cell changes.
  let hexHovered = "";
  function setHexHover(layerId, pk) {
    const key = layerId ? `${layerId}:${pk}` : "";
    if (hexHovered === key) return;
    hexHovered = key;
    HEX_HOVER_LAYERS.forEach(({ id, of }) => {
      if (!map.getLayer(id)) return;
      map.setFilter(
        id,
        of === layerId ? ["==", ["get", "pk"], pk] : NO_HEX_HOVERED,
      );
    });
  }

  const t = (...args) => latest.current.t(...args);
  // Hover only names what's under the cursor; detail is one click away in the
  // card. Lines are truncated rather than wrapped. Sized to the longest line
  // a rule produces: a full instant range (37 chars).
  const CHIP_MAX_CHARS = 40;
  const showChip = (lngLat, text) => {
    const lines = (Array.isArray(text) ? text : [text])
      .map((line) => String(line ?? "").trim())
      .filter(Boolean)
      .map((line) =>
        line.length > CHIP_MAX_CHARS
          ? `${line.slice(0, CHIP_MAX_CHARS - 1)}…`
          : line,
      );
    if (lines.length === 0) {
      popup.remove();
      return;
    }
    popup
      .setLngLat(lngLat)
      .setHTML(
        `<span class="mapChip">${lines
          .map((line) => `<span class="mapChipLine">${escapeHtml(line)}</span>`)
          .join("")}</span>`,
      )
      .addTo(map);
  };

  const showGriddapTooltip = (e, features) => {
    const sameStack =
      features.length === hoveredGriddapIds.length &&
      features.every(
        (feature, index) => feature.id === hoveredGriddapIds[index],
      );
    popup.setLngLat([e.lngLat.lng, e.lngLat.lat]);
    if (sameStack && popup.isOpen()) return;

    setGriddapHovered(features);
    showChip(
      e.lngLat,
      features.length > 1
        ? t("mapChipGridStack", { n: features.length })
        : griddapTitle(features[0], i18n.language),
    );
  };

  // One handler, one hit-test, once the cursor settles. MapLibre's per-layer listeners
  // each run queryRenderedFeatures per raw mousemove (and 'mouseleave' adds
  // another), which over dense coastline was the most expensive thing the map
  // did. Precedence, highest first:
  //
  //   1. the selected platform's own fixes, deliberately unguarded
  //   2. track lines, unless a point, a head or a selected fix is
  //   3. track heads, unless a point is
  //   4. points
  //   5. coverage hexes, unless a point is — points draw over them
  //   6. profile hexes
  //   7. griddap rectangles, which the others name in their own chip
  const hoverRules = [
    {
      id: "selected-fixes",
      layers: ["selected-track-fixes", "selected-track-fixes-nocog"],
      // The record id is absent on a plain Trajectory dataset. Falls back to
      // the platform where a fix carries no time.
      chip: (e, features) => {
        const {
          dataset_title: datasetTitle,
          profile_id: profileId,
          time,
          trajectory_id: trajectoryId,
        } = features[0].properties;
        return [
          e.lngLat,
          [datasetTitle, profileId, formatInstant(time) || trajectoryId],
        ];
      },
    },
    {
      id: "track-lines",
      layers: ["track-lines"],
      when: (hits, point) =>
        !isOnAPointIn(hits, point, pointHitContext()) &&
        !hits.some((feature) =>
          ["track-heads", "track-heads-fixed", ...selectedTrackLayers].includes(
            feature.layer.id,
          ),
        ),
      // No single instant or record id: an MVT line carries one set of
      // properties, so the segment's span is what it can say (lines CTE in
      // tiles.js).
      chip: (e, features) => {
        const {
          dataset_title: datasetTitle,
          trajectory_id: trajectoryId,
          time_min: timeMin,
          time_max: timeMax,
        } = features[0].properties;
        return [
          e.lngLat,
          [datasetTitle, trajectoryId, formatInstantRange(timeMin, timeMax)],
        ];
      },
    },
    {
      id: "track-heads",
      layers: ["track-heads", "track-heads-fixed"],
      when: (hits, point) => !isOnAPointIn(hits, point, pointHitContext()),
      // A head is the platform's last fix in the scrubbed window.
      chip: (e, features) => {
        const {
          dataset_title: datasetTitle,
          trajectory_id: trajectoryId,
          profile_id: profileId,
          head_time: headTime,
        } = features[0].properties;
        return [
          e.lngLat,
          [datasetTitle, trajectoryId, profileId, formatInstant(headTime)],
        ];
      },
    },
    {
      id: "points",
      layers: ["points"],
      // Named as well as coloured: the hue alone is the platform otherwise.
      chip: (e, features) => {
        const { platform, count } = features[0].properties;
        return [
          // the circle's centre, not the cursor
          features[0].geometry.coordinates.slice(),
          [
            !platform || platform === "unknown"
              ? t("mapChipPlatformUnknown")
              : platformLabel(platform, i18n.language),
            metricCountLabel(count),
          ],
        ];
      },
    },
    {
      id: "coverage-hexes",
      layers: ["coverage-hexes"],
      when: (hits) => !hits.some((feature) => feature.layer.id === "points"),
      chip: (e, features) => [
        e.lngLat,
        [metricCountLabel(features[0].properties.count)],
      ],
    },
    {
      id: "hexes",
      layers: ["hexes"],
      chip: (e, features) => [
        e.lngLat,
        [metricCountLabel(features[0].properties.count)],
      ],
    },
    {
      id: "griddap",
      layers: griddapHitLayers,
      show: (e, features) => showGriddapTooltip(e, dedupeGriddapByPk(features)),
    },
  ];

  // Includes layers only the guards read: track-lines stands aside for
  // 'selected-track-line'.
  const hoverLayerIds = [
    ...new Set([
      ...hoverRules.flatMap((rule) => rule.layers),
      "selected-track-line",
    ]),
  ];

  const handleHover = (e) => {
    // Drawing and the depth tool own the cursor; leave the popup as the last
    // hover left it.
    if (draw.getMode().includes("draw") || latest.current.depthToolActive) {
      setGriddapHovered([]);
      return;
    }

    const layers = hoverLayerIds.filter((id) => map.getLayer(id));
    const hits = layers.length
      ? map.queryRenderedFeatures(e.point, { layers })
      : [];

    const winner = hoverRules.find((rule) => {
      const features = hits.filter((feature) =>
        rule.layers.includes(feature.layer.id),
      );
      return features.length > 0 && (!rule.when || rule.when(hits, e.point));
    });

    // The rectangles' hover outline is feature-state, so it must be
    // released whenever they aren't the winner.
    if (winner?.id !== "griddap") {
      setGriddapHovered([]);
    }

    const hexWinner = HEX_LAYER_IDS.includes(winner?.id);
    setHexHover(
      hexWinner ? winner.id : null,
      hexWinner
        ? hits.find((feature) => feature.layer.id === winner.id).properties.pk
        : null,
    );

    if (!winner) {
      map.getCanvas().style.cursor = "grab";
      popup.remove();
      return;
    }

    map.getCanvas().style.cursor = "pointer";
    const winnerHits = hits.filter((feature) =>
      winner.layers.includes(feature.layer.id),
    );
    if (winner.show) {
      winner.show(e, winnerHits);
      return;
    }
    // Whatever wins, the grids it sits inside are still named.
    const grids = dedupeGriddapByPk(hits.filter(isGriddapHit));
    const [at, lines] = winner.chip(e, winnerHits);
    showChip(at, [
      ...lines,
      grids.length > 1
        ? t("mapChipGridStack", { n: grids.length })
        : grids.length === 1
          ? t("mapChipInGrid", {
              title: griddapTitle(grids[0], i18n.language),
            })
          : null,
    ]);
  };

  const debouncedHover = debounce((e) => {
    handleHover(e);
  }, HOVER_DEBOUNCE_MS);
  map.on("mousemove", (e) => {
    latest.current.setHoveredDataset();
    debouncedHover(e);
  });

  // No mousemove fires once the cursor leaves the canvas.
  map.on("mouseout", () => {
    debouncedHover.cancel();
    setGriddapHovered([]);
    setHexHover(null);
    if (!draw.getMode().includes("draw") && !latest.current.depthToolActive) {
      map.getCanvas().style.cursor = "grab";
      popup.remove();
    }
  });
}
