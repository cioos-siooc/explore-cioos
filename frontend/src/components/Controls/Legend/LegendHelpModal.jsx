import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUpRight,
  BoundingBox,
  BoxArrowUpRight,
  Calendar3,
  CalendarCheck,
  CircleFill,
  CursorFill,
  Grid3x3Gap,
  HexagonFill,
  Palette,
  Rulers,
  Share,
  Water,
} from "react-bootstrap-icons";

import HelpModal from "../../ui/HelpModal.jsx";
import { bathymetrySourceUrl } from "../../config.js";

// Keyed "<section>_<item>"; each a language-keyed URL pair.
const ITEM_LINKS = {
  seafloor_source: bathymetrySourceUrl,
};

// Keyed by the same key Legend.jsx renders the entry under, so an ⓘ and its
// dialog can't name different things.
export const LEGEND_HELP_SECTIONS = {
  observations: {
    Icon: HexagonFill,
    lead: true,
    items: [
      ["once", CalendarCheck],
      ["gaps", Calendar3],
      ["why", Rulers],
    ],
  },
  hexes: {
    Icon: HexagonFill,
    lead: true,
    items: [
      ["hover", CursorFill],
      ["scale", Palette],
    ],
  },
  markers: {
    Icon: CircleFill,
    lead: true,
    items: [
      ["size", Rulers],
      ["colour", Palette],
      ["cells", HexagonFill],
    ],
  },
  trajectories: {
    Icon: Share,
    items: [
      ["line", Share],
      ["trail", Calendar3],
      ["head", ArrowUpRight],
    ],
  },
  seafloor: {
    Icon: Water,
    items: [
      ["source", Water],
      ["reading", Rulers],
    ],
  },
  layers: {
    Icon: BoundingBox,
    items: [
      ["griddap", BoundingBox],
      ["download", Grid3x3Gap],
    ],
  },
};

export default function LegendHelpModal({ section, onHide }) {
  const { t, i18n } = useTranslation();
  const help = section && LEGEND_HELP_SECTIONS[section];
  if (!help) return null;
  const { Icon } = help;

  // The source link runs on from the last sentence: it is provenance, not an action.
  function itemBody(key) {
    const base = t(`legendHelp_${section}_${key}_body`);
    const links = ITEM_LINKS[`${section}_${key}`];
    if (!links) return base;
    return (
      <>
        {base}{" "}
        <a
          className="helpModalLink"
          href={links[i18n.language] || links.en}
          target="_blank"
          rel="noreferrer"
        >
          <BoxArrowUpRight size={11} aria-hidden="true" />
          {t(`legendHelp_${section}_${key}_link`)}
        </a>
      </>
    );
  }

  return (
    <HelpModal
      show
      onHide={onHide}
      id="legendHelpModal"
      data-testid="legend-help-modal"
      icon={<Icon size={20} />}
      title={t(`legendHelp_${section}_title`)}
      items={help.items?.map(([key, ItemIcon]) => ({
        key,
        icon: <ItemIcon size={16} />,
        title: t(`legendHelp_${section}_${key}_title`),
        body: itemBody(key),
      }))}
    >
      {help.lead && (
        <p className="helpModalText">{t(`legendHelp_${section}_body`)}</p>
      )}
    </HelpModal>
  );
}
