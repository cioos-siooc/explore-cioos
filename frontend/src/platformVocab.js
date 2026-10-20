import platformColors from "./components/platformColors.js";
import platforms from "./platforms.json";
import { capitalizeFirstLetter } from "./utilities.jsx";

const byLabel = new Map(platforms.map((p) => [p.label_en, p]));

// Top-level NERC L06 ancestor (diver -> organism). A term outside the
// vocabulary is its own category.
export function platformCategory(platform) {
  return byLabel.get(platform)?.category ?? platform;
}

// L06 labels are lower case ("diver"); these are for display.
export function platformLabels(platform) {
  const entry = byLabel.get(platform);
  const display = (label) => label && capitalizeFirstLetter(label);
  return {
    en: display(entry?.label_en ?? platform),
    fr: display(entry?.label_fr ?? platform),
  };
}

export function platformLabel(platform, language = "en") {
  return platformLabels(platform)[language.startsWith("fr") ? "fr" : "en"];
}

// Colours are per category, so every member of one shares it.
export function platformColor(platform) {
  const category = platformCategory(platform);
  return (
    platformColors.find((pc) => pc.platform === category) ??
    platformColors.find((pc) => pc.platform === "unknown")
  ).color;
}
