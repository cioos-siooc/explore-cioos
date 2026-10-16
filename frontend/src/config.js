let server = process.env.API_URL;
if (!server) {
  throw new Error("API_URL is not defined");
}

// MapLibre's tile worker has no document.baseURI, so a relative URL throws
// "Failed to construct 'Request'" there.
if (server.startsWith("/")) {
  server = window.location.origin + server;
}

console.debug("API_URL:", server);

export { server };
