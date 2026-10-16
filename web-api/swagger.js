const swaggerJSDoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.1",
    info: {
      title: "CIOOS Data Explorer API",
      version: "1.0.0",
      description:
        "API documentation for Data Explorer endpoints. All endpoints are served under the /api prefix.",
    },
    servers: [
      {
        // compose derives PUBLIC_BASE_URL from the public URL chain; the
        // fallback is for running web-api outside compose.
        url: process.env.PUBLIC_BASE_URL || "http://localhost:8098/api",
        description: "This deployment",
      },
    ],
  },
  apis: ["./routes/*.js"],
};

module.exports = swaggerJSDoc(options);
