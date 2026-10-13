import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import catalog from './nps-catalog.js';
import { collectParks } from './import-nps.mjs';

const records = Array.from({ length: 405 }, (_, index) => ({
  id: `official-${index}`, parkCode: index.toString(36).padStart(4, '0'),
  fullName: `Official unit ${index}`, designation: index % 2 ? 'National Monument' : 'National Seashore',
  description: 'Official description', states: 'WY,MT,ID', url: 'https://www.nps.gov/test/',
  latitude: '44.59824417', longitude: '-110.5471695',
  topics: [{ name: 'Wetlands' }], activities: [{ name: 'Hiking' }]
}));
records[0].parkCode = 'yell';
records[1].latitude = '';
records[1].longitude = '';

let checks = 0;
function check(name, action) {
  action();
  checks++;
  console.log(`PASS ${name}`);
}

const normalized = catalog.normalizeParks(records);
const yellowstone = normalized.find(p => p.id === 'yell');
check('exact API coordinates and official metadata', () => {
  assert.equal(yellowstone.lat, 44.59824417);
  assert.equal(yellowstone.lng, -110.5471695);
  assert.equal(yellowstone.name, records[0].fullName);
  assert.equal(yellowstone.designation, records[0].designation);
  assert.deepEqual(yellowstone.activities, ['Hiking']);
  assert.deepEqual(yellowstone.states, ['Wyoming', 'Montana', 'Idaho']);
});
check('all 405 records and multiple designations retained', () => {
  assert.equal(normalized.length, 405);
  assert.equal(new Set(normalized.map(p => p.designation)).size, 2);
});
check('missing coordinates are null, not zero', () => {
  const unit = normalized.find(p => p.id === records[1].parkCode);
  assert.equal(unit.lat, null);
  assert.equal(unit.lng, null);
  assert.deepEqual(unit.biomes, ['we']);
});
check('state milestones exclude DC and territories without losing official locations', () => {
  assert.equal(catalog.isUsState('Wyoming'), true);
  assert.equal(catalog.isUsState('District of Columbia'), false);
  assert.equal(catalog.isUsState('Virgin Islands'), false);
  const unit = catalog.normalizeParks([{ ...records[0], states: 'DC,VI' }, ...records.slice(1)])
    .find(p => p.id === 'yell');
  assert.deepEqual(unit.states, ['District of Columbia', 'Virgin Islands']);
});
check('legacy saves and combined units preserve visited status', () => {
  assert.deepEqual(catalog.migratePins({ yellowstone: 'v', banff: 'w', sequoia: 'w', kingscanyon: 'v' }),
    { yell: 'v', banff: 'w', seki: 'v' });
  assert.deepEqual(catalog.migratePins({ seki: 'v', sequoia: 'w' }), { seki: 'v' });
});
check('incomplete catalogs rejected', () => {
  assert.throws(() => catalog.normalizeParks(records.slice(0, 399)), /400/);
});
check('duplicate IDs rejected', () => {
  assert.throws(() => catalog.normalizeParks([...records, records[0]]), /duplicate/);
});
check('invalid coordinates rejected', () => {
  assert.throws(() => catalog.normalizeParks([{ ...records[0], latitude: '91' }, ...records.slice(1)]), /coordinates/);
});
check('unsafe official links rejected and display text escaped', () => {
  assert.throws(() => catalog.normalizeParks([{ ...records[0], url: 'javascript:alert(1)' }, ...records.slice(1)]), /Invalid/);
  assert.equal(catalog.escapeHtml('<img src="x"> & \'text\''), '&lt;img src=&quot;x&quot;&gt; &amp; &#39;text&#39;');
});

const starts = [];
const snapshot = await collectParks(async start => {
  starts.push(start);
  return { total: String(records.length), data: records.slice(start, start + 100) };
});
check('pagination fetches the final partial page and preserves raw metadata', () => {
  assert.deepEqual(starts, [0, 100, 200, 300, 400]);
  assert.equal(snapshot.total, 405);
  assert.deepEqual(snapshot.data, records);
  assert.ok(Number.isFinite(Date.parse(snapshot.fetchedAt)));
});
await assert.rejects(collectParks(async () => ({ total: '405', data: [] })), /pagination/);
checks++;
console.log('PASS empty API page rejected');
await assert.rejects(collectParks(async start => ({
  total: start ? '406' : '405', data: records.slice(start, start + 100)
})), /pagination/);
checks++;
console.log('PASS changing API totals rejected');

const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]);
check('every inline script parses', () => scripts.forEach(script => new vm.Script(script)));

const elements = new Map();
function element(id) {
  if (!elements.has(id)) {
    elements.set(id, {
      value: id === 'bucketFilterStatus' ? 'all' : '',
      textContent: '', innerHTML: '', style: {}, dataset: {},
      classList: { add() {}, remove() {} }, addEventListener() {},
      appendChild(child) { this.innerHTML += child.innerHTML; }
    });
  }
  return elements.get(id);
}
const context = vm.createContext({
  NpsCatalog: catalog, tailwind: {}, console, URLSearchParams, setTimeout() {},
  document: { getElementById: element, querySelectorAll: () => [], createElement: () => ({ innerHTML: '' }) },
  window: { addEventListener() {} },
  fetch: async () => ({ ok: true, json: async () => snapshot })
});
scripts.forEach(script => vm.runInContext(script, context));
await vm.runInContext('loadNpsCatalog()', context);
check('app loads the complete snapshot without a player API key', () => {
  assert.equal(vm.runInContext('PARKS.length', context), 417);
  assert.ok(element('npsCatalogStatus').textContent.includes('405 official NPS'));
});
vm.runInContext("AppState.pins = NpsCatalog.migratePins({ yellowstone: 'v' }); updateHud();", context);
check('dynamic counters and multi-state stats', () => {
  assert.equal(element('hudParksCount').textContent, '1 / 405');
  assert.equal(vm.runInContext('calculateStats().statesCount', context), 3);
  assert.equal(vm.runInContext("ACHIEVEMENTS.find(a => a.id === 'park_63').req(calculateStats())", context), false);
  assert.equal(vm.runInContext("QUESTLINES.find(q => q.id === 'giants').parkIds.length", context), 3);
});
element('bucketSearch').value = 'national seashore';
vm.runInContext('renderBucketListView()', context);
check('ledger searches official designations', () => {
  assert.ok(element('bucketListGrid').innerHTML.includes('National Seashore'));
  assert.ok(!element('bucketListGrid').innerHTML.includes('National Monument'));
});
check('popup escapes API text and shows metadata', () => {
  const popup = vm.runInContext("createPopupContent({ ...PARKS[0], name: '<img src=x onerror=alert(1)>', desc: '<script>bad</script>' })", context);
  assert.ok(popup.includes('&lt;img'));
  assert.ok(!popup.includes('<script>bad'));
  assert.ok(popup.includes('Official NPS site'));
});
context.fetch = async () => ({ ok: false, status: 404 });
context.console = { error() {} };
await vm.runInContext('loadNpsCatalog()', context);
check('catalog failures are surfaced', () => {
  assert.ok(element('npsCatalogStatus').textContent.includes('unavailable'));
  assert.equal(element('toastTitle').textContent, 'NPS catalog unavailable');
});
console.log(`${checks} checks passed.`);
