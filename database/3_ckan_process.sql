/* 

    ckan_process()
    
    - updates datasets with data from CKAN
    - rewrites the organization table

*/

CREATE OR REPLACE FUNCTION ckan_process() RETURNS VOID AS $$
BEGIN


insert into cde.organizations (name)
select distinct unnest(organizations) from cde.datasets ON CONFLICT DO NOTHING;

-- Ensure organizations_lookup is populated before setting pk_url
INSERT INTO cde.organizations_lookup (name)
SELECT name FROM cde.organizations ON CONFLICT DO NOTHING;

-- IS DISTINCT FROM guards: only write rows whose value actually changed —
-- unguarded, these rewrote every organizations/datasets row on every load.
UPDATE cde.organizations
SET pk_url=organizations_lookup.pk
FROM cde.organizations_lookup
WHERE organizations_lookup.name=organizations.name
  AND organizations.pk_url IS DISTINCT FROM organizations_lookup.pk;

-- convert organization list of names into list of pks
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
