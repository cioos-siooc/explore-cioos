import * as React from "react";
import { useTranslation } from "react-i18next";

import "./activityListStyles.css";

// Rows carry no mark: each caller already shows one animation for the whole
// wait.
export default function ActivityList({ labelKeys, className = "" }) {
  const { t } = useTranslation();

  if (!labelKeys.length) return null;

  return (
    <ul className={["activityList", className].filter(Boolean).join(" ")}>
      {labelKeys.map((key) => (
        <li key={key}>{t(key)}</li>
      ))}
    </ul>
  );
}
