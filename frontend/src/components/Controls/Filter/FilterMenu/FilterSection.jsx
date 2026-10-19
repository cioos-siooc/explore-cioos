import * as React from "react";

export default function FilterSection({ title, children }) {
  return (
    <div className="filterSection">
      <div className="filterSectionHeading">{title}</div>
      <div className="filterSectionItems">{children}</div>
    </div>
  );
}
