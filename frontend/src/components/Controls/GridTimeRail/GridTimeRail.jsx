import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import Rail from '../Rail/Rail.jsx'
import { snapToGridNode } from '../../../wmsUtilities'
import gridTimeTicks from './gridTimeTicks.js'
import './styles.css'

// The slider for the time slice of the gridded dataset drawn on the map, on the
// dataset's own axis.
//
// It used to be a third mark on the bottom bar's shared rail, beside the filter
// range and the trajectory date. Reading it there was easy — it said where the
// drawn slice sat against everything else time-shaped — but moving it was not:
// that axis spans the whole catalogue, so a dataset covering a season of one
// year was given a few pixels of a rail hundreds wide, its handle sat under the
// range handles, and a press near it moved whichever of them was closest. The
// slice can't be picked at all at that scale.
//
// So the mark that has to be *moved* gets an axis of its own, where the
// dataset's span is the whole width and every slice has room; the shared rail
// keeps a band showing where that span falls in the record, which is the part
// that was worth reading there.
//
// Plain linear: this is one dataset's own axis, evenly spaced by construction
// (see gridAxisNodes), with no era to compress.
export default function GridTimeRail ({ nodes, value, onCommit, className }) {
  const { t } = useTranslation()

  const axis = useMemo(
    () => ({
      min: nodes.min,
      max: nodes.max,
      minText: new Date(nodes.min).toISOString(),
      maxText: new Date(nodes.max).toISOString(),
      toPos: (ms) => (ms - nodes.min) / (nodes.max - nodes.min),
      toValue: (pos) => nodes.min + pos * (nodes.max - nodes.min)
    }),
    [nodes]
  )

  const valueMs = Date.parse(value)

  const ticksFor = useCallback(
    (railLength) => gridTimeTicks(railLength, nodes.min, nodes.max),
    [nodes]
  )

  return (
    <Rail
      className={['gridTimeRail', className].filter(Boolean).join(' ')}
      axis={axis}
      handles={[
        {
          key: 'grid',
          value: valueMs,
          valueText: value,
          label: t('timeBarGridLabel'),
          className: 'railHandleMarker railHandleGrid'
        }
      ]}
      // How far into the dataset the drawn slice sits. Nothing is filtered here
      // — the band is the read the marker's position alone is too small to
      // give at a glance.
      bands={[
        {
          key: 'elapsed',
          from: nodes.min,
          to: valueMs,
          className: 'gridTimeRailFill'
        }
      ]}
      ticksFor={ticksFor}
      // Only the slices the dataset actually holds, so dragging steps through
      // the grid rather than scrubbing past it.
      snap={(ms) => snapToGridNode(nodes, ms)}
      // A slice per arrow press — the point of this rail — and ten to a shifted
      // or paged one, for the grids that hold thousands.
      stepFor={(event) =>
        nodes.step *
        (event.shiftKey || event.key.startsWith('Page') ? 10 : 1)}
      onCommit={(handle, ms) => onCommit(new Date(ms).toISOString())}
    />
  )
}
