const express = require('express')
const router = express.Router()
const db = require('../db')

// Query to get harvest results with dataset info and any errors
const query = `
  SELECT
    d.dataset_id,
    d.erddap_url,
    d.title,
    d.cdm_data_type,
    d.platform,
    d.n_profiles,
    d.organizations,
    NULL::timestamp as harvest_time,
    'success'::text as status,
    NULL::text as error_message
  FROM cde.datasets d
  WHERE d.dataset_id IS NOT NULL

  UNION ALL

  SELECT
    s.dataset_id,
    s.erddap_url,
    NULL::text as title,
    NULL::text as cdm_data_type,
    NULL::text as platform,
    NULL::integer as n_profiles,
    NULL::text[] as organizations,
    NULL::timestamp as harvest_time,
    'failed'::text as status,
    s.reason_code as error_message
  FROM cde.skipped_datasets s
  WHERE s.dataset_id IS NOT NULL

  ORDER BY dataset_id, erddap_url
`

router.get('/', async (req, res, next) => {
  try {
    const result = await db.raw(query)
    res.json(result.rows)
  } catch (err) {
    next(err)
  }
})

module.exports = router
