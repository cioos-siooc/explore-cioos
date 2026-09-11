const test = require("node:test");
const assert = require("node:assert/strict");

const { createTestApp } = require("../test/testApp");

const { agent, db, resetCache } = createTestApp();

test.beforeEach(() => {
  db.reset();
  resetCache();
});

test("a bare GET (no q, no names) searches with an empty prefix and the default limit", async () => {
  db.queueRaw([
    { scientificName: "Orcinus orca", vernacular: null, rank: "Species" },
  ]);

  const res = await agent.get("/scientificNames");

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, [
    { scientificName: "Orcinus orca", vernacular: null, rank: "Species" },
  ]);
  assert.match(db.queries[0], /LIMIT 200/);
});

test("q searches by scientific-name prefix or vernacular substring", async () => {
  db.queueRaw([
    {
      scientificName: "Orcinus orca",
      vernacular: "Killer whale",
      rank: "Species",
    },
  ]);

  const res = await agent.get("/scientificNames").query({ q: "orca" });

  assert.equal(res.status, 200);
  assert.equal(res.body[0].scientificName, "Orcinus orca");
});

test("names= hydrates an exact list and skips the search branch entirely", async () => {
  db.queueRaw([
    {
      scientificName: "Orcinus orca",
      vernacular: "Killer whale",
      rank: "Species",
    },
    {
      scientificName: "Gadus morhua",
      vernacular: "Atlantic cod",
      rank: "Species",
    },
  ]);

  const res = await agent
    .get("/scientificNames")
    .query({ names: "Orcinus orca,Gadus morhua" });

  assert.equal(res.status, 200);
  assert.equal(res.body.length, 2);
  assert.match(db.queries[0], /= ANY\(/);
});

test("names= with only commas/whitespace short-circuits to [] without querying", async () => {
  const res = await agent.get("/scientificNames").query({ names: " , , " });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
  assert.equal(db.queries.length, 0);
});

test("lang selects the vernacular column, defaulting to English", async () => {
  db.queueRaw([
    { scientificName: "Orcinus orca", vernacular: "Épaulard", rank: "Species" },
  ]);

  const res = await agent
    .get("/scientificNames")
    .query({ q: "orca", lang: "fr" });

  assert.equal(res.status, 200);
  assert.match(db.queries[0], /vernaculars_fr/);
});

test("rejects a q with disallowed characters", async () => {
  const res = await agent.get("/scientificNames").query({ q: "orca<script>" });
  assert.equal(res.status, 400);
  assert.ok(res.body.errors);
  assert.equal(db.queries.length, 0);
});

test("rejects an out-of-range limit", async () => {
  const res = await agent.get("/scientificNames").query({ limit: "5000" });
  assert.equal(res.status, 400);
});

test("rejects a lang outside en/fr", async () => {
  const res = await agent.get("/scientificNames").query({ lang: "de" });
  assert.equal(res.status, 400);
});
