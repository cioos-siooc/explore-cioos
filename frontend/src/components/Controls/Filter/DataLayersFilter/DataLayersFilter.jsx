import * as React from "react";
import { useTranslation } from "react-i18next";

import {
  DATA_LAYER_HINT_KEYS,
  DATA_LAYER_KEYS,
  DATA_LAYER_LABEL_KEYS,
} from "../../../../state/dataLayers.js";
import { useMapState } from "../../../../state/map/MapStateProvider.jsx";
import { FilterOption } from "../MultiCheckboxFilter/OptionState.jsx";
import "./styles.css";

// Gates the datasets list for every row, but the map tiles only for the
// point/path rows: griddap coverage is its own map layer.
export default function DataLayersFilter() {
  const { t } = useTranslation();
  const { dataLayerChoices, toggleDataLayer } = useMapState();

  return (
    <div className="multiCheckboxFilter dataLayersFilter">
      {DATA_LAYER_KEYS.map((key) => {
        const state = {
          isSelected: dataLayerChoices[key] === "include",
          isExcluded: dataLayerChoices[key] === "exclude",
        };
        return (
          <FilterOption
            key={key}
            label={t(DATA_LAYER_LABEL_KEYS[key])}
            {...state}
            onInclude={() => toggleDataLayer(key, "include")}
            onExclude={() => toggleDataLayer(key, "exclude")}
          >
            <span className="optionName">
              {t(DATA_LAYER_LABEL_KEYS[key])}
              <span className="optionHint">{t(DATA_LAYER_HINT_KEYS[key])}</span>
            </span>
          </FilterOption>
        );
      })}
    </div>
  );
}
