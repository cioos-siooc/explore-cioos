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

// Basemap selection: 'emodnet' (bathymetry raster + vector labels, default)
// or 'arcgis-ocean' (Esri World Ocean Base). See components/Map/basemapStyle.js.
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

// OBIS occurrence coverage hexes. Amber, to stay legible against the green
// profile ramp, the purple trajectory ramp and the teal griddap outlines.
export const obisColorScale = [
  '#FBE3BE',
  '#F6CE92',
  '#EFB566',
  '#E39B3D',
  '#CE8025',
  '#B06718',
  '#8C4F0F'
]

// Hexes holding BOTH trajectory and OBIS cells. A plum/rose family reading as
// purple + amber, so a mixed hex is never mistaken for either pure ramp.
export const mixedColorScale = [
  '#F0D3DC',
  '#E3B4C4',
  '#D394AC',
  '#BE7594',
  '#A55B7D',
  '#894567',
  '#6B3350'
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
