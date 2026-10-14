import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import catalog from './nps-catalog.js';
import ecoregions from './ecoregions.js';
import internationalCatalog from './international-parks.js';
import coordinateLookups from './coordinate-lookups.js';
import travelLedger from './travel-ledger.js';
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
const expeditionUi = await readFile(new URL('./expedition-ui.js', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(match => match[0].includes('src="./expedition-ui.js"') ? expeditionUi : match[1]);
check('every inline script parses', () => scripts.forEach(script => new vm.Script(script)));

const elements = new Map();
function element(id) {
  if (!elements.has(id)) {
    elements.set(id, {
      value: ['bucketFilterStatus', 'bucketFilterType'].includes(id) ? 'all' : '',
      textContent: '', innerHTML: '', style: {}, dataset: {},
      classList: { add() {}, remove() {}, toggle() {} },
      handlers: {}, addEventListener(name, handler) { this.handlers[name] = handler; },
      querySelectorAll: () => [], focus() {},
      replaceChildren() { this.innerHTML = ''; }, reset() {}, setAttribute() {},
      appendChild(child) { this.innerHTML += child.innerHTML; }
    });
  }
  return elements.get(id);
}
const context = vm.createContext({
  NpsCatalog: catalog, Ecoregions: ecoregions, InternationalParks: internationalCatalog, CoordinateLookups: coordinateLookups, TravelLedger: travelLedger,
  WanderlogConfig: { rarityEndpoint: 'https://api.devonoverbey.com/rarity' },
  tailwind: {}, console, Intl, URL, URLSearchParams, setTimeout() {},
  document: { body: { classList: { toggle() {}, add() {}, remove() {} } }, getElementById: element, querySelectorAll: () => [], createElement: () => element(`created-${elements.size}`) },
  window: { addEventListener() {}, matchMedia: () => ({ matches: true }) },
  fetch: async url => ({ ok: true, json: async () => url.includes('wikidata') ? wikidata : url.includes('worldwide') ? worldwide : snapshot })
});
scripts.forEach(script => vm.runInContext(script, context));
check('header navigation uses compact icons with accessible labels and synchronized pressed states', () => {
  for (const label of ['Explore — RPG mode', 'Travel Ledger — Classic mode', 'Scratch Map', 'Explorer Profile — Character & Stats']) {
    assert.ok(html.includes(`aria-label="${label}"`));
    assert.ok(html.includes(`title="${label}"`));
  }
  assert.ok(!html.includes('<span class="hidden md:inline">RPG Explorer</span>'));
  assert.ok(html.includes('.header-icon:focus-visible'));
  assert.ok(!html.includes('data-tab="map"'));
  const originalQuery = context.document.querySelectorAll;
  const buttons = ['map', 'scratch', 'passport'].map(tab => ({
    dataset: { tab }, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; }
  }));
  context.document.querySelectorAll = selector => selector === '#navTabs button' ? buttons : originalQuery(selector);
  const modeAttributes = {};
  const originalSet = element('toggleClassicMode').setAttribute;
  element('toggleClassicMode').setAttribute = (name, value) => { modeAttributes[name] = value; };
  vm.runInContext("AppState.mode='classic';AppState.currentTab='scratch';updateHeaderNavigation()", context);
  assert.equal(modeAttributes['aria-pressed'], 'true');
  assert.deepEqual(buttons.map(button => button.attributes['aria-pressed']), ['false', 'true', 'false']);
  vm.runInContext("AppState.mode='rpg';AppState.currentTab='map';updateHeaderNavigation()", context);
  assert.equal(modeAttributes['aria-pressed'], 'false');
  assert.deepEqual(buttons.map(button => button.attributes['aria-pressed']), ['true', 'false', 'false']);
  context.document.querySelectorAll = originalQuery;
  element('toggleClassicMode').setAttribute = originalSet;
});
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
  assert.ok(vm.runInContext("ACHIEVEMENTS.find(a => a.id === 'nps').progress(calculateStats()) < ACHIEVEMENTS.find(a => a.id === 'nps').tiers[0].goal(calculateStats())", context));
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
  assert.equal(vm.runInContext('calculatePixelRadius(90, 85)', context),
    vm.runInContext('calculatePixelRadius(85.05112878, 85)', context));
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
context.markerOptions = [];
context.L = {
  circleMarker: (point, options) => {
    context.markerOptions.push(options);
    return { addTo() { return this; }, bindTooltip() {}, bindPopup() {}, on() {} };
  }
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
  assert.ok(context.markerOptions.every(options => options.pane === 'destinationMarkerPane'));
  assert.equal(vm.runInContext('AppState.pins.visited', context), 'v');
});
context.fogOperations.length = 0;
vm.runInContext(`
  AppState.mode = 'classic';
  document.getElementById('fogToggleCheckbox').checked = false;
  drawFogOfWar();
`, context);
check('classic mode clears the canvas and skips shroud painting while RPG still ignores the disabled checkbox', () => {
  assert.ok(context.fogOperations.some(operation => operation[0] === 'clear'));
  assert.ok(!context.fogOperations.some(operation => operation[0] === 'fill'));
  assert.ok(html.includes('.mode-classic #fogCanvasOverlay {'));
  context.fogOperations.length = 0;
  vm.runInContext("AppState.mode='rpg';drawFogOfWar()", context);
  assert.ok(context.fogOperations.some(operation => operation[0] === 'fill'));
});

const customLocation = {
  id: 'custom-reference', name: 'Colosseum <test>', lat: 41.8902, lng: 12.4922, status: 'v',
  elevation: { meters: 100, feet: 328.084 }, political: { countries: ['Italy'], states: [], counties: [] },
  ecoregions: [{ id: 1, name: 'Italian forests', biomeId: 12, realm: 'Palearctic' }],
  biomes: ['12'], biomeStatus: 'matched',
  rarity: { method: 'osm-poi-density', category: 'Deep Cut', nearbyPoiCount: 30, nearestHighwayKm: null },
  lookedUpAt: new Date().toISOString()
};
context.customLocation = travelLedger.normalizePoi(customLocation, coordinateLookups);
vm.runInContext(`
  AppState.customLocations = [customLocation];
  AppState.pins = {};
  AppState.regions = {};
  AppState.homeBase = null;
  BIOMES = Ecoregions.biomeDefinitions();
  BIOMES['12'].xp = 30;
  PARKS = [{ id: 'yose', name: 'Yosemite', lat: 37.75, lng: -119.59, biomes: [] }];
`, context);
check('custom coordinates collect real biomes and countries without counting as NPS visits or park achievements', () => {
  assert.equal(vm.runInContext('calculateStats().usParksCount', context), 0);
  assert.equal(vm.runInContext('calculateStats().visitedParks.length', context), 0);
  assert.equal(vm.runInContext('calculateStats().countriesCount', context), 1);
  assert.deepEqual(Array.from(vm.runInContext('calculateStats().biomesSet', context)), ['12']);
  assert.equal(vm.runInContext('calculateStats().xp', context), 75);
  vm.runInContext("AppState.customLocations[0].status = 'w'", context);
  assert.equal(vm.runInContext('calculateStats().countriesCount', context), 0);
  assert.equal(vm.runInContext('calculateStats().biomesSet.size', context), 0);
  vm.runInContext("AppState.customLocations[0].status = 'v'", context);
});
element('bucketSearch').value = 'italian forests';
vm.runInContext('renderBucketListView()', context);
check('custom ledger and popup show elevation, regions, source credits, and clearly labeled density estimates', () => {
  assert.ok(element('bucketListGrid').innerHTML.includes('Colosseum &lt;test&gt;'));
  assert.ok(element('bucketListGrid').innerHTML.includes('328 ft'));
  assert.ok(element('bucketListGrid').innerHTML.includes('OSM rarity estimate'));
  assert.ok(element('bucketListGrid').innerHTML.includes('not review-count popularity'));
  const popup = vm.runInContext('createPopupContent(customDestinations()[0])', context);
  assert.ok(popup.includes('OpenStreetMap contributors'));
  assert.ok(!popup.includes('Official NPS'));
});
let savedJson;
context.localStorage = {
  setItem(key, value) { savedJson = value; },
  getItem() { return savedJson; }
};
context.window.location = { search: '' };
context.atob = value => Buffer.from(value, 'base64').toString('binary');
vm.runInContext('saveState(); AppState.customLocations = []; loadPersistedState();', context);
check('custom metadata survives local save/load and read-only shared passports; legacy files default to empty custom locations', () => {
  assert.equal(vm.runInContext('AppState.customLocations[0].name', context), customLocation.name);
  assert.equal(JSON.parse(savedJson).version, 2);
  assert.equal(vm.runInContext('AppState.customLocations[0].rarity.reviewCount', context), null);
  assert.equal(vm.runInContext('AppState.customLocations[0].rarity.rarityTier', context), 'Deep Cut');
  context.window.location.search = '?d=' + encodeURIComponent(Buffer.from(encodeURIComponent(savedJson)).toString('base64'));
  vm.runInContext('AppState.customLocations = []; loadPersistedState()', context);
  assert.equal(vm.runInContext('AppState.viewOnly', context), true);
  assert.equal(vm.runInContext('AppState.customLocations.length', context), 1);
  const before = savedJson;
  vm.runInContext("setPinStatus('custom-reference', 'un')", context);
  assert.equal(vm.runInContext('AppState.customLocations.length', context), 1);
  assert.equal(savedJson, before);
  context.window.location.search = '';
  savedJson = '{"pins":{},"regions":{}}';
  vm.runInContext('AppState.viewOnly = false; loadPersistedState()', context);
  assert.equal(vm.runInContext('AppState.customLocations.length', context), 0);
});
context.fogOperations.length = 0;
vm.runInContext(`
  fogCtx.moveTo = (...args) => fogOperations.push(['moveTo', ...args]);
  fogCtx.lineTo = (...args) => fogOperations.push(['lineTo', ...args]);
  fogCtx.closePath = () => fogOperations.push(['closePath']);
  fogCtx.fill = rule => fogOperations.push(['polygonFill', rule, fogCtx.shadowBlur]);
  fogCtx.stroke = () => fogOperations.push(['stroke', fogCtx.lineWidth, fogCtx.lineCap]);
  npsBoundariesByCode = { yose: [{ type: 'Polygon', coordinates: [[[-120,37],[-119,37],[-119,38],[-120,37]]] }] };
  PARKS = [{ id: 'yose', lat: null, lng: null }];
  AppState.pins = { yose: 'v' };
  drawFogOfWar();
`, context);
check('visited NPS boundaries replace radial auras, retain parks without points, and use a zoom-scaled 10 km feather', () => {
  assert.equal(context.fogOperations.filter(operation => operation[0] === 'arc').length, 0);
  const fill = context.fogOperations.find(operation => operation[0] === 'polygonFill');
  assert.equal(fill[1], 'evenodd');
  assert.equal(fill[2], vm.runInContext('calculatePixelRadius(37, 10)', context));
});
context.fogOperations.length = 0;
vm.runInContext(`
  PARKS = [{ id: 'wiki-reference', lat: 41.89, lng: 12.49, intl: true }];
  AppState.pins = { 'wiki-reference': 'v' };
  drawFogOfWar();
`, context);
check('international point destinations keep their existing radial fallback', () => {
  assert.equal(context.fogOperations.filter(operation => operation[0] === 'arc').length, 1);
  assert.equal(context.fogOperations.filter(operation => operation[0] === 'polygonFill' && operation[1] === 'evenodd').length, 0);
});
context.fogOperations.length = 0;
vm.runInContext(`
  PARKS = [];
  AppState.customLocations = [{ ...customLocation, status: 'w' }];
  drawFogOfWar();
`, context);
check('wishlist custom pins do not clear fog', () => {
  assert.equal(context.fogOperations.filter(operation => operation[0] === 'arc').length, 0);
});
context.fogOperations.length = 0;
vm.runInContext(`
  AppState.customLocations = [];
  AppState.routes = [[[37,-120],[38,-119]]];
  drawFogOfWar();
  AppState.routes = [];
`, context);
check('existing route corridors remain round-capped and 40 km wide', () => {
  const stroke = context.fogOperations.find(operation => operation[0] === 'stroke');
  assert.equal(stroke[1], vm.runInContext('calculatePixelRadius(37.5, 40)', context));
  assert.equal(stroke[2], 'round');
});
context.CoordinateLookups = { ...coordinateLookups, lookupCoordinate: async () => customLocation };
context.crypto = { randomUUID: () => 'saved-reference' };
context.d3 = { geoContains() {} };
vm.runInContext('coordinateIndexes = null; AppState.customLocations = [];', context);
element('customLocationName').value = 'Colosseum';
element('customLocationLat').value = '41.8902';
element('customLocationLng').value = '12.4922';
element('customLocationStatus').value = 'v';
await element('customLocationForm').handlers.submit({ preventDefault() {} });
check('the custom-coordinate form saves only after lookup completion', () => {
  assert.equal(vm.runInContext('AppState.customLocations.length', context), 1);
  assert.equal(JSON.parse(savedJson).customPois[0].id, 'poi_saved-reference');
});
context.CoordinateLookups.lookupCoordinate = async () => { throw new Error('Overpass HTTP 503'); };
await element('customLocationForm').handlers.submit({ preventDefault() {} });
check('lookup failure leaves saved pins unchanged and presents a retryable error', () => {
  assert.equal(vm.runInContext('AppState.customLocations.length', context), 1);
  assert.ok(element('customLocationLookupStatus').textContent.includes('Not saved'));
  assert.ok(element('customLocationLookupStatus').textContent.includes('503'));
});
context.CoordinateLookups.lookupCoordinate = async () => customLocation;
context.crypto.randomUUID = () => 'another-reference';
context.localStorage.setItem = () => { throw new Error('Storage full'); };
await element('customLocationForm').handlers.submit({ preventDefault() {} });
check('failed persistence rolls back a new custom location rather than leaving an unsaved success', () => {
  assert.equal(vm.runInContext('AppState.customLocations.length', context), 1);
  assert.ok(element('customLocationLookupStatus').textContent.includes('Storage full'));
});
check('provider review metadata displays independently of OSM estimates and escapes provider names', () => {
  context.providerLocation = {
    ...customLocation,
    rarity: {
      placeName: '<script>Matched place</script>', reviewCount: 10001, popularityScore: 10001,
      rarityTier: 'Tourist Trap', matchedLat: customLocation.lat, matchedLng: customLocation.lng,
      cached: true, source: '<b>Licensed provider</b>'
    }
  };
  const metadata = vm.runInContext('customLocationMetadata({...providerLocation,custom:true})', context);
  assert.ok(metadata.includes('10,001 reviews'));
  assert.ok(metadata.includes('&lt;b&gt;Licensed provider&lt;/b&gt;'));
  assert.ok(metadata.includes('&lt;script&gt;'));
  assert.ok(!metadata.includes('mapped POI nodes'));
});
context.localStorage.setItem = (key, value) => { savedJson = value; };
savedJson = '{"version":3,"pins":{"yose":"v"}}';
vm.runInContext('AppState.viewOnly=false; loadPersistedState(); saveState();', context);
check('future passport versions are surfaced and cannot overwrite the original stored data', () => {
  assert.equal(savedJson, '{"version":3,"pins":{"yose":"v"}}');
  assert.equal(vm.runInContext('AppState.viewOnly', context), true);
  assert.equal(element('toastTitle').textContent, 'Saved passport unavailable');
});
vm.runInContext(`
  AppState.viewOnly=false;
  applyPassport(migratePassport({}));
  PARKS = [{id:'test',name:'Test park',lat:37,lng:-120,biomes:[],states:['California']}];
  coordinateIndexes=null;
`, context);
check('zero-progress achievements are entirely absent and started achievements show exact progress', () => {
  vm.runInContext('renderPassportView()', context);
  assert.equal(element('achievementsContainer').innerHTML,
    '<p class="col-span-full text-xs italic text-slate-400">Venture out into the fog to uncover hidden achievements.</p>');
  vm.runInContext("AppState.pins.test='v'; renderPassportView()", context);
  assert.ok(element('achievementsContainer').innerHTML.includes('Trailblazer'));
  assert.ok(element('achievementsContainer').innerHTML.includes('value="1" max="5"'));
  assert.ok(!element('achievementsContainer').innerHTML.includes('The Overlander'));
  assert.ok(!element('achievementsContainer').innerHTML.includes('Subterranean Sky'));
  assert.ok(!element('achievementsContainer').innerHTML.includes('Venture out'));
});
check('transited destinations clear exactly 60 percent of visited aura radius without visited stats', () => {
  vm.runInContext("AppState.pins={test:'t'};AppState.regions={};AppState.counties={}", context);
  context.fogOperations.length = 0;
  vm.runInContext('drawFogOfWar()', context);
  const radius = context.fogOperations.find(operation => operation[0] === 'arc')[3];
  assert.equal(radius, vm.runInContext('calculatePixelRadius(37,85*0.6)', context));
  assert.equal(vm.runInContext('calculateStats().visitedParks.length', context), 0);
  assert.equal(vm.runInContext('calculateStats().statesCount', context), 0);
  vm.runInContext("AppState.pins.test='l'", context);
  assert.equal(vm.runInContext('calculateStats().visitedParks.length', context), 1);
});
check('lived pin cannot be manually cleared or downgraded', () => {
  vm.runInContext("setPinStatus('test','v');setPinStatus('test','un')", context);
  assert.equal(vm.runInContext('AppState.pins.test', context), 'l');
});
check('manual county tiers never clear fog, including existing saved visited and lived marks', () => {
  vm.runInContext(`
    PARKS=[]; AppState.pins={}; AppState.counties={};
    countyFeaturesById['06073']={geometry:{type:'Polygon',coordinates:[[[-120,37],[-119,37],[-119,38],[-120,37]]]}};
  `, context);
  for (const tier of ['w', 't', 'v', 'l']) {
    context.fogOperations.length = 0;
    vm.runInContext(`AppState.counties={'06073':'${tier}'};drawFogOfWar()`, context);
    assert.equal(context.fogOperations.filter(op => op[0] === 'polygonFill' && op[1] === 'evenodd').length, 0);
  }
});
check('county completion counts only visited/lived loaded FIPS records, never transits or unknown IDs', () => {
  vm.runInContext(`
    countyGeoJson=[{id:'06073'},{id:'06065'},{id:'06001'},{id:'06059'}];
    AppState.counties={'06073':'l','06065':'v','06001':'t','06059':'w','99999':'v'};
  `, context);
  assert.equal(vm.runInContext('calculateStats().countiesCount', context), 2);
  assert.equal(vm.runInContext('calculateStats().countyTotal', context), 4);
  vm.runInContext('countyGeoJson=null;AppState.counties={"06073":"l"}', context);
});
context.testExpedition = {
  id: 'exp_test', name: '<script>Trip</script>', startDate: '2026-09-01', endDate: '2026-09-01',
  transitTags: ['awd', 'ferry'], purposeTags: ['photography'],
  countyIds: ['06073'], parkIds: [], customPoiIds: [],
  routeCoords: [[37,-120],[38,-119]], minElevationFt: -100, maxElevationFt: 11000
};
vm.runInContext('addExpedition(testExpedition);renderPassportView()', context);
check('expedition history escapes names, shows date/elevation/tags and starts metadata badges', () => {
  const history = element('expeditionHistory').innerHTML;
  assert.ok(history.includes('&lt;script&gt;Trip&lt;/script&gt;'));
  assert.ok(history.includes('2026-09-01'));
  assert.ok(history.includes('-100 to 11,000 ft'));
  assert.ok(history.includes('AWD/Off-Road'));
  assert.ok(history.includes('Photography'));
  const achievements = element('achievementsContainer').innerHTML;
  assert.ok(achievements.includes('Subterranean Sky'));
  assert.ok(achievements.includes('Thin Air'));
  assert.ok(achievements.includes('value="1" max="5"'));
});
check('logged expedition routes join legacy route corridors in the same canvas', () => {
  context.fogOperations.length = 0;
  vm.runInContext('drawFogOfWar()', context);
  assert.equal(context.fogOperations.filter(op => op[0] === 'stroke').length, 1);
  assert.equal(context.fogOperations.filter(op => op[0] === 'polygonFill' && op[1] === 'evenodd').length, 1);
});
check('all ledger fields survive local and shared payload migration', () => {
  vm.runInContext('saveState();applyPassport(migratePassport(JSON.parse(localStorage.getItem("terra_incognita_state"))))', context);
  const saved = JSON.parse(savedJson);
  assert.equal(saved.expeditions.length, 1);
  assert.equal(saved.counties['06073'], 'l');
  assert.ok(Array.isArray(saved.customPois));
  assert.equal(saved.customLocations, undefined);
  assert.equal(saved.clearedCounties, undefined);
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(passportPayload())', context)), saved);
});
check('failed expedition persistence rolls back every promoted region, county, pin and ledger', () => {
  const before = vm.runInContext('JSON.stringify(passportPayload())', context);
  context.localStorage.setItem = () => { throw new Error('Storage full'); };
  assert.throws(() => vm.runInContext(`addExpedition({...testExpedition,id:'exp_second',countyIds:['06065']})`, context), /Storage full/);
  assert.equal(vm.runInContext('JSON.stringify(passportPayload())', context), before);
  context.localStorage.setItem = (key, value) => { savedJson = value; };
});
context.CoordinateLookups = {
  ...coordinateLookups,
  biomeRegion: () => ({ biomes: ['5'] }),
  lookupElevation: async () => ({ feet: 12000 })
};
vm.runInContext(`
  coordinateIndexes={ecoregions:[]};
  expeditionDraft=[
    {kind:'county',id:'06065',name:'Riverside',coords:[33.5,-117.2]},
    {kind:'county',id:'06059',name:'Orange',coords:[33.6,-117.8]},
    {kind:'county',id:'06065',name:'Riverside',coords:[33.5,-117.2]}
  ];
`, context);
element('expeditionName').value = 'Wizard day trip';
element('expeditionStart').value = '2026-09-10';
element('expeditionEnd').value = '2026-09-10';
await element('expeditionForm').handlers.submit({ preventDefault() {} });
check('wizard samples elevation and commits one expedition with ordered coordinates', () => {
  assert.equal(vm.runInContext('AppState.expeditions.length', context), 2);
  assert.equal(vm.runInContext('AppState.expeditions[1].minElevationFt', context), 12000);
  assert.equal(vm.runInContext('AppState.counties["06065"]', context), 'v');
  assert.equal(vm.runInContext('AppState.expeditions[1].routeCoords.length', context), 3);
  assert.equal(vm.runInContext('AppState.expeditions[1].countyIds.length', context), 2);
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(AppState.expeditions[1].routeCoords)', context)),
    [[33.5, -117.2], [33.6, -117.8], [33.5, -117.2]]);
});
context.crypto.randomUUID = () => 'failed-wizard';
context.CoordinateLookups.lookupElevation = async () => { throw new Error('Elevation HTTP 503'); };
vm.runInContext("expeditionDraft=[{kind:'county',id:'06001',name:'Alameda',coords:[37,-122]}]", context);
await element('expeditionForm').handlers.submit({ preventDefault() {} });
check('failed elevation lookup retains draft with no visits, route or expedition persisted', () => {
  assert.equal(vm.runInContext('AppState.expeditions.length', context), 2);
  assert.equal(vm.runInContext('expeditionDraft.length', context), 1);
  assert.equal(vm.runInContext('AppState.counties["06001"]', context), undefined);
  assert.ok(element('expeditionStatus').textContent.includes('Not saved: Elevation HTTP 503'));
});
vm.runInContext('AppState.viewOnly=true', context);
check('read-only passports cannot add expeditions or POIs', () => {
  assert.throws(() => vm.runInContext('addExpedition({...testExpedition,id:"readonly"})', context), /read-only/);
  assert.throws(() => vm.runInContext('addCustomPoi(customLocation)', context), /read-only/);
});
check('achievement families reveal only the highest completed tier and next goal at exact boundaries', () => {
  vm.runInContext(`
    AppState.viewOnly=false; applyPassport(migratePassport({}));
    coordinateIndexes=null; npsCatalogLoaded=true;
    PARKS=Array.from({length:30},(_,i)=>({id:'tier'+i,name:'Park '+i,lat:37,lng:-120,biomes:[],states:[]}));
  `, context);
  for (const [count, shown, hidden] of [
    [1, ['First Steps', 'Trailblazer'], ['Master Ranger', 'Grand Voyager']],
    [4, ['First Steps', 'Trailblazer'], ['Master Ranger', 'Grand Voyager']],
    [5, ['Trailblazer', 'Master Ranger'], ['First Steps', 'Grand Voyager']],
    [15, ['Master Ranger', 'Grand Voyager'], ['First Steps', 'Trailblazer']],
    [30, ['Grand Voyager'], ['First Steps', 'Trailblazer', 'Master Ranger']]
  ]) {
    vm.runInContext(`AppState.pins=Object.fromEntries(PARKS.slice(0,${count}).map(p=>[p.id,'v']));renderPassportView()`, context);
    const cards = element('achievementsContainer').innerHTML;
    for (const name of shown) assert.ok(cards.includes(name), `${count}: ${name}`);
    for (const name of hidden) assert.ok(!cards.includes(name), `${count}: hidden ${name}`);
    assert.equal((cards.match(/<h5[^>]*>Park Ranger<\/h5>/g) || []).length, 1);
  }
  vm.runInContext('npsCatalogLoaded=false;renderPassportView()', context);
  assert.ok(!element('achievementsContainer').innerHTML.includes('Completionist Legend'));
  assert.ok(vm.runInContext('ACHIEVEMENTS.every(a => Array.isArray(a.tiers) && typeof a.progress(calculateStats()) === "number" && !("req" in a))', context));
});

let animationTime = 0;
let animationCallback;
let movementCallback;
let flight;
context.performance = { now: () => animationTime };
context.requestAnimationFrame = callback => { animationCallback = callback; return 1; };
context.cancelAnimationFrame = () => { animationCallback = null; };
context.window.matchMedia = () => ({ matches: false });
context.CoordinateLookups = coordinateLookups;
context.d3.geoContains = () => true;
context.mapFly = (...args) => { flight = args; };
context.mapOnce = (event, callback) => { assert.equal(event, 'moveend'); movementCallback = callback; };
context.L.marker = () => ({ addTo() { return this; }, bindTooltip() {} });
context.L.divIcon = () => ({});
vm.runInContext(`
  applyPassport(migratePassport({})); PARKS=[]; AppState.regions={};
  coordinateIndexes={
    countries:[{feature:{properties:{name:'United States of America'}},bounds:[[-180,-90],[180,90]]}],
    states:[{feature:{properties:{name:'California'}},bounds:[[-180,-90],[180,90]]}],
    counties:[{feature:{id:'06073',properties:{name:'San Diego'}},bounds:[[-180,-90],[180,90]]}]
  };
  map.once=mapOnce;map.flyTo=mapFly;
`, context);
check('first Citadel marks containing geography Lived, uses 80 km, flies at zoom 8 and unlocks Scout', () => {
  vm.runInContext("setHometownCoordinates('Test Citadel',37,-120)", context);
  assert.equal(vm.runInContext('AppState.homeBase.radiusKm', context), 80);
  assert.equal(vm.runInContext('AppState.homeBase.countyId', context), '06073');
  assert.equal(vm.runInContext('AppState.counties["06073"]', context), 'l');
  assert.equal(vm.runInContext('AppState.regions["s:California"]', context), 'l');
  assert.equal(vm.runInContext('calculateStats().cls', context), 'Scout');
  const stats = vm.runInContext('calculateStats()', context);
  assert.equal(stats.xp - stats.statesCount * 10 - stats.countriesCount * 20, 50);
  assert.equal(flight[1], 8);
  assert.equal(flight[2].duration, 1.8);
  assert.ok(element('toastMsg').textContent.includes('+50'));
});
check('home aura pulses on the existing canvas and settles to the exact saved radius', () => {
  movementCallback();
  assert.equal(vm.runInContext('homeAuraPulseStarted', context), 0);
  animationTime = 450;
  context.fogOperations.length = 0;
  animationCallback();
  const arc = context.fogOperations.find(op => op[0] === 'arc');
  assert.ok(Math.abs(arc[3] - vm.runInContext('calculatePixelRadius(37,80)*0.85', context)) < 1e-8);
  animationTime = 1800;
  animationCallback();
  assert.equal(vm.runInContext('homeAuraPulseStarted', context), null);
  assert.equal(vm.runInContext('homeAuraFrame', context), null);
  context.window.matchMedia = () => ({ matches: true });
  vm.runInContext('pulseHomeAura()', context);
  assert.equal(vm.runInContext('homeAuraPulseStarted', context), null);
});
check('changing home never adds another Citadel bonus and saved homes retain their radius', () => {
  const previousXP = vm.runInContext('calculateStats().xp', context);
  vm.runInContext("setHometownCoordinates('Changed Citadel',38,-121)", context);
  assert.equal(vm.runInContext('calculateStats().xp', context), previousXP);
  assert.ok(!element('toastMsg').textContent.includes('+50'));
  vm.runInContext('saveState();loadPersistedState()', context);
  assert.equal(vm.runInContext('AppState.homeBase.radiusKm', context), 80);
  vm.runInContext('AppState.homeBase.radiusKm=75;saveState();loadPersistedState()', context);
  assert.equal(vm.runInContext('AppState.homeBase.radiusKm', context), 75);
});
check('home storage failures roll back geography and never fly or report success', () => {
  const before = vm.runInContext('JSON.stringify(passportPayload())', context);
  flight = null;
  context.localStorage.setItem = () => { throw new Error('Storage full'); };
  assert.throws(() => vm.runInContext("setHometownCoordinates('Failed Citadel',39,-122)", context), /Storage full/);
  assert.equal(vm.runInContext('JSON.stringify(passportPayload())', context), before);
  assert.equal(flight, null);
  context.localStorage.setItem = (key, value) => { savedJson = value; };
});
context.AbortSignal = { timeout: () => undefined };
let geocoderCalls = 0;
context.fetch = async () => {
  geocoderCalls++;
  return { ok: true, json: async () => [{ lat: '40', lon: '-110', display_name: 'New City' }] };
};
context.document.querySelectorAll = selector => selector === '.quick-city-chip' ? [{
  textContent: 'Seattle', dataset: { name: 'Seattle, WA', lat: '47.6062', lng: '-122.3321' }
}] : [];
element('cityInput').value = 'seattle';
await vm.runInContext('searchHometown()', context);
check('known quick-pick cities establish home locally without a geocoder request', () => {
  assert.equal(geocoderCalls, 0);
  assert.equal(vm.runInContext('AppState.homeBase.name', context), 'Seattle, WA');
});
element('cityInput').value = 'New City';
await vm.runInContext('searchHometown()', context);
check('unknown city search offers explicit selection and never auto-assigns San Francisco', () => {
  assert.equal(geocoderCalls, 1);
  assert.equal(vm.runInContext('AppState.homeBase.name', context), 'Seattle, WA');
  assert.ok(element('homeLookupStatus').textContent.includes('Choose your city'));
});
vm.runInContext('lastCitySearch=0', context);
context.fetch = async () => ({ ok: true, json: async () => [{ lat: '', lon: '0', display_name: 'Invalid City' }] });
await vm.runInContext('searchHometown()', context);
check('invalid geocoder coordinates show an error and leave the existing home unchanged', () => {
  assert.ok(element('homeLookupStatus').textContent.includes('Invalid city search coordinates'));
  assert.equal(vm.runInContext('AppState.homeBase.name', context), 'Seattle, WA');
});
const scratchNodes = [];
let scratchFeatures = [];
const projectionCalls = [];
function scratchSelection(tag = 'svg', data = []) {
  const node = { tag, attrs: {}, data };
  scratchNodes.push(node);
  return {
    html() { scratchNodes.length = 0; return this; },
    append(tag) { return scratchSelection(tag, node.data); },
    attr(name, value) { node.attrs[name] = typeof value === 'function' ? node.data.map(value) : value; return this; },
    selectAll() { return this; },
    data(values) { node.data = values; scratchFeatures = values; return this; },
    join() { return this; },
    on(name, handler) { node[name] = handler; return this; },
    text(value) { node.text = typeof value === 'function' ? node.data.map(value) : value; return this; }
  };
}
context.d3 = {
  geoContains: () => true, select: () => scratchSelection(),
  geoAlbersUsa: () => ({ fitSize() { projectionCalls.push('usa'); } }),
  geoNaturalEarth1: () => ({ fitSize() { projectionCalls.push('world'); } }),
  geoPath: () => feature => `path-${feature.id || 'mesh'}`
};
vm.runInContext(`
  AppState.viewOnly=false;applyPassport(migratePassport({}));
  coordinateIndexes=null;map=null;PARKS=[];
  worldGeoJson=[{id:'001',properties:{name:'Example Nation'}}];
  usaGeoJson=[{id:'06',properties:{name:'California'}}];usaRegionGeoJson=usaGeoJson;
  countyGeoJson=[
    {id:6001,properties:{name:'Alameda'}},{id:'06013',properties:{name:'Contra Costa'}},
    {id:'06041',properties:{name:'Marin'}},{id:'06075',properties:{name:'San Francisco'}}
  ];
  countyGeoJson.forEach(f=>countyFeaturesById[String(f.id).padStart(5,'0')]=f);
  scratchStateMesh={type:'MultiLineString',coordinates:[]};
`, context);
check('all three Scratch Map buttons select their datasets with synchronized active state', () => {
  for (const [id, dataset, count] of [
    ['btnScratchWorld', 'world', 1], ['btnScratchUsa', 'usa', 1], ['btnScratchCounties', 'counties', 4]
  ]) {
    element(id).handlers.click();
    assert.equal(vm.runInContext('AppState.scratchDataset', context), dataset);
    assert.equal(scratchFeatures.length, count);
    assert.ok(element(id).className.includes('bg-blue-600'));
  }
  assert.deepEqual(projectionCalls, ['world', 'usa', 'usa']);
});
check('county scratch view renders all four exact colors and noninteractive faint state mesh', () => {
  vm.runInContext("AppState.counties={'06001':'l','06013':'v','06041':'t','06075':'w','99999':'v'};renderScratchMap()", context);
  const regions = scratchNodes.find(n => n.attrs.class === 'scratch-regions');
  assert.deepEqual(Array.from(regions.attrs.fill), ['#f59e0b', '#10b981', '#64748b', '#d97706']);
  assert.equal(regions.attrs.stroke[0], '#fbbf24');
  const mesh = scratchNodes.find(n => n.attrs.class === 'scratch-state-borders');
  assert.equal(mesh.attrs['pointer-events'], 'none');
  assert.equal(mesh.attrs['stroke-opacity'], 0.35);
  assert.equal(element('scratchStatsLabel').textContent, '2 / 4 Visited/Lived · 1 Transited');
});
check('counties use a three-click scratch cycle while nations and states keep all four tiers', () => {
  for (const dataset of ['world', 'usa', 'counties']) {
    vm.runInContext(`applyPassport(migratePassport({}));AppState.scratchDataset='${dataset}';renderScratchMap()`, context);
    for (const next of dataset === 'counties' ? ['v', 'w', undefined] : ['v', 'w', 't', 'l', undefined]) {
      const regions = scratchNodes.find(n => n.attrs.class === 'scratch-regions');
      regions.click({}, regions.data[0]);
      const actual = vm.runInContext('scratchStatuses()[scratchStatusKey(' +
        (dataset === 'world' ? 'worldGeoJson' : dataset === 'usa' ? 'usaGeoJson' : 'countyGeoJson') + '[0])]', context);
      assert.equal(actual, next, dataset);
    }
  }
  assert.ok(!Object.hasOwn(JSON.parse(savedJson).counties, '06001'));
});
check('Scratch Map clicks are read-only for shared passports and roll back failed saves', () => {
  vm.runInContext('AppState.viewOnly=true', context);
  vm.runInContext('cycleScratchStatus(countyGeoJson[0])', context);
  assert.equal(vm.runInContext('AppState.counties["06001"]', context), undefined);
  vm.runInContext('AppState.viewOnly=false', context);
  context.localStorage.setItem = () => { throw new Error('Storage full'); };
  vm.runInContext('cycleScratchStatus(countyGeoJson[0])', context);
  assert.equal(vm.runInContext('AppState.counties["06001"]', context), undefined);
  assert.equal(element('toastTitle').textContent, 'Travel record not saved');
  context.localStorage.setItem = (key, value) => { savedJson = value; };
});
check('county scratch cycling preserves ledger-backed expedition visits and explains retained status', () => {
  vm.runInContext("AppState.expeditions=[{...testExpedition,id:'scratch-trip',countyIds:['06001']}];syncDerivedState();cycleScratchStatus(countyGeoJson[0])", context);
  assert.equal(vm.runInContext('AppState.counties["06001"]', context), 'v');
  assert.ok(element('toastMsg').textContent.includes('retains this tier'));
});
check('missing county data clears prior statistics and displays explicit retry guidance', () => {
  vm.runInContext('countyGeoJson=null;renderScratchMap()', context);
  assert.equal(element('scratchStatsLabel').textContent, 'Dataset unavailable');
  assert.ok(scratchNodes.some(n => String(n.text).includes('Retry datasets')));
});
check('waterfall tiers disclose exact 1, 5 and 10 goals and hide nonmatching/transit records', () => {
  for (const count of [0, 1, 4, 5, 9, 10]) {
    context.fallsCount = count;
    vm.runInContext(`
      applyPassport(migratePassport({}));PARKS=[];coordinateIndexes=null;AppState.currentTab='map';
      AppState.customPois=Array.from({length:fallsCount},(_,i)=>({
        ...customLocation,id:'falls_'+i,category:'waterfall',status:i===0?'l':'v'
      }));
      renderPassportView();
    `, context);
    const cards = element('achievementsContainer').innerHTML;
    assert.equal(vm.runInContext('calculateStats().metadataProgress.waterfalls', context), count);
    if (!count) assert.ok(!cards.includes('Chasing Waterfalls'));
    else {
      assert.ok(cards.includes('Chasing Waterfalls'));
      const next = count < 5 ? 5 : 10;
      assert.ok(cards.includes(`aria-label="Chasing Waterfalls progress" value="${Math.min(count, next)}" max="${next}"`));
      if (count < 5) assert.ok(!cards.includes('Visit 10 custom waterfall'));
      if (count >= 5) assert.ok(!cards.includes('Visit 1 custom waterfall location</p>'));
    }
  }
});
check('radar includes full custom visits and their biomes, loaded counties and each supported trip tag', () => {
  vm.runInContext(`
    applyPassport(migratePassport({}));PARKS=[];coordinateIndexes=null;
    countyGeoJson=[{id:'06001'},{id:'06013'},{id:'06041'}];
    AppState.counties={'06001':'l','06013':'v','06041':'t','99999':'v'};
    AppState.customPois=[
      {...customLocation,id:'nature',biomes:['5'],status:'v'},
      {...customLocation,id:'remote',biomes:['11'],status:'l'},
      {...customLocation,id:'wishlist',biomes:['10'],status:'w'},
      {...customLocation,id:'transit',biomes:['6'],status:'t'}
    ];
  `, context);
  const before = vm.runInContext('calculateStats().archetypes', context);
  assert.equal(before.Nature, 2 / 25);
  assert.equal(before.Adventure, 1 / 10);
  assert.equal(before.Remoteness, 1 / 6);
  assert.equal(before.Worldly, 1 / 15);
  assert.equal(before.Roadtrip, 2 / 100);
  vm.runInContext(`AppState.expeditions=[{...testExpedition,transitTags:['awd','foot','ferry','flight'],purposeTags:['photography']}];`, context);
  const after = vm.runInContext('calculateStats().archetypes', context);
  assert.equal(after.Nature, 3 / 25);
  assert.equal(after.Adventure, 2 / 10);
  assert.equal(after.Remoteness, 2 / 6);
  assert.equal(after.Worldly, 2 / 15);
  assert.equal(after.Roadtrip, 2 / 100 + 1 / 30);
  for (const [tag, axis] of [['awd','Adventure'],['awd','Roadtrip'],['foot','Adventure'],
    ['foot','Remoteness'],['ferry','Worldly'],['flight','Worldly']]) {
    vm.runInContext(`AppState.expeditions=[{...testExpedition,transitTags:['${tag}'],purposeTags:[]}];`, context);
    assert.ok(vm.runInContext(`calculateStats().archetypes.${axis}`, context) > before[axis], tag);
  }
  vm.runInContext(`AppState.expeditions=Array.from({length:200},()=>({...testExpedition,transitTags:['awd','foot','ferry','flight'],purposeTags:['photography']}));`, context);
  assert.deepEqual(Object.values(vm.runInContext('calculateStats().archetypes', context)), [1,1,1,1,1]);
});
vm.runInContext(`
  applyPassport(migratePassport({}));PARKS=[{id:'pulse',name:'Pulse Park',lat:37,lng:-120,biomes:[],states:[]}];
  countyGeoJson=null;coordinateIndexes=null;AppState.currentTab='map';
  map={options:{crs:{scale:zoom=>256*2**zoom}},getZoom:()=>8,
    latLngToContainerPoint:()=>({x:100,y:100}),removeLayer(){}};
`, context);
context.window.matchMedia = () => ({ matches: false });
animationTime = 0;
check('new full park visits pulse for 1200ms without retriggering visited to lived promotion', () => {
  vm.runInContext("setPinStatus('pulse','v')", context);
  assert.equal(vm.runInContext('discoveryPulses.get("park:pulse")', context), 0);
  context.fogOperations.length = 0;
  animationTime = 600;
  animationCallback();
  const radius = context.fogOperations.find(op => op[0] === 'arc')[3];
  assert.ok(radius < vm.runInContext('calculatePixelRadius(37,85)', context));
  vm.runInContext("setPinStatus('pulse','l')", context);
  assert.equal(vm.runInContext('discoveryPulses.get("park:pulse")', context), 0);
  animationTime = 1200;
  animationCallback();
  assert.equal(vm.runInContext('discoveryPulses.size', context), 0);
  assert.equal(vm.runInContext('discoveryFrame', context), null);
  assert.equal(vm.runInContext('fogCtx.globalAlpha', context), 1);
});
check('new custom POI saves and expedition promotions trigger pulses only after successful persistence', () => {
  animationTime = 2000;
  vm.runInContext("addCustomPoi({...customLocation,id:'poi_pulse',status:'v'})", context);
  assert.equal(vm.runInContext('discoveryPulses.get("poi:poi_pulse")', context), 2000);
  vm.runInContext("addCustomPoi({...customLocation,id:'poi_transit',status:'t'})", context);
  assert.equal(vm.runInContext('discoveryPulses.has("poi:poi_transit")', context), false);
  vm.runInContext("addExpedition({...testExpedition,id:'pulse-exp',countyIds:[],parkIds:[],customPoiIds:['poi_transit']})", context);
  assert.equal(vm.runInContext('discoveryPulses.has("poi:poi_transit")', context), true);
  context.localStorage.setItem = () => { throw new Error('Storage full'); };
  assert.throws(() => vm.runInContext("addCustomPoi({...customLocation,id:'poi_fail',status:'v'})", context), /Storage full/);
  assert.equal(vm.runInContext('discoveryPulses.has("poi:poi_fail")', context), false);
  context.localStorage.setItem = (key, value) => { savedJson = value; };
  animationTime = 3200;
  animationCallback();
});
check('reduced motion and classic mode do not schedule discovery pulses', () => {
  context.window.matchMedia = () => ({ matches: true });
  vm.runInContext("addCustomPoi({...customLocation,id:'poi_reduced',status:'v'})", context);
  assert.equal(vm.runInContext('discoveryPulses.size', context), 0);
  context.window.matchMedia = () => ({ matches: false });
  vm.runInContext("AppState.mode='classic';addCustomPoi({...customLocation,id:'poi_classic',status:'l'})", context);
  assert.equal(vm.runInContext('discoveryPulses.size', context), 0);
  context.fogOperations.length = 0;
  vm.runInContext('drawFogOfWar()', context);
  assert.ok(!context.fogOperations.some(op => op[0] === 'fill'));
  vm.runInContext("AppState.mode='rpg';drawFogOfWar()", context);
  assert.ok(context.fogOperations.some(op => op[0] === 'fill'));
});
check('NPS discovery pulses preserve boundary geometry while animating opacity and perimeter feather', () => {
  animationTime = 4000;
  vm.runInContext(`
    applyPassport(migratePassport({}));AppState.currentTab='map';
    PARKS=[{id:'pulse',name:'Boundary Park',lat:37,lng:-120,biomes:[],states:[]}];
    npsBoundariesByCode.pulse=[{type:'Polygon',coordinates:[[[-120,37],[-119,37],[-119,38],[-120,37]]]}];
    fogCtx.fill=rule=>fogOperations.push(['boundaryFill',rule,fogCtx.globalAlpha,fogCtx.shadowBlur]);
    setPinStatus('pulse','v');
  `, context);
  const geometry = vm.runInContext('JSON.stringify(npsBoundariesByCode.pulse)', context);
  context.fogOperations.length = 0;
  animationTime = 4600;
  animationCallback();
  const fill = context.fogOperations.find(op => op[0] === 'boundaryFill' && op[1] === 'evenodd');
  assert.ok(fill[2] < 1 && fill[2] >= 0.8);
  assert.ok(fill[3] < vm.runInContext('calculatePixelRadius(37,10)', context));
  assert.equal(vm.runInContext('JSON.stringify(npsBoundariesByCode.pulse)', context), geometry);
  assert.equal(vm.runInContext('fogCtx.globalAlpha', context), 1);
  animationTime = 5200;
  animationCallback();
  assert.equal(vm.runInContext('discoveryPulses.size', context), 0);
});
check('destination type groups use official designations, preserving combined categories and separate sources', () => {
  for (const [designation, expected] of [
    ['National Park', ['parks']], ['National Park & Preserve', ['parks','preserves']],
    ['National and State Parks', ['parks']], ['National Parks', ['parks']],
    ['National Monument & Preserve', ['monuments','preserves']],
    ['Part of Statue of Liberty National Monument', ['monuments']],
    ['National Historical Park', ['historic']], ['National Historic Trail', ['historic','trails']],
    ['National Battlefield Park', ['battlefields']], ['National Military Park', ['battlefields']],
    ['National Seashore', ['shores']], ['National Lakeshore', ['shores']],
    ['National River & Recreation Area', ['recreation','rivers']], ['Memorial Parkway', ['memorials','parkways']],
    ['Affiliated Area', ['other']], ['', ['other']]
  ]) {
    context.typeFixture = { designation };
    assert.deepEqual(Array.from(vm.runInContext('bucketDestinationTypes(typeFixture)', context)), expected, designation);
  }
  assert.deepEqual(Array.from(vm.runInContext('bucketDestinationTypes({intl:true})', context)), ['parks','international']);
  assert.deepEqual(Array.from(vm.runInContext('bucketDestinationTypes({custom:true,intl:true})', context)), ['custom']);
  assert.deepEqual(Array.from(vm.runInContext('bucketDestinationTypes({name:"National Monument",designation:"Park"})', context)), ['other']);
});
vm.runInContext(`
  applyPassport(migratePassport({}));AppState.currentTab='map';
  PARKS=[
    {id:'filter_park',name:'Test National Park',designation:'National Park',lat:37,lng:-120,biomes:[],states:['California']},
    {id:'filter_monument',name:'Test Monument',designation:'National Monument',lat:37,lng:-120,biomes:[],states:['Utah']},
    {id:'filter_historic',name:'Test Historical Park',designation:'National Historical Park',lat:37,lng:-120,biomes:[],states:[]},
    {id:'filter_intl',name:'International Test',intl:true,country:'Canada',biomes:[],lat:51,lng:-115,
      source:InternationalParks.wikidataSource,memberships:[],areaKm2:null,visitorCount:null}
  ];
  AppState.pins={filter_park:'v',filter_monument:'w'};
  AppState.customPois=[{...customLocation,id:'poi_filter',status:'v'}];
`, context);
element('bucketSearch').value = '';
element('bucketFilterStatus').value = 'all';
check('type filter change renders only matching destinations and updates result count', () => {
  element('bucketFilterType').value = 'parks';
  element('bucketFilterType').handlers.change();
  const cards = element('bucketListGrid').innerHTML;
  assert.ok(cards.includes('Test National Park'));
  assert.ok(cards.includes('International Test'));
  assert.ok(!cards.includes('Test Monument'));
  assert.ok(!cards.includes('Test Historical Park'));
  assert.ok(!cards.includes('Colosseum'));
  assert.equal(element('bucketResultsCount').textContent, '2 / 5 destinations shown');
});
check('type, search and status filters combine and remain selected after marking a destination', () => {
  element('bucketFilterType').value = 'monuments';
  element('bucketFilterStatus').value = 'w';
  element('bucketSearch').value = 'test';
  vm.runInContext('renderBucketListView()', context);
  assert.ok(element('bucketListGrid').innerHTML.includes('Test Monument'));
  assert.equal(element('bucketResultsCount').textContent, '1 / 5 destinations shown');
  context.window.matchMedia = () => ({ matches: true });
  vm.runInContext("AppState.currentTab='bucketlist';setPinStatus('filter_monument','v')", context);
  assert.ok(element('bucketListGrid').innerHTML.includes('No destination matches'));
  assert.equal(element('bucketFilterType').value, 'monuments');
  assert.equal(element('bucketFilterStatus').value, 'w');
  assert.equal(element('bucketResultsCount').textContent, '0 / 5 destinations shown');
});
check('international, custom and all type options keep separate destinations discoverable', () => {
  element('bucketFilterStatus').value = 'all';
  element('bucketSearch').value = '';
  for (const [type, count, name] of [
    ['international',1,'International Test'], ['custom',1,'Colosseum'], ['all',5,'Test Historical Park']
  ]) {
    element('bucketFilterType').value = type;
    element('bucketFilterType').handlers.change();
    assert.ok(element('bucketListGrid').innerHTML.includes(name));
    assert.equal(element('bucketResultsCount').textContent, `${count} / 5 destinations shown`);
  }
});
check('US national parks and all NPS filters explicitly exclude international and custom entries', () => {
  element('bucketSearch').value = '';
  element('bucketFilterStatus').value = 'all';
  for (const [type, count, shown, hidden] of [
    ['nps-parks', 1, 'Test National Park', ['International Test','Test Monument','Test Historical Park','Colosseum']],
    ['nps', 3, 'Test Monument', ['International Test','Colosseum']],
    ['monuments', 1, 'Test Monument', ['International Test','Test National Park']]
  ]) {
    element('bucketFilterType').value = type;
    element('bucketFilterType').handlers.change();
    assert.ok(element('bucketListGrid').innerHTML.includes(shown));
    for (const name of hidden) assert.ok(!element('bucketListGrid').innerHTML.includes(name));
    assert.equal(element('bucketResultsCount').textContent, `${count} / 5 destinations shown`);
  }
  assert.equal(vm.runInContext('matchesBucketType({intl:true,designation:"National Park"},"nps-parks")', context), false);
  assert.equal(vm.runInContext('matchesBucketType({custom:true,designation:"National Park"},"nps")', context), false);
  assert.equal(vm.runInContext('matchesBucketType({designation:"National Park & Preserve"},"nps-parks")', context), true);
  assert.equal(vm.runInContext('matchesBucketType({designation:"National Historical Park"},"nps-parks")', context), false);
});
check('real NPS filters return the official catalog exclusively and preserve combined park listings', () => {
  context.realUnits = catalog.normalizeParks(actualSnapshot.data);
  context.realInternational = internationalParks;
  vm.runInContext('PARKS=[...realUnits,...realInternational];AppState.customPois=[]', context);
  element('bucketFilterType').value = 'nps';
  vm.runInContext('renderBucketListView()', context);
  assert.equal(element('bucketResultsCount').textContent, `${actualSnapshot.total} / ${actualSnapshot.total + internationalParks.length} destinations shown`);
  element('bucketFilterType').value = 'nps-parks';
  vm.runInContext('renderBucketListView()', context);
  const filtered = vm.runInContext('PARKS.filter(p=>matchesBucketType(p,"nps-parks"))', context);
  assert.equal(filtered.length, 62);
  assert.ok(filtered.every(p => !p.intl));
  assert.equal(filtered.filter(p => p.id === 'seki').length, 1);
  assert.ok(filtered.some(p => p.id === 'npsa'));
  assert.ok(!element('bucketListGrid').innerHTML.includes('Banff'));
});

check('RPG county hitboxes exclude unexplored and manually marked counties; normal clicks never edit', () => {
  const layers = [];
  const panes = {};
  let removed = 0;
  let renderers = 0;
  context.L.svg = () => { renderers++; return {}; };
  context.L.geoJSON = (collection, options) => {
    layers.length = 0;
    for (const feature of collection.features) {
      const layer = {
        feature, styles: [], tooltip: null,
        bindTooltip(tooltip) { this.tooltip = tooltip; },
        setStyle(style) { this.styles.push(style); },
        on(handlers) { this.handlers = handlers; }
      };
      options.onEachFeature(feature, layer);
      layers.push(layer);
    }
    return { addTo() { return this; } };
  };
  context.countyMapMock = {
    getPane: name => panes[name],
    createPane: name => { panes[name] = { style: {} }; },
    removeLayer() { removed++; }
  };
  vm.runInContext(`
    applyPassport(migratePassport({}));AppState.mode='rpg';AppState.viewOnly=false;
    coordinateIndexes=null;PARKS=[];countyLayer=null;countyRenderer=null;countyHitboxKey=null;expeditionPicking=false;
    countyGeoJson=[
      {id:'06001',properties:{name:'Alameda'}},
      {id:'06013',properties:{name:'Contra Costa'}},
      {id:'06041',properties:{name:'Marin'}}
    ];
    AppState.counties={'06013':'v','06041':'l'};
    AppState.expeditions=[{...testExpedition,countyIds:['06001']}];
    map=countyMapMock;renderCountyHitboxes();
  `, context);
  assert.deepEqual(layers.map(layer => layer.feature.id), ['06001']);
  assert.ok(layers[0].tooltip().includes('Visited'));
  layers[0].handlers.mouseover();
  assert.equal(layers[0].styles[0].opacity, 0.65);
  const before = vm.runInContext('JSON.stringify(passportPayload())', context);
  layers[0].handlers.click();
  assert.equal(vm.runInContext('JSON.stringify(passportPayload())', context), before);
  vm.runInContext('renderCountyHitboxes()', context);
  assert.equal(removed, 0);
  vm.runInContext('AppState.expeditions=[];renderCountyHitboxes()', context);
  assert.equal(layers.length, 0);
  assert.equal(removed, 1);

  vm.runInContext('expeditionPicking=true;renderCountyHitboxes()', context);
  assert.equal(layers.length, 3);
  for (const layer of layers) {
    assert.equal(layer.tooltip, null);
    layer.handlers.mouseover();
    assert.equal(layer.styles.length, 0);
  }
  context.pickedCounties = [];
  vm.runInContext("addExpeditionStop=(kind,id)=>pickedCounties.push([kind,id])", context);
  const beforePicking = vm.runInContext('JSON.stringify(passportPayload())', context);
  layers[0].handlers.click();
  assert.deepEqual(Array.from(context.pickedCounties[0]), ['county', '06001']);
  assert.equal(vm.runInContext('JSON.stringify(passportPayload())', context), beforePicking);
  vm.runInContext('AppState.viewOnly=true', context);
  layers[0].handlers.click();
  assert.equal(context.pickedCounties.length, 1);
  vm.runInContext('AppState.viewOnly=false;expeditionPicking=false;renderCountyHitboxes()', context);
  assert.equal(layers.length, 0);
  vm.runInContext("AppState.mode='classic';renderCountyHitboxes()", context);
  assert.equal(layers.length, 3);
  assert.ok(layers.every(layer => layer.tooltip));
  assert.equal(renderers, 1);
  vm.runInContext('map=null;countyLayer=null;countyRenderer=null;countyHitboxKey=null', context);
});
check('saved Classic mode restores Travel Ledger, while every main-map entry enables persisted RPG fog', () => {
  const classes = new Map();
  const originalBody = context.document.body.classList;
  const originalHud = element('rpgMapHud').classList;
  const originalMap = element('tabContent-map').classList;
  const originalLedger = element('tabContent-bucketlist').classList;
  const classList = id => ({
    add(name) { classes.set(`${id}:${name}`, true); },
    remove(name) { classes.set(`${id}:${name}`, false); },
    toggle(name, value) { classes.set(`${id}:${name}`, value); }
  });
  context.document.body.classList = classList('body');
  element('rpgMapHud').classList = classList('hud');
  element('tabContent-map').classList = classList('map');
  element('tabContent-bucketlist').classList = classList('ledger');
  try {
    vm.runInContext("map=null;applyPassport(migratePassport({mode:'classic'}));restoreModeView()", context);
    assert.equal(vm.runInContext('AppState.currentTab', context), 'bucketlist');
    assert.equal(vm.runInContext('AppState.mode', context), 'classic');
    assert.equal(classes.get('body:mode-classic'), true);
    assert.equal(classes.get('hud:hidden'), true);
    assert.equal(classes.get('map:hidden'), true);
    assert.equal(classes.get('ledger:hidden'), false);
    vm.runInContext("switchTab('map')", context);
    assert.equal(vm.runInContext('AppState.mode', context), 'rpg');
    assert.equal(JSON.parse(savedJson).mode, 'rpg');
    assert.equal(classes.get('body:mode-classic'), false);
    assert.equal(classes.get('hud:hidden'), false);
    assert.equal(classes.get('map:hidden'), false);
    assert.equal(classes.get('ledger:hidden'), true);
    vm.runInContext('applyPassport(migratePassport(JSON.parse(localStorage.getItem("terra_incognita_state"))));restoreModeView()', context);
    assert.equal(vm.runInContext('AppState.currentTab', context), 'map');
    assert.equal(vm.runInContext('AppState.mode', context), 'rpg');
  } finally {
    context.document.body.classList = originalBody;
    element('rpgMapHud').classList = originalHud;
    element('tabContent-map').classList = originalMap;
    element('tabContent-bucketlist').classList = originalLedger;
  }
});
console.log(`${checks} checks passed.`);
