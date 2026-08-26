import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import {
  EMPTY_PLOT_AXES,
  axesFromParams,
  axesToParams,
  defaultPlotAxesFor,
  defaultVisFor
} from './previewPlotDefaults.js'

// Everything that describes the plot on screen, kept in the query string so a
// link reproduces it — the same arrangement SelectionProvider already uses for
// the open dataset page (?dataset=…&server=…), and for the same two payoffs:
// one source of truth, and Back/Forward for free.
//
// Every param is written ONLY when the value differs from the default the dataset
// type implies, and deleted again when it returns to it. So an untouched plot
// contributes nothing to the link, which is what keeps a shared URL from growing
// a tail of settings nobody changed. See useUrlSync for the same rule applied to
// the map's layer switches.
//
// The param names live in state/selection/previewParams.js, because UrlSync has
// to carry them through and SelectionProvider has to clear them.

const DEFAULT_MODE = 'markers'
const PLOT_MODES = ['markers', 'lines', 'markers+lines']
const DEFAULT_SCALES = { primary: 'Viridis', secondary: 'Reds' }

export default function usePreviewPlotParams (inspectDataset, table) {
  const [searchParams, setSearchParams] = useSearchParams()

  // One writer for all of them. A null/undefined/'' value deletes its param, so
  // "back to the default" and "never set" produce the same URL.
  //
  // Always replace: adjusting a dropdown is not a navigation, and a history entry
  // per twiddle would bury the entries that do mean something (opening the
  // dataset page, opening the record). This mirrors UrlSync's own reasoning.
  const setParams = useCallback(
    (changes) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous)
          Object.entries(changes).forEach(([param, value]) => {
            if (value === null || value === undefined || value === '') {
              next.delete(param)
            } else {
              next.set(param, value)
            }
          })
          return next
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )

  // The type's own defaults, and the fallback the four roles resolve against.
  const typeAxes = useMemo(
    () => defaultPlotAxesFor(inspectDataset, table),
    [inspectDataset, table]
  )
  const fallbackAxes = typeAxes || EMPTY_PLOT_AXES

  // Table or plot. Only the deviation is stored, so `vis` appears in the link
  // exactly when the user overrode what this dataset type opens on.
  const defaultVis = defaultVisFor(inspectDataset)
  const visParam = searchParams.get('vis')
  const selectedVis = visParam === 'table' || visParam === 'plot' ? visParam : defaultVis
  const setSelectedVis = useCallback(
    (vis) => setParams({ vis: vis === defaultVis ? null : vis }),
    [setParams, defaultVis]
  )

  // A role reads its column from the URL and its unit from the payload — the
  // unit is derivable, so it stays out of the link.
  const plotAxes = useMemo(
    () => axesFromParams(searchParams, fallbackAxes, table),
    [searchParams, fallbackAxes, table]
  )

  // Takes a whole axes object, the way the dropdowns already build one
  // ({ ...plotAxes, [role]: … }); axesToParams keeps only the roles that deviate,
  // so setting one back to its type default — or to None — drops its param.
  const setPlotAxes = useCallback(
    (nextAxes) => setParams(axesToParams(nextAxes, fallbackAxes)),
    [setParams, fallbackAxes]
  )

  const modeParam = searchParams.get('pmode')
  const plotType = PLOT_MODES.includes(modeParam) ? modeParam : DEFAULT_MODE
  const setPlotType = useCallback(
    (mode) => setParams({ pmode: mode === DEFAULT_MODE ? null : mode }),
    [setParams]
  )

  // pscale2's PRESENCE is what records "different scale per variable", so the
  // checkbox needs no param of its own: it is on exactly when a second scale is
  // named, and turning it on writes the scale even at its default value.
  const secondaryScaleParam = searchParams.get('pscale2')
  const dualColorscale = secondaryScaleParam !== null
  const colorscales = useMemo(
    () => ({
      primary: searchParams.get('pscale') || DEFAULT_SCALES.primary,
      secondary: secondaryScaleParam || DEFAULT_SCALES.secondary
    }),
    [searchParams, secondaryScaleParam]
  )

  const setColorscales = useCallback(
    (update) => {
      const next = typeof update === 'function' ? update(colorscales) : update
      setParams({
        pscale: next.primary === DEFAULT_SCALES.primary ? null : next.primary,
        pscale2: dualColorscale ? next.secondary : null
      })
    },
    [setParams, colorscales, dualColorscale]
  )

  const setDualColorscale = useCallback(
    (on) => setParams({ pscale2: on ? colorscales.secondary : null }),
    [setParams, colorscales]
  )

  return {
    selectedVis,
    setSelectedVis,
    plotAxes,
    setPlotAxes,
    plotType,
    setPlotType,
    colorscales,
    setColorscales,
    dualColorscale,
    setDualColorscale
  }
}
