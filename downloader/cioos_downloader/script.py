"""Entry point of the download script saved from the Data Explorer.

The script embeds the selection as a manifest (the same input a queued
download gets) and calls run(), so it builds the package on the user's own
computer with this code: same requests, filter, metadata and citations,
without the server's size limits and without README.html.
"""

from collections import Counter
from pathlib import Path

from loguru import logger
from rich.filesize import decimal
from rich.progress import BarColumn, Progress, ProgressColumn, SpinnerColumn, TextColumn, TimeElapsedColumn
from rich.text import Text

from cioos_downloader import download_erddap
from cioos_downloader.download_erddap import FORMATS, get_datasets
from cioos_downloader.package import REASONS, write_package


class _Transfer(ProgressColumn):
    def render(self, task):
        if task.total is not None:
            return Text(f"{task.completed:.0f}/{task.total:.0f} datasets")
        speed = f" at {decimal(int(task.speed))}/s" if task.speed else ""
        return Text(f"{decimal(int(task.completed))}{speed}")


class _Display(download_erddap.Progress):
    """A bar for the datasets done, plus one per server being downloaded from."""

    def __init__(self, datasets):
        self.bars = Progress(
            SpinnerColumn(),
            TextColumn("{task.description}"),
            BarColumn(bar_width=20),
            _Transfer(),
            TimeElapsedColumn(),
            TextColumn("[dim]{task.fields[stage]}"),
        )
        self.per_server = Counter(map(download_erddap.server, datasets))
        self.done = Counter()
        self.overall = self.bars.add_task("All", total=len(datasets), stage="")
        self.tasks = {}
        self.current = {}

    def stage(self, dataset, text):
        host = download_erddap.server(dataset)
        if host not in self.tasks:
            self.tasks[host] = self.bars.add_task("", total=None, stage="")
        task = self.tasks[host]
        if self.current.get(host) is not dataset:
            self.current[host] = dataset
            self.bars.reset(task, total=None)
            n = self.per_server[host]
            position = f" ({self.done[host] + 1}/{n})" if n > 1 else ""
            self.bars.update(task, description=f"{host} {dataset['dataset_id']}{position}")
        self.bars.update(task, stage=text if len(text) < 60 else text[:57] + "...")

    def received(self, dataset, n_bytes):
        self.bars.advance(self.tasks[download_erddap.server(dataset)], n_bytes)

    def finished(self, dataset, row):
        host = download_erddap.server(dataset)
        self.done[host] += 1
        self.bars.advance(self.overall)
        if self.done[host] == self.per_server[host]:
            self.bars.remove_task(self.tasks.pop(host))


def _log_line(record):
    line = "{time:HH:mm:ss} <level>{level: <7}</level> {message}"
    if record["exception"]:
        line += " ({exception.type.__name__}: {exception.value})"
    return line + "\n"


def run(manifest):
    root = Path.cwd() / f"cde_download_{manifest['user_query']['job_id']}"
    root.mkdir(exist_ok=True)
    display = _Display(manifest["cache_filtered"])
    # The log prints above the bars instead of tearing through them.
    logger.remove()
    logger.add(
        lambda message: display.bars.console.print(Text.from_ansi(message.rstrip("\n")), soft_wrap=True),
        format=_log_line,
        level="INFO",
        colorize=True,
    )

    print(f"Downloading {len(manifest['cache_filtered'])} dataset(s) into {root}")
    print(f"Each server is asked for one request at a time; up to {download_erddap.MAX_WORKERS} servers at once.\n")
    with display.bars:
        report = get_datasets(manifest, root, size_limits=False, progress=display)
        logger.info("Writing README.md, citations and package metadata")
        write_package(root, manifest, report, readme_html=False)

    print()
    for row in report["erddap_report"]:
        error = row["erddap_error"].splitlines()[0] if row["erddap_error"] else ""
        if row["format_fallback"] and row["files"]:
            error = REASONS["en"]["fallback"].format(format=FORMATS[row["requested_format"]].label)
        print(f"{row['status']:>9}  {row['dataset_id']}  {error}")
    print(f"\nFiles are in {root}; README.md lists what is included and how to cite it.")
    return 1 if report["empty_download"] else 0
