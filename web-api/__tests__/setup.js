// Jest global setup: env vars set before any module is required.
process.env.DB_USER = "testuser";
process.env.DB_PASSWORD = "testpass";
process.env.DB_HOST = "localhost";
process.env.DB_NAME = "testdb";
process.env.DB_PORT = "5432";
process.env.CORS_ORIGINS = "*";
// avoids swagger's filesystem glob
process.env.ENABLE_API_DOCS = "false";
delete process.env.ENVIRONMENT;
