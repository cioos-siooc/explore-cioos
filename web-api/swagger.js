const swaggerJSDoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.1',
    info: {
      title: 'CIOOS Data Explorer API',
      version: '1.0.0',
      description: 'API documentation for Data Explorer endpoints. All endpoints are served under the /api prefix.'
    },
    servers: [
      {
        url: process.env.PUBLIC_BASE_URL || 'http://localhost:8098/api',
        description: 'Local dev'
      }
    ]
  },
  apis: [
    './routes/*.js'
  ],
  
};

module.exports = swaggerJSDoc(options);
