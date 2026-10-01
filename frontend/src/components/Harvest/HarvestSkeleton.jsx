import * as React from "react";

import Skeleton, { SkeletonGroup } from "../ui/Skeleton.jsx";

export function HarvestTableSkeleton({ label, rows = 6 }) {
  return (
    <SkeletonGroup label={label} className="harvest-table harvest-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} width={i === 0 ? "60%" : undefined} />
      ))}
    </SkeletonGroup>
  );
}

export function HarvestCardsSkeleton({ label, count = 6 }) {
  return (
    <SkeletonGroup label={label} className="harvest-card-grid">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="harvest-card harvest-skeleton">
          <Skeleton width="60%" height="1.1em" />
          <Skeleton width="80%" />
          <Skeleton width="40%" />
        </div>
      ))}
    </SkeletonGroup>
  );
}
