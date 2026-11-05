import React from "react";
import { useTranslation } from "react-i18next";
import StatusBadge from "./StatusBadge.jsx";
import reasonLabel from "./reasonLabel.js";
import { failureColor, isDisabled } from "./HarvestPie.jsx";

// Every failure reason ranked on one baseline; the pie folds the tail into
// "Other", this keeps it readable.
export default function HarvestReasonBars({ failures }) {
  const { t } = useTranslation();
  const rows = failures.filter((f) => f.n > 0);
  if (!rows.length) return null;
  const max = rows[0].n;

  return (
    <ul className="harvest-bars">
      {rows.map((f) => {
        const label = f.reason_code
          ? reasonLabel(t, f.reason_code)
          : t(`harvest.filter.${f.status}`);
        return (
          <li
            key={`${f.status}|${f.reason_code || ""}`}
            title={`${label}: ${f.n}`}
            className={isDisabled(f) ? "harvest-bars-disabled" : undefined}
          >
            <span className="harvest-bars-name" title={f.reason_code || label}>
              {label}
            </span>
            <StatusBadge status={f.status} />
            <span className="harvest-bars-track" aria-hidden="true">
              <span
                className="harvest-bars-bar"
                style={{
                  width: `${(100 * f.n) / max}%`,
                  background: failureColor(f),
                }}
              />
            </span>
            <span className="harvest-bars-value">{f.n}</span>
          </li>
        );
      })}
    </ul>
  );
}
