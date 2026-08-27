import { test } from 'node:test'
import assert from 'node:assert/strict'

import { variablesFrom } from './previewVariables.js'
import {
  facetPlanFor,
  sharedCandidatesFor,
  resolvePanels,
  defaultVisFor,
  COLUMNS,
  ROWS
} from './previewFacetPlan.js'
import { VIKING, VIKING_NO_META, VIKING_DATASET } from './previewVariables.test.mjs'

const planFor = (type, table = VIKING, data) =>
  facetPlanFor(
    { ...VIKING_DATASET, cdm_data_type: type },
    variablesFrom(table, { ...VIKING_DATASET, cdm_data_type: type }),
    data
  )

test('profile types face across, sharing a reversed depth axis', () => {
  for (const type of ['Profile', 'TimeSeriesProfile', 'TrajectoryProfile']) {
    const plan = planFor(type)
    assert.equal(plan.orientation, COLUMNS, type)
    assert.equal(plan.sharedAxis, 'depth', type)
    assert.equal(plan.sharedReversed, true, type)
  }
})

test('a timeseries stacks, sharing time, and is not reversed', () => {
  const plan = planFor('TimeSeries')
  assert.equal(plan.orientation, ROWS)
  assert.equal(plan.sharedAxis, 'time')
  assert.equal(plan.sharedReversed, false)
})

test('a trajectory shares whichever of lon/lat actually moves', () => {
  // Mostly north-south: latitude spans 5 degrees, longitude 0.01.
  const northSouth = [
    { latitude: 45, longitude: -60.00 },
    { latitude: 50, longitude: -60.01 }
  ]
  assert.equal(planFor('Trajectory', VIKING, northSouth).sharedAxis, 'latitude')

  const eastWest = [
    { latitude: 45.00, longitude: -70 },
    { latitude: 45.01, longitude: -50 }
  ]
  assert.equal(planFor('Trajectory', VIKING, eastWest).sharedAxis, 'longitude')
})

test('a trajectory with no rows yet still produces a plan', () => {
  // The payload is async; a plan that needed data would leave the first render
  // with nothing to draw and no axis names.
  const plan = planFor('Trajectory')
  assert.ok(plan)
  assert.ok(['longitude', 'latitude'].includes(plan.sharedAxis))
})

test('Point shares its first measurement, and that column is not also a panel', () => {
  const plan = planFor('Point')
  assert.equal(plan.orientation, ROWS)
  assert.equal(plan.sharedAxis, 'TE90_01')
  assert.ok(!plan.panelDefaults.includes('TE90_01'))
})

test('Grid and unknown types have no plan — the caller shows the table', () => {
  assert.equal(planFor('Grid'), null)
  assert.equal(planFor('Other'), null)
  assert.equal(planFor(''), null)
})

test('no variables means no plan', () => {
  assert.equal(facetPlanFor(VIKING_DATASET, [], undefined), null)
  assert.equal(facetPlanFor(VIKING_DATASET, undefined, undefined), null)
  assert.equal(facetPlanFor(undefined, variablesFrom(VIKING, VIKING_DATASET)), null)
})

test('the default panel is the dataset first_eov_column when it is plottable', () => {
  assert.deepEqual(planFor('TimeSeriesProfile').panelDefaults, ['TE90_01'])
})

test('an unplottable first_eov_column falls back to the first measurement', () => {
  const dataset = {
    ...VIKING_DATASET,
    cdm_data_type: 'TimeSeriesProfile',
    first_eov_column: 'station_id' // a cf_role id, never a panel
  }
  const plan = facetPlanFor(dataset, variablesFrom(VIKING, dataset))
  assert.deepEqual(plan.panelDefaults, ['TE90_01'])
})

test('a plan exists before any harvest has filled columnMeta', () => {
  const plan = planFor('TimeSeriesProfile', VIKING_NO_META)
  assert.equal(plan.sharedAxis, 'depth')
  assert.equal(plan.sharedReversed, true) // CF convention, no `positive` needed
  assert.deepEqual(plan.panelDefaults, ['TE90_01'])
})

test('shared candidates lead with coordinates then offer every measurement', () => {
  const candidates = sharedCandidatesFor(variablesFrom(VIKING, VIKING_DATASET))
    .map((v) => v.columnName)
  // Coordinates first, so the plausible answer is at the top of the dropdown...
  assert.deepEqual(candidates.slice(0, 6), [
    'time', 'obs_lat', 'obs_lon', 'latitude', 'longitude', 'depth'
  ])
  // ...but "salinity against temperature" stays reachable.
  assert.ok(candidates.includes('PSAL_01'))
  // Ids and flags are never offered.
  assert.ok(!candidates.includes('station_id'))
})

test('resolvePanels drops the shared axis, unknown columns and duplicates', () => {
  const variables = variablesFrom(VIKING, VIKING_DATASET)
  assert.deepEqual(
    resolvePanels(['TE90_01', 'depth', 'NOT_A_COLUMN', 'PSAL_01', 'TE90_01'],
      variables, 'depth'),
    ['TE90_01', 'PSAL_01']
  )
  assert.deepEqual(resolvePanels(undefined, variables, 'depth'), [])
})

test('every variable the dataset has can be a panel at once', () => {
  const variables = variablesFrom(VIKING, VIKING_DATASET)
  const all = ['TE90_01', 'CNDC_01', 'PRES_01', 'PSAL_01', 'FLOR_01', 'DOXY_01']
  assert.deepEqual(resolvePanels(all, variables, 'depth'), all)
})

test('vis default comes from the type alone, never the payload', () => {
  // Stability matters: /preview is async, so a default that read the columns
  // would answer "table" first and "plot" a moment later.
  for (const type of ['Profile', 'TimeSeries', 'TimeSeriesProfile',
    'Trajectory', 'TrajectoryProfile', 'Point']) {
    assert.equal(defaultVisFor({ cdm_data_type: type }), 'plot', type)
  }
  assert.equal(defaultVisFor({ cdm_data_type: 'Grid' }), 'table')
  assert.equal(defaultVisFor({ cdm_data_type: 'Other' }), 'table')
  assert.equal(defaultVisFor(undefined), 'table')
})
