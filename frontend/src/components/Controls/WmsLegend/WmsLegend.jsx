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

// On a phone the colorbar would be a large fraction of the map it keys, so in
// the map card it stands down to a button naming the variable and opens only
// when asked.
const COMPACT_QUERY = MOBILE_QUERY;

// Shown while a griddap WMS overlay is active: the colorbar, the variable picker
// over it, and the slice controls. It renders inside the dataset page
// (`inline`, with the overlay's off switch) or, while that page is minimized,
// inside the map card that stands in for it (`card`, see DatasetMapCard).
//
// The card carries no caption of its own. ERDDAP draws one into the legend
// image — the variable and its units, the dataset title, and the slice being
// shown — so anything written beside it would only be the same words in a
// second typeface. The image is the title, and it links where the title used
// to: the dataset's page on ERDDAP.
//
// Which slice of the grid is drawn — in time and in depth — is set here, under
// the image (see GridSlice). Both used to be on the bars along the edges of the
// map, beside the filters for the same axes, the reasoning being that a date
// belongs with the other dates. But the caption they change is the one drawn
// into this image, and a control a screen away from its own reading is a
// control that has to be hunted for. The bars are the filters now, and this
// card is the overlay.
export default function WmsLegend({
  overlay,
  onClose,
  setActiveWmsOverlay,
  variant = "inline",
}) {
  const { t } = useTranslation();
  const [legendFailed, setLegendFailed] = useState(false);

  // Only the map card is drawn over the map; the inline one is inside the
  // dataset page and always has its own room.
  const isCompact = useMediaQuery(COMPACT_QUERY) && variant === "card";
  const [compactOpen, setCompactOpen] = useState(false);

  const variables = overlay.variables || [];

  // "long_name (units)" on a single line — the units are folded into the
  // picker label rather than shown on a separate line beneath it.
  function variableLabel(variable) {
    const name = variable.long_name || variable.standard_name || variable.name;
    return variable.units ? `${name} (${variable.units})` : name;
  }

  // The legend is asked for the slice actually on the map, so its caption
  // stays true while the grid rails are moved — but it is asked once the
  // moving stops. Each request has ERDDAP read a strided slab of the grid,
  // which is not something to spend on every step of a drag.
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

  // A new legend image gets a fresh chance to load.
  if (useChanged(legendUrl)) setLegendFailed(false);

  // Stood down to a button (see COMPACT_QUERY). It names the variable rather
  // than saying "Legend": what the overlay is drawing is the one thing worth
  // knowing without opening the card, and it is the thing the colorbar's
  // caption would have said.
  //
  // The icon is the same Grid3x3Gap in the same teal the datasets list marks a
  // gridded dataset with (see DatasetCard) — this button stands for one of
  // those, and a mark it already uses elsewhere says so without a caption.
  if (isCompact && !compactOpen) {
    return (
      <button
        type="button"
        className="wmsLegendPeek"
        onClick={() => setCompactOpen(true)}
        title={t("wmsLegendShowTitle")}
      >
        <Grid3x3Gap size={15} color="#52a79b" aria-hidden="true" />
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
      {/* One row above the image, holding the two controls: what is drawn, and
          (on the page) the way out. It sits above rather than over the image because the top
          of the image is the colorbar, edge to edge, with no corner to cover
          without covering a reading. A dataset serving one variable has
          nothing to pick, and the image has already named it — then the row is
          whatever is left of the other two, or nothing. */}
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
        {/* Folds the card back to its button. Distinct from the X beside it,
            which turns the overlay off — this one only stops showing its key,
            and it is only here where the card has a button to fold back to. */}
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
        // With no image there is nothing to read the dataset off, so the card
        // says it itself — the one case it has to.
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
      {/* Under the image, because they change what the image says: the caption
          ERDDAP draws into the colorbar names the slice being shown. */}
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
