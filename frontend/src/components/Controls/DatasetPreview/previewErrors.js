// Why a record's /preview came back with nothing.
//
// The route has distinguished its failures all along — four codes, each with its
// own test in web-api/routes/preview.test.js — and the modal printed one
// sentence for all of them, plus for a network failure that never reached the
// route at all. This is the vocabulary that turns a response into one of them.
//
// Pure on purpose: the provider that fetches imports react, so the mapping lives
// here where `node --test` can assert every branch.

export const PREVIEW_ERROR = {
  RECORD_NOT_FOUND: "RECORD_NOT_FOUND",
  NO_RECORD_ID_VARIABLE: "NO_RECORD_ID_VARIABLE",
  NO_DATA: "NO_DATA",
  ERDDAP_UNAVAILABLE: "ERDDAP_UNAVAILABLE",
  // Never sent by the route: the request did not arrive, or its answer did not.
  NETWORK: "NETWORK",
  // A failure nobody here has a sentence for. The generic message stays for it.
  UNKNOWN: "UNKNOWN",
};

const SERVER_CODES = new Set([
  PREVIEW_ERROR.RECORD_NOT_FOUND,
  PREVIEW_ERROR.NO_RECORD_ID_VARIABLE,
  PREVIEW_ERROR.NO_DATA,
  PREVIEW_ERROR.ERDDAP_UNAVAILABLE,
]);

/**
 * What stopped this preview: `{ code, upstreamStatus }`.
 *
 * `body` is whatever parsed, which may be nothing at all — a 502 from a proxy in
 * front of the API is HTML, and a dropped connection is not even that. The
 * status is the fallback so a body CDE did not write still lands somewhere
 * truthful.
 */
export function previewErrorFrom(status, body) {
  const declared = body && typeof body.error === "string" ? body.error : null;
  // The route sends `upstreamStatus: null` when ERDDAP never answered at all,
  // and Number(null) is 0 — a status that would read as if one had.
  const declaredStatus = body ? body.upstreamStatus : null;
  const upstreamStatus =
    declaredStatus === null || declaredStatus === undefined
      ? null
      : (Number.isFinite(Number(declaredStatus)) && Number(declaredStatus)) ||
        null;

  if (declared && SERVER_CODES.has(declared)) {
    return { code: declared, upstreamStatus };
  }
  // 5xx is the API or something in front of it; either way the data server is
  // what the reader cannot reach.
  if (status >= 500) {
    return { code: PREVIEW_ERROR.ERDDAP_UNAVAILABLE, upstreamStatus };
  }
  return { code: PREVIEW_ERROR.UNKNOWN, upstreamStatus };
}

// The request never arrived, or its answer did not: there is no status to read.
export function networkPreviewError() {
  return { code: PREVIEW_ERROR.NETWORK, upstreamStatus: null };
}
