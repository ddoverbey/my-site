import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as geo from 'd3-geo';
import { feature as decode } from 'topojson-client';
import microStates from './micro-states.js';
import lookups from './coordinate-lookups.js';

let checks = 0;
function check(name, action) {
  action();
  console.log(`PASS ${name}`);
  checks++;
}
const ring = (west, south, east, north) => [[west, south], [east, south], [east, north], [west, north], [west, south]];
const polygon = (coordinates, name, id) => ({ type: 'Feature', id, properties: { name }, geometry: { type: 'Polygon', coordinates } });

const text = await readFile(new URL('./micro-states.topojson', import.meta.url), 'utf8');
const topology = JSON.parse(text);
const features = microStates.validateTopology(topology, decode);
const catalog = microStates.catalog(features);
const microIndex = lookups.indexFeatures(features, geo);
const empty = lookups.indexFeatures([polygon([ring(-1, -1, 1, 1)], 'Null Island')], geo);

check('snapshot covers unclickable micro-states within budget and keeps provenance', () => {
  assert.ok(Buffer.byteLength(text) <= 400000);
  assert.equal(topology.metadata.source, microStates.SOURCE);
  assert.match(topology.metadata.license, /Natural Earth/);
  for (const name of ['Monaco', 'Vatican', 'San Marino', 'Liechtenstein', 'Andorra', 'Malta', 'Singapore', 'Bahrain',
    'Barbados', 'Saint Lucia', 'Grenada', 'Dominica', 'St. Kitts and Nevis', 'Antigua and Barb.']) {
    assert.ok(catalog.some(entry => entry.name === name && entry.key === `c:${name}`), name);
  }
  for (const name of ['France', 'Italy', 'Luxembourg', 'Heard I. and McDonald Is.', 'U.S. Minor Outlying Is.']) {
    assert.ok(!catalog.some(entry => entry.name === name), name);
  }
  assert.deepEqual(catalog.map(entry => entry.name), [...catalog.map(entry => entry.name)].sort((a, b) => a.localeCompare(b)));
});

check('every label point resolves to its own micro-state polygon', () => {
  for (const entry of catalog) {
    const political = lookups.politicalRegion(entry.lat, entry.lng,
      { countries: empty, states: empty, counties: [], microStates: microIndex }, geo.geoContains);
    assert.deepEqual(political.countries, [entry.name], entry.name);
  }
});

check('micro-state polygons override a coarse neighbour that swallows them', () => {
  const france = lookups.indexFeatures([polygon([ring(-5, 42, 8, 51)], 'France')], geo);
  const monaco = catalog.find(entry => entry.name === 'Monaco');
  const indexes = { countries: france, states: [], counties: [], microStates: microIndex };
  assert.deepEqual(lookups.politicalRegion(monaco.lat, monaco.lng, indexes, geo.geoContains).countries, ['Monaco']);
  assert.deepEqual(lookups.politicalRegion(43.7, 7.26, indexes, geo.geoContains).countries, ['France']);
  assert.deepEqual(lookups.politicalRegion(43.7, 7.26, { ...indexes, microStates: undefined }, geo.geoContains).countries, ['France']);
});

check('search resolves common names, aliases, accents, and Natural Earth abbreviations', () => {
  const find = query => catalog.filter(entry => microStates.matches(entry.name, query)).map(entry => entry.name);
  assert.deepEqual(find('Monaco'), ['Monaco']);
  assert.deepEqual(find('vatican city'), ['Vatican']);
  assert.deepEqual(find('Holy See'), ['Vatican']);
  assert.deepEqual(find('Saint Kitts'), ['St. Kitts and Nevis']);
  assert.deepEqual(find('st kitts'), ['St. Kitts and Nevis']);
  assert.deepEqual(find('Antigua and Barbuda'), ['Antigua and Barb.']);
  assert.deepEqual(find('saint vincent and the grenadines'), ['St. Vin. and Gren.']);
  assert.deepEqual(find('grenadines saint vincent'), ['St. Vin. and Gren.']);
  assert.deepEqual(find('US Virgin Islands'), ['U.S. Virgin Is.']);
  assert.deepEqual(find('Faroe'), ['Faeroe Is.']);
  assert.deepEqual(find('sao tome'), ['São Tomé and Principe']);
  assert.deepEqual(find('Curacao'), ['Curaçao']);
  assert.deepEqual(find('St Barts'), ['St-Barthélemy']);
  assert.deepEqual(find('Cape Verde'), ['Cabo Verde']);
  assert.ok(microStates.matches('Dominican Rep.', 'dominican republic'));
  assert.ok(microStates.matches('Bosnia and Herz.', 'Bosnia & Herzegovina'));
  assert.ok(!microStates.matches('Monaco', '   '));
});

check('snapshot validation rejects tampered provenance and malformed records', () => {
  assert.throws(() => microStates.validateTopology({ ...topology, metadata: { ...topology.metadata, source: 'x' } }, decode));
  const broken = JSON.parse(text);
  broken.objects.microStates.geometries[0].properties.lat = 200;
  assert.throws(() => microStates.validateTopology(broken, decode));
  const duplicate = JSON.parse(text);
  duplicate.objects.microStates.geometries[1].properties.name = duplicate.objects.microStates.geometries[0].properties.name;
  assert.throws(() => microStates.validateTopology(duplicate, decode));
});

console.log(`${checks} micro-state checks passed.`);
