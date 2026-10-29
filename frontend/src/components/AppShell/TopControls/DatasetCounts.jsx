import * as React from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import Spinner from "../../ui/Spinner.jsx";
import Tooltip from "../../ui/Tooltip.jsx";
import { server } from "../../../config.js";
import fetchJson from "../../../state/fetchJson.js";
import useDatasetCounts from "../../../state/useDatasetCounts.js";

// With nothing filtered out, the total alone ("150/150" said it twice). The
// filtered number holds the total's width via a hidden copy, so filtering
// never shifts the line. A spinner until `ready` (see useDatasetCounts).
// The popup also dates the catalogue by its stalest source's last harvest;
// without that answer it just leaves the date out.
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

  const [lastHarvest, setLastHarvest] = useState(null);
  useEffect(() => {
    fetchJson(`${server}/harvest/freshness`)
      .then(({ oldestLastHarvest }) => setLastHarvest(oldestLastHarvest))
      .catch(() => {});
  }, []);

  // A failed /datasets leaves no catalogue total.
  const totalCount = total ?? filteredCount;
  const format = new Intl.NumberFormat(i18n.language).format;
  const popup = (
    <>
      {title}
      {lastHarvest && (
        <>
          <br />
          {t("datasetsCountLastHarvest", {
            date: new Date(lastHarvest).toLocaleDateString(i18n.language, {
              dateStyle: "long",
            }),
          })}
        </>
      )}
    </>
  );

  return (
    <div
      className={classNames("topBarCountsRow", { updating: countsUpdating })}
      data-testid="dataset-counts"
    >
      {!countsReady ? (
        <Spinner size="xs" className="countSpinner" />
      ) : (
        // Announced when a filter changes the tally; focusable so the popup
        // reaches keyboard users too.
        <Tooltip content={popup}>
          <span role="status" tabIndex={0}>
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
        </Tooltip>
      )}
    </div>
  );
}
