import { useTranslation } from "react-i18next";

import { useFilters } from "./filters/FilterProvider.jsx";
import { useSelection } from "./selection/SelectionProvider.jsx";
import { formatDatasetCount } from "../utilities.jsx";

// "Nothing yet" is NOT zero: consumers render a spinner until `ready`, or every
// cold load flashes "0 datasets". `ready` doesn't wait on the catalog total, so
// a failed /datasets falls back to the filtered count instead of spinning.
// `updating` = refetch after the first landed; counts stay on screen dimmed.
export default function useDatasetCounts() {
  const { t, i18n } = useTranslation();
  const { totalNumberOfDatasets, catalogLoaded } = useFilters();
  const { filteredDatasets, selectionLoading, initialPointsQueryComplete } =
    useSelection();

  const ready =
    initialPointsQueryComplete &&
    (totalNumberOfDatasets !== undefined || catalogLoaded);

  // Includes the client-side narrowing so the counters agree with the list.
  const filteredCount = filteredDatasets?.length ?? 0;
  const allDatasetsShown =
    !totalNumberOfDatasets || filteredCount === totalNumberOfDatasets;

  return {
    ready,
    updating: ready && selectionLoading,
    filteredCount,
    total: totalNumberOfDatasets,
    allDatasetsShown,
    title: !ready
      ? t("datasetsCountLoadingTitle")
      : allDatasetsShown
        ? t("dockDatasetsAllShownTitle", {
            count: totalNumberOfDatasets ?? filteredCount,
          })
        : t("dockDatasetsCountTitle", {
            filtered: filteredCount,
            total: totalNumberOfDatasets,
          }),
    label: formatDatasetCount(
      filteredCount,
      totalNumberOfDatasets,
      i18n.language,
    ),
  };
}
