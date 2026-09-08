import React, { useState, useMemo, Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";

import Modal from "../../ui/Modal.jsx";

import Loading from "../Loading/Loading.jsx";
import DatasetPreviewTable from "../DatasetPreviewTable/DatasetPreviewTable.jsx";
import "./styles.css";

// Lazy so the ~1 MB Plotly chunk only downloads when the Plot tab is opened.
const DatasetPreviewPlot = lazy(
  () => import("../DatasetPreviewPlot/DatasetPreviewPlot.jsx"),
);

export default function DatasetPreview({
  datasetPreview,
  inspectDataset,
  inspectRecordID,
  setInspectRecordID,
  showModal,
  setShowModal,
  recordLoading,
  setRecordLoading,
}) {
  const { t } = useTranslation();
  const clearAxes = {
    x: { columnName: null, unit: null },
    y: { columnName: null, unit: null },
  };
  const [plotAxes, setPlotAxes] = useState(clearAxes);
  const [selectedVis, setSelectedVis] = useState("table");

  // The response arrives as parallel arrays; the table wants row objects.
  // That is a reading of the response, so it is derived rather than copied
  // into state by an effect — which also means there is nothing to clear when
  // the modal closes.
  const data = useMemo(() => {
    const columnNames = datasetPreview?.table?.columnNames || [];
    const rows = datasetPreview?.table?.rows || [];
    return rows.map((row) =>
      columnNames.reduce(
        (merged, key, index) => ({ ...merged, [key]: row[index] }),
        {},
      ),
    );
  }, [datasetPreview]);

  const onModalClose = () => {
    setInspectRecordID();
    setShowModal(false);
    setPlotAxes(clearAxes);
    setSelectedVis("table");
    setInspectRecordID();
    setRecordLoading(false);
  };
  const dataIsReady = !recordLoading && datasetPreview?.table?.rows;

  return (
    <Modal
      className="dataPreviewModal"
      show={showModal}
      size="xl"
      onHide={onModalClose}
      centered
      scrollable
    >
      {inspectDataset && inspectRecordID && (
        <>
          <Modal.Header closeButton className="tableAndPlotGridContainer">
            {dataIsReady && (
              <>
                <button
                  className={`toggleButton ${
                    selectedVis === "table" && "selected"
                  }`}
                  onClick={() => {
                    setSelectedVis("table");
                    // setRecordLoading(true)
                  }}
                >
                  {t("datasetPreviewTableText")}
                </button>
                <button
                  className={`toggleButton ${
                    selectedVis === "plot" && "selected"
                  }`}
                  onClick={() => {
                    setSelectedVis("plot");
                    // setRecordLoading(true)
                  }}
                >
                  {t("datasetPreviewPlotText")}
                </button>
              </>
            )}

            <h4 className="datasetTitle">
              {inspectDataset.title}: <i>{inspectRecordID}</i>
              {/* {t('datasetInspectorModalTitle')} */}
              {/* Dataset Preview */}
            </h4>
          </Modal.Header>
          <Modal.Body>
            <div className="tableAndPlotGridItem tableAndPlot">
              {recordLoading ? (
                <Loading variant="inline" />
              ) : (
                <>
                  {datasetPreview?.table?.rows ? (
                    <>
                      {selectedVis === "table" ? (
                        <DatasetPreviewTable
                          datasetPreview={datasetPreview}
                          data={data}
                        />
                      ) : (
                        <Suspense fallback={<Loading variant="inline" />}>
                          <DatasetPreviewPlot
                            inspectDataset={inspectDataset}
                            plotAxes={plotAxes}
                            datasetPreview={datasetPreview}
                            setPlotAxes={setPlotAxes}
                            inspectRecordID={inspectRecordID}
                            data={data}
                          />
                        </Suspense>
                      )}
                    </>
                  ) : (
                    <>
                      <p>{t("datasetPreviewNoData")}</p>
                    </>
                  )}
                </>
              )}
            </div>
          </Modal.Body>
        </>
      )}
    </Modal>
  );
}
