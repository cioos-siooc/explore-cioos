export const defaultEovsSelected = []
export const defaultPlatformsSelected = []
export const defaultOrgsSelected = []
export const defaultDatatsetsSelected = []
export const defaultErddapServersSelected = []
export const defaultStartDate = '1900-01-01'
export const defaultEndDate = new Date().toISOString().split('T')[0]
export const defaultStartDepth = 0
export const defaultEndDepth = 12000

export const defaultScientificNamesSelected = []
export const defaultObisNodesSelected = []

export const defaultQuery = {
  startDate: defaultStartDate,
  endDate: defaultEndDate,
  startDepth: defaultStartDepth,
  endDepth: defaultEndDepth,
  scientificNamesSelected: defaultScientificNamesSelected,
  obisNodesSelected: defaultObisNodesSelected
}

// Basemap selection: 'emodnet' (bathymetry raster + vector labels, default),
// 'gebco' (GEBCO WMS bathymetry fallback), or 'osm' (plain OSM raster,
// last-resort fallback). See components/Map/basemapStyle.js.
export const basemap = 'emodnet'

export const colorScale = [
  '#52A79B',
  '#4A968C',
  '#3D7B73',
  '#2F6059',
  '#224440',
  '#1B3733',
  '#142926'
]

export const trajectoryColorScale = [
  '#D5C9EE',
  '#C4B3E6',
  '#B29CDD',
  '#9F86D3',
  '#8C71C7',
  '#7A5DBA',
  '#6749AC'
]

export const languages = [
  {
    code: 'en',
    name: 'English'
  },
  {
    code: 'fr',
    name: 'Français'
  }
]
