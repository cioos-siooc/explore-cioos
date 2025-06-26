const server = process.env.API_URL
// if no server is defined, raise an error
console.debug('API_URL:', server)
if (!server) {
  throw new Error('API_URL is not defined')
}

module.exports = { server }
