import test from "node:test";
import assert from "node:assert/strict";

import {
  PLOT_PARAMS,
  PREVIEW_PARAMS,
  RECORD_PARAM,
  withoutPreviewParams,
} from "./previewParams.js";

test("the preview owns the record param and the plot params", () => {
  assert.equal(RECORD_PARAM, "preview");
  assert.deepEqual(PLOT_PARAMS, ["vis", "pvars", "paxis", "pmode", "pcolors"]);
  for (const param of [RECORD_PARAM, ...PLOT_PARAMS]) {
    assert.ok(PREVIEW_PARAMS.includes(param), param);
  }
});

test("retired params are still cleaned up, and never written again", () => {
  // Written by earlier versions of the plot and never read again, but a link
  // made then must not leave orphans in the address bar once the modal closes.
  //
  //   px/py/p2/pscale2  two axis roles plus an overlaid second variable
  //   pcolor/pscale     the colour dimension, replaced by per-variable colours
  for (const param of ["px", "py", "p2", "pscale2", "pcolor", "pscale"]) {
    assert.ok(PREVIEW_PARAMS.includes(param), param);
    assert.ok(!PLOT_PARAMS.includes(param), `${param} must not be written`);
  }
  // pcolors is the live one, and one letter from a retired one: they are
  // different things and must not be confused for each other.
  assert.ok(PLOT_PARAMS.includes("pcolors"));
  assert.ok(!PLOT_PARAMS.includes("pcolor"));
});

test("no preview param collides with one the map or the filters already use", () => {
  // UrlSync rebuilds the whole search string, so a collision would mean the two
  // owners silently overwrote each other.
  const taken = new Set([
    "eovs",
    "platforms",
    "datasetPKs",
    "organizations",
    "erddapServers",
    "timeMin",
    "timeMax",
    "depthMin",
    "depthMax",
    "includeObis",
    "scientificNames",
    "obisNodes",
    "latMin",
    "lonMin",
    "latMax",
    "lonMax",
    "polygon",
    "lat",
    "lon",
    "zoom",
    "tracks",
    "scrubTime",
    "trail",
    "layers",
    "obs",
    "bathy",
    "griddap",
    "globe",
    "lang",
    "search",
    "onlyInView",
    "groupBy",
    "hiddenGroups",
    "dataset",
    "server",
    // The dataset page's own params, added alongside the preview and the
    // reason it is `preview` and not `record`: the first two are the
    // highlight (a pinned row, a drawn platform), then the griddap slice
    // wmsSliceParams writes, then where the "what's here" card was opened.
    "record",
    "track",
    "var",
    "date",
    "z",
    "at",
  ]);
  for (const param of PREVIEW_PARAMS) {
    assert.equal(taken.has(param), false, `${param} is already used elsewhere`);
  }
});

test("closing the preview strips all of its params and touches nothing else", () => {
  const params = new URLSearchParams(
    "lat=45&zoom=5&dataset=X&server=ogsl&preview=R1&vis=table&paxis=depth" +
      "&pvars=TE90_01,PSAL_01&pmode=lines&pcolors=TE90_01~a52c60" +
      // The colour dimension's two params, from a link made before it was replaced.
      "&pcolor=depth&pscale=Jet" +
      // A stale link from before faceting, carried into the same close.
      "&px=time&py=depth&p2=PSAL&pscale2=Reds&eovs=salinity",
  );
  const stripped = withoutPreviewParams(params);
  assert.equal(
    stripped.toString(),
    "lat=45&zoom=5&dataset=X&server=ogsl&eovs=salinity",
  );
  // Non-destructive: the caller's params are untouched.
  assert.equal(params.get("preview"), "R1");
});

test("the dataset page highlight survives closing the preview", () => {
  // `record` and `track` are the highlight — the row a marker click pinned and
  // the platform whose track is drawn — not the preview. Closing the plot must
  // leave the page still pointing at them, which is why the preview took
  // `preview` rather than the `record` name it once had.
  const params = new URLSearchParams(
    "dataset=X&record=R1&track=T1&preview=R1&pvars=TE90_01",
  );
  assert.equal(
    withoutPreviewParams(params).toString(),
    "dataset=X&record=R1&track=T1",
  );
});

test("stripping is safe when no preview is open", () => {
  assert.equal(
    withoutPreviewParams(new URLSearchParams("lat=45")).toString(),
    "lat=45",
  );
  assert.equal(withoutPreviewParams(new URLSearchParams("")).toString(), "");
});
