import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Switch from "../../ui/Switch.jsx";

import { buildWmsOverlay, fetchGriddapTimeRange } from "../../../wmsUtilities";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import { useTips } from "../../../state/tips/TipsProvider.jsx";
import WmsLegend from "../WmsLegend/WmsLegend.jsx";
import "./styles.css";

// WmsLegend renders inline here while the page is open; with the sidebar
// collapsed it moves into DatasetMapCard.
export default function GriddapDetails({
  dataset,
  activeWmsOverlay,
  setActiveWmsOverlay,
}) {
  const { t } = useTranslation();
  const { eovsSelected } = useFilters();
  const { pendingWmsSlice, setPendingWmsSlice } = useMapState();
  const { sidebarOpen } = useUI();
  const { offerTip } = useTips();
  useEffect(() => offerTip("griddapWms"), [offerTip]);
  const dimensions = dataset.grid_dimensions || [];
  const variables = dataset.grid_variables || [];
  const overlayActive = activeWmsOverlay?.pk === dataset.pk;

  const selectedEovTitles = (eovsSelected || [])
    .filter((eov) => eov.isSelected)
    .map((eov) => eov.title);

  // Read live: a rolling product moves both ends of its time axis between
  // harvests. Tagged with the pk so "still loading" and "loaded, no live axis"
  // (both an undefined `time`) can be told apart across dataset switches.
  const [liveTime, setLiveTime] = useState({ pk: undefined, time: undefined });
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

  // The share link's slice applies to the first overlay built only; toggling
  // off and on is a fresh start.
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

  function selectVariable(variable) {
    if (overlayActive) {
      setActiveWmsOverlay({ ...activeWmsOverlay, variable });
    } else {
      setActiveWmsOverlay(
        buildWmsOverlay(
          dataset,
          selectedEovTitles,
          { variable: variable.name },
          liveTime.time,
        ),
      );
    }
  }

  // Keyed on the pk alone so toggling the overlay off doesn't re-show it; waits
  // for the live axis so the slider doesn't jump under the user.
  useEffect(() => {
    if (!liveTimeReady) return;
    if (dataset.wms_url && variables.length) showOverlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset.pk, liveTimeReady]);

  function formatDimensionValue(value) {
    if (value === null || value === undefined) return "—";
    if (typeof value === "number") {
      return Number.isInteger(value) ? value : Number(value.toFixed(4));
    }
    return String(value).replace("T", " ").replace("+00:00", "Z");
  }

  function variableLabel(variable) {
    return variable.long_name || variable.standard_name || variable.name;
  }

  return (
    <div className="griddapDetails">
      {dataset.wms_url ? (
        <div className="metadataCard griddapWmsCard">
          <div className="metadataCardHeader griddapWmsHeader">
            <h3 className="griddapCardTitle">{t("griddapMapPreviewTitle")}</h3>
            <Switch
              id="griddapShowOnMapSwitch"
              tipTarget="griddapWms"
              label={t("griddapShowOnMapToggle")}
              checked={overlayActive}
              disabled={!variables.length}
              onChange={(event) =>
                event.target.checked ? showOverlay() : setActiveWmsOverlay()
              }
            />
          </div>
          {overlayActive && sidebarOpen && (
            <WmsLegend
              overlay={activeWmsOverlay}
              variant="inline"
              setActiveWmsOverlay={setActiveWmsOverlay}
            />
          )}
        </div>
      ) : (
        <div className="metadataCard griddapNoWms">{t("griddapNoWmsText")}</div>
      )}
      <div className="metadataCard">
        <h3 className="griddapCardTitle">{t("griddapVariablesTitle")}</h3>
        <ul className="griddapVariablesList">
          {variables.map((variable) => {
            const content = (
              <>
                <span className="griddapVariableHead">
                  <span className="griddapVariableLabel">
                    {variableLabel(variable)}
                  </span>
                  {variable.units && (
                    <span className="griddapVariableUnits">
                      ({variable.units})
                    </span>
                  )}
                </span>
                <code className="griddapVariableName">{variable.name}</code>
              </>
            );
            return (
              <li key={variable.name}>
                {dataset.wms_url ? (
                  <button
                    type="button"
                    className="griddapVariable"
                    aria-pressed={
                      overlayActive &&
                      activeWmsOverlay.variable?.name === variable.name
                    }
                    title={t("griddapVariableShowTitle")}
                    onClick={() => selectVariable(variable)}
                  >
                    {content}
                  </button>
                ) : (
                  <div className="griddapVariable">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="metadataCard">
        <h3 className="griddapCardTitle">{t("griddapDimensionsTitle")}</h3>
        <dl className="griddapDimensionsList">
          {dimensions.map((dim) => (
            <div key={dim.name} className="griddapDimension">
              <dt className="griddapDimensionName">{dim.name}</dt>
              <dd className="griddapDimensionRange">
                {formatDimensionValue(dim.min)}
                <span className="griddapDimensionMuted"> → </span>
                {formatDimensionValue(dim.max)}
                {dim.units && (
                  <span className="griddapDimensionMuted"> {dim.units}</span>
                )}
              </dd>
              <dd className="griddapDimensionMeta">
                {[
                  dim.n_values != null &&
                    `${dim.n_values.toLocaleString()} ${t("griddapDimensionNodes").toLowerCase()}`,
                  dim.spacing &&
                    `${t("griddapDimensionResolution").toLowerCase()} ${dim.spacing}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
