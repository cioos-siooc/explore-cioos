import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "react-bootstrap-icons";

import Rail from "../Rail/Rail.jsx";
import { formatInstant } from "../../../utilities.jsx";

// Which profile of a record is drawn.
//
// A depth plot means ONE cast. The record is the station or the track, and
// /preview's window holds several of its profiles, so without this they were
// drawn on top of each other and the figure was titled after three of them and
// "+332". This picks one; its first stop draws the window as it arrives, which
// is what the plot did before and is still the useful read with colour-by-time
// set.
//
// Modelled on GridSlice's slider — the same Rail, the same steppers, the same
// "n / N" readout — because picking which slice of a grid is painted and
// picking which cast of a station is plotted are the same act. Deliberately NOT
// refactored into a shared component with it: they share thirty lines of
// chevrons, and GridSlice is otherwise no part of this work.
//
// It sits ABOVE the figure rather than in the parameters pane: the pane is
// ~200px, which ellipsised the one thing this control exists to show — which
// cast is drawn, and when it was taken.

// Stop 0 is every profile at once; the profiles themselves start at 1.
const ALL = 0;

// The spelling the record card this preview was opened from already uses, so
// the card and the slider name a cast the same way. A record whose profiles
// carry no time falls back to the id itself.
const timeText = (step) =>
  step ? formatInstant(step.time) || String(step.value) : "";

export default function ProfileSlice({ profiles, step, setStep }) {
  const { t } = useTranslation();
  // Memoised because the `|| []` fallback is a fresh array every render, which
  // would re-run every hook below it on every keystroke elsewhere in the pane.
  const steps = useMemo(() => (profiles && profiles.steps) || [], [profiles]);
  // A record that is itself one cast of a station: /preview draws that cast
  // when no step is set, so there is no All stop to offer.
  const current = (profiles && profiles.current) || null;
  const first = current ? 1 : ALL;

  const index = useMemo(() => {
    const drawn = step || current;
    if (!drawn) return ALL;
    const at = steps.findIndex((entry) => entry.value === drawn);
    // A link naming a profile this record does not have falls back to the
    // window rather than to an empty plot.
    return at < 0 ? first : at + 1;
  }, [step, current, first, steps]);

  // Where the handle sits mid-drag; the plot only refetches on release.
  const [draftIndex, setDraftIndex] = useState(null);
  const shownIndex = draftIndex ?? index;

  const clampIndex = useCallback(
    (next) => Math.max(first, Math.min(steps.length, Math.round(next))),
    [steps, first],
  );

  const commit = useCallback(
    (next) => {
      const clamped = clampIndex(next);
      setStep(clamped === ALL ? null : steps[clamped - 1].value);
    },
    [steps, setStep, clampIndex],
  );

  const axis = useMemo(() => {
    const span = steps.length - first;
    return {
      min: first,
      max: steps.length,
      minText: first === ALL ? t("previewProfileSliceAll") : timeText(steps[0]),
      maxText: timeText(steps[steps.length - 1]),
      toPos: (value) => (span > 0 ? (value - first) / span : 0),
      toValue: (position) => first + position * span,
    };
  }, [steps, first, t]);

  // One profile and the "All" stop draw the same rows, so there is nothing to
  // step through — which is what hides this for Profile, TimeSeries, Trajectory
  // and for a transect holding a single profile.
  if (steps.length < 2) return null;

  const label =
    shownIndex === ALL
      ? t("previewProfileSliceAll")
      : timeText(steps[shownIndex - 1]);

  // What the "n / N" means. On the All stop that is the window, not the record:
  // the rows drawn are the tail /preview returns, which is a different claim
  // from "all 335 casts". Past MAX_STEPS the list is a sample of the record, and
  // saying so is the difference between a slider that skips and one that lies.
  let countTitle;
  if (shownIndex === ALL) {
    countTitle = t("previewProfileSliceWindow");
  } else if (profiles.truncated) {
    countTitle = t("previewProfileSliceSampled", {
      index: shownIndex,
      shown: steps.length,
      total: profiles.count,
    });
  } else {
    countTitle = t("previewProfileSliceOf", {
      index: shownIndex,
      total: steps.length,
    });
  }

  return (
    <div className="previewProfileSlice">
      <div className="previewProfileSliceReadout">
        <span className="previewProfileSliceLabel" title={countTitle}>
          {label}
        </span>
        <span className="previewProfileSliceCount" title={countTitle}>
          {shownIndex} / {steps.length}
        </span>
      </div>
      <div className="previewProfileSliceControls">
        <button
          type="button"
          className="railStep"
          title={t("previewProfileSlicePrevious")}
          aria-label={t("previewProfileSlicePrevious")}
          disabled={shownIndex <= first}
          onClick={() => commit(shownIndex - 1)}
        >
          <ChevronLeft size={10} />
        </button>
        <Rail
          className="previewProfileSliceRail"
          axis={axis}
          handles={[
            {
              key: "profile",
              value: shownIndex,
              valueText: label,
              label: t("previewProfileSlice"),
              className: "railHandleMarker railHandleGrid",
            },
          ]}
          // How far into the record the drawn profile sits. Nothing is filtered
          // by it — the marker alone is too small to read at a glance.
          bands={[
            {
              key: "elapsed",
              from: first,
              to: shownIndex,
              className: "previewProfileSliceFill",
            },
          ]}
          // No tick labels: a cast id is far too long to sit under a rail, and
          // the readout above it already names the one that is drawn.
          ticksFor={() => []}
          snap={(value) => Math.round(value)}
          stepFor={(event) =>
            event.shiftKey || event.key?.startsWith("Page") ? 10 : 1
          }
          onDrag={(handleKey, value) => setDraftIndex(clampIndex(value))}
          onCommit={(handleKey, value) => {
            setDraftIndex(null);
            commit(value);
          }}
        />
        <button
          type="button"
          className="railStep"
          title={t("previewProfileSliceNext")}
          aria-label={t("previewProfileSliceNext")}
          disabled={shownIndex >= steps.length}
          onClick={() => commit(shownIndex + 1)}
        >
          <ChevronRight size={10} />
        </button>
      </div>
    </div>
  );
}
