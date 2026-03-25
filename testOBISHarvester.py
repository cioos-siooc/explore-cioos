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
folder = "harvest_obis_missing"
os.makedirs(folder, exist_ok=True)

datasets = result.datasets.replace(np.nan, None)
obis_cells = result.obis_cells.copy()

# Write CSVs
datasets.to_csv(f"{folder}/datasets.csv", index=False)
obis_cells.to_csv(f"{folder}/obis_cells.csv", index=False)
result.skipped.to_csv(f"{folder}/skipped.csv", index=False)

logger.info(
    "Wrote %d datasets, %d obis_cells, %d skipped to %s/",
    len(datasets),
    len(obis_cells),
    len(result.skipped),
    folder,
)
