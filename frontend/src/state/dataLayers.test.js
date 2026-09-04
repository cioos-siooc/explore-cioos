import { describe, it, expect } from 'vitest'

import {
  ALL_DATA_LAYERS,
  DATA_LAYER_KEYS,
  DEFAULT_DATA_LAYERS,
  anyTrajectoryLayerOn,
  commitDataLayers,
  dataLayerKeyForDataset,
  dataLayersAreDefault,
  datasetInDataLayers,
  isDataLayerChecked,
  onlyDataLayer,
  selectedDataLayerKeys
} from './dataLayers.js'

describe('the unfiltered state is everything-on', () => {
  it('defaults to every geometry', () => {
    expect(DEFAULT_DATA_LAYERS).toEqual(ALL_DATA_LAYERS)
    expect(dataLayersAreDefault(ALL_DATA_LAYERS)).toBe(true)
  })

  it('draws no ticks while everything is on', () => {
    // A fully drawn map isn't a filter: no ticks, no badge, no chip.
    expect(isDataLayerChecked(ALL_DATA_LAYERS, 'profile')).toBe(false)
    expect(selectedDataLayerKeys(ALL_DATA_LAYERS)).toEqual([])
  })

  it('ticks exactly what a narrowed selection kept, in render order', () => {
    const narrowed = onlyDataLayer('obis')
    expect(isDataLayerChecked(narrowed, 'obis')).toBe(true)
    expect(isDataLayerChecked(narrowed, 'profile')).toBe(false)
    expect(selectedDataLayerKeys(narrowed)).toEqual(['obis'])
  })

  it('treats an absent selection as everything-on', () => {
    // MapStateProvider hands undefined through before ?layers= is resolved.
    expect(dataLayersAreDefault(undefined)).toBe(true)
    expect(anyTrajectoryLayerOn(undefined)).toBe(true)
  })
})

describe('commitDataLayers', () => {
  it('keeps a real selection', () => {
    const next = onlyDataLayer('grid')
    expect(commitDataLayers(next)).toBe(next)
  })

  it('folds "nothing left" back to everything', () => {
    // Unticking the last box has to land on the unfiltered map, not a blank one
    // no control could recover from.
    const empty = Object.fromEntries(DATA_LAYER_KEYS.map((k) => [k, false]))
    expect(commitDataLayers(empty)).toEqual(ALL_DATA_LAYERS)
  })
})

describe('anyTrajectoryLayerOn', () => {
  it('is true while either path-sampling geometry is on', () => {
    expect(anyTrajectoryLayerOn(onlyDataLayer('trajectories'))).toBe(true)
    expect(anyTrajectoryLayerOn(onlyDataLayer('trajectoryProfile'))).toBe(true)
  })

  it('is false once neither is', () => {
    // The track lines, coverage hexes, scrub bar and trajectory legend all
    // belong to the pair, so this gates all four.
    expect(anyTrajectoryLayerOn(onlyDataLayer('profile'))).toBe(false)
  })
})

describe('mapping a dataset row onto a switch', () => {
  it('matches OBIS on source before cdm_data_type', () => {
    // OBIS rows carry cdm_data_type 'Point', which an ERDDAP dataset can be too.
    expect(
      dataLayerKeyForDataset({ source_type: 'obis', cdm_data_type: 'Point' })
    ).toBe('obis')
  })

  it('maps the profile and trajectory cdm_data_types', () => {
    expect(dataLayerKeyForDataset({ cdm_data_type: 'Profile' })).toBe('profile')
    expect(dataLayerKeyForDataset({ cdm_data_type: 'TimeSeries' })).toBe('timeseries')
    expect(dataLayerKeyForDataset({ cdm_data_type: 'TimeSeriesProfile' })).toBe(
      'timeseriesProfile'
    )
    expect(dataLayerKeyForDataset({ cdm_data_type: 'Trajectory' })).toBe('trajectories')
    expect(dataLayerKeyForDataset({ cdm_data_type: 'TrajectoryProfile' })).toBe(
      'trajectoryProfile'
    )
    expect(dataLayerKeyForDataset({ cdm_data_type: 'Grid' })).toBe('grid')
  })

  it('governs nothing for an unrecognised geometry', () => {
    expect(dataLayerKeyForDataset({ cdm_data_type: 'Point' })).toBeUndefined()
  })

  it('admits a dataset no switch governs, whatever the selection', () => {
    // Otherwise narrowing to one geometry would silently drop rows the filter
    // has no opinion about.
    const row = { cdm_data_type: 'Point' }
    expect(datasetInDataLayers(row, onlyDataLayer('grid'))).toBe(true)
  })

  it('admits only the datasets whose switch is on', () => {
    const grid = { cdm_data_type: 'Grid' }
    const profile = { cdm_data_type: 'Profile' }
    const selection = onlyDataLayer('grid')
    expect(datasetInDataLayers(grid, selection)).toBe(true)
    expect(datasetInDataLayers(profile, selection)).toBe(false)
  })
})
