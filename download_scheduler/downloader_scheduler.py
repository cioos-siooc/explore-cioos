import configparser
# from sqlalchemy import JSON, Text
import json
import time
import traceback
from re import L

from erddap_downloader import downloader_wrapper
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from download_email import send_email

config = configparser.ConfigParser()
config.read(".env")
db = config["db"]
scheduler_config = config["config"]

data_base_link = (
    f"postgresql://{db['user']}:{db['password']}@{db['host']}:5432/{db['database']}"
)

engine = create_engine(data_base_link)

create_pdf=False
output_folder = './out'

if 'create_pdf' in scheduler_config:
    create_pdf = scheduler_config['create_pdf']=="True"

if 'output_folder' in scheduler_config:
    output_folder = scheduler_config['output_folder']

def get_a_download_job():
    """
    :return: Latest timestamp avaiable on the CIOOS Bayne Sound database
    """
    session = Session(engine)
    
    rs = session.execute(
        "SELECT * FROM cioos_api.download_jobs WHERE status='open' ORDER BY time ASC LIMIT 1 FOR UPDATE SKIP LOCKED"
    )
    row = rs.fetchone()

    if row:
        pk=row['pk']
        print("Starting job:", pk)
        update_download_jobs(pk,{"status":"downloading","time":"NOW()"},session)
    session.commit();
    return row


def email_user(email, status, zip_filename):
    """
    Send the user a success/failed message
    """

    download_url = "https://pac-dev2.cioos.org/images/ceda/" + zip_filename
    subject = "Your CEDA data query"
    message = ""

    if status == "completed":
        message = f"Your CEDA download is available at {download_url}"
        subject += " was successful."
    elif status == "no-data":
        message = f"Your CEDA query didn't find any data.  Please try again with a larger polygon or different filters."
        subject += " didn't find any results."
    else:
        message = f"Your CEDA download failed. Please try again with a smaller polygon or fewer filters."
        subject += " failed."

    send_email(email, message, subject)


def run_download(row):
    pk = row["pk"]

    # Update status
    status = ""
    zip_filename = None
    # Run Download
    downloader_input = json.loads(row["downloader_input"])
    user_query = downloader_input["user_query"]

    email = user_query["email"]
    zip_filename = user_query["zip_filename"]
    downloader_output = ""
    try:
        # Run query in parallel mode
        result = downloader_wrapper.parallel_downloader(
            json_blob=downloader_input,
            output_folder=output_folder,
            create_pdf=create_pdf,
        )
        status = "completed"
        # Download Completed. Update Status
        downloader_output = str(result)

    except Exception as e:
        status = "failed"
        stack_trace = traceback.format_exc()
        downloader_output = str(stack_trace).replace("'", "")
        print(e)
    download_size = -1
    if downloader_output.isnumeric():
        download_size = downloader_output

        if downloader_output == "0":
            status = "no-data"

    update_download_jobs(
        pk,
        {
            "status": status,
            "downloader_output": downloader_output,
            "time_complete": "NOW()",
            "download_size": download_size,
        },
    )
    email_user(email, status, zip_filename)

def update_download_jobs(pk, row,session=engine):
    params = ",".join([f"{key}='{value}'" for key, value in row.items()])
    sql = f"UPDATE cioos_api.download_jobs SET {params} WHERE PK={pk}"
    session.execute(sql)


if __name__ == "__main__":
    print("Waiting for jobs..")
    while True:
        row = get_a_download_job()

        if row:
            pk=row['pk']
            run_download(row)
            print("sleeping")
        time.sleep(.5)
