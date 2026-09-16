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
        // docker-compose.yaml derives PUBLIC_BASE_URL from the public URL chain
        // (SERVICE_URL_NGINX -> APP_URL -> localhost:NGINX_PORT), so the "Try
        // it out" button targets whatever deployment is serving these docs. The
        // fallback is only for running web-api outside compose; it assumes the
        // default published port.
        url: process.env.PUBLIC_BASE_URL || "http://localhost:8098/api",
        description: "This deployment",
      },
    ],
  },
  apis: ["./routes/*.js"],
};

module.exports = swaggerJSDoc(options);
