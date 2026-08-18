import * as React from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  CheckCircleFill,
  CircleFill,
  Grid3x3Gap,
  Plus,
  Search,
  X
} from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'

import platformColors from '../../platformColors'
import { useMapState } from '../../../state/map/MapStateProvider.jsx'
import { useSelection } from '../../../state/selection/SelectionProvider.jsx'
import './styles.css'

// The "what's here" card: the single answer to a click anywhere on the map.
//
// One gesture used to mean six different things depending on which layer owned
// the pixel — fly to zoom 7, build a hidden 20px bbox filter, overwrite the
// datasets filter, open a dataset page, or clear everything — arbitrated by a
// ladder of stand-aside tests the user could not see. Map.jsx now gathers
// everything under the click and hands it here; this card names what it found
// and puts each consequence behind its own button. Nothing happens on open.
//
// It is also what makes the map usable by touch. Every hover tooltip's content
// appears here too, so a device with no hover loses nothing, and on a phone the
// card is a half-height sheet rather than a popup — the map stays visible above
// it, which is the only way to see what a selection did.

// How far a stack has to grow before the list scrolls rather than the card.
const VISIBLE_ROWS = 5

// Clearance between the card and the point it describes, and between the card
// and the edge of the window. Kept in step with the width in styles.css.
const CARD_GAP_PX = 14
const CARD_MARGIN_PX = 8
const CARD_WIDTH_PX = 320

// Below this the card is a bottom sheet and anchors to nothing, so the inline
// positioning below is skipped entirely — an inline `left`/`top` would beat the
// stylesheet's sheet rules and no media query could undo it. Same rung as the
// datasets sheet (see theme.css).
const SHEET_QUERY = '(max-width: 700px)'

const KIND_ORDER = ['track', 'observation', 'grid']

export default function FeatureCard () {
  const { t, i18n } = useTranslation()
  const { featureQuery, setFeatureQuery, mapRef, zoomToGeometry } = useMapState()
  const {
    pointsData,
    setInspectDataset,
    selectTrajectoryFromMap,
    addDatasetsToSelection
  } = useSelection()

  const cardRef = useRef(null)
  const [anchor, setAnchor] = useState(null)
  const [expanded, setExpanded] = useState(false)
  // Which side of the anchor the card hangs off. Above by default — the card
  // then sits over water the user is not pointing at — but a click near the top
  // of the canvas has no room there and the card would be clipped by the
  // viewport, so it flips under the point instead.
  const [below, setBelow] = useState(false)
  const [isSheet, setIsSheet] = useState(
    () => window.matchMedia(SHEET_QUERY).matches
  )

  useEffect(() => {
    const mql = window.matchMedia(SHEET_QUERY)
    const onChange = (e) => setIsSheet(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  const close = useCallback(() => setFeatureQuery(null), [setFeatureQuery])

  // A fresh query is a fresh card: collapse any "show all" the last one was
  // left in.
  useEffect(() => setExpanded(false), [featureQuery?.nonce])

  // The card is pinned to the water it describes, not to the screen, so it
  // travels with a pan and stays put through the "Zoom here" flight. Projecting
  // on every 'move' is cheap — one matrix multiply against a single point.
  useLayoutEffect(() => {
    const map = mapRef.current
    if (!map || !featureQuery) {
      setAnchor(null)
      return undefined
    }
    const project = () => {
      const point = map.project(featureQuery.lngLat)
      setAnchor({ x: point.x, y: point.y })
    }
    project()
    map.on('move', project)
    return () => map.off('move', project)
  }, [mapRef, featureQuery])

  // Flip below the anchor when there isn't room above it. Measured rather than
  // guessed: the card's height depends on how many datasets the click found and
  // on whether "show more" has been pressed.
  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el || !anchor || isSheet) return
    setBelow(anchor.y - el.offsetHeight - CARD_GAP_PX < CARD_MARGIN_PX)
  }, [anchor, expanded, isSheet, featureQuery?.nonce])

  // Escape closes, like every other dismissable surface in the app.
  useEffect(() => {
    if (!featureQuery) return undefined
    const onKeyDown = (e) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [featureQuery, close])

  if (!featureQuery) return null

  // The hex and point tiles carry dataset pks but no titles, so an observation
  // row has to resolve against the current results to have anything to say —
  // and one that doesn't resolve is genuinely not in the list the buttons act
  // on, so it is dropped.
  //
  // Tracks and grids are the other way round: they come from their own sources,
  // which apply only the dataset-level filters, so they can still be drawn for a
  // dataset that pointQuery's depth/bbox/polygon predicates dropped — and they
  // carry their own titles. Dropping those rows would leave something plainly
  // visible on the map that the card claimed was not there. They stay, and only
  // the actions that genuinely need a result row are withheld.
  const byPk = new Map(pointsData.map((row) => [Number(row.pk), row]))

  const rows = featureQuery.items
    .map((item) => {
      const row = byPk.get(item.pk)
      if (!row && item.kind === 'observation') return null
      return {
        ...item,
        title: row?.title || item.title,
        platform: row?.platform || item.platform,
        row,
        // A dataset page resolves out of pointsData. A track without one still
        // opens: selectTrajectoryFromMap draws the platform's history either
        // way and leaves the page alone when it can't resolve the dataset,
        // which is exactly what clicking the track used to do.
        openable: item.kind === 'track' || Boolean(row),
        // Griddap is metadata-only: it never enters the selection, and the
        // list's own button is disabled for one, so the card says the same
        // rather than offering a "+" that would quietly do nothing.
        selectable: item.kind !== 'grid' && row?.cdm_data_type !== 'Grid',
        inSelection: Boolean(row?.selected)
      }
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        (b.count || 0) - (a.count || 0)
    )

  // Everything under the click resolved away (all of it filtered out of the
  // current results): say so rather than showing an empty card.
  const empty = rows.length === 0
  const shown = expanded ? rows : rows.slice(0, VISIBLE_ROWS)
  const hidden = rows.length - shown.length

  // Deduped: the same dataset can appear as both a track and an observation
  // under one click, and "Add all 5" should not claim five when it means four.
  const addablePks = [
    ...new Set(
      rows
        .filter((entry) => entry.selectable && !entry.inSelection)
        .map((entry) => entry.pk)
    )
  ]

  const openDataset = (entry) => {
    if (entry.kind === 'track') {
      // Same call the inspector's platform table makes: open the page and draw
      // the platform's full history in one batched write.
      selectTrajectoryFromMap(entry.pk, entry.trajectoryId, entry.title)
      close()
      return
    }
    if (entry.row) {
      setInspectDataset(entry.row)
      close()
    }
  }

  // Adding a single row keeps the card open: picking two of the five datasets
  // under one click is the normal case, and closing after the first would make
  // the user click the same hex again for the second. "Add all" is the end of
  // the interaction, so that one closes.
  //
  // "Selection", not "download": these datasets are being set aside. Downloading
  // is one thing you can then do with them, from the list's footer.
  const addOne = (pk) => addDatasetsToSelection([pk])

  const addAll = (pks) => {
    addDatasetsToSelection(pks)
    close()
  }

  const zoomHere = () => {
    if (!featureQuery.bounds) return
    const [[west, south], [east, north]] = featureQuery.bounds
    zoomToGeometry({
      type: 'Polygon',
      coordinates: [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south]
        ]
      ]
    })
    close()
  }

  const kindIcon = (entry) => {
    if (entry.kind === 'grid') {
      return <Grid3x3Gap size={13} aria-hidden='true' />
    }
    if (entry.kind === 'track') {
      return <ArrowRight size={13} aria-hidden='true' />
    }
    const platformColor = platformColors.find(
      (pc) => pc.platform === entry.platform
    )
    return (
      <CircleFill
        size={9}
        aria-hidden='true'
        style={platformColor ? { color: platformColor.color } : undefined}
      />
    )
  }

  const countLabel = (value) =>
    t('mapHexCountDays', {
      total: Number(value || 0).toLocaleString(i18n.language)
    })

  // Positioned by the anchor on desktop and pinned to the bottom edge on phones
  // (see styles.css, where the media query overrides `left`, `top` and
  // `transform` wholesale).
  //
  // The horizontal clamp keeps a card anchored near either edge of the canvas
  // fully on screen; the card is centred on its point everywhere there is room
  // for it to be, which is most of the map.
  const half = CARD_WIDTH_PX / 2
  const style = anchor && !isSheet
    ? {
      left: Math.min(
        Math.max(anchor.x, half + CARD_MARGIN_PX),
        Math.max(window.innerWidth - half - CARD_MARGIN_PX, half + CARD_MARGIN_PX)
      ),
      top: anchor.y,
      transform: below
        ? `translate(-50%, ${CARD_GAP_PX}px)`
        : `translate(-50%, calc(-100% - ${CARD_GAP_PX}px))`
    }
    : undefined

  return (
    <div
      className={classNames('featureCard', { featureCardEmpty: empty })}
      style={style}
      ref={cardRef}
      role='dialog'
      aria-label={t('featureCardTitle')}
    >
      <div className='featureCardHeader'>
        <div className='featureCardHeading'>
          <span className='featureCardHeadingTitle'>
            {t('featureCardTitle')}
          </span>
          {!empty && (
            <span className='featureCardHeadingMeta'>
              {t('featureCardSummary', { n: rows.length })}
              {featureQuery.observationCount > 0 &&
                ` · ${countLabel(featureQuery.observationCount)}`}
            </span>
          )}
        </div>
        <button
          type='button'
          className='featureCardClose'
          onClick={close}
          title={t('featureCardClose')}
        >
          <X size={18} aria-hidden='true' />
        </button>
      </div>

      {empty ? (
        <p className='featureCardEmptyText'>{t('featureCardEmpty')}</p>
      ) : (
        <>
          <div className='featureCardList'>
            {shown.map((entry) => (
              <div
                className='featureCardRow'
                key={`${entry.kind}:${entry.pk}:${entry.trajectoryId ?? ''}`}
              >
                {/* A gridded footprint the current results don't contain has no
                    page to open — the rectangles come from their own source and
                    outlive the filter that dropped the dataset. It still reads
                    as a row (it is genuinely here) and "+" still brings it in;
                    it just isn't a button pretending to lead somewhere. */}
                <button
                  type='button'
                  className='featureCardRowOpen'
                  onClick={() => openDataset(entry)}
                  disabled={!entry.openable}
                  title={entry.title}
                >
                  <span className='featureCardRowIcon'>{kindIcon(entry)}</span>
                  <span className='featureCardRowText'>
                    <span className='featureCardRowTitle'>{entry.title}</span>
                    <span className='featureCardRowMeta'>
                      {entry.kind === 'track'
                        ? entry.trajectoryId || t('featureCardTrack')
                        : entry.kind === 'grid'
                          ? t('featureCardGrid')
                          : [
                            countLabel(entry.count),
                            // An aggregate cell is a neighbourhood, not a
                            // place: say so rather than implying the precision
                            // an individual marker has.
                            entry.aggregate ? t('featureCardNearby') : null
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                    </span>
                  </span>
                </button>
                {/* Ticks the dataset into the download selection — the same
                    thing its checkbox in the list does. A tick replaces the
                    plus once it is in, so the card reads as a running basket
                    rather than a row of identical buttons. */}
                <button
                  type='button'
                  className={classNames('featureCardRowAdd', {
                    isSelected: entry.inSelection
                  })}
                  onClick={() => addOne(entry.pk)}
                  disabled={!entry.selectable || entry.inSelection}
                  title={
                    !entry.selectable
                      ? t('griddapNotDownloadableTooltip')
                      : entry.inSelection
                        ? t('featureCardAlreadyAdded')
                        : t('featureCardAddOne')
                  }
                >
                  {entry.inSelection ? (
                    <CheckCircleFill size={15} aria-hidden='true' />
                  ) : (
                    <Plus size={16} aria-hidden='true' />
                  )}
                </button>
              </div>
            ))}
          </div>

          {hidden > 0 && (
            <button
              type='button'
              className='featureCardMore'
              onClick={() => setExpanded(true)}
            >
              {t('featureCardShowMore', { n: hidden })}
            </button>
          )}

          <div className='featureCardActions'>
            {addablePks.length > 0 && (
              <button
                type='button'
                className='featureCardAction primary'
                onClick={() => addAll(addablePks)}
                title={t('featureCardAddAllTitle')}
              >
                <Plus size={15} aria-hidden='true' />
                {t('featureCardAddAll', { n: addablePks.length })}
              </button>
            )}
            {featureQuery.bounds && (
              <button
                type='button'
                className='featureCardAction'
                onClick={zoomHere}
              >
                <Search size={14} aria-hidden='true' />
                {t('featureCardZoomHere')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
