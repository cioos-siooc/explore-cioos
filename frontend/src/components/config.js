export const defaultEovsSelected = []
export const defaultPlatformsSelected = []
export const defaultOrgsSelected = []
export const defaultDatatsetsSelected = []
export const defaultStartDate = '1900-01-01'
export const defaultEndDate = new Date().toISOString().split('T')[0]
export const defaultStartDepth = 0
export const defaultEndDepth = 12000

export const defaultQuery = {
  startDate: defaultStartDate,
  endDate: defaultEndDate,
  startDepth: defaultStartDepth,
  endDepth: defaultEndDepth,
};

export const colorScale = ["#52A79B", "#4A968C", "#3D7B73", "#2F6059", "#224440", "#1B3733", "#142926"]
export const platformColors = [
  {
    platform: 'coastal structure',
    platformColor: '#f08080'
  },
  {
    platform: 'fixed benthic node',
    platformColor: '#ba55d3'
  },
  {
    platform: 'land/onshore structure',
    platformColor: '#ff4500'
  },
  {
    platform: 'moored surface buoy',
    platformColor: '#ffa500'
  },
  {
    platform: 'mooring',
    platformColor: '#e55e5e'
  },
  {
    platform: 'self-propelled small boat',
    platformColor: '#2e8b57'
  },
  {
    platform: 'ship',
    platformColor: '#52a79b'
  },
  {
    platform: 'subsurface mooring',
    platformColor: '#0000ff'
  },
  {
    platform: 'unknown',
    platformColor: '#000000'
  }
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
