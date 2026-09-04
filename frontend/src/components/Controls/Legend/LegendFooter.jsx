import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AttributionControl, ScaleControl } from 'maplibre-gl'
import { InfoCircle } from 'react-bootstrap-icons'

import { useMapState } from '../../../state/map/MapStateProvider.jsx'

// The foot of the legend card: the map's scale bar, and the ⓘ that opens the
// basemap credits.
//
// Both used to stand in MapLibre's bottom-right corner, where they shared the
// edge with the draw tools, the time bar and the zoom pill — four unrelated
// things in one corner, each having to be lifted clear of the others. They say
// what the map is drawn from and how far across it is, which is what the legend
// card is for, so they live here instead: one row, and the credits behind a
// disclosure rather than spread across the corner.
//
// Nothing is lost by folding them in. The scale bar is MapLibre's own control,
// re-parented rather than reimplemented, so it still redraws on every move; the
// credits are the real AttributionControl, so they still aggregate whatever
// sources the style has loaded — including any added after mount.
export default function LegendFooter () {
  const { t } = useTranslation()
  const { mapRef, mapLoaded } = useMapState()
  const scaleHost = useRef(null)
  const creditsHost = useRef(null)
  const [creditsOpen, setCreditsOpen] = useState(false)

  // Adopt the two controls into this card instead of handing them to
  // map.addControl, which would put them back in a corner. onAdd/onRemove is
  // the whole of the IControl contract — it wires the map listeners and returns
  // the element — so calling it ourselves is the supported way to choose the
  // parent.
  //
  // mapLoaded is a dependency rather than a guard: mapRef is filled when Map
  // constructs the instance, which normally lands before this effect, and the
  // flag is what re-runs it if it ever doesn't.
  useEffect(() => {
    const map = mapRef?.current
    if (!map || !scaleHost.current || !creditsHost.current) return

    // Capped short: it shares its row with the ⓘ inside a card that is at most
    // 190px wide.
    const scale = new ScaleControl({ maxWidth: 120, unit: 'metric' })
    scaleHost.current.appendChild(scale.onAdd(map))

    // compact: false keeps the control expanded and inert — its own <summary>
    // toggle is hidden in the stylesheet, because the disclosure here is the ⓘ
    // button, and two toggles for one block of text would fight each other.
    const credits = new AttributionControl({ compact: false })
    creditsHost.current.appendChild(credits.onAdd(map))

    return () => {
      scale.onRemove()
      credits.onRemove()
    }
  }, [mapRef, mapLoaded])

  return (
    <div className='legendFooter'>
      <div className='legendFooterRow'>
        <div className='legendScale' ref={scaleHost} />
        <button
          className='legendCreditsButton'
          onClick={() => setCreditsOpen(!creditsOpen)}
          title={t('legendCreditsTooltip')}
          aria-label={t('legendCreditsTooltip')}
          aria-expanded={creditsOpen}
        >
          <InfoCircle size={13} aria-hidden='true' />
        </button>
      </div>
      {/* Mounted whether or not it is shown: the control keeps itself current
          from the map's own events, and a host that came and went would have to
          be re-adopted every time the ⓘ is pressed. */}
      <div
        className='legendCredits'
        ref={creditsHost}
        hidden={!creditsOpen}
      />
    </div>
  )
}
