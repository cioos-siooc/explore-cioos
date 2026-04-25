// API_URL is baked in at build time. Defaults to "/api" so the SPA calls the
// same origin that served it — no need to know the public hostname.
// Override only when the API lives on a different origin.
const server = process.env.API_URL || '/api'
console.debug('API_URL:', server)

module.exports = { server }
