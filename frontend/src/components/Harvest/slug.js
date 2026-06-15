// Harvest URLs use a readable slug derived from the source URL: the scheme is
// dropped and '.' / '/' are replaced with '-'
// (e.g. https://erddap.ogsl.ca/erddap -> erddap-ogsl-ca-erddap).
// The transform isn't reversible, so the backend resolves a slug back to the
// full stored erddap_url by applying the same transform to its URLs.
export function slugify(url) {
  return String(url)
    .replace(/^[a-z]+:\/\//i, '') // drop scheme
    .replace(/\/+$/, '')          // drop trailing slash
    .replace(/[./]/g, '-')        // '.' and '/' -> '-'
}
