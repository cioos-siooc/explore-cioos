import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useUI } from "../../../state/ui/UIProvider.jsx";
import Spinner from "../../ui/Spinner.jsx";
import { buildTaxonomyTree, fetchChecklist } from "./taxonomy.js";
import TaxonomyTree from "./TaxonomyTree.jsx";
import "./styles.css";

const TaxonomySunburst = lazy(() => import("./TaxonomySunburst.jsx"));

const VIEWS = ["sunburst", "tree"];

// The OBIS page's taxonomic breakdown of the dataset's occurrence records, read
// straight from OBIS's checklist — the harvest keeps only scientific names per
// cell, not their classification.
export default function TaxonomyChart({ datasetId }) {
  const { t } = useTranslation();
  const { taxonomyView: view, setTaxonomyView: setView } = useUI();
  const [attempt, setAttempt] = useState(0);
  // The chart's own controls portal into the header, beside the view toggle.
  const [actionsEl, setActionsEl] = useState(null);
  // Tagged with the request it answers, so a dataset switch or a retry reads
  // as loading until its own response lands.
  const request = `${datasetId}#${attempt}`;
  const [checklist, setChecklist] = useState({ request: undefined });

  useEffect(() => {
    const controller = new AbortController();
    fetchChecklist(datasetId, controller.signal)
      .then((taxa) => setChecklist({ request, taxa }))
      .catch((error) => {
        if (error.name !== "AbortError") setChecklist({ request, error });
      });
    return () => controller.abort();
  }, [datasetId, request]);

  const tree = useMemo(
    () => checklist.taxa && buildTaxonomyTree(checklist.taxa),
    [checklist.taxa],
  );

  const placeholder = (
    <div className="taxonomyStatus">
      {view === "tree" ? (
        <div className="taxonomyPlaceholderTree" aria-hidden="true">
          {[0, 1, 1, 2, 2, 1, 2].map((depth, index) => (
            <span key={index} style={{ "--depth": depth }} />
          ))}
        </div>
      ) : (
        <div className="taxonomyPlaceholderSunburst" aria-hidden="true" />
      )}
      <Spinner className="taxonomyPlaceholderSpinner" size="lg" />
    </div>
  );

  let body;
  if (checklist.request !== request) {
    body = placeholder;
  } else if (checklist.error) {
    body = (
      <div className="cardListEmpty" role="alert">
        {t("taxonomyLoadFailedText")}{" "}
        <button
          type="button"
          className="recordShowAll"
          onClick={() => setAttempt((n) => n + 1)}
        >
          {t("apiErrorRetryButton")}
        </button>
      </div>
    );
  } else if (!tree.children.length) {
    body = <div className="cardListEmpty">{t("taxonomyEmptyText")}</div>;
  } else if (view === "tree") {
    body = <TaxonomyTree key={datasetId} tree={tree} actionsEl={actionsEl} />;
  } else {
    body = (
      <Suspense fallback={placeholder}>
        <TaxonomySunburst key={datasetId} tree={tree} actionsEl={actionsEl} />
      </Suspense>
    );
  }

  return (
    <div className="recordSection chartSection">
      <div className="recordSectionHeader chartSectionHeader">
        <div>
          <strong>{t("taxonomyTitle")}</strong>
          <span className="recordHint">{t("taxonomyHint")}</span>
        </div>
        <div className="taxonomyControls">
          <div className="taxonomyActions" ref={setActionsEl} />
          <div
            className="viewToggle"
            role="group"
            aria-label={t("taxonomyViewLabel")}
          >
            {VIEWS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={view === option}
                onClick={() => setView(option)}
              >
                {t(`taxonomyView_${option}`)}
              </button>
            ))}
          </div>
        </div>
      </div>
      {body}
    </div>
  );
}
