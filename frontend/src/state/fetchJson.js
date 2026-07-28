// fetch + JSON with a proper error on non-2xx responses. Gateway errors
// (e.g. 504) return HTML bodies, which response.json() would otherwise turn
// into cryptic "Unexpected token '<'" rejections.
export default async function fetchJson (url, options) {
  const response = await fetch(url, options)
  if (!response.ok) {
    const error = new Error(`${response.status} ${response.statusText} — ${url}`)
    error.status = response.status
    throw error
  }
  return response.json()
}
