import os

# download_scheduler.download_scheduler reads DB_* and builds a SQLAlchemy
# engine at import time, so these have to exist before the module is imported.
# create_engine() is lazy — nothing connects, so bogus values are fine.
os.environ.setdefault("DB_USER", "test")
os.environ.setdefault("DB_PASSWORD", "test")
os.environ.setdefault("DB_HOST", "localhost")
os.environ.setdefault("DB_NAME", "test")

# download_email falls back to load_dotenv(cwd + "/.env") when GMAIL_USER is
# unset. Running pytest from the repo root would pull in the real Gmail
# credentials; setting a dummy here short-circuits that branch so the tests can
# never pick up (or send with) real ones.
os.environ.setdefault("GMAIL_USER", "test-sender@example.invalid")
os.environ.setdefault("GMAIL_PASSWORD", "test-password")

# run_download_observed wraps each job in a Prefect flow run when PREFECT_API_URL
# is set. A developer who happens to have it exported would otherwise have the
# whole suite trying to reach a real Prefect server; the flow path is covered by
# its own tests, which set it explicitly.
os.environ.pop("PREFECT_API_URL", None)
