import * as React from "react";
import { useTranslation } from "react-i18next";

import "./skeletonStyles.css";

// For a first load; a refresh over meaningful content keeps the Loading scrim.
// `text` takes the full line height of its element, so built inside the card's
// real text classes it matches the final height.
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
