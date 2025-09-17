import typer
import os
from dotenv import load_dotenv
import traceback
from crontab import CronTab
from datetime import datetime

app = typer.Typer()
load_dotenv(os.getcwd() + "/.env")
envs = os.environ


def handle_error(e):
    try:
        raise (e)

    except Exception as e:
        print("\n❌ Unexpected error occurred:", str(e))
        traceback.print_exc()


def _install_tab(n, tabfile, activate, user, logfile, folder, urls, unit):
    os.makedirs(folder, exist_ok=True)
    cron = CronTab(user=user)
    job = cron.new(
        command="cd "
        + os.getcwd()
        + " && "
        + ".venv/bin/python"
        + " cde.py harvester --urls "
        + urls
        + " --yes >> "
        + logfile
        + " 2>&1",
        comment="CDE CLI cron created from:"
        + folder
        + "/"
        + tabfile
        + " at: "
        + str(datetime.now()),
    )  # not datetime.now() used to ensure uniquenness
    # job = cron.new(command='cd ' + os.getcwd() + ' && ' + 'date >> ' + logfile + ' 2>&1', comment = "CDE CLI cron created from:" + folder+'/'+ tabfile + ' at: ' + str(datetime.now())) #simple cron for testing
    if unit == "minutes":
        job.minute.every(n)
    elif unit == "hours":
        job.minute.on(0)
        job.hour.every(n)
    elif unit == "days":
        job.minute.on(0)
        job.hour.on(0)
        job.day.every(n)
    elif unit == "months":
        job.minute.on(0)
        job.hour.on(0)
        job.day.on(1)
        job.month.every(n)
    cron.write(folder + "/" + tabfile)
    if activate:
        cron.write_to_user(user=user)


@app.command(help="")
def install_tab(
    folder: str = typer.Option("./cronjobs", help="folder where cron jobs are saved. "),
    tabfile: str = typer.Option(
        "harvester.cron",
        help="file to save cron job to. Used to keep track of cron jobs",
    ),
    user: str = typer.Option("root", help="CronTab user"),
):
    with CronTab(tabfile=folder + "/" + tabfile) as cron:
        cron.write_to_user(user=user)


@app.command(help="Create a cron job that runs every n hours, on the hour")
def hours(
    n: int = typer.Option(
        5, help="number n hours since the start of each day to harvest data"
    ),
    tabfile: str = typer.Option(
        "harvester.cron",
        help="file to save cron job to. Used to keep track of cron jobs",
    ),
    activate: bool = typer.Option(True, help="install cron"),
    user: str = typer.Option("root", help="CronTab user"),
    logfile: str = typer.Option(
        "cron-harvester.log", help="log file of harvester output"
    ),
    folder: str = typer.Option("./cronjobs", help="folder where cron jobs are saved. "),
    urls: str = typer.Option(
        ..., help="harvest from these erddap servers, comma separated"
    ),
):
    _install_tab(
        n=n,
        tabfile=tabfile,
        activate=activate,
        user=user,
        logfile=logfile,
        folder=folder,
        urls=urls,
        unit="hours",
    )


@app.command(help="Create a cron job that runs every n days, on the day")
def days(
    n: int = typer.Option(
        3,
        help="number of incremental days since the start of each month to harvest data",
    ),
    tabfile: str = typer.Option(
        "harvester.cron",
        help="file to save cron job to. Used to keep track of cron jobs",
    ),
    activate: bool = typer.Option(True, help="install cron"),
    user: str = typer.Option("root", help="CronTab user"),
    logfile: str = typer.Option(
        "cron-harvester.log", help="log file of harvester output"
    ),
    folder: str = typer.Option("./cronjobs", help="folder where cron jobs are saved. "),
    urls: str = typer.Option(
        ..., help="harvest from these erddap servers, comma separated"
    ),
):
    _install_tab(
        n=n,
        tabfile=tabfile,
        activate=activate,
        user=user,
        logfile=logfile,
        folder=folder,
        urls=urls,
        unit="days",
    )


@app.command(help="Create a cron job that runs every n months, on the month")
def months(
    n: int = typer.Option(
        3,
        help="number of incremental days since the start of each month to harvest data",
    ),
    tabfile: str = typer.Option(
        "harvester.cron",
        help="file to save cron job to. Used to keep track of cron jobs",
    ),
    activate: bool = typer.Option(True, help="install cron"),
    user: str = typer.Option("root", help="CronTab user"),
    logfile: str = typer.Option(
        "cron-harvester.log", help="log file of harvester output"
    ),
    folder: str = typer.Option("./cronjobs", help="folder where cron jobs are saved. "),
    urls: str = typer.Option(
        ..., help="harvest from these erddap servers, comma separated"
    ),
):
    _install_tab(
        n=n,
        tabfile=tabfile,
        activate=activate,
        user=user,
        logfile=logfile,
        folder=folder,
        urls=urls,
        unit="months",
    )


@app.command(help="List cron jobs saved in folder the cronjob folder")
def list_jobs(
    folder: str = typer.Option("./cronjobs", help="folder where cron jobs are saved. "),
):
    for cronfile in os.listdir(folder):
        print(cronfile)
        with CronTab(tabfile=folder + "/" + cronfile) as cron:
            print(f"CronTab: {cronfile}")
            for job in cron:
                print("\t", cron)


@app.command(help="Remove cron jobs saved in tabfile from the user's crontab")
def remove_crontab(
    folder: str = typer.Option("./cronjobs", help="folder where cron jobs are saved. "),
    tabfile: str = typer.Option(
        "harvester.cron",
        help="file where saved cron job are. Used to keep track of cron jobs",
    ),
    user: str = typer.Option("root", help="CronTab user"),
):
    with CronTab(user=user) as user_tab:
        with CronTab(tabfile=folder + "/" + tabfile) as file_tab:
            for file_job in file_tab:
                if user_tab.find_comment(file_job.comment):
                    user_tab.remove_all(comment=file_job.comment)

                else:
                    print("command not found, continuing")
            print(f"crontab from: {tabfile} removed")
            if typer.confirm(f"do you want to remove {folder}/{tabfile}"):
                os.remove(folder + "/" + tabfile)


if __name__ == "__main__":
    app()
