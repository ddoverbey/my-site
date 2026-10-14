import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import catalog from './nps-catalog.js';
import ecoregions from './ecoregions.js';
import internationalCatalog from './international-parks.js';
import { collectParks } from './import-nps.mjs';
const worldwide = JSON.parse(await readFile(new URL('./worldwide-national-parks.json', import.meta.url), 'utf8'));
const wikidata = JSON.parse(await readFile(new URL('./wikidata-national-parks-query.json', import.meta.url), 'utf8'));
const internationalParks = internationalCatalog.combineParks(worldwide, wikidata).parks;

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
  assert.deepEqual(unit.biomes, []);
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
      classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {},
      appendChild(child) { this.innerHTML += child.innerHTML; }
    });
  }
  return elements.get(id);
}
const context = vm.createContext({
  NpsCatalog: catalog, Ecoregions: ecoregions, InternationalParks: internationalCatalog,
  tailwind: {}, console, Intl, URL, URLSearchParams, setTimeout() {},
  document: { getElementById: element, querySelectorAll: () => [], createElement: () => ({ innerHTML: '' }) },
  window: { addEventListener() {} },
  fetch: async url => ({ ok: true, json: async () => url.includes('wikidata') ? wikidata : url.includes('worldwide') ? worldwide : snapshot })
});
scripts.forEach(script => vm.runInContext(script, context));
check('destination pins default to None and the fog toggle is not rendered', () => {
  assert.equal(vm.runInContext('AppState.pinFilter', context), 'none');
  const activeHtml = html.replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(!activeHtml.includes('id="fogToggleCheckbox"'));
  assert.ok(activeHtml.includes('data-filt="none" aria-pressed="true"'));
});
await vm.runInContext('loadNpsCatalog()', context);
await vm.runInContext('loadWorldwideCatalog()', context);
check('app loads the complete snapshot without a player API key', () => {
  assert.equal(vm.runInContext('PARKS.length', context), 405 + internationalParks.length);
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
const actualSnapshot = JSON.parse(await readFile(new URL('./nps-parks.json', import.meta.url), 'utf8'));
const actualBiomes = JSON.parse(await readFile(new URL('./ecoregion-mapping.json', import.meta.url), 'utf8'));
context.fetch = async url => ({
  ok: true, json: async () => url.includes('ecoregion-mapping') ? actualBiomes : url.includes('wikidata') ? wikidata : url.includes('worldwide') ? worldwide : actualSnapshot
});
await vm.runInContext('loadNpsCatalog();', context);
await vm.runInContext('loadWorldwideCatalog();', context);
await vm.runInContext('loadBiomeCatalog();', context);
check('published dataset, all legacy targets and real ecoregion mappings load', () => {
  assert.ok(actualSnapshot.total >= 400);
  assert.equal(vm.runInContext('PARKS.length', context), actualSnapshot.total + internationalParks.length);
  assert.equal(vm.runInContext('PARKS.filter(p => p.biomeStatus === "matched").length', context),
    Object.values(actualBiomes.locations).filter(p => p.status === 'matched').length);
  assert.equal(vm.runInContext('PARKS.filter(p => p.biomeStatus === "mapping-outdated").length', context), 0);
  const actualParks = catalog.normalizeParks(actualSnapshot.data);
  for (const code of Object.values(catalog.aliases)) assert.ok(actualParks.some(p => p.id === code), code);
});
vm.runInContext("AppState.pins = NpsCatalog.migratePins({ yellowstone: 'v', everglades: 'v', arches: 'w', drytortugas: 'v' }); updateHud();", context);
check('real visits collect only intersected biomes; wishlist and offshore points do not', () => {
  assert.equal(element('hudParksCount').textContent, `3 / ${actualSnapshot.total}`);
  assert.equal(element('hudBiomesCount').textContent, '2 / 14');
  assert.deepEqual(Array.from(vm.runInContext('calculateStats().biomesSet', context)).sort(), ['14', '5']);
  assert.equal(vm.runInContext('calculateStats().rareBiomesCount', context), 1);
  assert.ok(vm.runInContext("createPopupContent(PARKS.find(p => p.id === 'ever'))", context).includes('Bahamian-Antillean mangroves'));
});
element('bucketSearch').value = 'south central rockies';
vm.runInContext('renderBucketListView()', context);
check('search finds real ecoregions and displays terrestrial biome labels', () => {
  assert.ok(element('bucketListGrid').innerHTML.includes('Yellowstone'));
  assert.ok(element('bucketListGrid').innerHTML.includes('Temperate Conifer Forests'));
});
vm.runInContext('renderPassportView()', context);
check('pokedex and rare totals use the 14 real biome types', () => {
  assert.equal(element('biomeCompletionRatio').textContent, '2 / 14 Found');
  assert.equal(element('statRareTotal').textContent, 'of 3 rare biomes');
  assert.ok(element('biomePokedexContainer').innerHTML.includes('0.23% of classified biome land'));
  assert.ok(!element('biomePokedexContainer').innerHTML.includes('Subterranean Cavern'));
});
vm.runInContext("AppState.pins = { fiordland: 'v', retired_destination: 'v', 'world-af-band-e-amir': 'v', npsa: 'v' }; updateHud();", context);
check('international visits, retired saves and NPS-only US counts stay distinct', () => {
  assert.equal(vm.runInContext('calculateStats().usParksCount', context), 1);
  assert.equal(vm.runInContext('calculateStats().visitedParks.length', context), 3);
  assert.equal(vm.runInContext('calculateStats().countriesCount', context), 3);
  assert.ok(element('savedCatalogStatus').textContent.includes('1 saved destination'));
  assert.equal(vm.runInContext('AppState.pins.retired_destination', context), 'v');
});
element('bucketSearch').value = 'afghanistan';
vm.runInContext('renderBucketListView()', context);
check('international ledger searches countries and shows attributed source metadata', () => {
  assert.ok(element('bucketListGrid').innerHTML.includes('Band-e Amir'));
  assert.ok(element('bucketListGrid').innerHTML.includes('Parks of the World'));
  assert.ok(!element('bucketListGrid').innerHTML.includes('Official NPS site'));
  assert.ok(element('bucketListGrid').innerHTML.includes('Established: 2009'));
  const popup = vm.runInContext("createPopupContent(PARKS.find(p => p.id === 'world-al-butrint'))", context);
  assert.ok(popup.includes('UNESCO World Heritage'));
  assert.ok(popup.includes('Park information source'));
});
context.fetch = async url => url.includes('worldwide') || url.includes('wikidata')
  ? { ok: false, status: 404 }
  : { ok: true, json: async () => actualSnapshot };
context.console = { error() {} };
await vm.runInContext('loadWorldwideCatalog()', context);
check('international loading failures preserve NPS data and saved international records', () => {
  assert.equal(vm.runInContext('PARKS.length', context), actualSnapshot.total);
  assert.equal(vm.runInContext('AppState.pins.fiordland', context), 'v');
  assert.ok(element('worldwideCatalogStatus').textContent.includes('unavailable'));
});
context.fetch = async url => ({
  ok: true, json: async () => url.includes('wikidata') ? wikidata : url.includes('worldwide') ? worldwide : actualBiomes
});
await vm.runInContext('loadWorldwideCatalog();', context);
await vm.runInContext('loadBiomeCatalog();', context);
check('Wikidata destinations have distinct provenance and searchable country metadata', () => {
  const popup = vm.runInContext("createPopupContent(PARKS.find(p => p.name === 'Banff National Park'))", context);
  assert.ok(popup.includes('Wikidata query'));
  assert.ok(!popup.includes('Parks of the World'));
  assert.ok(!popup.includes('Official NPS site'));
  assert.ok(element('wikidataCatalogStatus').textContent.includes('curated overlaps merged'));
});
vm.runInContext("AppState.pins = Object.fromEntries(PARKS.filter(p => p.intl && !p.countryCode).map(p => [p.id, 'v']));", context);
check('unknown and non-country labels count as visits, never fabricated country credit', () => {
  assert.ok(vm.runInContext('calculateStats().visitedParks.length', context) > 0);
  assert.equal(vm.runInContext('calculateStats().countriesCount', context), 0);
});
context.fetch = async url => url.includes('wikidata') ? { ok: false, status: 503 } :
  { ok: true, json: async () => worldwide };
await vm.runInContext('loadWorldwideCatalog()', context);
check('Wikidata failure retains curated parks and NPS while reporting partial coverage', () => {
  assert.equal(vm.runInContext('PARKS.length', context), actualSnapshot.total + 72);
  assert.equal(vm.runInContext('wikidataCatalogLoaded', context), false);
  assert.ok(element('wikidataCatalogStatus').textContent.includes('unavailable'));
  assert.ok(vm.runInContext("PARKS.some(p => p.id === 'fiordland')", context));
});
context.fetch = async url => url.includes('worldwide') ? { ok: false, status: 503 } :
  { ok: true, json: async () => wikidata };
await vm.runInContext('loadWorldwideCatalog()', context);
check('curated source failure does not discard independently loaded Wikidata parks', () => {
  assert.equal(vm.runInContext('PARKS.length', context), actualSnapshot.total + internationalCatalog.normalizeWikidata(wikidata).parks.length);
  assert.equal(vm.runInContext('worldwideCatalogLoaded', context), false);
  assert.equal(vm.runInContext('wikidataCatalogLoaded', context), true);
});
context.fetch = async url => ({
  ok: true, json: async () => url.includes('wikidata') ? wikidata : url.includes('worldwide') ? worldwide : actualBiomes
});
await vm.runInContext('loadWorldwideCatalog();', context);
await vm.runInContext('loadBiomeCatalog();', context);
vm.runInContext("AppState.pins = { yell: 'v', ever: 'v', drto: 'v' }; updateHud();", context);
context.fetch = async () => ({ ok: false, status: 404 });
context.console = { error() {} };
await vm.runInContext('loadBiomeCatalog()', context);
vm.runInContext('updateHud()', context);
check('biome fetch failures disable collection and bonuses, not park progress', () => {
  assert.equal(element('hudBiomesCount').textContent, '-- / 14');
  assert.equal(element('hudParksCount').textContent, `3 / ${actualSnapshot.total}`);
  assert.equal(vm.runInContext('calculateStats().biomesSet.size', context), 0);
  assert.ok(element('biomeCatalogStatus').textContent.includes('disabled'));
  assert.equal(element('toastTitle').textContent, 'Biome data unavailable');
});
context.fetch = async () => ({ ok: false, status: 404 });
context.console = { error() {} };
await vm.runInContext('loadNpsCatalog()', context);
check('catalog failures are surfaced', () => {
  assert.ok(element('npsCatalogStatus').textContent.includes('unavailable'));
  assert.equal(element('toastTitle').textContent, 'NPS catalog unavailable');
});
check('dataset status lives inside Settings rather than over the map legend', () => {
  const settings = html.slice(html.indexOf('<details id="settingsMenu"'), html.indexOf('</details>'));
  assert.ok(settings.includes('id="npsCatalogStatus"'));
  assert.ok(settings.includes('id="btnRetryNps"'));
  assert.ok(settings.includes('aria-label="Settings"'));
  assert.ok(html.includes('isolate z-0 overflow-hidden'));
});
vm.runInContext(`
  map = {
    options: { crs: { scale: zoom => 256 * Math.pow(2, zoom) } },
    getZoom: () => 4,
    getSize: () => ({ x: 800, y: 600 }),
    getZoomScale: zoom => Math.pow(2, zoom - 4),
    getCenter: () => ({ lat: 0, lng: 0 }),
    project: (point, zoom) => ({
      x: point.lng * Math.pow(2, zoom), y: point.lat * Math.pow(2, zoom),
      subtract(other) { return { x: this.x - other.x, y: this.y - other.y }; }
    }),
    latLngToContainerPoint: () => ({ x: -500, y: 300 })
  };
  fogCanvas = document.getElementById('fogCanvasOverlay');
`, context);
check('fog radius scales continuously with zoom without a 25-pixel floor', () => {
  const radius = vm.runInContext('calculatePixelRadius(0, 85)', context);
  assert.ok(radius < 25 && radius > 0);
  vm.runInContext('map.getZoom = () => 5;', context);
  assert.equal(vm.runInContext('calculatePixelRadius(0, 85)', context), radius * 2);
  vm.runInContext('map.getZoom = () => 4;', context);
});
check('zoom bitmap overscan and transforms follow Leaflet scale and target center', () => {
  vm.runInContext('resizeFogCanvas(); animateFogZoom({ zoom: 5, center: { lat: 1, lng: 2 } });', context);
  assert.equal(element('fogCanvasOverlay').width, 2400);
  assert.equal(element('fogCanvasOverlay').height, 1800);
  assert.equal(element('fogCanvasOverlay').style.left, '-800px');
  assert.equal(element('fogCanvasOverlay').style.transformOrigin, '1200px 900px');
  assert.equal(element('fogCanvasOverlay').style.transform, 'translate(-64px, -32px) scale(2)');
  assert.equal(vm.runInContext('fogZoomAnimating', context), true);
});
context.fogOperations = [];
vm.runInContext(`
  fogCtx = {
    setTransform(...args) { fogOperations.push(['transform', ...args]); },
    clearRect(...args) { fogOperations.push(['clear', ...args]); },
    fillRect(...args) { fogOperations.push(['fill', ...args]); },
    createRadialGradient() { return { addColorStop() {} }; },
    beginPath() {}, arc(...args) { fogOperations.push(['arc', ...args]); }, fill() {}
  };
  document.getElementById('fogToggleCheckbox').checked = true;
  AppState.mode = 'rpg';
  drawFogOfWar();
`, context);
check('fog redraws do not interrupt a running zoom animation', () => {
  assert.equal(context.fogOperations.length, 0);
});
vm.runInContext(`
  fogZoomAnimating = false;
  AppState.homeBase = null;
  PARKS = [{ id: 'edge', lat: 0, lng: 0 }];
  AppState.pins = { edge: 'v' };
  map.getZoom = () => 10;
  drawFogOfWar();
`, context);
check('offscreen clearings are culled by their radius, not a fixed 200-pixel cutoff', () => {
  assert.equal(context.fogOperations.filter(operation => operation[0] === 'arc').length, 1);
  assert.ok(context.fogOperations.some(operation => operation[0] === 'transform' && operation[5] === 800 && operation[6] === 600));
});
context.removedMarkers = [];
context.L = {
  circleMarker: () => ({
    addTo() { return this; }, bindTooltip() {}, bindPopup() {}
  })
};
vm.runInContext(`
  map.removeLayer = marker => removedMarkers.push(marker);
  PARKS = [
    { id: 'visited', lat: 1, lng: 1, name: 'Visited' },
    { id: 'wish', lat: 2, lng: 2, name: 'Wishlist' },
    { id: 'unknown', lat: 3, lng: 3, name: 'Unknown' }
  ];
  AppState.pins = { visited: 'v', wish: 'w' };
`, context);
check('all pin filters work and None removes previously rendered markers', () => {
  for (const [filter, ids] of [
    ['all', ['visited', 'wish', 'unknown']], ['v', ['visited']], ['w', ['wish']], ['none', []]
  ]) {
    vm.runInContext(`AppState.pinFilter = '${filter}'; renderParkMarkers();`, context);
    assert.deepEqual(Array.from(vm.runInContext('Object.keys(leafletMarkers)', context)), ids);
  }
  assert.equal(context.removedMarkers.length, 5);
  assert.equal(vm.runInContext('AppState.pins.visited', context), 'v');
});
context.fogOperations.length = 0;
vm.runInContext(`
  AppState.mode = 'classic';
  document.getElementById('fogToggleCheckbox').checked = false;
  drawFogOfWar();
`, context);
check('fog cannot be removed by classic mode or the disabled checkbox hooks', () => {
  assert.ok(context.fogOperations.some(operation => operation[0] === 'fill'));
});
console.log(`${checks} checks passed.`);
