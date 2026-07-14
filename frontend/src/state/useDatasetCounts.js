import { useFilters } from './filters/FilterProvider.jsx'
import { useSelection } from './selection/SelectionProvider.jsx'
import { formatDatasetCount } from '../utilities.jsx'

// The datasets counters shown in the top bar and the sidebar (pill + footer).
//
// The numbers come from two independent fetches — /pointQuery for the filtered
// set, /datasets for the catalog total — and both start out as "nothing yet",
// which is NOT the same as zero. Rendering the raw values would flash "0
// datasets" on every cold load, so consumers must render a spinner until
// `ready`, and only then trust `filteredCount` / `total`.
//
// `ready` deliberately does not wait on the catalog total specifically: if
// /datasets failed, catalogLoaded still resolves and the counters fall back to
// the filtered count alone rather than spinning forever.
//
// `updating` marks a refetch in flight *after* the first one landed. The
// previous counts stay on screen (dimmed) instead of collapsing back to a
// spinner, so a filter tweak doesn't make the numbers flicker.
export default function useDatasetCounts () {
  const { totalNumberOfDatasets, catalogLoaded } = useFilters()
  const { filteredDatasets, selectionLoading, initialPointsQueryComplete } =
    useSelection()

  const ready =
    initialPointsQueryComplete &&
    (totalNumberOfDatasets !== undefined || catalogLoaded)

  // Reflects the title-search / "only in view" narrowing too, not just the
  // server-side filters, so the counters agree with the list they sit next to.
  const filteredCount = filteredDatasets?.length ?? 0

  return {
    ready,
    updating: ready && selectionLoading,
    filteredCount,
    total: totalNumberOfDatasets,
    // Nothing filtered out (or no total to compare against): the
    // "filtered / total" split is noise, so state the single number alone.
    allDatasetsShown:
      !totalNumberOfDatasets || filteredCount === totalNumberOfDatasets,
    label: formatDatasetCount(filteredCount, totalNumberOfDatasets)
  }
}
