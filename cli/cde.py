import typer
import db
import os
import traceback
import redis_commands
import sys
from dotenv import load_dotenv

sys.path.insert(1, "../harvester/")
sys.path.insert(1, "../db-loader/")

load_dotenv(os.getcwd() + "/.env")
envs = os.environ
app = typer.Typer()
app.add_typer(db.app, name="db", help="CLI tool for managing the CDE database.")
app.add_typer(
    redis_commands.app, name="redis", help="CLI tool for managing the Redis database."
)


def handle_error(e, verbose):
    try:
        raise (e)
    except Exception as e:
        print("\n❌ Unexpected error occurred:", str(e))

        if verbose:
            traceback.print_exc()


@app.command(help="Harvests data from ERRDAP servers")
# def init(verbose: bool = typer.Option(False, help="Enable verbose output.")):
def harvester(
    urls: str = typer.Option(
        ..., help="harvest from these erddap servers, comma separated"
    ),
    cache: bool = typer.Option(False, help="Cache requests, for testing only"),
    folder: str = typer.Option("harvest", help="Folder to save harvested data to"),
    dataset_ids: str = typer.Option(
        "", help="only harvest these dataset IDs. Comma separated list"
    ),
    max_workers: int = typer.Option(1, help="max threads that harvester will use"),
    verbose: bool = typer.Option(False, help="Enable verbose output."),
    y: bool = typer.Option(False, "--yes", "-y", help="proceed with out prompts"),
):
    from cde_harvester.__main__ import main as cde_harvester

    try:
        cde_harvester(urls, cache, folder, dataset_ids, max_workers)
        if not y:
            if typer.confirm(
                "Would you like to load harvested data into the CDE database?"
            ):
                db_loader(folder=folder, verbose=verbose, y=y)
        else:
            db_loader(folder=folder, verbose=verbose, y=y)
    except Exception as e:
        handle_error(e, verbose)


@app.command(help="insterts harvested data from cde harvster into cde schema")
def db_loader(
    folder: str = typer.Option(
        "harvest", help="folder with the CSV output files from harvesting"
    ),
    verbose: bool = typer.Option(False, help="Enable verbose output."),
    y: bool = typer.Option(False, "--yes", "-y", help="proceed with out prompts"),
):
    from cde_db_loader.__main__ import main

    try:
        main(folder)
        if not y:
            if typer.confirm(
                f"Would you like to flush all Redis Cache on {envs['REDIS_HOST']}:{envs['REDIS_PORT']} ?"
            ):
                redis_commands.flushall(
                    host=envs["REDIS_HOST"], port=envs["REDIS_PORT"]
                )
        else:
            redis_commands.flushall(host=envs["REDIS_HOST"], port=envs["REDIS_PORT"])
    except Exception as e:
        handle_error(e, verbose)


if __name__ == "__main__":
    app()
