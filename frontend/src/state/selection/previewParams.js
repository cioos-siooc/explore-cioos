// Shared by SelectionProvider, usePreviewPlotParams and UrlSync (which drops
// any param it does not list). Pure, so none of them import each other.

// Its presence opens the modal. Deliberately NOT `record`, which is the dataset
// page's highlight; sharing it would make every marker click open the modal.
export const RECORD_PARAM = "preview";

// Which profile inside that record. Read by SelectionProvider as well as by
// usePreviewPlotParams, because it changes what is FETCHED rather than how it
// is drawn — see the /preview `at` parameter.
export const STEP_PARAM = "pstep";

// Read by SelectionProvider too: the colour plot fetches every profile in the
// window instead of the stepped one — see the /preview `allProfiles` parameter.
export const LAYOUT_PARAM = "playout";
export const COLOR_LAYOUT = "color";

// `YYYY-MM-DD~YYYY-MM-DD` (inclusive UTC days), set when a trajectory pass is
// plotted. Absent means the record's most recent data.
export const PERIOD_PARAM = "pperiod";

// Which tab of the dataset page is open: `data` for the feature list. The
// default, the metadata tab, is not written.
export const TAB_PARAM = "tab";

// `1` when the sidebar card (the list or a dataset page) is widened over the
// map; absent is the sidebar.
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
//   pz       the column whose values shade EVERY panel — the third dimension
//                                  (default: none; colour then says which
//                                  variable a panel draws, not what a third
//                                  one was doing)
//   pzscale  the colourscale that column is drawn in
//                                  (default: its own colorBarPalette, else
//                                  Viridis — and never a rainbow)
//   playout  color                 (default: one panel per variable against a
//                                  shared axis; `color` draws the same X and Y
//                                  in every panel, one panel per `pvars`
//                                  variable, each shaded by that variable)
//   pcx      the colour plot's X   (default: time / track, per type)
//   pcy      the colour plot's Y   (default: depth, else a measurement)
//   pzscales the colour plot's scale per variable, `column~Scale` comma-
//            separated             (default: as for pzscale)
//   pyflip   the columns whose Y axis is drawn opposite to its default,
//            comma-separated       (default: none; a depth or pressure on Y
//                                  is drawn downwards)
//   pstep    which profile INSIDE the record is drawn, by the value of the
//            dataset's cf_role=profile_id column
//                                  (default: none, meaning the window
//                                  /preview returns on its own — every profile
//                                  in the tail of the record at once)
export const PLOT_PARAMS = [
  "vis",
  "pvars",
  "paxis",
  "pmode",
  "pcolors",
  "pz",
  "pzscale",
  LAYOUT_PARAM,
  "pcx",
  "pcy",
  "pzscales",
  "pyflip",
  STEP_PARAM,
];

// Never read back; kept only so old links don't leave orphans in the address
// bar. `pcolor` (one shared colour dimension) is retired, not reused, so old
// links can't be misread as `pcolors`; the colour dimension came back as `pz`.
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
