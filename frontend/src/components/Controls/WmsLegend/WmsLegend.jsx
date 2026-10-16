import React, { useState } from "react";
import { ChevronUp, Grid3x3Gap } from "react-bootstrap-icons";
import classNames from "classnames";
import CloseButton from "../../ui/CloseButton.jsx";
import { Dropdown, DropdownButton } from "../../ui/Dropdown.jsx";
import { useTranslation } from "react-i18next";

import { abbreviateString, useChanged, useDebounce } from "../../../utilities";
import { buildGriddapLegendUrl } from "../../../wmsUtilities";
import { GridTimeSlice, GridDepthSlice } from "../GridSlice/GridSlice.jsx";
import useMediaQuery, {
  MOBILE_QUERY,
} from "../../../state/ui/useMediaQuery.js";
import "./styles.css";

// On a phone the colorbar would cover much of the map it keys.
const COMPACT_QUERY = MOBILE_QUERY;

// No caption of its own: ERDDAP draws variable, units, title and slice into
// the legend image.
export default function WmsLegend({
  overlay,
  onClose,
  setActiveWmsOverlay,
  variant = "inline",
}) {
  const { t } = useTranslation();
  const [legendFailed, setLegendFailed] = useState(false);

  const isCompact = useMediaQuery(COMPACT_QUERY) && variant === "card";
  const [compactOpen, setCompactOpen] = useState(false);

  const variables = overlay.variables || [];

  function variableLabel(variable) {
    const name = variable.long_name || variable.standard_name || variable.name;
    return variable.units ? `${name} (${variable.units})` : name;
  }

  // Debounced: each legend request has ERDDAP read a strided slab of the grid.
  const legendUrl = useDebounce(
    buildGriddapLegendUrl({
      erddapUrl: overlay.erddapUrl,
      variable: overlay.variable?.name,
      dimensions: overlay.dimensions,
      time: overlay.time,
      elevation: overlay.elevation,
    }),
    400,
  );

  if (useChanged(legendUrl)) setLegendFailed(false);

  if (isCompact && !compactOpen) {
    return (
      <button
        type="button"
        className="wmsLegendPeek"
        onClick={() => setCompactOpen(true)}
        title={t("wmsLegendShowTitle")}
      >
        <Grid3x3Gap size={15} color="var(--cioos-primary)" aria-hidden="true" />
        <span className="wmsLegendPeekLabel">
          {overlay.variable
            ? variableLabel(overlay.variable)
            : t("wmsLegendShowTitle")}
        </span>
      </button>
    );
  }

  return (
    <div className={classNames("wmsLegend", variant)}>
      {/* Above, not over: the colorbar runs edge to edge with no free corner. */}
      <div className="wmsLegendHeader">
        {variables.length > 1 && (
          <DropdownButton
            className="wmsLegendVariableSelector"
            size="sm"
            variant="outline-secondary"
            tooltip={t("griddapVariableSelect")}
            title={
              <span className="wmsLegendVariableName">
                {overlay.variable ? variableLabel(overlay.variable) : ""}
              </span>
            }
          >
            {variables.map((variable) => (
              <Dropdown.Item
                key={variable.name}
                active={variable.name === overlay.variable?.name}
                onClick={() => setActiveWmsOverlay({ ...overlay, variable })}
              >
                {variableLabel(variable)}
              </Dropdown.Item>
            ))}
          </DropdownButton>
        )}
        {/* Folds back to the button; the other X turns the overlay off. */}
        {isCompact && (
          <CloseButton
            label={t("wmsLegendCollapseTitle")}
            onClick={() => setCompactOpen(false)}
            icon={ChevronUp}
          />
        )}
        {onClose && (
          <CloseButton label={t("wmsLegendCloseTitle")} onClick={onClose} />
        )}
      </div>
      {legendUrl && !legendFailed ? (
        <a
          className="wmsLegendFigure"
          href={overlay.erddapUrl}
          target="_blank"
          rel="noreferrer"
          title={overlay.erddapUrl}
        >
          <img
            className="wmsLegendImage"
            src={legendUrl}
            alt={`${overlay.variable?.name} ${t("griddapLegendAltText")}`}
            onError={() => setLegendFailed(true)}
          />
        </a>
      ) : (
        <div className="wmsLegendFallback">
          <a
            className="wmsLegendTitle"
            href={overlay.erddapUrl}
            target="_blank"
            rel="noreferrer"
            title={overlay.erddapUrl}
          >
            {abbreviateString(overlay.title, 45)}
          </a>
          {overlay.variable && (
            <div className="wmsLegendVariable">
              {variableLabel(overlay.variable)}
            </div>
          )}
          <div className="wmsLegendUnavailable">
            {t("griddapLegendUnavailable")}
          </div>
        </div>
      )}
      <GridTimeSlice
        overlay={overlay}
        onChange={(time) => setActiveWmsOverlay({ ...overlay, time })}
      />
      <GridDepthSlice
        overlay={overlay}
        onChange={(elevation) => setActiveWmsOverlay({ ...overlay, elevation })}
      />
    </div>
  );
}
