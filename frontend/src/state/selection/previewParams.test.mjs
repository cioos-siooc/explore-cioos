import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PLOT_PARAMS,
  PREVIEW_PARAMS,
  RECORD_PARAM,
  withoutPreviewParams
} from './previewParams.js'

test('the preview owns the record param and the plot params', () => {
  assert.equal(RECORD_PARAM, 'record')
  assert.deepEqual(PLOT_PARAMS, ['vis', 'pvars', 'paxis', 'pcolor', 'pmode', 'pscale'])
  for (const param of [RECORD_PARAM, ...PLOT_PARAMS]) {
    assert.ok(PREVIEW_PARAMS.includes(param), param)
  }
})

test('params retired with the two-axis plot are still cleaned up', () => {
  // Written by the pre-faceting plot and never read again, but a link made then
  // must not leave orphans in the address bar once the modal closes.
  for (const param of ['px', 'py', 'p2', 'pscale2']) {
    assert.ok(PREVIEW_PARAMS.includes(param), param)
    assert.ok(!PLOT_PARAMS.includes(param), `${param} must not be written`)
  }
})

test('no preview param collides with one the map or the filters already use', () => {
  // UrlSync rebuilds the whole search string, so a collision would mean the two
  // owners silently overwrote each other.
  const taken = new Set([
    'eovs', 'platforms', 'datasetPKs', 'organizations', 'erddapServers',
    'timeMin', 'timeMax', 'depthMin', 'depthMax', 'includeObis',
    'scientificNames', 'obisNodes',
    'latMin', 'lonMin', 'latMax', 'lonMax', 'polygon',
    'lat', 'lon', 'zoom', 'tracks', 'scrubTime', 'trail', 'layers',
    'obs', 'bathy', 'griddap', 'globe',
    'lang', 'search', 'onlyInView', 'groupBy', 'hiddenGroups',
    'dataset', 'server'
  ])
  for (const param of PREVIEW_PARAMS) {
    assert.equal(taken.has(param), false, `${param} is already used elsewhere`)
  }
})

test('closing the preview strips all of its params and touches nothing else', () => {
  const params = new URLSearchParams(
    'lat=45&zoom=5&dataset=X&server=ogsl&record=R1&vis=table&paxis=depth' +
    '&pvars=TE90_01,PSAL_01&pcolor=depth&pmode=lines&pscale=Jet' +
    // A stale link from before faceting, carried into the same close.
    '&px=time&py=depth&p2=PSAL&pscale2=Reds&eovs=salinity'
  )
  const stripped = withoutPreviewParams(params)
  assert.equal(stripped.toString(), 'lat=45&zoom=5&dataset=X&server=ogsl&eovs=salinity')
  // Non-destructive: the caller's params are untouched.
  assert.equal(params.get('record'), 'R1')
})

test('stripping is safe when no preview is open', () => {
  assert.equal(withoutPreviewParams(new URLSearchParams('lat=45')).toString(), 'lat=45')
  assert.equal(withoutPreviewParams(new URLSearchParams('')).toString(), '')
})
