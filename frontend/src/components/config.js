export const defaultEovsSelected = {
  carbon: false,
  currents: false,
  nutrients: false,
  salinity: false,
  temperature: false,
}
export const defaultOrgsSelected = {

}
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