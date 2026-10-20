import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowsAngleExpand,
  ChevronCompactDown,
  ChevronCompactUp,
  Circle,
  CircleFill,
  HexagonFill,
  InfoCircle,
} from "react-bootstrap-icons";

import {
  capitalizeFirstLetter,
  generateColorStops,
} from "../../../utilities.jsx";
import {
  colorScale,
  isMarkerTier,
  bathymetryColorScale,
  bathymetryLegendMinZoom,
  bathymetryScaleMin,
  bathymetryScaleMax,
  bathymetryTicks,
  trackLineColor,
} from "../../config.js";
import platformColors from "../../platformColors";
import {
  DEFAULT_DATA_LAYERS,
  anyTrajectoryLayerOn,
} from "../../../state/dataLayers.js";
import TrajectoryDate from "../TrajectoryDate/TrajectoryDate.jsx";
import Modal from "../../ui/Modal.jsx";
import Spinner from "../../ui/Spinner.jsx";
import Switch from "../../ui/Switch.jsx";
import LegendFooter from "./LegendFooter.jsx";
import LegendHelpModal, { LEGEND_HELP_SECTIONS } from "./LegendHelpModal.jsx";
import useMediaQuery, {
  MOBILE_QUERY,
} from "../../../state/ui/useMediaQuery.js";
import { useTips } from "../../../state/tips/TipsProvider.jsx";

import "./styles.css";
import classNames from "classnames";
import isEmpty from "lodash-es/isEmpty";

// Up to billions: a full-catalogue maximum runs into the millions.
const COUNT_UNITS = [
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "k"],
];
// `singleDigit` drops the fraction: the marker size key is short on width.
function formatCount(value, singleDigit = false) {
  if (!Number.isFinite(value)) return "";
  for (const [size, suffix] of COUNT_UNITS) {
    if (value >= size) {
      const scaled = value / size;
      return `${
        scaled >= 10 || singleDigit
          ? Math.round(scaled)
          : scaled.toFixed(1).replace(/\.0$/, "")
      }${suffix}`;
    }
  }
  return `${value}`;
}

function formatDepth(metres) {
  return metres >= 1000 ? `${metres / 1000}k` : `${metres}`;
}

// 0..1 along the bar; the bar is logarithmic (see bathymetryColorScale).
const LOG_MIN = Math.log10(bathymetryScaleMin);
const LOG_SPAN = Math.log10(bathymetryScaleMax) - LOG_MIN;
function depthPosition(metres) {
  return (Math.log10(metres) - LOG_MIN) / LOG_SPAN;
}

const LEGEND_TIPS = ["trajectory"];

// Mid-ramp: either end would make the icon claim a count.
const HEX_ICON_COLOR = colorScale[Math.floor(colorScale.length / 2)];

const HEX_ICON = (
  <HexagonFill
    className="legendGroupIcon"
    size={11}
    fill={HEX_ICON_COLOR}
    aria-hidden="true"
  />
);

const TRACK_ICON = (
  <svg className="legendGroupIcon" width="11" height="11" aria-hidden="true">
    <line
      x1="1"
      y1="9.5"
      x2="10"
      y2="1.5"
      stroke={trackLineColor}
      strokeWidth="2.5"
      strokeLinecap="round"
    />
  </svg>
);

// Evenly spaced subset, always keeping first and last, so labels don't overlap.
function pickTickIndices(n, maxTicks = 5) {
  if (maxTicks < 2) return [0];
  if (n <= maxTicks) return Array.from({ length: n }, (_, i) => i);
  const step = (n - 1) / (maxTicks - 1);
  const indices = new Set();
  for (let i = 0; i < maxTicks; i++) indices.add(Math.round(i * step));
  return [...indices];
}

// A group's label row carries the switch that hides the whole group, which is
// why the marker keys sit with the hex ramp: same observations, other zooms.
export default function Legend({
  // Point-tier range, read by the marker size key.
  currentRangeLevel,
  // The one domain every hexagon is coloured over (see MapStateProvider).
  hexRangeLevel,
  // The domain is the on-screen hexes' extent, so the ticks move with the camera.
  hexRangeScaledToView = false,
  loading,
  zoom,
  platformsAvailable = [],
  // { observations, bathymetry, tracks }, each { key, label, checked, onChange };
  // absent members render their entry without a switch.
  controls = {},
  layerControls = [],
  dataLayers,
}) {
  const { t } = useTranslation();
  const [legendOpen, setLegendOpen] = useState(true);
  const compact = useMediaQuery(MOBILE_QUERY);
  const { activeTip } = useTips();
  // Opened once per tip, so the card can still be folded while the tip is up.
  const [tipOpenedFor, setTipOpenedFor] = useState(activeTip);
  if (activeTip !== tipOpenedFor) {
    setTipOpenedFor(activeTip);
    if (LEGEND_TIPS.includes(activeTip)) setLegendOpen(true);
  }
  const [detailOpen, setDetailOpen] = useState(false);
  // A LEGEND_HELP_SECTIONS key; one dialog serves every ⓘ on the card.
  const [helpSection, setHelpSection] = useState();

  // Not all-on: that would claim legend entries the map isn't drawing.
  const layers = dataLayers || DEFAULT_DATA_LAYERS;
  const markerTier = isMarkerTier(zoom);
  const trajectoryOn = anyTrajectoryLayerOn(layers);
  const tracksMode = Boolean(controls.tracks?.checked);
  // Muted rather than removed: the switch needs something to sit beside, and a
  // saturated ramp under an off switch reads as a live layer.
  const observationsHidden = controls.observations
    ? !controls.observations.checked
    : false;

  // At the marker tier the profile families are points, so only the
  // trajectory/occurrence cells remain hexes. Only the geometry filter decides
  // what reaches the hexagons (see buildTileSuffix).
  const profileFamilyOn =
    layers.profile || layers.timeseries || layers.timeseriesProfile;
  const cellsAsHexes = layers.point || trajectoryOn;
  const hexesOnMap = markerTier
    ? cellsAsHexes
    : profileFamilyOn || cellsAsHexes;
  const pointsOnMap = markerTier && profileFamilyOn;

  function renderHelpButton(key) {
    if (!LEGEND_HELP_SECTIONS[key]) return null;
    const label = t("legendHelpOpen", {
      section: t(`legendHelp_${key}_title`),
    });
    return (
      <button
        type="button"
        className="legendInfoButton"
        onClick={() => setHelpSection(key)}
        title={label}
        aria-label={label}
      >
        <InfoCircle size={11} aria-hidden="true" />
      </button>
    );
  }

  // `idSuffix`: in compact mode the observations group renders both on the card
  // and in the keys dialog, and two inputs must not share an id.
  function renderGroup(
    key,
    label,
    { icon, control, tooltip, idSuffix = "" } = {},
    children,
  ) {
    const help = renderHelpButton(key);
    return (
      <div className="legendGroup" key={key}>
        {(label || control || help) && (
          <div className="legendGroupLabelRow">
            {icon}
            {control && (
              <Switch
                id={`mapLayer-${control.key}${idSuffix}`}
                title={control.label}
                checked={control.checked}
                onChange={control.onChange}
                tipTarget={control.tipTarget}
              />
            )}
            {typeof label === "string" ? (
              <div className="legendGroupLabel" title={tooltip}>
                {label}
              </div>
            ) : (
              label
            )}
            {help}
          </div>
        )}
        {children}
      </div>
    );
  }

  function renderSubCaption(caption, { icon, tooltip, help } = {}) {
    return (
      <div className="legendSubCaption" title={tooltip}>
        {icon}
        <span>{caption}</span>
        {help && renderHelpButton(help)}
      </div>
    );
  }

  // Stops are spaced by scale index, not value: the counts are power/log scaled
  // and a linear-value axis would collapse into the dominant high-count colour.
  function renderColorBar(scale, rangeLevel, dimmed, maxTicks) {
    const colorStops = generateColorStops(scale, rangeLevel);
    if (!colorStops || !colorStops.length) return null;
    const n = colorStops.length;
    const denom = n > 1 ? n - 1 : 1;
    const gradient =
      n === 1
        ? colorStops[0].color
        : `linear-gradient(to right, ${colorStops
            .map((cs, i) => `${cs.color} ${((i / denom) * 100).toFixed(1)}%`)
            .join(", ")})`;
    const tickIndices = pickTickIndices(n, maxTicks);
    // /legend clamps the top to a high percentile (rampRange in
    // web-api/routes/legend.js), so a clamped top tick isn't the real maximum.
    const clamped = rangeLevel?.[2] > rangeLevel?.[1];
    return (
      <div
        className={classNames({ legendDimmed: dimmed })}
        title={hexRangeScaledToView ? t("legendScaledToView") : undefined}
      >
        <div
          className="legendColorBar"
          style={{ background: gradient }}
          aria-hidden="true"
        />
        <div className="legendColorBarTicks">
          {tickIndices.map((i) => {
            const isLast = i === n - 1;
            const align = i === 0 ? "start" : isLast ? "end" : "mid";
            return (
              <span
                key={i}
                className={`legendTick ${align}`}
                style={{ left: `${(i / denom) * 100}%` }}
                title={
                  isLast && clamped
                    ? t("legendTopTickClamped", {
                        max: formatCount(rangeLevel[2]),
                      })
                    : undefined
                }
              >
                {formatCount(colorStops[i].stop)}
                {isLast && clamped ? "+" : ""}
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  // The catalog's full palette would promise markers the map never draws.
  const platformSwatches = platformColors.filter((pc) =>
    platformsAvailable.includes(pc.platform),
  );

  function renderMetricTitle() {
    if (!hexesOnMap && !pointsOnMap) return null;
    return t("legendMetricDays");
  }

  // While /legend is in flight with no previous ramp the counts are unknown, not
  // zero: "No Data" would wrongly say the filters excluded everything.
  function renderMissingCounts() {
    if (loading) {
      return (
        <div className="legendLoading">
          <Spinner size="sm" />
          <span>{t("legendLoadingText")}</span>
        </div>
      );
    }
    return (
      <div className="legendNoData" title={t("legendNoDataWarningTitle")}>
        {t("legendNoDataWarningText")}
      </div>
    );
  }

  // The tier's primary count: hexes below the marker tier, points at it.
  function renderCountStatus() {
    if (!hexesOnMap && !pointsOnMap) return null;
    if (!isEmpty(markerTier ? currentRangeLevel : hexRangeLevel)) return null;
    return renderMissingCounts();
  }

  // Deliberately one ramp for every kind of hexagon: what a hexagon holds is in
  // its tooltip, not in a second colour domain.
  function renderHexEntry(maxTicks) {
    if (!hexesOnMap || isEmpty(hexRangeLevel)) return null;
    return (
      <div className="legendSubsection">
        {renderColorBar(
          colorScale,
          hexRangeLevel,
          observationsHidden,
          maxTicks,
        )}
      </div>
    );
  }

  function renderBathymetryBar() {
    // zoom is undefined until the map first reports its view, and `undefined < n`
    // is false, so the bar would flash on before its raster exists.
    if (!Number.isFinite(zoom) || zoom < bathymetryLegendMinZoom) return null;
    const hidden = controls.bathymetry ? !controls.bathymetry.checked : false;
    // Anchors sit at their own depths, so the gradient is uneven by design.
    const gradient = `linear-gradient(to right, ${bathymetryColorScale
      .map(
        ({ depth, color }) =>
          `${color} ${(depthPosition(depth) * 100).toFixed(1)}%`,
      )
      .join(", ")})`;
    return (
      <div className={classNames({ legendDimmed: hidden })}>
        <div
          className="legendColorBar"
          style={{ background: gradient }}
          aria-hidden="true"
        />
        <div className="legendColorBarTicks">
          {bathymetryTicks.map((metres, i) => {
            const align =
              i === 0
                ? "start"
                : i === bathymetryTicks.length - 1
                  ? "end"
                  : "mid";
            return (
              <span
                key={metres}
                className={`legendTick ${align}`}
                style={{ left: `${depthPosition(metres) * 100}%` }}
              >
                {formatDepth(metres)}
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  function renderMarkerKeys() {
    // A missing range is reported by renderCountStatus.
    if (!pointsOnMap || isEmpty(currentRangeLevel)) return null;
    // radiusExpression (Map.jsx) clamps below `lo`, so the floor is the value
    // worth naming.
    const [lo, hi] = currentRangeLevel;
    // That expression goes flat when the range is degenerate (common zoomed in), so
    // there is no larger circle to show.
    const ramped = Number.isFinite(lo) && Number.isFinite(hi) && hi > lo;
    const dimClass = classNames("legendSubsection", {
      legendDimmed: observationsHidden,
    });
    return (
      <>
        <div className={dimClass}>
          {renderSubCaption(t("legendMarkers"), {
            icon: (
              <Circle className="legendSubIcon" size={8} aria-hidden="true" />
            ),
            tooltip: t("legendMarkerDaysPinned"),
            help: "markers",
          })}
          <div className="legendSizeKey">
            <span className="legendSwatch">
              <span className="legendPointCircle small" />
            </span>
            <span className="legendItemLabel">
              {Number.isFinite(lo)
                ? `≤ ${formatCount(lo, true)}`
                : t("legendPointSizeLess")}
            </span>
            {ramped && (
              <>
                <span className="legendItemLabel">&lt;</span>
                <span className="legendSwatch">
                  <span className="legendPointCircle large" />
                </span>
              </>
            )}
          </div>
        </div>
        {platformSwatches.length > 0 && (
          <div className={dimClass}>
            {/* No icon: a grey filled circle read as the "Unknown" platform rather than
                as a heading. */}
            {renderSubCaption(t("legendPlatformType"))}
            <div className="legendItems">
              {platformSwatches.map((pc) => (
                <div className="legendItem" key={pc.platform}>
                  <CircleFill
                    className="legendSwatch platformGlyph"
                    size={10}
                    fill={pc.color}
                    aria-hidden="true"
                  />
                  <span className="legendItemLabel">
                    {capitalizeFirstLetter(t(pc.platform))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </>
    );
  }

  function renderTrackKeys() {
    if (!trajectoryOn) return null;
    return (
      <div className={classNames("legendItems", { legendDimmed: !tracksMode })}>
        <TrajectoryDate />
      </div>
    );
  }

  function renderLayerSwitches() {
    if (!layerControls.length) return null;
    return (
      <div className="legendLayerItems">
        {layerControls.map((control) => (
          <Switch
            key={control.key}
            id={`mapLayer-${control.key}`}
            label={control.label}
            checked={control.checked}
            onChange={control.onChange}
            tipTarget={control.tipTarget}
          />
        ))}
      </div>
    );
  }

  const countStatus = renderCountStatus();
  const markerKeys = renderMarkerKeys();
  const hexEntry = renderHexEntry();
  // The compact card keeps only the hex ramp: its days-of-data reading is the one
  // key the map can't give. Four ticks fit a phone corner.
  const compactHexEntry = compact ? renderHexEntry(4) : null;
  const observationsIcon = hexesOnMap ? HEX_ICON : undefined;
  const compactRamp =
    compactHexEntry &&
    renderGroup(
      "observations",
      renderMetricTitle(),
      {
        icon: observationsIcon,
        control: controls.observations,
        tooltip: t("legendMetricDaysTitle"),
        // The dialog's copy of this switch is on screen at the same time.
        idSuffix: "-compact",
      },
      compactHexEntry,
    );
  const trackKeys = renderTrackKeys();
  const bathymetryBar = renderBathymetryBar();
  const layerSwitches = renderLayerSwitches();

  // The last group's switches are labelled already, so they stand in its label
  // row, which puts the group's ⓘ beside them.
  const groups = [
    (countStatus || hexEntry || markerKeys) &&
      renderGroup(
        "observations",
        renderMetricTitle(),
        {
          icon: observationsIcon,
          control: controls.observations,
          tooltip: t("legendMetricDaysTitle"),
        },
        <>
          {countStatus}
          {hexEntry}
          {markerKeys}
        </>,
      ),
    trackKeys &&
      renderGroup(
        "trajectories",
        t("legendGroupTrajectories"),
        { icon: TRACK_ICON, control: controls.tracks },
        trackKeys,
      ),
    bathymetryBar &&
      renderGroup(
        "seafloor",
        t("legendBathymetry"),
        { control: controls.bathymetry, tooltip: t("legendBathymetryTitle") },
        bathymetryBar,
      ),
    layerSwitches && renderGroup("layers", layerSwitches),
  ].filter(Boolean);

  // Compact keeps the card rather than a bare button: the griddap legend stacks
  // against its footprint, and LegendFooter adopts MapLibre's own controls so it
  // must stay mounted exactly once.
  return (
    <div className={classNames("mapLegend", { legendCompact: compact })}>
      <button
        className="legendHeader"
        onClick={() =>
          compact ? setDetailOpen(true) : setLegendOpen(!legendOpen)
        }
        title={
          compact || !legendOpen
            ? t("openLegendTooltip")
            : t("closeLegendTooltip")
        }
        aria-expanded={compact ? undefined : legendOpen}
        aria-haspopup={compact ? "dialog" : undefined}
      >
        <span>{t("legendTitle")}</span>
        {compact ? (
          <ArrowsAngleExpand size={11} aria-hidden="true" />
        ) : legendOpen ? (
          <ChevronCompactUp size={14} aria-hidden="true" />
        ) : (
          <ChevronCompactDown size={14} aria-hidden="true" />
        )}
      </button>
      {compact
        ? compactRamp && (
            <div className="legendBody legendCompactRamp">{compactRamp}</div>
          )
        : legendOpen && <div className="legendBody">{groups}</div>}
      {/* Outside the collapse: the scale bar is as useful with the card shut. */}
      <LegendFooter />
      {/* One mount for the card and the compact dialog, so their ⓘ can't drift. */}
      <LegendHelpModal
        section={helpSection}
        onHide={() => setHelpSection(undefined)}
      />
      {compact && (
        <Modal
          show={detailOpen}
          onHide={() => setDetailOpen(false)}
          className="legendModal"
          aria-labelledby="legendModalTitle"
        >
          <Modal.Header closeButton>
            <Modal.Title id="legendModalTitle">{t("legendTitle")}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <div className="legendBody">{groups}</div>
          </Modal.Body>
        </Modal>
      )}
    </div>
  );
}
