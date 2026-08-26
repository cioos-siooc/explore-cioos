// The query-string vocabulary of the record preview, in one place because three
// modules need to agree on it: SelectionProvider owns `record`,
// usePreviewPlotParams owns the plot params, and UrlSync has to carry every one
// of them through (it rebuilds the whole search string from scratch on each map
// pan and drops anything it does not list).
//
// Pure on purpose — no React, no router — so it can be imported from a provider,
// a component and the sync without pulling any of them into each other.

// Which record of the dataset is open. Its presence is what opens the modal.
export const RECORD_PARAM = 'record'

// How that record is being drawn. Each of these is written ONLY when it differs
// from the default the dataset type implies, so an untouched plot adds nothing
// to the link — the same rule the map's layer switches follow.
//
//   vis      table | plot          (default: plot where axes can be named)
//   px, py   the two axis columns  (default: per cdm_data_type)
//   p2       optional 2nd variable (default: none)
//   pcolor   optional color-by     (default: none)
//   pmode    markers | lines | markers+lines
//   pscale   colorscale name
//   pscale2  2nd colorscale — its PRESENCE is what records "different scale per
//            variable", so that checkbox needs no param of its own
export const PLOT_PARAMS = [
  'vis',
  'px',
  'py',
  'p2',
  'pcolor',
  'pmode',
  'pscale',
  'pscale2'
]

export const PREVIEW_PARAMS = [RECORD_PARAM, ...PLOT_PARAMS]

// Closing the preview has to delete all of these in ONE setSearchParams call:
// react-router hands a functional updater the params from the last RENDER, not
// the ones the previous call just wrote, so two calls in one handler would leave
// only the second one's work behind.
export function withoutPreviewParams (params) {
  const next = new URLSearchParams(params)
  PREVIEW_PARAMS.forEach((param) => next.delete(param))
  return next
}
