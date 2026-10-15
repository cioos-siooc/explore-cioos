import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PREVIEW_ERROR,
  previewErrorFrom,
  networkPreviewError,
} from "./previewErrors.js";

test("each code the route sends is carried through", () => {
  const cases = [
    [404, { error: "RECORD_NOT_FOUND" }, PREVIEW_ERROR.RECORD_NOT_FOUND],
    [
      422,
      { error: "NO_RECORD_ID_VARIABLE" },
      PREVIEW_ERROR.NO_RECORD_ID_VARIABLE,
    ],
    [404, { error: "NO_DATA" }, PREVIEW_ERROR.NO_DATA],
    [502, { error: "ERDDAP_UNAVAILABLE" }, PREVIEW_ERROR.ERDDAP_UNAVAILABLE],
  ];
  cases.forEach(([status, body, code]) => {
    assert.equal(previewErrorFrom(status, body).code, code, body.error);
  });
});

test("the upstream status rides along when the route reports one", () => {
  const error = previewErrorFrom(502, {
    error: "ERDDAP_UNAVAILABLE",
    upstreamStatus: 504,
  });
  assert.equal(error.upstreamStatus, 504);
  // A timeout has no status of its own, and the route says so with null.
  assert.equal(
    previewErrorFrom(502, { error: "ERDDAP_UNAVAILABLE", upstreamStatus: null })
      .upstreamStatus,
    null,
  );
});

test("a 5xx nobody wrote a body for is still an outage", () => {
  // A proxy in front of the API answers in HTML, so nothing parses.
  assert.equal(
    previewErrorFrom(503, null).code,
    PREVIEW_ERROR.ERDDAP_UNAVAILABLE,
  );
  assert.equal(
    previewErrorFrom(502, "<html>502 Bad Gateway</html>").code,
    PREVIEW_ERROR.ERDDAP_UNAVAILABLE,
  );
});

test("a 4xx nobody wrote a body for is not guessed at", () => {
  // The validator's 400 answers { errors: [...] }, which names no cause this
  // modal has a sentence for.
  assert.equal(
    previewErrorFrom(400, { errors: [] }).code,
    PREVIEW_ERROR.UNKNOWN,
  );
  assert.equal(previewErrorFrom(404, null).code, PREVIEW_ERROR.UNKNOWN);
});

test("an error string the frontend does not know is not trusted as a code", () => {
  // Otherwise a future route code would render as a missing translation key.
  assert.equal(
    previewErrorFrom(404, { error: "SOMETHING_NEW" }).code,
    PREVIEW_ERROR.UNKNOWN,
  );
});

test("a fetch that never answered is its own cause", () => {
  assert.deepEqual(networkPreviewError(), {
    code: PREVIEW_ERROR.NETWORK,
    upstreamStatus: null,
  });
});
