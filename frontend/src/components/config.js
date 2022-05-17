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
    platformId: '43',
    platformColor: '#0000ff'
  },
  {
    platformId: '11',
    platformColor: '#ba55d3'
  },
  {
    platformId: '17',
    platformColor: '#f08080'
  },
  {
    platformId: '33',
    platformColor: '#2e8b57'
  },
  {
    platformId: '48',
    platformColor: '#e55e5e'
  },
  {
    platformId: '30',
    platformColor: '#52a79b'
  },
  {
    platformId: '14',
    platformColor: '#ff4500'
  },
  {
    platformId: '41',
    platformColor: '#ffa500'
  },
  {
    platformId: '',
    platformColor: '#7fff00'
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
