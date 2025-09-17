
# CIOOS Data Explorer (CDE) Command Line Interface (CLI)

CDE CLI is built to help aid in the managament of CDE. it includes typer
wrappers around the harvester and dbloader scripts as well as helper tools for
the management of the database and redis cache.

## Setup

- Setup Python virtual env and install Python modules:

```bash

uv venv

uv sync

```

- Linux:

`source .venv/bin/activate`

- windows:

`.venv/bin/activate`

## Usage

To find the tool listing and usage type:

`python cde.py --help`

## Examples

- initialize database:

`python cde.py db init`

- harvest erddap datasets:

`python cde.py harvester --urls https://catalogue.hakai.org/erddap,https://www.smartatlantic.ca/erddap`
