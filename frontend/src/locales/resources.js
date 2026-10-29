import eovs from "../eovs.json";
import translationEN from "./en/translation.json";
import translationFR from "./fr/translation.json";

// EOV names come from cioos-commons, keyed by their value, so the UI's
// t(eov) calls never fall back to the raw camelCase value.
const eovLabels = (column) =>
  Object.fromEntries(eovs.map((eov) => [eov.value, eov[column]]));

export const resources = {
  en: { translation: { ...translationEN, ...eovLabels("label EN") } },
  fr: { translation: { ...translationFR, ...eovLabels("label FR") } },
};
