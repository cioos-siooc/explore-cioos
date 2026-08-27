import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  variablesFrom,
  idVariablesFor,
  labelFor,
  shortLabelFor,
  measurementsOf,
  byColumnName,
  isDownwardVertical
} from './previewVariables.js'

// The real payload shape of /api/preview?dataset=mpoPmzaVikingCtdInsitu — a
// TimeSeriesProfile with 14 columns: 4 coordinates + 2 lat/lon observation
// columns, 2 cf_role ids, and 6 measurements. This is the dataset the faceting
// was reported against.
const VIKING = {
  columnNames: [
    'station_id', 'time', 'obs_lat', 'obs_lon', 'latitude', 'longitude',
    'profile', 'depth', 'TE90_01', 'CNDC_01', 'PRES_01', 'PSAL_01',
    'FLOR_01', 'DOXY_01'
  ],
  columnTypes: [
    'String', 'String', 'float', 'float', 'float', 'float',
    'String', 'float', 'float', 'float', 'float', 'float', 'float', 'float'
  ],
  columnUnits: [
    null, 'UTC', 'Degrees north', 'Degrees east', 'degrees_north',
    'degrees_east', null, 'm', 'degree_C', 'S m-1', 'decibar', 'PSU',
    'mg/m^3', 'micromol/L'
  ],
  columnMeta: [
    { name: 'station_id', type: 'String', cf_role: 'timeseries_id', long_name: 'Station Id' },
    { name: 'time', type: 'double', axis: 'T', standard_name: 'time', long_name: 'Time' },
    { name: 'obs_lat', type: 'float', long_name: 'Observation latitude', standard_name: 'obs_lat' },
    { name: 'obs_lon', type: 'float', long_name: 'Observation longitude', standard_name: 'obs_lon' },
    { name: 'latitude', type: 'float', axis: 'Y', standard_name: 'latitude', long_name: 'Station latitude' },
    { name: 'longitude', type: 'float', axis: 'X', standard_name: 'longitude', long_name: 'Station longitude' },
    { name: 'profile', type: 'String', cf_role: 'profile_id', long_name: 'Profile' },
    {
      name: 'depth', type: 'float', axis: 'Z', positive: 'down', standard_name: 'depth',
      long_name: 'depth of observation', colorBarPalette: 'TopographyDepth',
      colorBarMinimum: '0.0', colorBarMaximum: '8000.0'
    },
    {
      name: 'TE90_01', type: 'float', long_name: 'Temperature (1990 scale)',
      standard_name: 'sea_water_temperature',
      colorBarMinimum: '-10.0', colorBarMaximum: '40.0',
      // The sentinel that makes actual_range unusable as an axis range.
      actual_range: '-1.4899, 191277.0'
    },
    { name: 'CNDC_01', type: 'float', long_name: 'Sea Water Electrical Conductivity' },
    { name: 'PRES_01', type: 'float', long_name: 'Pressure', standard_name: 'sea_water_pressure' },
    { name: 'PSAL_01', type: 'float', long_name: 'Practical Salinity' },
    { name: 'FLOR_01', type: 'float', long_name: 'Fluorescence' },
    { name: 'DOXY_01', type: 'float', long_name: 'Disolved oxygen' }
  ]
}

const VIKING_DATASET = {
  cdm_data_type: 'TimeSeriesProfile',
  first_eov_column: 'TE90_01',
  timeseries_id_variable: 'station_id',
  profile_id_variable: 'profile'
}

// Same dataset as a catalogue that has not been reharvested since
// datasets.table_variables was added: no columnMeta key at all.
const VIKING_NO_META = {
  columnNames: VIKING.columnNames,
  columnTypes: VIKING.columnTypes,
  columnUnits: VIKING.columnUnits
}

test('empty or missing table yields no variables', () => {
  assert.deepEqual(variablesFrom(undefined), [])
  assert.deepEqual(variablesFrom({}), [])
})

test('one variable per column, in ERDDAP order', () => {
  const variables = variablesFrom(VIKING, VIKING_DATASET)
  assert.equal(variables.length, 14)
  assert.deepEqual(variables.map((v) => v.columnName), VIKING.columnNames)
})

test('the six Viking measurements are the panel candidates', () => {
  const measurements = measurementsOf(variablesFrom(VIKING, VIKING_DATASET))
  assert.deepEqual(measurements.map((v) => v.columnName), [
    'TE90_01', 'CNDC_01', 'PRES_01', 'PSAL_01', 'FLOR_01', 'DOXY_01'
  ])
})

test('coordinates are classified as coordinates, by axis or by unit', () => {
  const index = byColumnName(variablesFrom(VIKING, VIKING_DATASET))
  for (const name of ['time', 'latitude', 'longitude', 'depth', 'obs_lat', 'obs_lon']) {
    assert.equal(index.get(name).kind, 'coordinate', name)
  }
})

test('cf_role columns are ids, not panels', () => {
  const index = byColumnName(variablesFrom(VIKING, VIKING_DATASET))
  assert.equal(index.get('station_id').kind, 'id')
  assert.equal(index.get('profile').kind, 'id')
})

test('the dataset id columns are excluded even with no columnMeta', () => {
  // This is the only path to id detection before a reharvest: shapeQuery.js has
  // been sending these three names all along.
  const index = byColumnName(variablesFrom(VIKING_NO_META, VIKING_DATASET))
  assert.equal(index.get('station_id').kind, 'id')
  assert.equal(index.get('profile').kind, 'id')
})

test('PRES_01 stays a measurement — pressure is not the depth axis here', () => {
  const index = byColumnName(variablesFrom(VIKING, VIKING_DATASET))
  assert.equal(index.get('PRES_01').kind, 'measurement')
})

test('without columnMeta the same six measurements are still found', () => {
  const measurements = measurementsOf(variablesFrom(VIKING_NO_META, VIKING_DATASET))
  assert.deepEqual(measurements.map((v) => v.columnName), [
    'TE90_01', 'CNDC_01', 'PRES_01', 'PSAL_01', 'FLOR_01', 'DOXY_01'
  ])
})

test('String columns are never numeric, so never panels', () => {
  const index = byColumnName(variablesFrom(VIKING, VIKING_DATASET))
  assert.equal(index.get('station_id').isNumeric, false)
  assert.equal(index.get('profile').isNumeric, false)
  assert.equal(index.get('TE90_01').isNumeric, true)
})

test('a QC column is dropped via ancillary_variables, whatever it is called', () => {
  const table = {
    columnNames: ['time', 'chlorophyll', 'weird_name'],
    columnTypes: ['String', 'float', 'byte'],
    columnUnits: ['UTC', 'mg/m^3', null],
    columnMeta: [
      { name: 'time', axis: 'T' },
      { name: 'chlorophyll', ancillary_variables: 'weird_name' },
      { name: 'weird_name' }
    ]
  }
  const index = byColumnName(variablesFrom(table, {}))
  assert.equal(index.get('weird_name').kind, 'flag')
  assert.deepEqual(measurementsOf(variablesFrom(table, {})).map((v) => v.columnName),
    ['chlorophyll'])
})

test('a _qc suffix is dropped when no metadata declares the link', () => {
  const table = {
    columnNames: ['temperature', 'temperature_qc', 'salinity_flag'],
    columnTypes: ['float', 'byte', 'byte'],
    columnUnits: ['degree_C', null, null]
  }
  assert.deepEqual(measurementsOf(variablesFrom(table, {})).map((v) => v.columnName),
    ['temperature'])
})

test('ioos_category Identifier / Time / Location are honoured', () => {
  // Authoritative where declared (~48% of variables) and it needs no naming
  // convention to work.
  const table = {
    columnNames: ['record_id', 'year', 'site', 'temperature'],
    columnTypes: ['int', 'uint', 'float', 'float'],
    columnUnits: ['unitless', 'unitless', 'unitless', 'degree_C'],
    columnMeta: [
      { name: 'record_id', ioos_category: 'Identifier' },
      { name: 'year', ioos_category: 'Time' },
      { name: 'site', ioos_category: 'Location' },
      { name: 'temperature', ioos_category: 'Temperature' }
    ]
  }
  const index = byColumnName(variablesFrom(table, {}))
  assert.equal(index.get('record_id').kind, 'id')
  assert.equal(index.get('year').kind, 'coordinate')
  assert.equal(index.get('site').kind, 'coordinate')
  assert.equal(index.get('temperature').kind, 'measurement')
})

test('an ERDDAP time-format unit marks a coordinate', () => {
  // mpoEaeTemperature publishes `year` as units "CCYY-MM-DD"; as a plain number
  // it cluttered the variable picker.
  const table = {
    columnNames: ['year', 'temperature'],
    columnTypes: ['uint', 'float'],
    columnUnits: ['CCYY-MM-DD', 'degree_C']
  }
  const index = byColumnName(variablesFrom(table, {}))
  assert.equal(index.get('year').kind, 'coordinate')
  assert.equal(index.get('temperature').kind, 'measurement')
})

test('an ID-suffixed column is an id even when nothing declares it', () => {
  // minilogID is an instrument serial number whose ioos_category is only
  // "Other" — the name is the only signal there is.
  const table = {
    columnNames: ['minilogID', 'sensor_id', 'temperature', 'fluid', 'humid'],
    columnTypes: ['int', 'int', 'float', 'float', 'float'],
    columnUnits: [null, null, 'degree_C', null, null]
  }
  const index = byColumnName(variablesFrom(table, {}))
  assert.equal(index.get('minilogID').kind, 'id')
  assert.equal(index.get('sensor_id').kind, 'id')
  // The rule must not catch a variable that merely ends in the letters i-d.
  assert.equal(index.get('fluid').kind, 'measurement')
  assert.equal(index.get('humid').kind, 'measurement')
  assert.equal(index.get('temperature').kind, 'measurement')
})

test('label prefers long_name, then standard_name, then the column name', () => {
  const index = byColumnName(variablesFrom(VIKING, VIKING_DATASET))
  assert.equal(labelFor(index.get('TE90_01')), 'Temperature (1990 scale) ( degree_C )')

  const noMeta = byColumnName(variablesFrom(VIKING_NO_META, VIKING_DATASET))
  assert.equal(labelFor(noMeta.get('TE90_01')), 'TE90_01 ( degree_C )')

  assert.equal(
    labelFor({ columnName: 'x', standardName: 'sea_water_temperature', unit: 'degree_C' }),
    'sea_water_temperature ( degree_C )'
  )
  assert.equal(labelFor({ columnName: 'x' }), 'x')
  assert.equal(labelFor(null), '')
})

test('short label drops the unit', () => {
  const index = byColumnName(variablesFrom(VIKING, VIKING_DATASET))
  assert.equal(shortLabelFor(index.get('TE90_01')), 'Temperature (1990 scale)')
})

test('columnUnits wins over the harvest, which may predate a units change', () => {
  const table = {
    columnNames: ['temperature'],
    columnTypes: ['float'],
    columnUnits: ['degree_C'],
    columnMeta: [{ name: 'temperature', units: 'K', long_name: 'Temp' }]
  }
  assert.equal(labelFor(variablesFrom(table, {})[0]), 'Temp ( degree_C )')
})

test('colorBar min/max are parsed as numbers, absent ones stay undefined', () => {
  const index = byColumnName(variablesFrom(VIKING, VIKING_DATASET))
  assert.equal(index.get('TE90_01').cmin, -10)
  assert.equal(index.get('TE90_01').cmax, 40)
  assert.equal(index.get('CNDC_01').cmin, undefined)
})

test('a null columnMeta entry does not throw', () => {
  const table = {
    columnNames: ['a', 'b'],
    columnTypes: ['float', 'float'],
    columnUnits: [null, null],
    columnMeta: [null, { name: 'b', long_name: 'Bee' }]
  }
  const variables = variablesFrom(table, {})
  assert.equal(variables[0].longName, null)
  assert.equal(variables[1].longName, 'Bee')
})

test('depth is downward by declaration, and by CF convention without it', () => {
  const index = byColumnName(variablesFrom(VIKING, VIKING_DATASET))
  assert.equal(isDownwardVertical(index.get('depth')), true)

  const noMeta = byColumnName(variablesFrom(VIKING_NO_META, VIKING_DATASET))
  assert.equal(isDownwardVertical(noMeta.get('depth')), true)

  assert.equal(isDownwardVertical({ columnName: 'altitude', positive: 'up' }), false)
  assert.equal(isDownwardVertical({ columnName: 'time' }), false)
  assert.equal(isDownwardVertical(null), false)
})

test('a cf_role is read from the harvest, or inferred from the dataset', () => {
  const index = byColumnName(variablesFrom(VIKING, VIKING_DATASET))
  assert.equal(index.get('station_id').cfRole, 'timeseries_id')
  assert.equal(index.get('profile').cfRole, 'profile_id')
  assert.equal(index.get('TE90_01').cfRole, null)

  // No columnMeta at all — the state of every dataset until a harvest with
  // incremental: false runs — so the roles come from the three fields
  // shapeQuery.js has been sending all along.
  const noMeta = byColumnName(variablesFrom(VIKING_NO_META, VIKING_DATASET))
  assert.equal(noMeta.get('station_id').cfRole, 'timeseries_id')
  assert.equal(noMeta.get('profile').cfRole, 'profile_id')

  // And with neither, nothing is invented.
  const neither = byColumnName(variablesFrom(VIKING_NO_META, {}))
  assert.equal(neither.get('station_id').cfRole, null)
})

test('the harvest wins where the two disagree', () => {
  // The dataset fields are one inference away from what ERDDAP publishes per
  // variable, so they only fill a gap.
  const index = byColumnName(
    variablesFrom(VIKING, { ...VIKING_DATASET, trajectory_id_variable: 'station_id' })
  )
  assert.equal(index.get('station_id').cfRole, 'timeseries_id')
})

test('the id columns come back in ERDDAP order — that is title order', () => {
  const variables = variablesFrom(VIKING, VIKING_DATASET)
  assert.deepEqual(
    idVariablesFor(variables).map((variable) => variable.columnName),
    ['station_id', 'profile']
  )
  // An id by name or by ioos_category is not a cf_role and does not name the
  // record: mpoEaeTemperature's minilogID is an instrument serial.
  const table = {
    columnNames: ['minilogID', 'TE90'],
    columnTypes: ['String', 'float'],
    columnUnits: [null, 'degree_C']
  }
  assert.deepEqual(idVariablesFor(variablesFrom(table, {})), [])
  assert.deepEqual(idVariablesFor(undefined), [])
})

export { VIKING, VIKING_NO_META, VIKING_DATASET }
