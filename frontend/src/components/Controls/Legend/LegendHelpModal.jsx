import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUpRight,
  BoundingBox,
  BoxArrowUpRight,
  Calendar3,
  CalendarCheck,
  CircleFill,
  Grid3x3Gap,
  HexagonFill,
  Palette,
  Rulers,
  Share,
  Water,
} from "react-bootstrap-icons";

import HelpModal from "../../ui/HelpModal.jsx";
import { bathymetrySourceUrl } from "../../config.js";

// The pages an entry sends the reader out to, keyed "<section>_<item>", each as
// the language-keyed pair the site publishes. The link's own words are
// translated with the rest of the entry (`…_link`).
const ITEM_LINKS = {
  seafloor_source: bathymetrySourceUrl,
};

// The long form of one legend entry — a group, or one shape inside it. Keyed by
// the key Legend.jsx renders it under (see renderGroup / renderSubCaption), so
// the ⓘ beside a caption and the dialog it opens cannot come to name different
// things.
//
// `lead` is a paragraph saying what the entry is; `items` name its parts, each
// led by the glyph that part draws on the map. An entry with one thing to say
// has the lead alone. The observations group is split three ways for that
// reason: its label names the metric — the one thing every colour and size on
// the map is counting — and the two shapes carrying it explain themselves.
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
  hexes: { Icon: HexagonFill, lead: true },
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

// One dialog for every entry rather than a component each: they differ only in
// which strings they read, and the section key is what says which.
export default function LegendHelpModal({ section, onHide }) {
  const { t, i18n } = useTranslation();
  const help = section && LEGEND_HELP_SECTIONS[section];
  if (!help) return null;
  const { Icon } = help;

  // An entry's text, with the page it points at — when it points at one —
  // running on from the last sentence rather than sitting on a line of its own:
  // it is where this layer came from, not an action to take.
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
