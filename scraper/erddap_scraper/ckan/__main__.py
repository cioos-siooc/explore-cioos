import argparse


from erddap_scraper.ckan_scraper.create_ckan_erddap_link import get_ckan_records

output_file = "erddap_ckan_mapping.csv"


def main(cache):
    """Run the CKAN scraper on CIOOS National (cioos.ca)"""

    # query CKAN national for all erddap datsets
    print("Gathering list of records that link to an erddap")

    print("Querying each record")

    df = get_ckan_records(limit, cache=cache)
    df.to_csv(output_file)

    print("Wrote ", output_file)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--cache", help="Cache requests, for testing only", action="store_true"
    )

    args = parser.parse_args()

    limit = None

    main(args.cache)
