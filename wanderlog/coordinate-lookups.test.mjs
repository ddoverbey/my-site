import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import * as geo from 'd3-geo';
import { feature as decode } from 'topojson-client';
import lookups from './coordinate-lookups.js';
import { collectBoundaries } from './import-geography.mjs';
import { selectSubdivisionFeatures } from './import-subdivisions.mjs';
import { buildAdmin2, selectAdmin2Features } from './import-admin2.mjs';

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
const subdivision = { ...polygon([ring(0, 0, 10, 10)], {
  name: 'Ontario', country: 'Canada', isoA3: 'CAN', region: 'Ontario'
}), id: 'CAN:ON-01' };
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
await check('international subdivisions resolve to stable county-ledger IDs for locations and routes', () => {
  const subdivisionIndex = lookups.indexFeatures([subdivision], geo);
  const political = lookups.politicalRegion(5, 5, {
    ...indexes, counties: subdivisionIndex, subdivisions: subdivisionIndex
  }, geo.geoContains);
  assert.deepEqual(political.counties, [{ id: 'CAN:ON-01', name: 'Ontario' }]);
  assert.deepEqual(political.admin1, [{ id: 'CAN:ON-01', name: 'Ontario' }]);
  assert.deepEqual(lookups.routeCountyIds([[5, 1], [5, 9]], subdivisionIndex, geo.geoContains), ['CAN:ON-01']);
  assert.equal(lookups.validCountyId('01001'), true);
  assert.equal(lookups.validCountyId('CAN:ON-01'), true);
  assert.equal(lookups.validCountyId('can:ON-01'), false);
  assert.equal(lookups.validCountyId('CAN:ON/01'), false);
});
await check('Admin-1 provinces remain separate from the Admin-2 county-equivalent returned for coordinates', () => {
  const province = { ...subdivision, id: 'CAN:ON', properties: { ...subdivision.properties, name: 'Ontario' } };
  const district = { ...subdivision, id: 'CAN:CD-001', properties: { name: 'Ottawa Division', country: 'CAN' } };
  const provinceIndex = lookups.indexFeatures([province], geo);
  const countyIndex = lookups.indexFeatures([district], geo);
  const political = lookups.politicalRegion(5, 5, {
    ...indexes, counties: countyIndex, subdivisions: provinceIndex
  }, geo.geoContains);
  assert.deepEqual(political.counties, [{ id: 'CAN:CD-001', name: 'Ottawa Division' }]);
  assert.deepEqual(political.admin1, [{ id: 'CAN:ON', name: 'Ontario' }]);
  assert.deepEqual(lookups.countyEquivalentFeatures([province], [district]), [district]);
});
await check('subdivision biome inheritance selects the predominant terrestrial biome', () => {
  const regions = lookups.indexFeatures([
    polygon([ring(0, 0, 7, 10)], { ...region, BIOME_NUM: 5 }),
    polygon([ring(7, 0, 10, 10)], { ...region, BIOME_NUM: 12 })
  ], geo);
  assert.equal(lookups.predominantBiome(subdivision, regions, geo), '5');
});
await check('Natural Earth feature selection excludes the US and emits stable minimal properties', () => {
  const features = selectSubdivisionFeatures([
    { type: 'Feature', properties: {
      adm0_a3: 'CAN', iso_a2: 'CA', adm1_code: 'CAN-ON-01', name: 'Ontario',
      admin: 'Canada', region: 'Ontario'
    }, geometry: { type: 'Polygon', coordinates: [ring(0, 0, 1, 1)] } },
    { type: 'Feature', properties: {
      adm0_a3: 'USA', iso_a2: 'US', adm1_code: 'USA-CA', name: 'California',
      admin: 'United States of America', region: 'West'
    }, geometry: { type: 'Polygon', coordinates: [ring(0, 0, 1, 1)] } }
  ]);
  assert.equal(features.length, 1);
  assert.equal(features[0].id, 'CAN:CAN-ON-01');
  assert.deepEqual(features[0].properties, {
    id: 'CAN:CAN-ON-01', name: 'Ontario', country: 'Canada', isoA3: 'CAN', region: 'Ontario'
  });
});
await check('region and biome lookups return polygon membership without nearest-land guesses', () => {
  assert.deepEqual(lookups.politicalRegion(1, 1, indexes, geo.geoContains).counties, [{ id: '01001', name: 'Test' }]);
  assert.deepEqual(lookups.biomeRegion(1, 1, indexes.ecoregions, geo.geoContains).biomes, ['12']);
  assert.equal(lookups.biomeRegion(-40, -100, indexes.ecoregions, geo.geoContains).biomeStatus, 'no-terrestrial-match');
  assert.deepEqual(lookups.politicalRegion(-40, -100, indexes, geo.geoContains).countries, []);
});
await check('county biome fallback detects complete border intersections without sampled-point guesses', () => {
  const county = polygon([ring(0, 0, 10, 10)]);
  const narrowCrossing = polygon([ring(2.4, -1, 2.6, 1)], { ...region, BIOME_NUM: 5 });
  const enclosedWithoutBorderContact = polygon([ring(4, 4, 6, 6)], { ...region, BIOME_NUM: 7 });
  const fallback = lookups.firstBoundaryIntersection(
    county, lookups.indexFeatures([enclosedWithoutBorderContact, narrowCrossing], geo), geo);
  assert.equal(fallback.properties.BIOME_NUM, 5);
  assert.equal(lookups.firstBoundaryIntersection(
    county, lookups.indexFeatures([enclosedWithoutBorderContact], geo), geo), null);
});

const npsText = await readFile(new URL('./nps-boundaries.topojson', import.meta.url), 'utf8');
const ecoText = await readFile(new URL('./ecoregions.topojson', import.meta.url), 'utf8');
const subdivisionsText = await readFile(new URL('./world-subdivisions.topojson', import.meta.url), 'utf8');
const admin2Text = await readFile(new URL('./world-admin2.topojson', import.meta.url), 'utf8');
const nps = JSON.parse(npsText);
const eco = JSON.parse(ecoText);
const subdivisionsTopology = JSON.parse(subdivisionsText);
const admin2Topology = JSON.parse(admin2Text);
const npsIndex = lookups.npsBoundaryIndex(nps, decode);
const ecoIndex = lookups.indexFeatures(decode(eco, eco.objects.ecoregions).features, geo);
const subdivisions = lookups.subdivisionFeatures(subdivisionsTopology, decode);
const subdivisionsIndex = lookups.indexFeatures(subdivisions, geo);
const admin2 = lookups.admin2Features(admin2Topology, decode);
const countyEquivalent = lookups.countyEquivalentFeatures(subdivisions, admin2);
await check('published geography snapshots meet size budgets and retain source provenance', () => {
  assert.ok(Buffer.byteLength(npsText) <= 750000);
  assert.ok(Buffer.byteLength(ecoText) <= 1800000);
  assert.equal(nps.metadata.source, lookups.NPS_SOURCE);
  assert.equal(eco.metadata.license, 'CC-BY-4.0');
  assert.ok(Buffer.byteLength(subdivisionsText) <= 1_500_000);
  assert.equal(subdivisionsTopology.metadata.source, lookups.SUBDIVISION_SOURCE);
  assert.ok(subdivisions.length > 1000);
  assert.equal(subdivisionsIndex.length, subdivisions.length);
  assert.ok(Buffer.byteLength(admin2Text) < 1_500_000);
  assert.equal(admin2Topology.metadata.source, lookups.ADMIN2_SOURCE);
  assert.equal(admin2Topology.metadata.license, 'CC-BY-4.0');
  assert.equal(admin2.length, admin2Topology.objects.admin2.geometries.length);
  assert.ok(lookups.ADMIN2_COUNTRIES.every(code => admin2.some(feature => feature.id.startsWith(`${code}:`))));
  assert.ok(countyEquivalent.every(feature => !['CAN', 'MEX', 'DEU', 'AUS'].includes(feature.properties.isoA3)));
  assert.ok(subdivisions.every(feature =>
    /^[A-Z]{3}:[A-Za-z0-9_.-]+$/.test(feature.id) && feature.properties.isoA3 !== 'USA'));
  assert.equal(ecoIndex.length, 847);
  assert.ok(nps.objects.parks.geometries.length >= 400);
  assert.match(nps.metadata.method, /1.5%/);
  assert.match(eco.metadata.method, /0.8%/);
  console.log(`  Admin-2: ${Buffer.byteLength(admin2Text)} bytes; NPS: ${Buffer.byteLength(npsText)} bytes (${gzipSync(npsText).length} gzip); ecoregions: ${Buffer.byteLength(ecoText)} bytes (${gzipSync(ecoText).length} gzip).`);
});
await check('geoBoundaries Admin-2 importer validates IDs and emits only compact county properties', async () => {
  const features = selectAdmin2Features({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature', properties: { shapeID: 'CAN-ADM2-01', shapeName: 'Ottawa Division' },
      geometry: { type: 'Polygon', coordinates: [ring(0, 0, 1, 1)] }
    }]
  }, 'CAN');
  assert.equal(features[0].id, 'CAN:CAN-ADM2-01');
  assert.deepEqual(features[0].properties, {
    id: 'CAN:CAN-ADM2-01', name: 'Ottawa Division', country: 'CAN'
  });
  const { topology, featureCount } = await buildAdmin2(features, []);
  assert.equal(featureCount, 1);
  assert.equal(topology.metadata.license, 'CC-BY-4.0');
  assert.equal(topology.objects.admin2.geometries[0].properties.country, 'CAN');
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
await check('OSM POIs are deduplicated and highway distance uses the lightweight way center', () => {
  const summary = lookups.summarizeOsm([
    { id: 1, type: 'node', tags: { amenity: 'cafe', tourism: 'museum' } },
    { id: 1, type: 'node', tags: { tourism: 'museum' } },
    { id: 2, type: 'node', tags: { amenity: 'restaurant' } },
    { id: 3, type: 'way', tags: { highway: 'motorway' }, center: { lat: 1, lon: 1 } }
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
await check('catalog park rarity prefers saved and cached values before deterministic offline metadata', async () => {
  const park = { id: 'offline', name: 'Offline Park', designation: 'National Monument', lat: 1, lng: 1 };
  assert.equal(lookups.catalogParkRarity(park).rarityTier, 'Regional Staple');
  assert.equal(lookups.catalogParkRarity({ ...park, visitorCount: 1000000 }).rarityTier, 'Tourist Trap');
  assert.equal(lookups.catalogParkRarity({ ...park, visitorCount: 250000 }).rarityTier, 'Beaten Path');
  assert.equal(lookups.catalogParkRarity({ ...park, visitorCount: 50000 }).rarityTier, 'Regional Staple');
  assert.equal(lookups.catalogParkRarity({ ...park, visitorCount: 10000 }).rarityTier, 'Deep Cut');
  assert.equal(lookups.catalogParkRarity({ ...park, visitorCount: 1000 }).rarityTier, 'Hidden Gem');
  assert.equal(lookups.catalogParkRarity({ ...park, visitorCount: 0 }).rarityTier, 'Uncharted');
  assert.equal(lookups.catalogParkRarity(park, {
    savedRarity: { rarity: null, rarityTier: 'Hidden Gem' }
  }).rarityTier, 'Hidden Gem');
  const cache = storage();
  await lookups.lookupRarity(1, 1, async () => response({
    elements: Array.from({ length: 12 }, (_, id) => ({ id, type: 'node', tags: { amenity: 'cafe' } }))
  }), cache);
  assert.equal(lookups.catalogParkRarity(park, { storage: cache }).rarityTier, 'Hidden Gem');
});
await check('Overpass uses a bounded timeout and lightweight center output', async () => {
  let request;
  await lookups.lookupRarity(1, 1, async (url, options) => {
    request = { url, options };
    return response({ elements: [] });
  }, storage());
  const query = new URLSearchParams(request.options.body).get('data');
  assert.equal(request.url, lookups.OVERPASS_URL);
  assert.match(query, /^\[out:json\]\[timeout:10\]/);
  assert.ok(query.endsWith('out center;'));
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
await check('background rarity can be skipped while reusing its cache and still looking up elevation', async () => {
  const requests = [];
  const cache = storage();
  await lookups.lookupRarity(1, 1, async () => response({
    elements: Array.from({ length: 12 }, (_, id) => ({ id, type: 'node', tags: { amenity: 'cafe' } }))
  }), cache);
  const metadata = await lookups.lookupCoordinate(1, 1, {
    indexes, geoContains: geo.geoContains, storage: cache, skipRarityLookup: true,
    rarityEndpoint: 'https://api.example.test/rarity',
    fetcher: async url => {
      requests.push(url);
      return response({ elevation: [25] });
    }
  });
  assert.equal(requests.length, 1);
  assert.ok(requests[0].includes('elevation'));
  assert.equal(metadata.elevationFt, 25 * 3.28084);
  assert.equal(metadata.rarity.rarityTier, 'Hidden Gem');
  assert.equal(metadata.rarityTier, 'Hidden Gem');
  assert.deepEqual(metadata.lookupWarnings, []);
});
await check('missing offline geography blocks saving because political and biome data are required', async () => {
  await assert.rejects(lookups.lookupCoordinate(1, 1, { indexes: null }), /unavailable/);
});
const provider = {
  placeName: 'Matched POI', reviewCount: 30, popularityScore: 30, rarityTier: 'Deep Cut',
  matchedLat: 1, matchedLng: 1, cached: true, source: 'Licensed provider'
};
await check('elevation and rarity requests use separate bounded abort timeouts', async () => {
  const originalTimeout = AbortSignal.timeout;
  const timeouts = [];
  AbortSignal.timeout = milliseconds => {
    timeouts.push(milliseconds);
    return originalTimeout(milliseconds);
  };
  try {
    await lookups.lookupCoordinate(1, 1, {
      indexes, geoContains: geo.geoContains, rarityEndpoint: 'https://api.example.test/rarity',
      fetcher: async url => response(url.includes('elevation') ? { elevation: [1] } : provider)
    });
    await lookups.lookupRarityWithFallback(1, 1, {
      rarityEndpoint: 'https://api.example.test/rarity',
      fetcher: async url => url.includes('api.example.test')
        ? { ok: false, status: 503 } : response({ elements: [] })
    });
  } finally {
    AbortSignal.timeout = originalTimeout;
  }
  assert.deepEqual(timeouts, [12000, 3500, 12000, 12000]);
  assert.equal(lookups.PROVIDER_TIMEOUT_MS, 3500);
  assert.equal(lookups.RARITY_TIMEOUT_MS, 12000);
});
await check('provider endpoint succeeds without Overpass and preserves actual review count/source', async () => {
  const urls = [];
  const result = await lookups.lookupRarityWithFallback(1, 1, {
    rarityEndpoint: 'https://api.devonoverbey.com/rarity', fetcher: async url => {
      urls.push(url);
      return response(provider);
    }
  });
  assert.equal(urls.length, 1);
  assert.equal(new URL(urls[0]).searchParams.get('lat'), '1');
  assert.equal(result.method, 'provider-review-count');
  assert.equal(result.reviewCount, 30);
  assert.equal(result.cached, true);
});
await check('an open-data endpoint score is never transformed into a review count', async () => {
  const result = await lookups.lookupRarityWithFallback(1, 1, {
    rarityEndpoint: 'https://api.devonoverbey.com/rarity',
    fetcher: async () => response({ ...provider, reviewCount: null, source: 'OpenStreetMap contributors (ODbL)' })
  });
  assert.equal(result.reviewCount, null);
  assert.equal(result.method, 'provider-popularity');
});
await check('provider transport metadata cannot masquerade as legacy OSM or discard real reviews', async () => {
  const result = await lookups.lookupRarityWithFallback(1, 1, {
    rarityEndpoint: 'https://api.devonoverbey.com/rarity',
    fetcher: async () => response({ ...provider, method: 'osm-poi-density' })
  });
  assert.equal(result.method, 'provider-review-count');
  assert.equal(result.reviewCount, 30);
});
await check('endpoint network timeouts and JSON errors also trigger the explicit OSM fallback', async () => {
  for (const error of [new DOMException('Timed out', 'TimeoutError'), new SyntaxError('Invalid JSON')]) {
    let fallbacks = 0;
    const result = await lookups.lookupRarityWithFallback(1, 1, {
      rarityEndpoint: 'https://api.devonoverbey.com/rarity',
      onFallback: () => { fallbacks++; },
      fetcher: async url => {
        if (url.includes('api.devonoverbey.com')) throw error;
        return response({ elements: [] });
      }
    });
    assert.equal(fallbacks, 1);
    assert.equal(result.reviewCount, null);
  }
});
await check('unavailable, malformed, or distant provider results explicitly fall back to cached direct OSM', async () => {
  for (const result of [{ ok: false, status: 503 }, response({ ...provider, matchedLat: 40 }),
    response({ ...provider, reviewCount: -1 }), response({ ...provider, rarityTier: 'Hidden Gem' })]) {
    let fallback = 0;
    const urls = [];
    const rarity = await lookups.lookupRarityWithFallback(1, 1, {
      rarityEndpoint: 'https://api.devonoverbey.com/rarity', storage: storage(),
      onFallback: () => { fallback++; },
      fetcher: async url => {
        urls.push(url);
        return url.includes('api.devonoverbey.com') ? result : response({ elements: [] });
      }
    });
    assert.equal(fallback, 1);
    assert.equal(urls.length, 2);
    assert.equal(rarity.method, 'osm-poi-density');
    assert.equal(rarity.reviewCount, null);
    assert.equal(rarity.rarityTier, 'Uncharted');
  }
});
await check('the low-level rarity lookup reports failure for lookupCoordinate to handle', async () => {
  await assert.rejects(lookups.lookupRarityWithFallback(1, 1, {
    rarityEndpoint: 'https://api.devonoverbey.com/rarity',
    fetcher: async url => ({ ok: false, status: url.includes('api.devonoverbey.com') ? 503 : 504 })
  }), /504/);
});
await check('failed rarity and elevation providers preserve offline regions and biomes with safe defaults', async () => {
  const originalTimeout = AbortSignal.timeout;
  const originalWarn = console.warn;
  const timeouts = [];
  const fallbacks = [];
  AbortSignal.timeout = milliseconds => {
    timeouts.push(milliseconds);
    return originalTimeout(milliseconds);
  };
  console.warn = () => {};
  try {
    const result = await lookups.lookupCoordinate(1, 1, {
      indexes, geoContains: geo.geoContains, rarityEndpoint: 'https://api.example.test/rarity',
      onFallback: error => fallbacks.push(error),
      fetcher: async url => {
        if (url.includes('elevation')) return { ok: false, status: 503 };
        if (url.includes('api.example.test')) return { ok: false, status: 503 };
        if (url === lookups.OVERPASS_URL) return { ok: false, status: 504 };
        throw new Error(`Unexpected provider URL: ${url}`);
      }
    });
    assert.equal(result.elevation, null);
    assert.equal(result.elevationFt, 0);
    assert.equal(result.rarity, null);
    assert.equal(result.rarityTier, 'Uncharted');
    assert.deepEqual(result.political.countries, ['Test country']);
    assert.deepEqual(result.political.states, ['Test state']);
    assert.deepEqual(result.political.counties, [{ id: '01001', name: 'Test' }]);
    assert.deepEqual(result.biomes, ['12']);
    assert.equal(result.biomeStatus, 'matched');
    assert.equal(result.lookupWarnings.length, 1);
    assert.ok(result.lookupWarnings.some(warning => warning.includes('503')));
    assert.ok(!result.lookupWarnings.some(warning => warning.includes('504')));
    assert.equal(fallbacks.length, 1);
    assert.deepEqual(timeouts, [12000, 3500, 12000]);
    const location = {
      ...result, id: 'custom-provider-fallback', name: 'Waterfall', status: 'v',
      elevation: result.elevation, category: 'waterfall'
    };
    assert.equal(lookups.validateCustomLocations([location])[0].rarityTier, 'Uncharted');
  } finally {
    AbortSignal.timeout = originalTimeout;
    console.warn = originalWarn;
  }
});
await check('legacy rarity migrates to v2 without changing visits, inventing reviews, or mutating input', () => {
  const legacy = {
    pins: { yose: 'v' }, customLocations: [{
      id: 'custom-legacy', name: 'Legacy', lat: 1, lng: 1, status: 'v',
      elevation: { meters: 100, feet: 328.084 }, political: { countries: [], states: [], counties: [] },
      ecoregions: [], biomes: [], biomeStatus: 'no-terrestrial-match',
      rarity: { method: 'osm-poi-density', category: 'Hidden Gem', nearbyPoiCount: 10, nearestHighwayKm: null },
      lookedUpAt: new Date().toISOString()
    }]
  };
  const result = lookups.migrateState(legacy);
  assert.equal(result.version, 2);
  assert.deepEqual(result.pins, legacy.pins);
  assert.equal(result.customLocations[0].rarity.reviewCount, null);
  assert.equal(result.customLocations[0].rarity.popularityScore, 10);
  assert.equal(result.customLocations[0].rarity.matchedLat, 1);
  assert.equal(legacy.customLocations[0].rarity.reviewCount, undefined);
  assert.deepEqual(lookups.migrateState(result), result);
  assert.throws(() => lookups.migrateState({ ...legacy, version: 3 }), /Unsupported/);
});
await check('road routing uses the requested endpoints and validates full GeoJSON directions', async () => {
  let requested;
  const route=await lookups.lookupRoadRoute([39,-105],[40,-106],async url=>{
    requested=url;
    return response({code:'Ok',routes:[{geometry:{type:'LineString',coordinates:[[-105,39],[-105.5,39.5],[-106,40]]}}]});
  });
  assert.ok(requested.includes('/driving/-105,39;-106,40'));
  assert.ok(requested.includes('overview=full&geometries=geojson'));
  assert.deepEqual(route,[[39,-105],[39.5,-105.5],[40,-106]]);
  for (const data of [
    {code:'NoRoute',routes:[]},{code:'Ok',routes:[{geometry:{type:'Polygon',coordinates:[]}}]},
    {code:'Ok',routes:[{geometry:{type:'LineString',coordinates:[[0,0],[181,0]]}}]},
    {code:'Ok',routes:[{geometry:{type:'LineString',coordinates:[[0,0]]}}]}
  ]) await assert.rejects(lookups.lookupRoadRoute([39,-105],[40,-106],async()=>response(data)));
  await assert.rejects(lookups.lookupRoadRoute([39,-105],[40,-106],async()=>({ok:false,status:503})),/503/);
});
await check('road county intersections include narrow crossed counties without mistaking nearby counties or polygon holes', () => {
  const features=[
    {...polygon([ring(0,0,1,1)]),id:'01001'},
    {...polygon([ring(1,0,1.01,1)]),id:'01003'},
    {...polygon([ring(1.01,0,2,1)]),id:'01005'},
    {...polygon([ring(0,2,2,3)]),id:'01007'},
    {...polygon([ring(3,0,6,3),ring(4,1,5,2).reverse()]),id:'01009'}
  ];
  const countyIndex=lookups.indexFeatures(features,geo);
  assert.deepEqual(lookups.routeCountyIds([[0.5,0.5],[0.5,1.5]],countyIndex,geo.geoContains),['01001','01003','01005']);
  assert.deepEqual(lookups.routeCountyIds([[1.2,4.2],[1.8,4.8]],countyIndex,geo.geoContains),[]);
  assert.deepEqual(lookups.routeCountyIds([[1.5,3.5],[1.5,5.5]],countyIndex,geo.geoContains),['01009']);
  assert.deepEqual(lookups.routeCountyIds([[0.5,0.5],[0.5,1.5],[0.5,0.5]],countyIndex,geo.geoContains),['01001','01003','01005']);
  assert.deepEqual(lookups.routeCountyIds([[50,100],[51,101]],countyIndex,geo.geoContains),[]);
});
await check('county routing handles islands and the short date-line crossing, not a path across the globe', () => {
  const features=[
    {type:'Feature',id:'02001',properties:{},geometry:{type:'MultiPolygon',coordinates:[[ring(0,0,1,1)],[ring(2,0,3,1)]]}},
    {...polygon([ring(179,-1,-179,1)]),id:'02003'},
    {...polygon([ring(-10,-1,10,1)]),id:'02005'}
  ];
  const index=lookups.indexFeatures(features,geo);
  assert.deepEqual(lookups.routeCountyIds([[0.5,1.5],[0.5,3.5]],index.slice(0,1),geo.geoContains),['02001']);
  assert.deepEqual(lookups.routeCountyIds([[0,178],[0,-178]],index,geo.geoContains),['02003']);
});
console.log(`${checks} coordinate/geography checks passed.`);
