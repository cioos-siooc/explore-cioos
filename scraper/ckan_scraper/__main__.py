import argparse
from dotenv import load_dotenv
import os

from sqlalchemy import create_engine, types
from sqlalchemy.dialects import postgresql

from ckan_scraper.create_ckan_erddap_link import (
    get_ckan_records, list_ckan_records_with_erddap_urls)

# scheduler_config = config["config"]
dtype = {
    "eovs": postgresql.ARRAY(types.TEXT),
    "parties": postgresql.ARRAY(types.TEXT),
    "ckan_record": postgresql.JSONB,
}

output_file = "erddap_ckan_mapping.csv"


def main(csv_only=False, limit=None):
    """Run the CKAN scraper on CIOOS National (cioos.ca)"""
    
    # setup database connection
    # This is only run from outside docker
    if not csv_only:
        load_dotenv(os.getcwd() + '/.env')
        envs=os.environ
        table = "ckan_data_loader"
        engine = create_engine(
            f"postgresql://{envs['DB_USER']}:{envs['DB_PASSWORD']}@{envs['DB_HOST']}:5432/{envs['DB_NAME']}"
        )
        # test connection
        engine.connect()

    # query CKAN national for all erddap datsets
    print("Gathering list of records that link to an erddap")
    record_id_erddap_url_map = list_ckan_records_with_erddap_urls()

    # get all the linked CKAN records, set limit for testing, eg get_ckan_records(record_id_erddap_url_map,10)
    print("Querying each record")
    df = get_ckan_records(record_id_erddap_url_map, limit)

    print("Writing to db or file")

    if csv_only:
        df.to_csv(output_file)
        print("Wrote ", output_file)
    else:
        schema='cioos_api'
        df.to_sql(table, con=engine, if_exists="replace", schema=schema, dtype=dtype,index=False)
        engine.execute('SELECT ckan_process();')
        engine.execute('SELECT ckan_process();')
        print("Wrote to db:", f"{schema}.{table}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--csv-only", help="Skip writing to the DB", action="store_true"
    )
    parser.add_argument("--limit", help="Limit to x number of records for testing")
    args = parser.parse_args()
    
    limit=None
    if args.limit:
        limit=int(args.limit)

    main(args.csv_only, limit)
