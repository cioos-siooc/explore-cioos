// fetch + JSON with a proper error on non-2xx responses. Gateway errors
// (e.g. 504) return HTML bodies, which response.json() would otherwise turn
// into cryptic "Unexpected token '<'" rejections.
export default async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    // The API's error handler answers {"error": "..."}; anything else adds no detail.
    let detail;
    try {
      detail = JSON.parse(await response.text())?.error;
    } catch {
      detail = undefined;
    }
    const error = new Error(
      detail || `${response.status} ${response.statusText} — ${url}`,
    );
    error.status = response.status;
    error.detail = detail;
    throw error;
  }
  return response.json();
}
