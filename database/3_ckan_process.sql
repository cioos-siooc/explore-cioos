/*

    ckan_process()

    - drops the catalogue records a harvested dataset now cites
    - updates datasets with data from CKAN
    - rewrites the organization table

*/

CREATE OR REPLACE FUNCTION ckan_process() RETURNS VOID AS $$
BEGIN

-- A catalogue record is shown through the ERDDAP/OBIS dataset citing it. The
-- catalogue harvest skips cited records, but the citing load may land after it.
DELETE FROM cde.datasets c
WHERE c.source_type = 'ckan'
  AND EXISTS (SELECT 1 FROM cde.datasets d
              WHERE d.ckan_id = c.ckan_id
                AND d.source_type IS DISTINCT FROM 'ckan');

insert into cde.organizations (name)
select distinct unnest(organizations) from cde.datasets ON CONFLICT DO NOTHING;

-- Ensure organizations_lookup is populated before setting pk_url
INSERT INTO cde.organizations_lookup (name)
SELECT name FROM cde.organizations ON CONFLICT DO NOTHING;

-- IS DISTINCT FROM guards keep loads from rewriting every unchanged row.
UPDATE cde.organizations
SET pk_url=organizations_lookup.pk
FROM cde.organizations_lookup
WHERE organizations_lookup.name=organizations.name
  AND organizations.pk_url IS DISTINCT FROM organizations_lookup.pk;

UPDATE cde.datasets d
SET organization_pks = sub.pks
FROM (
    -- ORDER BY makes the array deterministic so the IS DISTINCT FROM guard
    -- below can't see a mere reordering as a change.
    SELECT d.pk, array_agg(o.pk_url ORDER BY o.pk_url) AS pks
    FROM cde.datasets d
    JOIN cde.organizations o ON o.name = ANY(d.organizations)
    GROUP BY d.pk
) sub
WHERE d.pk = sub.pk
  AND d.organization_pks IS DISTINCT FROM sub.pks;


  END;
$$ LANGUAGE plpgsql;
