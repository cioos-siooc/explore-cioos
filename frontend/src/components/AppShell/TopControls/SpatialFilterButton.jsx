import * as React from 'react'
import { useEffect, useState } from 'react'
import { BoundingBox, Check2, Clipboard, Pentagon, X } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'

import { DropdownButton, Dropdown } from '../../ui/Dropdown.jsx'
import { polygonIsRectangle, polygonToWkt } from '../../../utilities.jsx'
import { useMapState } from '../../../state/map/MapStateProvider.jsx'
import { useSelection } from '../../../state/selection/SelectionProvider.jsx'

// Third segment of the top bar's Datasets/Filters pill: the single entry
// point for the map's two draw tools. It used to be three separate buttons
// (rectangle, polygon, trash) parked in the map's lower-right corner; picking
// an option here now just sends a one-shot request to the map (see
// requestDraw/drawRequest in MapStateProvider) — the draw plugin itself has
// no React-facing API, so Map.jsx is still the one calling changeMode/
// deleteAll, only now off state instead of a click on its own control.
//
// Its own open/closed state lives in DropdownButton, not here — onOpenChange
// mirrors it into menuOpen so the toggle can go solid while the menu itself
// is up, distinct from the lighter "applied" wash it gets from a drawn shape
// once the menu is closed again.
export default function SpatialFilterButton () {
  const { t } = useTranslation()
  const { requestDraw } = useMapState()
  const { polygon } = useSelection()
  const [menuOpen, setMenuOpen] = useState(false)

  // Briefly swaps the copy button's icon to a checkmark after a successful
  // copy, then reverts — a timeout in an effect (not the click handler) so
  // it's cleared if the panel closes (or the selection changes) mid-countdown.
  const [wktCopied, setWktCopied] = useState(false)
  useEffect(() => {
    if (!wktCopied) return
    const timer = setTimeout(() => setWktCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [wktCopied])

  const hasSelection = Boolean(polygon)
  const isBox = hasSelection && polygonIsRectangle(polygon)
  const Icon = isBox ? BoundingBox : hasSelection ? Pentagon : BoundingBox

  return (
    <DropdownButton
      onOpenChange={setMenuOpen}
      toggleClassName={classNames(
        'topBarButton topBarSpatialFilterToggle',
        {
          // Solid/active while the menu itself is open; once it's closed, a
          // drawn shape still gets the lighter "applied" wash so the button
          // keeps signalling the filter is in effect without competing with
          // whichever segment's UI is actually up.
          active: menuOpen,
          applied: !menuOpen && hasSelection
        }
      )}
      tooltip={t('spatialFilterMenuTitle')}
      title={<Icon size={18} aria-hidden='true' />}
      align='center'
    >
      <Dropdown.Item onClick={() => requestDraw('box')} active={isBox}>
        <BoundingBox size={16} aria-hidden='true' />
        {t('drawBoundingBoxOption')}
      </Dropdown.Item>
      <Dropdown.Item
        onClick={() => requestDraw('polygon')}
        active={hasSelection && !isBox}
      >
        <Pentagon size={16} aria-hidden='true' />
        {t('drawPolygonOption')}
      </Dropdown.Item>
      {hasSelection && (
        <Dropdown.Item onClick={() => requestDraw('clear')}>
          <X size={16} aria-hidden='true' />
          {t('drawClearOption')}
        </Dropdown.Item>
      )}
      {hasSelection && (
        <div className='spatialFilterWktSection'>
          <button
            type='button'
            className='dropdown-item'
            onClick={() => {
              navigator.clipboard.writeText(polygonToWkt(polygon))
              setWktCopied(true)
            }}
          >
            {wktCopied
              ? <Check2 size={16} aria-hidden='true' />
              : <Clipboard size={16} aria-hidden='true' />}
            {t(wktCopied ? 'copiedSelectionWktTitle' : 'copySelectionWktTitle')}
          </button>
        </div>
      )}
    </DropdownButton>
  )
}
