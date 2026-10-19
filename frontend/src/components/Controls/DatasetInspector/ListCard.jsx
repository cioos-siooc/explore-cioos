import React, { useState } from "react";
import classNames from "classnames";
import { useTranslation } from "react-i18next";

import Skeleton from "../../ui/Skeleton.jsx";
import "./styles.css";

export default function ListCard({ id, selected, pinned, actions, children }) {
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

// `nowrap` keeps an atomic value (a timestamp range) on one line with its label.
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

export function useExpandableList(items, limit) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, limit);
  const hidden = items.length - shown.length;

  const toggle = () => setExpanded(!expanded);

  return { shown, hidden, expanded, toggle };
}

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
