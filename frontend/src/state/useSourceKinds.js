import { ERDDAP_KEY, OBIS_KEY } from "./datasetGroups.js";
import { useFilters } from "./filters/FilterProvider.jsx";

// Each list set as a whole: `state` only when every member is. Empty lists are
// left out.
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
        setList,
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

const NEXT_MODE = { all: "erddap", erddap: "obis", obis: "all", custom: "all" };

// The quick filter's view of the same lists: no source set, one whole kind
// included alone, or any other mix ("custom").
export function useSourceMode() {
  const kinds = useSourceKinds();
  const isSet = (o) => o.isSelected || o.isExcluded;
  const [only] = kinds.filter((kind) => kind.state === "include");
  const others = kinds.filter((kind) => kind !== only);
  const mode = !kinds.some((kind) => kind.members.some(isSet))
    ? "all"
    : only && !others.some((kind) => kind.members.some(isSet))
      ? only.key
      : "custom";

  function cycle() {
    const next = NEXT_MODE[mode];
    for (const kind of kinds) {
      kind.setList((prev) =>
        prev.map((o) => ({
          ...o,
          isSelected: next === kind.key,
          isExcluded: false,
        })),
      );
    }
  }

  return { available: kinds.length === 2, mode, cycle };
}
