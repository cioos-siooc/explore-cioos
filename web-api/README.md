# CDE Web API

The CDE Web API is an Express.js application that serves as the backend for the CDE frontend. It provides:

- RESTful API endpoints for dataset queries and downloads
- Vector tile server for map visualizations
- Integration with PostgreSQL/PostGIS database
- Redis caching for improved performance

## Development

### Using Docker Compose (Recommended)

The API runs automatically as part of Docker Compose. See the main [README.md](../README.md) for setup instructions.

### Manual Setup

To run the API outside of Docker:

1. Copy `.env.sample` to `.env` in the project root and configure your database connection:

   ```env
   DB_HOST=localhost
   DB_NAME=cde
   DB_USER=postgres
   DB_PASSWORD=password
   REDIS_HOST=localhost
   ```

2. Ensure PostgreSQL and Redis are running (or use Docker for just these services):

   ```sh
   # From project root
   docker compose up -d db redis
   ```

3. Install dependencies and start the API:

   ```sh
   cd web-api
   npm install
   npm start
   ```

4. Verify the API is running:

   ```sh
   # Test basic endpoint
   curl localhost:5000

   # Test vector tile server
   curl localhost:5000/tiles/1/3/2.mvt
   ```

## Configuration

The API uses environment variables from `.env`:

- `DB_HOST`: Database hostname (default: `db` for Docker, `localhost` for local)
- `DB_NAME`: Database name
- `DB_USER`: Database username
- `DB_PASSWORD`: Database password
- `DB_PORT`: Database port (default: `5432`)
- `REDIS_HOST`: Redis hostname (default: `redis` for Docker, `localhost` for local)
- `API_URL`: Base URL for the API

## Technology Stack

- **Express.js**: Web framework
- **Knex.js**: SQL query builder
- **PostgreSQL/PostGIS**: Database with spatial extensions
- **Redis**: Caching layer
- **MVT (Mapbox Vector Tiles)**: Vector tile generation
