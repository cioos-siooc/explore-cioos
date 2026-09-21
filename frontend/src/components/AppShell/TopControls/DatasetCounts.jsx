import * as React from "react";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import Spinner from "../../ui/Spinner.jsx";
import useDatasetCounts from "../../../state/useDatasetCounts.js";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";

// The dataset tally: one compact line of type between the brand lockup and the
// Datasets/Filters tabs, banded off from both so it reads as its own strip —
// "123/150 datasets (23 in view)".
//
// All readout, no controls. The parenthetical used to double as the switch that
// applied the "only in view" narrowing — a filter hidden inside the brackets of
// a number — which is now its own button among the quick filters below the card
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
  const { inViewCount } = useSelection();

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
        <>
          <span
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
          {/* The gap between the two spans supplies the space before the
                bracket: a literal one would be trimmed as leading whitespace
                at the start of the flex item. */}
          <span className="topBarCountsInViewWrap">
            ({t("topBarCountsInViewLink", { count: inViewCount })})
          </span>
        </>
      )}
    </div>
  );
}
