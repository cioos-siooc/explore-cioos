import groupBy from "lodash-es/groupBy";
import { useTranslation } from "react-i18next";

import { withCategoryState } from "../utilities.jsx";
import { useFilters } from "./filters/FilterProvider.jsx";

// Each category set as a whole: `state` only when every EOV in it is. Matching
// *every* EOV of a category is almost never meant, so including one switches
// match-all off.
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
