import { describe, it, expect } from "vitest";

import {
  matchFilterOptions,
  parseFilterQuery,
  parsePartialRangeQuery,
  parseRangeQuery,
} from "./filterSearch.js";

const groups = [
  {
    key: "eovs",
    options: [
      { id: 1, label: "Sea surface temperature" },
      { id: 2, label: "Température sous la surface", state: "include" },
      { id: 3, label: "Oxygen" },
    ],
  },
  {
    key: "scientificName",
    options: [
      { id: 4, label: "Salmo salar", matchText: "Salmo salar Atlantic salmon" },
    ],
  },
];

describe("parseFilterQuery", () => {
  it("reads a leading - as an exclusion", () => {
    expect(parseFilterQuery("  - oxygen ")).toEqual({
      term: "oxygen",
      exclude: true,
    });
    expect(parseFilterQuery("oxygen")).toEqual({
      term: "oxygen",
      exclude: false,
    });
    expect(parseFilterQuery("not oxygen")).toEqual({
      term: "oxygen",
      exclude: true,
    });
    expect(parseFilterQuery("NOT  mooring")).toEqual({
      term: "mooring",
      exclude: true,
    });
    expect(parseFilterQuery("sauf oxygène")).toEqual({
      term: "oxygène",
      exclude: true,
    });
    expect(parseFilterQuery("nothing")).toEqual({
      term: "nothing",
      exclude: false,
    });
  });
});

describe("matchFilterOptions", () => {
  it("lists only the applied options when there is no term", () => {
    expect(matchFilterOptions(groups, "")).toEqual([
      { key: "eovs", options: [groups[0].options[1]] },
    ]);
  });

  it("matches across accents and case", () => {
    const [eovs] = matchFilterOptions(groups, "TEMPERATURE");
    expect(eovs.options.map((o) => o.id).sort()).toEqual([1, 2]);
  });

  it("tolerates typos, and leaves out what does not resemble the term", () => {
    expect(
      matchFilterOptions(groups, "temprature")[0].options.map((o) => o.id),
    ).toHaveLength(2);
    expect(matchFilterOptions(groups, "oxigen")[0].options).toEqual([
      groups[0].options[2],
    ]);
    expect(matchFilterOptions(groups, "chlorophyll")).toEqual([]);
  });

  it("matches on matchText when an option has one", () => {
    const result = matchFilterOptions(groups, "atlantic");
    expect(result.map((g) => g.key)).toEqual(["scientificName"]);
  });

  it("caps each group and drops empty ones", () => {
    const result = matchFilterOptions(groups, "e", 1);
    expect(result).toHaveLength(1);
    expect(result[0].options).toHaveLength(1);
  });
});

describe("parseRangeQuery", () => {
  const bounds = {
    minDate: "1900-01-01",
    maxDate: "2026-10-03",
    minDepth: 0,
    maxDepth: 12000,
  };
  const parse = (term) => parseRangeQuery(term, bounds);

  it.each([
    ["2015", "2015-01-01", "2015-12-31"],
    ["2010-2020", "2010-01-01", "2020-12-31"],
    ["2020 to 2010", "2010-01-01", "2020-12-31"],
    ["2020-01-15..2021-06-30", "2020-01-15", "2021-06-30"],
    ["2020-01-15", "2020-01-15", "2020-01-15"],
    ["since 2015", "2015-01-01", "2026-10-03"],
    [">2015", "2015-01-01", "2026-10-03"],
    ["before 2010", "1900-01-01", "2010-12-31"],
    ["avant 2010", "1900-01-01", "2010-12-31"],
    ["de 2010 à 2020", "2010-01-01", "2020-12-31"],
    ["entre 2010 et 2020", "2010-01-01", "2020-12-31"],
    ["between 2010 and 2020", "2010-01-01", "2020-12-31"],
    ["du 2010-01-01 au 2020-01-01", "2010-01-01", "2020-01-01"],
    ["apres 2015", "2015-01-01", "2026-10-03"],
    ["jusqu’à 2010", "1900-01-01", "2010-12-31"],
    ["from 2022 to 2025", "2022-01-01", "2025-12-31"],
    ["from 2022 until 2025", "2022-01-01", "2025-12-31"],
    ["since 2023 until 2024", "2023-01-01", "2024-12-31"],
    ["after 2023 to 2024", "2023-01-01", "2024-12-31"],
    ["starting from 2023 through 2024", "2023-01-01", "2024-12-31"],
    ["depuis 2023 jusqu'à 2024", "2023-01-01", "2024-12-31"],
    ["From 2022  Until  2025", "2022-01-01", "2025-12-31"],
    ["from 2010 through 2020", "2010-01-01", "2020-12-31"],
    ["between 2010 - 2020", "2010-01-01", "2020-12-31"],
    ["from 2010", "2010-01-01", "2026-10-03"],
    ["from 2010 to now", "2010-01-01", "2026-10-03"],
    ["de 2010 à aujourd'hui", "2010-01-01", "2026-10-03"],
    ["to 2020", "1900-01-01", "2020-12-31"],
    ["up to 2020", "1900-01-01", "2020-12-31"],
    ["since 2015-06", "2015-06-01", "2026-10-03"],
    ["2020-02", "2020-02-01", "2020-02-29"],
    ["from 2020-05 to 2021-02", "2020-05-01", "2021-02-28"],
    ["2020/05/01 - 2021/01/01", "2020-05-01", "2021-01-01"],
    ["in 2015", "2015-01-01", "2015-12-31"],
    ["1850-2030", "1900-01-01", "2026-10-03"],
  ])("reads %s as a time range", (term, start, end) => {
    expect(parse(term)).toEqual({ key: "time", start, end });
  });

  it.each([
    ["0-100m", 0, 100],
    ["200 - 50 m", 50, 200],
    ["depth 10-20", 10, 20],
    ["100m", 0, 100],
    ["<200m", 0, 200],
    [">1000 m", 1000, 12000],
    ["0-20000m", 0, 12000],
    ["profondeur 0 à 200", 0, 200],
    ["moins de 200 m", 0, 200],
    ["plus de 1000 m", 1000, 12000],
    ["less than 50m", 0, 50],
    ["above 200m", 0, 200],
    ["below 200 m", 200, 12000],
    ["shallower than 30m", 0, 30],
    ["deeper than 500m", 500, 12000],
    ["depth below 1000", 1000, 12000],
    ["au-dessus de 200 m", 0, 200],
    ["en dessous de 200 m", 200, 12000],
    ["sous 200 m", 200, 12000],
    ["plus profond que 500 m", 500, 12000],
  ])("reads %s as a depth range", (term, start, end) => {
    expect(parse(term)).toEqual({ key: "depth", start, end });
  });

  it.each([
    "oxygen",
    "real-time",
    "12",
    "2010-2020x",
    "",
    "2020-13",
    "2021-02-30",
  ])("reads %s as neither", (term) => {
    expect(parse(term)).toBeUndefined();
  });
});

describe("parseRangeQuery, counted back from today", () => {
  const bounds = {
    minDate: "1900-01-01",
    maxDate: "2026-10-03",
    minDepth: 0,
    maxDepth: 12000,
  };
  const parse = (term) => parseRangeQuery(term, bounds);

  it.each([
    ["today", "2026-10-03", "2026-10-03"],
    ["yesterday", "2026-10-02", "2026-10-02"],
    ["last week", "2026-09-26", "2026-10-03"],
    ["last month", "2026-09-03", "2026-10-03"],
    ["last year", "2025-10-03", "2026-10-03"],
    ["last 3 months", "2026-07-03", "2026-10-03"],
    ["past 10 days", "2026-09-23", "2026-10-03"],
    ["3 weeks", "2026-09-12", "2026-10-03"],
    ["2 years ago", "2024-10-03", "2026-10-03"],
    ["in the last 6 months", "2026-04-03", "2026-10-03"],
    ["30d", "2026-09-03", "2026-10-03"],
    ["6mo", "2026-04-03", "2026-10-03"],
    ["since 3 months ago", "2026-07-03", "2026-10-03"],
    ["from last year to last month", "2025-10-03", "2026-09-03"],
    ["2020 to yesterday", "2020-01-01", "2026-10-02"],
    ["aujourd'hui", "2026-10-03", "2026-10-03"],
    ["la semaine dernière", "2026-09-26", "2026-10-03"],
    ["le mois dernier", "2026-09-03", "2026-10-03"],
    ["l'année dernière", "2025-10-03", "2026-10-03"],
    ["les 3 derniers mois", "2026-07-03", "2026-10-03"],
    ["depuis 2 ans", "2024-10-03", "2026-10-03"],
    ["il y a 6 mois", "2026-04-03", "2026-10-03"],
    ["de 2020 à aujourd'hui", "2020-01-01", "2026-10-03"],
  ])("reads %s", (term, start, end) => {
    expect(parse(term)).toEqual({ key: "time", start, end });
  });

  it("lands a month back from the 31st on the shorter month's last day", () => {
    expect(
      parseRangeQuery("last month", { ...bounds, maxDate: "2026-03-31" }),
    ).toEqual({ key: "time", start: "2026-02-28", end: "2026-03-31" });
  });

  it.each(["week", "year", "last", "d", "last 3"])(
    "reads %s as neither",
    (term) => {
      expect(parse(term)).toBeUndefined();
    },
  );
});

describe("parsePartialRangeQuery", () => {
  const bounds = {
    minDate: "1900-01-01",
    maxDate: "2026-10-03",
    minDepth: 0,
    maxDepth: 12000,
  };
  const parse = (term) => parsePartialRangeQuery(term, bounds);

  // Each step of typing "from 2022 to 2025", and of "2010-2020".
  it.each([
    ["from 2022", "2022-01-01", "2026-10-03"],
    ["from 2022 t", "2022-01-01", "2026-10-03"],
    ["from 2022 to", "2022-01-01", "2026-10-03"],
    ["from 2022 to 202", "2022-01-01", "2026-10-03"],
    ["from 2022 to 2025", "2022-01-01", "2025-12-31"],
    ["from 2022 unt", "2022-01-01", "2026-10-03"],
    ["since 2023 until 20", "2023-01-01", "2026-10-03"],
    ["last 3 mon", "2026-07-03", "2026-10-03"],
    ["la semaine der", "2026-09-26", "2026-10-03"],
    ["between 2010", "2010-01-01", "2026-10-03"],
    ["between 2010 and 20", "2010-01-01", "2026-10-03"],
    ["2010-", "2010-01-01", "2010-12-31"],
    ["2010-2", "2010-01-01", "2010-12-31"],
    ["2010-202", "2010-01-01", "2010-12-31"],
    ["2010-2020", "2010-01-01", "2020-12-31"],
    ["2010-02", "2010-02-01", "2010-02-28"],
    ["since 2015-0", "2015-01-01", "2026-10-03"],
  ])("reads %s, still being typed, as a time range", (term, start, end) => {
    expect(parse(term)).toEqual({ key: "time", start, end });
  });

  it.each(["from 202", "since 20", "2015 argo", "argo 2015", "0-20", "oxygen"])(
    "reads %s as neither",
    (term) => {
      expect(parse(term)).toBeUndefined();
    },
  );
});
