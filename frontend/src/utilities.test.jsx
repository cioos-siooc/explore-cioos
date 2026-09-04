import { describe, it, expect } from 'vitest'

import {
  abbreviateString,
  applyMapDatasetPKs,
  capitalizeFirstLetter,
  createDataFilterQueryString,
  createSelectionQueryString,
  escapeHtml,
  formatDatasetCount,
  getCurrentRangeLevel,
  polygonIsRectangle,
  polygonToWkt,
  quantizeCountRange,
  rangesEqual,
  rangeLevelHasData,
  selectionFromSearchParams,
  splitAtAntimeridian,
  splitTrackRuns,
  validateEmail
} from './utilities.jsx'
import { defaultQuery } from './components/config.js'

// The filter query object the app carries. defaultQuery holds only the fields
// createDataFilterQueryString compares against defaults; the *Selected arrays
// are always supplied by FilterProvider, so a bare object here is not a valid
// input and the helper below is what a real caller looks like.
function makeQuery (overrides = {}) {
  return {
    ...defaultQuery,
    orgsSelected: [],
    eovsSelected: [],
    platformsSelected: [],
    datasetsSelected: [],
    scientificNamesSelected: [],
    obisNodesSelected: [],
    erddapServersSelected: [],
    ...overrides
  }
}

const selected = (title, extra = {}) => ({ title, isSelected: true, ...extra })
const unselected = (title, extra = {}) => ({ title, isSelected: false, ...extra })

describe('createDataFilterQueryString', () => {
  it('emits nothing for an untouched query', () => {
    expect(createDataFilterQueryString(makeQuery())).toBe('')
  })

  it('emits only the fields that differ from their defaults', () => {
    const params = new URLSearchParams(
      createDataFilterQueryString(
        makeQuery({ startDate: '2020-01-01', endDepth: 500 })
      )
    )
    expect(params.get('timeMin')).toBe('2020-01-01')
    expect(params.get('depthMax')).toBe('500')
    // endDate and startDepth are untouched, so they stay out of the link.
    expect(params.has('timeMax')).toBe(false)
    expect(params.has('depthMin')).toBe(false)
  })

  it('lists selected eovs by title', () => {
    const query = makeQuery({
      eovsSelected: [selected('oxygen'), unselected('salinity'), selected('temperature')]
    })
    expect(new URLSearchParams(createDataFilterQueryString(query)).get('eovs')).toBe(
      'oxygen,temperature'
    )
  })

  it('omits a dimension whose options are all selected', () => {
    // "everything" and "no filter" are the same request, and the shorter link
    // is the one worth sharing.
    const query = makeQuery({
      platformsSelected: [selected('glider'), selected('mooring')],
      orgsSelected: [selected('DFO', { pk: 1 }), selected('MEDS', { pk: 2 })]
    })
    const params = new URLSearchParams(createDataFilterQueryString(query))
    expect(params.has('platforms')).toBe(false)
    expect(params.has('organizations')).toBe(false)
  })

  it('sends organizations and datasets as pks, not titles', () => {
    const query = makeQuery({
      orgsSelected: [selected('DFO', { pk: 7 }), unselected('MEDS', { pk: 8 })],
      datasetsSelected: [selected('a', { pk: 11 }), unselected('b', { pk: 12 })]
    })
    const params = new URLSearchParams(createDataFilterQueryString(query))
    expect(params.get('organizations')).toBe('7')
    expect(params.get('datasetPKs')).toBe('11')
  })

  describe('the combined data-source filter', () => {
    const servers = (...flags) =>
      flags.map((on, i) =>
        on
          ? selected(`s${i}`, { url: `https://erddap${i}.example` })
          : unselected(`s${i}`, { url: `https://erddap${i}.example` })
      )

    it('does not filter when every server and node is selected', () => {
      const params = new URLSearchParams(
        createDataFilterQueryString(
          makeQuery({
            erddapServersSelected: servers(true, true),
            obisNodesSelected: [selected('OBIS Canada')]
          })
        )
      )
      expect(params.has('erddapServers')).toBe(false)
      expect(params.has('obisNodes')).toBe(false)
      expect(params.has('includeObis')).toBe(false)
    })

    it('hides OBIS when only servers are picked', () => {
      const params = new URLSearchParams(
        createDataFilterQueryString(
          makeQuery({
            erddapServersSelected: servers(true, false),
            obisNodesSelected: [unselected('OBIS Canada')]
          })
        )
      )
      expect(params.get('includeObis')).toBe('false')
      expect(params.get('erddapServers')).toBe('https://erddap0.example')
    })

    it('names the nodes when any node is picked, so OBIS rows survive', () => {
      const params = new URLSearchParams(
        createDataFilterQueryString(
          makeQuery({
            erddapServersSelected: servers(true, false),
            obisNodesSelected: [selected('OBIS Canada'), unselected('OBIS USA')]
          })
        )
      )
      expect(params.get('obisNodes')).toBe('OBIS Canada')
      expect(params.get('erddapServers')).toBe('https://erddap0.example')
      expect(params.has('includeObis')).toBe(false)
    })
  })
})

describe('the drawn selection round-trips through the url', () => {
  // Closed rings, the way turf's bboxPolygon and mapbox-gl-draw produce them.
  const rectangle = [
    [-130, 48],
    [-120, 48],
    [-120, 55],
    [-130, 55],
    [-130, 48]
  ]
  const freeform = [
    [-130, 48],
    [-120, 50],
    [-125, 55],
    [-135, 52],
    [-130, 48]
  ]

  it('recognises a rectangle by its two distinct lats and lons', () => {
    expect(polygonIsRectangle(rectangle)).toBe(true)
    expect(polygonIsRectangle(freeform)).toBe(false)
  })

  it('serialises a rectangle as bounds and reads it back', () => {
    const queryString = createSelectionQueryString(rectangle)
    const params = new URLSearchParams(queryString)
    expect(params.get('latMin')).toBe('48.0000')
    expect(params.get('lonMax')).toBe('-120.0000')
    expect(params.has('polygon')).toBe(false)

    const restored = selectionFromSearchParams(params)
    expect(polygonIsRectangle(restored)).toBe(true)
    // Same corners, though not necessarily the same winding as the original.
    expect(new Set(restored.map(String))).toEqual(new Set(rectangle.map(String)))
  })

  it('serialises a free-form ring verbatim and reads it back', () => {
    const params = new URLSearchParams(createSelectionQueryString(freeform))
    expect(selectionFromSearchParams(params)).toEqual(freeform)
  })

  it('returns undefined when the link holds no selection', () => {
    expect(selectionFromSearchParams(new URLSearchParams('zoom=3'))).toBeUndefined()
  })

  it('ignores a partial bounding box rather than inventing corners', () => {
    expect(
      selectionFromSearchParams(new URLSearchParams('latMin=48&lonMin=-130'))
    ).toBeUndefined()
  })

  it('writes wkt from the ring as-is, without re-closing it', () => {
    expect(polygonToWkt(rectangle)).toBe(
      'POLYGON((-130 48, -120 48, -120 55, -130 55, -130 48))'
    )
  })
})

describe('applyMapDatasetPKs', () => {
  it('leaves the query alone while no group is hidden', () => {
    expect(applyMapDatasetPKs('eovs=oxygen', undefined)).toBe('eovs=oxygen')
  })

  it('narrows the query to the still-visible datasets', () => {
    const params = new URLSearchParams(applyMapDatasetPKs('eovs=oxygen', [3, 9]))
    expect(params.get('datasetPKs')).toBe('3,9')
    expect(params.get('eovs')).toBe('oxygen')
  })

  it('asks for nothing at all when every group is hidden', () => {
    // An empty datasetPKs would read as "no dataset filter" and draw the world.
    expect(new URLSearchParams(applyMapDatasetPKs('', [])).get('datasetPKs')).toBe('0')
  })
})

describe('string and count helpers', () => {
  it('abbreviates only past the limit', () => {
    expect(abbreviateString('short', 20)).toBe('short')
    expect(abbreviateString('a very long dataset title', 6)).toBe('a very...')
    expect(abbreviateString(undefined, 6)).toBeUndefined()
  })

  it('capitalises the first letter only', () => {
    expect(capitalizeFirstLetter('oxygen concentration')).toBe('Oxygen concentration')
  })

  it('neutralises markup in harvested text', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'
    )
    expect(escapeHtml(null)).toBe('')
  })

  it('validates emails', () => {
    expect(validateEmail('someone@dfo-mpo.gc.ca')).toBe(true)
    expect(validateEmail('someone@localhost')).toBe(false)
    expect(validateEmail('not an email')).toBe(false)
  })

  it('shows the filtered count against the total only when they differ', () => {
    expect(formatDatasetCount(12, 12)).toBe('12')
    expect(formatDatasetCount(3, 12)).toBe('3 / 12')
    // Before the total is known there is only one number to show.
    expect(formatDatasetCount(3, undefined)).toBe('3')
  })
})

describe('legend range helpers', () => {
  // /legend answers with one range per zoom tier, keyed rather than ordered.
  const rangeLevels = {
    zoom0: [1, 100],
    zoom1: [1, 500],
    zoom2: [1, 900]
  }

  it('picks the tier covering the current zoom', () => {
    expect(getCurrentRangeLevel(rangeLevels, 3)).toBe(rangeLevels.zoom0)
    expect(getCurrentRangeLevel(rangeLevels, 6)).toBe(rangeLevels.zoom1)
    expect(getCurrentRangeLevel(rangeLevels, 9)).toBe(rangeLevels.zoom2)
  })

  it('falls back to the widest tier before the map reports a camera', () => {
    // Returning undefined here would read to a caller as "no data", which is a
    // different thing from "zoom not known yet".
    expect(getCurrentRangeLevel(rangeLevels, undefined)).toBe(rangeLevels.zoom0)
  })

  it('treats a null-ended range as having no data', () => {
    // The API answers a query matching nothing with [null, null].
    expect(rangeLevelHasData([null, null])).toBe(false)
    expect(rangeLevelHasData([1, 10])).toBe(true)
    expect(rangeLevelHasData(undefined)).toBe(false)
  })

  it('compares ranges by value', () => {
    expect(rangesEqual([1, 10], [1, 10])).toBe(true)
    expect(rangesEqual([1, 10], [1, 11])).toBe(false)
    expect(rangesEqual(undefined, undefined)).toBe(true)
  })

  it('snaps a measured range onto rungs so a pan does not restyle the map', () => {
    // Two viewport maxima a drag apart land on the same rung, which is what
    // stops the ramp repainting and the legend renumbering for nothing.
    expect(quantizeCountRange([1, 1100])).toEqual(quantizeCountRange([1, 1200]))
    // Both ends snap, each away from the middle of the domain.
    expect(quantizeCountRange([4, 1100])).toEqual([3, 1500])
  })

  it('only ever widens, never clips a hex out of its own ramp', () => {
    const [lo, hi] = quantizeCountRange([37, 1100])
    expect(lo).toBeLessThanOrEqual(37)
    expect(hi).toBeGreaterThanOrEqual(1100)
  })

  it('lands a clean decade on itself rather than the rung above', () => {
    // The log10/pow round trip puts 100 on 99.99999999999999 often enough that
    // without slack this would snap up to 150.
    expect(quantizeCountRange([1, 100])[1]).toBe(100)
  })

  it('rejects a range that describes no data', () => {
    expect(quantizeCountRange([null, null])).toBeUndefined()
    expect(quantizeCountRange(undefined)).toBeUndefined()
  })
})

describe('track geometry', () => {
  it('splits a track that crosses the antimeridian', () => {
    // A single MapLibre LineString drawn across ±180 wraps the wrong way round
    // the globe, so the run has to be cut where it crosses.
    const runs = splitAtAntimeridian([
      [170, 50],
      [179, 51],
      [-179, 52],
      [-170, 53]
    ])
    expect(runs.length).toBeGreaterThan(1)
    expect(runs.flat().length).toBeGreaterThanOrEqual(4)
  })

  it('leaves a track that never crosses as one run', () => {
    const coords = [
      [-130, 48],
      [-128, 49],
      [-126, 50]
    ]
    expect(splitAtAntimeridian(coords)).toEqual([coords])
  })

  it('breaks a track into runs at time gaps', () => {
    const coords = [
      [-130, 48],
      [-129, 48],
      [-100, 60],
      [-99, 60]
    ]
    const day = 24 * 60 * 60 * 1000
    const t0 = Date.parse('2020-01-01T00:00:00Z')
    // Two clusters an implausible interval apart: one platform, two deployments.
    const times = [t0, t0 + 3600e3, t0 + 400 * day, t0 + 400 * day + 3600e3]
    const runs = splitTrackRuns(coords, times)
    expect(runs.length).toBeGreaterThan(1)
  })
})
