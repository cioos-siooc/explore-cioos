import * as React from "react";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import Spinner from "../../ui/Spinner.jsx";
import useDatasetCounts from "../../../state/useDatasetCounts.js";

// The dataset tally — "123/150 datasets" — leading the strip it shares with
// the quick filters, between the brand lockup and the Datasets/Filters tabs.
// How many of those the viewport holds rides on the In view filter instead
// (see QuickFilters).
//
// Until `ready` there is no count to show — not even a zero — so the strip is a
// spinner. See useDatasetCounts.
export default function DatasetCounts() {
  const { t } = useTranslation();
  const {
    ready: countsReady,
    updating: countsUpdating,
    filteredCount,
    total,
  } = useDatasetCounts();

  // A failed /datasets leaves no catalogue total; what came back filtered is
  // then all we know it to be.
  const totalCount = total ?? filteredCount;

  return (
    <div
      className={classNames("topBarCountsRow", { updating: countsUpdating })}
      data-testid="dataset-counts"
    >
      {!countsReady ? (
        <Spinner size="xs" className="countSpinner" />
      ) : (
        // Announced when a filter changes the tally.
        <span
          role="status"
          title={t("dockDatasetsCountTitle", {
            filtered: filteredCount,
            total: totalCount,
          })}
        >
          {t("topBarCountsSummary", {
            filtered: filteredCount,
            total: totalCount,
          })}
        </span>
      )}
    </div>
  );
}
