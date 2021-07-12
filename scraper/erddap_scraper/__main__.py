import argparse
from erddap_scraper.scrape_erddap import scrape_erddap

import threading
import pandas as pd
import uuid

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("erddap_urls")
    parser.add_argument(
        "--dataset_ids",
        help="only scrape these dataset IDs. Comma separated list",
    )

    args = parser.parse_args()
    erddap_urls = args.erddap_urls.split(",")
    dataset_ids = None
    if args.dataset_ids:
        dataset_ids = args.dataset_ids.split(",")

    threads = []
    result = []

    for erddap_url in erddap_urls:
        print("Starting scraper:", erddap_url)
        scraping_thread = threading.Thread(
            target=scrape_erddap, args=(erddap_url, result, dataset_ids)
        )
        scraping_thread.start()
        threads.append(scraping_thread)

    for thread in threads:
        thread.join()

    profiles = pd.DataFrame()
    datasets = pd.DataFrame()
    datasets_not_added_total = []
    for [profile, dataset, datasets_not_added] in result:
        profiles = profiles.append(profile)
        datasets = datasets.append(dataset)
        datasets_not_added_total = datasets_not_added_total + datasets_not_added

    uuid_suffix = str(uuid.uuid4())[0:6]
    datasets_file = f"datasets_{uuid_suffix}.csv"
    profiles_file = f"profiles_{uuid_suffix}.csv"

    if datasets.empty:
        print("No datasets scraped")
    else:
        datasets.to_csv(datasets_file, index=False)
        profiles.to_csv(profiles_file, index=False)
        print(f"Wrote {datasets_file} and {profiles_file}")
        print("datasets_not_added_total", datasets_not_added_total)
