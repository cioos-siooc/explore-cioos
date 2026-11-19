import * as React from "react";
import { useState } from "react";
import { parseDate } from "@internationalized/date";
import {
  DateField as AriaDateField,
  DateInput,
  DateSegment,
  I18nProvider,
} from "react-aria-components";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import { useChanged } from "../../utilities.jsx";
import "./dateFieldStyles.css";

// Only a complete, real, in-range date commits; the segments hold anything
// short of one (a year typed digit by digit passes through 0002, 0020, 0201).
export function isCommittable(value, min, max) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if (Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) return false;
  return (!min || value >= min) && (!max || value <= max);
}

function toDate(iso) {
  try {
    return iso ? parseDate(iso) : null;
  } catch {
    return null;
  }
}

// ISO yyyy-mm-dd in and out, typed in year/month/day segments: the Canadian
// order (-CA) in either language, whatever the browser's locale. A finished
// in-range date commits at once; anything else is undone on blur.
export default function DateField({
  value,
  min,
  max,
  onCommit,
  label,
  className,
}) {
  const { i18n } = useTranslation();
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);

  if (useChanged(value, editing) && !editing) setDraft(value);

  const language = i18n.language?.startsWith("fr") ? "fr" : "en";
  return (
    <I18nProvider locale={`${language}-CA`}>
      <AriaDateField
        className="cioosDateField"
        aria-label={label}
        value={toDate(draft)}
        minValue={toDate(min)}
        maxValue={toDate(max)}
        granularity="day"
        onChange={(date) => {
          const iso = date ? date.toString() : "";
          setDraft(iso);
          if (isCommittable(iso, min, max)) onCommit(iso);
        }}
        onFocusChange={(focused) => {
          setEditing(focused);
          if (focused) return;
          if (isCommittable(draft, min, max)) onCommit(draft);
          else setDraft(value);
        }}
      >
        <DateInput
          className={classNames(
            "cioosDateInput",
            className || "railValueInput timeRailDateInput",
          )}
        >
          {(segment) => (
            <DateSegment className="cioosDateSegment" segment={segment} />
          )}
        </DateInput>
      </AriaDateField>
    </I18nProvider>
  );
}
