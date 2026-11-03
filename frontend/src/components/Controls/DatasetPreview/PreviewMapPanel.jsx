import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import debounce from "lodash-es/debounce";

import CloseButton from "../../ui/CloseButton.jsx";
import SelectPill from "../../ui/SelectPill.jsx";
import Spinner from "../../ui/Spinner.jsx";
import ColorScaleLegend from "../DatasetPreviewPlot/ColorScaleLegend.jsx";
import ColorScalePicker from "../DatasetPreviewPlot/ColorScalePicker.jsx";
import { usePreviewPlot } from "./PreviewPlotProvider.jsx";
import { previewMapLayerFor } from "./previewMapFeatures.js";
import { autoScaleNameFor } from "./previewColorScales.js";
import { labelFor, shortLabelFor } from "./previewVariables.js";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import useWideView from "../../../state/selection/useWideView.js";
import "../DatasetPreviewPlot/styles.css";

// A slider drag would otherwise write the URL on every pixel.
const DEPTH_WRITE_MS = 250;
const SLIDER_STEPS = 200;

const roundDepth = (value) => Math.round(value * 10) / 10;

/**
 * The preview's map view: the record drawn on the main map, and this card
 * standing in for the modal. It owns the layer while it is mounted.
 */
export default function PreviewMapPanel({ viewToggle, loading, onClose }) {
  const { t, i18n } = useTranslation();
  const { setPreviewMapLayer } = useSelection();
  // Widened, the dataset page covers the map this view draws on.
  const [wide, setWide] = useWideView();
  useEffect(() => {
    if (wide) setWide(false);
  }, [wide, setWide]);
  const {
    inspectDataset,
    inspectRecordID,
    variables,
    variablesByName,
    plotData,
    colorCandidates,
    mapColor,
    setMapColor,
    mapDepth,
    setMapDepth,
    variableScales,
    setVariableScale,
  } = usePreviewPlot();

  // Drawn from local state while the slider moves; the URL catches up.
  const [depth, setDepth] = useState(mapDepth);
  const [depthRecordID, setDepthRecordID] = useState(inspectRecordID);
  if (depthRecordID !== inspectRecordID) {
    setDepthRecordID(inspectRecordID);
    setDepth(mapDepth);
  }
  const writeDepth = useMemo(
    () => debounce(setMapDepth, DEPTH_WRITE_MS),
    [setMapDepth],
  );
  // Cancelled, not flushed: a close clears the plot params, and a late write
  // would put one back.
  useEffect(() => () => writeDepth.cancel(), [writeDepth]);

  const colorVariable = variablesByName.get(mapColor) || null;
  const layer = useMemo(
    () =>
      loading
        ? null
        : previewMapLayerFor({
            dataset: inspectDataset,
            variables,
            data: plotData,
            colorVariable,
            scaleName: variableScales[mapColor],
            depth,
          }),
    [
      loading,
      inspectDataset,
      variables,
      plotData,
      colorVariable,
      variableScales,
      mapColor,
      depth,
    ],
  );

  const frameKey = `${inspectDataset?.dataset_id}|${inspectRecordID}`;
  useEffect(() => {
    setPreviewMapLayer(layer ? { ...layer, frameKey } : undefined);
  }, [layer, frameKey, setPreviewMapLayer]);
  useEffect(() => () => setPreviewMapLayer(undefined), [setPreviewMapLayer]);

  const formatCount = (count) => count.toLocaleString(i18n.language);
  const span = layer?.depth ? layer.depth.max - layer.depth.min : 0;

  return (
    <section
      className="previewMapPanel"
      data-testid="preview-map-panel"
      data-map-cover
      aria-label={inspectDataset?.title}
    >
      <div className="previewMapPanelHead">
        {viewToggle}
        <CloseButton label={t("datasetPreviewCloseText")} onClick={onClose} />
      </div>
      <p className="previewMapPanelTitle" title={inspectDataset?.title}>
        {inspectDataset?.title}:{" "}
        <i className="datasetPreviewRecord">{inspectRecordID}</i>
      </p>

      {loading ? (
        <div className="previewMapPanelStatus" role="status">
          <Spinner size="sm" role="presentation" />
          {t("skeletonLoadingLabel")}
        </div>
      ) : !layer ? (
        <p className="previewMapPanelStatus">{t("previewMapNoPositions")}</p>
      ) : (
        <>
          <div className="previewMapPanelControls">
            <SelectPill
              label={t("datasetPreviewPlotColorBy")}
              value={mapColor || ""}
              options={colorCandidates.map((variable) => ({
                id: variable.columnName,
                label: shortLabelFor(variable),
              }))}
              onChange={setMapColor}
              data-testid="preview-map-color"
            />
            {colorVariable && (
              <ColorScalePicker
                value={variableScales[mapColor] || null}
                autoName={autoScaleNameFor(colorVariable)}
                onPick={(name) => setVariableScale(mapColor, name)}
              />
            )}
          </div>
          <ColorScaleLegend legend={layer.legend} />

          {layer.depth && (
            <label className="previewMapPanelDepth">
              <span className="previewMapPanelDepthLabel">
                {labelFor(layer.depth.variable)}
                <output>{roundDepth(layer.depth.value)}</output>
              </span>
              <input
                type="range"
                min={layer.depth.min}
                max={layer.depth.max}
                step={span > 0 ? span / SLIDER_STEPS : 1}
                value={layer.depth.value}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setDepth(value);
                  writeDepth(value);
                }}
                data-testid="preview-map-depth"
              />
            </label>
          )}

          <p className="previewMapPanelCount">
            {layer.depth
              ? t("previewMapProfilesWithValue", {
                  withValue: formatCount(layer.valueCount),
                  total: formatCount(layer.markerCount),
                })
              : t("previewMapPositions", { count: layer.markerCount })}
          </p>
        </>
      )}
    </section>
  );
}
