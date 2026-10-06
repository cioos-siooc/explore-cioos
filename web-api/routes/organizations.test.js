const test = require("node:test");
const assert = require("node:assert/strict");

const { createTestApp } = require("../test/testApp");

const { agent, db } = createTestApp();

test.beforeEach(() => db.reset());

test("GET /organizations overwrites pk with pk_url on every row", async () => {
  db.queueRows([
    { pk: 1, pk_url: "cioos-atlantic", name: "CIOOS Atlantic" },
    { pk: 2, pk_url: "cioos-pacific", name: "CIOOS Pacific" },
  ]);

  const res = await agent.get("/organizations");

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, [
    { pk: "cioos-atlantic", pk_url: "cioos-atlantic", name: "CIOOS Atlantic" },
    { pk: "cioos-pacific", pk_url: "cioos-pacific", name: "CIOOS Pacific" },
  ]);
  assert.match(db.queries[0], /select .* from "cde"\."organizations"/i);
});

test("GET /organizations/roles returns the role codes", async () => {
  db.queueRaw([{ role: "custodian" }, { role: "owner" }]);

  const res = await agent.get("/organizations/roles");

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, ["custodian", "owner"]);
  assert.match(db.queries[0], /unnest\(organization_role_keys\)/);
});
