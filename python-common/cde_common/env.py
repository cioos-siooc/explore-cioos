"""The one place that loads ``.env`` into the process environment.

There were three implementations of this, each with its own idea of where the
file lives and when it has already been loaded:

* ``load_dotenv()`` at harvester import time — ``$CWD/.env`` only.
* ``load_dotenv(os.getcwd() + "/.env")`` behind ``if not os.getenv("DB_HOST")``
  in the scheduler, and again behind ``if not os.getenv("GMAIL_USER")`` in its
  email module.
* a ``find_dotenv``-based one inside ``database_url()``, so it re-ran on every
  engine creation.

The single-variable sentinels were the real hazard: each guessed at one name to
decide whether the *whole* file had already been supplied, so a container that
set ``DB_HOST`` but no ``GMAIL_*`` loaded the file for mail and not for the
database. Two halves of one process then disagreed about where settings came
from — exactly the class of bug that had the scheduler connecting to a host the
code it imported never read.
"""

import os

from dotenv import find_dotenv, load_dotenv

# Working directories already searched. Keyed by directory, not a single flag,
# because resolution is relative to the cwd and callers do move: a Prefect
# deployment's ``set_working_directory`` pull step puts the run in the harvester
# dir, and the tests chdir into a tmpdir holding the ``.env`` under test.
_searched = set()


def load_env():
    """Load the nearest ``.env`` (cwd, then ancestors) into ``os.environ``.

    Anything already in the environment wins — a container that sets its own
    variables is never overridden by a file that happens to be on disk.

    Ancestors are searched (``find_dotenv``) rather than only ``$CWD/.env``,
    because the file is as likely to sit at the repo/app root as in a service
    directory. Nearest wins. Only checking ``$CWD`` is what once let ``DB_NAME``
    look unset to a rebuild guard while the harvests around it connected fine.

    Cheap to call from anywhere, including on every engine creation: the search
    runs once per working directory. Any code that *decides* something about the
    database — not just connects to it — has to resolve names the same way, or
    it will disagree with the connection it is about to open.
    """
    cwd = os.getcwd()
    if cwd in _searched:
        return
    _searched.add(cwd)
    path = dotenv_path()
    if path:
        load_dotenv(path)


def dotenv_path():
    """The ``.env`` :func:`load_env` would read from here, or None.

    For diagnostics: an error that says a setting is missing is far more useful
    when it also names the file it looked in — "harvests connect fine but this
    says DB_NAME is unset" is otherwise unanswerable.
    """
    return find_dotenv(usecwd=True) or None
