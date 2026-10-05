import * as React from "react";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import Spinner from "../../ui/Spinner.jsx";
import useDatasetCounts from "../../../state/useDatasetCounts.js";

// The dataset tally — "123/150 datasets" — centred between the brand lockup
// and the Datasets/Filters tabs.
//
// With nothing filtered out, the total alone: "150/150" said it twice. Once
// filtered, the filtered number holds the total's width (a hidden copy of the
// total sits under it), so further filtering never shifts the line.
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
    allDatasetsShown,
    title,
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
