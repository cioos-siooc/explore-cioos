import { DAYS_SORT, DEFAULT_SORT } from "./datasetSort.js";
import { useSelection } from "./selection/SelectionProvider.jsx";
import useActiveFilters from "./useActiveFilters.js";

// A picked sort always wins. Otherwise a narrowed selection lists the datasets
// with the most days of data in it first; the whole catalogue stays A to Z.
export default function useListSort() {
  const { listSort, setListSort } = useSelection();
  const filtered = useActiveFilters().length > 0;
  return [listSort ?? (filtered ? DAYS_SORT : DEFAULT_SORT), setListSort];
}
