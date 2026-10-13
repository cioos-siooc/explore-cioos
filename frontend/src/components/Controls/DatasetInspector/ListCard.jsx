import React, { useState } from "react";
import classNames from "classnames";
import { useTranslation } from "react-i18next";

import Skeleton from "../../ui/Skeleton.jsx";
import "./styles.css";

// One row of a dataset page's record list, as a card: the item's
// id on top, its fields as label/value pairs beneath, each on its own line, and
// its actions along the bottom. This is the shape that survives the sidebar's
// width — see CardList.jsx for why these lists are cards at all.
//
// The card itself does nothing on click: every action it offers is a labelled
// button, so nothing happens that the reader didn't ask for by name.
export default function ListCard({
  id,
  // Drawn on the map right now (a trajectory whose track is shown).
  selected,
  // Held at the top of the list because the last map click found this item —
  // wearing the same goldenrod the map put on what was clicked.
  pinned,
  actions,
  children,
}) {
  return (
    <div className={classNames("listCard", { selected, pinned })}>
      <div className="listCardHead">
        <span className="listCardId" title={id}>
          {id}
        </span>
      </div>
      <dl className="listCardFields">{children}</dl>
      {actions && <div className="listCardActions">{actions}</div>}
    </div>
  );
}

// A record card's outline while the list is on its way, built in the card's
// own text classes: the id, then the three fields a record carries.
export function ListCardSkeleton() {
  return (
    <div className="listCard listCardSkeleton" aria-hidden="true">
      <div className="listCardHead">
        <span className="listCardId">
          <Skeleton text width="40%" />
        </span>
      </div>
      <div className="listCardFields">
        {["70%", "50%", "60%"].map((width) => (
          <div key={width} className="listCardField">
            <span className="listCardFieldLabel">
              <Skeleton text width="64px" />
            </span>
            <span className="listCardFieldValue">
              <Skeleton text width={width} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// One field of a card: its name, and its value under or beside it. Renders
// nothing when the dataset has no value for the field, so a card carries only
// the lines it can actually fill.
//
// `nowrap` is for a value that reads as one atomic token rather than prose —
// a timestamp range — which keeps label and value on one line instead of
// breaking mid-date.
export function CardField({ label, nowrap, children }) {
  const empty =
    children === null ||
    children === undefined ||
    children === "" ||
    (Array.isArray(children) && children.length === 0);
  if (empty) return null;
  return (
    <div
      className={classNames("listCardField", { listCardFieldNowrap: nowrap })}
    >
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

  const toggle = () => setExpanded(!expanded);

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
