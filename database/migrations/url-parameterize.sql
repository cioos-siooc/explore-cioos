
ALTER TABLE cde.datasets ADD COLUMN pk_url INTEGER;
ALTER TABLE cde.organizations ADD COLUMN pk_url INTEGER;

DROP TABLE IF EXISTS cde.organizations_lookup;
CREATE TABLE cde.organizations_lookup (
    pk SERIAL PRIMARY KEY,
    name TEXT UNIQUE
);

DROP TABLE IF EXISTS cde.datasets_lookup;
CREATE TABLE cde.datasets_lookup (
    pk serial PRIMARY KEY,
    dataset_id TEXT,
    erddap_url TEXT,
    UNIQUE(dataset_id, erddap_url)
);

-- insert any new names. changed/deleted datasets will always be in here
INSERT INTO cde.organizations_lookup (name) select name from cde.organizations ON CONFLICT DO NOTHING;
INSERT INTO cde.datasets_lookup (erddap_url,dataset_id) select erddap_url,dataset_id from cde.datasets ON CONFLICT DO NOTHING;

UPDATE cde.organizations
SET pk_url=organizations_lookup.pk
FROM cde.organizations_lookup
WHERE organizations_lookup.name=organizations.name;

UPDATE cde.datasets
SET pk_url=datasets_lookup.pk
FROM cde.datasets_lookup
WHERE datasets_lookup.erddap_url=datasets.erddap_url AND
datasets_lookup.dataset_id = datasets.dataset_id;



