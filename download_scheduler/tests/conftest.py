import os

# download_scheduler.download_scheduler builds a SQLAlchemy engine at import
# time via cde_common.db, so the required settings have to exist before the
# module is imported. create_engine() is lazy — nothing connects, so bogus
# values are fine. DB_HOST rather than DB_HOST_EXTERNAL on purpose: this module
# used to be the one place that read only DB_HOST, and cde_common.db accepting
# both names is what closed that gap.
os.environ.setdefault("DB_USER", "test")
os.environ.setdefault("DB_PASSWORD", "test")
os.environ.setdefault("DB_HOST", "localhost")
os.environ.setdefault("DB_NAME", "test")

# download_email calls cde_common.env.load_env(), which loads the nearest .env
# without overriding what is already set. Running pytest from the repo root would
# otherwise pull in the real Gmail credentials; setting dummies here means the
# file's values lose, so the tests can never pick up (or send with) real ones.
os.environ.setdefault("GMAIL_USER", "test-sender@example.invalid")
os.environ.setdefault("GMAIL_PASSWORD", "test-password")

# run_download_observed wraps each job in a Prefect flow run when PREFECT_API_URL
# is set. A developer who happens to have it exported would otherwise have the
# whole suite trying to reach a real Prefect server; the flow path is covered by
# its own tests, which set it explicitly.
os.environ.pop("PREFECT_API_URL", None)
