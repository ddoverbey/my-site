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
await check('Google Places review counts classify at exact thresholds and cache the combined highway result', async () => {
  const googleEntries = new Map();
  const googleRequests = [];
  const googleGrid = coordinateGrid(35, -120);
  const googleWorker = createWorker(async (url, options) => {
    googleRequests.push({ url, options });
    if (url === 'https://places.googleapis.com/v1/places:searchText') {
      assert.equal(options.headers['X-Goog-Api-Key'], 'test-google-key');
      assert.equal(options.headers['X-Goog-FieldMask'],
        'places.displayName,places.userRatingCount,places.location');
      const body = JSON.parse(options.body);
      assert.equal(body.locationBias.circle.radius, 500);
      return new Response(JSON.stringify({ places: [{
        displayName: { text: 'Review-Rich Place' }, userRatingCount: 10000,
        location: { latitude: googleGrid.matchedLat, longitude: googleGrid.matchedLng }
      }] }));
    }
    assert.equal(url, 'https://overpass-api.de/api/interpreter');
    const query = new URLSearchParams(options.body).get('data');
    assert.match(query, /way\(around:50000,/);
    return new Response(JSON.stringify({
      elements: [{ type: 'way', id: 7, tags: { highway: 'trunk' },
        center: { lat: googleGrid.matchedLat + 0.01, lon: googleGrid.matchedLng } }]
    }));
  });
  const googleEnv = {
    ...env,
    GOOGLE_PLACES_API_KEY: 'test-google-key',
    RARITY_CACHE: {
      get: async key => googleEntries.has(key) ? JSON.parse(googleEntries.get(key)) : null,
      put: async (key, value) => googleEntries.set(key, value)
    }
  };
  const response = await googleWorker.fetch(request('lat=35&lng=-120'), googleEnv);
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.placeName, 'Review-Rich Place');
  assert.equal(result.reviewCount, 10000);
  assert.equal(result.rarityTier, 'Tourist Trap');
  assert.ok(result.nearestHighwayKm > 0);
  assert.equal(googleRequests.length, 2);
  const cached = await googleWorker.fetch(request('lat=35&lng=-120'), googleEnv);
  assert.equal((await cached.json()).cached, true);
  assert.equal(googleRequests.length, 2);
});
await check('named Google searches require a close name match and cache each place separately', async () => {
  const namedEntries = new Map();
  const googleQueries = [];
  const matchedGrid = coordinateGrid(41.89, 12.49);
  const namedWorker = createWorker(async (url, options) => {
    if (url === 'https://places.googleapis.com/v1/places:searchText') {
      const body = JSON.parse(options.body);
      googleQueries.push(body.textQuery);
      const exactPlace = {
        displayName: { text: 'Spirit Falls' }, userRatingCount: 150,
        location: { latitude: matchedGrid.matchedLat + 0.002, longitude: matchedGrid.matchedLng }
      };
      const trailhead = {
        displayName: { text: 'Spirit Falls Trailhead' }, userRatingCount: 17,
        location: { latitude: matchedGrid.matchedLat + 0.001, longitude: matchedGrid.matchedLng }
      };
      const unrelated = {
        displayName: { text: 'Waterfall Overlook' }, userRatingCount: 9000,
        location: { latitude: matchedGrid.matchedLat, longitude: matchedGrid.matchedLng }
      };
      return new Response(JSON.stringify({ places: [unrelated, trailhead, exactPlace] }));
    }
    return new Response(JSON.stringify({ elements: [] }));
  });
  const namedEnv = {
    ...env, GOOGLE_PLACES_API_KEY: 'test-google-key',
    RARITY_CACHE: {
      get: async key => namedEntries.has(key) ? JSON.parse(namedEntries.get(key)) : null,
      put: async (key, value) => namedEntries.set(key, value)
    }
  };
  const spiritFallsRequest = () => request('lat=41.89&lng=12.49&name=Spirit%20Falls');
  const first = await namedWorker.fetch(spiritFallsRequest(), namedEnv);
  const result = await first.json();
  assert.equal(first.status, 200);
  assert.equal(result.placeName, 'Spirit Falls');
  assert.equal(result.reviewCount, 150);
  assert.equal(result.searchedName, 'Spirit Falls');
  assert.deepEqual(googleQueries, ['Spirit Falls']);
  const cached = await namedWorker.fetch(spiritFallsRequest(), namedEnv);
  assert.equal((await cached.json()).cached, true);
  assert.equal(googleQueries.length, 1);
  const trailRequest = await namedWorker.fetch(
    request('lat=41.89&lng=12.49&name=Spirit%20Falls%20Trail'), namedEnv
  );
  assert.equal((await trailRequest.json()).placeName, 'Spirit Falls Trailhead');
  assert.deepEqual(googleQueries, ['Spirit Falls', 'Spirit Falls Trail']);
  assert.equal(namedEntries.size, 2);
  assert.equal((await namedWorker.fetch(request('lat=41.89&lng=12.49&name='), namedEnv)).status, 400);
  assert.equal((await namedWorker.fetch(
    request(`lat=41.89&lng=12.49&name=${'x'.repeat(151)}`), namedEnv
  )).status, 400);
});
await check('named open-data fallbacks are not cached and retry Google Places', async () => {
  let googleQueries = 0;
  const unmatchedEntries = new Map();
  const unmatchedWorker = createWorker(async url => {
    if (url === 'https://places.googleapis.com/v1/places:searchText') {
      googleQueries++;
      return new Response(JSON.stringify({ places: [{
        displayName: { text: 'Unrelated Overlook' }, userRatingCount: 100,
        location: { latitude: 41.89, longitude: 12.49 }
      }] }));
    }
    return new Response(JSON.stringify({
      elements: [{ type: 'node', id: 2, tags: { tourism: 'viewpoint' } }]
    }));
  });
  const unmatchedEnv = {
    ...env, GOOGLE_PLACES_API_KEY: 'test-google-key',
    RARITY_CACHE: {
      get: async key => unmatchedEntries.has(key) ? JSON.parse(unmatchedEntries.get(key)) : null,
      put: async (key, value) => unmatchedEntries.set(key, value)
    }
  };
  const unmatchedRequest = () => request('lat=41.89&lng=12.49&name=Spirit%20Falls');
  const first = await unmatchedWorker.fetch(unmatchedRequest(), unmatchedEnv);
  assert.equal((await first.json()).source, 'OpenStreetMap contributors (ODbL)');
  const second = await unmatchedWorker.fetch(unmatchedRequest(), unmatchedEnv);
  assert.equal((await second.json()).source, 'OpenStreetMap contributors (ODbL)');
  assert.equal(googleQueries, 2);
  assert.equal(unmatchedEntries.size, 0);
});
await check('Google failures fall back to open-data density and highway isolation; no key keeps OSM-only operation', async () => {
  const isolatedWorker = createWorker(async url => {
    if (url === 'https://places.googleapis.com/v1/places:searchText') {
      return new Response('unavailable', { status: 503 });
    }
    const grid = coordinateGrid(20, 30);
    return new Response(JSON.stringify({
      elements: [
        ...Array.from({ length: 10 }, (_, id) => ({ type: 'node', id, tags: { amenity: 'cafe' } })),
        { type: 'way', id: 11, tags: { highway: 'motorway' },
          center: { lat: grid.matchedLat + 0.27, lon: grid.matchedLng } }
      ]
    }));
  });
  const isolatedCache = new Map();
  const isolatedEnv = {
    ...env,
    GOOGLE_PLACES_API_KEY: 'test-google-key',
    RARITY_CACHE: {
      get: async key => isolatedCache.has(key) ? JSON.parse(isolatedCache.get(key)) : null,
      put: async (key, value) => isolatedCache.set(key, value)
    }
  };
  const fallback = await isolatedWorker.fetch(request('lat=20&lng=30'), isolatedEnv);
  const fallbackData = await fallback.json();
  assert.equal(fallback.status, 200);
  assert.equal(fallbackData.reviewCount, null);
  assert.equal(fallbackData.popularityScore, 10);
  assert.equal(fallbackData.rarityTier, 'Uncharted');
  assert.ok(fallbackData.nearestHighwayKm > 15);
});
console.log(`${checks} rarity Worker checks passed.`);
