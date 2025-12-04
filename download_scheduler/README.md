# Download Scheduler

The download scheduler checks the database periodically and runs the downloader when there are pending download requests from users.

## Using Docker (Recommended)

The scheduler runs automatically as a service in Docker Compose. See the main [README.md](../README.md) for setup instructions.

Configuration is handled through the `.env` file at the project root.

## Manual Setup

To run the scheduler outside of Docker:

1. Configure environment variables by copying `.env.sample` to `.env` in the project root and filling in your database connection info.

2. Create a virtual environment and install dependencies using uv (recommended) or pip:

   ```sh
   # Using uv (recommended)
   uv sync

   # Or using pip
   pip install -e .
   ```

   This will create a local `.venv` directory and install all dependencies including the downloader and harvester packages.

3. Run the scheduler:

   ```sh
   uv run python -m download_scheduler

   # Or if using pip/venv
   python -m download_scheduler
   ```

## Configuration

The scheduler uses these environment variables from `.env`:

- `DB_HOST`: Database hostname (use `localhost` when running outside Docker)
- `DB_NAME`: Database name
- `DB_USER`: Database username
- `DB_PASSWORD`: Database password
- `DOWNLOADS_FOLDER`: Directory for downloaded files
- `DOWNLOAD_WAF_URL`: Base URL for WAF downloads
- `CREATE_PDF`: Enable/disable PDF generation
