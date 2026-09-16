import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Switch from "../../ui/Switch.jsx";

import { buildWmsOverlay, fetchGriddapTimeRange } from "../../../wmsUtilities";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import WmsLegend from "../WmsLegend/WmsLegend.jsx";
import "./styles.css";

// Griddap-specific section of the dataset inspector: grid structure, variable
// list, and (when the ERDDAP serves WMS) the show-on-map switch. While the
// dataset page is open the WmsLegend (variable picker, colorbar) renders inline
// here; when the sidebar is collapsed it moves to the floating card over the
// map (rendered by AppShell). Which slice of the grid is drawn is set on the
// bars along the bottom of the map, beside the filters for the same axes.
export default function GriddapDetails({
  dataset,
  activeWmsOverlay,
  setActiveWmsOverlay,
}) {
  const { t } = useTranslation();
  const { eovsSelected } = useFilters();
  const { pendingWmsSlice, setPendingWmsSlice } = useMapState();
  const { sidebarOpen } = useUI();
  const dimensions = dataset.grid_dimensions || [];
  const variables = dataset.grid_variables || [];
  const overlayActive = activeWmsOverlay?.pk === dataset.pk;

  const selectedEovTitles = (eovsSelected || [])
    .filter((eov) => eov.isSelected)
    .map((eov) => eov.title);

  // The grid's time axis as the server reports it now, read once per dataset.
  // A rolling product moves both ends of that axis between harvests, so the
  // harvested copy would cap the time slider short of the newest slice; reading
  // it here is what lets the catalogue harvest stay infrequent.
  //
  // Tagged with the pk it belongs to, so a dataset switch cannot be mistaken for
  // a resolved fetch: the tag is what the effect below waits on, and comparing
  // it to the current pk is the only way to tell "still loading" from "loaded,
  // and there is no live axis" (both carry an undefined `time`).
  const [liveTime, setLiveTime] = useState({ pk: undefined, time: undefined });
  // Without a WMS endpoint nothing reads the axis and no request is made, so
  // there is nothing to wait for.
  const liveTimeReady = !dataset.wms_url || liveTime.pk === dataset.pk;

  useEffect(() => {
    if (!dataset.wms_url) return undefined;
    let cancelled = false;
    // Never rejects; a failure or a static grid resolves to null and the
    // harvested dimensions stand.
    fetchGriddapTimeRange(dataset.dataset_id).then((time) => {
      if (!cancelled) setLiveTime({ pk: dataset.pk, time });
    });
    return () => {
      cancelled = true;
    };
  }, [dataset.pk, dataset.dataset_id, dataset.wms_url]);

  // The share link's slice, if this is the overlay it was written for, applies
  // to the first overlay built and then gets out of the way — turning the
  // overlay off and back on is a fresh start, not a return to the link.
  function showOverlay() {
    setActiveWmsOverlay(
      buildWmsOverlay(
        dataset,
        selectedEovTitles,
        pendingWmsSlice,
        liveTime.time,
      ),
    );
    if (pendingWmsSlice) setPendingWmsSlice(undefined);
  }

  // Auto-show the WMS overlay when a griddap dataset with a WMS endpoint is
  // inspected. Deliberately keyed on the dataset pk alone (plus the one-shot
  // flip of liveTimeReady): toggling the overlay off must not immediately
  // re-show it, so the effect only re-runs when a different dataset is
  // inspected. Waiting for the live axis rather than showing the overlay twice
  // keeps the slider from jumping under a user who has already moved it.
  useEffect(() => {
    if (!liveTimeReady) return;
    if (dataset.wms_url && variables.length) showOverlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset.pk, liveTimeReady]);

  function formatDimensionValue(value) {
    if (value === null || value === undefined) return "—";
    if (typeof value === "number") {
      return Number.isInteger(value) ? value : value.toFixed(4);
    }
    // ISO time strings: keep them readable
    return String(value).replace("T", " ").replace("+00:00", "Z");
  }

  function variableLabel(variable) {
    return variable.long_name || variable.standard_name || variable.name;
  }

  return (
    <div className="griddapDetails">
      {dataset.wms_url ? (
        <div className="metadataGridItem griddapWmsControls">
          <strong>{t("griddapMapPreviewTitle")}</strong>
          <Switch
            id="griddapShowOnMapSwitch"
            label={t("griddapShowOnMapToggle")}
            checked={overlayActive}
            disabled={!variables.length}
            onChange={(event) =>
              event.target.checked ? showOverlay() : setActiveWmsOverlay()
            }
          />
          {overlayActive && sidebarOpen && (
            <WmsLegend
              overlay={activeWmsOverlay}
              variant="inline"
              onClose={() => setActiveWmsOverlay()}
              setActiveWmsOverlay={setActiveWmsOverlay}
            />
          )}
        </div>
      ) : (
        <div className="metadataGridItem griddapNoWms">
          {t("griddapNoWmsText")}
        </div>
      )}
      <div className="metadataGridItem">
        <strong>{t("griddapDimensionsTitle")}</strong>
        {/* One card per axis rather than a 5-column table: at the sidebar's
            width the table's columns collapsed into unreadable slivers. */}
        <ul className="griddapDimensionsList">
          {dimensions.map((dim) => (
            <li key={dim.name} className="griddapDimension">
              <div className="griddapDimensionHead">
                <span className="griddapDimensionName">{dim.name}</span>
                <span className="griddapDimensionNodes">
                  {dim.n_values?.toLocaleString()}{" "}
                  {t("griddapDimensionNodes").toLowerCase()}
                </span>
              </div>
              <div className="griddapDimensionRange">
                <span className="griddapDimensionBound">
                  {formatDimensionValue(dim.min)}
                </span>
                <span className="griddapDimensionArrow">→</span>
                <span className="griddapDimensionBound">
                  {formatDimensionValue(dim.max)}
                </span>
                {dim.units && (
                  <span className="griddapDimensionUnits">{dim.units}</span>
                )}
              </div>
              {dim.spacing && (
                <div className="griddapDimensionSpacing">
                  {t("griddapDimensionResolution")}: {dim.spacing}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div className="metadataGridItem">
        <strong>{t("griddapVariablesTitle")}</strong>
        <ul className="griddapVariablesList">
          {variables.map((variable) => (
            <li key={variable.name} className="griddapVariable">
              <div className="griddapVariableHead">
                <span className="griddapVariableLabel">
                  {variableLabel(variable)}
                </span>
                {variable.units && (
                  <span className="griddapVariableUnits">
                    ({variable.units})
                  </span>
                )}
              </div>
              <code className="griddapVariableName">{variable.name}</code>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
