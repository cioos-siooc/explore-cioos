import React from 'react'
import classNames from 'classnames'
import { ChevronLeft, ChevronRight } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'

import './pagerStyles.css'

// The page sizes every paged card list in the app offers, the first being the
// default. One list's idea of "a page" should not differ from another's.
export const PAGE_SIZES = [25, 50, 100]

// How many numbered buttons the pager shows around the current page before it
// falls back to ellipses (kept small — these lists live in a ~420px column).
const PAGE_WINDOW = 1

// The page numbers to offer: always the first and last, the current page and
// its neighbours, with '…' standing in for the runs left out. Returns e.g.
// [1, '…', 7, 8, 9, '…', 24].
function pageButtons (current, pageCount) {
  const wanted = new Set([1, pageCount])
  for (let page = current - PAGE_WINDOW; page <= current + PAGE_WINDOW; page++) {
    if (page >= 1 && page <= pageCount) wanted.add(page)
  }
  const pages = [...wanted].sort((a, b) => a - b)
  const out = []
  let previous = 0
  for (const page of pages) {
    // A single skipped page is worth showing outright — an ellipsis standing in
    // for one number is both wider and less useful than the number.
    if (page - previous === 2) out.push(previous + 1)
    else if (page - previous > 2) out.push(`gap-${page}`)
    out.push(page)
    previous = page
  }
  return out
}

// The pager under a paged card list: which slice is on screen, the way to the
// other pages, and how many items a page holds. Purely presentational — the
// list owns `page` and `pageSize`, because only it knows what a page of its
// own items is (a grouped list pages its rows, not its headers).
//
// `label` names the list for a screen reader ("Dataset list pages") and
// `perPageLabel` its size control ("Datasets per page"); both are the caller's
// words, since only it knows what is being paged.
export default function Pager ({
  page,
  pageCount,
  pageSize,
  pageSizes = PAGE_SIZES,
  total,
  onPageChange,
  onPageSizeChange,
  label,
  perPageLabel
}) {
  const { t } = useTranslation()
  if (!total) return null

  const firstItem = (page - 1) * pageSize

  return (
    <nav className='pager' aria-label={label}>
      <span className='pagerRange'>
        {t('pagerRangeText', {
          first: firstItem + 1,
          last: Math.min(firstItem + pageSize, total),
          total
        })}
      </span>
      {pageCount > 1 && (
        <div className='pagerControls'>
          <button
            type='button'
            className='pagerStep'
            onClick={() => onPageChange(page - 1)}
            disabled={page === 1}
            title={t('pagerPreviousTitle')}
            aria-label={t('pagerPreviousTitle')}
          >
            <ChevronLeft size={12} aria-hidden='true' />
          </button>
          {pageButtons(page, pageCount).map((entry) =>
            typeof entry === 'number' ? (
              <button
                key={entry}
                type='button'
                className={classNames('pagerPage', { active: entry === page })}
                onClick={() => onPageChange(entry)}
                aria-current={entry === page ? 'page' : undefined}
                title={t('pagerPageTitle', { page: entry })}
              >
                {entry}
              </button>
            ) : (
              <span key={entry} className='pagerGap' aria-hidden='true'>
                …
              </span>
            )
          )}
          <button
            type='button'
            className='pagerStep'
            onClick={() => onPageChange(page + 1)}
            disabled={page === pageCount}
            title={t('pagerNextTitle')}
            aria-label={t('pagerNextTitle')}
          >
            <ChevronRight size={12} aria-hidden='true' />
          </button>
        </div>
      )}
      <label className='pagerSize'>
        <span className='sr-only'>{perPageLabel}</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          title={perPageLabel}
        >
          {/* The number is put in place here rather than interpolated: a
              numeric `count` option is i18next's pluralization trigger (see
              the note in Map.jsx), and the unit is the only translated part of
              "25 per page" anyway. */}
          {pageSizes.map((size) => (
            <option key={size} value={size}>
              {`${size} ${t('pagerPerPageUnitText')}`}
            </option>
          ))}
        </select>
      </label>
    </nav>
  )
}
