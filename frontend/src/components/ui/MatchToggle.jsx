import * as React from "react";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import { useTips } from "../../state/tips/TipsProvider.jsx";
import "./matchToggleStyles.css";

// "Match: Any | All" for a filter whose ticked options can be joined by "or"
// or "and": the same words as the chips' connectors (see ActiveFilterChips),
// in place of an on/off switch. `hints` gives the line under it for each
// choice. `data-testid` sits on the radiogroup; `tipTarget` names the tip that
// points at it (see TipsProvider).
export default function MatchToggle({
  all,
  setAll,
  hints,
  "data-testid": testId,
  tipTarget,
}) {
  const { t } = useTranslation();
  const { tipHighlight } = useTips();
  const label = t("matchToggleLabel");
  const option = (value, text) => (
    <button
      type="button"
      role="radio"
      aria-checked={all === value}
      className={classNames("matchToggleOption", { selected: all === value })}
      data-testid={testId && `${testId}-${value ? "all" : "any"}`}
      onClick={() => setAll(value)}
    >
      {text}
    </button>
  );
  return (
    <div className="matchToggle" data-tip-highlight={tipHighlight(tipTarget)}>
      <span className="matchToggleLabel" aria-hidden="true">
        {label}
      </span>
      <div
        className="matchToggleOptions"
        role="radiogroup"
        aria-label={label}
        data-testid={testId}
        data-match-all={all}
      >
        {option(false, t("matchToggleAny"))}
        {option(true, t("matchToggleAll"))}
      </div>
      <span className="matchToggleHint">{all ? hints.all : hints.any}</span>
    </div>
  );
}
