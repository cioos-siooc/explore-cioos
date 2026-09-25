import * as React from "react";
import { useTranslation } from "react-i18next";

import "./skeletonStyles.css";

// A placeholder block in the shape of content that hasn't arrived. For a first
// load with nothing to show yet; a refresh over content that still means
// something keeps the Loading scrim instead.
//
// `text` stands in for a line of text: it takes the full line height of the
// element it sits in, so a skeleton built inside a card's real text classes
// comes out the height the card will have once its text arrives.
export default function Skeleton({ width, height, radius, text, className }) {
  return (
    <span
      className={["cioosSkeleton", text && "cioosSkeletonText", className]
        .filter(Boolean)
        .join(" ")}
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

// The blocks are decorative, so the group carries the announcement.
export function SkeletonGroup({ label, className, children }) {
  const { t } = useTranslation();
  return (
    <div
      className={className}
      role="status"
      aria-busy="true"
      data-testid="skeleton"
    >
      <span className="sr-only">{label ?? t("skeletonLoadingLabel")}</span>
      {children}
    </div>
  );
}
