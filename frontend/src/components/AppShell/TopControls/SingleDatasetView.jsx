import * as React from 'react'
import { X, ZoomIn } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'

import { useZoomToDataset } from '../ZoomToDataset/ZoomToDataset.jsx'
import { useSelection } from '../../../state/selection/SelectionProvider.jsx'
import { useUI } from '../../../state/ui/UIProvider.jsx'

// While a dataset page is open the map singles that dataset out — every other
// one stays drawn, but grey (see hoverHighlightPoints in Map.jsx). The
// sidebar's dataset banner is what names that state, and collapsing the
// sidebar takes the whole card away with it: the map is left keyed to one
// dataset with nothing on screen saying which, and no way out other than the
// top bar's Datasets button, which reopens the list as well.
//
// So this stands in for that banner, last in the top bar's stack: the dataset
// named above, and the two things to do with it below. Zooming is the same
// camera move the dataset page's own zoom button makes (useZoomToDataset,
// which is where the footprint and the "nothing to frame" case are decided);
// clearing releases the focus by the same call the banner's back control uses.
// Both actions therefore agree with their counterparts inside the page.
export default function SingleDatasetView () {
  const { t } = useTranslation()
  const { inspectDataset, returnToDatasetList } = useSelection()
  const { sidebarOpen } = useUI()
  const { zoomToDataset, canZoom } = useZoomToDataset()

  // Only ever up while the card is down: with the sidebar open the banner
  // above the page already says all this.
  if (!inspectDataset || sidebarOpen) return null

  return (
    <div className='singleDatasetView'>
      {/* One line however long the title is — this is a marker, not the page. */}
      <span className='singleDatasetViewTitle' title={inspectDataset.title}>
        {inspectDataset.title}
      </span>
      <div className='singleDatasetViewActions'>
        {/* A dataset with no footprint at all has nothing to frame, so the
            button is absent rather than dead. Unlike the dataset page's zoom
            button this one stays put once the extent is on screen: the card is
            what names the state, and it should not reshape itself as the user
            pans. */}
        {canZoom && (
          <button
            type='button'
            className='singleDatasetViewButton'
            onClick={zoomToDataset}
            // The labels are short enough to sit side by side; these are what
            // say, to a screen reader, which dataset they act on.
            aria-label={t('centerOnDatasetLabel', {
              dataset: inspectDataset.title
            })}
          >
            <ZoomIn size={14} aria-hidden='true' />
            {t('singleDatasetZoomText')}
          </button>
        )}
        <button
          type='button'
          className='singleDatasetViewButton'
          onClick={returnToDatasetList}
          aria-label={t('clearDatasetViewText')}
        >
          <X size={16} aria-hidden='true' />
          {t('singleDatasetClearText')}
        </button>
      </div>
    </div>
  )
}
