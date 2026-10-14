import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import catalog from './international-parks.js';
import npsCatalog from './nps-catalog.js';

const records = JSON.parse(await readFile(new URL('./worldwide-national-parks.json', import.meta.url), 'utf8'));
const nps = JSON.parse(await readFile(new URL('./nps-parks.json', import.meta.url), 'utf8'));
const result = catalog.normalizeParks(records);
const parks = result.parks;
let checks = 0;
function check(name, action) { action(); console.log(`PASS ${name}`); checks++; }

check('actual file loads 72 international parks and excludes American Samoa', () => {
  assert.equal(records.length, 73);
  assert.equal(parks.length, 72);
  assert.equal(result.excludedCount, 1);
  assert.ok(!parks.some(p => catalog.excludedCountries.has(p.countryCode)));
});
check('all US and territory country codes are excluded regardless of park spelling', () => {
  const fixtures = [...catalog.excludedCountries].map(country => ({ ...records[0], country, name: 'Any US park' }));
  const normalized = catalog.normalizeParks([...records, ...fixtures]);
  assert.equal(normalized.parks.length, parks.length);
  assert.equal(normalized.excludedCount, 1 + fixtures.length);
});
check('country labels, exact coordinates, stable IDs and Fiordland progress', () => {
  const first = parks.find(p => p.id === 'world-af-band-e-amir');
  assert.equal(first.country, 'Afghanistan');
  assert.equal(first.lat, Number(records[0].latitude));
  assert.equal(first.lng, Number(records[0].longitude));
  assert.equal(parks.filter(p => p.id === 'fiordland').length, 1);
  assert.equal(parks.find(p => p.id === 'world-ac-green-mountain').country, 'Ascension Island');
  assert.deepEqual(catalog.normalizeParks([...records].reverse()).parks.map(p => p.id), parks.map(p => p.id));
});
check('no collision with NPS IDs and exactly one American Samoa in merged catalog', () => {
  const units = npsCatalog.normalizeParks(nps.data);
  const merged = [...units, ...parks];
  assert.equal(new Set(merged.map(p => p.id)).size, merged.length);
  assert.equal(merged.filter(p => p.name.includes('American Samoa')).length, 1);
  assert.equal(merged.filter(p => !p.intl).length, nps.total);
});
check('metadata distinguishes dark sky Reserve and Sanctuary and missing optional fields', () => {
  assert.ok(parks.find(p => p.name === 'Aoraki Mount Cook').memberships.includes('International Dark Sky Reserve'));
  assert.ok(parks.find(p => p.name === 'Rakiura').memberships.includes('International Dark Sky Sanctuary'));
  assert.deepEqual(parks.find(p => p.name === 'Arikok').memberships, []);
  assert.equal(parks.find(p => p.name === 'Green Mountain').areaKm2, null);
});
check('duplicates and invalid metadata are explicit errors', () => {
  assert.throws(() => catalog.normalizeParks([...records, records[0]]), /Duplicate/);
  for (const override of [
    { country: 'ZZ' }, { latitude: '91' }, { longitude: true }, { url: 'javascript:alert(1)' },
    { url: 'https://user:password@example.org/' }, { size_in_km: -1 }, { memberships: { unesco: 'yes' } }
  ]) assert.throws(() => catalog.normalizeParks([{ ...records[0], ...override }]));
});
check('missing coordinates remain list-only, not invented zeroes', () => {
  const park = catalog.normalizeParks([{ ...records[0], latitude: ' ', longitude: null }]).parks[0];
  assert.equal(park.lat, null);
  assert.equal(park.lng, null);
});
console.log(`${checks} international catalog checks passed.`);
