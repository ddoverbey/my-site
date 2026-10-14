import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import * as geo from 'd3-geo';
import { feature as decode } from 'topojson-client';
import lookups from './coordinate-lookups.js';
import { collectBoundaries } from './import-geography.mjs';

let checks = 0;
async function check(name, action) {
  await action();
  console.log(`PASS ${name}`);
  checks++;
}
const ring = (west, south, east, north) => [[west, south], [east, south], [east, north], [west, north], [west, south]];
const polygon = (coordinates, properties = { name: 'Test' }) => ({
  type: 'Feature', properties, geometry: { type: 'Polygon', coordinates }
});
const region = { ECO_ID: 1, ECO_NAME: 'Test region', BIOME_NUM: 12, REALM: 'Palearctic' };
const indexed = lookups.indexFeatures([polygon([ring(0, 0, 10, 10), ring(3, 3, 7, 7).reverse()])], geo);
const indexes = {
  countries: lookups.indexFeatures([polygon([ring(0, 0, 10, 10)], { name: 'Test country' })], geo),
  states: lookups.indexFeatures([polygon([ring(0, 0, 10, 10)], { name: 'Test state' })], geo),
  counties: lookups.indexFeatures([{ ...polygon([ring(0, 0, 10, 10)]), id: '01001' }], geo),
  ecoregions: lookups.indexFeatures([polygon([ring(0, 0, 10, 10)], region)], geo)
};
const storage = () => {
  const values = new Map();
  return { values, getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};
const response = data => ({ ok: true, json: async () => data });

await check('coordinate limits reject non-numeric, non-finite, and out-of-range input', () => {
  for (const [lat, lng] of [[91, 0], [0, -181], [NaN, 0], [0, Infinity], ['41', 12]]) {
    assert.throws(() => lookups.validateCoordinates(lat, lng));
  }
  lookups.validateCoordinates(-90, 180);
});
await check('D3 winding normalization respects exteriors, holes, islands, and the antimeridian', () => {
  assert.equal(lookups.findContaining(indexed, 1, 1, geo.geoContains).length, 1);
  assert.equal(lookups.findContaining(indexed, 5, 5, geo.geoContains).length, 0);
  assert.equal(lookups.findContaining(indexed, -40, -100, geo.geoContains).length, 0);
  const islands = lookups.indexFeatures([{
    type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [[ring(10, 0, 15, 5)], [ring(20, 0, 25, 5)]] }
  }], geo);
  assert.equal(lookups.findContaining(islands, 2, 22, geo.geoContains).length, 1);
  const crossing = lookups.indexFeatures([polygon([ring(170, -10, -170, 10)])], geo);
  assert.equal(lookups.findContaining(crossing, 0, 179, geo.geoContains).length, 1);
  assert.equal(lookups.findContaining(crossing, 0, -179, geo.geoContains).length, 1);
  assert.equal(lookups.findContaining(crossing, 0, 0, geo.geoContains).length, 0);
});
await check('region and biome lookups return polygon membership without nearest-land guesses', () => {
  assert.deepEqual(lookups.politicalRegion(1, 1, indexes, geo.geoContains).counties, [{ id: '01001', name: 'Test' }]);
  assert.deepEqual(lookups.biomeRegion(1, 1, indexes.ecoregions, geo.geoContains).biomes, ['12']);
  assert.equal(lookups.biomeRegion(-40, -100, indexes.ecoregions, geo.geoContains).biomeStatus, 'no-terrestrial-match');
  assert.deepEqual(lookups.politicalRegion(-40, -100, indexes, geo.geoContains).countries, []);
});

const npsText = await readFile(new URL('./nps-boundaries.topojson', import.meta.url), 'utf8');
const ecoText = await readFile(new URL('./ecoregions.topojson', import.meta.url), 'utf8');
const nps = JSON.parse(npsText);
const eco = JSON.parse(ecoText);
const npsIndex = lookups.npsBoundaryIndex(nps, decode);
const ecoIndex = lookups.indexFeatures(decode(eco, eco.objects.ecoregions).features, geo);
await check('published snapshots meet download budgets and retain source provenance', () => {
  assert.ok(Buffer.byteLength(npsText) <= 750000);
  assert.ok(Buffer.byteLength(ecoText) <= 1800000);
  assert.equal(nps.metadata.source, lookups.NPS_SOURCE);
  assert.equal(eco.metadata.license, 'CC-BY-4.0');
  assert.equal(ecoIndex.length, 847);
  assert.ok(nps.objects.parks.geometries.length >= 400);
  assert.match(nps.metadata.method, /1.5%/);
  assert.match(eco.metadata.method, /0.8%/);
  console.log(`  NPS: ${Buffer.byteLength(npsText)} bytes (${gzipSync(npsText).length} gzip); ecoregions: ${Buffer.byteLength(ecoText)} bytes (${gzipSync(ecoText).length} gzip).`);
});
await check('Yosemite/Zion boundary matches and combined Sequoia/Kings Canyon codes are explicit', () => {
  for (const [code, lat, lng] of [['yose', 37.75, -119.59], ['zion', 37.3, -113.05]]) {
    const features = npsIndex[code].map(geometry => ({ type: 'Feature', properties: {}, geometry }));
    assert.ok(lookups.findContaining(lookups.indexFeatures(features, geo), lat, lng, geo.geoContains).length, code);
  }
  assert.equal(npsIndex.seki.length, npsIndex.sequ.length + npsIndex.kica.length);
  assert.equal(npsIndex.alca, undefined);
  assert.throws(() => lookups.npsBoundaryIndex({ ...nps, metadata: {} }, decode), /Invalid/);
});
await check('Colosseum and Spirit Falls map to real simplified RESOLVE ecoregions', () => {
  const rome = lookups.biomeRegion(41.8902, 12.4922, ecoIndex, geo.geoContains);
  const falls = lookups.biomeRegion(45.7279, -121.6358, ecoIndex, geo.geoContains);
  assert.deepEqual(rome.biomes, ['12']);
  assert.ok(rome.ecoregions[0].name.includes('Italian'));
  assert.deepEqual(falls.biomes, ['5']);
  console.log(`  Colosseum: ${rome.ecoregions[0].name}; Spirit Falls: ${falls.ecoregions[0].name}.`);
});
await check('boundary importer paginates all records and fails on partial pages/service errors', async () => {
  const features = Array.from({ length: 405 }, (_, id) => ({
    ...polygon([ring(0, 0, 1, 1)], { OBJECTID: id, UNIT_CODE: id.toString(36).padStart(4, '0').toUpperCase(), UNIT_NAME: `Unit ${id}` })
  }));
  const offsets = [];
  const result = await collectBoundaries(async params => {
    if (params.returnCountOnly) return { count: features.length };
    const offset = Number(params.resultOffset);
    offsets.push(offset);
    return { features: features.slice(offset, offset + 100) };
  });
  assert.equal(result.features.length, 405);
  assert.deepEqual(offsets, [0, 100, 200, 300, 400]);
  assert.match(result.features[0].properties.parkCode, /^[a-z0-9]{4}$/);
  await assert.rejects(collectBoundaries(async params => params.returnCountOnly ? { count: 405 } : { features: [] }), /Incomplete/);
});
await check('OSM density categories use exact thresholds, not review-count claims', () => {
  for (const [count, category] of [[0, 'Uncharted'], [9, 'Uncharted'], [10, 'Hidden Gem'], [29, 'Hidden Gem'],
    [30, 'Deep Cut'], [99, 'Deep Cut'], [100, 'Regional Staple'], [999, 'Regional Staple'],
    [1000, 'Beaten Path'], [10000, 'Beaten Path'], [10001, 'Tourist Trap']]) {
    assert.equal(lookups.categoryForPoiCount(count), category);
  }
  assert.throws(() => lookups.categoryForPoiCount(-1));
});
await check('OSM POIs are deduplicated and highway distance uses segments, not vertices', () => {
  const summary = lookups.summarizeOsm([
    { id: 1, type: 'node', tags: { amenity: 'cafe', tourism: 'museum' } },
    { id: 1, type: 'node', tags: { tourism: 'museum' } },
    { id: 2, type: 'node', tags: { amenity: 'restaurant' } },
    { id: 3, type: 'way', tags: { highway: 'motorway' }, geometry: [{ lat: 1, lon: 0 }, { lat: 1, lon: 2 }] }
  ], 1, 1);
  assert.equal(summary.nearbyPoiCount, 2);
  assert.equal(summary.nearestHighwayKm, 0);
  assert.equal(lookups.summarizeOsm([], 0, 0).nearestHighwayKm, null);
  assert.throws(() => lookups.summarizeOsm([{ type: 'way', tags: { highway: 'trunk' } }], 0, 0), /incomplete/);
});
await check('elevation meters convert to feet; nulls, HTTP failures, and malformed responses fail', async () => {
  const elevation = await lookups.lookupElevation(1, 1, async () => response({ elevation: [-10] }));
  assert.equal(elevation.feet, -32.8084);
  await assert.rejects(lookups.lookupElevation(1, 1, async () => response({ elevation: [null] })), /valid elevation/);
  await assert.rejects(lookups.lookupElevation(1, 1, async () => ({ ok: false, status: 429 })), /429/);
});
await check('30-day browser cache reuses rounded coordinate grids, expires, and never caches query errors', async () => {
  const cache = storage();
  let calls = 0;
  const fetcher = async () => { calls++; return response({ elements: [] }); };
  await lookups.lookupRarity(41.8902, 12.4922, fetcher, cache);
  await lookups.lookupRarity(41.8903, 12.4923, fetcher, cache);
  assert.equal(calls, 1);
  const [key, raw] = [...cache.values][0];
  const cached = JSON.parse(raw);
  cache.setItem(key, JSON.stringify({ ...cached, savedAt: Date.now() - lookups.CACHE_TTL - 1 }));
  await lookups.lookupRarity(41.8902, 12.4922, fetcher, cache);
  assert.equal(calls, 2);
  const failedCache = storage();
  await assert.rejects(lookups.lookupRarity(1, 1, async () => response({ remark: 'runtime timeout', elements: [] }), failedCache), /timeout/);
  assert.equal(failedCache.values.size, 0);
});
await check('parallel pipeline starts both providers before either resolves and returns complete validated metadata', async () => {
  const pending = [];
  const operation = lookups.lookupCoordinate(1, 1, {
    indexes, geoContains: geo.geoContains, storage: storage(),
    fetcher: url => new Promise(resolve => pending.push({ url, resolve }))
  });
  assert.equal(pending.length, 2);
  pending.forEach(({ url, resolve }) => resolve(response(url.includes('elevation') ? { elevation: [100] } : { elements: [] })));
  const metadata = await operation;
  const location = { ...metadata, name: 'Test', id: 'custom-test', status: 'v' };
  assert.equal(lookups.validateCustomLocations([location])[0].elevation.feet, 328.084);
  assert.equal(location.political.countries[0], 'Test country');
  assert.throws(() => lookups.validateCustomLocations([{ ...location, lat: 91 }]));
  assert.throws(() => lookups.validateCustomLocations([{ ...location, biomes: ['98'] }]));
  assert.throws(() => lookups.validateCustomLocations([location, location]), /Invalid custom/);
});
await check('missing geography and upstream failures cannot produce success-shaped lookup results', async () => {
  await assert.rejects(lookups.lookupCoordinate(1, 1, { indexes: null }), /unavailable/);
  await assert.rejects(lookups.lookupCoordinate(1, 1, {
    indexes, geoContains: geo.geoContains, fetcher: async url =>
      url.includes('elevation') ? response({ elevation: [1] }) : { ok: false, status: 503 }
  }), /503/);
});
console.log(`${checks} coordinate/geography checks passed.`);
