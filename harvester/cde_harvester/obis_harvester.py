from cde_harvester.base_harvester import BaseHarvester, HarvestResult
import os
import requests
import json
class OBISHarvester(BaseHarvester):

    def __init__(self, limit_dataset_ids=None, folder="./obis"):
        self.limit_dataset_ids = limit_dataset_ids
        self.folder = folder
    
    def harvest(self) -> HarvestResult:
        for datasetid in self.limit_dataset_ids:
            print(f"processing datasetid: {datasetid}")
            data = self.getOccurances(datasetid, self.folder)
            print(data)
            print()
        pass 
    def getOccurances(self, datasetid, folder = "./obis"):
        print()
        base_url = f"https://api.obis.org/v3/occurrence?datasetid={datasetid}&size=10000"
        os.makedirs(folder, exist_ok=True)
        
        file = f"{datasetid}.json"
        file = os.path.join(folder,file)
        occurancesData = {}
        if os.path.isfile(file):
            print(f"Loaded {datasetid} occurances from cache")
            with open(file, "r") as occurancesJSON:
                occurancesData = json.load(occurancesJSON)
                
        else:
            all_results = []
            url = base_url
            page = 1
            while True:
                response = requests.get(url)
                response.raise_for_status()
                page_data = response.json()
                results = page_data.get("results", [])
                
                if not results:
                    break
                    
                all_results.extend(results)
                total = page_data.get("total", 0)
                print(f"  Page {page}: {len(all_results)}/{total} records", end="\r")
                
                # Use last record's ID as cursor for next page
                if len(results) < 10000:
                    break  # Last page
                
                last_id = results[-1].get("id")
                if not last_id:
                    break
                url = f"{base_url}&after={last_id}"
                page += 1
                time.sleep(0.1)  # Rate limiting
            
            occurancesData = {"results": all_results, "total": len(all_results)}
            print(f"\nLoaded {len(all_results)} occurrences from OBIS")
            with open(file, "w") as occurancesJSON:
                json.dump(occurancesData, occurancesJSON)
            return occurancesData
            
#@task(task_run_name="harvest-{erddap_url}")
def harvest_obis(limit_dataset_ids=None, folder="./obis/"):
    """Prefect task wrapper for ERDDAPHarvester."""
    harvester = OBISHarvester(limit_dataset_ids, folder)
    return harvester.harvest()
