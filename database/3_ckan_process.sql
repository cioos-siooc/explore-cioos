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

-- "role:Organization name" -> "<pk_url>:role". Every dataset gets a row (LEFT
-- JOINs), so one that lost all its roles is reset to '{}' rather than kept.
UPDATE cde.datasets d
SET organization_role_keys = sub.keys
FROM (
    SELECT d.pk,
           coalesce(
             array_agg(DISTINCT o.pk_url || ':' || split_part(r, ':', 1)
                       ORDER BY o.pk_url || ':' || split_part(r, ':', 1))
               FILTER (WHERE o.pk_url IS NOT NULL),
             '{}'
           ) AS keys
    FROM cde.datasets d
    LEFT JOIN LATERAL unnest(d.organization_roles) r ON TRUE
    LEFT JOIN cde.organizations o ON o.name = substr(r, strpos(r, ':') + 1)
    GROUP BY d.pk
) sub
WHERE d.pk = sub.pk
  AND d.organization_role_keys IS DISTINCT FROM sub.keys;


  END;
$$ LANGUAGE plpgsql;
