import * as React from "react";
import { useTranslation } from "react-i18next";
import { ChevronDoubleRight, ChevronLeft } from "react-bootstrap-icons";

import { usePreviewPlot } from "./PreviewPlotProvider.jsx";

// Pages a record's time window back from the earliest row shown, and back to
// its newest rows.
export default function PreviewWindowPager() {
  const { t } = useTranslation();
  const { previewWindow, before, setBefore } = usePreviewPlot();
  if (!previewWindow.offersPaging) return null;
  const { earliest, startOfRecord } = previewWindow;

  return (
    <div className="previewWindowPager">
      <button
        type="button"
        className="previewWindowButton"
        disabled={startOfRecord}
        title={t(
          startOfRecord
            ? "previewWindowStartOfRecord"
            : "previewWindowEarlierHelp",
        )}
        onClick={() => setBefore(earliest)}
      >
        <ChevronLeft size={12} aria-hidden="true" />
        {t("previewWindowEarlier")}
      </button>
      {before && (
        <button
          type="button"
          className="previewWindowButton"
          title={t("previewWindowLatestHelp")}
          onClick={() => setBefore(null)}
        >
          {t("previewWindowLatest")}
          <ChevronDoubleRight size={12} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
