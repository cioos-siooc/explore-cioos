import React, { useEffect, useRef, useState } from 'react'
import { ChevronUp, Grid3x3Gap, X } from 'react-bootstrap-icons'
import classNames from 'classnames'
import { Dropdown, DropdownButton } from '../../ui/Dropdown.jsx'
import { useTranslation } from 'react-i18next'

import { abbreviateString, useDebounce } from '../../../utilities'
import { buildGriddapLegendUrl } from '../../../wmsUtilities'
import { GridTimeSlice, GridDepthSlice } from '../GridSlice/GridSlice.jsx'
import usePublishedFootprint from '../../../state/ui/usePublishedFootprint.js'
import useMediaQuery, { MOBILE_QUERY } from '../../../state/ui/useMediaQuery.js'
import './styles.css'

// How far up the bottom-right corner this card reaches, plus a gap — the same
// measurement whether it is the card or the button it folds into. MapLibre's
// own controls sit in that corner and step up over whichever is there; the
// property is cleared when the overlay goes away, and the controls drop back.
const CORNER_STACK_GAP = 8
function measureWmsLegendSpace ({ top }) {
  return window.innerHeight - top + CORNER_STACK_GAP
}

// Below this width the card is a large fraction of the map it is drawn over,
// so it stands down to a button and opens only when asked.
//
// It used to be the top bar's doing: the card held the top-left corner, the
// centered bar reached over it below about 1200px, and standing down was how
// the card got out of the way without being pushed around. The card holds the
// bottom-right corner now, which nothing else reaches, so what is left is the
// plain question of how much of a small screen a colorbar should take — which
// is the app's own phone breakpoint, and not a number of this card's own.
const COMPACT_QUERY = MOBILE_QUERY

// Card shown while a griddap WMS overlay is active: the colorbar, the variable
// picker over it, and the overlay's always-available off switch. It renders
// either inside the dataset page (`inline`) or, when that page isn't open,
// pinned to the bottom-right corner of the map (`floating`).
//
// The card carries no caption of its own. ERDDAP draws one into the legend
// image — the variable and its units, the dataset title, and the slice being
// shown — so anything written beside it would only be the same words in a
// second typeface. The image is the title, and it links where the title used
// to: the dataset's page on ERDDAP.
//
// Which slice of the grid is drawn — in time and in depth — is set here, under
// the image (see GridSlice). Both used to be on the bars along the edges of the
// map, beside the filters for the same axes, the reasoning being that a date
// belongs with the other dates. But the caption they change is the one drawn
// into this image, and a control a screen away from its own reading is a
// control that has to be hunted for. The bars are the filters now, and this
// card is the overlay.
export default function WmsLegend({
  overlay,
  onClose,
  setActiveWmsOverlay,
  variant = 'floating'
}) {
  const { t } = useTranslation()
  const [legendFailed, setLegendFailed] = useState(false)

  // Only the floating card is drawn over the map; the inline one is inside the
  // dataset page and always has its own room.
  const isCompact = useMediaQuery(COMPACT_QUERY) && variant === 'floating'
  const [compactOpen, setCompactOpen] = useState(false)

  // Attached to whichever of the two the floating variant is showing, and to
  // neither when this card is inline — nothing in the map's corner then.
  const cornerRef = useRef(null)
  usePublishedFootprint(
    cornerRef,
    '--cioos-wms-legend-space',
    measureWmsLegendSpace
  )

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
        ref={cornerRef}
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
      ref={variant === 'floating' ? cornerRef : undefined}
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
      {/* Under the image, because they change what the image says: the caption
          ERDDAP draws into the colorbar names the slice being shown. */}
      <GridTimeSlice
        overlay={overlay}
        onChange={(time) => setActiveWmsOverlay({ ...overlay, time })}
      />
      <GridDepthSlice
        overlay={overlay}
        onChange={(elevation) =>
          setActiveWmsOverlay({ ...overlay, elevation })}
      />
    </div>
  )
}
