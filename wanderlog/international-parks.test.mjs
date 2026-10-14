import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import catalog from './international-parks.js';
import npsCatalog from './nps-catalog.js';

const records = JSON.parse(await readFile(new URL('./worldwide-national-parks.json', import.meta.url), 'utf8'));
const nps = JSON.parse(await readFile(new URL('./nps-parks.json', import.meta.url), 'utf8'));
const query = JSON.parse(await readFile(new URL('./wikidata-national-parks-query.json', import.meta.url), 'utf8'));
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
const combined = catalog.combineParks(records, query);
const wiki = catalog.normalizeWikidata(query);
check('actual query groups repeated rows, excludes US rows and supplements all 19 blind spots', () => {
  assert.equal(query.length, 4784);
  assert.equal(wiki.parks.length, 3369);
  assert.equal(wiki.excludedCount, 127);
  assert.equal(combined.excludedCount, 128);
  assert.equal(combined.duplicateRowCount, 1288);
  assert.equal(combined.matchedCount, 53);
  assert.equal(combined.parks.length, 3388);
  const supplements = combined.parks.filter(p => p.source === catalog.source && !p.wikidataUrl);
  assert.equal(supplements.length, 19);
  assert.ok(supplements.some(p => p.name === 'Wakhan'));
  assert.ok(supplements.some(p => p.name === 'Zombitse-Vohibasia'));
  const all = [...npsCatalog.normalizeParks(nps.data), ...combined.parks];
  assert.equal(all.length, 3862);
  assert.equal(new Set(all.map(p => p.id)).size, all.length);
  assert.ok(!combined.parks.some(p => catalog.excludedCountries.has(p.countryCode)));
});
check('aliases merge without losing curated IDs, metadata or coordinates', () => {
  for (const name of ['Tajik', 'Aoraki Mount Cook', 'Shebenik-Jabllanicë', 'Fir of Drenova',
    'Fir of Hotovë', 'Theth', 'Guadeloupe', 'Green Mountain', 'Tynwald', 'Fiordland']) {
    const old = parks.find(p => p.name === name);
    const merged = combined.parks.filter(p => p.id === old.id);
    assert.equal(merged.length, 1, name);
    assert.equal(merged[0].lat, old.lat);
    assert.equal(merged[0].lng, old.lng);
    assert.ok(merged[0].wikidataUrl, name);
    assert.deepEqual(merged[0].memberships, old.memberships);
  }
  for (const name of ['Nosy Ve-Androka', 'Hwange', 'Tajik']) {
    assert.ok(combined.parks.find(p => p.name === name).warnings.some(note => note.includes('curated point retained')));
  }
  assert.equal(combined.parks.filter(p => p.name === 'Mount Cook National Park').length, 1);
  assert.equal(combined.parks.find(p => p.name === 'Mount Cook National Park').countryCode, 'AU');
  assert.equal(combined.parks.find(p => p.name === 'Banff National Park').id, 'banff');
});
check('query ordering never changes selected source points, IDs, merge or quality notes', () => {
  assert.deepEqual(catalog.combineParks([...records].reverse(), [...query].reverse()), combined);
});
check('missing labels/countries and historic country duplicates remain explicit', () => {
  const missing = combined.parks.find(p => p.name === 'Ndere Island National Park');
  assert.equal(missing.country, 'Country unspecified');
  assert.ok(missing.warnings.some(note => note.includes('country label')));
  assert.ok(combined.parks.find(p => p.name === 'Q125993818').warnings.some(note => note.includes('label unavailable')));
  assert.equal(combined.parks.filter(p => p.name === 'Bayanaul National Park').length, 1);
  assert.ok(combined.parks.find(p => p.name === 'Bayanaul National Park').warnings.some(note => note.includes('Soviet Union')));
  assert.ok(combined.parks.find(p => p.name.includes('Barranca del Cupatitzio')).warnings.length);
  assert.deepEqual([...new Set(combined.parks.filter(p => !p.countryCode).map(p => p.country))].sort(),
    ['Country unspecified', 'State of Mexico', 'West Bank']);
  for (const [name, code] of [
    ['Bosnia and Herzegovina', 'BA'], ['Democratic Republic of the Congo', 'CD'],
    ['Republic of the Congo', 'CG'], ['Saint Kitts and Nevis', 'KN'], ['Myanmar', 'MM'],
    ['Turkey', 'TR'], ['Palestine', 'PS']
  ]) {
    const result = catalog.normalizeWikidata([{ ...query[0], countryLabel: name }]);
    assert.equal(result.parks[0].countryCode, code);
  }
});
check('country-aware matches never collapse unrelated names or nearby parks', () => {
  const fixture = [
    { parkLabel: 'Isalo National Park', countryLabel: 'Madagascar', lat: '-22.6', lon: '45.3' },
    { parkLabel: 'Isalo Foothills National Park', countryLabel: 'Madagascar', lat: '-22.6', lon: '45.31' },
    { parkLabel: 'Isalo National Park', countryLabel: 'Australia', lat: '-20', lon: '130' }
  ];
  const merged = catalog.combineParks(records, fixture);
  assert.equal(merged.matchedCount, 1);
  assert.ok(merged.parks.some(p => p.name === 'Isalo Foothills National Park'));
  assert.ok(merged.parks.some(p => p.countryCode === 'AU' && p.name === 'Isalo National Park'));
});
check('all US territories are excluded from query before coordinate validation', () => {
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  const rows = [...catalog.excludedCountries].map(code => ({ parkLabel: 'Example', countryLabel: names.of(code) }));
  const normalized = catalog.normalizeWikidata(rows);
  assert.equal(normalized.parks.length, 0);
  assert.equal(normalized.excludedCount, rows.length);
});
check('malformed query input fails explicitly instead of inventing coordinates', () => {
  for (const override of [{ lat: '' }, { lon: null }, { lat: true }, { lat: '91' },
    { lon: 'NaN' }, { parkLabel: '' }, { countryLabel: 42 }]) {
    assert.throws(() => catalog.normalizeWikidata([{ ...query[0], ...override }]));
  }
  assert.throws(() => catalog.normalizeWikidata([]));
});
console.log(`${checks} international catalog checks passed.`);
