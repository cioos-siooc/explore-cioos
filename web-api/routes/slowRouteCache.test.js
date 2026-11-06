const test = require("node:test");
const assert = require("node:assert/strict");

const { createTestApp } = require("../test/testApp");

const expiries = [];
const redisClient = {
  isReady: true,
  hSet: async () => 1,
  hGetAll: async () => ({}),
  expire: async (key, seconds) => (expiries.push([key, seconds]), 1),
  del: async () => 1,
};

const { agent, db, resetCache } = createTestApp({ redisClient });

test.beforeEach(() => {
  db.reset();
  resetCache();
  expiries.length = 0;
});

const DAY_S = 24 * 60 * 60;

async function cachedForSeconds(path) {
  // apicache stores after the response has gone out.
  await new Promise((resolve) => setImmediate(resolve));
  return expiries.find(([key]) => key === path)?.[1];
}

test("the legend stays cached for a week, until the next harvest flush", async () => {
  db.queueRaw([{ zoom0: [1, 2, 2], zoom1: [1, 2, 2], zoom2: [1, 2, 2] }]);
  db.queueRaw([{ zoom1: [1, 2, 2] }]);

  const res = await agent.get("/legend?metric=days");

  assert.equal(res.status, 200);
  assert.equal(await cachedForSeconds("/legend?metric=days"), 7 * DAY_S);
});

test("the coverage histogram stays cached for a week", async () => {
  db.queueRaw([{ min: null, max: null }]);
  db.queueRaw([]);
  const path = "/coverageHistogram?groupBy=source&count=days&view=timeline&";

  const res = await agent.get(path);

  assert.equal(res.status, 200);
  assert.equal(await cachedForSeconds(path), 7 * DAY_S);
});

test("other routes keep the one-day default", async () => {
  db.queueRaw([{ platform: "mooring" }]);

  const res = await agent.get("/platforms");

  assert.equal(res.status, 200);
  assert.equal(await cachedForSeconds("/platforms"), DAY_S);
});
