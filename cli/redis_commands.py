import typer
import os
from dotenv import load_dotenv
import traceback
import redis

app = typer.Typer()
load_dotenv(os.getcwd() + "/.env")
envs = os.environ


def handle_error(e, verbose):
    try:
        raise (e)
    except Exception as e:
        print("\n❌ Unexpected error occurred:", str(e))

        if verbose:
            traceback.print_exc()


@app.command()
def flushall(
    host: str = typer.Option(
        envs["REDIS_HOST"], help="Default loaded from env REDIS_HOST"
    ),
    port: int = typer.Option(
        envs["REDIS_PORT"], help="Default loaded from env REDIS_PORT"
    ),
):
    r = redis.Redis(host=host, port=port)
    print("🔄 Flushing all Redis databases", end="\r")
    r.flushall()
    print("✅ All Redis databases have been flushed.")


@app.command()
def flushdb(
    host: str = typer.Option(
        envs["REDIS_HOST"], help="Default loaded from env REDIS_HOST"
    ),
    port: int = typer.Option(
        envs["REDIS_PORT"], help="Default loaded from env REDIS_PORT"
    ),
    db: int = typer.Option(
        0,
        help="Database number eg(0-15), Default 0",
    ),
):
    pass


"""
def clean(
    verbose: bool = typer.Option(False, help="Enable verbose output."),
    y: bool = typer.Option(False, "--yes", "-y", help="Skip confirmation prompts and proceed with cleaning and reinitialization.")
):

    if (not y):
        if(typer.confirm("This will clear all CDE data including all structures. Do you want to continue?")):
            drop_db(verbose)
            if(typer.confirm("Do you want to reinitialize the database?")):
                init(verbose)
    else:
        drop_db(verbose)
        init(verbose)
"""


if __name__ == "__main__":
    app()
