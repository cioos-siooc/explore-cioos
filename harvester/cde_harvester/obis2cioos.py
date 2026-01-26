import requests
import time
import os
import json

BASE_URL = "https://api.obis.org/v3/dataset"
COUNTRY = "CA"  # ISO country code
PAGE_SIZE = 1000

os.makedirs("./metadata", exist_ok=True)
start_time = time.time()

print("Fetching OBIS dataset metadata...")


def addFr(text):
    outtext = {}
    outtext["en"] = text
    outtext["fr"] = "Traduction française actuellement indisponible"
    outtext["translations"] = {
        "fr": {
            "message": "text translations coming soon / Traductions de textes à venir",
            "verified": False,
        }
    }
    return outtext


def parse_extent_to_map(extent_wkt):
    """
    Parse OBIS extent POLYGON to CIOOS map format.
    Returns dict with north, south, east, west, polygon, description.
    """
    if not extent_wkt:
        return {
            "north": "",
            "south": "",
            "east": "",
            "west": "",
            "polygon": "",
            "description": {"en": ""},
        }

    try:
        # Extract coordinates from POLYGON((lon lat, lon lat, ...))
        coords_str = extent_wkt.split("POLYGON((")[1].split("))")[0]
        coord_pairs = coords_str.split(",")

        lons = []
        lats = []
        for pair in coord_pairs:
            lon, lat = pair.strip().split()
            lons.append(float(lon))
            lats.append(float(lat))

        return {
            "north": str(max(lats)),
            "south": str(min(lats)),
            "east": str(max(lons)),
            "west": str(min(lons)),
            "polygon": extent_wkt,
            "description": {"en": "Spatial extent from OBIS"},
        }
    except (IndexError, ValueError):
        # If parsing fails, return empty map
        return {
            "north": "",
            "south": "",
            "east": "",
            "west": "",
            "polygon": extent_wkt,  # Keep the original even if we can't parse it
            "description": {"en": ""},
        }


def convert_contacts(obis_contacts):
    cioos_contacts = []
    if not obis_contacts:
        return cioos_contacts

    for contact in obis_contacts:
        given_name = contact.get("givenname", "")
        last_name = contact.get("surname", "")

        # Build full name
        full_name = ""
        if given_name and last_name:
            full_name = f"{given_name} {last_name}"
        elif given_name:
            full_name = given_name
        elif last_name:
            full_name = last_name

        cioos_contact = {
            "givenNames": given_name,
            "lastName": last_name,
            "indName": full_name,
            "indOrcid": "",
            "inCitation": True,  # Default to true for creators/authors
            "role": [contact.get("type", "")],  # role is an array in CIOOS
            "orgName": contact.get("organization", ""),
            "orgAddress": "",
            "orgCity": "",
            "orgCountry": "",
            "orgRor": "",
            "orgURL": contact.get("url", ""),
        }

        # For contacts with email, add it with different field name
        if contact.get("email"):
            cioos_contact["indEmail"] = contact.get("email")

        # Add position if available
        if contact.get("position"):
            cioos_contact["position"] = contact.get("position")

        cioos_contacts.append(cioos_contact)

    return cioos_contacts


def obis2cioos(obisData):
    cioosData = {}
    cioosData["abstract"] = addFr(obisData.get("abstract", ""))
    cioosData["datasetIdentifier"] = obisData.get("id")
    cioosData["title"] = addFr(obisData.get("title", ""))
    cioosData["license"] = obisData.get("intellectualrights", "")
    cioosData["category"] = "dataset"
    cioosData["comment"] = ""
    # Keywords
    keywords = []
    if obisData.get("keywords"):
        for keyword in obisData["keywords"]:
            keywords.append(keyword.get("keyword"))
    cioosData["keywords"] = {"en": keywords, "fr": []}

    # Associated resources
    associated_resources = []

    # Primary dataset URL
    if obisData.get("url"):
        associated_resources.append(
            {
                "association_type": "IsIdenticalTo",
                "association_type_iso": "crossReference",
                "authority": "URL",
                "code": obisData["url"],
                "title":"Primary dataset URL",
            }
        )

    # Archive URL
    if obisData.get("archive") and obisData["archive"] != obisData.get("url"):
        associated_resources.append(
            {
                "association_type": "IsIdenticalTo",
                "association_type_iso": "crossReference",
                "authority": "URL",
                "code": obisData["archive"],
                "title": "Dataset archive",
            }
        )

    # Metadata feed
    if obisData.get("feed") and obisData["feed"].get("url"):
        associated_resources.append(
            {
                "association_type": "IsIdenticalTo",
                "association_type_iso": "crossReference",
                "authority": "URL",
                "code": obisData["feed"]["url"],
                "title": "Metadata feed source",
            }
        )

    # Tags (e.g., vocabulary terms)
    if obisData.get("tags"):
        for tag in obisData["tags"]:
            associated_resources.append(
                {
                    "association_type": "IsDescribedBy",
                    "association_type_iso": "crossReference",
                    "authority": "URL",
                    "code": tag,
                    "title": "OBIS Dataset Type vocabulary term",
                }
            )

    cioosData["associated_resources"] = associated_resources
    cioosData["contacts"] = convert_contacts(obisData.get("contacts"))

    created_date = obisData.get("created")
    if created_date:
        cioosData["created"] = created_date.split(".")[0] + "Z"
    else:
        cioosData["created"] = ""

    # Temporal extent of data collection (not available in OBIS metadata)
    cioosData["dateStart"] = ""
    cioosData["dateEnd"] = ""

    # Dataset publication
    published_date = obisData.get("published", "")
    if published_date:
        cioosData["datePublished"] = published_date.split(".")[0] + "Z"
    else:
        cioosData["datePublished"] = ""

    # Last revision / update
    updated_date = obisData.get("updated", "")
    if updated_date:
        cioosData["dateRevised"] = updated_date.split(".")[0] + "Z"
    else:
        cioosData["dateRevised"] = ""

    # Spatial extent
    cioosData["map"] = parse_extent_to_map(obisData.get("extent"))

    # Distribution - data access information
    distribution = []
    if obisData.get("archive"):
        distribution.append(
            {
                "name": addFr("Darwin Core Archive"),
                "url": obisData["archive"],
                "description": addFr(
                    "Download the complete Darwin Core Archive dataset"
                ),
            }
        )
    if obisData.get("url") and obisData.get("url") != obisData.get("archive"):
        distribution.append(
            {
                "name": addFr("IPT Resource Page"),
                "url": obisData["url"],
                "description": addFr(
                    "View dataset metadata and access options via the Integrated Publishing Toolkit"
                ),
            }
        )
    cioosData["distribution"] = distribution

    # Constant fields - all OBIS records are datasets
    cioosData["metadataScope"] = "Dataset"
    cioosData["resourceType"] = "Dataset"
    cioosData["doiCreationStatus"] = ""
    cioosData["edition"] = ""
    cioosData["filename"] = ""
    cioosData["identifier"] = ""
    cioosData["noPlatform"] = ""
    cioosData["progress"] = ""
    cioosData["recordID"] = ""
    cioosData["status"] = ""
    cioosData["userID"] = ""
    cioosData["lastEditedBy"] = {"displayName": "", "email": ""}
    cioosData["language"] = "en"

    # Additional CIOOS fields not available in OBIS
    cioosData["limitations"] = addFr("")  # Usage limitations/constraints
    cioosData["noTaxa"] = True  # OBIS metadata doesn't include taxon lists
    cioosData["noVerticalExtent"] = True  # Vertical extent not in OBIS metadata
    cioosData["verticalExtentDirection"] = ""  # e.g., "depthPositive"
    cioosData["timeFirstPublished"] = cioosData["datePublished"]  # Use same as datePublished
    cioosData["eov"] = []  # Essential Ocean Variables - can't map from OBIS
    cioosData["platforms"] = []  # Platform information not available
    cioosData["projects"] = []  # Project information not available
    cioosData["region"] = ""  # Geographic region classification

    return cioosData


if os.path.isfile("./metadata/obisFormat.json"):
    with open("./metadata/obisFormat.json", "r") as obisFormat:
        data = json.load(obisFormat)
else:
    response = requests.get(BASE_URL)
    response.raise_for_status()
    with open("./metadata/obisFormat.json", "w") as obisFormat:
        obisFormat.write(response.text)
    data = response.json()
i = 1
total = data["total"]
for result in data["results"]:
    print(f"dataset {i} of {total}\r\n")
    # print("ObisFormat")
    # pprint.pp(result)
    cioosFormat = obis2cioos(result)
    # print("CIOOS Format")
    # pprint.pp(cioosFormat)
    i += 1
    with open(f"./metadata/cioosformat/{result.get('id')}.json", "w") as cioosJSON:
        json.dump(cioosFormat, cioosJSON)
