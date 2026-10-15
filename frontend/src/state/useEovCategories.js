import groupBy from "lodash-es/groupBy";
import { useTranslation } from "react-i18next";

import { withCategoryState } from "../utilities.jsx";
import { useFilters } from "./filters/FilterProvider.jsx";

// The EOV categories in the catalogue, in the order the Filters modal groups
// them, each set as a whole: `state` is "include" or "exclude" only when every
// one of its EOVs is, and `toggle(target)` follows useFilterModel's rule
// (asking for the state it is already in clears it). Matching *every* EOV of a
// category is almost never what is meant, so including one switches match-all
// off.
export default function useEovCategories() {
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith("fr") ? "fr" : "en";
  const { eovsSelected, setEovsSelected, setEovsMatchAll } = useFilters();

  return Object.entries(groupBy(eovsSelected, "category"))
    .map(([category, members]) => {
      const state = members.every((o) => o.isSelected)
        ? "include"
        : members.every((o) => o.isExcluded)
          ? "exclude"
          : undefined;
      const names = members[0].categoryTranslated;
      return {
        category,
        label: names[lang],
        names,
        members,
        count: members.length,
        state,
        toggle: (target) => {
          const next = state === target ? undefined : target;
          setEovsSelected((prev) =>
            withCategoryState(prev, category, {
              isSelected: next === "include",
              isExcluded: next === "exclude",
            }),
          );
          if (next === "include") setEovsMatchAll(false);
        },
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, lang));
}
