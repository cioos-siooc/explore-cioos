import { ERDDAP_KEY, OBIS_KEY } from "./datasetGroups.js";
import { useFilters } from "./filters/FilterProvider.jsx";

// The ERDDAP and OBIS source lists, each set as a whole as the Filters modal's
// ERDDAP / OBIS rows set them: `state` is "include" or "exclude" only when every
// server (or node) is, and `toggle(target)` follows useFilterModel's rule
// (asking for the state it is already in clears it). Empty lists are left out.
export default function useSourceKinds() {
  const filters = useFilters();
  return [
    [
      ERDDAP_KEY,
      "ERDDAP",
      filters.erddapServersSelected,
      filters.setErddapServersSelected,
    ],
    [OBIS_KEY, "OBIS", filters.obisNodesSelected, filters.setObisNodesSelected],
  ]
    .filter(([, , list]) => list.length > 0)
    .map(([key, label, list, setList]) => {
      const state = list.every((o) => o.isSelected)
        ? "include"
        : list.every((o) => o.isExcluded)
          ? "exclude"
          : undefined;
      return {
        key,
        label,
        members: list,
        state,
        toggle: (target) => {
          const next = state === target ? undefined : target;
          setList((prev) =>
            prev.map((o) => ({
              ...o,
              isSelected: next === "include",
              isExcluded: next === "exclude",
            })),
          );
        },
      };
    });
}
