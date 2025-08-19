import typer
import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError
from sqlscripts import sqlscripts
import traceback

app = typer.Typer()
load_dotenv(os.getcwd() + "/.env")
envs = os.environ
database_link = f"postgresql://{envs['DB_USER']}:{envs['DB_PASSWORD']}@{envs['DB_HOST_EXTERNAL']}:{envs.get('DB_PORT', 5432)}/{envs['DB_NAME']}"
engine = create_engine(database_link)

def handle_error(e, verbose):
    try:
        raise(e)
    except SQLAlchemyError as e:
        if verbose:
            print("\n❌ SQLAlchemy error occurred:", str(e))
        else:
            print("\n❌ SQLAlchemy error occurred:", str(e.orig))
    except Exception as e:
        
        print("\n❌ Unexpected error occurred:", str(e))

        if verbose:
            traceback.print_exc()

def drop_db(verbose):
    with engine.begin() as conn:
        try:
            print("🔄 Dropping schema cde", end="\r")
            conn.execute("DROP SCHEMA IF EXISTS cde CASCADE;")
            print("✅ Schema cde dropped             ")
        except Exception as e:
            handle_error(e,verbose)
@app.command(help ="initialize the database including all cde structures"  )
def init(verbose: bool = typer.Option(False, help="Enable verbose output.")):
    print(f"Initializing database: {envs['DB_NAME']}@{envs['DB_HOST_EXTERNAL']}")
    
    try:
        engine = create_engine(database_link)
        with engine.begin() as conn:
            print("🔄 Creating CDE schema and tables", end="\r")
            conn.execute(text(sqlscripts.schema))
            print("✅ CDE schema and tables created.               ")

            print("🔄 Creating ckan_process() function", end="\r")
            conn.execute(text(sqlscripts.ckan_process))
            print("✅ ckan_process() created.           ")
            
            print("🔄 Creating create_hexes() funtion", end="\r")
            conn.execute(text(sqlscripts.create_hexes))
            print("✅ create_hexes() created.           ")

            print("🔄 Creating profile_process() funtion", end="\r")
            conn.execute(text(sqlscripts.profile_process))
            print("✅ profile_process() created.           ")
            
            print("🔄 Creating remove_all_data() funtion", end="\r")
            conn.execute(text(sqlscripts.remove_all_data))
            print("✅ remove_all_data() created.           ")

            print("🔄 Creating set_constraints() and drop_constraints() funtions", end="\r")
            conn.execute(text(sqlscripts.constraints))
            print("✅ set_constraints() and drop_constraints() created.           ")

            print("🔄 Creating range funtions", end="\r")
            conn.execute(text(sqlscripts.range_functions))
            print("✅ range functions created.           ")
    except Exception as e:
        handle_error(e, verbose)

@app.command(help = "Truncates all tables")
def removeData(    verbose: bool = typer.Option(False, help="Enable verbose output."), y: bool = typer.Option(False, "--yes", "-y", help="Skip confirmation prompts and proceed with data but keeps database structure.")):
    if (not y):
        if(typer.confirm("This will clear all CDE data. Do you want to continue?")):
            with engine.begin() as conn:
                try:
                    print("🔄 Truncating Tables", end="\r")
                    conn.execute("SELECT remove_all_data();")
                    print("✅ Tables Truncated            ")
                except Exception as e:
                    handle_error(e, verbose)
    else:
        with engine.begin() as conn:
            try:
                    print("🔄 Truncating Tables", end="\r")
                    conn.execute("SELECT remove_all_data();")
                    print("✅ Tables Truncated            ")
            except Exception as e:
                handle_error(e, verbose)


@app.command(help="Clean the CDE database by dropping all structures. Optionally reinitialize the database.")

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
        
    




if __name__ == "__main__":
    app()