/**
 * Jest global setup — sets env vars before any module is required.
 * This prevents db.js from attempting a real PostgreSQL connection
 * and keeps tests fully offline.
 */
process.env.DB_USER = 'testuser';
process.env.DB_PASSWORD = 'testpass';
process.env.DB_HOST = 'localhost';
process.env.DB_NAME = 'testdb';
process.env.DB_PORT = '5432';
process.env.CORS_ORIGINS = '*';
// Disable swagger file scanning during tests (avoids filesystem glob)
process.env.ENABLE_API_DOCS = 'false';
// Disable Sentry in tests
delete process.env.ENVIRONMENT;
