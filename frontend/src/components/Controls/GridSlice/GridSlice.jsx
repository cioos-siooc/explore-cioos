import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "react-bootstrap-icons";

import {
  gridAxisNodes,
  getTimeDimension,
  getVerticalDimension,
  snapToGridNode,
  toElevation,
} from "../../../wmsUtilities";
import Rail from "../Rail/Rail.jsx";
import { DateField } from "../TimeRail/TimeRail.jsx";
import { DepthField } from "../DepthRail/DepthRail.jsx";
import { MS_PER_DAY, msToIso } from "../TimeRail/timeAxis.js";
import gridTimeTicks from "./gridTimeTicks.js";
import "./styles.css";

// The harvest can carry a vertical axis with unknown bounds; a NaN node would
// place the marker nowhere.
function finiteNodes(min, max, count) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return gridAxisNodes(min, max, count);
}

export function gridTimeNodes(overlay) {
  const dimension = getTimeDimension(overlay?.dimensions);
  if (!dimension) return null;
  return finiteNodes(
    Date.parse(dimension.min),
    Date.parse(dimension.max),
    dimension.n_values,
  );
}

// Positive-down depth; ERDDAP's WMS ELEVATION is altitude, so it's negated and
// the endpoints swap on an altitude grid.
export function gridDepthNodes(overlay) {
  const dimension = getVerticalDimension(overlay?.dimensions);
  if (!dimension) return null;
  const ends = [dimension.min, dimension.max].map(
    (value) => -toElevation(dimension, value),
  );
  return finiteNodes(Math.min(...ends), Math.max(...ends), dimension.n_values);
}

function SliceRow({
  className,
  index,
  count,
  prevLabel,
  nextLabel,
  countTitle,
  onStep,
  children,
}) {
  return (
    <div className={`gridSliceRow ${className}`}>
      <button
        type="button"
        className="railStep"
        title={prevLabel}
        aria-label={prevLabel}
        disabled={index <= 0}
        onClick={() => onStep(-1)}
      >
        <ChevronLeft size={10} />
      </button>
      {children}
      <button
        type="button"
        className="railStep"
        title={nextLabel}
        aria-label={nextLabel}
        disabled={index >= count - 1}
        onClick={() => onStep(1)}
      >
        <ChevronRight size={10} />
      </button>
      <span className="gridSliceCount" title={countTitle}>
        {index + 1} / {count}
      </span>
    </div>
  );
}

export function GridTimeSlice({ overlay, onChange }) {
  const nodes = gridTimeNodes(overlay);
  if (!nodes) return null;
  return <TimeSlice nodes={nodes} time={overlay.time} onChange={onChange} />;
}

// Split out so the hooks below never run for an overlay without the axis.
function TimeSlice({ nodes, time, onChange }) {
  const { t } = useTranslation();

  // A share link or the harvest can hand over an instant between two slices.
  const valueMs = snapToGridNode(nodes, Date.parse(time));
  const iso = new Date(valueMs).toISOString();
  const subDaily = nodes.step < MS_PER_DAY;
  const index = Math.round((valueMs - nodes.min) / nodes.step);

  const commit = useCallback(
    (ms) => onChange(new Date(snapToGridNode(nodes, ms)).toISOString()),
    [nodes, onChange],
  );

  const axis = useMemo(
    () => ({
      min: nodes.min,
      max: nodes.max,
      minText: new Date(nodes.min).toISOString(),
      maxText: new Date(nodes.max).toISOString(),
      toPos: (ms) => (ms - nodes.min) / (nodes.max - nodes.min),
      toValue: (pos) => nodes.min + pos * (nodes.max - nodes.min),
    }),
    [nodes],
  );

  const ticksFor = useCallback(
    (railLength) => gridTimeTicks(railLength, nodes.min, nodes.max),
    [nodes],
  );

  return (
    <div className="gridSlice">
      <SliceRow
        className="gridSliceTime"
        index={index}
        count={nodes.count}
        prevLabel={t("gridTimePrev")}
        nextLabel={t("gridTimeNext")}
        countTitle={t("gridTimeCountTitle", {
          index: index + 1,
          total: nodes.count,
        })}
        onStep={(delta) => commit(valueMs + delta * nodes.step)}
      >
        <DateField
          className="railValueInput timeRailDateInput gridSliceDateInput"
          label={t("gridTimeLabel")}
          value={iso.slice(0, 10)}
          min={msToIso(nodes.min)}
          max={msToIso(nodes.max)}
          onCommit={(value) => commit(Date.parse(`${value}T00:00:00Z`))}
        />
        {subDaily && (
          <span className="gridSliceClock">{iso.slice(11, 16)}</span>
        )}
      </SliceRow>
      {/* Only time gets a rail: thousands of slices vs. tens of levels. */}
      <Rail
        className="gridSliceRail"
        axis={axis}
        handles={[
          {
            key: "grid",
            value: valueMs,
            valueText: iso,
            label: t("gridTimeLabel"),
            className: "railHandleMarker railHandleGrid",
          },
        ]}
        bands={[
          {
            key: "elapsed",
            from: nodes.min,
            to: valueMs,
            className: "gridSliceFill",
          },
        ]}
        ticksFor={ticksFor}
        snap={(ms) => snapToGridNode(nodes, ms)}
        stepFor={(event) =>
          nodes.step * (event.shiftKey || event.key.startsWith("Page") ? 10 : 1)
        }
        onCommit={(handle, ms) => commit(ms)}
      />
    </div>
  );
}

export function GridDepthSlice({ overlay, onChange }) {
  const dimension = getVerticalDimension(overlay?.dimensions);
  const nodes = gridDepthNodes(overlay);
  if (!nodes) return null;
  return (
    <DepthSlice
      nodes={nodes}
      elevation={overlay.elevation}
      // Nodes are always depth so stepping runs top-down, but the figure shown
      // is the dataset's own: an altitude grid mustn't read as negative depths.
      positiveUp={dimension.name !== "depth"}
      units={dimension.units || "m"}
      onChange={onChange}
    />
  );
}

function DepthSlice({ nodes, elevation, positiveUp, units, onChange }) {
  const { t } = useTranslation();

  const depth = snapToGridNode(nodes, -elevation);
  const index = Math.round((depth - nodes.min) / nodes.step);

  // Self-inverse, so it converts in both directions.
  const shown = (value) => (positiveUp ? -value : value);
  const bounds = [shown(nodes.min), shown(nodes.max)].sort((a, b) => a - b);

  function commit(value) {
    onChange(-snapToGridNode(nodes, shown(value)));
  }

  return (
    <SliceRow
      className="gridSliceDepth"
      index={index}
      count={nodes.count}
      prevLabel={t("gridDepthPrev")}
      nextLabel={t("gridDepthNext")}
      countTitle={t("gridDepthCountTitle", {
        index: index + 1,
        total: nodes.count,
      })}
      onStep={(delta) =>
        onChange(-snapToGridNode(nodes, depth + delta * nodes.step))
      }
    >
      <DepthField
        className="railValueInput gridSliceDepthInput"
        label={t("gridDepthLabel")}
        value={Math.round(shown(depth))}
        min={Math.ceil(bounds[0])}
        max={Math.floor(bounds[1])}
        onCommit={commit}
      />
      <span className="gridSliceUnits">{units}</span>
    </SliceRow>
  );
}
