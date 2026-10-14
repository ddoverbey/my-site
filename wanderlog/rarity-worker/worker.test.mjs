import assert from 'node:assert/strict';
import { createWorker, coordinateGrid } from './worker.mjs';

let checks = 0;
async function check(name, action) {
  await action();
  checks++;
  console.log(`PASS ${name}`);
}
const entries = new Map();
const puts = [];
let calls = 0;
const env = {
  ALLOWED_ORIGINS: 'https://devonoverbey.com',
  RARITY_RATE_LIMITER: { limit: async () => ({ success: true }) },
  RARITY_CACHE: {
    get: async key => entries.has(key) ? JSON.parse(entries.get(key)) : null,
    put: async (...args) => { puts.push(args); entries.set(args[0], args[1]); }
  }
};
const request = (query = 'lat=45.728&lng=-121.636', options = {}) => new Request(`https://api.devonoverbey.com/rarity?${query}`, {
  headers: { Origin: 'https://devonoverbey.com', 'CF-Connecting-IP': '192.0.2.1', ...options.headers }, ...options
});
const worker = createWorker(async url => {
  calls++;
  assert.equal(url, 'https://overpass-api.de/api/interpreter');
  return new Response(JSON.stringify({
    elements: [{ type: 'node', id: 1, tags: { tourism: 'viewpoint' } }],
    osm3s: { timestamp_osm_base: '2026-10-01T00:00:00Z' }
  }));
});
await check('500 m grid stays valid at all latitudes and wraps the antimeridian consistently', () => {
  for (const lat of [-90, -80, 0, 45, 80, 90]) {
    const grid = coordinateGrid(lat, 180);
    assert.ok(Math.abs(grid.matchedLat) <= 90 && Math.abs(grid.matchedLng) <= 180);
    assert.equal(grid.key, coordinateGrid(lat, -180).key);
    assert.ok(Math.abs(grid.matchedLat - lat) * 111.195 <= 0.251);
  }
  assert.throws(() => coordinateGrid(91, 0));
});
await check('open-data miss returns the complete contract without invented reviews and caches permanently', async () => {
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://devonoverbey.com');
  const data = await response.json();
  assert.equal(data.reviewCount, null);
  assert.equal(data.popularityScore, 1);
  assert.equal(data.rarityTier, 'Uncharted');
  assert.equal(data.source, 'OpenStreetMap contributors (ODbL)');
  assert.equal(data.cached, false);
  assert.equal(data.osmDataTimestamp, '2026-10-01T00:00:00Z');
  assert.equal(puts.length, 1);
  assert.equal(puts[0].length, 2);
  assert.equal(calls, 1);
});
await check('cache hits bypass Overpass and retain the original sampled match', async () => {
  const response = await worker.fetch(request(), env);
  const data = await response.json();
  assert.equal(data.cached, true);
  assert.equal(data.matchedLat, coordinateGrid(45.728, -121.636).matchedLat);
  assert.equal(calls, 1);
});
await check('corrupt KV records fail explicitly rather than returning incorrect permanent matches', async () => {
  const grid = coordinateGrid(10, 10);
  entries.set(grid.key, JSON.stringify({ reviewCount: 30, source: 'Non-OSM provider' }));
  assert.equal((await worker.fetch(request('lat=10&lng=10'), env)).status, 503);
  entries.delete(grid.key);
  assert.equal(calls, 1);
});
await check('invalid coordinates, methods, origins, and preflights cannot reach upstream', async () => {
  for (const query of ['lat=&lng=0', 'lng=0', 'lat=91&lng=0', 'lat=1&lng=2&lat=3', 'lat=NaN&lng=0', 'lat=1&lng=2&url=https://bad.test']) {
    assert.equal((await worker.fetch(request(query), env)).status, 400);
  }
  assert.equal((await worker.fetch(request(undefined, { method: 'POST' }), env)).status, 405);
  assert.equal((await worker.fetch(request(undefined, { headers: { Origin: 'https://bad.test' } }), env)).status, 403);
  const preflight = await worker.fetch(request(undefined, { method: 'OPTIONS', headers: {
    Origin: 'https://devonoverbey.com', 'Access-Control-Request-Method': 'GET'
  } }), env);
  assert.equal(preflight.status, 200);
  assert.equal(calls, 1);
});
await check('missing bindings and rate limits fail explicitly, including cache hits', async () => {
  assert.equal((await worker.fetch(request(), { ALLOWED_ORIGINS: env.ALLOWED_ORIGINS })).status, 503);
  const response = await worker.fetch(request(), {
    ...env, RARITY_RATE_LIMITER: { limit: async () => ({ success: false }) }
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '60');
  assert.equal(calls, 1);
});
await check('upstream errors or partial data do not become permanently cached empty results', async () => {
  const size = entries.size;
  for (const fetcher of [
    async () => new Response('unavailable', { status: 504 }),
    async () => new Response(JSON.stringify({ remark: 'runtime error', elements: [] })),
    async () => new Response(JSON.stringify({ unexpected: [] }))
  ]) {
    const failure = await createWorker(fetcher).fetch(request('lat=1&lng=2'), env);
    assert.equal(failure.status, 503);
    assert.equal(entries.size, size);
  }
});
await check('concurrent same-isolate misses share one upstream request', async () => {
  let release;
  let started = 0;
  const concurrent = createWorker(async () => {
    started++;
    await new Promise(resolve => { release = resolve; });
    return new Response(JSON.stringify({ elements: [] }));
  });
  const a = concurrent.fetch(request('lat=20&lng=30'), env);
  const b = concurrent.fetch(request('lat=20&lng=30'), env);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(started, 1);
  release();
  assert.equal((await a).status, 200);
  assert.equal((await b).status, 200);
});
console.log(`${checks} rarity Worker checks passed.`);
