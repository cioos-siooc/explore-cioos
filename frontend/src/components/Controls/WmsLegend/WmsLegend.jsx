import React, { useEffect, useState } from 'react'
import { ChevronUp, Grid3x3Gap, X } from 'react-bootstrap-icons'
import classNames from 'classnames'
import { Dropdown, DropdownButton } from '../../ui/Dropdown.jsx'
import { useTranslation } from 'react-i18next'

import { abbreviateString, useDebounce } from '../../../utilities'
import { buildGriddapLegendUrl } from '../../../wmsUtilities'
import './styles.css'

// Below this width the centered top bar reaches over the map's top-left corner,
// and it draws a layer above this card. The card doesn't move out of the way —
// being moved by its neighbours is what it is pinned to avoid — so here it
// stands down to a button instead, and opens over the bar when asked.
//
// The number is where the bar's left edge crosses this card's right one:
// half of (viewport - bar width) against the card's 12px inset + 376px, with
// the bar around 420px wide before filter chips widen it.
const COMPACT_QUERY = '(max-width: 1200px)'

// Card shown while a griddap WMS overlay is active: the colorbar, the variable
// picker over it, and the overlay's always-available off switch. It renders
// either inside the dataset page (`inline`) or, when that page isn't open,
// pinned over the top-left corner of the map (`floating`).
//
// The card carries no caption of its own. ERDDAP draws one into the legend
// image — the variable and its units, the dataset title, and the slice being
// shown — so anything written beside it would only be the same words in a
// second typeface. The image is the title, and it links where the title used
// to: the dataset's page on ERDDAP.
//
// Which slice of the grid is drawn is not set here either. Time and depth are
// axes the app already has controls for — the bars along the edges of the map —
// and the grid's own rails ride those, beside the filters they should be read
// against; a pair of index-numbered range inputs on this card could say neither
// where the slice sat in the record nor how it related to anything else on
// screen.
export default function WmsLegend({
  overlay,
  onClose,
  setActiveWmsOverlay,
  variant = 'floating'
}) {
  const { t } = useTranslation()
  const [legendFailed, setLegendFailed] = useState(false)

  // Only the floating card can be covered by the top bar; the inline one is
  // inside the dataset page and always has its own room.
  const [isCompact, setIsCompact] = useState(
    () =>
      variant === 'floating' && window.matchMedia(COMPACT_QUERY).matches
  )
  const [compactOpen, setCompactOpen] = useState(false)
  useEffect(() => {
    if (variant !== 'floating') {
      setIsCompact(false)
      return undefined
    }
    const mql = window.matchMedia(COMPACT_QUERY)
    const onChange = (e) => setIsCompact(e.matches)
    setIsCompact(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [variant])

  const variables = overlay.variables || []

  // "long_name (units)" on a single line — the units are folded into the
  // picker label rather than shown on a separate line beneath it.
  function variableLabel(variable) {
    const name =
      variable.long_name || variable.standard_name || variable.name
    return variable.units ? `${name} (${variable.units})` : name
  }

  // The legend is asked for the slice actually on the map, so its caption
  // stays true while the grid rails are moved — but it is asked once the
  // moving stops. Each request has ERDDAP read a strided slab of the grid,
  // which is not something to spend on every step of a drag.
  const legendUrl = useDebounce(
    buildGriddapLegendUrl({
      erddapUrl: overlay.erddapUrl,
      variable: overlay.variable?.name,
      dimensions: overlay.dimensions,
      time: overlay.time,
      elevation: overlay.elevation
    }),
    400
  )

  useEffect(() => setLegendFailed(false), [legendUrl])

  // Stood down to a button (see COMPACT_QUERY). It names the variable rather
  // than saying "Legend": what the overlay is drawing is the one thing worth
  // knowing without opening the card, and it is the thing the colorbar's
  // caption would have said.
  //
  // The icon is the same Grid3x3Gap in the same teal the datasets list marks a
  // gridded dataset with (see DatasetCard) — this button stands for one of
  // those, and a mark it already uses elsewhere says so without a caption.
  if (isCompact && !compactOpen) {
    return (
      <button
        type='button'
        className='wmsLegendPeek'
        onClick={() => setCompactOpen(true)}
        title={t('wmsLegendShowTitle')}
      >
        <Grid3x3Gap size={15} color='#52a79b' aria-hidden='true' />
        <span className='wmsLegendPeekLabel'>
          {overlay.variable
            ? variableLabel(overlay.variable)
            : t('wmsLegendShowTitle')}
        </span>
      </button>
    )
  }

  return (
    <div
      className={classNames('wmsLegend', variant, { compactOpen: isCompact })}
    >
      {/* One row above the image, holding the two controls: what is drawn, and
          the way out. It sits above rather than over the image because the top
          of the image is the colorbar, edge to edge, with no corner to cover
          without covering a reading. A dataset serving one variable has
          nothing to pick, and the image has already named it — then the row is
          the close button alone. */}
      <div className='wmsLegendHeader'>
        {variables.length > 1 && (
          <DropdownButton
            className='wmsLegendVariableSelector'
            size='sm'
            variant='outline-secondary'
            tooltip={t('griddapVariableSelect')}
            title={
              <span className='wmsLegendVariableName'>
                {overlay.variable ? variableLabel(overlay.variable) : ''}
              </span>
            }
          >
            {variables.map((variable) => (
              <Dropdown.Item
                key={variable.name}
                active={variable.name === overlay.variable?.name}
                onClick={() => setActiveWmsOverlay({ ...overlay, variable })}
              >
                {variableLabel(variable)}
              </Dropdown.Item>
            ))}
          </DropdownButton>
        )}
        {/* Folds the card back to its button. Distinct from the X beside it,
            which turns the overlay off — this one only stops showing its key,
            and it is only here where the card has a button to fold back to. */}
        {isCompact && (
          <button
            className='wmsLegendCloseButton'
            onClick={() => setCompactOpen(false)}
            title={t('wmsLegendCollapseTitle')}
            aria-label={t('wmsLegendCollapseTitle')}
          >
            <ChevronUp size={16} />
          </button>
        )}
        <button
          className='wmsLegendCloseButton'
          onClick={onClose}
          title={t('wmsLegendCloseTitle')}
          aria-label={t('wmsLegendCloseTitle')}
        >
          <X size={16} />
        </button>
      </div>
      {legendUrl && !legendFailed ? (
        <a
          className='wmsLegendFigure'
          href={overlay.erddapUrl}
          target='_blank'
          rel='noreferrer'
          title={overlay.erddapUrl}
        >
          <img
            className='wmsLegendImage'
            src={legendUrl}
            alt={`${overlay.variable?.name} ${t('griddapLegendAltText')}`}
            onError={() => setLegendFailed(true)}
          />
        </a>
      ) : (
        // With no image there is nothing to read the dataset off, so the card
        // says it itself — the one case it has to.
        <div className='wmsLegendFallback'>
          <a
            className='wmsLegendTitle'
            href={overlay.erddapUrl}
            target='_blank'
            rel='noreferrer'
            title={overlay.erddapUrl}
          >
            {abbreviateString(overlay.title, 45)}
          </a>
          {overlay.variable && (
            <div className='wmsLegendVariable'>
              {variableLabel(overlay.variable)}
            </div>
          )}
          <div className='wmsLegendUnavailable'>
            {t('griddapLegendUnavailable')}
          </div>
        </div>
      )}
    </div>
  )
}
