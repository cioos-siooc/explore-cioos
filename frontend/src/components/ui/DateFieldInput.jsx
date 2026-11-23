import * as React from "react";
import { useContext, useState } from "react";
import { maxDate, minDate, parseDate } from "@internationalized/date";
import {
  Button,
  Calendar,
  CalendarCell,
  CalendarMonthPicker,
  CalendarStateContext,
  CalendarYearPicker,
  CalendarGrid,
  DateInput,
  DatePicker,
  DateSegment,
  Dialog,
  Group,
  I18nProvider,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
} from "react-aria-components";
import {
  Calendar3,
  CaretDownFill,
  ChevronLeft,
  ChevronRight,
} from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import { useChanged } from "../../utilities.jsx";
import { isCommittable } from "./DateField.jsx";

function toDate(iso) {
  try {
    return iso ? parseDate(iso) : null;
  } catch {
    return null;
  }
}

// A month or year pick also sets the field's date (same day, clamped), so it
// needs no extra day click; the calendar's own selection would close it. Only
// the picked field is taken: a year item's month and day come from max/min.
function PickerSelect({ field, items, value, "aria-label": label, onPick }) {
  const state = useContext(CalendarStateContext);
  return (
    <Select
      className="cioosCalendarPicker"
      aria-label={label}
      selectedKey={value}
      onSelectionChange={(key) => {
        const item = items.find((item) => item.id === key);
        if (!item) return;
        let date = state.focusedDate.set({ [field]: item.date[field] });
        if (state.minValue) date = maxDate(date, state.minValue);
        if (state.maxValue) date = minDate(date, state.maxValue);
        state.setFocusedDate(date);
        onPick(date);
      }}
    >
      <Button className="cioosCalendarSelect">
        <SelectValue />
        <CaretDownFill aria-hidden="true" />
      </Button>
      <Popover className="cioosDatePopover cioosPickerPopover">
        <ListBox className="cioosPickerList" items={items}>
          {(item) => (
            <ListBoxItem
              className="cioosPickerOption"
              textValue={item.formatted}
            >
              {item.formatted}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </Select>
  );
}

// The year list runs from the harvested data's start (`yearMin`), or the
// shown year if earlier, up to the latest allowed year.
function MonthYearPickers({ yearMin, onPick }) {
  const { focusedDate, minValue, maxValue } = useContext(CalendarStateContext);
  const top = maxValue?.year ?? focusedDate.year + 10;
  const floor = Math.min(
    Math.max(toDate(yearMin)?.year ?? -Infinity, minValue?.year ?? -Infinity),
    focusedDate.year,
  );
  return (
    <>
      <CalendarMonthPicker>
        {(picker) => <PickerSelect {...picker} field="month" onPick={onPick} />}
      </CalendarMonthPicker>
      <CalendarYearPicker
        visibleYears={Number.isFinite(floor) ? top - floor + 1 : undefined}
      >
        {(picker) => <PickerSelect {...picker} field="year" onPick={onPick} />}
      </CalendarYearPicker>
    </>
  );
}

export default function DateFieldInput({
  value,
  min,
  max,
  yearMin,
  onCommit,
  label,
  className,
}) {
  const { t, i18n } = useTranslation();
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);

  if (useChanged(value, editing) && !editing) setDraft(value);

  const change = (date) => {
    const iso = date ? date.toString() : "";
    setDraft(iso);
    if (isCommittable(iso, min, max)) onCommit(iso);
  };

  const language = i18n.language?.startsWith("fr") ? "fr" : "en";
  return (
    <I18nProvider locale={`${language}-CA`}>
      <DatePicker
        className="cioosDateField"
        aria-label={label}
        value={toDate(draft)}
        minValue={toDate(min)}
        maxValue={toDate(max)}
        granularity="day"
        onChange={change}
        onFocusChange={(focused) => {
          setEditing(focused);
          if (focused) return;
          if (isCommittable(draft, min, max)) onCommit(draft);
          else setDraft(value);
        }}
      >
        <Group
          className={classNames(
            "cioosDateInput",
            className || "railValueInput timeRailDateInput",
          )}
        >
          <DateInput className="cioosDateSegments">
            {(segment) => (
              <DateSegment className="cioosDateSegment" segment={segment} />
            )}
          </DateInput>
          <Button
            className="cioosDateButton"
            aria-label={t("datePickerOpenCalendar")}
          >
            <Calendar3 aria-hidden="true" />
          </Button>
        </Group>
        <Popover className="cioosDatePopover" placement="bottom end">
          <Dialog className="cioosDateDialog">
            <Calendar className="cioosCalendar">
              <header className="cioosCalendarHeader">
                <Button slot="previous" className="cioosCalendarNav">
                  <ChevronLeft aria-hidden="true" />
                </Button>
                <MonthYearPickers yearMin={yearMin} onPick={change} />
                <Button slot="next" className="cioosCalendarNav">
                  <ChevronRight aria-hidden="true" />
                </Button>
              </header>
              <CalendarGrid className="cioosCalendarGrid">
                {(date) => (
                  <CalendarCell className="cioosCalendarCell" date={date} />
                )}
              </CalendarGrid>
            </Calendar>
          </Dialog>
        </Popover>
      </DatePicker>
    </I18nProvider>
  );
}
