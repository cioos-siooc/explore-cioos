import json
import logging
import os

import numpy as np

from cde_harvester.obis_harvester import harvest_obis

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

with open("./Obis_Datasets.json", "r") as file:
    data = json.load(file)

logger.info("Harvesting %d OBIS datasets", len(data["datasets"]))
result = harvest_obis(limit_dataset_ids=data["datasets"], folder="./obis/")

# Write CSVs in the format the db-loader expects
folder = "harvest_obis"
os.makedirs(folder, exist_ok=True)

datasets = result.datasets.copy()
profiles = result.profiles.copy()

# Add columns that the db-loader expects from the CKAN join step
datasets["title_fr"] = None
datasets["ckan_id"] = None
datasets = datasets.replace(np.nan, None)

# Write CSVs
datasets.to_csv(f"{folder}/datasets.csv", index=False)
profiles.to_csv(f"{folder}/profiles.csv", index=False)
result.skipped.to_csv(f"{folder}/skipped.csv", index=False)

logger.info(
    "Wrote %d datasets, %d profiles, %d skipped to %s/",
    len(datasets),
    len(profiles),
    len(result.skipped),
    folder,
)
