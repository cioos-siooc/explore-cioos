import typer
import os
from dotenv import load_dotenv
import traceback

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




@app.command(help="")
def hours(n: int= typer.Option(3, help="number of hours between harvests data")):
    pass


@app.command(help="")
def days(n: int= typer.Option(3, help="number of days between harvests data")):
    pass
    

@app.command(help="")
def weeks(n: int= typer.Option(3, help="number of weeks between harvests data")):
    pass
    
@app.command(help="")
def months(n: int= typer.Option(3, help="number of months between harvests data")):
    pass


if __name__ == "__main__":
    app()
