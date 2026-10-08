import deburr from "lodash-es/deburr";
import escapeRegExp from "lodash-es/escapeRegExp";

// Synced from cioos-commons/search/aliases.json: groups of terms that name the
// same thing (acronyms, full names, English and French).
import aliasGroupsJSONfile from "../searchAliases.json";

const fold = (text) => deburr(text).toLowerCase();

// Whole words only, so "otn" is not found inside "cotnet".
const aliasGroups = aliasGroupsJSONfile.map((group) =>
  group.map((term) => ({
    term: fold(term),
    pattern: new RegExp(
      String.raw`(?<![\p{L}\p{N}])${escapeRegExp(fold(term))}(?![\p{L}\p{N}])`,
      "gu",
    ),
  })),
);

// The text, folded (accents and case), and the text again with each alias
// term it contains swapped for every other term of its group: "otn moorings"
// also reads as "ocean tracking network moorings".
export function aliasVariants(text) {
  const folded = fold(text);
  const variants = new Set([folded]);
  for (const group of aliasGroups) {
    for (const { pattern } of group) {
      if (!folded.match(pattern)) continue;
      for (const { term } of group) variants.add(folded.replace(pattern, term));
    }
  }
  return [...variants];
}
