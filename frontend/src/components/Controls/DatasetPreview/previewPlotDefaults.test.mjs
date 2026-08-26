import test from 'node:test'
import assert from 'node:assert/strict'

import {
  EMPTY_PLOT_AXES,
  axesFromParams,
  axesToParams,
  defaultPlotAxesFor,
  defaultVisFor,
  unitFor
} from './previewPlotDefaults.js'

// Run with: node --test src/components/Controls/DatasetPreview/
// (this frontend has no test runner; these modules are pure so that they can
// still be asserted on.)

const table = {
  columnNames: ['time', 'depth', 'CPHLPR01', 'PSALST01'],
  columnUnits: ['UTC', 'm', 'mg/m^3', 'PSU']
}
const dataset = (type) => ({ cdm_data_type: type, first_eov_column: 'CPHLPR01' })

test('unitFor reads the parallel columnUnits array', () => {
  assert.equal(unitFor(table, 'CPHLPR01'), 'mg/m^3')
  assert.equal(unitFor(table, 'depth'), 'm')
  // Absent column, absent table, absent name: no unit, no throw.
  assert.equal(unitFor(table, 'nope'), undefined)
  assert.equal(unitFor(undefined, 'depth'), undefined)
  assert.equal(unitFor(table, undefined), undefined)
  assert.equal(unitFor({ columnNames: ['depth'] }, 'depth'), undefined)
})

test('profile types plot the variable against depth', () => {
  for (const type of ['Profile', 'TimeSeriesProfile']) {
    const axes = defaultPlotAxesFor(dataset(type), table)
    assert.deepEqual(axes.x, { columnName: 'CPHLPR01', unit: 'mg/m^3' })
    assert.deepEqual(axes.y, { columnName: 'depth', unit: 'm' })
    assert.equal(axes.secondary, null)
    assert.equal(axes.color, null)
  }
})

test('timeseries plots the variable against time', () => {
  const axes = defaultPlotAxesFor(dataset('TimeSeries'), table)
  assert.deepEqual(axes.x, { columnName: 'time', unit: 'UTC' })
  assert.deepEqual(axes.y, { columnName: 'CPHLPR01', unit: 'mg/m^3' })
})

test('types with no known layout return null rather than falling through', () => {
  // The switch this replaced ended in `default: break`, which left the PREVIOUS
  // record's axes in place. null is what lets the caller show the table instead.
  for (const type of ['Trajectory', 'TrajectoryProfile', 'Point', 'Grid', 'Other', undefined]) {
    assert.equal(defaultPlotAxesFor(dataset(type), table), null, `type ${type}`)
  }
})

test('a dataset with no first_eov_column has nothing to plot', () => {
  assert.equal(defaultPlotAxesFor({ cdm_data_type: 'Profile' }, table), null)
  assert.equal(defaultPlotAxesFor(undefined, table), null)
})

test('the default view is the plot exactly where the axes can be named', () => {
  assert.equal(defaultVisFor(dataset('Profile')), 'plot')
  assert.equal(defaultVisFor(dataset('TimeSeries')), 'plot')
  assert.equal(defaultVisFor(dataset('TimeSeriesProfile')), 'plot')
  assert.equal(defaultVisFor(dataset('Trajectory')), 'table')
  assert.equal(defaultVisFor(dataset('TrajectoryProfile')), 'table')
  assert.equal(defaultVisFor(dataset('Point')), 'table')
  assert.equal(defaultVisFor(undefined), 'table')
})

test('defaultVisFor does not need the payload, so it is stable from first render', () => {
  // It is read before /preview has returned; if it flipped once the table landed
  // the modal would bounce the user from the plot to the table mid-load.
  assert.equal(defaultVisFor(dataset('Profile')), defaultVisFor(dataset('Profile'), table))
})

test('an empty query string yields exactly the type defaults', () => {
  const fallback = defaultPlotAxesFor(dataset('Profile'), table)
  assert.deepEqual(axesFromParams(new URLSearchParams(''), fallback, table), fallback)
})

test('a param overrides its role and picks up the unit from the payload', () => {
  const fallback = defaultPlotAxesFor(dataset('Profile'), table)
  const axes = axesFromParams(new URLSearchParams('px=PSALST01&pcolor=time'), fallback, table)
  assert.deepEqual(axes.x, { columnName: 'PSALST01', unit: 'PSU' })
  assert.deepEqual(axes.y, fallback.y, 'untouched role keeps its default')
  assert.deepEqual(axes.color, { columnName: 'time', unit: 'UTC' })
})

test('only the roles that deviate produce params', () => {
  const fallback = defaultPlotAxesFor(dataset('Profile'), table)
  // Nothing changed: no params at all, so an untouched plot adds nothing to a link.
  assert.deepEqual(axesToParams(fallback, fallback), {
    px: null, py: null, p2: null, pcolor: null
  })
  // Re-picking the column that is already the default is still the default.
  assert.deepEqual(
    axesToParams({ ...fallback, x: { columnName: 'CPHLPR01', unit: 'mg/m^3' } }, fallback).px,
    null
  )
  // A genuine change, and a second variable added.
  assert.deepEqual(
    axesToParams(
      { ...fallback, x: { columnName: 'PSALST01' }, secondary: { columnName: 'time' } },
      fallback
    ),
    { px: 'PSALST01', py: null, p2: 'time', pcolor: null }
  )
})

test('clearing a role back to None drops its param', () => {
  const fallback = defaultPlotAxesFor(dataset('Profile'), table)
  const withColor = { ...fallback, color: { columnName: 'PSALST01' } }
  assert.equal(axesToParams(withColor, fallback).pcolor, 'PSALST01')
  assert.equal(axesToParams({ ...withColor, color: null }, fallback).pcolor, null)
})

test('round trip: encode then decode reproduces the axes', () => {
  const fallback = defaultPlotAxesFor(dataset('TimeSeries'), table)
  const chosen = {
    x: { columnName: 'time', unit: 'UTC' },
    y: { columnName: 'PSALST01', unit: 'PSU' },
    secondary: { columnName: 'CPHLPR01', unit: 'mg/m^3' },
    color: { columnName: 'depth', unit: 'm' }
  }
  const params = new URLSearchParams()
  Object.entries(axesToParams(chosen, fallback)).forEach(([param, value]) => {
    if (value !== null) params.set(param, value)
  })
  assert.equal(params.toString(), 'py=PSALST01&p2=CPHLPR01&pcolor=depth')
  assert.deepEqual(axesFromParams(params, fallback, table), chosen)
})

test('a type with no defaults starts from nothing and records every pick', () => {
  const fallback = EMPTY_PLOT_AXES
  assert.deepEqual(axesFromParams(new URLSearchParams(''), fallback, table), fallback)
  assert.deepEqual(
    axesToParams({ ...fallback, x: { columnName: 'time' }, y: { columnName: 'PSALST01' } }, fallback),
    { px: 'time', py: 'PSALST01', p2: null, pcolor: null }
  )
})
