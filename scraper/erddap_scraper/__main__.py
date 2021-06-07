import argparse
from erddap_scraper.scrape_erddap import scrape_erddap

import threading
import pandas as pd

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("erddap_urls")
    args = parser.parse_args()
    erddap_urls=args.erddap_urls

    threads=[]
    result=[]

    for erddap_url in erddap_urls.split(','):
            print("Starting scraper:",erddap_url)
            scraping_thread = threading.Thread(target=scrape_erddap, args=(erddap_url,result))
            scraping_thread.start()
            threads.append(scraping_thread)

    for thread in threads:
        thread.join()

    profiles=pd.DataFrame()
    datasets=pd.DataFrame()
    
    for [profile,dataset] in result:
        profiles=profiles.append(profile)
        datasets=datasets.append(dataset)
    
    datasets.to_csv("datasets.csv",index=False)
    profiles.to_csv("profiles.csv",index=False)
    print("Wrote datasets.csv and profiles.csv")
