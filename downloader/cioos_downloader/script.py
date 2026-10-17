"""Entry point of the download script saved from the Data Explorer.

The script embeds the selection as a manifest (the same input a queued
download gets) and calls run(), so it builds the package on the user's own
computer with this code: same requests, filter, metadata and citations,
without the server's size limits and without README.html.
"""

from pathlib import Path

from cioos_downloader.download_erddap import get_datasets
from cioos_downloader.package import write_package


def run(manifest):
    root = Path.cwd() / f"cde_download_{manifest['user_query']['job_id']}"
    root.mkdir(exist_ok=True)
    report = get_datasets(manifest, root, size_limits=False)
    write_package(root, manifest, report, readme_html=False)

    for row in report["erddap_report"]:
        error = row["erddap_error"].splitlines()[0] if row["erddap_error"] else ""
        print(f"{row['status']:>9}  {row['dataset_id']}  {error}")
    print(f"\nFiles are in {root}; README.md lists what is included and how to cite it.")
    return 1 if report["empty_download"] else 0
