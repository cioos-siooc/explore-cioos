const express = require("express");
const { check } = require("express-validator");

const router = express.Router();
const db = require("../db");
const cache = require("../utils/cache");
const { errorHandler } = require("../utils/validatorMiddlewares");

/**
 * @swagger
 * /scientificNames:
 *   get:
 *     summary: Typeahead lookup of OBIS scientific names with vernacular subtitles
 *     tags: [ScientificNames]
 *     description: |
 *       Returns OBIS scientific names matched by either a scientific-name prefix or a
 *       vernacular (common) name substring. Each result includes the locale-appropriate
 *       vernacular when WoRMS has one cached locally. Pass `names=A,B,C` (without `q`) to
 *       hydrate vernaculars for an exact list of scientific names — used by the frontend
 *       on page load to restore filter chips.
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Match against scientific name (prefix) or vernacular name (substring), case-insensitive.
 *       - in: query
 *         name: lang
 *         schema: { type: string, enum: [en, fr] }
 *         description: Vernacular language to search and return. Defaults to en.
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 500, default: 200 }
 *       - in: query
 *         name: names
 *         schema: { type: string }
 *         description: Comma-separated scientific names to look up exactly (overrides q).
 *     responses:
 *       200:
 *         description: Array of {scientificName, vernacular} objects. `vernacular` may be null.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   scientificName: { type: string }
 *                   vernacular: { type: string, nullable: true }
 */
router.get(
  "/",
  check("q")
    .matches(/^[\p{L}\p{N} .,'()\-]*$/u)
    .isLength({ max: 200 })
    .optional(),
  check("limit").isInt({ min: 1, max: 500 }).optional(),
  check("lang").isIn(["en", "fr"]).optional(),
  check("names")
    .matches(/^[\p{L}\p{N} .,'()\-]*(,[\p{L}\p{N} .,'()\-]*)*$/u)
    .isLength({ max: 4000 })
    .optional(),
  errorHandler,
  cache.route(),
  async (req, res) => {
    const q = (req.query.q || "").trim();
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
    const lang = req.query.lang === "fr" ? "fr" : "en";
    const vernCol = lang === "fr" ? "vernaculars_fr" : "vernaculars_en";

    const namesParam = (req.query.names || "").trim();
    if (namesParam) {
      const names = namesParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (names.length === 0) {
        return res.json([]);
      }
      const lookupSql = `
        SELECT n.scientific_name AS "scientificName",
               v.${vernCol}[1] AS vernacular
          FROM cde.obis_scientific_names n
     LEFT JOIN cde.scientific_name_vernaculars v
            ON v.scientific_name = n.scientific_name
         WHERE n.scientific_name = ANY(:names)
        ORDER BY n.scientific_name`;
      const { rows: lookupRows } = await db.raw(lookupSql, { names });
      return res.json(lookupRows);
    }

    // When the user query matches a vernacular, surface the matched vernacular
    // as the subtitle so the result reads coherently (e.g. typing "killer"
    // returns "Orcinus orca" with subtitle "killer whale" instead of the
    // alphabetically-first WoRMS entry "grampus"). When no query is given, or
    // only the scientific name matched, fall back to the first vernacular.
    const sql = `
      SELECT n.scientific_name AS "scientificName",
             COALESCE(
               (SELECT vn FROM unnest(v.${vernCol}) AS vn
                 WHERE :q <> '' AND vn ILIKE :sub
                 LIMIT 1),
               v.${vernCol}[1]
             ) AS vernacular
        FROM cde.obis_scientific_names n
   LEFT JOIN cde.scientific_name_vernaculars v
          ON v.scientific_name = n.scientific_name
       WHERE :q = ''
          OR n.scientific_name ILIKE :prefix
          OR EXISTS (
               SELECT 1 FROM unnest(v.${vernCol}) AS vn
                WHERE vn ILIKE :sub
             )
    ORDER BY (n.scientific_name ILIKE :prefix) DESC,
             n.scientific_name
       LIMIT :limit`;

    const { rows } = await db.raw(sql, {
      q,
      prefix: `${q}%`,
      sub: `%${q}%`,
      limit,
    });
    return res.json(rows);
  },
);

module.exports = router;
