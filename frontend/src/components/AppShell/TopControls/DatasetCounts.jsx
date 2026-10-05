import * as React from "react";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import Spinner from "../../ui/Spinner.jsx";
import useDatasetCounts from "../../../state/useDatasetCounts.js";

// The dataset tally, riding in the Datasets tab after its label: just the
// filtered count, since a third of the card has no room for "2,167/2,168" in
// French; the catalogue total is in its title. How many of those the viewport
// holds rides on the In view filter instead (see QuickFilters).
//
// Until `ready` there is no count to show — not even a zero — so it is a
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

  if (!countsReady) return <Spinner size="xs" className="countSpinner" />;

  return (
    // Announced when a filter changes the tally.
    <span
      role="status"
      className={classNames("topBarDatasetsCount", {
        updating: countsUpdating,
      })}
      data-testid="dataset-counts"
      title={t("dockDatasetsCountTitle", {
        filtered: filteredCount,
        total: totalCount,
      })}
    >
      {t("topBarDatasetsCount", { count: filteredCount })}
    </span>
  );
}
