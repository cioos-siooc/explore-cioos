const express = require("express");
const router = express.Router();
const db = require("../db");
const cache = require("../utils/cache");

/**
 * @swagger
 * /statistics:
 *   get:
 *     summary: Get database statistics for dashboard
 *     description: Returns counts and statistics for datasets, profiles, organizations, and downloads
 *     tags:
 *       - Statistics
 *     responses:
 *       200:
 *         description: Statistics data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 counts:
 *                   type: object
 *                   properties:
 *                     datasets:
 *                       type: integer
 *                     organizations:
 *                       type: integer
 *                     profiles:
 *                       type: integer
 *                     downloads:
 *                       type: integer
 *                     downloads_completed:
 *                       type: integer
 *                 datasetsByPlatform:
 *                   type: array
 *                 datasetsByOrganization:
 *                   type: array
 *                 downloadsByStatus:
 *                   type: array
 *                 topDatasetsByProfiles:
 *                   type: array
 */
router.get("/", cache.route(), async (req, res) => {
  try {
    // Get basic counts
    const [
      datasetsCount,
      organizationsCount,
      profilesCount,
      downloadsCount,
      downloadsCompletedCount,
    ] = await Promise.all([
      db("cde.datasets").count("* as count").first(),
      db("cde.organizations").count("* as count").first(),
      db("cde.profiles").count("* as count").first(),
      db("cde.download_jobs").count("* as count").first(),
      db("cde.download_jobs")
        .where("status", "complete")
        .count("* as count")
        .first(),
    ]);

    // Get datasets by platform
    const datasetsByPlatform = await db("cde.datasets")
      .select("platform")
      .count("* as count")
      .whereNotNull("platform")
      .groupBy("platform")
      .orderBy("count", "desc");

    // Get datasets by organization (using organizations_lookup table)
    const datasetsByOrganization = await db.raw(`
      SELECT ol.name, o.color, COUNT(DISTINCT d.pk) as count
      FROM cde.organizations_lookup ol
      LEFT JOIN cde.organizations o ON ol.name = o.name
      LEFT JOIN cde.datasets d ON ol.pk = ANY(d.organization_pks)
      GROUP BY ol.pk, ol.name, o.color
      ORDER BY count DESC
    `);

    // Get datasets by organization and CDM data type (for stacked bars)
    const datasetsByOrgAndType = await db.raw(`
      SELECT ol.name, d.cdm_data_type, COUNT(DISTINCT d.pk) as count
      FROM cde.organizations_lookup ol
      LEFT JOIN cde.datasets d ON ol.pk = ANY(d.organization_pks)
      WHERE d.cdm_data_type IS NOT NULL
      GROUP BY ol.name, d.cdm_data_type
      ORDER BY ol.name, d.cdm_data_type
    `);

    // Get dataset sizes (estimated based on profile count)
    // Assuming average profile size for estimation
    const datasetSizes = await db.raw(`
      SELECT
        d.title,
        d.cdm_data_type,
        COUNT(p.pk) as profile_count,
        COUNT(p.pk) * 0.001 as estimated_size_mb
      FROM cde.datasets d
      LEFT JOIN cde.profiles p ON p.dataset_pk = d.pk
      GROUP BY d.pk, d.title, d.cdm_data_type
      HAVING COUNT(p.pk) > 0
      ORDER BY COUNT(p.pk) DESC
      LIMIT 15
    `);

    // Get top 10 datasets by profile count
    const topDatasetsByProfiles = await db("cde.datasets as d")
      .leftJoin("cde.profiles as p", "p.dataset_pk", "d.pk")
      .select("d.title", "d.platform", "d.cdm_data_type")
      .count("p.pk as count")
      .groupBy("d.pk", "d.title", "d.platform", "d.cdm_data_type")
      .orderBy("count", "desc")
      .limit(10);

    // Get downloads over time (last 30 days)
    const downloadsOverTime = await db.raw(`
      SELECT
        DATE(time) as date,
        COUNT(*) as count
      FROM cde.download_jobs
      WHERE time >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(time)
      ORDER BY date ASC
    `);

    // Get profile count by dataset (for pie chart - top 10)
    const profilesByDataset = await db("cde.datasets as d")
      .leftJoin("cde.profiles as p", "p.dataset_pk", "d.pk")
      .select("d.title")
      .count("p.pk as count")
      .groupBy("d.pk", "d.title")
      .orderBy("count", "desc")
      .limit(10);

    // Get profiles grouped by organization (using organizations_lookup table)
    const profilesByOrganization = await db.raw(`
      SELECT ol.name, o.color, COUNT(p.pk) as count
      FROM cde.organizations_lookup ol
      LEFT JOIN cde.organizations o ON ol.name = o.name
      LEFT JOIN cde.datasets d ON ol.pk = ANY(d.organization_pks)
      LEFT JOIN cde.profiles p ON p.dataset_pk = d.pk
      GROUP BY ol.pk, ol.name, o.color
      ORDER BY count DESC
    `);

    // Get profiles by organization and CDM data type (for stacked bars)
    const profilesByOrgAndType = await db.raw(`
      SELECT ol.name, d.cdm_data_type, COUNT(p.pk) as count
      FROM cde.organizations_lookup ol
      LEFT JOIN cde.datasets d ON ol.pk = ANY(d.organization_pks)
      LEFT JOIN cde.profiles p ON p.dataset_pk = d.pk
      WHERE d.cdm_data_type IS NOT NULL
      GROUP BY ol.name, d.cdm_data_type
      ORDER BY ol.name, d.cdm_data_type
    `);

    // Get profiles grouped by CDM data type
    const profilesByCdmDataType = await db("cde.datasets as d")
      .leftJoin("cde.profiles as p", "p.dataset_pk", "d.pk")
      .select("d.cdm_data_type")
      .count("p.pk as count")
      .whereNotNull("d.cdm_data_type")
      .groupBy("d.cdm_data_type")
      .orderBy("count", "desc");

    const statistics = {
      counts: {
        datasets: parseInt(datasetsCount.count),
        organizations: parseInt(organizationsCount.count),
        profiles: parseInt(profilesCount.count),
        downloads: parseInt(downloadsCount.count),
        downloads_completed: parseInt(downloadsCompletedCount.count),
      },
      datasetsByPlatform: datasetsByPlatform.map((row) => ({
        platform: row.platform,
        count: parseInt(row.count),
      })),
      datasetsByOrganization: datasetsByOrganization.rows.map((row) => ({
        name: row.name,
        color: row.color,
        count: parseInt(row.count),
      })),
      datasetsByOrgAndType: datasetsByOrgAndType.rows.map((row) => ({
        organization: row.name,
        cdm_data_type: row.cdm_data_type,
        count: parseInt(row.count),
      })),
      datasetSizes: datasetSizes.rows.map((row) => ({
        title: row.title,
        cdm_data_type: row.cdm_data_type,
        profile_count: parseInt(row.profile_count),
        estimated_size_mb: parseFloat(row.estimated_size_mb),
      })),
      topDatasetsByProfiles: topDatasetsByProfiles.map((row) => ({
        title: row.title,
        platform: row.platform,
        cdm_data_type: row.cdm_data_type,
        count: parseInt(row.count),
      })),
      downloadsOverTime: downloadsOverTime.rows.map((row) => ({
        date: row.date,
        count: parseInt(row.count),
      })),
      profilesByDataset: profilesByDataset.map((row) => ({
        title: row.title,
        count: parseInt(row.count),
      })),
      profilesByOrganization: profilesByOrganization.rows.map((row) => ({
        name: row.name,
        color: row.color,
        count: parseInt(row.count),
      })),
      profilesByOrgAndType: profilesByOrgAndType.rows.map((row) => ({
        organization: row.name,
        cdm_data_type: row.cdm_data_type,
        count: parseInt(row.count),
      })),
      profilesByCdmDataType: profilesByCdmDataType.map((row) => ({
        cdm_data_type: row.cdm_data_type || "unknown",
        count: parseInt(row.count),
      })),
      lastUpdated: new Date().toISOString(),
    };

    res.json(statistics);
  } catch (error) {
    console.error("Error fetching statistics:", error);
    res.status(500).json({ error: "Failed to fetch statistics" });
  }
});

module.exports = router;
