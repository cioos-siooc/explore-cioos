import * as React from "react";
import { useTranslation } from "react-i18next";

import {
  DATA_LAYER_HINT_KEYS,
  DATA_LAYER_KEYS,
  DATA_LAYER_LABEL_KEYS,
} from "../../../../state/dataLayers.js";
import { useMapState } from "../../../../state/map/MapStateProvider.jsx";
import {
  ExcludedLabel,
  OptionStateIcon,
  optionStateClass,
} from "../MultiCheckboxFilter/OptionState.jsx";
import "./styles.css";

// Which observation geometries the map draws. It behaves as every other list
// filter does: a click cycles include -> exclude -> clear, nothing picked means
// unfiltered (all seven drawn), and the map draws the included geometries (or
// all of them, when none is included) minus the excluded ones. The selection gates the datasets list and its counts for
// every row (see datasetInDataLayers), and additionally gates the map's point/
// hex tiles for the six point- and path-sampling rows — grid has no tile
// equivalent to narrow, since griddap coverage is its own map layer.
//
// Each row carries a hint line: what the geometry means in plain terms and the
// platforms that typically produce it. "TimeSeriesProfile" tells a data manager
// exactly what it is and a visitor nothing at all, and the hint is what closes
// that gap without renaming the CF types.
//
// Seven rows and nothing else. The track-lines / hex-cells switches used to
// hang off the trajectory pair here, which put the same two controls in two
// places once the legend grew switches of its own — and they never belonged in
// a filter: they change how the trajectories are drawn, not which datasets are
// selected. They live on the legend entries they key (see Legend.jsx).
export default function DataLayersFilter() {
  const { t } = useTranslation();
  const { dataLayerChoices, cycleDataLayer } = useMapState();

  return (
    <div className="multiCheckboxFilter dataLayersFilter">
      {DATA_LAYER_KEYS.map((key) => {
        const state = {
          isSelected: dataLayerChoices[key] === "include",
          isExcluded: dataLayerChoices[key] === "exclude",
        };
        return (
          <div
            key={key}
            className={optionStateClass(state)}
            role="checkbox"
            aria-checked={state.isSelected}
            tabIndex={0}
            onClick={() => cycleDataLayer(key)}
            onKeyDown={(event) => {
              if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                cycleDataLayer(key);
              }
            }}
          >
            <OptionStateIcon {...state} />
            <span className="optionName">
              {t(DATA_LAYER_LABEL_KEYS[key])}
              <span className="optionHint">{t(DATA_LAYER_HINT_KEYS[key])}</span>
            </span>
            <ExcludedLabel {...state} />
          </div>
        );
      })}
    </div>
  );
}
