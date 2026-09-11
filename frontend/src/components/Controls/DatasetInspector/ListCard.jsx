import React, { useState } from "react";
import classNames from "classnames";
import { useTranslation } from "react-i18next";

import "./styles.css";

// One row of a dataset page's record list, as a card: the record's id on top
// and its fields as label/value pairs beneath, each on its own line. This is
// the shape that survives the sidebar's width — see CardList.jsx for why these
// lists are cards at all.
//
// A div rather than a <button> (with the keyboard handling a button would have
// given for free) because the card's body is a description list, which a
// button may not contain. Same treatment DatasetCard uses.
export default function ListCard({
  id,
  // Accent only: this is the record the map is currently drawing (a
  // trajectory's track). The control that toggles that — and the aria-pressed
  // saying so — is the `action` button beside the id, not the card itself.
  selected,
  // Held at the top of the list because the last map click found this record —
  // wearing the same goldenrod the map put on what was clicked.
  pinned,
  // A control belonging to this record rather than to opening it: rendered
  // beside the id, and expected to stop the click from reaching the card.
  action,
  // Opening the record. Omitted when there is nothing to open (a record with
  // no id — an unnamed single trajectory — has nothing to preview), which
  // leaves the card inert rather than a button that does nothing.
  onClick,
  children,
}) {
  const clickable = typeof onClick === "function";
  const handleKeyDown = clickable
    ? (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onClick();
      }
    : undefined;

  return (
    <div
      className={classNames("listCard", { selected, pinned, clickable })}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onClick : undefined}
      onKeyDown={handleKeyDown}
    >
      <div className="listCardHead">
        <span className="listCardId" title={id}>
          {id}
        </span>
        {action}
      </div>
      <dl className="listCardFields">{children}</dl>
    </div>
  );
}

// One field of a card: its name, and its value under or beside it. Renders
// nothing when the dataset has no value for the field, so a card carries only
// the lines it can actually fill.
export function CardField({ label, children }) {
  const empty =
    children === null ||
    children === undefined ||
    children === "" ||
    (Array.isArray(children) && children.length === 0);
  if (empty) return null;
  return (
    <div className="listCardField">
      <dt className="listCardFieldLabel">{label}</dt>
      <dd className="listCardFieldValue">{children}</dd>
    </div>
  );
}

// Limits a list to its first few items behind a "+n" toggle that expands to
// the rest. Shared by a record card's variable tags below and the metadata
// sheet's own EOV row (DatasetInspector) — the same "show a few, expand for
// the rest" affordance wherever a list-valued field could otherwise run
// several lines longer than everything around it.
export function useExpandableList(items, limit) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, limit);
  const hidden = items.length - shown.length;

  // Toggles usually sit inside something else clickable (a record card opens
  // its preview on click) — stop the event there so expanding the list isn't
  // read as that click too.
  const toggle = (e) => {
    e.stopPropagation();
    setExpanded(!expanded);
  };

  return { shown, hidden, expanded, toggle };
}

// The values of a list-valued field (a record's ocean variables), condensed to
// the first few with the rest behind a "+n". A record can carry a dozen
// variables, which on its own would make the card several lines taller than
// every other field on it and bury the id the card is called by — while the
// question the list usually answers is "does this record measure X", which the
// search box above the cards answers outright.
export function CardTags({ values, limit = 3 }) {
  const { t } = useTranslation();
  const { shown, hidden, expanded, toggle } = useExpandableList(
    values ?? [],
    limit,
  );
  if (!values?.length) return null;

  return (
    <>
      {shown.map((value) => (
        <span className="listCardTag" key={value}>
          {value}
        </span>
      ))}
      {(hidden > 0 || expanded) && (
        <button
          type="button"
          className="listCardTagsMore"
          onClick={toggle}
          onKeyDown={(e) => e.stopPropagation()}
          aria-expanded={expanded}
          title={
            expanded
              ? t("listCardTagsFewerText")
              : t("listCardTagsMoreTitle", { total: values.length })
          }
        >
          {expanded ? t("listCardTagsFewerText") : `+${hidden}`}
        </button>
      )}
    </>
  );
}
