import React, { useState } from "react";
import { ChevronDown, ChevronUp, Grid3x3Gap } from "react-bootstrap-icons";
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

  // Folded on a phone, a picker stays out so a variable is one tap away; only
  // the colorbar and the slices fold. With nothing to pick, the button alone.
  const folded = isCompact && !compactOpen;
  if (folded && variables.length < 2) {
    return (
      <button
        type="button"
        className="wmsLegendPeek"
        onClick={() => setCompactOpen(true)}
        title={t("wmsLegendShowTitle")}
      >
        <Grid3x3Gap size={15} aria-hidden="true" />
        <span className="wmsLegendPeekLabel">
          {overlay.variable
            ? variableLabel(overlay.variable)
            : t("wmsLegendShowTitle")}
        </span>
        <ChevronDown aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className={classNames("wmsLegend", variant)}>
      {/* Above, not over: the colorbar runs edge to edge with no free corner. */}
      <div className="wmsLegendHeader">
        {variables.length > 1 && (
          <div className="wmsLegendField">
            {/* The card is short on height; its field reads as a picker
                and its name says what it picks. */}
            {variant === "inline" && (
              <span className="wmsLegendFieldLabel">
                {t("griddapVariableSelect")}
              </span>
            )}
            <DropdownButton
              className="wmsLegendVariableSelector"
              aria-label={`${t("griddapVariableSelect")}: ${
                overlay.variable ? variableLabel(overlay.variable) : ""
              }`}
              selectedKey={overlay.variable?.name}
              // Over the colorbar it is choosing for, not the label above.
              shouldFlip={false}
              title={
                <>
                  <span className="wmsLegendVariableName">
                    {overlay.variable ? variableLabel(overlay.variable) : ""}
                  </span>
                  <ChevronDown
                    className="wmsLegendVariableChevron"
                    aria-hidden="true"
                  />
                </>
              }
            >
              {variables.map((variable) => (
                <Dropdown.Item
                  key={variable.name}
                  id={variable.name}
                  onAction={() => setActiveWmsOverlay({ ...overlay, variable })}
                >
                  {variableLabel(variable)}
                </Dropdown.Item>
              ))}
            </DropdownButton>
          </div>
        )}
        {isCompact && (
          <button
            type="button"
            className="wmsLegendFold"
            onClick={() => setCompactOpen(!compactOpen)}
            aria-expanded={compactOpen}
            title={t(
              compactOpen ? "wmsLegendCollapseTitle" : "wmsLegendShowTitle",
            )}
          >
            <Grid3x3Gap aria-hidden="true" />
            {t("wmsLegendFoldText")}
            {compactOpen ? (
              <ChevronUp aria-hidden="true" />
            ) : (
              <ChevronDown aria-hidden="true" />
            )}
          </button>
        )}
        {onClose && (
          <CloseButton label={t("wmsLegendCloseTitle")} onClick={onClose} />
        )}
      </div>
      {!folded && (
        <>
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
            onChange={(elevation) =>
              setActiveWmsOverlay({ ...overlay, elevation })
            }
          />
        </>
      )}
    </div>
  );
}
