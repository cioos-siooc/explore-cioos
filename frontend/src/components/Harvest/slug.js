// e.g. https://erddap.ogsl.ca/erddap -> erddap-ogsl-ca-erddap. Not reversible:
// the backend resolves a slug by applying the same transform to its URLs.
export function slugify(url) {
  return String(url)
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/\/+$/, "")
    .replace(/[./]/g, "-");
}
