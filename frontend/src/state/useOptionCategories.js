import groupBy from "lodash-es/groupBy";
import { useTranslation } from "react-i18next";

import { withCategoryState } from "../utilities.jsx";

// Each category of a filter's options set as a whole: `state` only when every
// member is.
export default function useOptionCategories(options, setOptions, onInclude) {
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith("fr") ? "fr" : "en";

  return Object.entries(groupBy(options, "category"))
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
          setOptions((prev) =>
            withCategoryState(prev, category, {
              isSelected: next === "include",
              isExcluded: next === "exclude",
            }),
          );
          if (next === "include") onInclude?.();
        },
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, lang));
}
