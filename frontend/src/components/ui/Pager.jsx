import React from "react";
import classNames from "classnames";
import { ChevronLeft, ChevronRight } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";

import Button from "./Button.jsx";

import "./pagerStyles.css";

export const PAGE_SIZES = [25, 50, 100];

// Kept small: these lists live in a ~420px column.
const PAGE_WINDOW = 1;

// e.g. [1, '…', 7, 8, 9, '…', 24].
function pageButtons(current, pageCount) {
  const wanted = new Set([1, pageCount]);
  for (
    let page = current - PAGE_WINDOW;
    page <= current + PAGE_WINDOW;
    page++
  ) {
    if (page >= 1 && page <= pageCount) wanted.add(page);
  }
  const pages = [...wanted].sort((a, b) => a - b);
  const out = [];
  let previous = 0;
  for (const page of pages) {
    // An ellipsis standing in for one number is wider and less useful than it.
    if (page - previous === 2) out.push(previous + 1);
    else if (page - previous > 2) out.push(`gap-${page}`);
    out.push(page);
    previous = page;
  }
  return out;
}

// Presentational: the list owns `page` and `pageSize`, since a grouped list
// pages its rows, not its headers.
export default function Pager({
  page,
  pageCount,
  pageSize,
  pageSizes = PAGE_SIZES,
  total,
  onPageChange,
  onPageSizeChange,
  label,
  perPageLabel,
  // Says what the total leaves out, when it isn't every item.
  rangeTitle,
  // Shown after the range, e.g. the download modal's selection totals.
  children,
  "data-testid": testId,
}) {
  const { t } = useTranslation();
  if (!total) return null;

  const firstItem = (page - 1) * pageSize;

  return (
    <nav className="pager" aria-label={label} data-testid={testId}>
      <span className="pagerRange" title={rangeTitle}>
        {t("pagerRangeText", {
          first: firstItem + 1,
          last: Math.min(firstItem + pageSize, total),
          total,
        })}
      </span>
      {children}
      {pageCount > 1 && (
        <div className="pagerControls">
          <Button
            className="pagerStep"
            onPress={() => onPageChange(page - 1)}
            isDisabled={page === 1}
            title={t("pagerPreviousTitle")}
            aria-label={t("pagerPreviousTitle")}
          >
            <ChevronLeft size={12} aria-hidden="true" />
          </Button>
          {pageButtons(page, pageCount).map((entry) =>
            typeof entry === "number" ? (
              <Button
                key={entry}
                className={classNames("pagerPage", { active: entry === page })}
                onPress={() => onPageChange(entry)}
                aria-current={entry === page ? "page" : undefined}
                title={t("pagerPageTitle", { page: entry })}
              >
                {entry}
              </Button>
            ) : (
              <span key={entry} className="pagerGap" aria-hidden="true">
                …
              </span>
            ),
          )}
          <Button
            className="pagerStep"
            onPress={() => onPageChange(page + 1)}
            isDisabled={page === pageCount}
            title={t("pagerNextTitle")}
            aria-label={t("pagerNextTitle")}
          >
            <ChevronRight size={12} aria-hidden="true" />
          </Button>
        </div>
      )}
      <label className="pagerSize">
        <span className="sr-only">{perPageLabel}</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          title={perPageLabel}
        >
          {/* Not interpolated: a numeric `count` option triggers i18next
              pluralization (see the note in Map.jsx). */}
          {pageSizes.map((size) => (
            <option key={size} value={size}>
              {`${size} ${t("pagerPerPageUnitText")}`}
            </option>
          ))}
        </select>
      </label>
    </nav>
  );
}
