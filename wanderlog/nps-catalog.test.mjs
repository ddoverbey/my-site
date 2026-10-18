import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import catalog from './nps-catalog.js';
import ecoregions from './ecoregions.js';
import internationalCatalog from './international-parks.js';
import coordinateLookups from './coordinate-lookups.js';
import travelLedger from './travel-ledger.js';
import nationalParksScratch from './national-parks-scratch.js';
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

const html = (await readFile(new URL('./index.html', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const expeditionUi = await readFile(new URL('./expedition-ui.js', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(match => /src="\.\/expedition-ui\.js(?:\?[^"]*)?"/.test(match[0]) ? expeditionUi : match[1]);
check('every inline script parses', () => scripts.forEach(script => new vm.Script(script)));
function parseRouteFixture(text, filename) {
  context.routeFixture = text;
  context.routeFilename = filename;
  return JSON.parse(vm.runInContext('JSON.stringify(parseUploadedRouteFile(routeFixture, routeFilename))', context));
}
check('mobile RPG HUD starts collapsed with an accessible stats toggle', () => {
  const hudBodyStart = html.indexOf('<div id="rpgMapHudBody">');
  const hudContentEnd = html.indexOf('<!-- Map Legend', hudBodyStart);
  const hudBody = html.slice(hudBodyStart, hudContentEnd);
  assert.ok(hudBodyStart >= 0 && hudContentEnd > hudBodyStart);
  assert.match(html, /@media \(max-width: 767px\)[\s\S]*#rpgMapHud:not\(\[data-collapsed="false"\]\) #rpgMapHudBody/);
  assert.match(html, /id="rpgMapHudToggle"[^>]*aria-controls="rpgMapHudBody"[^>]*aria-expanded="false"/);
  assert.match(html, /setRpgMapHudCollapsed\(window\.matchMedia\('\(max-width: 767px\)'\)\.matches\)/);
  assert.match(hudBody, /id="hudXpBar"/);
  assert.match(hudBody, /id="hudClearedPct"/);
  assert.match(hudBody, /id="hudCountiesCount"/);
});
check('coupled local scripts use a shared release URL so cached old assets cannot break new HTML', () => {
  const sources = [...html.matchAll(/<script src="(\.\/[^"]+)"/g)].map(match => match[1]);
  assert.equal(sources.length, 9);
  assert.ok(sources.every(source => source.endsWith('?v=20261018-water-stencil')));
  assert.ok(sources.some(source => source.startsWith('./expedition-ui.js?')));
});
check('storage-risk banner and unfinished-trip recovery controls are present', () => {
  assert.match(html, /id="storageWarning"[^>]*role="status"/);
  assert.match(html, /id="btnStorageExport"/);
  assert.match(html, /id="unfinishedDraftNotice"/);
  assert.match(expeditionUi, /indexedDB\.open\(EXPEDITION_DRAFT_DB, 1\)/);
  assert.match(expeditionUi, /btnRestoreDraftFromTravel/);
  assert.match(expeditionUi, /downloadExpeditionRecovery/);
});
check('National Parks is a Scratch Map dataset, not a separate navigation page, with an expanded checklist', () => {
  assert.ok(html.includes('id="btnScratchNationalParks"'));
  assert.ok(!html.includes('data-tab="nationalparks"'));
  assert.ok(!html.includes('id="tabContent-nationalparks"'));
  assert.ok(html.includes('id="scratchNationalParks"'));
  assert.match(html, /<details open[^>]*>\s*<summary[^>]*>All 63 parks/);
});
check('Travel Ledger destinations render in a single full-width column', () => {
  assert.match(html, /<div class="grid grid-cols-1 gap-3" id="bucketListGrid">/);
  assert.doesNotMatch(html, /id="bucketListGrid"[^>]*md:grid-cols-2/);
});

const elements = new Map();
class TestXmlElement {
  constructor(tagName, textContent = '', children = []) {
    this.tagName = tagName;
    this.localName = tagName.split(':').pop();
    this.textContent = textContent;
    this.children = children;
  }
  getElementsByTagName(name) {
    const descendants = this.children.flatMap(child => [child, ...child.getElementsByTagName('*')]);
    return name === '*' ? descendants : descendants.filter(child => child.tagName === name || child.localName === name);
  }
}
class TestDOMParser {
  parseFromString(text) {
    const parseBlocks = (tag, content, childTag) => [...content.matchAll(
      new RegExp(`<([\\w.-]*:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/\\1${tag}\\s*>`, 'gi')
    )].map(match => {
      const children = childTag ? [...match[2].matchAll(
        new RegExp(`<([\\w.-]*:)?${childTag}\\b[^>]*>([\\s\\S]*?)<\\/\\1${childTag}\\s*>`, 'gi')
      )].map(child => new TestXmlElement(`${child[1] || ''}${childTag}`, child[2])) : [];
      return new TestXmlElement(`${match[1] || ''}${tag}`, '', children);
    });
    const lines = parseBlocks('LineString', text, 'coordinates');
    const tracks = parseBlocks('Track', text, 'coord');
    return new TestXmlElement('document', '', [...lines, ...tracks]);
  }
}
function element(id) {
  if (!elements.has(id)) {
    elements.set(id, {
      value: ['bucketFilterStatus', 'bucketFilterType'].includes(id) ? 'all' : '',
      textContent: '', innerHTML: '', style: {}, dataset: {},
      classList: { add() {}, remove() {}, toggle() {} },
      handlers: {}, addEventListener(name, handler) { this.handlers[name] = handler; },
      querySelectorAll: () => [], focus() {}, scrollTo() {},
      replaceChildren() { this.innerHTML = ''; }, reset() {}, setAttribute() {},
      appendChild(child) { this.innerHTML += child.innerHTML; },
      prepend(child) { this.innerHTML = child.innerHTML + this.innerHTML; }
    });
  }
  return elements.get(id);
}
const context = vm.createContext({
  NpsCatalog: catalog, NationalParksScratch: nationalParksScratch, Ecoregions: ecoregions, InternationalParks: internationalCatalog, CoordinateLookups: coordinateLookups, TravelLedger: travelLedger,
  WanderlogConfig: { rarityEndpoint: 'https://api.devonoverbey.com/rarity' },
  tailwind: {}, console, Intl, URL, URLSearchParams, AbortController, setTimeout() {}, clearTimeout() {},
  DOMParser: TestDOMParser,
  document: { body: { classList: { toggle() {}, add() {}, remove() {} } }, getElementById: element, querySelectorAll: () => [], createElement: () => element(`created-${elements.size}`) },
  window: { addEventListener() {}, matchMedia: () => ({ matches: true }) },
  fetch: async url => ({ ok: true, json: async () => url.includes('wikidata') ? wikidata : url.includes('worldwide') ? worldwide : snapshot })
});
scripts.forEach(script => vm.runInContext(script, context));
const recoveredDraftStore = new Map();
const recoveredDraftDatabase = {
  createObjectStore() {},
  transaction() {
    const transaction = {
      objectStore() {
        return {
          put(record) {
            recoveredDraftStore.set(record.id, record);
            queueMicrotask(() => transaction.oncomplete?.());
          },
          get(key) {
            const request = {};
            queueMicrotask(() => {
              request.result = recoveredDraftStore.get(key);
              request.onsuccess?.();
            });
            return request;
          },
          delete(key) {
            recoveredDraftStore.delete(key);
            queueMicrotask(() => transaction.oncomplete?.());
          }
        };
      }
    };
    return transaction;
  }
};
context.indexedDB = {
  open() {
    const request = {};
    queueMicrotask(() => {
      request.result = recoveredDraftDatabase;
      request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  }
};
await vm.runInContext('writeExpeditionDraftRecovery({name:"Still going",stops:[{name:"Start"}]})', context);
const persistedDraftRoundTrip = await vm.runInContext('readExpeditionDraftRecovery()', context);
await vm.runInContext('deleteExpeditionDraftRecovery()', context);
check('IndexedDB draft recovery persists, restores, and clears an unfinished trip', () => {
  assert.equal(persistedDraftRoundTrip.name, 'Still going');
  assert.equal(persistedDraftRoundTrip.stops[0].name, 'Start');
  assert.equal(recoveredDraftStore.has('current'), false);
});
const geoJsonTrack = parseRouteFixture(JSON.stringify({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: {}, geometry: {
    type: 'LineString', coordinates: [[-122, 37, 0], [-121.999, 37, 0], [-121.9, 37, 0], [-121, 37, 0]]
  } }]
}), 'imported.geojson');
const kmlTrack = parseRouteFixture(
  '<kml><Placemark><LineString><coordinates>-122,37,0 -121,38,0</coordinates></LineString></Placemark></kml>',
  'imported.kml');
const gxTrack = parseRouteFixture(
  '<kml><Placemark><gx:Track><gx:coord>-122 37 0</gx:coord><gx:coord>-121 38 0</gx:coord></gx:Track></Placemark></kml>',
  'imported.kml');
const denseTrack = parseRouteFixture(JSON.stringify({
  type: 'LineString', coordinates: Array.from({ length: 1000 }, (_, index) => [index * 0.05, 0, 0])
}), 'dense.json');
check('GeoJSON, KML coordinates and gx:Track import as validated lat/lng tracks and downsample while preserving endpoints', () => {
  assert.deepEqual(geoJsonTrack, [[37, -122], [37, -121.9], [37, -121]]);
  assert.deepEqual(kmlTrack, [[37, -122], [38, -121]]);
  assert.deepEqual(gxTrack, [[37, -122], [38, -121]]);
  assert.equal(denseTrack.length, 350);
  assert.deepEqual(denseTrack[0], [0, 0]);
  assert.deepEqual(denseTrack.at(-1), [0, 49.95]);
  assert.throws(() => parseRouteFixture(JSON.stringify({
    type: 'LineString', coordinates: [[181, 0], [1, 0]]
  }), 'invalid.json'), /longitude/);
});
check('header navigation uses compact icons with accessible labels and synchronized pressed states', () => {
  for (const label of ['Explore — RPG mode', 'Travel Ledger — Classic mode', 'Scratch Map', 'Explorer Profile — Character & Stats', 'Achievements']) {
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
check('destination pins default to None, pin filters stay out of the RPG HUD, and the fog toggle is not rendered', () => {
  assert.equal(vm.runInContext('AppState.pinFilter', context), 'none');
  const activeHtml = html.replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(!activeHtml.includes('id="fogToggleCheckbox"'));
  assert.ok(!activeHtml.includes('id="pinFilterBtns"'));
  assert.ok(!activeHtml.includes('Show pins:'));
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
check('water fog uses a land stencil rather than political shoreline sampling', () => {
  for (const name of ['destinationCoordinate', 'isOceanCoordinate', 'oceanHasClearance', 'waterRoutePoints', 'waterFogRouteCache']) {
    assert.ok(!html.includes(`function ${name}`));
    assert.ok(!html.includes(`const ${name}`));
  }
  assert.ok(html.includes('calculatePixelRadius(cached.averageLat, 90)'));
  assert.ok(html.includes('fogCtx.shadowBlur = 18;'));
  assert.ok(html.includes('Ferry / Boat and flight routes clear ocean fog'));
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
    fillRect(...args) { fogOperations.push(['fill', fogCtx.fillStyle, ...args]); },
    createRadialGradient() { return { addColorStop() {} }; },
    save() { fogOperations.push(['save']); },
    restore() { fogOperations.push(['restore']); },
    beginPath() { fogOperations.push(['beginPath']); },
    moveTo(...args) { fogOperations.push(['moveTo', ...args]); },
    lineTo(...args) { fogOperations.push(['lineTo', ...args]); },
    arc(...args) { fogOperations.push(['arc', ...args]); },
    stroke() { fogOperations.push(['stroke', fogCtx.lineWidth, fogCtx.lineCap, fogCtx.lineJoin, fogCtx.shadowBlur]); },
    fill() {}
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
  assert.ok(context.fogOperations.some(operation =>
    operation[0] === 'fill' && operation[1] === 'rgba(235, 239, 245, 0.99)'));
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
check('local-storage capacity preflight rejects a payload above the conservative budget', () => {
  assert.throws(() => vm.runInContext(
    `assertPassportStorageCapacity({version:2,expeditions:[],test:'x'.repeat(2400000)})`, context
  ), /conservative 4\.5 MiB browser-storage budget/);
});
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
check('local storage compacts long route geometry and expands it losslessly to five decimal places', () => {
  context.routeCompressionFixture = Array.from({ length: 500 }, (_, index) => [
    38.123456 + index * 0.00123,
    -121.765432 + Math.sin(index / 20) * 0.2
  ]);
  const compact = vm.runInContext(`compactPassportForStorage({
    version:2,expeditions:[{id:'route',routeLegs:[{mode:'road',routeCoords:routeCompressionFixture}]}]
  })`, context);
  assert.equal(compact.storageFormat, 'encoded-route-polyline-v1');
  assert.equal(typeof compact.expeditions[0].routeLegs[0].routePolyline, 'string');
  assert.equal(compact.expeditions[0].routeLegs[0].routeCoords, undefined);
  assert.ok(JSON.stringify(compact).length < JSON.stringify(context.routeCompressionFixture).length);
  context.compactRouteFixture = compact;
  const expanded = vm.runInContext('expandStoredPassport(compactRouteFixture).expeditions[0].routeLegs[0].routeCoords', context);
  assert.equal(expanded.length, context.routeCompressionFixture.length);
  expanded.forEach((point, index) => point.forEach((value, axis) =>
    assert.ok(Math.abs(value - context.routeCompressionFixture[index][axis]) <= 0.0000051)));
  assert.throws(() => vm.runInContext(
    "expandStoredPassport({storageFormat:'encoded-route-polyline-v1',expeditions:[{routeLegs:[{mode:'road'}]}]})",
    context
  ), /compact route geometry/);
  delete context.routeCompressionFixture;
  delete context.compactRouteFixture;
});
check('recovery bundle import merges the unsaved expedition into a normal passport payload', () => {
  context.crypto = { randomUUID: () => 'recovered-trip' };
  context.recoveryFixture = {
    version: 2,
    expeditions: [],
    _unsavedExpeditionDraft: {
      name: 'Recovered road trip', reason: 'Family visit', startDate: '2026-10-01',
      endDate: '2026-10-02', dayTrip: false,
      stops: [
        { kind: 'place', id: 'recovery-start', name: 'Start', coords: [37, -120], travelMode: 'road' },
        { kind: 'place', id: 'recovery-end', name: 'End', coords: [38, -119], travelMode: 'road' }
      ],
      legs: [{
        mode: 'road', routeSource: 'routed', routeCoords: [[37, -120], [37.5, -119.5], [38, -119]],
        countyIds: []
      }],
      uploadedRoute: null
    }
  };
  const recovered = vm.runInContext('migratePassport(recoveryFixture)', context);
  assert.equal(recovered.expeditions.length, 1);
  assert.equal(recovered.expeditions[0].name, 'Recovered road trip');
  assert.deepEqual(Array.from(recovered.expeditions[0].routeStops, stop => stop.name), ['Start', 'End']);
  assert.equal(recovered.expeditions[0].routeLegs[0].routeCoords.length, 3);
  assert.equal(recovered._unsavedExpeditionDraft, undefined);
  delete context.recoveryFixture;
});
context.fogOperations.length = 0;
vm.runInContext(`
  map.project = null;
  fogCtx.moveTo = (...args) => fogOperations.push(['moveTo', ...args]);
  fogCtx.lineTo = (...args) => fogOperations.push(['lineTo', ...args]);
  fogCtx.closePath = () => fogOperations.push(['closePath']);
  fogCtx.fill = rule => fogOperations.push(['polygonFill', rule, fogCtx.shadowBlur]);
  fogCtx.stroke = () => fogOperations.push(['stroke', fogCtx.lineWidth, fogCtx.lineCap, fogCtx.lineJoin, fogCtx.shadowBlur]);
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
  assert.ok(!element('achievementsContainer').innerHTML.includes('Under Pressure'));
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
check('visited county polygons credit their cached predominant biome without crediting transit or wishlist counties', () => {
  vm.runInContext(`
    AppState.customPois=[];AppState.expeditions=[];AppState.homeBase=null;AppState.pins={};AppState.regions={};
    AppState.counties={'06073':'v','06065':'t','06059':'w'};
    countyBiomeCache['06073']='5';
    countyBiomeCache['06065']='12';
    countyBiomeCache['06059']='9';
    statsCache=null;
  `, context);
  assert.deepEqual(
    JSON.parse(vm.runInContext('JSON.stringify([...calculateStats().biomesSet].sort())', context)),
    ['5']
  );
  vm.runInContext(`
    AppState.counties={'06073':'l'};
    delete countyBiomeCache['06073'];
    delete countyBiomeCache['06065'];
    delete countyBiomeCache['06059'];
    statsCache=null;
  `, context);
});
check('Citadel onboarding starts hidden, offers passport import, and county biomes resolve lazily', () => {
  assert.match(html, /<div id="homeBaseModal" class="hidden /);
  assert.ok(html.includes('id="btnHomeImport"'));
  assert.ok(!html.includes('buildCountyBiomeCache'));
  const startup = html.slice(html.indexOf("window.addEventListener('DOMContentLoaded'"));
  assert.ok(startup.indexOf('openHomeModal()') < startup.indexOf('startApp()'),
    'onboarding must be decided from saved state before datasets load');
  vm.runInContext(`
    statsCache=null;
    AppState.counties={'06073':'v'};
    var lazyBiomeIndexes = coordinateIndexes;
    coordinateIndexes = null;
  `, context);
  assert.equal(vm.runInContext("countyBiome('06073')", context), null);
  assert.equal(vm.runInContext("Object.hasOwn(countyBiomeCache,'06073')", context), false,
    'missing geography must not memoize a null biome');
  vm.runInContext("countyBiomeCache['06073']='7'", context);
  assert.equal(vm.runInContext("countyBiome('06073')", context), '7');
  vm.runInContext(`
    delete countyBiomeCache['06073'];
    coordinateIndexes = lazyBiomeIndexes;
    AppState.counties={'06073':'l'};
    statsCache=null;
  `, context);
});
context.testExpedition = {
  id: 'exp_test', name: '<script>Trip</script>', startDate: '2026-09-01', endDate: '2026-09-01',
  transitTags: ['awd', 'ferry'], purposeTags: ['photography'],
  countyIds: ['06073'], parkIds: [], customPoiIds: [],
  routeCoords: [[37,-120],[38,-119]], minElevationFt: -100, maxElevationFt: 11000
};
vm.runInContext('addExpedition(testExpedition);renderPassportView();renderExpeditionHistory()', context);
check('expedition history escapes names, shows date/elevation/tags and starts metadata badges', () => {
  const history = element('travelLogFeed').innerHTML;
  assert.ok(history.includes('&lt;script&gt;Trip&lt;/script&gt;'));
  assert.ok(history.includes('2026-09-01'));
  assert.ok(history.includes('-100 to 11,000 ft'));
  assert.ok(history.includes('AWD/Off-Road'));
  assert.ok(history.includes('Photography'));
  const achievements = element('achievementsContainer').innerHTML;
  assert.ok(achievements.includes('Under Pressure'));
  assert.ok(achievements.includes('Thin Air'));
  assert.ok(achievements.includes('value="1" max="5"'));
});
check('the travel log is its own tab rendering a chronological feed with per-trip mini-maps', () => {
  assert.ok(html.includes('data-tab="travel"'));
  assert.ok(html.includes('id="tabContent-travel"'));
  assert.ok(html.includes('id="travelLogFeed"'));
  // Expedition history moved out of the passport tab entirely.
  assert.ok(!html.includes('id="expeditionHistory"'));
  assert.ok(!html.includes('expeditionHistoryTitle'));
  assert.ok(html.includes("document.getElementById('tabContent-travel').classList.add('hidden')"));
  const feed = element('travelLogFeed').innerHTML;
  assert.ok(feed.includes('SEPTEMBER 2026'));
  assert.ok(feed.includes('id="mini-map-exp_test"'));
  assert.ok(feed.includes('md:grid-cols-[220px_1fr]'));
  // Leaflet is absent from this harness, so the feed renders without any map instances.
  assert.equal(vm.runInContext('Object.keys(travelLogMaps).length', context), 0);
});
check('mini-maps plot every route stop and frame multi-stop trips that have no polyline', () => {
  const previousL = context.L;
  const savedExpeditions = vm.runInContext('JSON.stringify(AppState.expeditions)', context);
  const drawn = { markers: [], polylines: [], fitBounds: [], setView: [], removed: 0 };
  context.L = {
    map: () => ({
      remove: () => { drawn.removed += 1; },
      fitBounds: (bounds, options) => drawn.fitBounds.push([bounds, options]),
      setView: (center, zoom) => drawn.setView.push([center, zoom])
    }),
    tileLayer: () => ({ addTo() { return this; } }),
    polyline: (coords, options) => { drawn.polylines.push({ coords, options }); return { addTo() { return this; } }; },
    circleMarker: coords => { drawn.markers.push(coords); return { addTo() { return this; } }; },
    latLngBounds: coords => coords
  };
  // Sandbox arrays cross realms, so compare plain JSON snapshots rather than prototypes.
  const plain = value => JSON.parse(JSON.stringify(value));
  try {
    vm.runInContext(`
      travelLogBase = AppState.expeditions[0];
      AppState.expeditions = [{ ...travelLogBase, id: 'exp_stops', routeCoords: [], routeStops: [
        { kind: 'place', id: 'a', name: 'A', coords: [37, -120] },
        { kind: 'place', id: 'b', name: 'B', coords: [38, -119] },
        { kind: 'place', id: 'c', name: 'C', coords: [null, null] }
      ] }];
      renderExpeditionHistory();
    `, context);
    assert.deepEqual(plain(drawn.markers), [[37, -120], [38, -119]]);
    assert.equal(drawn.polylines.length, 0);
    assert.deepEqual(plain(drawn.fitBounds[0][0]), [[37, -120], [38, -119]]);
    assert.equal(drawn.setView.length, 0);
    vm.runInContext(`
      AppState.expeditions = [{ ...travelLogBase, id: 'exp_single', routeCoords: [], routeStops: [
        { kind: 'place', id: 'a', name: 'A', coords: [37, -120] }
      ] }];
      renderExpeditionHistory();
    `, context);
    assert.equal(drawn.removed, 1);
    assert.deepEqual(plain(drawn.markers), [[37, -120], [38, -119], [37, -120]]);
    assert.deepEqual(plain(drawn.setView), [[[37, -120], 8]]);
    assert.equal(drawn.fitBounds.length, 1);
  } finally {
    context.L = previousL;
    vm.runInContext(`AppState.expeditions = ${savedExpeditions}; delete globalThis.travelLogBase; renderExpeditionHistory();`, context);
  }
  context.L = {
    ...context.L,
    map: () => ({
      remove: () => { drawn.removed += 1; },
      fitBounds: (bounds, options) => drawn.fitBounds.push([bounds, options]),
      setView: (center, zoom) => drawn.setView.push([center, zoom])
    }),
    tileLayer: () => ({ addTo() { return this; } }),
    polyline: (coords, options) => { drawn.polylines.push({ coords, options }); return { addTo() { return this; } }; },
    circleMarker: coords => { drawn.markers.push(coords); return { addTo() { return this; } }; },
    latLngBounds: coords => coords
  };
  const ferryStops = [
    { kind: 'place', id: 'bellingham', name: 'Bellingham', coords: [48.75, -122.48] },
    { kind: 'place', id: 'sitka', name: 'Sitka', coords: [57.05, -135.33] }
  ];
  context.testFerryExpedition = {
    ...JSON.parse(savedExpeditions)[0], id: 'exp_ferry', transitTags: ['ferry'],
    routeStops: ferryStops, routeCoords: ferryStops.map(stop => stop.coords),
    routeLegs: [{ mode: 'ferry', routeSource: 'routed',
      routeCoords: [[48.75, -122.48], [54, -130], [57.05, -135.33]], countyIds: [] }]
  };
  vm.runInContext(`
    AppState.expeditions = [testFerryExpedition];
    renderExpeditionHistory();
  `, context);
  check('Travel Log mini-map replaces saved highway ferry geometry with a dashed direct connector',()=>{
    const line=drawn.polylines.at(-1);
    assert.deepEqual(plain(line.coords),[[48.75,-122.48],[57.05,-135.33]]);
    assert.equal(line.options.color,'#38bdf8');
    assert.equal(line.options.dashArray,'8, 8');
    assert.deepEqual(plain(drawn.fitBounds.at(-1)[0]),[[48.75,-122.48],[57.05,-135.33],
      [48.75,-122.48],[57.05,-135.33]]);
  });
  vm.runInContext(`destroyTravelLogMaps();AppState.expeditions=${savedExpeditions};delete globalThis.testFerryExpedition`, context);
  context.L = null;
  vm.runInContext('renderExpeditionHistory()', context);
  context.L = previousL;
  assert.equal(vm.runInContext('Object.keys(travelLogMaps).length', context), 0);
});
check('logged expedition routes join legacy route corridors in the same canvas', () => {
  const savedExpeditions = vm.runInContext('JSON.stringify(AppState.expeditions)', context);
  context.fogOperations.length = 0;
  vm.runInContext("AppState.expeditions=AppState.expeditions.map(exp=>({...exp,transitTags:['road']}));drawFogOfWar()", context);
  assert.equal(context.fogOperations.filter(op => op[0] === 'stroke').length, 1);
  assert.equal(context.fogOperations.filter(op => op[0] === 'polygonFill' && op[1] === 'evenodd').length, 1);
  vm.runInContext(`AppState.expeditions=${savedExpeditions}`, context);
});
check('all ledger fields survive local and shared payload migration', () => {
  vm.runInContext('saveState();applyPassport(migratePassport(JSON.parse(localStorage.getItem("terra_incognita_state"))))', context);
  const saved = JSON.parse(savedJson);
  assert.equal(saved.storageFormat, 'encoded-route-polyline-v1');
  assert.equal(saved.expeditions.length, 1);
  assert.equal(saved.counties['06073'], 'l');
  assert.ok(Array.isArray(saved.customPois));
  assert.equal(saved.customLocations, undefined);
  assert.equal(saved.clearedCounties, undefined);
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(passportPayload())', context)),
    JSON.parse(vm.runInContext(`JSON.stringify(expandStoredPassport(${JSON.stringify(saved)}))`, context)));
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
  politicalRegion: () => null,
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
  expeditionPreparedLegs=expeditionDraft.slice(1).map((stop,index)=>({
    mode:'road',routeCoords:[expeditionDraft[index].coords,stop.coords],countyIds:[]
  }));
  expeditionPreparedKey=expeditionRouteKey();
`, context);
element('expeditionName').value = 'Wizard day trip';
element('expeditionStart').value = '2026-09-10';
element('expeditionEnd').value = '2026-09-10';
await element('expeditionForm').handlers.submit({ preventDefault() {} });
check('wizard samples elevation and commits one expedition with ordered coordinates', () => {
  assert.equal(vm.runInContext('AppState.expeditions.length', context), 2, element('expeditionStatus').textContent);
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
check('great-circle water paths cache by zoom, wrap the dateline, and stencil land before visited clearings without political lookups', () => {
  const originalInterpolate = context.d3.geoInterpolate;
  const originalContains = context.d3.geoContains;
  const originalPath = context.Path2D;
  let interpolationCalls = 0, projections = 0, zoom = 4, pan = 0, paths = 0;
  const operations = [];
  const point = (x, y) => ({x,y,round(){return this;},subtract(other){return point(x-other.x,y-other.y);}});
  context.d3.geoInterpolate = (from, to) => {
    interpolationCalls++;
    assert.deepEqual(Array.from(from), [170, 20]);
    assert.deepEqual(Array.from(to), [-170, 20]);
    return t => [((170 + 20 * t + 180) % 360) - 180, 20 + Math.sin(Math.PI * t) * 5];
  };
  context.d3.geoContains = () => { throw new Error('fog rendering must not call geoContains'); };
  context.CoordinateLookups = {...coordinateLookups,
    politicalRegion() { throw new Error('fog rendering must not resolve political coordinates'); }};
  context.Path2D = class {
    constructor(){paths++;}
    moveTo(){}
    lineTo(){}
    closePath(){}
  };
  context.waterTestMap = {
    options:{crs:{scale:()=>360}},getZoom:()=>zoom,
    project([lat,lng]){projections++;return point(lng,lat);},
    latLngToContainerPoint:([lat,lng])=>point(lng+pan,lat)
  };
  const ctx = context.waterTestCtx = {
    setTransform(){},clearRect(){},save(){},restore(){},translate(){},
    fillRect(){operations.push(['base',this.globalCompositeOperation,this.fillStyle]);},
    beginPath(){operations.push(['begin']);},
    moveTo(x,y){operations.push(['move',x,y]);},lineTo(x,y){operations.push(['line',x,y]);},
    stroke(){operations.push(['water',this.globalCompositeOperation,this.lineWidth,this.shadowBlur,this.lineCap,this.lineJoin]);},
    fill(path,rule){operations.push(['land',this.globalCompositeOperation,this.fillStyle,this.shadowBlur,rule]);},
    createRadialGradient(){return {addColorStop(){}};},
    arc(){operations.push(['visited',this.globalCompositeOperation]);}
  };
  try {
    vm.runInContext(`
      globalThis.waterTestSaved={map,fogCtx,worldGeoJson,PARKS,coordinateIndexes,fogPadding,state:{...AppState}};
      applyPassport(migratePassport({}));
      AppState.mode='rpg';AppState.currentTab='map';
      map=waterTestMap;fogCtx=waterTestCtx;
      PARKS=[{id:'stencil_park',lat:20,lng:170}];AppState.pins={stencil_park:'v'};
      coordinateIndexes={countries:[],states:[],counties:[],microStates:[]};
      fogPadding={x:100,y:100};
      worldGeoJson=[{geometry:{type:'Polygon',coordinates:[[[175,15],[-175,15],[-175,25],[175,15]]]}}];
      globalThis.waterTestRoute=[[20,170],[20,-170]];
      AppState.expeditions=[{transitTags:['ferry'],routeCoords:waterTestRoute,
        parkIds:[],customPoiIds:[],countyIds:[],
        routeLegs:[{mode:'ferry',routeCoords:waterTestRoute,countyIds:[]}]}];
      AppState.homeBase={lat:20,lng:170,radiusKm:10,countyId:null};
      drawFogOfWar();
    `, context);
    assert.equal(interpolationCalls,1);
    assert.equal(operations[0][0],'base');
    const waterIndex = operations.findIndex(op=>op[0]==='water');
    const landIndex = operations.findIndex(op=>op[0]==='land');
    const visitedIndex = operations.findIndex(op=>op[0]==='visited');
    assert.ok(waterIndex>0 && landIndex>waterIndex && visitedIndex>landIndex);
    assert.deepEqual(operations[waterIndex].slice(1,2),['destination-out']);
    assert.deepEqual(operations[waterIndex].slice(3),[18,'round','round']);
    const expectedWidth=vm.runInContext('calculatePixelRadius(20 + Array.from({length:33},(_,i)=>Math.sin(Math.PI*i/32)*5).reduce((a,b)=>a+b,0)/33,90)*2',context);
    assert.ok(Math.abs(operations[waterIndex][2]-expectedWidth)<1e-8);
    assert.equal(operations.filter(op=>op[0]==='water').length,1);
    assert.deepEqual(operations[landIndex].slice(1),['source-over','rgba(235, 239, 245, 0.99)',0,'evenodd']);
    assert.equal(operations[visitedIndex][1],'destination-out');
    let previous;
    for (const op of operations) {
      if(op[0]==='move') previous=op;
      if(op[0]==='line') {
        assert.ok(Math.abs(op[1]-previous[1])<180,'no line may streak across the dateline');
        previous=op;
      }
    }
    assert.equal(operations.filter(op=>op[0]==='line').length % 32,0);
    assert.ok(operations.some(op=>op[0]==='line' && op[2]>20),'interpolated arc should curve');
    const firstProjections = projections, firstPaths = paths;
    pan=10;operations.length=0;
    vm.runInContext('drawFogOfWar()',context);
    assert.equal(interpolationCalls,1);
    assert.equal(paths,firstPaths);
    assert.equal(projections,firstProjections+2,'panning should project only the two canvas origins');
    zoom++;
    vm.runInContext('drawFogOfWar()',context);
    assert.equal(interpolationCalls,2);
    operations.length=0;
    vm.runInContext('worldGeoJson=null;drawFogOfWar()',context);
    assert.ok(!operations.some(op=>op[0]==='water'),'missing atlas must not expose land');
    assert.equal(ctx.shadowBlur,0);
  } finally {
    vm.runInContext(`
      ({map,fogCtx,worldGeoJson,PARKS,coordinateIndexes,fogPadding}=waterTestSaved);
      Object.assign(AppState,waterTestSaved.state);
      delete globalThis.waterTestSaved;delete globalThis.waterTestRoute;
    `,context);
    context.d3.geoInterpolate=originalInterpolate;
    context.d3.geoContains=originalContains;
    context.Path2D=originalPath;
    context.CoordinateLookups=coordinateLookups;
    delete context.waterTestMap;
    delete context.waterTestCtx;
  }
});
context.CoordinateLookups = coordinateLookups;
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
check('first Citadel marks containing geography Lived, uses a 15-mile diameter, flies at zoom 8 and unlocks Scout', () => {
  vm.runInContext("setHometownCoordinates('Test Citadel',37,-120)", context);
  assert.equal(vm.runInContext('AppState.homeBase.radiusKm', context), 15 * 1.609344 / 2);
  assert.equal(vm.runInContext('AppState.homeBase.countyId', context), '06073');
  assert.equal(vm.runInContext('AppState.counties["06073"]', context), 'l');
  assert.equal(vm.runInContext('AppState.regions["s:California"]', context), 'l');
  assert.equal(vm.runInContext('calculateStats().cls', context), 'Scout');
  const stats = vm.runInContext('calculateStats()', context);
  assert.equal(stats.xp - stats.statesCount * 10 - stats.countriesCount * 20, 50);
  assert.equal(stats.level, 1);
  assert.equal(stats.nextLevelXp, 100);
  assert.equal(stats.levelProgressPct, 80);
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
  assert.ok(Math.abs(arc[3] - vm.runInContext('calculatePixelRadius(37,TravelLedger.homeRadiusKm)*0.85', context)) < 1e-8);
  assert.equal(context.fogOperations.filter(op => op[0] === 'polygonFill' && op[1] === 'evenodd').length, 0);
  animationTime = 1800;
  animationCallback();
  assert.equal(vm.runInContext('homeAuraPulseStarted', context), null);
  assert.equal(vm.runInContext('homeAuraFrame', context), null);
  context.window.matchMedia = () => ({ matches: true });
  vm.runInContext('pulseHomeAura()', context);
  assert.equal(vm.runInContext('homeAuraPulseStarted', context), null);
});
check('changing home never adds another Citadel bonus and oversized saved homes shrink on reload', () => {
  const previousXP = vm.runInContext('calculateStats().xp', context);
  vm.runInContext("setHometownCoordinates('Changed Citadel',38,-121)", context);
  assert.equal(vm.runInContext('calculateStats().xp', context), previousXP);
  assert.ok(!element('toastMsg').textContent.includes('+50'));
  vm.runInContext('saveState();loadPersistedState()', context);
  assert.equal(vm.runInContext('AppState.homeBase.radiusKm', context), travelLedger.homeRadiusKm);
  vm.runInContext('AppState.homeBase.radiusKm=75;saveState();loadPersistedState()', context);
  assert.equal(vm.runInContext('AppState.homeBase.radiusKm', context), travelLedger.homeRadiusKm);
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
  return { ok: true, json: async () => ({features:[{geometry:{type:'Point',coordinates:[-110,40]},properties:{name:'New City'}}]}) };
};
context.document.querySelectorAll = selector => selector === '.quick-city-chip' ? [{
  textContent: 'Seattle', dataset: { name: 'Seattle, WA', lat: '47.6062', lng: '-122.3321' }
}] : [];
element('cityInput').value = 'seattle';
await vm.runInContext('searchHometown()', context);
check('typing even a quick-pick city requires explicit selection instead of assigning home', () => {
  assert.equal(geocoderCalls, 1);
  assert.equal(vm.runInContext('AppState.homeBase.name', context), 'Changed Citadel');
});
element('cityInput').value = 'New City';
await vm.runInContext('searchHometown()', context);
check('unknown city search offers explicit selection and never auto-assigns San Francisco', () => {
  assert.equal(geocoderCalls, 2);
  assert.equal(vm.runInContext('AppState.homeBase.name', context), 'Changed Citadel');
  assert.ok(element('homeLookupStatus').textContent.includes('Choose your city'));
});
context.fetch = async () => ({ ok: true, json: async () => ({features:[{geometry:{type:'Point',coordinates:[0,'']},properties:{name:'Invalid City'}}]}) });
await vm.runInContext('searchHometown()', context);
check('invalid geocoder coordinates show an error and leave the existing home unchanged', () => {
  assert.ok(element('homeLookupStatus').textContent.includes('latitude'));
  assert.equal(vm.runInContext('AppState.homeBase.name', context), 'Changed Citadel');
});
const scratchNodes = [];
let scratchFeatures = [];
const projectionCalls = [];
const generatedScratchPaths = [];
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
  geoPath: () => feature => {
    generatedScratchPaths.push(feature);
    return `path-${feature.id || 'mesh'}`;
  }
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
  generatedScratchPaths.length = 0;
  vm.runInContext("AppState.counties={'06001':'l','06013':'v','06041':'t','06075':'w','99999':'v'};renderedScratchDataset=null;renderedCountyFeatures=null;renderScratchMap()", context);
  const regions = scratchNodes.find(n => n.attrs.class === 'scratch-regions');
  assert.deepEqual(Array.from(regions.attrs.fill), ['#3b82f6', '#10b981', '#64748b', '#ec4899']);
  assert.equal(regions.attrs.stroke[0], '#93c5fd');
  assert.equal(generatedScratchPaths.length, 5);
  vm.runInContext('renderScratchMap()', context);
  assert.equal(generatedScratchPaths.length, 5, 'status refresh should reuse existing county geometry paths');
  const mesh = scratchNodes.find(n => n.attrs.class === 'scratch-state-borders');
  assert.equal(mesh.attrs['pointer-events'], 'none');
  assert.equal(mesh.attrs['stroke-opacity'], 0.35);
  assert.equal(element('scratchStatsLabel').textContent, '2 / 4 Visited/Lived · 1 Transited');
});
check('National Parks dataset stays in Scratch Map and other dataset buttons still return to political maps', () => {
  const renderParks = vm.runInContext('renderNationalParksScratch', context);
  let renders = 0;
  context.parkDatasetRender = () => { renders++; };
  vm.runInContext("renderNationalParksScratch=parkDatasetRender;AppState.currentTab='scratch'", context);
  try {
    element('btnScratchNationalParks').handlers.click();
    assert.equal(vm.runInContext('AppState.scratchDataset', context), 'nationalparks');
    assert.equal(vm.runInContext('AppState.currentTab', context), 'scratch');
    assert.equal(renders, 1);
    assert.ok(element('btnScratchNationalParks').className.includes('bg-blue-600'));
    for (const [button, dataset] of [['btnScratchWorld', 'world'], ['btnScratchUsa', 'usa'], ['btnScratchCounties', 'counties']]) {
      element(button).handlers.click();
      assert.equal(vm.runInContext('AppState.scratchDataset', context), dataset);
      assert.ok(!element('btnScratchNationalParks').className.includes('bg-blue-600'));
    }
  } finally {
    context.renderNationalParksScratch = renderParks;
    vm.runInContext("AppState.currentTab='map'", context);
  }
});
check('countries, states and counties cycle through every manual status independently of travel', () => {
  for (const dataset of ['world', 'usa', 'counties']) {
    vm.runInContext(`applyPassport(migratePassport({}));AppState.scratchDataset='${dataset}';renderScratchMap()`, context);
    for (const next of ['v', 'w', 't', 'l', 'un']) {
      const regions = scratchNodes.find(n => n.attrs.class === 'scratch-regions');
      regions.click({}, regions.data[0]);
      const actual = vm.runInContext('scratchStatuses()[scratchStatusKey(' +
        (dataset === 'world' ? 'worldGeoJson' : dataset === 'usa' ? 'usaGeoJson' : 'countyGeoJson') + '[0])]', context);
      assert.equal(actual || 'un', next, dataset);
      if (dataset === 'counties' && next === 'l') {
        assert.equal(JSON.parse(savedJson).counties['06001'], 'l');
        assert.equal(JSON.parse(savedJson).statusOverrides.counties['06001'], 'l');
        assert.equal(vm.runInContext('AppState.homeBase', context), null);
      }
    }
  }
  assert.ok(!Object.hasOwn(JSON.parse(savedJson).counties, '06001'));
  assert.equal(JSON.parse(savedJson).statusOverrides.counties['06001'], 'un');
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
check('manual county status overrides travel-derived status without changing the expedition', () => {
  vm.runInContext("applyPassport(migratePassport({}));AppState.scratchDataset='counties';AppState.expeditions=[{...testExpedition,id:'scratch-trip',countyIds:['06001']}];syncDerivedState();cycleScratchStatus(countyGeoJson[0])", context);
  assert.equal(vm.runInContext('AppState.counties["06001"]', context), 'w');
  assert.equal(vm.runInContext('AppState.expeditions[0].countyIds[0]', context), '06001');
  assert.equal(JSON.parse(savedJson).expeditions[0].countyIds[0], '06001');
  assert.equal(JSON.parse(savedJson).statusOverrides.counties['06001'], 'w');
  for (const [status, expected] of [['w', 't'], ['t', 'l'], ['l', 'un'], ['un', 'v']]) {
    vm.runInContext('cycleScratchStatus(countyGeoJson[0])', context);
    assert.equal(vm.runInContext('AppState.counties["06001"] || "un"', context), expected);
    assert.equal(vm.runInContext('AppState.expeditions[0].countyIds[0]', context), '06001');
  }
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
    ['foot','Remoteness'],['ferry','Worldly'],['flight','Worldly'],['rail','Worldly']]) {
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
  assert.deepEqual(Array.from(vm.runInContext('bucketDestinationTypes({custom:true,category:"City"})', context)), ['custom','cities']);
  assert.equal(vm.runInContext('matchesBucketType({custom:true,category:"City"},"cities")', context), true);
  assert.deepEqual(Array.from(vm.runInContext('bucketDestinationTypes({name:"National Monument",designation:"Park"})', context)), ['other']);
});
const originalPhotonFetch = context.fetch;
context.fetch = async url => {
  assert.ok(url.includes('osm_tag=place%3Acity'));
  assert.ok(url.includes('osm_tag=place%3Aisland'));
  return {
    ok: true,
    json: async () => ({ features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-135.33, 57.05] },
        properties: { osm_key: 'place', osm_value: 'city', osm_type: 'N', osm_id: 12345,
          name: 'Sitka', state: 'Alaska', country: 'United States', countrycode: 'us' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-135.4, 57.1] },
        properties: { osm_key: 'place', osm_value: 'hamlet', osm_type: 'N', osm_id: 12346,
          name: 'Jamestown Bay', state: 'Alaska', country: 'United States' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-135.33, 57.05] },
        properties: { osm_key: 'tourism', osm_value: 'attraction', osm_type: 'N', osm_id: 12347,
          name: 'Ignored attraction' } }
    ] })
  };
};
vm.runInContext("AppState.currentTab='bucketlist';", context);
element('bucketSearch').value = 'Sitka';
await vm.runInContext('searchBucketPhotonCities("Sitka", ++bucketPhotonSearchVersion)', context);
check('ledger Photon search filters populated places and renders one-click status options', () => {
  assert.equal(vm.runInContext('bucketPhotonResults.length', context), 2);
  const matches = element('bucketCityMatchesList').innerHTML;
  assert.ok(matches.includes('Sitka'));
  assert.ok(matches.includes('Jamestown Bay'));
  assert.ok(!matches.includes('Ignored attraction'));
  for (const status of ['v', 'w', 't', 'l']) assert.ok(matches.includes(`data-photon-status="${status}"`));
});
const originalCityHelpers = vm.runInContext('({ addCustomPoi, renderParkMarkers, drawFogOfWar, updateAllUI, showNotification, cachedPoliticalAt, cachedBiomeAt, cachedBiomeRegionAt, coordinateIndexes })', context);
try {
  vm.runInContext(`
    coordinateIndexes={countries:[{}],states:[{}],counties:[{}],ecoregions:[{}]};
    cityLookupCalls=[];
    cachedPoliticalAt=(lat,lng)=>{cityLookupCalls.push(['political',lat,lng]);return {
      countries:[],states:[],counties:[{id:'02220',name:'Sitka City and Borough'}]
    };};
    cachedBiomeRegionAt=(lat,lng)=>{cityLookupCalls.push(['biome-region',lat,lng]);return {
      ecoregions:[{id:1,name:'Pacific Coastal Mountains',realm:'Nearctic',biomeId:5}],biomeStatus:'matched'
    };};
    cachedBiomeAt=(lat,lng)=>{cityLookupCalls.push(['biome',lat,lng]);return ['5'];};
    addCustomPoi=poi=>{capturedPhotonCity=poi;};
    renderParkMarkers=()=>{};drawFogOfWar=()=>{};updateAllUI=()=>{};showNotification=()=>{};
    savePhotonCity(bucketPhotonResults[0],'w');
  `, context);
  const city = context.capturedPhotonCity;
  const normalizedCity = travelLedger.normalizePoi(city, coordinateLookups);
  check('Photon city saves resolved political and biome metadata without an Overpass lookup', () => {
    assert.equal(normalizedCity.name, 'Sitka');
    assert.equal(normalizedCity.category, 'City');
    assert.equal(normalizedCity.status, 'w');
    assert.equal(normalizedCity.elevationFt, null);
    assert.equal(normalizedCity.rarity, null);
    assert.deepEqual(Array.from(normalizedCity.political.countries), ['United States']);
    assert.deepEqual(Array.from(normalizedCity.political.states), ['Alaska']);
    assert.deepEqual(JSON.parse(JSON.stringify(normalizedCity.political.counties)),
      [{ id: '02220', name: 'Sitka City and Borough' }]);
    assert.deepEqual(Array.from(normalizedCity.biomes), ['5']);
    assert.deepEqual(Array.from(vm.runInContext('cityLookupCalls.map(call=>call[0])', context)),
      ['political', 'biome-region', 'biome']);
  });
} finally {
  context.originalCityHelpers = originalCityHelpers;
  vm.runInContext(`
    addCustomPoi=originalCityHelpers.addCustomPoi;
    renderParkMarkers=originalCityHelpers.renderParkMarkers;
    drawFogOfWar=originalCityHelpers.drawFogOfWar;
    updateAllUI=originalCityHelpers.updateAllUI;
    showNotification=originalCityHelpers.showNotification;
    cachedPoliticalAt=originalCityHelpers.cachedPoliticalAt;
    cachedBiomeAt=originalCityHelpers.cachedBiomeAt;
    cachedBiomeRegionAt=originalCityHelpers.cachedBiomeRegionAt;
    coordinateIndexes=originalCityHelpers.coordinateIndexes;
    AppState.currentTab='map';
  `, context);
  context.fetch = originalPhotonFetch;
  element('bucketSearch').value = '';
}
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
  assert.equal(element('bucketResultsCount').textContent, '2 / 5 destinations match · Showing 1–2');
});
check('type, search and status filters combine and remain selected after marking a destination', () => {
  element('bucketFilterType').value = 'monuments';
  element('bucketFilterStatus').value = 'w';
  element('bucketSearch').value = 'test';
  vm.runInContext('renderBucketListView()', context);
  assert.ok(element('bucketListGrid').innerHTML.includes('Test Monument'));
  assert.equal(element('bucketResultsCount').textContent, '1 / 5 destinations match · Showing 1–1');
  context.window.matchMedia = () => ({ matches: true });
  vm.runInContext("AppState.currentTab='bucketlist';setPinStatus('filter_monument','v')", context);
  assert.ok(element('bucketListGrid').innerHTML.includes('No destination matches'));
  assert.equal(element('bucketFilterType').value, 'monuments');
  assert.equal(element('bucketFilterStatus').value, 'w');
  assert.equal(element('bucketResultsCount').textContent, '0 / 5 destinations match · Showing 0–0');
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
    assert.equal(element('bucketResultsCount').textContent, `${count} / 5 destinations match · Showing 1–${count}`);
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
    assert.equal(element('bucketResultsCount').textContent, `${count} / 5 destinations match · Showing 1–${count}`);
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
  assert.equal(element('bucketResultsCount').textContent, `${actualSnapshot.total} / ${actualSnapshot.total + internationalParks.length} destinations match · Showing 1–50`);
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
    applyPassport(migratePassport({}));AppState.mode='rpg';AppState.currentTab='map';AppState.viewOnly=false;
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
  const originalAddStop = vm.runInContext('addExpeditionStop', context);
  vm.runInContext("addExpeditionStop=(kind,id)=>pickedCounties.push([kind,id])", context);
  const beforePicking = vm.runInContext('JSON.stringify(passportPayload())', context);
  layers[0].handlers.click();
  assert.deepEqual(Array.from(context.pickedCounties[0]), ['county', '06001']);
  assert.equal(vm.runInContext('JSON.stringify(passportPayload())', context), beforePicking);
  vm.runInContext('AppState.viewOnly=true', context);
  layers[0].handlers.click();
  assert.equal(context.pickedCounties.length, 1);
  context.addExpeditionStop = originalAddStop;
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
check('travel anywhere grows the starting home circle into its county without changing the saved radius', () => {
  vm.runInContext(`
    applyPassport(migratePassport({
      homeBase:{name:'Home',lat:37,lng:-120,radiusKm:80,countyId:'06073'},
      counties:{'06073':'l','06065':'v'}, pins:{distant:'w'}
    }));
    coordinateIndexes=null;PARKS=[];AppState.mode='rpg';fogZoomAnimating=false;
    fogCtx.fill=rule=>fogOperations.push(['polygonFill',rule]);
    countyFeaturesById['06073']={geometry:{type:'Polygon',coordinates:[[[-120,37],[-119,37],[-119,38],[-120,37]]]}};
    map={options:{crs:{scale:zoom=>256*2**zoom}},getZoom:()=>6,latLngToContainerPoint:()=>({x:0,y:0})};
  `, context);
  for (const [status, expected] of [['w', 0], ['t', 1], ['v', 1], ['l', 1]]) {
    context.fogOperations.length = 0;
    vm.runInContext(`AppState.pins.distant='${status}';drawFogOfWar()`, context);
    assert.equal(context.fogOperations.filter(op => op[0] === 'polygonFill' && op[1] === 'evenodd').length, expected);
    assert.equal(vm.runInContext('AppState.homeBase.radiusKm', context), travelLedger.homeRadiusKm);
    assert.equal(vm.runInContext('AppState.counties["06073"]', context), 'l');
  }
  vm.runInContext('saveState();applyPassport(migratePassport(JSON.parse(localStorage.getItem("terra_incognita_state"))))', context);
  assert.equal(vm.runInContext('loggedCountyStatuses(false)["06073"]', context), 'l');
  vm.runInContext("AppState.pins={};AppState.expeditions=[testExpedition];", context);
  assert.equal(vm.runInContext('loggedCountyStatuses(false)["06073"]', context), 'l');
  vm.runInContext('AppState.expeditions=[]', context);
  assert.equal(vm.runInContext('loggedCountyStatuses(false)["06073"]', context), undefined);
  vm.runInContext('map=null', context);
});
check('dedicated achievement page hides untouched badges and does not duplicate cards in the profile', () => {
  assert.equal((html.match(/id="achievementsContainer"/g) || []).length, 1);
  assert.ok(html.indexOf('id="achievementsContainer"') > html.indexOf('id="tabContent-achievements"'));
  assert.ok(html.includes('data-tab="achievements"'));
  vm.runInContext('applyPassport(migratePassport({}));PARKS=[];coordinateIndexes=null;map=null', context);
  vm.runInContext("switchTab('achievements')", context);
  assert.equal(vm.runInContext('AppState.currentTab', context), 'achievements');
  assert.ok(element('achievementsContainer').innerHTML.includes('Venture out'));
  for (const title of ['Chasing Waterfalls', 'Southern Cross', 'Local Lore', 'Zero Meridian', 'Thin Air', 'Earth Sandwich']) {
    assert.ok(!element('achievementsContainer').innerHTML.includes(title), title);
  }
  vm.runInContext(`
    AppState.customPois=[{...customLocation,id:'poi_first_fall',category:'waterfall',status:'v'}];
    updateAllUI();
  `, context);
  assert.ok(element('achievementsContainer').innerHTML.includes('Chasing Waterfalls'));
  assert.ok(element('achievementsContainer').innerHTML.includes('value="1" max="5"'));
  for (const id of ['borderlands', 'offGrid', 'ghostTown', 'dateLine', 'continents']) {
    assert.equal(vm.runInContext(`ACHIEVEMENTS.some(achievement=>achievement.id==='${id}')`, context), false);
  }
});
check('biome achievement tiers use 3, total minus one and total with progressive disclosure', () => {
  for (const [count, visible, hidden] of [
    [0, [], ['Junior Ecologist', 'Almost There!', 'Gaia Wanderer']],
    [1, ['Junior Ecologist'], ['Almost There!', 'Gaia Wanderer']],
    [3, ['Junior Ecologist', 'Almost There!'], ['Gaia Wanderer']],
    [13, ['Almost There!', 'Gaia Wanderer'], ['Junior Ecologist']],
    [14, ['Gaia Wanderer'], ['Junior Ecologist', 'Almost There!']]
  ]) {
    context.biomeCount = count;
    vm.runInContext(`
      applyPassport(migratePassport({}));PARKS=[];coordinateIndexes=null;
      AppState.customPois=biomeCount ? [{...customLocation,id:'poi_biome_tiers',status:'v',
        biomes:Array.from({length:biomeCount},(_,i)=>String(i+1))}] : [];
      renderAchievementsView();
    `, context);
    const cards = element('achievementsContainer').innerHTML;
    visible.forEach(title => assert.ok(cards.includes(title), `${count}: ${title}`));
    hidden.forEach(title => assert.ok(!cards.includes(title), `${count}: hidden ${title}`));
  }
  vm.runInContext("BIOMES={...BIOMES,'15':{}}", context);
  assert.equal(vm.runInContext("ACHIEVEMENTS.find(a=>a.id==='biomes').tiers[1].goal()", context), 14);
  assert.equal(vm.runInContext("ACHIEVEMENTS.find(a=>a.id==='biomes').tiers[2].goal()", context), 15);
  vm.runInContext("delete BIOMES['15']", context);
});
check('atlas completion goals use actual datasets and exclude unknown countries and FIPS IDs', () => {
  vm.runInContext(`
    applyPassport(migratePassport({}));PARKS=[];coordinateIndexes=null;
    worldGeoJson=[{properties:{name:'Canada'}},{properties:{name:'United States of America'}}];
    countyGeoJson=[{id:'06073'},{id:'06065'}];
    AppState.regions={'c:Canada':'v','c:Unknown land':'l','c:United States of America':'t'};
    AppState.counties={'06073':'v','06065':'t','99999':'l'};
    renderAchievementsView();
  `, context);
  assert.equal(vm.runInContext('calculateStats().atlasCountriesCount', context), 1);
  assert.equal(vm.runInContext('calculateStats().countiesCount', context), 1);
  assert.equal(vm.runInContext("ACHIEVEMENTS.find(a=>a.id==='worldAtlas').tiers[0].goal(calculateStats())", context), 2);
  assert.ok(element('achievementsContainer').innerHTML.includes('Progress: 1 / 2 (50%)'));
  assert.ok(element('achievementsContainer').innerHTML.includes(
    'The Earth is no longer just a map—it is your neighborhood. No sovereign border can remain uncrossed.'
  ));
  assert.ok(element('achievementsContainer').innerHTML.includes(
    'aria-label="Cryptic hint, blurred until completion"'
  ));
  assert.ok(html.includes('.achievement-redacted {\n      filter: blur(0.7px);'));
  assert.match(element('achievementsContainer').innerHTML, /achievement-icon achievement-icon-hidden/);
  assert.equal(vm.runInContext("ACHIEVEMENTS.find(a=>a.id==='worldAtlas').title", context), 'How????');
  assert.equal(vm.runInContext("ACHIEVEMENTS.find(a=>a.id==='worldAtlas').tiers[0].title", context), 'How????');
  assert.ok(!element('achievementsContainer').innerHTML.includes(
    'Visit every country/territory represented in the World Nations atlas'
  ));
  vm.runInContext('worldGeoJson=null;countyGeoJson=null;renderAchievementsView()', context);
  assert.ok(!element('achievementsContainer').innerHTML.includes('How????'));
  assert.ok(!element('achievementsContainer').innerHTML.includes('Citizen of the World'));
  assert.ok(!element('achievementsContainer').innerHTML.includes('Manifest Destiny'));
});
check('every real tier hides at zero, redacts only Legendary/Mythic, and reveals exact criteria on completion', () => {
  const cards = [];
  const badges = [];
  const cardContainer = element('achievementsContainer');
  const badgeContainer = element('earnedAchievementBadges');
  const originalCardAppend = cardContainer.appendChild;
  const originalBadgeAppend = badgeContainer.appendChild;
  const originalCreate = context.document.createElement;
  cardContainer.appendChild = card => cards.push(card);
  badgeContainer.appendChild = badge => badges.push(badge);
  context.document.createElement = () => ({
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener() {}
  });
  const cases = vm.runInContext(`ACHIEVEMENTS.flatMap(achievement => achievement.tiers.map(tier => ({
    id: achievement.id, title: tier.title, desc: tier.desc, secretDesc: tier.secretDesc, rarity: tier.rarity,
    goal: typeof tier.goal === 'function'
      ? tier.goal({npsTotal:474,countyTotal:3231,atlasCountriesTotal:200}) : tier.goal
  })))`, context);
  vm.runInContext(`
    var disclosureTestAchievements = ACHIEVEMENTS.slice();
    var disclosureTestSnapshot = achievementProgressSnapshot;
  `, context);
  try {
    for (const testCase of cases) {
      context.disclosureTestCase = testCase;
      const secret = ['legendary', 'mythic'].includes(testCase.rarity);
      vm.runInContext(`
        ACHIEVEMENTS.splice(0, ACHIEVEMENTS.length, {
          ...disclosureTestAchievements.find(a => a.id === disclosureTestCase.id),
          progress: s => s.testProgress, tiers: [disclosureTestCase]
        });
      `, context);
      for (const progress of [0, testCase.goal / 2, testCase.goal]) {
        cards.length = 0;
        badges.length = 0;
        context.disclosureTestProgress = progress;
        vm.runInContext(`
          achievementProgressSnapshot = null;
          renderAchievementsView({testProgress:disclosureTestProgress});
          renderEarnedAchievementBadges({testProgress:disclosureTestProgress});
        `, context);
        if (progress === 0) {
          assert.equal(cards.length, 0, testCase.title);
          assert.equal(badges.length, 0, testCase.title);
          continue;
        }
        assert.equal(cards.length, 1, testCase.title);
        const card = cards[0];
        assert.ok(card.innerHTML.includes(testCase.title), testCase.title);
        const locked = secret && progress < testCase.goal;
        assert.equal(card.innerHTML.includes(testCase.desc), !locked, testCase.title);
        assert.equal(card.innerHTML.includes('achievement-redacted'), locked, testCase.title);
        assert.equal(card.innerHTML.includes('achievement-icon-hidden'), locked, testCase.title);
        assert.equal(secret ? typeof testCase.secretDesc === 'string' : true, true, testCase.title);
        assert.equal(testCase.secretDesc ? card.innerHTML.includes(testCase.secretDesc) : false, locked, testCase.title);
        assert.equal(card.innerHTML.includes('Cryptic hint, blurred until completion'), locked, testCase.title);
        assert.equal(card.innerHTML.includes('<progress '), !locked, testCase.title);
        assert.equal(card.className.includes('achievement-complete'), secret && !locked, testCase.title);
        if (locked) {
          assert.ok(card.innerHTML.includes(` / ${testCase.goal} (50%)`), testCase.title);
          assert.equal((card.innerHTML.match(new RegExp(` / ${testCase.goal}`, 'g')) || []).length, 1);
          assert.equal(badges.length, 0, testCase.title);
        } else if (progress >= testCase.goal) {
          assert.ok(card.innerHTML.includes('Class title unlocked'), testCase.title);
          if (testCase.secretDesc) assert.ok(!card.innerHTML.includes(testCase.secretDesc), testCase.title);
          assert.equal(badges.length, 1, testCase.title);
          assert.ok(badges[0].attributes.title.includes(testCase.desc), testCase.title);
        } else {
          assert.equal(badges.length, 0, testCase.title);
        }
      }
    }
  } finally {
    vm.runInContext(`
      ACHIEVEMENTS.splice(0, ACHIEVEMENTS.length, ...disclosureTestAchievements);
      achievementProgressSnapshot = disclosureTestSnapshot;
    `, context);
    cardContainer.appendChild = originalCardAppend;
    badgeContainer.appendChild = originalBadgeAppend;
    context.document.createElement = originalCreate;
  }
});
check('secret completion effects fire once on crossing the goal, not initial load or repeated renders', () => {
  const result = vm.runInContext(`(() => {
    const achievements = ACHIEVEMENTS.slice();
    const snapshot = achievementProgressSnapshot;
    const playChime = AudioEngine.playChime;
    const notify = showNotification;
    const chimes = [], notices = [];
    AudioEngine.playChime = sound => chimes.push(sound);
    showNotification = (...args) => notices.push(args);
    try {
      const earthSandwich = achievements.find(a => a.id === 'earthSandwich');
      ACHIEVEMENTS.splice(0, ACHIEVEMENTS.length, earthSandwich);
      achievementProgressSnapshot = null;
      announceSecretAchievementCompletions({metadataProgress:{earthSandwich:2}});
      const initial = chimes.length;
      announceSecretAchievementCompletions({metadataProgress:{earthSandwich:1}});
      announceSecretAchievementCompletions({metadataProgress:{earthSandwich:2}});
      announceSecretAchievementCompletions({metadataProgress:{earthSandwich:2}});
      return {initial, chimes, notices};
    } finally {
      ACHIEVEMENTS.splice(0, ACHIEVEMENTS.length, ...achievements);
      achievementProgressSnapshot = snapshot;
      AudioEngine.playChime = playChime;
      showNotification = notify;
    }
  })()`, context);
  assert.equal(result.initial, 0);
  assert.deepEqual(Array.from(result.chimes), ['levelup']);
  assert.equal(result.notices.length, 1);
  assert.ok(result.notices[0][1].includes('Earth Sandwich'));
});
check('every achievement tier has valid difficulty rarity and distinct emoji artwork', () => {
  assert.equal(vm.runInContext('ACHIEVEMENTS.every(a=>a.icon && /^#[0-9a-f]{6}$/i.test(a.background) && a.tiers.every(t=>ACHIEVEMENT_RARITIES[t.rarity]))', context), true);
  assert.equal(vm.runInContext("ACHIEVEMENTS.find(a=>a.id==='earthSandwich').icon", context), '🌍🥪');
  assert.equal(vm.runInContext("ACHIEVEMENTS.find(a=>a.id==='earthSandwich').background", context), '#172554');
  assert.equal(vm.runInContext("ACHIEVEMENTS.find(a=>a.id==='earthSandwich').tiers[0].rarity", context), 'legendary');
  assert.ok(html.includes('.achievement-icon[data-rarity="mythic"]'));
  assert.ok(html.includes('linear-gradient(135deg, #fb7185'));
});
check('character badges include only highest earned tiers and update without duplication or stale awards', () => {
  const captured = [];
  const container = element('earnedAchievementBadges');
  const originalAppend = container.appendChild;
  const originalCreate = context.document.createElement;
  container.appendChild = badge => captured.push(badge);
  context.document.createElement = () => ({
    attributes: {}, handlers: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, handler) { this.handlers[name] = handler; }
  });
  try {
    vm.runInContext('applyPassport(migratePassport({}));PARKS=[];coordinateIndexes=null;renderPassportView()', context);
    assert.equal(captured.length, 0);
    assert.ok(container.innerHTML.includes('earned achievement badges'));
    for (const [count, rarity] of [[1, 'common'], [4, 'common'], [5, 'uncommon'], [10, 'rare']]) {
      captured.length = 0;
      context.badgeWaterfalls = count;
      vm.runInContext(`
        applyPassport(migratePassport({}));
        AppState.customPois=Array.from({length:badgeWaterfalls},(_,i)=>({
          ...customLocation,id:'badge_falls_'+i,category:'waterfall',status:'v',biomes:[]
        }));
        renderPassportView();
      `, context);
      const badges = captured.filter(badge => badge.attributes['data-achievement'] === 'waterfalls');
      assert.equal(badges.length, 1);
      assert.equal(badges[0].attributes['data-rarity'], rarity);
      assert.ok(badges[0].attributes['aria-label'].includes('Chasing Waterfalls'));
      assert.equal(badges[0].attributes.title, badges[0].attributes['aria-label']);
      assert.ok(badges[0].innerHTML.includes('💧'));
      assert.equal(captured.some(badge => badge.attributes['data-achievement'] === 'localLore'), false);
    }
    const waterfall = captured.find(badge => badge.attributes['data-achievement'] === 'waterfalls');
    waterfall.handlers.click();
    assert.equal(vm.runInContext('AppState.currentTab', context), 'achievements');
    captured.length = 0;
    vm.runInContext("AppState.customPois.forEach(poi=>poi.status='w');renderPassportView()", context);
    assert.equal(captured.length, 0);
    vm.runInContext("AppState.homeBase={name:'Home',lat:0,lng:0,radiusKm:TravelLedger.homeRadiusKm};renderPassportView()", context);
    assert.ok(captured.some(badge => badge.attributes['data-achievement'] === 'zeroMeridian'));
  } finally {
    container.appendChild = originalAppend;
    context.document.createElement = originalCreate;
  }
});
check('achievement cards show artwork and textual tier rarities without revealing zero-progress achievements', () => {
  vm.runInContext(`
    applyPassport(migratePassport({}));PARKS=[];coordinateIndexes=null;
    AppState.customPois=[{...customLocation,id:'poi_rarity_fall',category:'waterfall',status:'v'}];
    renderAchievementsView();
  `, context);
  const cards = element('achievementsContainer').innerHTML;
  assert.ok(cards.includes('💧'));
  assert.ok(cards.includes('data-rarity="common"'));
  assert.ok(cards.includes('data-rarity="uncommon"'));
  assert.ok(cards.includes('>Common</p>'));
  assert.ok(cards.includes('>Uncommon</p>'));
  assert.ok(!cards.includes('Southern Cross'));
  assert.ok(!cards.includes('Zero Meridian'));
});
check('regional music achievements disclose partial prerequisites and award colored badges only on completion', () => {
  vm.runInContext(`
    applyPassport(migratePassport({}));PARKS=[];coordinateIndexes=null;map=null;
    renderPassportView();
  `, context);
  assert.ok(!element('achievementsContainer').innerHTML.includes('Country Roads, Take Me Home'));
  assert.ok(!element('achievementsContainer').innerHTML.includes('Rocky Mountain High'));
  vm.runInContext(`
    AppState.regions={'s:West Virginia':'v'};
    AppState.counties={'08075':'v'};
    renderPassportView();
  `, context);
  assert.ok(element('achievementsContainer').innerHTML.includes('Country Roads, Take Me Home'));
  assert.ok(element('achievementsContainer').innerHTML.includes('value="1" max="2"'));
  assert.ok(!element('earnedAchievementBadges').innerHTML.includes('🛣️🏡'));
  assert.ok(!element('achievementsContainer').innerHTML.includes('Rocky Mountain High'));
  vm.runInContext("AppState.pins.shen='v';AppState.counties['08065']='l';renderPassportView()", context);
  const badges = element('earnedAchievementBadges').innerHTML;
  assert.ok(badges.includes('🛣️🏡'));
  assert.ok(badges.includes('🏔️🎵'));
  assert.equal(vm.runInContext("ACHIEVEMENTS.find(a=>a.id==='countryRoads').tiers[0].rarity", context), 'rare');
  assert.equal(vm.runInContext("ACHIEVEMENTS.find(a=>a.id==='rockyMountainHigh').tiers[0].rarity", context), 'uncommon');
  vm.runInContext('saveState();applyPassport(migratePassport(JSON.parse(localStorage.getItem("terra_incognita_state"))));renderPassportView()', context);
  assert.equal(vm.runInContext('calculateStats().metadataProgress.countryRoads', context), 2);
  assert.equal(vm.runInContext('calculateStats().metadataProgress.rockyMountainHigh', context), 1);
});
check('ledger renders at most 50 cards and every real destination is reachable exactly once', () => {
  vm.runInContext('PARKS=[...realUnits,...realInternational];applyPassport(migratePassport({}));AppState.currentTab="bucketlist"', context);
  element('bucketSearch').value = '';
  element('bucketFilterType').value = 'all';
  element('bucketFilterStatus').value = 'all';
  vm.runInContext('renderBucketListView()', context);
  const found = new Set();
  const pageCount = Math.ceil((actualSnapshot.total + internationalParks.length) / 50);
  for (let page = 0; page < pageCount; page++) {
    assert.equal(element('bucketPageLabel').textContent, `Page ${page + 1} of ${pageCount}`);
    assert.equal(element('bucketPrevPage').disabled, page === 0);
    assert.equal(element('bucketNextPage').disabled, page === pageCount - 1);
    const ids = [...element('bucketListGrid').innerHTML.matchAll(/onclick="setPinStatus\('([^']+)', 'v'\)/g)].map(match => match[1]);
    assert.ok(ids.length > 0 && ids.length <= 50);
    for (const id of ids) {
      assert.ok(!found.has(id), `duplicate ${id}`);
      found.add(id);
    }
    if (page < pageCount - 1) element('bucketNextPage').handlers.click();
  }
  assert.equal(found.size, actualSnapshot.total + internationalParks.length);
  assert.equal(vm.runInContext('bucketPage', context), pageCount - 1);
  element('bucketPrevPage').handlers.click();
  assert.equal(vm.runInContext('bucketPage', context), pageCount - 2);
  assert.ok(html.includes('aria-label="Travel Ledger pages"'));
  assert.ok(!element('bucketListGrid').innerHTML.includes('rpg-panel'));
});
check('ledger filters reset the page, edits preserve it and shrinking results clamp it', () => {
  vm.runInContext('bucketPage=7;renderBucketListView()', context);
  element('bucketFilterType').value = 'nps-parks';
  element('bucketFilterType').handlers.change();
  assert.equal(vm.runInContext('bucketPage', context), 0);
  element('bucketNextPage').handlers.click();
  assert.equal(vm.runInContext('bucketPage', context), 1);
  vm.runInContext("AppState.pins.yell='v';renderBucketListView()", context);
  assert.equal(vm.runInContext('bucketPage', context), 1);
  element('bucketSearch').value = 'American Samoa';
  vm.runInContext('renderBucketListView()', context);
  assert.equal(vm.runInContext('bucketPage', context), 0);
  assert.ok(element('bucketListGrid').innerHTML.includes('National Park of American Samoa'));
  element('bucketSearch').value = '';
  element('bucketFilterType').value = 'all';
  element('bucketFilterStatus').value = 'w';
  vm.runInContext("AppState.pins=Object.fromEntries(PARKS.slice(0,51).map(p=>[p.id,'w']));renderBucketListView();bucketPage=1;renderBucketListView()", context);
  assert.equal(element('bucketPageLabel').textContent, 'Page 2 of 2');
  vm.runInContext("delete AppState.pins[PARKS[50].id];renderBucketListView()", context);
  assert.equal(element('bucketPageLabel').textContent, 'Page 1 of 1');
  vm.runInContext('AppState.pins={};renderBucketListView()', context);
  assert.ok(element('bucketListGrid').innerHTML.includes('No destination matches'));
  assert.equal(element('bucketPrevPage').disabled, true);
  assert.equal(element('bucketNextPage').disabled, true);
});
check('search debounces rapid input and does not rebuild a hidden ledger', () => {
  const originalSet = context.setTimeout;
  const originalClear = context.clearTimeout;
  const timers = new Map();
  let id = 0;
  context.setTimeout = (callback, delay) => { assert.equal(delay, 150); timers.set(++id, callback); return id; };
  context.clearTimeout = timer => timers.delete(timer);
  try {
    vm.runInContext('AppState.currentTab="bucketlist"', context);
    element('bucketFilterStatus').value = 'all';
    element('bucketSearch').value = '';
    vm.runInContext('renderBucketListView()', context);
    const before = element('bucketListGrid').innerHTML;
    element('bucketSearch').value = 'American';
    element('bucketSearch').handlers.input();
    assert.notEqual(element('bucketListGrid').innerHTML, before);
    element('bucketSearch').value = 'American Samoa';
    element('bucketSearch').handlers.input();
    assert.equal(timers.size, 1);
    assert.ok(element('bucketListGrid').innerHTML.includes('National Park of American Samoa'));
    assert.ok(!element('bucketListGrid').innerHTML.includes('Yellowstone'));
    vm.runInContext('AppState.currentTab="map"', context);
    const filtered = element('bucketListGrid').innerHTML;
    element('bucketSearch').value = 'Yellowstone';
    element('bucketSearch').handlers.input();
    assert.equal(element('bucketListGrid').innerHTML, filtered);
  } finally {
    context.setTimeout = originalSet;
    context.clearTimeout = originalClear;
    element('bucketSearch').value = '';
  }
});
check('statistics cache survives navigation but not travel edits, dataset reloads, imports or rollback', () => {
  vm.runInContext(`
    applyPassport(migratePassport({}));coordinateIndexes=null;
    PARKS=[{id:'cache',name:'Cache Park',lat:37,lng:-120,states:[],biomes:[]}];
    countyGeoJson=[];worldGeoJson=[];
    const cachedStats=calculateStats();
    AppState.currentTab='passport';AppState.mode='classic';
  `, context);
  assert.equal(vm.runInContext('calculateStats()===cachedStats', context), true);
  vm.runInContext("AppState.pins.cache='v'", context);
  assert.equal(vm.runInContext('calculateStats()===cachedStats', context), false);
  assert.equal(vm.runInContext('calculateStats().visitedParks.length', context), 1);
  vm.runInContext('const visitedStats=calculateStats();PARKS=[...PARKS]', context);
  assert.equal(vm.runInContext('calculateStats()===visitedStats', context), false);
  vm.runInContext('applyPassport(migratePassport({}))', context);
  assert.equal(vm.runInContext('calculateStats().visitedParks.length', context), 0);
  assert.throws(() => vm.runInContext(`
    commitLedger(()=>{AppState.pins.cache='v';calculateStats();throw new Error('Cache rollback');})
  `, context), /Cache rollback/);
  assert.equal(vm.runInContext('calculateStats().visitedParks.length', context), 0);
});
check('coordinate lookups and derived fog counties reuse geography until its dataset changes', () => {
  const original = context.CoordinateLookups;
  let politicalCalls = 0;
  let biomeCalls = 0;
  context.CoordinateLookups = {
    ...original,
    politicalRegion() { politicalCalls++; return { countries: ['United States of America'], states: ['Colorado'], counties: [{ id: '08031' }] }; },
    biomeRegion() { biomeCalls++; return { biomes: ['5'] }; }
  };
  try {
    vm.runInContext(`
      applyPassport(migratePassport({}));PARKS=[];
      coordinateIndexes={ecoregions:[]};
      AppState.homeBase={lat:39.7,lng:-105,radiusKm:TravelLedger.homeRadiusKm,countyId:'08031'};
      cachedPoliticalAt(39.7,-105);cachedPoliticalAt(39.7,-105);
      cachedBiomeAt(39.7,-105);cachedBiomeAt(39.7,-105);
      const initialCounties=loggedCountyStatuses(false);
    `, context);
    assert.equal(politicalCalls, 1);
    assert.equal(biomeCalls, 1);
    assert.equal(vm.runInContext('loggedCountyStatuses(false)===initialCounties', context), true);
    vm.runInContext("AppState.counties['08031']='v'", context);
    assert.equal(vm.runInContext('loggedCountyStatuses(false)===initialCounties', context), true);
    vm.runInContext("AppState.routes=[[[39,-105],[40,-105]]]", context);
    assert.equal(vm.runInContext('loggedCountyStatuses(false)["08031"]', context), 'l');
    vm.runInContext(`
      coordinateIndexes={ecoregions:[]};
      cachedPoliticalAt(39.7,-105);cachedBiomeAt(39.7,-105);
      loggedCountyStatuses(false);
    `, context);
    assert.equal(politicalCalls, 2);
    assert.equal(biomeCalls, 2);
    vm.runInContext('coordinateIndexes=null;AppState.routes=[]', context);
    assert.equal(vm.runInContext('loggedCountyStatuses(false)["08031"]', context), undefined);
  } finally {
    context.CoordinateLookups = original;
    vm.runInContext('coordinateIndexes=null', context);
  }
});
check('hidden map work is deferred and move events coalesce to one fog redraw per frame', () => {
  const originalRaf = context.requestAnimationFrame;
  let frames = 0;
  let callback;
  context.requestAnimationFrame = frame => { frames++; callback = frame; return frames; };
  try {
    vm.runInContext(`
      AppState.currentTab='bucketlist';AppState.mode='classic';fogDrawFrame=null;
      map={getSize(){throw new Error('Hidden resize');},removeLayer(){throw new Error('Hidden markers');}};
      countyGeoJson=[{id:'08031'}];leafletMarkers={old:{}};
    `, context);
    context.fogOperations.length = 0;
    vm.runInContext('renderParkMarkers();renderCountyHitboxes();resizeFogCanvas();drawFogOfWar();scheduleFogDraw()', context);
    assert.equal(context.fogOperations.length, 0);
    assert.equal(frames, 0);
    vm.runInContext("AppState.currentTab='map';AppState.mode='rpg';fogZoomAnimating=false;map=null;scheduleFogDraw();scheduleFogDraw();scheduleFogDraw()", context);
    assert.equal(frames, 1);
    callback();
    assert.equal(vm.runInContext('fogDrawFrame', context), null);
    vm.runInContext('scheduleFogDraw()', context);
    assert.equal(frames, 2);
    vm.runInContext("AppState.currentTab='bucketlist'", context);
    callback();
    assert.equal(context.fogOperations.length, 0);
  } finally {
    context.requestAnimationFrame = originalRaf;
    vm.runInContext('fogDrawFrame=null;map=null;leafletMarkers={};', context);
  }
});
check('projected polygon paths are reused during pans, culled offscreen and rebuilt at a new zoom', () => {
  const originalPath = context.Path2D;
  let paths = 0;
  let projections = 0;
  let fills = 0;
  let zoom = 4;
  let panX = 0;
  const point = (x, y) => ({
    x, y, round() { return this; },
    subtract(other) { return point(this.x - other.x, this.y - other.y); }
  });
  check('detailed road paths reuse projected geometry during pans and rebuild only at a new zoom', () => {
    let projections=0,strokes=0,zoom=4,pan=0;
    const pathPoints = [];
    const point=(x,y)=>({x,y,round(){return this;},subtract(other){return point(x-other.x,y-other.y);}});
    context.roadMap={options:{crs:{scale:z=>256*2**z}},getZoom:()=>zoom,
      project([lat,lng]){projections++;return point(100000+lng,100000+lat);},latLngToContainerPoint:()=>point(pan,0)};
    context.roadCtx={
      save(){},restore(){},beginPath(){pathPoints.length=0;},
      moveTo(x,y){pathPoints.push([x,y]);},lineTo(x,y){pathPoints.push([x,y]);},
      stroke(){strokes++;}
    };
    try {
      vm.runInContext(`
        map=roadMap;fogCtx=roadCtx;fogPadding={x:100,y:100};fogCanvas.width=300;fogCanvas.height=300;
        const detailedRoad=Array.from({length:1000},(_,i)=>[i/100,i/100]);
        punchFogRoute(detailedRoad);
      `,context);
      assert.equal(strokes,1);
      assert.deepEqual(pathPoints[0], [0, 0]);
      assert.ok(pathPoints[pathPoints.length - 1].every(value => Math.abs(value - 9.99) < 1e-8));
      assert.ok(pathPoints.length < 150, 'dense geometry should be reduced to visible path detail');
      assert.ok(pathPoints.every(([x,y]) => Math.abs(x) < 10 && Math.abs(y) < 10));
      const first=projections;
      pan=10;
      vm.runInContext('punchFogRoute(detailedRoad)',context);
      assert.equal(projections,first+1);
      assert.equal(strokes,2);
      assert.deepEqual(pathPoints[0], [10, 0]);
      pan=10000;
      vm.runInContext('punchFogRoute(detailedRoad)',context);
      assert.equal(strokes,2);
      pan=0;zoom++;
      vm.runInContext('punchFogRoute(detailedRoad)',context);
      assert.ok(projections > first && projections < first + 1003,
        'zoom rebuild should project only simplified route vertices');
      assert.equal(strokes,3);
    } finally {
      vm.runInContext('map=null;fogCtx=null',context);
    }
  });
  context.Path2D = class {
    constructor() { paths++; }
    moveTo() {}
    lineTo() {}
    closePath() {}
  };
  context.projectedMap = {
    getZoom: () => zoom,
    project([lat, lng]) { projections++; return point(lng, lat); },
    latLngToContainerPoint: () => point(panX, 0)
  };
  context.projectedCtx = { save() {}, restore() {}, translate() {}, fill(path, rule) { assert.equal(rule, 'evenodd'); fills++; } };
  try {
    vm.runInContext(`
      map=projectedMap;fogCtx=projectedCtx;fogPadding={x:100,y:100};fogCanvas.width=300;fogCanvas.height=300;
      const cachedGeometry={type:'Polygon',coordinates:[[[0,0],[10,0],[10,10],[0,0]],[[2,2],[3,2],[3,3],[2,2]]]};
      punchFogPolygon(cachedGeometry);
    `, context);
    assert.equal(paths, 1);
    assert.equal(fills, 1);
    const firstProjections = projections;
    panX = 10;
    vm.runInContext('punchFogPolygon(cachedGeometry)', context);
    assert.equal(paths, 1);
    assert.equal(projections, firstProjections + 1);
    assert.equal(fills, 2);
    panX = 10000;
    vm.runInContext('punchFogPolygon(cachedGeometry)', context);
    assert.equal(fills, 2);
    panX = 0;
    zoom++;
    vm.runInContext('punchFogPolygon(cachedGeometry)', context);
    assert.equal(paths, 2);
    assert.equal(fills, 3);
  } finally {
    context.Path2D = originalPath;
    vm.runInContext('map=null;fogCtx=null', context);
  }
});
check('expedition form uses reason text, optional dates and a day-trip shortcut without map picking or tag clutter', () => {
  assert.ok(!html.includes('id="btnPickExpeditionMap"'));
  assert.ok(!html.includes('id="expeditionMapPicker"'));
  assert.ok(!html.includes('id="expeditionPurposeTags"'));
  assert.ok(!html.includes('Overnight stays default'));
  assert.ok(!html.includes('Counties use representative centroid'));
  assert.ok(html.includes('id="expeditionReason"'));
  assert.ok(html.includes('id="expeditionDayTrip"'));
  assert.ok(!/id="expedition(?:Start|End)"[^>]*required/.test(html));
  assert.equal(travelLedger.transitTags.road,'Drive / Road Trip');
  vm.runInContext('AppState.viewOnly=false;openExpedition()',context);
  assert.equal(element('expeditionStart').value,'');
  assert.equal(element('expeditionEnd').value,'');
  element('expeditionDayTrip').checked=true;
  element('expeditionDayTrip').handlers.change();
  assert.match(element('expeditionStart').value,/^\d{4}-\d{2}-\d{2}$/);
  assert.equal(element('expeditionEnd').value,element('expeditionStart').value);
  assert.equal(element('expeditionEnd').disabled,true);
  element('expeditionStart').value='2026-08-10';
  element('expeditionStart').handlers.change();
  assert.equal(element('expeditionEnd').value,'2026-08-10');
  element('expeditionDayTrip').checked=false;
  element('expeditionDayTrip').handlers.change();
  assert.equal(element('expeditionEnd').disabled,false);
  vm.runInContext('closeExpedition()',context);
});
const originalPlaceFetch=context.fetch;
context.fetch=async url=>{
  assert.ok(url.startsWith('https://photon.komoot.io/api/?'));
  assert.equal(new URL(url).searchParams.get('q'),'San Diego International Airport');
  return {ok:true,json:async()=>({features:[{geometry:{type:'Point',coordinates:[-117.1933,32.7338]},properties:{name:'San Diego International Airport'}}]})};
};
vm.runInContext('openExpedition()',context);
element('expeditionSearch').value='SAN';
const elementCountBeforePlace=elements.size;
await vm.runInContext('searchExpeditionPlaces()',context);
check('city and airport searches show selectable validated coordinates without creating visits', () => {
  assert.equal(element('expeditionStatus').textContent,'Choose a place to add it.');
  const result=[...elements.values()].slice(elementCountBeforePlace).find(item=>item.textContent==='San Diego International Airport');
  assert.ok(result);
  assert.equal(vm.runInContext('expeditionDraft.length',context),0);
  result.handlers.click();
  assert.equal(element('expeditionSearch').value,'');
  assert.equal(element('expeditionSearchResults').innerHTML,'');
  assert.equal(vm.runInContext('expeditionDraft[0].kind',context),'place');
  assert.deepEqual(Array.from(vm.runInContext('expeditionDraft[0].coords',context)),[32.7338,-117.1933]);
  assert.equal(vm.runInContext('AppState.expeditions.length',context),0);
});
context.fetch=async()=>({ok:true,json:async()=>({features:[{geometry:{type:'Point',coordinates:[0,'bad']},properties:{name:'Invalid'}}]})});
element('expeditionSearch').value='Invalid';
await vm.runInContext('searchExpeditionPlaces()',context);
check('invalid online places are reported and never appended to the itinerary',()=>{
  assert.ok(element('expeditionStatus').textContent.includes('latitude'));
  assert.equal(vm.runInContext('expeditionDraft.length',context),1);
});
let completeSearch;
context.fetch=async()=>({ok:true,json:()=>new Promise(resolve=>{completeSearch=resolve;})});
const pendingSearch=vm.runInContext('searchExpeditionPlaces()',context);
await new Promise(resolve=>setImmediate(resolve));
element('expeditionSearch').value='';
element('expeditionSearch').handlers.input();
completeSearch({features:[{geometry:{type:'Point',coordinates:[-105,39]},properties:{name:'Stale city'}}]});
await pendingSearch;
check('changing a search discards stale online results rather than appending the wrong city',()=>{
  assert.equal(element('expeditionSearchResults').innerHTML,'');
  assert.equal(vm.runInContext('expeditionDraft.length',context),1);
});
context.fetch=originalPlaceFetch;
const originalExpeditionLookups=context.CoordinateLookups;
const originalPreviewL=context.L;
const originalPreviewTimeout=context.setTimeout;
let roadRequests=0;
const previewTooltipTexts=[];
const previewLines=[];
const previewLayer={addTo(){return this;},getBounds(){return {};},bindTooltip(text){previewTooltipTexts.push(text);return this;}};
context.L={
  ...context.L,map:()=>({removeLayer(){},invalidateSize(){},fitBounds(){},setView(){},remove(){}}),
  tileLayer:()=>previewLayer,featureGroup:()=>previewLayer,
  polyline:(coords,options)=>{previewLines.push({coords,options});return previewLayer;},
  circleMarker:()=>previewLayer
};
context.setTimeout=callback=>{callback();return 0;};
context.CoordinateLookups={
  ...coordinateLookups,
  politicalRegion:(lat,lng)=>({countries:['United States of America'],states:[lng < -110?'California':'Colorado'],
    counties:[{id:lng < -110?'06073':lng < -106?'08097':'08031'}]}),
  biomeRegion:()=>({biomes:['5']}),
  lookupElevation:async()=>({feet:6000}),
  lookupRoadRoute:async(from,to)=>{roadRequests++;return [[...from],[39.7,-105.5],[...to]];},
  routeCountyIds:()=>['08059']
};
context.uiMixedStops=[
  {kind:'place',id:'san',name:'SAN <airport>',coords:[32.7338,-117.1933],travelMode:'flight'},
  {kind:'place',id:'den',name:'DEN',coords:[39.8561,-104.6737],travelMode:'road'},
  {kind:'place',id:'aspen',name:'Aspen',coords:[39.1911,-106.8175],travelMode:'ferry'},
  {kind:'place',id:'return',name:'DEN return',coords:[39.8561,-104.6737],travelMode:'road'}
];
vm.runInContext(`
  applyPassport(migratePassport({counties:{'08001':'v'}}));map=null;PARKS=[];
  expeditionRoadCache.clear();
  coordinateIndexes={countries:[],states:[],counties:[],ecoregions:[]};
  countyGeoJson=[{id:'08001'},{id:'08059'},{id:'06073'},{id:'08031'},{id:'08097'}];
  openExpedition();expeditionDraft=uiMixedStops.map(stop=>({...stop,coords:[...stop.coords]}));invalidateExpeditionRoutes();
`,context);
element('expeditionDayTrip').checked=false;
element('expeditionName').value='Mixed itinerary';
element('expeditionReason').value='<friends> & photography';
element('expeditionStart').value='';
element('expeditionEnd').value='';
const beforePreview=vm.runInContext('JSON.stringify(passportPayload())',context);
await element('btnPreviewExpedition').handlers.click();
check('mixed-mode preview only routes driving legs; ferries are direct without intermediate counties or land fog',()=>{
  assert.equal(vm.runInContext('JSON.stringify(passportPayload())',context),beforePreview);
  assert.equal(roadRequests,1);
  assert.equal(vm.runInContext('expeditionPreparedLegs[0].routeCoords.length',context),0);
  assert.equal(vm.runInContext('expeditionPreparedLegs[0].countyIds.length',context),0);
  assert.equal(vm.runInContext('expeditionPreparedLegs[0].routeSource',context),'none');
  assert.equal(vm.runInContext('expeditionPreparedLegs[1].countyIds[0]',context),'08059');
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(expeditionPreparedLegs[2].routeCoords)',context)),
    context.uiMixedStops.slice(2,4).map(stop=>stop.coords));
  assert.equal(vm.runInContext('expeditionPreparedLegs[2].routeSource',context),'direct');
  assert.deepEqual(Array.from(vm.runInContext('expeditionPreparedLegs[2].countyIds',context)),[]);
  assert.equal(element('btnSaveExpedition').disabled,false);
  assert.ok(previewTooltipTexts.includes('Aspen'));
  assert.ok(previewTooltipTexts.includes('SAN &lt;airport&gt;'));
  assert.ok(previewLines.some(line=>line.options.color==='#38bdf8' && line.options.dashArray==='8, 8'));
  assert.ok(previewLines.some(line=>line.options.color==='#94a3b8' && line.options.dashArray==='8, 8'));
  assert.ok(element('expeditionRouteSummary').textContent.includes('Ferry / Boat and flight routes clear ocean fog using a land stencil'));
  assert.ok(element('expeditionRouteSummary').textContent.includes('None of these modes award intermediate route counties'));
});
context.crypto.randomUUID=()=> 'mixed-ui';
await element('expeditionForm').handlers.submit({preventDefault(){}});
check('mixed-mode trips save with blank dates, endpoint and road county credit, reason text and editable history',()=>{
  assert.equal(vm.runInContext('AppState.expeditions.length',context),1,element('expeditionStatus').textContent);
  const saved=JSON.parse(vm.runInContext('JSON.stringify(AppState.expeditions[0])',context));
  assert.equal(saved.startDate,null);
  assert.equal(saved.endDate,null);
  assert.equal(saved.reason,'<friends> & photography');
  assert.deepEqual(saved.transitTags,['flight','road','ferry']);
  assert.deepEqual(saved.purposeTags,[]);
  assert.deepEqual(Array.from(vm.runInContext('Object.keys(AppState.counties).sort()',context)),['06073','08001','08031','08059','08097']);
  assert.equal(vm.runInContext('TravelLedger.fogRoutes(AppState.expeditions[0]).length',context),1);
  vm.runInContext('renderExpeditionHistory()',context);
  assert.ok(element('travelLogFeed').innerHTML.includes('data-edit-expedition="exp_mixed-ui"'));
  assert.ok(element('travelLogFeed').innerHTML.includes('&lt;friends&gt; &amp; photography'));
  assert.ok(element('travelLogFeed').innerHTML.includes('Dates not specified'));
  assert.ok(!element('travelLogFeed').innerHTML.includes('overnight stay'));
});
vm.runInContext('openExpedition(AppState.expeditions[0].id)',context);
check('editing a saved trip restores leg modes, reason and route preview without calling routing again',()=>{
  assert.equal(element('expeditionTitle').textContent,'Edit Expedition');
  assert.equal(element('expeditionReason').value,'<friends> & photography');
  assert.equal(vm.runInContext('expeditionDraft[0].travelMode',context),'flight');
  assert.equal(vm.runInContext('expeditionDraft[1].travelMode',context),'road');
  assert.equal(element('btnSaveExpedition').disabled,false);
  assert.equal(roadRequests,1);
  assert.equal(vm.runInContext('expeditionPreparedLegs[2].routeSource',context),'direct');
  assert.equal(vm.runInContext('expeditionPreparedLegs[1].routeSource',context),'routed');
});
vm.runInContext('expeditionDraft[1].travelMode="flight";invalidateExpeditionRoutes()',context);
await element('expeditionForm').handlers.submit({preventDefault(){}});
check('itinerary changes require a fresh preview and cannot accidentally save outdated driving geometry',()=>{
  assert.equal(element('btnSaveExpedition').disabled,true);
  assert.ok(element('expeditionStatus').textContent.includes('Preview your routes'));
  assert.equal(vm.runInContext('AppState.expeditions[0].routeLegs[1].mode',context),'road');
});
await element('btnPreviewExpedition').handlers.click();
context.localStorage.setItem=()=>{throw new Error('Edit storage full');};
const beforeFailedEdit=vm.runInContext('JSON.stringify(passportPayload())',context);
await element('expeditionForm').handlers.submit({preventDefault(){}});
check('failed edits retain their draft and roll back route, county and promotion changes together',()=>{
  assert.equal(vm.runInContext('JSON.stringify(passportPayload())',context),beforeFailedEdit);
  assert.equal(vm.runInContext('expeditionDraft.length',context),4);
  assert.ok(element('expeditionStatus').textContent.includes('Edit storage full'));
});
context.localStorage.setItem=(key,value)=>{savedJson=value;};
await element('expeditionForm').handlers.submit({preventDefault(){}});
check('editing driving to flight removes driven-only county credit while preserving separate manual visits',()=>{
  assert.equal(vm.runInContext('AppState.expeditions.length',context),1);
  assert.equal(vm.runInContext('AppState.expeditions[0].routeLegs[1].mode',context),'flight');
  assert.equal(vm.runInContext('AppState.counties["08059"]',context),undefined);
  assert.equal(vm.runInContext('AppState.counties["08001"]',context),'v');
  assert.equal(vm.runInContext('AppState.counties["06073"]',context),'v');
  assert.equal(vm.runInContext('TravelLedger.fogRoutes(AppState.expeditions[0]).length',context),0);
});
vm.runInContext('AppState.viewOnly=true;renderExpeditionHistory()',context);
check('shared passports show expedition history but cannot open an editor or update records',()=>{
  assert.ok(!element('travelLogFeed').innerHTML.includes('data-edit-expedition'));
  assert.throws(()=>vm.runInContext('updateExpedition(AppState.expeditions[0])',context),/read-only/);
  vm.runInContext('openExpedition(AppState.expeditions[0].id)',context);
  assert.equal(vm.runInContext('expeditionEditingId',context),null);
});
vm.runInContext(`
  AppState.viewOnly=false;openExpedition();expeditionRoadCache.clear();
  expeditionDraft=uiMixedStops.map(stop=>({...stop,coords:[...stop.coords]}));invalidateExpeditionRoutes();
`,context);
context.CoordinateLookups.lookupRoadRoute=async()=>{throw new Error('Road routing HTTP 503');};
await element('btnPreviewExpedition').handlers.click();
check('road service failures keep the draft and never substitute a straight-line road or save a trip',()=>{
  assert.equal(vm.runInContext('expeditionPreparedLegs',context),null);
  assert.equal(element('btnSaveExpedition').disabled,true);
  assert.ok(element('expeditionStatus').textContent.includes('Road routing HTTP 503'));
  assert.equal(vm.runInContext('expeditionDraft.length',context),4);
  assert.equal(vm.runInContext('AppState.expeditions.length',context),1);
});
let unexpectedFerryRequests=0;
context.CoordinateLookups.lookupRoadRoute=async(from,to)=>{
  if (from[0]===39.1911) { unexpectedFerryRequests++; throw new Error('Ferry must not call the road router'); }
  return [[...from],[...to]];
};
await element('btnPreviewExpedition').handlers.click();
check('ferries bypass routing entirely even when the road service is available',()=>{
  assert.equal(unexpectedFerryRequests,0);
  assert.notEqual(vm.runInContext('expeditionPreparedLegs',context),null,element('expeditionStatus').textContent);
  const ferryLeg=vm.runInContext('expeditionPreparedLegs[2]',context);
  assert.equal(ferryLeg.routeSource,'direct');
  assert.equal(ferryLeg.routeCoords.length,2);
  assert.deepEqual(Array.from(ferryLeg.countyIds),[]);
  assert.ok(element('expeditionStatus').textContent.includes('direct approximation'));
  assert.ok(previewLines.some(line=>line.options.color==='#38bdf8' && line.options.dashArray==='8, 8'));
  assert.equal(vm.runInContext('TravelLedger.fogRoutes(draftExpedition(expeditionPreparedLegs)).length',context),1);
});
vm.runInContext(`
  expeditionDraft=uiMixedStops.map((stop,index)=>({...stop,coords:[...stop.coords],
    travelMode:['ferry','rail','foot'][index] || 'road'}));invalidateExpeditionRoutes();
`,context);
let directModeRoadRequests=0;
let directModeCountyRequests=0;
context.CoordinateLookups.lookupRoadRoute=async()=>{directModeRoadRequests++;throw new Error('Direct modes must not route');};
context.CoordinateLookups.routeCountyIds=()=>{directModeCountyRequests++;throw new Error('Direct modes must not interpolate counties');};
await element('btnPreviewExpedition').handlers.click();
check('ferry, rail and walking legs preview without road requests, county interpolation, or land fog',()=>{
  assert.equal(directModeRoadRequests,0);
  assert.equal(directModeCountyRequests,0);
  const legs=JSON.parse(vm.runInContext('JSON.stringify(expeditionPreparedLegs)',context));
  assert.notEqual(legs,null,element('expeditionStatus').textContent);
  assert.deepEqual(legs.map(leg=>leg.mode),['ferry','rail','foot']);
  legs.forEach((leg,index)=>{
    assert.equal(leg.routeSource,'direct');
    assert.deepEqual(leg.routeCoords,context.uiMixedStops.slice(index,index+2).map(stop=>stop.coords));
    assert.deepEqual(leg.countyIds,[]);
  });
  assert.equal(vm.runInContext('TravelLedger.fogRoutes(draftExpedition(expeditionPreparedLegs)).length',context),0);
  assert.equal(vm.runInContext('TravelLedger.waterFogRoutes(draftExpedition(expeditionPreparedLegs)).length',context),1);
  assert.equal(travelLedger.transitTags.rail,'Rail / Train');
  assert.equal(travelLedger.transitIcons.rail,'🚆');
});
let importedRoadRequests=0;
let importedCountyRequests=0;
context.d3={geoContains:()=>true};
context.CoordinateLookups={
  ...originalExpeditionLookups,
  politicalRegion:()=>({countries:['United States'],states:['California'],counties:[{id:'06073',name:'San Diego County'}]}),
  biomeRegion:()=>({biomes:['5']}),
  lookupElevation:async()=>({feet:100}),
  lookupRoadRoute:async()=>{importedRoadRequests++;throw new Error('Imported tracks must bypass OSRM');},
  routeCountyIds:()=>{importedCountyRequests++;return ['08059'];}
};
context.crypto.randomUUID=()=> 'uploaded-ui';
vm.runInContext(`
  AppState.viewOnly=false;applyPassport(migratePassport({}));coordinateIndexes={counties:[],ecoregions:[]};
  openExpedition();
`,context);
element('expeditionName').value='Imported route';
const importedFileInput=element('expeditionFileInput');
importedFileInput.files=[{
  name:'uploaded.geojson',size:geoJsonTrack.length,
  text:async()=>JSON.stringify({type:'FeatureCollection',features:[{
    type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[-122,37,0],[-121.9,37,0],[-121,37,0]]}
  }]})
}];
await importedFileInput.handlers.change({target:importedFileInput});
check('imported track auto-creates labeled endpoint stops and previews without OSRM',()=>{
  assert.equal(importedRoadRequests,0);
  assert.equal(importedCountyRequests,1);
  assert.equal(vm.runInContext('expeditionDraft.length',context),2);
  assert.ok(vm.runInContext('expeditionDraft[0].name',context).includes('San Diego County'));
  assert.equal(vm.runInContext('expeditionPreparedLegs[0].routeSource',context),'uploaded');
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(expeditionPreparedLegs[0].routeCoords)',context)),geoJsonTrack);
  assert.ok(previewLines.some(line=>JSON.stringify(line.coords)===JSON.stringify(geoJsonTrack) &&
    line.options.dashArray===null));
  assert.equal(element('expeditionRouteFileStatus').textContent,'Loaded track: 3 points.');
});
await element('expeditionForm').handlers.submit({preventDefault(){}});
check('saving an uploaded road track persists its full geometry and awards route counties without OSRM',()=>{
  const saved=JSON.parse(vm.runInContext('JSON.stringify(AppState.expeditions[0])',context));
  assert.equal(saved.routeLegs[0].routeSource,'uploaded');
  assert.deepEqual(saved.routeLegs[0].routeCoords,geoJsonTrack);
  assert.deepEqual(saved.routeLegs[0].countyIds,['08059']);
  assert.deepEqual(JSON.parse(vm.runInContext(
    'JSON.stringify(TravelLedger.fogRoutes(AppState.expeditions[0]))',context)),[geoJsonTrack]);
  assert.equal(importedRoadRequests,0);
});
context.CoordinateLookups=originalExpeditionLookups;
context.L=originalPreviewL;
context.setTimeout=originalPreviewTimeout;
vm.runInContext('AppState.viewOnly=false;map=null;',context);
const scratchParks = nationalParksScratch.parks(catalog.normalizeParks(actualSnapshot.data));
check('dedicated scratch page includes exactly 63 parks, not monuments or other NPS units', () => {
  assert.equal(scratchParks.length, 63);
  assert.equal(new Set(scratchParks.map(p => p.id)).size, 63);
  for (const id of ['npsa', 'redw', 'sequ', 'kica']) assert.ok(scratchParks.some(p => p.id === id));
  assert.ok(!scratchParks.some(p => p.id === 'seki' || p.designation === 'National Monument'));
  assert.ok(html.includes('id="btnScratchNationalParks"'));
  const page = html.slice(html.indexOf('id="scratchNationalParks"'), html.indexOf('<!-- VIEW 3'));
  assert.ok(page.includes('Unexplored → Visited → Wishlist → Transited → Lived → Unexplored'));
  assert.ok(page.includes('● Transited'));
  assert.ok(page.includes('● Lived'));
  assert.ok(page.includes('Wishlist'));
});
check('park regions count each park once and master only after every member is visited', () => {
  const state = { pins: {}, expeditions: [], nationalParkScratch: {} };
  let progress = nationalParksScratch.progress(scratchParks, state);
  assert.equal(progress.reduce((sum, r) => sum + r.total, 0), 63);
  assert.ok(progress.every(r => r.total > 0 && r.tier === 'unstarted'));
  const northeast = scratchParks.filter(p => p.regionId === 'northeast');
  state.pins[northeast[0].ledgerId] = 'l';
  progress = nationalParksScratch.progress(scratchParks, state);
  assert.equal(progress.find(r => r.id === 'northeast').tier, 'progress');
  assert.equal(progress.find(r => r.id === 'northeast').visited, 1);
  northeast.forEach(p => { state.pins[p.ledgerId] = 'v'; });
  progress = nationalParksScratch.progress(scratchParks, state);
  assert.equal(progress.find(r => r.id === 'northeast').tier, 'mastered');
  assert.equal(scratchParks.find(p => p.id === 'yell').regionId, 'intermountain');
  assert.equal(scratchParks.find(p => p.id === 'cuva').regionId, 'midwest');
});
check('park scratch statuses preserve all four tiers', () => {
  const park = scratchParks.find(p => p.id === 'yell');
  for (const [ledger, expected] of [['l', 'l'], ['v', 'v'], ['w', 'w'], ['t', 't']]) {
    assert.equal(nationalParksScratch.status(park, { pins: { yell: ledger }, expeditions: [] }), expected);
  }
});
context.scratchRealParks = catalog.normalizeParks(actualSnapshot.data);
context.scratchParkEntries = scratchParks;
vm.runInContext(`
  PARKS=scratchRealParks;coordinateIndexes=null;AppState.currentTab='map';
  renderNationalParksScratch=()=>{};
  applyPassport(migratePassport({}));AppState.viewOnly=false;
`, context);
check('park clicks cycle through every status and override a logged visit without editing its expedition', () => {
  vm.runInContext("applyPassport(migratePassport({}));AppState.expeditions=[{...testExpedition,id:'park-status-trip',parkIds:['yell']}];syncDerivedState()", context);
  for (const expected of ['w', 't', 'l', 'un', 'v']) {
    vm.runInContext('cycleNationalPark(scratchParkEntries.find(p=>p.id==="yell"))', context);
    assert.equal(vm.runInContext('NationalParksScratch.status(scratchParkEntries.find(p=>p.id==="yell"),AppState)', context), expected);
    assert.equal(JSON.parse(savedJson).statusOverrides.pins.yell, expected);
    assert.equal(JSON.parse(savedJson).expeditions[0].parkIds[0], 'yell');
  }
  vm.runInContext('AppState.expeditions=[]', context);
});
check('Sequoia and Kings Canyon inherit legacy visits but can be tracked independently', () => {
  vm.runInContext('applyPassport(migratePassport({pins:{seki:"v"}}));cycleNationalPark(scratchParkEntries.find(p=>p.id==="sequ"))', context);
  assert.equal(vm.runInContext('AppState.nationalParkScratch.sequ', context), 'w');
  assert.equal(vm.runInContext('AppState.nationalParkScratch.kica', context), 'v');
  assert.equal(vm.runInContext('AppState.pins.seki', context), 'v');
  const saved = JSON.parse(savedJson);
  assert.deepEqual(travelLedger.migrateState(saved, coordinateLookups, catalog).nationalParkScratch, { sequ: 'w', kica: 'v' });
});
check('read-only parks stay unchanged while map choices can override lived and expedition-derived status', () => {
  vm.runInContext('AppState.viewOnly=true;cycleNationalPark(scratchParkEntries.find(p=>p.id==="sequ"))', context);
  assert.equal(vm.runInContext('AppState.nationalParkScratch.sequ', context), 'w');
  vm.runInContext('AppState.viewOnly=false;applyPassport(migratePassport({pins:{yell:"l"}}));cycleNationalPark(scratchParkEntries.find(p=>p.id==="yell"))', context);
  assert.equal(vm.runInContext('AppState.pins.yell || "un"', context), 'un');
  vm.runInContext('applyPassport(migratePassport({}));AppState.expeditions=[{...testExpedition,parkIds:["yell"]}];syncDerivedState();cycleNationalPark(scratchParkEntries.find(p=>p.id==="yell"))', context);
  assert.equal(vm.runInContext('AppState.pins.yell', context), 'w');
  assert.equal(vm.runInContext('AppState.expeditions[0].parkIds[0]', context), 'yell');
});
check('failed park scratch persistence rolls back split records and all promoted statuses', () => {
  vm.runInContext('applyPassport(migratePassport({pins:{seki:"v"}}))', context);
  const before = vm.runInContext('JSON.stringify(passportPayload())', context);
  context.localStorage.setItem = () => { throw new Error('Storage full'); };
  vm.runInContext('cycleNationalPark(scratchParkEntries.find(p=>p.id==="sequ"))', context);
  assert.equal(vm.runInContext('JSON.stringify(passportPayload())', context), before);
  context.localStorage.setItem = (key, value) => { savedJson = value; };
});
check('invalid split scratch imports are rejected rather than creating extra parks or tiers', () => {
  for (const value of [{ yell: 'v' }, { sequ: 'l' }, { kica: 't' }, []]) {
    assert.throws(() => travelLedger.migrateState({ nationalParkScratch: value }, coordinateLookups, catalog), /scratch records/);
  }
});
const autocompleteTimeout = context.setTimeout;
const autocompleteClearTimeout = context.clearTimeout;
const autocompleteFetch = context.fetch;
const autocompleteTimers = new Map();
let timerId = 0;
context.setTimeout = (callback, delay) => {
  const id = ++timerId;
  autocompleteTimers.set(id, { callback, delay });
  return id;
};
context.clearTimeout = id => autocompleteTimers.delete(id);
check('both place inputs debounce Photon by 300ms and cancel earlier keystrokes', () => {
  vm.runInContext('Object.keys(countyFeaturesById).forEach(id=>delete countyFeaturesById[id]);', context);
  element('cityInput').value = 'Den';
  element('cityInput').handlers.input();
  element('cityInput').value = 'Denver';
  element('cityInput').handlers.input();
  element('expeditionSearch').value = 'Asp';
  element('expeditionSearch').handlers.input();
  element('expeditionSearch').value = 'Aspen';
  element('expeditionSearch').handlers.input();
  const searchTimers = [...autocompleteTimers.values()].filter(timer => timer.delay === 300);
  assert.equal(searchTimers.length, 2);
});
check('Enter and Escape dismiss and invalidate suggestions without searching or submitting', () => {
  for (const id of ['cityInput', 'expeditionSearch']) {
    let blurred = false;
    element(id).blur = () => { blurred = true; };
    for (const key of ['Enter', 'Escape']) {
      let prevented = false, stopped = false;
      element(id).handlers.keydown({ key, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
      assert.ok(prevented && stopped && blurred);
    }
  }
  assert.equal([...autocompleteTimers.values()].filter(timer => timer.delay === 300).length, 0);
  assert.ok(!html.includes('id="btnSearchExpeditionPlaces"'));
  assert.ok(!html.includes('id="btnSubmitCity"'));
});
check('local park selection also clears suggestions, input and the pending Photon timer', () => {
  vm.runInContext('AppState.viewOnly=false;expeditionPending=false;PARKS=scratchRealParks;', context);
  element('expeditionSearch').value = 'Yellowstone';
  element('expeditionSearch').handlers.input();
  const before = vm.runInContext('expeditionDraft.length', context);
  vm.runInContext('addExpeditionStop("park","yell")', context);
  assert.equal(vm.runInContext('expeditionDraft.length', context), before + 1, element('toastMsg').textContent);
  assert.equal(element('expeditionSearch').value, '');
  assert.equal(element('expeditionSearchResults').innerHTML, '');
  assert.equal([...autocompleteTimers.values()].filter(timer => timer.delay === 300).length, 0);
});
context.fetch = async () => ({ ok: true, json: async () => ({
  features: [{ geometry: { type: 'Point', coordinates: [-104.99, 39.74] },
    properties: { name: 'Denver', state: 'Colorado', country: 'United States' } }]
}) });
element('cityInput').value = 'Denver';
const beforeHomeSuggestions = elements.size;
await vm.runInContext('searchHometown()', context);
check('Citadel suggestion clicks select coordinates and immediately clear text and dropdown', () => {
  const result = [...elements.values()].slice(beforeHomeSuggestions).find(item =>
    item.textContent === 'Denver, Colorado, United States');
  assert.ok(result);
  context.homeSelection = null;
  vm.runInContext('setHometownCoordinates=(name,lat,lng)=>{homeSelection={name,lat,lng};}', context);
  result.handlers.click();
  assert.equal(context.homeSelection.name, 'Denver, Colorado, United States');
  assert.equal(context.homeSelection.lat, 39.74);
  assert.equal(element('cityInput').value, '');
  assert.equal(element('citySearchResults').innerHTML, '');
});
let resolveHomeSearch;
context.fetch = async () => ({ ok: true, json: () => new Promise(resolve => { resolveHomeSearch = resolve; }) });
element('cityInput').value = 'Old city';
const staleHome = vm.runInContext('searchHometown()', context);
await new Promise(resolve => setImmediate(resolve));
element('cityInput').handlers.keydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
resolveHomeSearch({ features: [{ geometry: { type: 'Point', coordinates: [1, 2] }, properties: { name: 'Old city' } }] });
await staleHome;
check('dismissed Citadel searches cannot reopen the dropdown from a late response', () => {
  assert.equal(element('citySearchResults').innerHTML, '');
  assert.equal(element('homeLookupStatus').textContent, '');
});
context.setTimeout = autocompleteTimeout;
context.clearTimeout = autocompleteClearTimeout;
context.fetch = autocompleteFetch;
console.log(`${checks} checks passed.`);
