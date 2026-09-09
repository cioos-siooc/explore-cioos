import * as React from 'react'
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'

import Spinner from '../../ui/Spinner.jsx'
import useDatasetCounts from '../../../state/useDatasetCounts.js'
import { useSelection } from '../../../state/selection/SelectionProvider.jsx'

// The dataset tally: one compact line of type between the brand lockup and the
// Datasets/Filters tabs, banded off from both so it reads as its own strip —
// "123/150 datasets (23 in view)".
//
// The parenthetical is a button, not a caption: it both reports how many of
// those datasets the map viewport holds and applies the "only in view"
// narrowing, so the number the user is reading is one click away from being the
// only number.
//
// Until `ready` there is no count to show — not even a zero — so the strip is a
// spinner. See useDatasetCounts.
export default function DatasetCounts () {
  const { t } = useTranslation()
  const {
    ready: countsReady,
    updating: countsUpdating,
    filteredCount,
    total
  } = useDatasetCounts()
  const { onlyInView, setOnlyInView, inViewCount } = useSelection()

  // A failed /datasets leaves no catalogue total; what came back filtered is
  // then all we know it to be.
  const totalCount = total ?? filteredCount

  return (
    <div className={classNames('topBarCountsRow', { updating: countsUpdating })}>
      {!countsReady
        ? (
          <Spinner size='xs' className='countSpinner' />
          )
        : (
          <>
            <span
              title={t('dockDatasetsCountTitle', {
                filtered: filteredCount,
                total: totalCount
              })}
            >
              {t('topBarCountsSummary', {
                filtered: filteredCount,
                total: totalCount
              })}
            </span>
            {/* The gap between the two spans supplies the space before the
                bracket: a literal one would be trimmed as leading whitespace
                at the start of the flex item. */}
            <span className='topBarCountsInViewWrap'>
              (
              <button
                type='button'
                className={classNames('topBarCountsInView', {
                  active: onlyInView
                })}
                onClick={() => setOnlyInView(!onlyInView)}
                aria-pressed={onlyInView}
                title={
                  onlyInView
                    ? t('topBarCountsInViewOffTitle')
                    : t('datasetsCardOnlyInViewTitle')
                }
              >
                {t('topBarCountsInViewLink', { count: inViewCount })}
              </button>
              )
            </span>
          </>
          )}
    </div>
  )
}
