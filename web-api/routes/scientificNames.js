const express = require("express");
const { check } = require("express-validator");

const router = express.Router();
const db = require("../db");
const { pipeline } = require("../utils/routePipeline");
const { MAX_EXPANDED_APHIA_IDS } = require("../utils/dbFilter");

// WoRMS ranks, broadest first. Ancestor counts can't stand in: lineages differ
// in depth, so a sponge species sits fewer steps from the root than a crab
// infraorder.
const RANK_ORDER = [
  "Superdomain",
  "Kingdom",
  "Subkingdom",
  "Infrakingdom",
  "Phylum",
  "Phylum (Division)",
  "Subphylum",
  "Subphylum (Subdivision)",
  "Infraphylum",
  "Parvphylum",
  "Gigaclass",
  "Megaclass",
  "Superclass",
  "Class",
  "Subclass",
  "Infraclass",
  "Subterclass",
  "Superorder",
  "Order",
  "Suborder",
  "Infraorder",
  "Parvorder",
  "Superfamily",
  "Epifamily",
  "Family",
  "Subfamily",
  "Tribe",
  "Subtribe",
  "Genus",
  "Subgenus",
  "Species",
  "Subspecies",
  "Variety",
  "Forma",
];
const RANK_ORDER_SQL = `ARRAY[${RANK_ORDER.map((r) => `'${r}'`).join(", ")}]`;

/**
 * @swagger
 * /scientificNames:
 *   get:
 *     summary: Typeahead lookup of OBIS scientific names with vernacular subtitles
 *     tags: [ScientificNames]
 *     description: |
 *       Returns OBIS scientific names matched by either a scientific-name prefix or a
 *       vernacular (common) name substring. Vernacular matches come first, nested
 *       under their highest vernacular-matched ancestor. Each result includes the locale-appropriate
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
 *         description: Array of {scientificName, vernacular, rank, tooBroad} objects. `vernacular` and `rank` may be null; `tooBroad` is only set on searches.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   scientificName: { type: string }
 *                   vernacular: { type: string, nullable: true }
 *                   rank: { type: string, nullable: true, description: "WoRMS taxonomic rank (e.g. Species, Genus). Selecting a higher-rank entry rolls down to descendants." }
 *                   tooBroad: { type: boolean, description: "Selecting this name would roll down to more taxa than the filter accepts (400)." }
 */
router.get(
  "/",
  ...pipeline({
    filters: false,
    checks: [
      check("q")
        .matches(/^[\p{L}\p{N} .,'()-]*$/u)
        .isLength({ max: 200 })
        .optional(),
      check("limit").isInt({ min: 1, max: 500 }).optional(),
      check("lang").isIn(["en", "fr"]).optional(),
      check("names")
        .matches(/^[\p{L}\p{N} .,'()-]*(,[\p{L}\p{N} .,'()-]*)*$/u)
        .isLength({ max: 4000 })
        .optional(),
    ],
  }),
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
               v.${vernCol}[1] AS vernacular,
               v.rank          AS rank
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
    //
    // Common-name hits come first, as a tree: each sits under its highest
    // common-name-matched ancestor ("crab" lists Brachyura "crabs", then
    // Cancridae, Cancer, Cancer borealis…). Higher ranks lead, both between
    // groups and among siblings — each path step is keyed by its rank, then
    // its name. Scientific-name-only hits follow.
    //
    // tooBroad is counted on the returned page only, and stops at the cap.
    const sql = `
      WITH hits AS (
        SELECT n.scientific_name,
               v.rank,
               v.aphia_id,
               v.ancestor_aphia_ids,
               v.${vernCol}[1] AS first_vernacular,
               (SELECT vn FROM unnest(v.${vernCol}) AS vn
                 WHERE :q <> '' AND vn ILIKE :sub
                 LIMIT 1) AS matched
          FROM cde.obis_scientific_names n
     LEFT JOIN cde.scientific_name_vernaculars v
            ON v.scientific_name = n.scientific_name
         WHERE :q = ''
            OR n.scientific_name ILIKE :prefix
            OR EXISTS (
                 SELECT 1 FROM unnest(v.${vernCol}) AS vn
                  WHERE vn ILIKE :sub
               )
      ),
      placed AS (
        SELECT h.*,
               CASE WHEN h.matched IS NOT NULL THEN ARRAY(
                 SELECT lpad(
                          COALESCE(array_position(${RANK_ORDER_SQL}, a.rank), 99)::text,
                          2, '0'
                        ) || a.scientific_name
                   FROM hits a
                  WHERE a.matched IS NOT NULL
                    AND (a.aphia_id = ANY(h.ancestor_aphia_ids)
                         OR a.scientific_name = h.scientific_name)
                  ORDER BY cardinality(a.ancestor_aphia_ids)
               ) END AS path
          FROM hits h
      ),
      page AS (
        SELECT p.*,
               row_number() OVER (
                 ORDER BY (p.matched IS NULL),
                          p.path,
                          (p.scientific_name ILIKE :prefix) DESC,
                          p.scientific_name
               ) AS ord
          FROM placed p
      ORDER BY ord
         LIMIT :limit
      )
      SELECT scientific_name AS "scientificName",
             COALESCE(matched, first_vernacular) AS vernacular,
             rank,
             (SELECT count(*) FROM (
                SELECT DISTINCT d.aphia_id
                  FROM cde.scientific_name_vernaculars d
                 WHERE d.ancestor_aphia_ids @> ARRAY[page.aphia_id]
                   AND d.aphia_id <> page.aphia_id
                 LIMIT :cap
              ) descendants) >= :cap AS "tooBroad"
        FROM page
    ORDER BY ord`;

    const { rows } = await db.raw(sql, {
      q,
      prefix: `${q}%`,
      sub: `%${q}%`,
      limit,
      cap: MAX_EXPANDED_APHIA_IDS,
    });
    return res.json(rows);
  },
);

module.exports = router;
