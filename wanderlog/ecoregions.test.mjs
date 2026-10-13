import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildSnapshot } from './import-ecoregions.mjs';
import ecoregions from './ecoregions.js';
import catalog from './nps-catalog.js';
import internationalParks from './international-parks.js';

let checks = 0;
function check(name, action) {
  action();
  console.log(`PASS ${name}`);
  checks++;
}

check('rarity boundaries use exact percentages, not rounded labels', () => {
  for (const [share, expected] of [[0, 'rare'], [1.999999, 'rare'], [2, 'uncommon'], [9.999999, 'uncommon'], [10, 'common'], [100, 'common']]) {
    assert.equal(ecoregions.rarityForShare(share), expected);
  }
  for (const invalid of [-1, NaN, Infinity, 101]) assert.throws(() => ecoregions.rarityForShare(invalid));
});

const polygon = (rings, id = 1, biomeId = 13) => ({
  type: 'Feature',
  properties: { ECO_ID: id, ECO_NAME: `Ecoregion ${id}`, BIOME_NUM: biomeId, REALM: 'Nearctic', LICENSE: 'CC-BY 4.0' },
  geometry: { type: 'Polygon', coordinates: rings }
});
const ring = (west, south, east, north) => [[west, south], [east, south], [east, north], [west, north], [west, south]];
const features = [
  polygon([ring(0, 0, 10, 10), ring(3, 3, 7, 7).reverse()]),
  { ...polygon([], 2, 4), geometry: { type: 'MultiPolygon', coordinates: [[ring(20, 0, 25, 5)], [ring(30, 0, 35, 5)]] } },
  polygon([ring(10, 0, 12, 10)], 3, 5),
  polygon([ring(40, 0, 45, 5)], 4, 98)
];
const points = [
  { id: 'inside', lng: 1, lat: 1 }, { id: 'hole', lng: 5, lat: 5 },
  { id: 'island', lng: 32, lat: 2 }, { id: 'boundary', lng: 10, lat: 1 },
  { id: 'offshore', lng: -100, lat: 1 }, { id: 'no-coords', lng: null, lat: null },
  { id: 'partial-coords', lng: 1, lat: null },
  { id: 'ice', lng: 42, lat: 2 }
];
let index = 0;
const generated = await buildSnapshot({
  read: async () => index < features.length ? { done: false, value: features[index++] } : { done: true }
}, points);
check('polygon holes, islands, offshore points, and missing coordinates', () => {
  assert.equal(generated.locations.inside.status, 'matched');
  assert.equal(generated.locations.hole.status, 'no-terrestrial-match');
  assert.equal(generated.locations.island.ecoregions[0].id, 2);
  assert.equal(generated.locations.offshore.status, 'no-terrestrial-match');
  assert.equal(generated.locations['no-coords'].status, 'missing-coordinates');
  assert.equal(generated.locations['partial-coords'].status, 'missing-coordinates');
  assert.equal(generated.locations.ice.status, 'no-terrestrial-match');
});
check('shared boundaries retain both intersected ecoregions', () => {
  assert.deepEqual(generated.locations.boundary.ecoregions.map(r => r.id), [1, 3]);
});
check('geodesic area totals are positive and exclude rock/ice', () => {
  assert.equal(generated.ecoregionCount, 3);
  assert.ok(generated.biomes.find(b => b.id === 13).areaKm2 > 0);
  assert.ok(Math.abs(generated.biomes.reduce((sum, b) => sum + b.areaShare, 0) - 100) < 1e-9);
});

const snapshot = JSON.parse(await readFile(new URL('./ecoregion-mapping.json', import.meta.url), 'utf8'));
const nps = JSON.parse(await readFile(new URL('./nps-parks.json', import.meta.url), 'utf8'));
const parks = [...catalog.normalizeParks(nps.data), ...internationalParks];
const applied = ecoregions.applySnapshot(parks, snapshot);
check('published mappings validate and cover every current destination coordinate', () => {
  assert.equal(applied.parks.length, nps.total + internationalParks.length);
  assert.equal(applied.parks.filter(p => p.biomeStatus === 'mapping-outdated').length, 0);
  assert.equal(snapshot.ecoregionCount, 847);
  assert.equal(Object.keys(snapshot.locations).length, parks.length);
});
check('real-world reference points map to named ecoregions and WWF biome types', () => {
  for (const [id, biomeId, name] of [
    ['yell', 5, 'South Central Rockies forests'],
    ['acad', 4, 'New England-Acadian forests'],
    ['arch', 13, 'Colorado Plateau shrublands'],
    ['ever', 14, 'Bahamian-Antillean mangroves'],
    ['uluru', 13, 'Great Sandy-Tanami desert']
  ]) {
    const region = snapshot.locations[id].ecoregions[0];
    assert.equal(region.biomeId, biomeId);
    assert.equal(region.name, name);
  }
});
check('unclassified coastal points get no invented terrestrial biome', () => {
  for (const id of ['galapagos', 'halong', 'drto']) {
    const park = applied.parks.find(p => p.id === id);
    assert.deepEqual(park.biomes, []);
    assert.equal(park.biomeStatus, 'no-terrestrial-match');
  }
});
check('global area rarity replaces legacy cave, volcanic, and island tags', () => {
  assert.equal(Object.keys(applied.biomes).length, 14);
  assert.deepEqual(snapshot.biomes.filter(b => b.rarity === 'rare').map(b => b.id), [3, 9, 14]);
  assert.equal(applied.biomes['11'].rarity, 'common');
  assert.equal(applied.biomes['14'].xp, 65);
  assert.ok(Math.abs(snapshot.biomes.reduce((sum, b) => sum + b.areaShare, 0) - 100) < 1e-9);
});
check('coordinate changes and new destinations cannot collect stale mappings', () => {
  const yellowstone = parks.find(p => p.id === 'yell');
  const changed = ecoregions.applySnapshot([{ ...yellowstone, lat: yellowstone.lat + 1 }, { id: 'new', lat: 0, lng: 0 }], snapshot);
  for (const park of changed.parks) {
    assert.equal(park.biomeStatus, 'mapping-outdated');
    assert.deepEqual(park.biomes, []);
  }
});
check('partial missing coordinates remain explicit rather than rejecting the entire dataset', () => {
  const partial = JSON.parse(JSON.stringify(snapshot));
  partial.locations.partial = { lat: null, lng: 1, ecoregions: [], status: 'missing-coordinates' };
  assert.equal(ecoregions.applySnapshot([{ id: 'partial', lat: null, lng: 1 }], partial).parks[0].biomeStatus, 'missing-coordinates');
});
check('malformed biome shares and unsupported mapping data fail explicitly', () => {
  const invalid = JSON.parse(JSON.stringify(snapshot));
  invalid.biomes[0].areaShare = 0;
  assert.throws(() => ecoregions.validateSnapshot(invalid), /areas/);
  invalid.biomes = snapshot.biomes;
  invalid.locations.yell.ecoregions[0].biomeId = 98;
  assert.throws(() => ecoregions.validateSnapshot(invalid), /ecoregion/);
  const incorrectAreas = JSON.parse(JSON.stringify(snapshot));
  incorrectAreas.biomes[0].areaKm2 *= 2;
  assert.throws(() => ecoregions.validateSnapshot(incorrectAreas), /recorded areas/);
});
console.log(`${checks} ecoregion checks passed.`);
