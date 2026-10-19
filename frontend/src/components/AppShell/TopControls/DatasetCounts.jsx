import * as React from "react";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import Spinner from "../../ui/Spinner.jsx";
import useDatasetCounts from "../../../state/useDatasetCounts.js";

// With nothing filtered out, the total alone ("150/150" said it twice). The
// filtered number holds the total's width via a hidden copy, so filtering
// never shifts the line. A spinner until `ready` (see useDatasetCounts).
export default function DatasetCounts() {
  const { t, i18n } = useTranslation();
  const {
    ready: countsReady,
    updating: countsUpdating,
    filteredCount,
    total,
    allDatasetsShown,
    title,
  } = useDatasetCounts();

  // A failed /datasets leaves no catalogue total.
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
        <span role="status" title={title}>
          {allDatasetsShown ? (
            format(totalCount)
          ) : (
            <>
              <span className="topBarCountsFiltered">
                <span aria-hidden="true">{format(totalCount)}</span>
                <span>{format(filteredCount)}</span>
              </span>
              /{format(totalCount)}
            </>
          )}{" "}
          {t("topBarCountsUnit")}
        </span>
      )}
    </div>
  );
}
