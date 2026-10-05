import * as React from "react";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import Spinner from "../../ui/Spinner.jsx";
import useDatasetCounts from "../../../state/useDatasetCounts.js";

// The dataset tally — "123/150 datasets" — at the left of the strip it shares
// with the quick filters, between the brand lockup and the Datasets/Filters
// tabs. How many of those the viewport holds rides on the In view filter
// instead (see QuickFilters).
//
// The filtered number holds the total's width (a hidden copy of the total
// sits under it), so filtering never shifts the line.
//
// Until `ready` there is no count to show — not even a zero — so the strip is a
// spinner. See useDatasetCounts.
export default function DatasetCounts() {
  const { t, i18n } = useTranslation();
  const {
    ready: countsReady,
    updating: countsUpdating,
    filteredCount,
    total,
  } = useDatasetCounts();

  // A failed /datasets leaves no catalogue total; what came back filtered is
  // then all we know it to be.
  const totalCount = total ?? filteredCount;
  const format = new Intl.NumberFormat(i18n.language).format;

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
          <span className="topBarCountsFiltered">
            <span aria-hidden="true">{format(totalCount)}</span>
            <span>{format(filteredCount)}</span>
          </span>
          /{format(totalCount)} {t("topBarCountsUnit")}
        </span>
      )}
    </div>
  );
}
