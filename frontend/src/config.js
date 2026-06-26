let server = process.env.API_URL
if (!server) {
  throw new Error('API_URL is not defined')
}

// Map tile loading happens inside a MapLibre/Mapbox Web Worker, where
// `new Request(...)` requires an ABSOLUTE URL (no document.baseURI to resolve
// against). A relative API_URL like "/api" works for fetch() calls from the
// main thread, but workers throw:
//   TypeError: Failed to construct 'Request': Failed to parse URL from /api/tiles/...
// Convert relative API_URLs to absolute by prefixing the page origin.
if (server.startsWith('/')) {
  server = window.location.origin + server
}

console.debug('API_URL:', server)

export { server }
