// Shared by SelectionProvider, usePreviewPlotParams and UrlSync (which drops
// any param it does not list). Pure, so none of them import each other.

// Its presence opens the modal. Deliberately NOT `record`, which is the dataset
// page's highlight; sharing it would make every marker click open the modal.
export const RECORD_PARAM = "preview";

// `YYYY-MM-DD~YYYY-MM-DD` (inclusive UTC days), set when a trajectory pass is
// plotted. Absent means the record's most recent data.
export const PERIOD_PARAM = "pperiod";

// Which tab of the dataset page is open: `data` for the feature list. The
// default, the metadata tab, is not written.
export const TAB_PARAM = "tab";

// `1` when the dataset page is widened over the map; absent is the sidebar.
export const WIDE_PARAM = "wide";

export function parsePeriod(value) {
  const [start, end] = (value || "").split("~");
  return start && end ? { start, end } : undefined;
}

// Each is written ONLY when it differs from the dataset type's default.
//
//   vis      table | plot          (default: plot for every plottable
//                                  cdm_data_type, table for Grid/unknown)
//   pvars    the panel variables, comma-separated, one panel each
//                                  (default: the dataset's first EOV column)
//   paxis    the axis every panel shares
//                                  (default: depth / time / track, per type)
//   pmode    markers | lines | markers+lines
//   pcolors  per-variable colours, `column~rrggbb` comma-separated
//                                  (default: the variable's own ERDDAP palette)
export const PLOT_PARAMS = ["vis", "pvars", "paxis", "pmode", "pcolors"];

// Never read back; kept only so old links don't leave orphans in the address
// bar. `pcolor` (one shared colour dimension) is retired, not reused, so old
// links can't be misread as `pcolors`.
const RETIRED_PLOT_PARAMS = ["px", "py", "p2", "pscale2", "pcolor", "pscale"];

export const PREVIEW_PARAMS = [
  RECORD_PARAM,
  PERIOD_PARAM,
  ...PLOT_PARAMS,
  ...RETIRED_PLOT_PARAMS,
];

// All in ONE setSearchParams call: react-router hands a functional updater the
// params from the last render, so a second call would drop the first's work.
export function withoutPreviewParams(params) {
  const next = new URLSearchParams(params);
  PREVIEW_PARAMS.forEach((param) => next.delete(param));
  return next;
}
