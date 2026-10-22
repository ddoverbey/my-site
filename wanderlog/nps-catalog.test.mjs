import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as d3Geo from 'd3-geo';
import catalog from './nps-catalog.js';
import ecoregions from './ecoregions.js';
import internationalCatalog from './international-parks.js';
import coordinateLookups from './coordinate-lookups.js';
import travelLedger from './travel-ledger.js';
import nationalParksScratch from './national-parks-scratch.js';
import { collectParks } from './import-nps.mjs';
import { feature as decodeTopology } from 'topojson-client';
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
function findLastIndex(values, predicate) {
  for (let index = values.length - 1; index >= 0; index--) {
    if (predicate(values[index], index, values)) return index;
  }
  return -1;
}
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
check('all rarity tiers expose their canonical badge icons and colors', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(coordinateLookups.RARITY_TIERS)), {
    'Tourist Trap': { icon: '📸', color: '#cbd5e1' },
    'Beaten Path': { icon: '🥾', color: '#4ade80' },
    'Regional Staple': { icon: '🧭', color: '#22d3ee' },
    'Deep Cut': { icon: '🗺️', color: '#c084fc' },
    'Hidden Gem': { icon: '💎', color: '#fbbf24' },
    'Uncharted': { icon: '🌌', color: '#f0abfc' }
  });
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
check('Travel Ledger header is compact with no description beneath its title', () => {
  const header=html.slice(html.indexOf('<div id="tabContent-bucketlist"'),html.indexOf('<section id="bucketCityMatches"'));
  assert.ok(header.includes('>Travel Ledger</h2>'));
  assert.ok(!header.includes('Traditional Travel Wishlist'));
  assert.ok(!header.includes('Explore NPS parks'));
  assert.ok(header.includes('grid-cols-1 sm:grid-cols-3'));
  assert.ok(header.includes('aria-label="Search destinations"'));
  assert.ok(header.includes('aria-label="Visit status"'));
  assert.ok(header.includes('id="bucketResultsCount"'));
});
function parseRouteFixture(text, filename) {
  context.routeFixture = text;
  context.routeFilename = filename;
  return JSON.parse(vm.runInContext('JSON.stringify(parseUploadedRouteFile(routeFixture, routeFilename))', context));
}
check('mobile RPG HUD starts collapsed with an accessible stats toggle', () => {
  const hudBodyStart = html.indexOf('<div id="rpgMapHudBody">');
  const hudContentEnd = html.indexOf('<!-- Quick Compass / Recenter on Home', hudBodyStart);
  const hudBody = html.slice(hudBodyStart, hudContentEnd);
  assert.ok(hudBodyStart >= 0 && hudContentEnd > hudBodyStart);
  assert.match(html, /@media \(max-width: 767px\)[\s\S]*#rpgMapHud:not\(\[data-collapsed="false"\]\) #rpgMapHudBody/);
  assert.match(html, /id="rpgMapHudToggle"[^>]*aria-controls="rpgMapHudBody"[^>]*aria-expanded="false"/);
  assert.match(html, /setRpgMapHudCollapsed\(window\.matchMedia\('\(max-width: 767px\)'\)\.matches\)/);
  assert.match(hudBody, /id="hudXpBar"/);
  assert.match(hudBody, /id="hudClearedPct"/);
  assert.match(hudBody, /id="hudCountiesCount"/);
});
check('home citadel setup can be dismissed by its close button, backdrop, or Escape', () => {
  assert.match(html, /id="homeBaseModal" role="dialog" aria-modal="true" aria-labelledby="homeBaseModalTitle"/);
  assert.match(html, /id="btnCloseHomeModal" type="button" aria-label="Close home citadel setup"/);
  assert.match(html, /btnCloseHomeModal'\)\.addEventListener\('click', closeHomeModal\)/);
  assert.match(html, /event\.target === event\.currentTarget\) closeHomeModal\(\)/);
  assert.match(html, /event\.key === 'Escape'[\s\S]*?closeHomeModal\(\)/);
});
check('coupled local scripts use a shared release URL so cached old assets cannot break new HTML', () => {
  const sources = [...html.matchAll(/<script src="(\.\/[^"]+)"/g)].map(match => match[1]);
  assert.equal(sources.length, 9);
  assert.ok(sources.every(source => source.endsWith('?v=20261022-detailed-mangroves')));
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
  assert.ok(html.includes('id="btnScratchWorldSubdivisions"'));
  assert.ok(html.includes('World States / Provinces'));
  assert.ok(html.includes('id="scratchCountyCountryFilter"'));
  assert.ok(html.includes('Counties &amp; Districts'));
  assert.ok(html.includes("'subdivisions'"));
  assert.ok(!html.includes('data-tab="nationalparks"'));
  assert.ok(!html.includes('id="tabContent-nationalparks"'));
  assert.ok(html.includes('id="scratchNationalParks"'));
  assert.match(html, /<details open[^>]*>\s*<summary[^>]*>All parks — accessible checklist/);
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
  const buttons = ['map', 'scratch', 'passport', 'travel', 'achievements'].map(tab => ({
    dataset: { tab }, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; }
  }));
  context.document.querySelectorAll = selector => selector === '#navTabs button' ? buttons : originalQuery(selector);
  const modeAttributes = {};
  const originalSet = element('toggleClassicMode').setAttribute;
  const originalRpgSet = element('toggleRpgMode').setAttribute;
  const rpgAttributes = {};
  element('toggleRpgMode').setAttribute = (name, value) => { rpgAttributes[name] = value; };
  element('toggleClassicMode').setAttribute = (name, value) => { modeAttributes[name] = value; };
  vm.runInContext("AppState.mode='classic';AppState.currentTab='scratch';updateHeaderNavigation()", context);
  assert.equal(modeAttributes['aria-pressed'], 'false');
  assert.equal(rpgAttributes['aria-pressed'], 'false');
  assert.deepEqual(buttons.map(button => button.attributes['aria-pressed']), ['false', 'true', 'false', 'false', 'false']);
  vm.runInContext("AppState.currentTab='bucketlist';updateHeaderNavigation()", context);
  assert.equal(modeAttributes['aria-pressed'], 'true');
  assert.equal(rpgAttributes['aria-pressed'], 'false');
  for (const tab of ['scratch', 'passport', 'travel', 'achievements']) {
    vm.runInContext(`AppState.mode='rpg';AppState.currentTab='${tab}';updateHeaderNavigation()`, context);
    assert.equal(rpgAttributes['aria-pressed'], 'false', tab);
    assert.equal(modeAttributes['aria-pressed'], 'false', tab);
    assert.equal(buttons.filter(button => button.attributes['aria-pressed'] === 'true').length, 1);
  }
  vm.runInContext("AppState.mode='rpg';AppState.currentTab='map';updateHeaderNavigation()", context);
  assert.equal(modeAttributes['aria-pressed'], 'false');
  assert.equal(rpgAttributes['aria-pressed'], 'true');
  assert.deepEqual(buttons.map(button => button.attributes['aria-pressed']), ['true', 'false', 'false', 'false', 'false']);
  context.document.querySelectorAll = originalQuery;
  element('toggleClassicMode').setAttribute = originalSet;
  element('toggleRpgMode').setAttribute = originalRpgSet;
});
check('Wanderlog branding uses one subtitle, without a page-like badge, and preserves descriptive SEO metadata', () => {
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  assert.ok(header.includes('>WANDERLOG</h1>'));
  assert.ok(header.includes('>RPG Atlas</p>'));
  assert.ok(!header.includes('>RPG Atlas</span>'));
  assert.ok(!header.includes('TERRA INCOGNITA'));
  assert.ok(!header.includes('A Gamified Fog-of-War Travel Odyssey'));
  assert.ok(html.includes('<title>Wanderlog • RPG Atlas &amp; Travel Journal</title>'));
  assert.match(html, /<meta name="description" content="Wanderlog is a gamified fog-of-war travel atlas and journal/);
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
check('Anomaly Seeker progress includes every rare-and-higher achievement rarity', () => {
  const result = vm.runInContext(`(() => {
    const original5 = BIOMES['5'].rarity;
    const original14 = BIOMES['14'].rarity;
    BIOMES['5'].rarity = 'epic';
    BIOMES['14'].rarity = 'mythic';
    statsCache = null;
    const stats = calculateStats();
    const achievement = ACHIEVEMENTS.find(a => a.tiers.some(tier => tier.title === 'Anomaly Seeker'));
    const result = { count: stats.rareBiomesCount, progress: achievement.progress(stats) };
    BIOMES['5'].rarity = original5;
    BIOMES['14'].rarity = original14;
    statsCache = null;
    return result;
  })()`, context);
  assert.equal(result.count, 2);
  assert.equal(result.progress, 2);
  assert.deepEqual(Array.from(vm.runInContext('RARE_OR_HIGHER_RARITIES', context)), ['rare', 'epic', 'legendary', 'mythic']);
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
  const pokedex = element('biomePokedexContainer').innerHTML;
  assert.equal(element('statRareTotal').textContent, 'of 3 rare+ biomes');
  assert.ok(pokedex.includes('0.23% of classified biome land'));
  assert.ok(pokedex.includes('data-rarity="epic"'));
  assert.ok(pokedex.includes('data-rarity="legendary"'));
  assert.ok(pokedex.includes('--rarity-color:#c084fc'));
  assert.ok(pokedex.includes('--rarity-color:#fbbf24'));
  assert.ok(!pokedex.includes('Subterranean Cavern'));
});
check('Rare biome rarity uses a consistent cyan accent', () => {
  assert.ok(html.includes('text-cyan-400'));
  assert.ok(html.includes('rarity-glow-text" data-rarity="rare"'));
  assert.ok(html.includes('id="statRareBiomes" data-rarity="rare"'));
  assert.ok(html.includes('style="--rarity-color: #22d3ee">Rare</span>'));
  assert.equal(vm.runInContext("ACHIEVEMENT_RARITIES.rare.color", context), '#22d3ee');
});
check('rare-and-higher rarity text and achievement borders receive glow styling', () => {
  for (const rarity of ['rare', 'epic', 'legendary', 'mythic']) {
    assert.ok(html.includes(`.achievement-icon[data-rarity="${rarity}"]`));
    assert.ok(html.includes(`.achievement-rarity[data-rarity="${rarity}"]`));
  }
  assert.ok(html.includes('#biomePokedexContainer .achievement-rarity[data-rarity="rare"]'));
  assert.ok(html.includes('.rarity-glow-text[data-rarity="rare"]'));
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
check('dataset status lives in Settings and the obsolete map legend is removed', () => {
  const settings = html.slice(html.indexOf('<details id="settingsMenu"'), html.indexOf('</details>'));
  assert.ok(settings.includes('id="npsCatalogStatus"'));
  assert.ok(settings.includes('id="btnRetryNps"'));
  assert.ok(settings.includes('aria-label="Settings"'));
  assert.ok(html.includes('isolate z-0 overflow-hidden'));
  assert.ok(!html.includes('id="rpgMapLegend"'));
  assert.ok(!html.includes('<!-- Map Legend'));
});
check('progressive oceans and water-only corridors use a cached combined land stencil', () => {
  assert.ok(html.includes('TravelLedger.waterFogRoutes(exp)'));
  assert.ok(html.includes('punchFogRoute(isFlight ? flightFogRoute(route) : route, 160.934)'));
  assert.ok(html.includes('function oceanFogOpacity()'));
  assert.ok(html.includes('function paintLandFogStencil()'));
  assert.ok(!html.includes('function hasUnlockedOcean'));
  assert.ok(!html.includes('function paintLandFogPolygon'));
  for (const name of ['WATER_FOG_RADIUS_KM','WATER_ROUTE_SAMPLE_KM','waterFogRouteCache',
    'destinationCoordinate','isOceanCoordinate','oceanHasClearance','waterRoutePoints','punchWaterFogRoute']) {
    assert.ok(!html.includes(name));
  }
  assert.ok(html.includes('rail and walking clear no route fog'));
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
    translate(...args) { fogOperations.push(['translate', ...args]); },
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
const formLookupFeature = (name, coordinates, properties = {}) => ({
  type: 'Feature', id: name, properties: { name, ...properties },
  geometry: { type: 'Polygon', coordinates: [coordinates] }
});
const formLookupRing = [[10, 40], [15, 40], [15, 45], [10, 45], [10, 40]];
const formLookupIndexes = {
  countries: coordinateLookups.indexFeatures([
    formLookupFeature('Italy', formLookupRing)
  ], d3Geo),
  states: coordinateLookups.indexFeatures([
    formLookupFeature('Lazio', formLookupRing)
  ], d3Geo),
  counties: coordinateLookups.indexFeatures([
    formLookupFeature('Lazio', formLookupRing, { country: 'Italy', isoA3: 'ITA' })
  ], d3Geo),
  ecoregions: coordinateLookups.indexFeatures([
    formLookupFeature('Central Italian forests', formLookupRing, {
      ECO_ID: 1, ECO_NAME: 'Central Italian forests', BIOME_NUM: 12, REALM: 'Palearctic'
    })
  ], d3Geo)
};
formLookupIndexes.counties[0].feature.id = 'ITA:LAZ';
context.CoordinateLookups = { ...coordinateLookups };
context.crypto = { randomUUID: () => 'saved-reference' };
context.d3 = { ...d3Geo, geoContains: d3Geo.geoContains };
context.formLookupIndexes = formLookupIndexes;
vm.runInContext('coordinateIndexes = formLookupIndexes; AppState.customLocations = [];', context);
element('customLocationName').value = 'Colosseum';
element('customLocationLat').value = '41.8902';
element('customLocationLng').value = '12.4922';
element('customLocationStatus').value = 'v';
element('customLocationCategory').value = 'waterfall';
const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
const originalCustomRarityHelpers = vm.runInContext('({cachedRarity:CoordinateLookups.cachedRarity,lookupRarityWithFallback:CoordinateLookups.lookupRarityWithFallback})', context);
globalThis.fetch = async url => {
  if (url.includes('open-meteo')) return { ok: false, status: 503 };
  if (url.includes('api.devonoverbey.com')) return { ok: false, status: 503 };
  if (url.includes('overpass-api.de')) return { ok: false, status: 504 };
  throw new Error(`Unexpected network request: ${url}`);
};
vm.runInContext(`
  CoordinateLookups.cachedRarity=()=>null;
  CoordinateLookups.lookupRarityWithFallback=async ()=>{throw new Error('signal timed out');};
`, context);
console.warn = () => {};
try {
  await element('customLocationForm').handlers.submit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
} finally {
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
  context.originalCustomRarityHelpers = originalCustomRarityHelpers;
  vm.runInContext(`
    CoordinateLookups.cachedRarity=originalCustomRarityHelpers.cachedRarity;
    CoordinateLookups.lookupRarityWithFallback=originalCustomRarityHelpers.lookupRarityWithFallback;
    delete globalThis.originalCustomRarityHelpers;
  `, context);
}
vm.runInContext('coordinateIndexes = null;', context);
check('custom-location provider failures still save offline geography and waterfall achievement progress', () => {
  assert.equal(vm.runInContext('AppState.customLocations.length', context), 1);
  assert.equal(JSON.parse(savedJson).customPois[0].id, 'poi_saved-reference');
  const saved = JSON.parse(vm.runInContext('JSON.stringify(AppState.customPois[0])', context));
  assert.equal(saved.rarity, null);
  assert.equal(saved.rarityTier, 'Uncharted');
  assert.equal(saved.elevationFt, 0);
  assert.deepEqual(saved.political.countries, ['Italy']);
  assert.deepEqual(saved.political.states, ['Lazio']);
  assert.deepEqual(saved.political.counties, [{ id: 'ITA:LAZ', name: 'Lazio' }]);
  assert.deepEqual(saved.biomes, ['12']);
  assert.equal(vm.runInContext('calculateStats().metadataProgress.waterfalls', context), 1);
  assert.ok(!element('toastMsg').textContent.includes('rarity unavailable'));
  assert.ok(element('toastMsg').textContent.includes('Elevation unavailable'));
});
check('coordinate inputs stay empty as examples and only map-selected points populate the custom-location form', () => {
  assert.doesNotMatch(html, /id="expeditionCoordinate(?:Lat|Lng)"[^>]*placeholder=/);
  context.previousCustomLocationMap = vm.runInContext('map', context);
  vm.runInContext('map={getCenter:()=>({lat:45,lng:-120})};openCustomLocation()', context);
  assert.equal(element('customLocationLat').value, '');
  assert.equal(element('customLocationLng').value, '');
  vm.runInContext("openCustomLocation('44','-123');map=previousCustomLocationMap", context);
  assert.equal(element('customLocationLat').value, '44');
  assert.equal(element('customLocationLng').value, '-123');
  delete context.previousCustomLocationMap;
});
element('customLocationName').value = 'Colosseum';
element('customLocationLat').value = '41.8902';
element('customLocationLng').value = '12.4922';
element('customLocationStatus').value = 'v';
element('customLocationCategory').value = 'waterfall';
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
check('manual county marks reveal the entire county only for explored tiers', () => {
  vm.runInContext(`
    PARKS=[]; AppState.pins={}; AppState.counties={};
    countyFeaturesById['06073']={geometry:{type:'Polygon',coordinates:[[[-120,37],[-119,37],[-119,38],[-120,37]]]}};
  `, context);
  for (const tier of ['un', 'w', 't', 'v', 'l']) {
    context.fogOperations.length = 0;
    vm.runInContext(`AppState.counties={'06073':'${tier}'};drawFogOfWar()`, context);
    assert.equal(context.fogOperations.filter(op => op[0] === 'polygonFill' && op[1] === 'evenodd').length,
      ['t','v','l'].includes(tier) ? 1 : 0);
  }
  vm.runInContext("AppState.counties={}",context);
});
check('international subdivision status tiers reveal the matching subdivision polygon in Fog of War', () => {
  vm.runInContext(`
    countyFeaturesById['CAN:ON-01']={geometry:{type:'Polygon',coordinates:[
      [[-80,43],[-79,43],[-79,44],[-80,43]]
    ]}};
  `, context);
  try {
    for (const tier of ['w', 't', 'v', 'l']) {
      context.fogOperations.length = 0;
      vm.runInContext(`AppState.counties={'CAN:ON-01':'${tier}'};drawFogOfWar()`, context);
      assert.equal(context.fogOperations.filter(op => op[0] === 'polygonFill' && op[1] === 'evenodd').length,
        ['t', 'v', 'l'].includes(tier) ? 1 : 0);
    }
  } finally {
    vm.runInContext("AppState.counties={};delete countyFeaturesById['CAN:ON-01']", context);
  }
});
check('county completion counts only visited/lived loaded FIPS records, never transits or unknown IDs', () => {
  vm.runInContext(`
    countyGeoJson=[{id:'06073'},{id:'06065'},{id:'06001'},{id:'06059'}];
    AppState.counties={'06073':'l','06065':'v','06001':'t','06059':'w','99999':'v','CAN:ON-01':'v'};
  `, context);
  assert.equal(vm.runInContext('calculateStats().countiesCount', context), 2);
  assert.equal(vm.runInContext('calculateStats().countyTotal', context), 4);
  vm.runInContext('countyGeoJson=null;AppState.counties={"06073":"l"}', context);
});
check('visited international subdivisions inherit their predominant terrestrial biome', () => {
  const subdivisionId = 'CAN:ON-01';
  const subdivision = {
    type: 'Feature', id: subdivisionId, properties: {
      name: 'Ontario', country: 'Canada', isoA3: 'CAN', region: 'Ontario'
    }, geometry: { type: 'Polygon', coordinates: [[
      [0, 0], [10, 0], [10, 10], [0, 10], [0, 0]
    ]] }
  };
  const regions = [
    { ...subdivision, id: undefined, properties: { ECO_ID: 1, ECO_NAME: 'Western biome', BIOME_NUM: 5, REALM: 'Nearctic' },
      geometry: { type: 'Polygon', coordinates: [[[0,0],[7,0],[7,10],[0,10],[0,0]]] } },
    { ...subdivision, id: undefined, properties: { ECO_ID: 2, ECO_NAME: 'Eastern biome', BIOME_NUM: 12, REALM: 'Nearctic' },
      geometry: { type: 'Polygon', coordinates: [[[7,0],[10,0],[10,10],[7,10],[7,0]]] } }
  ];
  context.subdivisionBiomeFeature = subdivision;
  context.subdivisionBiomeIndexes = coordinateLookups.indexFeatures(regions, d3Geo);
  const originalD3 = context.d3;
  context.d3 = { ...d3Geo, geoContains: d3Geo.geoContains };
  vm.runInContext(`
    globalThis.subdivisionBiomeSaved = {
      coordinateIndexes, cache: countyBiomeCache['CAN:ON-01'],
      cacheHadEntry: Object.hasOwn(countyBiomeCache, 'CAN:ON-01'), statsCache,
      countyFeature: countyFeaturesById['CAN:ON-01'], state: { ...AppState }
    };
    coordinateIndexes = { ecoregions: subdivisionBiomeIndexes };
    countyFeaturesById['CAN:ON-01'] = subdivisionBiomeFeature;
    delete countyBiomeCache['CAN:ON-01'];
    AppState.customPois = []; AppState.expeditions = []; AppState.homeBase = null;
    AppState.pins = {}; AppState.regions = {}; AppState.counties = { 'CAN:ON-01': 'v' };
    statsCache = null;
  `, context);
  try {
    assert.equal(vm.runInContext("countyBiome('CAN:ON-01')", context), '5');
    assert.ok(vm.runInContext("calculateStats().biomesSet.has('5')", context));
  } finally {
    vm.runInContext(`
      coordinateIndexes = subdivisionBiomeSaved.coordinateIndexes;
      statsCache = subdivisionBiomeSaved.statsCache;
      if (subdivisionBiomeSaved.cacheHadEntry) countyBiomeCache['CAN:ON-01'] = subdivisionBiomeSaved.cache;
      else delete countyBiomeCache['CAN:ON-01'];
      if (subdivisionBiomeSaved.countyFeature) countyFeaturesById['CAN:ON-01'] = subdivisionBiomeSaved.countyFeature;
      else delete countyFeaturesById['CAN:ON-01'];
      Object.assign(AppState, subdivisionBiomeSaved.state);
      delete globalThis.subdivisionBiomeSaved;
    `, context);
    context.d3 = originalD3;
    delete context.subdivisionBiomeFeature;
    delete context.subdivisionBiomeIndexes;
  }
});
{
  const ring = [[-81,43],[-79,43],[-79,45],[-81,45],[-81,43]];
  const admin1 = {
    type: 'Feature', id: 'CAN:ONT',
    properties: { name: 'Ontario', country: 'Canada', isoA3: 'CAN', region: 'Ontario' },
    geometry: { type: 'Polygon', coordinates: [ring] }
  };
  const admin2 = {
    type: 'Feature', id: 'CAN:CD-ON',
    properties: { name: 'Ottawa Division', country: 'CAN' },
    geometry: { type: 'Polygon', coordinates: [[[-80.8,43.2],[-80.2,43.2],[-80.2,43.8],[-80.8,43.8],[-80.8,43.2]]] }
  };
  const unrelated = {
    type: 'Feature', id: '01001', properties: { name: 'Autauga' },
    geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] }
  };
  const ecoregionRing = [[-82,42],[-78,42],[-78,46],[-82,46],[-82,42]];
  const ecoregionTopology = {
    type: 'Topology',
    metadata: { source: ecoregions.SOURCE, license: 'CC-BY-4.0', version: 1, sourceSha256: 'test-source-hash' },
    arcs: [ecoregionRing],
    objects: { ecoregions: { type: 'GeometryCollection', geometries: Array.from({ length: 800 }, (_, index) => ({
      type: 'Polygon', arcs: [[0]],
      properties: { ECO_ID: index + 1, ECO_NAME: 'Test region', BIOME_NUM: 5, REALM: 'Nearctic' }
    })) } }
  };
  const mangroveTopology = {
    type: 'Topology',
    metadata: { source: ecoregions.SOURCE, license: 'CC-BY-4.0', version: 1, sourceSha256: 'test-source-hash', biome: 14 },
    arcs: [ecoregionRing],
    objects: { mangroves: { type: 'GeometryCollection', geometries: [{
      type: 'Polygon', arcs: [[0]],
      properties: { ECO_ID: 9001, ECO_NAME: 'Test mangrove', BIOME_NUM: 14, REALM: 'Nearctic' }
    }] } }
  };
  const stateRing = [[[0,0],[1,0],[1,1],[0,1],[0,0]]];
  const savedFetch = context.fetch;
  const savedTimeout = context.setTimeout;
  const savedTopojson = context.topojson;
  const savedD3 = context.d3;
  context.fetch = async url => ({
    ok: true, json: async () => url.includes('mangroves') ? mangroveTopology : ecoregionTopology
  });
  context.setTimeout = callback => { queueMicrotask(callback); return 1; };
  context.topojson = { feature: decodeTopology };
  context.backfillAdmin1 = admin1;
  context.backfillAdmin2 = admin2;
  context.backfillUsCounty = unrelated;
  context.backfillWorldCountry = {
    type: 'Feature', id: 'CAN', properties: { name: 'Canada' },
    geometry: { type: 'Polygon', coordinates: [ecoregionRing] }
  };
  context.backfillUsState = {
    type: 'Feature', id: '01', properties: { name: 'Alabama' },
    geometry: { type: 'Polygon', coordinates: stateRing }
  };
  context.backfillEcoregionTopology = ecoregionTopology;
  context.d3 = { ...d3Geo };
  vm.runInContext(`
    globalThis.admin2BackfillSaved = {
      coordinateIndexes, countyRegionCache, worldGeoJson,
      usaRegionGeoJson, countyGeoJson, worldSubdivisionGeoJson, worldAdmin2GeoJson,
      internationalCountyGeoJson, biomeCache: { ...countyBiomeCache }, biomeSignature: countyBiomeSignature,
      parks: PARKS, state: { ...AppState }, saveState, drawFogOfWar, punchFogPolygon,
      timeout: globalThis.setTimeout, features: {
        admin1: countyFeaturesById['CAN:ONT'], admin2: countyFeaturesById['CAN:CD-ON'],
        usCounty: countyFeaturesById['01001']
      }
    };
    worldGeoJson = [backfillWorldCountry];
    usaRegionGeoJson = [backfillUsState];
    countyGeoJson = [backfillUsCounty];
    worldSubdivisionGeoJson = [backfillAdmin1];
    worldAdmin2GeoJson = [backfillAdmin2];
    internationalCountyGeoJson = CoordinateLookups.countyEquivalentFeatures(worldSubdivisionGeoJson, worldAdmin2GeoJson);
    countyFeaturesById['01001'] = backfillUsCounty;
    countyFeaturesById['CAN:CD-ON'] = backfillAdmin2;
    delete countyFeaturesById['CAN:ONT'];
    countyRegionCache = null;
    PARKS = [];
    Object.assign(AppState, {
      customPois: [{
        id: 'poi_ottawa', name: 'Ottawa', lat: 43.5, lng: -80.5, status: 'v',
        political: { countries: ['Canada'], states: [], counties: [{ id: 'CAN:ONT', name: 'Ontario' }] },
        biomes: [], elevationFt: null
      }],
      expeditions: [{
        id: 'trip_canada', name: 'Ontario road trip', startDate: '2026-01-01', endDate: '2026-01-02',
        routeCoords: [[43.5,-80.5],[43.7,-80.4]], routeStops: [
          { kind: 'place', id: 'start', name: 'Start', coords: [43.5,-80.5] },
          { kind: 'place', id: 'end', name: 'End', coords: [43.7,-80.4] }
        ],
        routeLegs: [{
          mode: 'road', routeCoords: [[43.5,-80.5],[43.7,-80.4]], countyIds: ['CAN:ONT']
        }],
        countyIds: ['CAN:ONT'], parkIds: [], customPoiIds: [], minElevationFt: null, maxElevationFt: null
      }],
      pins: {}, regions: {}, counties: {}, homeBase: null, expeditionPromotions: {},
      statusOverrides: { pins: {}, regions: {}, counties: {}, nationalParks: {} }, viewOnly: false
    });
    globalThis.backfillSaveCalls = 0;
    globalThis.backfillFogCalls = 0;
    saveState = () => { backfillSaveCalls++; };
    drawFogOfWar = () => { backfillFogCalls++; };
`, context);
  try {
    await vm.runInContext('loadCoordinateGeography()', context);
    check('loading coordinate geography backfills saved trips with Admin-2 IDs and excludes coarse province fog', () => {
      assert.equal(vm.runInContext("AppState.customPois[0].political.counties.some(value => value.id === 'CAN:CD-ON')", context), true);
      assert.equal(vm.runInContext("AppState.customPois[0].political.counties.some(value => value.id === 'CAN:ONT')", context), true);
      assert.equal(vm.runInContext("AppState.customPois[0].political.admin1[0].id", context), 'CAN:ONT');
      assert.equal(vm.runInContext("AppState.expeditions[0].routeLegs[0].countyIds.includes('CAN:CD-ON')", context), true);
      assert.equal(vm.runInContext("AppState.expeditions[0].countyIds.includes('CAN:CD-ON')", context), true);
      assert.equal(vm.runInContext("AppState.counties['CAN:CD-ON']", context), 'v');
      assert.equal(vm.runInContext("AppState.regions['s:CAN:ONT']", context), 'v');
      assert.equal(vm.runInContext("coordinateIndexes.counties.some(item => item.feature.id === 'CAN:ONT')", context), false);
      assert.equal(JSON.stringify(vm.runInContext(
        "CoordinateLookups.biomeRegion(43.5, -80.5, coordinateIndexes.ecoregions, d3.geoContains, coordinateIndexes.mangroves).biomes", context
      )), '["14"]');
      assert.equal(vm.runInContext('coordinateIndexes.mangroves.length', context), 1);
      assert.equal(vm.runInContext("countyFeaturesById['CAN:ONT']", context), undefined);
      assert.equal(vm.runInContext('backfillSaveCalls', context), 1);
      assert.equal(vm.runInContext('backfillFogCalls', context), 1);
    });
    context.backfillPunches = [];
    vm.runInContext(`
      punchFogPolygon = geometry => backfillPunches.push(geometry);
      punchCountyFog(Object.keys(AppState.counties).filter(id => countyFeaturesById[id]));
    `, context);
    check('retroactively visited Canada trip punches only its matched Admin-2 polygon', () => {
      assert.equal(context.backfillPunches.length, 1);
      assert.equal(JSON.stringify(context.backfillPunches[0]), JSON.stringify(admin2.geometry));
    });
  } finally {
    context.fetch = savedFetch;
    context.setTimeout = savedTimeout;
    context.topojson = savedTopojson;
    context.d3 = savedD3;
    vm.runInContext(`
      coordinateIndexes = admin2BackfillSaved.coordinateIndexes;
      countyRegionCache = admin2BackfillSaved.countyRegionCache;
      worldGeoJson = admin2BackfillSaved.worldGeoJson;
      usaRegionGeoJson = admin2BackfillSaved.usaRegionGeoJson;
      countyGeoJson = admin2BackfillSaved.countyGeoJson;
      worldSubdivisionGeoJson = admin2BackfillSaved.worldSubdivisionGeoJson;
      worldAdmin2GeoJson = admin2BackfillSaved.worldAdmin2GeoJson;
      internationalCountyGeoJson = admin2BackfillSaved.internationalCountyGeoJson;
      PARKS = admin2BackfillSaved.parks;
      coordinateCacheIndexes = null;
      politicalCache.clear();
      biomeCache.clear();
      Object.keys(countyBiomeCache).forEach(key => delete countyBiomeCache[key]);
      Object.assign(countyBiomeCache, admin2BackfillSaved.biomeCache);
      countyBiomeSignature = admin2BackfillSaved.biomeSignature;
      statsCache = null;
      Object.assign(AppState, admin2BackfillSaved.state);
      for (const [id, feature] of Object.entries({
        'CAN:ONT': admin2BackfillSaved.features.admin1,
        'CAN:CD-ON': admin2BackfillSaved.features.admin2,
        '01001': admin2BackfillSaved.features.usCounty
      })) {
        if (feature) countyFeaturesById[id] = feature;
        else delete countyFeaturesById[id];
      }
      saveState = admin2BackfillSaved.saveState;
      drawFogOfWar = admin2BackfillSaved.drawFogOfWar;
      punchFogPolygon = admin2BackfillSaved.punchFogPolygon;
      globalThis.setTimeout = admin2BackfillSaved.timeout;
      delete globalThis.admin2BackfillSaved;
      delete globalThis.backfillSaveCalls;
      delete globalThis.backfillFogCalls;
      delete globalThis.backfillPunches;
`, context);
    delete context.backfillAdmin1;
    delete context.backfillAdmin2;
    delete context.backfillUsCounty;
    delete context.backfillWorldCountry;
    delete context.backfillUsState;
    delete context.backfillEcoregionTopology;
  }
}
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
  assert.match(html, /<div id="homeBaseModal"[^>]*class="hidden /);
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
vm.runInContext(`
  globalThis.travelBiomeRenderSaved = { cachedBiomeAt, BIOMES, statsCache };
  cachedBiomeAt = lat => lat < 37.5 ? ['5'] : ['14'];
  BIOMES = Ecoregions.biomeDefinitions();
  statsCache = null;
  renderExpeditionHistory();
  cachedBiomeAt = travelBiomeRenderSaved.cachedBiomeAt;
  BIOMES = travelBiomeRenderSaved.BIOMES;
  statsCache = travelBiomeRenderSaved.statsCache;
  delete globalThis.travelBiomeRenderSaved;
`, context);
check('expedition history escapes names, shows date/elevation/tags and starts metadata badges', () => {
  const history = element('travelLogFeed').innerHTML;
  assert.ok(history.includes('&lt;script&gt;Trip&lt;/script&gt;'));
  assert.ok(history.includes('2026-09-01'));
  assert.ok(history.includes('-100 to 11,000 ft'));
  assert.ok(history.includes('AWD/Off-Road'));
  assert.ok(history.includes('Photography'));
  assert.ok(history.includes('data-trip-biomes'));
  assert.ok(history.includes('🌲 Temperate Conifer Forests'));
  assert.ok(history.includes('🌱 Mangroves'));
  const achievements = element('achievementsContainer').innerHTML;
  assert.ok(achievements.includes('Under Pressure'));
  assert.ok(achievements.includes('Thin Air'));
  assert.ok(achievements.includes('value="1" max="5"'));
});
const savedRarityExpeditions = vm.runInContext('JSON.stringify(AppState.expeditions)', context);
try {
  vm.runInContext(`AppState.expeditions=[{
    ...AppState.expeditions[0],
    routeCoords:[[37,-120],[38,-119]],
    routeStops:[
      {kind:'place',id:'rarity_stop',name:'Hidden Gem Stop',coords:[37,-120],rarityTier:'Hidden Gem'},
      {kind:'place',id:'rarity_stop_2',name:'Uncharted Stop',coords:[38,-119],rarityTier:'Uncharted'}
    ]
  }];renderExpeditionHistory()`, context);
  check('Travel Log itinerary renders rarity badges for expedition stops', () => {
    const itinerary = element('travelLogFeed').innerHTML;
    assert.ok(itinerary.includes('Hidden Gem Stop'));
    assert.ok(itinerary.includes('💎 Hidden Gem'));
    assert.ok(itinerary.includes('🌌 Uncharted'));
  });
} finally {
  context.savedRarityExpeditions = savedRarityExpeditions;
  vm.runInContext('AppState.expeditions=JSON.parse(savedRarityExpeditions);renderExpeditionHistory()', context);
}
const rarityEnrichmentHelpers = vm.runInContext('({cachedRarity:CoordinateLookups.cachedRarity, lookupRarityWithFallback:CoordinateLookups.lookupRarityWithFallback, updateExpedition, refreshTravelUI})', context);
const savedEnrichmentExpeditions = vm.runInContext('JSON.stringify(AppState.expeditions)', context);
try {
  vm.runInContext(`
    AppState.expeditions=[{
      ...AppState.expeditions[0],id:'exp_rarity_enrichment',
      routeCoords:[[10.1234,20.2345]],
      routeStops:[{kind:'place',id:'rarity_missing',name:'Lookup Place',coords:[10.1234,20.2345]}]
    }];
    CoordinateLookups.cachedRarity=()=>null;
    CoordinateLookups.lookupRarityWithFallback=async (lat,lng)=>CoordinateLookups.normalizeRarity({
      placeName:'Lookup Place',reviewCount:null,popularityScore:30,rarityTier:'Deep Cut',
      matchedLat:lat,matchedLng:lng,cached:false,source:'Test rarity provider',method:'provider-popularity'
    },lat,lng);
    updateExpedition=updated=>{
      const index=AppState.expeditions.findIndex(item=>item.id===updated.id);
      AppState.expeditions[index]=updated;
    };
    refreshTravelUI=()=>{};
  `, context);
  await vm.runInContext("enrichExpeditionStopRarities('exp_rarity_enrichment')", context);
  vm.runInContext('renderExpeditionHistory()', context);
  check('missing expedition-stop rarity resolves asynchronously and displays its badge', () => {
    assert.equal(vm.runInContext("AppState.expeditions[0].routeStops[0].rarityTier", context), 'Deep Cut');
    assert.ok(element('travelLogFeed').innerHTML.includes('🗺️ Deep Cut'));
  });
} finally {
  context.rarityEnrichmentHelpers = rarityEnrichmentHelpers;
  context.savedEnrichmentExpeditions = savedEnrichmentExpeditions;
  vm.runInContext(`
    CoordinateLookups.cachedRarity=rarityEnrichmentHelpers.cachedRarity;
    CoordinateLookups.lookupRarityWithFallback=rarityEnrichmentHelpers.lookupRarityWithFallback;
    updateExpedition=rarityEnrichmentHelpers.updateExpedition;
    refreshTravelUI=rarityEnrichmentHelpers.refreshTravelUI;
    AppState.expeditions=JSON.parse(savedEnrichmentExpeditions);
    renderExpeditionHistory();
  `, context);
}
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
  assert.ok(feed.includes('travel-journal-summary'));
  assert.match(feed, /<details class="travel-journal-card[^>]+data-trip="exp_test">/);
  const summary = feed.slice(feed.indexOf('<summary class="travel-journal-summary'), feed.indexOf('</summary>'));
  assert.ok(summary.includes('Total mileage'));
  assert.ok(summary.includes('Elevation range'));
  assert.ok(!summary.includes('Riverside'));
  assert.ok(!summary.includes('Edit trip'));
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
check('journal cards keep the itinerary collapsed, show one highlight, and preserve prose and photos during route edits', () => {
  const saved = vm.runInContext('JSON.stringify(AppState.expeditions)', context);
  try {
    vm.runInContext(`
      AppState.expeditions[0]={...AppState.expeditions[0],
        journal:'A <script>memory</script>\\nA second line.',
        photos:['data:image/jpeg;base64,YWJjZA==','data:image/jpeg;base64,ZWZnaA==']};
      renderExpeditionHistory();
    `, context);
    const feed = element('travelLogFeed').innerHTML;
    assert.equal((feed.match(/<img class="travel-journal-highlight"/g) || []).length, 1, 'only one highlight photo is built before opening');
    assert.ok(feed.includes('travel-journal-highlight'));
    assert.ok(!feed.includes('A &lt;script&gt;memory'));
    assert.ok(!feed.includes('ZWZnaA=='), 'remaining images are not inserted until the journal opens');
    assert.ok(feed.indexOf('Itinerary &amp; trip details') > feed.indexOf('</summary>'));
    const result = vm.runInContext(`(()=>{
      const editing=expeditionEditingId, draft=expeditionDraft;
      try {
        expeditionEditingId=AppState.expeditions[0].id;expeditionDraft=[];
        return draftExpedition([]);
      } finally { expeditionEditingId=editing;expeditionDraft=draft; }
    })()`, context);
    assert.equal(result.journal, 'A <script>memory</script>\nA second line.');
    assert.equal(result.photos.length, 2);
  } finally {
    vm.runInContext(`AppState.expeditions=${saved};renderExpeditionHistory()`, context);
  }
});
check('collapse journal closes the trip, restores header focus, and retains unsaved journal text', () => {
  let focused = false, scrolled = false;
  const card = { open: true, dataset: { trip: 'collapse_test' },
    querySelector: () => ({ focus(options) { focused = options.preventScroll; } }),
    scrollIntoView(options) { scrolled = options.block === 'nearest'; } };
  context.collapseTestCard = card;
  try {
    vm.runInContext(`
      openTravelLogs.add('collapse_test');
      travelJournalDrafts.set('collapse_test',{journal:'Still writing'});
      collapseTravelJournal(collapseTestCard);
    `, context);
    assert.equal(card.open, false);
    assert.equal(focused, true);
    assert.equal(scrolled, true);
    assert.equal(vm.runInContext("openTravelLogs.has('collapse_test')", context), false);
    assert.equal(vm.runInContext("travelJournalDrafts.get('collapse_test').journal", context), 'Still writing');
    assert.ok(expeditionUi.includes('data-collapse-journal'));
    assert.ok(html.includes('.travel-journal-card[open] > summary .travel-journal-collapse-hint'));
  } finally {
    vm.runInContext("travelJournalDrafts.delete('collapse_test');openTravelLogs.delete('collapse_test')", context);
    delete context.collapseTestCard;
  }
});
check('profile flags use visited/lived countries only, sort alphabetically, deduplicate aliases and fall back for unknown countries', () => {
  const saved = vm.runInContext('JSON.stringify(passportPayload())', context);
  try {
    const result = vm.runInContext(`(()=>{
      applyPassport(migratePassport({regions:{
        'c:United States of America':'l','c:France':'v','c:Japan':'w','c:Canada':'t'
      }}));
      return profileCountryFlags(calculateStats().visitedCountries);
    })()`, context);
    assert.deepEqual(JSON.parse(JSON.stringify(result)).map(flag => [flag.name, flag.src]), [
      ['France', './assets/flags/fr.png'], ['United States', './assets/flags/us.png']
    ]);
    const aliases = vm.runInContext("profileCountryFlags(['United States','United States of America','Dem. Rep. Congo','Vatican','Atlantis'])", context);
    assert.equal(aliases.length, 4);
    assert.equal(aliases.find(flag => flag.code === 'CD').src, './assets/flags/cd.png');
    assert.equal(aliases.find(flag => flag.code === 'VA').src, './assets/flags/va.png');
    assert.equal(aliases.find(flag => flag.name === 'Atlantis').src, './assets/flags/unknown.png');
    assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('profileCountryFlags([])', context))), []);
    vm.runInContext("renderProfileFlags(['France','United States of America'])", context);
    assert.ok(element('passportFlags').innerHTML.includes('France flag'));
    assert.ok(element('passportFlags').innerHTML.indexOf('France') < element('passportFlags').innerHTML.indexOf('United States'));
    assert.ok(html.includes('image-rendering: pixelated'));
    assert.ok(html.includes('Pixel flags by DaFluffyPotato'));
  } finally {
    vm.runInContext(`applyPassport(${saved})`, context);
  }
});
check('profile state flags map visited and lived US states to supplied artwork, including the home state', () => {
  const saved = vm.runInContext('JSON.stringify(passportPayload())', context);
  try {
    const result = vm.runInContext(`(()=>{
      applyPassport(migratePassport({regions:{
        's:California':'l','s:Alabama':'v','s:Wyoming':'w'
      }}));
      const stats=calculateStats();
      return {states:stats.visitedStates,flags:profileStateFlags(stats.visitedStates)};
    })()`, context);
    const plain = JSON.parse(JSON.stringify(result));
    assert.deepEqual(plain.states, ['California', 'Alabama']);
    assert.deepEqual(plain.flags.map(flag => [flag.name, flag.src]), [
      ['Alabama', './assets/pixel_usa_state_flags_av_reference/alabama.png'],
      ['California', './assets/pixel_usa_state_flags_av_reference/california.png']
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext(
      "profileStateFlags(['New Hampshire','District of Columbia','New Hampshire'])", context
    ))).map(flag => [flag.name, flag.src]), [
      ['New Hampshire', './assets/pixel_usa_state_flags_av_reference/newhampshire.png']
    ]);
    vm.runInContext("renderProfileStateFlags(['California'])", context);
    assert.ok(element('passportStateFlags').innerHTML.includes('California flag'));
    assert.ok(html.includes('id="passportStateFlags"'));
  } finally {
    vm.runInContext(`applyPassport(${saved})`, context);
  }
});
check('profile flag images retry the unknown asset once when a country has no flag file', () => {
  const list = element('passportFlags');
  const original = list.querySelectorAll;
  let fail, options;
  const image = { src: './assets/flags/um.png', addEventListener(event, handler, settings) {
    assert.equal(event, 'error'); fail = handler; options = settings;
  } };
  list.querySelectorAll = selector => selector === 'img' ? [image] : [];
  try {
    vm.runInContext("renderProfileFlags(['United States Minor Outlying Islands'])", context);
    assert.equal(options.once, true);
    fail();
    assert.equal(image.src, './assets/flags/unknown.png');
  } finally {
    list.querySelectorAll = original;
  }
});
check('flag names reveal on interaction without toggling their surrounding trip card', () => {
  const list = element('passportFlags'), original = list.querySelectorAll;
  const handlers = {};
  let focused = 0, prevented = 0, stopped = 0;
  const flag = { addEventListener(name, handler) { handlers[name] = handler; }, focus() { focused++; } };
  list.querySelectorAll = selector => selector === '.country-flag' ? [flag] : [];
  try {
    vm.runInContext("renderProfileFlags(['France'])", context);
    assert.ok(list.innerHTML.includes('role="button" tabindex="0" aria-label="France flag"'));
    assert.ok(list.innerHTML.includes('class="country-flag-name" aria-hidden="true">France'));
    const event = { preventDefault() { prevented++; }, stopPropagation() { stopped++; } };
    handlers.click(event);
    handlers.keydown({ ...event, key: 'Enter' });
    handlers.keydown({ ...event, key: ' ' });
    handlers.keydown({ ...event, key: 'Tab' });
    assert.equal(focused, 3);
    assert.equal(prevented, 3);
    assert.equal(stopped, 3);
    assert.ok(html.includes('.country-flag:hover .country-flag-name'));
    assert.ok(html.includes('.country-flag:focus .country-flag-name'));
    assert.ok(html.includes('.country-flag-name { display: none;'));
  } finally { list.querySelectorAll = original; }
});
check('trip country flags exclude home-country aliases while state flags include home-state stops', () => {
  const result = vm.runInContext(`(()=>{
    const political=cachedPoliticalAt,home=AppState.homeBase,parks=PARKS,pois=AppState.customPois;
    const oldStates=usaRegionGeoJson,oldSubdivisions=worldSubdivisionGeoJson;
    const oldCountyFeatures={...countyFeaturesById};
    try {
      usaRegionGeoJson=[
        {id:'06',properties:{name:'California'}},
        {id:'32',properties:{name:'Nevada'}}
      ];
      worldSubdivisionGeoJson=[{properties:{isoA3:'CAN',country:'Canada'}}];
      countyFeaturesById['06073']={properties:{name:'San Diego County'}};
      countyFeaturesById['32003']={properties:{name:'Clark County'}};
      countyFeaturesById['CAN:Ontario']={properties:{name:'Ontario',country:'CAN'}};
      cachedPoliticalAt=(lat,lng)=>({
        countries:lat===0?['United States']:lat===1?['France']:['Canada'],
        states:lat===0?['California']:lat===1?['New Hampshire']:[]
      });
      AppState.homeBase={lat:0,lng:0};
      PARKS=[{id:'flagpark',intl:true,countryCode:'JP',country:'Japan',states:['Alabama']}];
      AppState.customPois=[{id:'flagpoi',political:{countries:['France'],states:['California']}}];
      const trip={routeStops:[{coords:[0,0]},{coords:[1,1]}],routeCoords:[[0,0],[1,1]],
        routeLegs:[{mode:'road',routeSource:'uploaded',routeCoords:[[0,0],[2,2],[1,1]],
          countyIds:['06073','32003','CAN:Ontario']}],
        parkIds:['flagpark'],customPoiIds:['flagpoi'],countyIds:[]};
      const foreign=travelLogCountryFlags(trip);
      const states=travelLogStateFlags(trip);
      AppState.homeBase=null;
      const noHome=travelLogCountryFlags(trip);
      AppState.homeBase={lat:0,lng:0};
      const domestic=travelLogCountryFlags({...trip,routeStops:[{coords:[0,0]}],parkIds:[],customPoiIds:[]});
      return {foreign,noHome,domestic,states};
    } finally {
      cachedPoliticalAt=political;AppState.homeBase=home;PARKS=parks;AppState.customPois=pois;
      usaRegionGeoJson=oldStates;worldSubdivisionGeoJson=oldSubdivisions;
      Object.keys(countyFeaturesById).forEach(id=>delete countyFeaturesById[id]);
      Object.assign(countyFeaturesById,oldCountyFeatures);
    }
  })()`, context);
  const plain = JSON.parse(JSON.stringify(result));
  assert.deepEqual(plain.foreign.map(flag => flag.code), ['CA', 'FR', 'JP']);
  assert.deepEqual(plain.noHome.map(flag => flag.code), ['CA', 'FR', 'JP', 'US']);
  assert.deepEqual(plain.domestic.map(flag => flag.code), ['CA']);
  assert.deepEqual(plain.states.map(flag => flag.name), ['Alabama', 'California', 'Nevada', 'New Hampshire']);
  assert.ok(expeditionUi.includes('data-trip-flags'));
  assert.ok(expeditionUi.includes('data-trip-state-flags'));
});
check('uploaded non-road tracks resolve traversed region IDs once and reuse them for flag rendering', () => {
  const result = vm.runInContext(`(()=>{
    const previousIndexes=coordinateIndexes,previousLookup=CoordinateLookups.routeCountyIds;
    let calls=0;
    const trip={countyIds:[],routeLegs:[{
      mode:'rail',routeSource:'uploaded',routeCoords:[[0,0],[1,1]],countyIds:[]
    }]};
    try {
      coordinateIndexes={counties:[{}]};
      CoordinateLookups.routeCountyIds=()=>{calls++;return ['CAN:Ontario'];};
      const first=travelLogCountyIds(trip),second=travelLogCountyIds(trip);
      return {calls,first,second};
    } finally {
      coordinateIndexes=previousIndexes;
      CoordinateLookups.routeCountyIds=previousLookup;
    }
  })()`, context);
  const plain = JSON.parse(JSON.stringify(result));
  assert.equal(plain.calls, 1);
  assert.deepEqual(plain.first, ['CAN:Ontario']);
  assert.deepEqual(plain.second, ['CAN:Ontario']);
});
check('journal headings and bullet lists render safely without interpreting HTML or inline scripts', () => {
  context.journalFormattingFixture = '# Day one\n## Highlights\n- Sunrise\n* Waterfall\n### Next time\n<script>alert(1)</script>\n[link](javascript:bad)';
  const rendered = vm.runInContext('journalMarkup(journalFormattingFixture)', context);
  assert.ok(rendered.includes('<h3>Day one</h3>'));
  assert.ok(rendered.includes('<h4>Highlights</h4>'));
  assert.ok(rendered.includes('<ul><li>Sunrise</li><li>Waterfall</li></ul>'));
  assert.ok(rendered.includes('<h5>Next time</h5>'));
  assert.ok(rendered.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!rendered.includes('<script>'));
  assert.ok(!rendered.includes('<a '));
  delete context.journalFormattingFixture;
});
check('journal formatting buttons operate on complete selected lines and toggle formatting', () => {
  const plain = expression => JSON.parse(JSON.stringify(vm.runInContext(expression, context)));
  assert.deepEqual(plain("journalFormatLines('Sunrise\\nWaterfall',0,17,'bullets')"),
    { value: '- Sunrise\n- Waterfall', start: 0, end: 21 });
  assert.deepEqual(plain("journalFormatLines('- Sunrise\\n- Waterfall',0,21,'bullets')"),
    { value: 'Sunrise\nWaterfall', start: 0, end: 17 });
  assert.deepEqual(plain("journalFormatLines('Intro\\nDay one\\nEnd',8,8,'heading')"),
    { value: 'Intro\n# Day one\nEnd', start: 6, end: 15 });
  assert.equal(plain("journalFormatLines('- Day one',2,2,'heading')").value, '# Day one');
  assert.equal(plain("journalFormatLines('',0,0,'bullets')").value, '- ');
  assert.equal(plain("journalFormatLines('One\\nTwo',0,4,'heading')").value, '# One\nTwo');
  assert.equal(plain("journalFormatLines('\\nTwo',0,0,'heading')").value, '# \nTwo');
});
check('trip mileage follows actual leg geometry and uses endpoints for flights with no track', () => {
  const result = vm.runInContext(`travelLogMetrics({
    routeCoords:[[0,0],[0,1],[1,1]],transitTags:['road','flight'],
    routeStops:[{coords:[0,0],elevationFt:100},{coords:[0,1],elevationFt:400},{coords:[1,1],elevationFt:200}],
    routeLegs:[{mode:'road',routeSource:'routed',routeCoords:[[0,0],[0,0.5],[0,1]]},
      {mode:'flight',routeSource:'none',routeCoords:[]}],
    minElevationFt:100,maxElevationFt:400
  })`, context);
  assert.equal(result.mileage, '≈ 138 mi');
  assert.equal(result.elevation, '100 to 400 ft');
  assert.equal(result.changes, '+300 / −200 ft between logged stops');
  const empty = vm.runInContext("travelLogMetrics({routeCoords:[],transitTags:[]})", context);
  assert.equal(empty.mileage, 'Not recorded');
  assert.equal(empty.elevation, 'Not recorded');
  assert.equal(empty.changes, '');
});
check('journal text and photos are excluded from the per-frame travel stats cache key', () => {
  const result = vm.runInContext(`(()=>{
    const trip=AppState.expeditions[0],before=travelStateKey();
    try {
      AppState.expeditions[0]={...trip,journal:'A long story',photos:['data:image/jpeg;base64,YWJjZA==']};
      const after=travelStateKey();
      AppState.expeditions[0]={...AppState.expeditions[0],name:'A different trip'};
      return {unchanged:before===after,travelChanged:after!==travelStateKey()};
    } finally { AppState.expeditions[0]=trip; }
  })()`, context);
  assert.equal(result.unchanged, true);
  assert.equal(result.travelChanged, true);
});
check('journal saves are transactional, retain unsaved text on quota failure, and survive Passport reloads', () => {
  const snapshot = vm.runInContext('JSON.stringify(passportPayload())', context);
  const viewOnly = vm.runInContext('AppState.viewOnly', context);
  const query = context.document.querySelector;
  const write = context.localStorage.setItem;
  const form = element('journalTestForm');
  const textarea = element('journalTestText');
  const files = element('journalTestFiles');
  const gallery = element('journalTestGallery');
  const status = element('journalTestStatus');
  const save = element('journalTestSave');
  const preview = element('journalTestPreview');
  const heading = element('journalTestHeading');
  heading.dataset.journalFormat = 'heading';
  const originalQueryAll = form.querySelectorAll;
  const originalSelection = textarea.setSelectionRange;
  form.querySelectorAll = () => [heading];
  textarea.setSelectionRange = (start, end) => { textarea.selectionStart = start; textarea.selectionEnd = end; };
  form.elements = { journal: textarea, photos: files };
  form.querySelector = selector => selector === '[role="status"]' ? status :
    selector === '.travel-journal-photos' ? gallery : selector === '[data-journal-preview]' ? preview : save;
  const body = { dataset: {}, innerHTML: '', querySelector: selector => selector === 'form' ? form : gallery };
  context.document.querySelector = () => body;
  try {
    vm.runInContext(`AppState.viewOnly=false;renderTravelJournal(AppState.expeditions[0])`, context);
    assert.ok(body.innerHTML.includes('The story of your trip'));
    textarea.value = 'Day one';
    textarea.selectionStart = textarea.selectionEnd = 3;
    heading.handlers.click();
    assert.equal(textarea.value, '# Day one');
    assert.equal(preview.innerHTML, '<h3>Day one</h3>');
    assert.equal(status.textContent, 'Unsaved changes');
    heading.handlers.click();
    assert.equal(textarea.value, 'Day one');
    textarea.value = 'The view was worth the detour.\n<script>Just a memory</script>';
    textarea.handlers.input();
    vm.runInContext(`travelJournalDraft(AppState.expeditions[0]).photos.push(
      'data:image/jpeg;base64,YWJjZA==','data:image/jpeg;base64,ZWZnaA==')`, context);
    gallery.handlers.click({ target: { closest: () => ({ dataset: { removePhoto: '0' } }) } });
    assert.ok(gallery.innerHTML.includes('ZWZnaA=='));
    assert.ok(!gallery.innerHTML.includes('YWJjZA=='));
    context.localStorage.setItem = () => { throw new Error('Journal test storage full'); };
    form.handlers.submit({ preventDefault() {} });
    assert.match(status.textContent, /Not saved:/);
    assert.equal(textarea.value, 'The view was worth the detour.\n<script>Just a memory</script>');
    assert.equal(vm.runInContext("AppState.expeditions[0].journal || ''", context), '');
    context.localStorage.setItem = write;
    form.handlers.submit({ preventDefault() {} });
    const passport = JSON.parse(savedJson);
    assert.equal(passport.expeditions[0].journal, textarea.value);
    assert.deepEqual(passport.expeditions[0].photos, ['data:image/jpeg;base64,ZWZnaA==']);
    vm.runInContext('loadPersistedState()', context);
    assert.equal(vm.runInContext('AppState.expeditions[0].journal', context), textarea.value);
    body.dataset = {};
    vm.runInContext('AppState.viewOnly=true;renderTravelJournal(AppState.expeditions[0])', context);
    assert.ok(body.innerHTML.includes('&lt;script&gt;Just a memory&lt;/script&gt;'));
    assert.ok(!body.innerHTML.includes('<form'));
    assert.ok(!body.innerHTML.includes('type="file"'));
    assert.ok(!body.innerHTML.includes('data-remove-photo'));
  } finally {
    context.document.querySelector = query;
    context.localStorage.setItem = write;
    form.querySelectorAll = originalQueryAll;
    textarea.setSelectionRange = originalSelection;
    vm.runInContext(`applyPassport(${snapshot});AppState.viewOnly=${viewOnly};travelJournalDrafts.clear();renderExpeditionHistory()`, context);
  }
});
{
  const originalImage = context.Image, originalURL = context.URL, create = context.document.createElement;
  let revoked = 0;
  const encodings = [];
  const photo = 'data:image/jpeg;base64,YWJjZA==';
  const canvas = { getContext: () => ({ fillRect() {}, drawImage() {} }),
    toDataURL(type, quality) {
      encodings.push([type, quality]);
      return quality > 0.65 ? 'x'.repeat(travelLedger.journalLimits.photoCharacters + 1) : photo;
    } };
  context.Image = class {
    naturalWidth = 4000; naturalHeight = 3000;
    set src(value) { this.onload(); }
  };
  context.URL = { createObjectURL: () => 'blob:test-photo', revokeObjectURL() { revoked++; } };
  context.document.createElement = tag => tag === 'canvas' ? canvas : create(tag);
  try {
    const result = await vm.runInContext("compressJournalPhoto({type:'image/png',size:2000000})", context);
    check('photos are resized and recompressed locally with a bounded output and released object URLs', () => {
      assert.equal(result, photo);
      assert.equal(canvas.width, 960);
      assert.equal(canvas.height, 720);
      assert.deepEqual(encodings, [['image/jpeg', 0.8], ['image/jpeg', 0.65]]);
      assert.equal(revoked, 1);
    });
    await assert.rejects(vm.runInContext("compressJournalPhoto({type:'image/svg+xml',size:100})", context), /JPEG, PNG, or WebP/);
    await assert.rejects(vm.runInContext("compressJournalPhoto({type:'image/jpeg',size:16000000})", context), /15 MB/);
    canvas.toDataURL = () => 'x'.repeat(travelLedger.journalLimits.photoCharacters + 1);
    await assert.rejects(vm.runInContext("compressJournalPhoto({type:'image/jpeg',size:100})", context), /still too large/);
    assert.equal(revoked, 2, 'failed encodes also release their object URLs');
  } finally {
    context.Image = originalImage;
    context.URL = originalURL;
    context.document.createElement = create;
  }
}
check('hidden mini-maps wait for layout and refit route bounds without animation on resize', () => {
  const previousL = context.L, previousObserver = context.ResizeObserver;
  const snapshot = vm.runInContext('JSON.stringify(AppState.expeditions)', context);
  let width = 0, observed, callback, created = 0, invalidated = 0, disconnected = 0;
  const fits = [];
  const host = element('mini-map-exp_layout');
  host.id = 'mini-map-exp_layout';
  host.getBoundingClientRect = () => ({ width, height: 164 });
  context.ResizeObserver = class {
    constructor(handler) { callback = handler; }
    observe(target) { observed = target; }
    disconnect() { disconnected++; }
  };
  context.L = {
    map() { created++; return { remove() {}, invalidateSize() { invalidated++; },
      fitBounds(bounds, options) { fits.push([bounds, options]); } }; },
    tileLayer: () => ({ addTo() {} }), latLngBounds: coords => coords,
    polyline: () => ({ addTo() {} }), circleMarker: () => ({ addTo() {} })
  };
  try {
    vm.runInContext(`AppState.expeditions=[{...AppState.expeditions[0],id:'exp_layout'}];renderExpeditionHistory()`, context);
    assert.equal(created, 0, 'no map is fitted inside a zero-size hidden tab');
    assert.equal(observed, host);
    width = 210;
    callback([{ target: host, contentRect: { width, height: 164 } }]);
    assert.equal(created, 1);
    assert.equal(fits.length, 1);
    assert.equal(fits[0][1].animate, false);
    assert.equal(fits[0][1].maxZoom, 10);
    callback([{ target: host, contentRect: { width: 350, height: 164 } }]);
    assert.equal(invalidated, 1);
    assert.equal(fits.length, 2);
    assert.equal(created, 1, 'resizing reuses the map instead of leaking another instance');
    vm.runInContext('destroyTravelLogMaps()', context);
    assert.equal(disconnected, 1);
  } finally {
    context.L = previousL;
    context.ResizeObserver = previousObserver;
    delete host.getBoundingClientRect;
    vm.runInContext(`AppState.expeditions=${snapshot};renderExpeditionHistory()`, context);
  }
});
check('saved and imported road/AWD legs reveal entire crossed counties, including land far from the route', () => {
  vm.runInContext(`
    globalThis.roadCountySaved={state:{...AppState},map,PARKS,coordinateIndexes,
      county:countyFeaturesById['08059']};
    applyPassport(migratePassport({}));
    AppState.currentTab='map';AppState.mode='rpg';
    PARKS=[];coordinateIndexes=null;
    map={getZoom:()=>4,options:{crs:{scale:zoom=>256*2**zoom}},
      latLngToContainerPoint:([lat,lng])=>({x:lng*100,y:lat*100})};
    countyFeaturesById['08059']={geometry:{type:'Polygon',
      coordinates:[[[0,0],[5,0],[5,5],[0,5],[0,0]]]}};
  `, context);
  try {
    for (const mode of ['road', 'awd']) {
      for (const routeSource of ['routed', 'uploaded']) {
        context.roadCountyMode=mode;
        context.roadCountySource=routeSource;
        vm.runInContext(`
          AppState.expeditions=[{...testExpedition,parkIds:[],customPoiIds:[],countyIds:[],
            transitTags:[roadCountyMode],routeCoords:[[0,0],[0,1]],
            routeLegs:[{mode:roadCountyMode,routeSource:roadCountySource,
              routeCoords:[[0,0],[0,1]],countyIds:['08059']}]}];
          fogOperations.length=0;
          drawFogOfWar();
        `, context);
        assert.equal(context.fogOperations.filter(op=>op[0]==='polygonFill').length,1);
        assert.ok(context.fogOperations.some(op=>op[0]==='lineTo' && op[1]===500 && op[2]===500),
          `${mode}/${routeSource}: the distant county corner must be included, not just the road corridor`);
        assert.equal(vm.runInContext('loggedCountyStatuses(false)["08059"]',context),'v');
      }
    }
    vm.runInContext('AppState.expeditions=[];fogOperations.length=0;drawFogOfWar()',context);
    assert.equal(context.fogOperations.filter(op=>op[0]==='polygonFill').length,0,
      'removing the only trip must restore fog over its counties');
  } finally {
    vm.runInContext(`
      Object.assign(AppState,roadCountySaved.state);
      ({map,PARKS,coordinateIndexes}=roadCountySaved);
      if(roadCountySaved.county) countyFeaturesById['08059']=roadCountySaved.county;
      else delete countyFeaturesById['08059'];
      delete globalThis.roadCountySaved;
    `,context);
    delete context.roadCountyMode;
    delete context.roadCountySource;
  }
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
check('each park milestone is a separate achievement and independently appears after travel starts', () => {
  vm.runInContext(`
    AppState.viewOnly=false; applyPassport(migratePassport({}));
    coordinateIndexes=null; npsCatalogLoaded=true;
    PARKS=Array.from({length:30},(_,i)=>({id:'tier'+i,name:'Park '+i,lat:37,lng:-120,biomes:[],states:[]}));
  `, context);
  for (const count of [1, 4, 5, 15, 30]) {
    vm.runInContext(`AppState.pins=Object.fromEntries(PARKS.slice(0,${count}).map(p=>[p.id,'v']));renderPassportView()`, context);
    const cards = element('achievementsContainer').innerHTML;
    for (const name of ['First Steps', 'Trailblazer', 'Master Ranger', 'Grand Voyager']) {
      assert.equal((cards.match(new RegExp(`<h5[^>]*>${name}<\\/h5>`, 'g')) || []).length, 1, `${count}: ${name}`);
    }
    assert.ok(!cards.includes('Park Ranger'));
    assert.ok(!cards.includes('Class title unlocked'));
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
check('two-point flight fog follows cached great-circle arcs while recorded tracks remain unchanged', () => {
  context.flightArcInput=[[40.64,-73.78],[49.01,2.55]];
  context.flightArcTrack=[[40.64,-73.78],[48,-40],[49.01,2.55]];
  try {
    const arc=vm.runInContext('flightFogRoute(flightArcInput)',context);
    const points=JSON.parse(JSON.stringify(arc));
    assert.equal(points.length,17);
    assert.deepEqual(points[0],context.flightArcInput[0]);
    assert.deepEqual(points[16],context.flightArcInput[1]);
    assert.ok(points[8][0]>50,'Atlantic midpoint should curve north rather than follow a Mercator cylinder');
    assert.equal(vm.runInContext('flightFogRoute(flightArcInput)',context),arc);
    assert.equal(vm.runInContext('flightFogRoute(flightArcTrack)',context),context.flightArcTrack);
    context.flightArcInput=[[35,170],[35,-170]];
    const crossing=JSON.parse(JSON.stringify(vm.runInContext('flightFogRoute(flightArcInput)',context)));
    assert.equal(crossing.length,17);
    assert.ok(crossing.every(([lat,lng])=>Number.isFinite(lat)&&Math.abs(lng)>=170),
      'a dateline flight must take the short arc, not cross Greenwich');
  } finally {
    delete context.flightArcInput;delete context.flightArcTrack;
  }
});
check('boat trips progressively thin ocean fog once per expedition, with a 50% minimum', () => {
  const saved=vm.runInContext('AppState.expeditions',context);
  try {
    for (let count=0;count<=7;count++) {
      context.oceanTripCount=count;
      vm.runInContext(`AppState.expeditions=Array.from({length:oceanTripCount},()=>({
        transitTags:['ferry','flight'],routeLegs:[{mode:'ferry'},{mode:'ferry'}]
      }))`,context);
      assert.equal(vm.runInContext('oceanFogOpacity()',context),
        count===0?0.99:Math.max(0.5,Number((1-count*0.1).toFixed(2))));
    }
    vm.runInContext("AppState.expeditions=[{transitTags:[],routeLegs:[{mode:'ferry'}]}]",context);
    assert.equal(vm.runInContext('oceanFogOpacity()',context),0.9);
    vm.runInContext("AppState.expeditions[0].routeLegs[0].mode='flight'",context);
    assert.equal(vm.runInContext('oceanFogOpacity()',context),0.99);
  } finally {
    context.savedOceanTrips=saved;
    vm.runInContext('AppState.expeditions=savedOceanTrips',context);
    delete context.savedOceanTrips;delete context.oceanTripCount;
  }
});
check('water corridors precede one unblurred cached land stencil and visited punch-outs without political queries', () => {
  const originalContains=context.d3.geoContains;
  const originalPath=context.Path2D;
  let paths=0,projections=0,zoom=4,pan=0;
  context.Path2D=class {
    constructor(){paths++;this.rings=0;}
    moveTo(){this.rings++;} lineTo(){} closePath(){}
  };
  const operations=[],landPaths=[];
  const point=(x,y)=>({x,y,round(){return this;},subtract(other){return point(x-other.x,y-other.y);}});
  context.oceanMap={options:{crs:{scale:()=>4096}},getZoom:()=>zoom,
    project([lat,lng]){projections++;return point(lng,lat);},
    latLngToContainerPoint:([lat,lng])=>point(lng+pan,lat)};
  context.oceanCtx={
    setTransform(){},clearRect(){},save(){},restore(){},
    translate(x,y){operations.push(['translation',x,y]);},beginPath(){},
    moveTo(){},lineTo(){},closePath(){},
    fillRect(){operations.push(['base',this.globalCompositeOperation,this.fillStyle]);},
    fill(path,rule){
      operations.push(['land',this.globalCompositeOperation,this.fillStyle,this.shadowColor,this.shadowBlur,rule]);
      if(this.globalCompositeOperation==='source-over') landPaths.push(path);
    },
    stroke(){operations.push(['stroke',this.globalCompositeOperation,this.lineWidth,this.strokeStyle,this.shadowBlur]);},
    createRadialGradient(){return {addColorStop(){}};},
    arc(){operations.push(['visited',this.globalCompositeOperation]);}
  };
  context.CoordinateLookups={...coordinateLookups,politicalRegion(){
    throw new Error('Fog rendering must not query political polygons');
  }};
  context.d3.geoContains=()=>{throw new Error('Fog rendering must not test polygon containment');};
  try {
    vm.runInContext(`
      globalThis.ferryFogSaved={map,fogCtx,coordinateIndexes,PARKS,worldGeoJson,usaRegionGeoJson,
        microStateGeoJson,microStateCatalog,state:{...AppState}};
      applyPassport(migratePassport({}));
      AppState.mode='rpg';AppState.currentTab='map';
      map=oceanMap;fogCtx=oceanCtx;microStateCatalog=[];
      coordinateIndexes={countries:[],states:[],counties:[],microStates:[]};
      const landFixture=()=>({geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]}});
      worldGeoJson=[landFixture()];usaRegionGeoJson=[landFixture()];microStateGeoJson=[landFixture()];
      PARKS=[{id:'ferryfog_park',lat:0,lng:0}];AppState.pins={ferryfog_park:'v'};
      AppState.homeBase={lat:0,lng:0,radiusKm:10};
      drawFogOfWar();
    `,context);
    assert.equal(vm.runInContext('oceanFogOpacity()',context),0.99);
    assert.equal(operations.filter(op=>op[0]==='base').length,1);
    assert.equal(operations.filter(op=>op[0]==='land' && op[1]==='source-over').length,0);
    operations.length=0;
    vm.runInContext(`
      AppState.expeditions=[{...testExpedition,parkIds:[],customPoiIds:[],countyIds:[],
        transitTags:['ferry'],routeCoords:[[0,0],[0,1]],
        routeLegs:[{mode:'ferry',routeSource:'direct',routeCoords:[[0,0],[0,1]],countyIds:[]}]}];
      drawFogOfWar();
    `,context);
    assert.equal(vm.runInContext('oceanFogOpacity()',context),0.9);
    assert.deepEqual(operations.find(op=>op[0]==='base'),['base','source-over','rgba(235, 239, 245, 0.9)']);
    const strokes=operations.filter(op=>op[0]==='stroke');
    assert.equal(strokes.length,1);
    assert.equal(strokes[0][1],'destination-out');
    assert.equal(strokes[0][2],vm.runInContext('calculatePixelRadius(0,160.934)*2',context));
    assert.equal(strokes[0][3],'rgba(0, 0, 0, 1)');
    assert.equal(strokes[0][4],12);
    const land=operations.filter(op=>op[0]==='land' && op[1]==='source-over');
    assert.equal(land.length,3,'one combined stencil is filled once for each world copy');
    assert.equal(new Set(landPaths).size,1);
    assert.equal(landPaths[0].rings,3,'all three atlas sources must contribute to the same path');
    assert.deepEqual(operations.filter(op=>op[0]==='translation').map(op=>op.slice(1)),[
      [-4096,0],[0,0],[4096,0]
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(land[0].slice(1))),
      ['source-over','rgba(235, 239, 245, 0.99)','transparent',0,'nonzero']);
    assert.ok(operations.findIndex(op=>op[0]==='stroke')<operations.findIndex(op=>op[0]==='land'));
    const firstVisit=operations.findIndex(op=>op[0]==='visited');
    assert.ok(firstVisit>findLastIndex(operations,op=>op[0]==='land' && op[1]==='source-over'));
    const firstProjections=projections;
    assert.equal(paths,1);
    vm.runInContext('drawFogOfWar()',context);
    assert.equal(paths,1,'all atlas land must reuse one projection cache');
    assert.equal(projections,firstProjections+2,'cached route and stencil only project their origins');
    pan=20;
    vm.runInContext('drawFogOfWar()',context);
    assert.equal(paths,1,'panning must not rebuild the stencil');
    assert.equal(projections,firstProjections+4);
    pan=0;
    zoom=5;
    vm.runInContext('drawFogOfWar()',context);
    assert.equal(paths,1,'zoom changes rescale the zoom-0 stencil instead of re-projecting it');
    for (const dataset of ['worldGeoJson','usaRegionGeoJson','microStateGeoJson']) {
      const before=paths;
      vm.runInContext(`${dataset}=[...${dataset}];drawFogOfWar()`,context);
      assert.equal(paths,before+1,`${dataset} replacement invalidates the stencil`);
    }
    const visitedByMode={};
    for(const mode of ['flight','rail','foot']) {
      context.fogTestMode=mode;
      operations.length=0;
      vm.runInContext(`
        AppState.expeditions[0].transitTags=[fogTestMode];
        AppState.expeditions[0].routeLegs[0].mode=fogTestMode;
        AppState.expeditions[0].routeStops=[{kind:'place',id:'dep',name:'Dep',coords:[0,0]},
          {kind:'place',id:'arr',name:'Arr',coords:[0,1]}];
        drawFogOfWar();
      `,context);
      visitedByMode[mode]=operations.filter(op=>op[0]==='visited');
      if(mode==='flight') {
        const lastLand=findLastIndex(operations,op=>op[0]==='land'&&op[1]==='source-over');
        assert.ok(findLastIndex(operations,op=>op[0]==='visited')>lastLand,'airport auras are carved after the land stencil');
      }
      assert.equal(vm.runInContext('oceanFogOpacity()',context),0.99);
      assert.equal(operations.filter(op=>op[0]==='base').length,1);
      assert.equal(operations.filter(op=>op[0]==='stroke').length,mode==='flight'?1:0);
      assert.equal(operations.filter(op=>op[0]==='land'&&op[1]==='source-over').length,mode==='flight'?3:0);
    }
    assert.equal(visitedByMode.flight.length,visitedByMode.rail.length+2,'each flight endpoint clears a small aura');
    assert.ok(visitedByMode.flight.every(op=>op[1]==='destination-out'));
    assert.equal(visitedByMode.foot.length,visitedByMode.rail.length);
    vm.runInContext("AppState.expeditions[0].routeLegs[0].mode='ferry'",context);
    assert.equal(vm.runInContext('oceanFogOpacity()',context),0.9,'mixed itinerary ferry leg thins oceans');
    operations.length=0;
    vm.runInContext('worldGeoJson=null;drawFogOfWar()',context);
    assert.equal(operations.filter(op=>op[0]==='base').length,1,'missing atlas retains the base opacity');
    assert.equal(operations.filter(op=>op[0]==='stroke').length,0,'missing atlas must not clear water across land');
    assert.equal(operations.filter(op=>op[0]==='land'&&op[1]==='source-over').length,0);
    operations.length=0;
    vm.runInContext('AppState.expeditions=[];drawFogOfWar()',context);
    assert.equal(vm.runInContext('oceanFogOpacity()',context),0.99);
    assert.equal(operations.filter(op=>op[0]==='base').length,1);
  } finally {
    vm.runInContext(`
      ({map,fogCtx,coordinateIndexes,PARKS,worldGeoJson,usaRegionGeoJson,
        microStateGeoJson,microStateCatalog}=ferryFogSaved);
      Object.assign(AppState,ferryFogSaved.state);delete globalThis.ferryFogSaved;
    `,context);
    context.d3.geoContains=originalContains;
    context.Path2D=originalPath;
    context.CoordinateLookups=coordinateLookups;
    delete context.fogTestMode;
    delete context.oceanMap;delete context.oceanCtx;
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
const scratchZoomTransforms = [];
let scratchZoomHandler = null;
function scratchSelection(tag = 'svg', data = []) {
  const node = { tag, attrs: {}, data };
  scratchNodes.push(node);
  return {
    html() { scratchNodes.length = 0; return this; },
    append(tag) { return scratchSelection(tag, node.data); },
    select() { return scratchSelection(); },
    attr(name, value) { node.attrs[name] = typeof value === 'function' ? node.data.map(value) : value; return this; },
    selectAll() { return this; },
    data(values) { node.data = values; scratchFeatures = values; return this; },
    join() { return this; },
    call(callback, ...args) { callback(this, ...args); return this; },
    on(name, handler) { node[name] = handler; return this; },
    text(value) { node.text = typeof value === 'function' ? node.data.map(value) : value; return this; }
  };
}
context.d3 = {
  ...d3Geo,
  geoContains: () => true, select: () => scratchSelection(),
  geoAlbersUsa: () => ({ fitSize() { projectionCalls.push('usa'); } }),
  geoNaturalEarth1: () => ({ fitSize() { projectionCalls.push('world'); } }),
  zoom: () => {
    const behavior = () => {};
    behavior.extent = () => behavior;
    behavior.scaleExtent = value => { behavior.scale = value; return behavior; };
    behavior.translateExtent = () => behavior;
    behavior.on = (name, handler) => {
      if (name === 'zoom') {
        scratchZoomHandler = handler;
        context.scratchZoomHandler = handler;
      }
      return behavior;
    };
    behavior.transform = (selection, transform) => { scratchZoomTransforms.push(transform); return selection; };
    return behavior;
  },
  zoomIdentity: { toString: () => 'translate(0,0) scale(1)' },
  geoPath: (...args) => args.length ? feature => {
    generatedScratchPaths.push(feature);
    return `path-${feature.id || 'mesh'}`;
  } : d3Geo.geoPath()
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
  assert.equal(vm.runInContext('countyScratchZoomBehavior.scale.join(",")', context), '1,12');
  const initialPathCount = generatedScratchPaths.length;
  vm.runInContext('scratchZoomHandler({transform:{toString:()=>"translate(12,8) scale(2)"}})', context);
  assert.equal(vm.runInContext('countyScratchZoom.toString()', context), 'translate(12,8) scale(2)');
  vm.runInContext('renderScratchMap()', context);
  assert.equal(generatedScratchPaths.length, initialPathCount, 'zoom and status refresh should not regenerate county geometry paths');
  element('btnResetScratchCountyZoom').handlers.click();
  assert.equal(scratchZoomTransforms.at(-1), context.d3.zoomIdentity);
  assert.ok(html.includes('id="scratchCountyMapControls"'));
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
      if (dataset === 'counties') {
        assert.equal(vm.runInContext('TravelLedger.clearsFog(countyFogStatuses(false)["06001"])',context),
          ['v','t','l'].includes(next));
      }
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
check('waterfall milestone achievements disclose their independent 1, 5 and 10 goals', () => {
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
      for (const goal of [1, 5, 10]) {
        assert.ok(cards.includes(
          `aria-label="Chasing Waterfalls completion" value="${Math.min(count, goal)}" max="${goal}"`
        ));
        assert.equal(
          cards.includes(`Visit ${goal} custom waterfall location`),
          count >= goal * 0.85
        );
      }
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
  if (vm.runInContext('oceanFogOpacity()<0.99 && !!worldGeoJson?.length',context)) {
    assert.ok(context.fogOperations.some(op=>op[0]==='polygonFill' && op[1]==='nonzero' && op[2]===0));
  }
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
  assert.equal(vm.runInContext('bucketPhotonResults.length', context), 3);
  const matches = element('bucketCityMatchesList').innerHTML;
  assert.ok(matches.includes('Sitka'));
  assert.ok(matches.includes('Jamestown Bay'));
  assert.ok(matches.includes('Ignored attraction'));
  for (const status of ['v', 'w', 't', 'l']) assert.ok(matches.includes(`data-photon-status="${status}"`));
  vm.runInContext("document.getElementById('bucketFilterType').value='parks';renderBucketCityMatches()", context);
  assert.ok(element('bucketCityMatchesList').innerHTML.includes('Ignored attraction'));
  assert.ok(!element('bucketCityMatchesList').innerHTML.includes('Sitka'));
  vm.runInContext("document.getElementById('bucketFilterType').value='custom';renderBucketCityMatches()", context);
  assert.ok(element('bucketCityMatchesList').innerHTML.includes('Sitka'));
});
const originalCityHelpers = vm.runInContext('({ addCustomPoi, renderParkMarkers, drawFogOfWar, updateAllUI, showNotification, cachedPoliticalAt, cachedBiomeAt, cachedBiomeRegionAt, coordinateIndexes, commitLedger, customPois:AppState.customPois, lookupCoordinate:CoordinateLookups.lookupCoordinate, cachedRarity:CoordinateLookups.cachedRarity, lookupRarityWithFallback:CoordinateLookups.lookupRarityWithFallback })', context);
try {
  vm.runInContext(`
    coordinateIndexes={countries:[{}],states:[{}],counties:[{}],ecoregions:[{}]};
    AppState.customPois=[];
    cityLookupCalls=[];
    photonLookupCalls=[];
    photonRarityCalls=[];
    cachedPoliticalAt=(lat,lng)=>{cityLookupCalls.push(['political',lat,lng]);return {
      countries:[],states:[],counties:[{id:'02220',name:'Sitka City and Borough'}]
    };};
    cachedBiomeRegionAt=(lat,lng)=>{cityLookupCalls.push(['biome-region',lat,lng]);return {
      ecoregions:[{id:1,name:'Pacific Coastal Mountains',realm:'Nearctic',biomeId:5}],biomeStatus:'matched'
    };};
    cachedBiomeAt=(lat,lng)=>{cityLookupCalls.push(['biome',lat,lng]);return ['5'];};
    addCustomPoi=poi=>{capturedPhotonCity=poi;AppState.customPois.push(poi);};
    commitLedger=mutate=>mutate();
    CoordinateLookups.lookupCoordinate=async (lat,lng,options)=>{
      photonLookupCalls.push({lat,lng,options});
      return {
        elevationFt:123,rarity:null,rarityTier:'Uncharted',
        political:{countries:['United States'],states:['Alaska'],counties:[{id:'02220',name:'Sitka City and Borough'}]},
        ecoregions:[{id:1,name:'Pacific Coastal Mountains',realm:'Nearctic',biomeId:5}],
        biomes:['5'],biomeStatus:'matched',lookedUpAt:'2026-10-22T00:00:00.000Z'
      };
    };
    CoordinateLookups.cachedRarity=()=>null;
    CoordinateLookups.lookupRarityWithFallback=async (lat,lng)=>{
      photonRarityCalls.push([lat,lng]);
      return CoordinateLookups.normalizeRarity({
        placeName:'Sitka',reviewCount:null,popularityScore:30,rarityTier:'Deep Cut',
        matchedLat:lat,matchedLng:lng,cached:true,source:'Test rarity provider',method:'provider-popularity'
      },lat,lng);
    };
    renderParkMarkers=()=>{};drawFogOfWar=()=>{};updateAllUI=()=>{};showNotification=()=>{};
  `, context);
  await vm.runInContext("savePhotonCity(bucketPhotonResults[0],'w')", context);
  await new Promise(resolve => setImmediate(resolve));
  const city = context.capturedPhotonCity;
  const normalizedCity = travelLedger.normalizePoi(city, coordinateLookups);
  check('Photon place saves offline geography and attaches rarity and elevation lookup results', () => {
    assert.equal(normalizedCity.name, 'Sitka');
    assert.equal(normalizedCity.category, 'City');
    assert.equal(normalizedCity.status, 'w');
    assert.equal(normalizedCity.elevationFt, 123);
    assert.equal(normalizedCity.rarity.rarityTier, 'Deep Cut');
    assert.equal(normalizedCity.rarityTier, 'Deep Cut');
    assert.deepEqual(Array.from(normalizedCity.political.countries), ['United States']);
    assert.deepEqual(Array.from(normalizedCity.political.states), ['Alaska']);
    assert.deepEqual(JSON.parse(JSON.stringify(normalizedCity.political.counties)),
      [{ id: '02220', name: 'Sitka City and Borough' }]);
    assert.deepEqual(Array.from(normalizedCity.biomes), ['5']);
    assert.equal(vm.runInContext('photonLookupCalls.length', context), 1);
    assert.equal(vm.runInContext('photonLookupCalls[0].options.skipRarityLookup', context), true);
    assert.equal(vm.runInContext('photonRarityCalls.length', context), 1);
    assert.equal(vm.runInContext('photonLookupCalls[0].options.rarityEndpoint', context),
      'https://api.devonoverbey.com/rarity');
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
    commitLedger=originalCityHelpers.commitLedger;
    AppState.customPois=originalCityHelpers.customPois;
    CoordinateLookups.lookupCoordinate=originalCityHelpers.lookupCoordinate;
    CoordinateLookups.cachedRarity=originalCityHelpers.cachedRarity;
    CoordinateLookups.lookupRarityWithFallback=originalCityHelpers.lookupRarityWithFallback;
    AppState.currentTab='map';
  `, context);
  context.fetch = originalPhotonFetch;
  element('bucketSearch').value = '';
}
vm.runInContext(`
  applyPassport(migratePassport({}));AppState.currentTab='map';
  PARKS=[
    {id:'filter_park',name:'Test National Park',designation:'National Park',lat:14.6543,lng:112.3456,biomes:[],states:['California']},
    {id:'filter_monument',name:'Test Monument',designation:'National Monument',lat:14.7543,lng:112.4456,biomes:[],states:['Utah']},
    {id:'filter_historic',name:'Test Historical Park',designation:'National Historical Park',lat:14.8543,lng:112.5456,biomes:[],states:[]},
    {id:'filter_intl',name:'International Test',intl:true,country:'Canada',biomes:[],lat:51,lng:-115,
      source:InternationalParks.wikidataSource,memberships:[],areaKm2:null,visitorCount:null}
  ];
  AppState.pins={filter_park:'v',filter_monument:'w'};
  AppState.parkRarity={filter_park:{rarity:null,rarityTier:'Hidden Gem'}};
  AppState.customPois=[{...customLocation,id:'poi_filter',status:'v'}];
`, context);
element('bucketSearch').value = '';
element('bucketFilterStatus').value = 'all';
element('bucketFilterType').value = 'all';
vm.runInContext('renderBucketListView()', context);
check('catalog rarity badges appear on Travel Ledger cards and park popups', () => {
  assert.ok(element('bucketListGrid').innerHTML.includes('💎 Hidden Gem'));
  assert.ok(vm.runInContext('createPopupContent(PARKS[0])', context).includes('💎 Hidden Gem'));
  assert.ok(element('bucketListGrid').innerHTML.includes('🥾 Beaten Path'));
  assert.ok(vm.runInContext('createPopupContent(PARKS[1])', context).includes('🧭 Regional Staple'));
});
const originalCatalogRenderHelpers = vm.runInContext('({lookupRarityWithFallback:CoordinateLookups.lookupRarityWithFallback,showNotification})', context);
try {
  vm.runInContext(`
    catalogRenderRarityCalls=0;catalogRenderNotices=[];
    CoordinateLookups.lookupRarityWithFallback=async ()=>{
      catalogRenderRarityCalls++;
      throw new Error('signal timed out');
    };
    showNotification=(...args)=>catalogRenderNotices.push(args);
    renderBucketListView();
    createPopupContent(PARKS[0]);
    renderExpeditionHistory();
  `, context);
  await new Promise(resolve => setImmediate(resolve));
  check('rendering catalog parks and trip history is offline and produces no rarity timeout toasts', () => {
    assert.equal(vm.runInContext('catalogRenderRarityCalls', context), 0);
    assert.equal(vm.runInContext('catalogRenderNotices.length', context), 0);
  });
} finally {
  context.originalCatalogRenderHelpers = originalCatalogRenderHelpers;
  vm.runInContext(`
    CoordinateLookups.lookupRarityWithFallback=originalCatalogRenderHelpers.lookupRarityWithFallback;
    showNotification=originalCatalogRenderHelpers.showNotification;
    delete globalThis.originalCatalogRenderHelpers;
  `, context);
}
const savedCatalogItinerary = vm.runInContext('JSON.stringify({expeditions:AppState.expeditions,parkRarity:AppState.parkRarity})', context);
try {
  vm.runInContext(`
    AppState.parkRarity={};
    AppState.expeditions=[{
      ...testExpedition,routeCoords:[[14.6543,112.3456]],transitTags:[],
      routeStops:[{kind:'park',id:'filter_park',name:'Test National Park',coords:[14.6543,112.3456]}],
      routeLegs:[],parkIds:['filter_park'],customPoiIds:[],countyIds:[]
    }];
    renderExpeditionHistory();
  `, context);
  check('catalog park itinerary stops display deterministic offline rarity badges', () => {
    assert.ok(element('travelLogFeed').innerHTML.includes('🥾 Beaten Path'));
  });
} finally {
  context.savedCatalogItinerary = savedCatalogItinerary;
  vm.runInContext(`
    const saved=JSON.parse(savedCatalogItinerary);
    AppState.expeditions=saved.expeditions;
    AppState.parkRarity=saved.parkRarity;
    renderExpeditionHistory();
    delete globalThis.savedCatalogItinerary;
  `, context);
}
vm.runInContext('AppState.parkRarity={}', context);
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
  const expectedParkCodes = actualSnapshot.data.filter(park =>
    /\bNational (?:Park(?:s)?|and State Parks)\b/i.test(park.designation || '') ||
    (!park.designation && park.parkCode === 'npsa')).map(park => park.parkCode).sort();
  assert.deepEqual(Array.from(filtered, park => park.id).sort(), expectedParkCodes);
  assert.ok(filtered.every(p => !p.intl));
  assert.equal(filtered.filter(p => p.id === 'seki').length, 1);
  assert.ok(filtered.some(p => p.id === 'npsa'));
  assert.ok(!element('bucketListGrid').innerHTML.includes('Banff'));
});

check('RPG county hitboxes include manually explored counties; normal clicks never edit', () => {
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
  assert.deepEqual(layers.map(layer => layer.feature.id), ['06001','06013','06041']);
  assert.ok(layers[0].tooltip().includes('Visited'));
  layers[0].handlers.mouseover();
  assert.equal(layers[0].styles[0].opacity, 0.65);
  const before = vm.runInContext('JSON.stringify(passportPayload())', context);
  layers[0].handlers.click();
  assert.equal(vm.runInContext('JSON.stringify(passportPayload())', context), before);
  vm.runInContext('renderCountyHitboxes()', context);
  assert.equal(removed, 0);
  vm.runInContext('AppState.expeditions=[];renderCountyHitboxes()', context);
  assert.equal(layers.length, 2);
  assert.equal(removed, 1);

  vm.runInContext('expeditionPicking=true;renderCountyHitboxes()', context);
  assert.equal(layers.length, 3);
  for (const layer of layers) {
    const explored = layer.feature.id !== '06001';
    assert.equal(typeof layer.tooltip, explored ? 'function' : 'object');
    layer.handlers.mouseover();
    assert.equal(layer.styles.length, explored ? 1 : 0);
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
  assert.equal(layers.length, 2);
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
check('biome milestone achievements independently use 3, total minus one and total', () => {
  for (const [count, visible, hidden] of [
    [0, [], ['Junior Ecologist', 'Almost There!', 'Gaia Wanderer']],
    [1, ['Junior Ecologist', 'Almost There!', 'Gaia Wanderer'], []],
    [3, ['Junior Ecologist', 'Almost There!', 'Gaia Wanderer'], []],
    [13, ['Junior Ecologist', 'Almost There!', 'Gaia Wanderer'], []],
    [14, ['Junior Ecologist', 'Almost There!', 'Gaia Wanderer'], []]
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
  assert.equal(vm.runInContext("ACHIEVEMENTS.find(a=>a.id==='almostThere').tiers[0].goal()", context), 14);
  assert.equal(vm.runInContext("ACHIEVEMENTS.find(a=>a.id==='gaiaWanderer').tiers[0].goal()", context), 15);
  vm.runInContext("delete BIOMES['15']", context);
});
check('atlas goals exclude unknown countries and withhold hints below the reveal threshold', () => {
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
  const atlasCard = element('achievementsContainer').innerHTML;
  assert.ok(atlasCard.includes('1 / 2 (50%)'));
  assert.ok(!atlasCard.includes('Progress'));
  assert.ok(!atlasCard.includes('The Earth is no longer just a map'));
  assert.ok(!atlasCard.includes('Visit every country/territory represented'));
  assert.ok(atlasCard.includes('./assets/achievements/unmet-legendary-mystic.png'));
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
check('achievement hints appear at 85 percent, remain blurred until earned, and preserve numbers and rarity art', () => {
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
    id: achievement.id, title: tier.title, desc: tier.desc, rarity: tier.rarity,
    goal: typeof tier.goal === 'function'
      ? tier.goal({npsTotal:474,countyTotal:3231,atlasCountriesTotal:200}) : tier.goal
  })))`, context);
  vm.runInContext(`
    var disclosureTestAchievements = ACHIEVEMENTS.slice();
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
      for (const progress of [
        0, testCase.goal / 2, testCase.goal * 0.849, testCase.goal * 0.85, testCase.goal
      ]) {
        cards.length = 0;
        badges.length = 0;
        context.disclosureTestProgress = progress;
        vm.runInContext(`
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
        const unmet = progress < testCase.goal;
        const hintVisible = progress >= testCase.goal * 0.85;
        assert.equal(card.innerHTML.includes(testCase.desc), !unmet || hintVisible, testCase.title);
        assert.equal(card.innerHTML.includes('class="text-[10px] achievement-hint'), unmet && hintVisible, testCase.title);
        assert.equal(card.innerHTML.includes('Achievement hint, blurred until earned'), unmet && hintVisible, testCase.title);
        assert.ok(!card.innerHTML.includes('achievement-redacted'), testCase.title);
        assert.equal(card.innerHTML.includes('achievement-icon-hidden'), false, testCase.title);
        const unmetImage = vm.runInContext(
          `UNMET_ACHIEVEMENT_IMAGES[${JSON.stringify(testCase.rarity)}]`, context
        );
        assert.equal(card.innerHTML.includes(`./assets/achievements/${unmetImage}`), unmet, testCase.title);
        assert.ok(!card.innerHTML.includes('Progress:'), testCase.title);
        if (unmet && hintVisible) assert.ok(html.includes('.achievement-hint {\n      filter: blur(0.7px);'));
        assert.equal(card.innerHTML.includes('<progress '), !secret || !unmet, testCase.title);
        assert.equal(card.className.includes('achievement-complete'), secret && !unmet, testCase.title);
        if (unmet) {
          const count = (Math.floor(Math.min(progress, testCase.goal) * 10) / 10).toLocaleString('en');
          assert.ok(card.innerHTML.includes(`${count} / ${testCase.goal}`), testCase.title);
          if (!hintVisible) assert.ok(!card.innerHTML.includes(testCase.desc), testCase.title);
          assert.equal((card.innerHTML.match(new RegExp(` / ${testCase.goal}`, 'g')) || []).length, 1);
          assert.equal(badges.length, 0, testCase.title);
        } else if (progress >= testCase.goal) {
          assert.ok(card.innerHTML.includes(' • Complete'), testCase.title);
          assert.ok(!card.innerHTML.includes('Class title unlocked'), testCase.title);
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
    `, context);
    cardContainer.appendChild = originalCardAppend;
    badgeContainer.appendChild = originalBadgeAppend;
    context.document.createElement = originalCreate;
  }
});
check('achievement and XP level-ups notify once while passport imports suppress both', () => {
  const result = vm.runInContext(`(() => {
    const achievements = ACHIEVEMENTS.slice();
    const calculate = calculateStats;
    const synchronize = syncDerivedState;
    const save = saveState;
    const restorePromotions = TravelLedger.restoreExpeditionPromotions;
    const playChime = AudioEngine.playChime;
    const notify = showProgressNotification;
    const timeout = setTimeout;
    const chimes = [], notices = [], timers = [];
    let progress = 0, level = 1;
    AudioEngine.playChime = sound => chimes.push(sound);
    showProgressNotification = (unlocked, reachedLevel) => notices.push({
      titles:unlocked.map(tier => tier.title), level:reachedLevel
    });
    calculateStats = () => ({testProgress:progress, level});
    syncDerivedState = () => {};
    saveState = () => {};
    TravelLedger.restoreExpeditionPromotions = () => {};
    setTimeout = callback => { timers.push(callback); return timers.length; };
    try {
      ACHIEVEMENTS.splice(0, ACHIEVEMENTS.length,
        {
          id: 'firstAchievement', progress: stats => stats.testProgress,
          tiers: [
            {goal:1,title:'First milestone'},
            {goal:2,title:'Second milestone'}
          ]
        },
        {
          id: 'secondAchievement', progress: stats => stats.testProgress,
          tiers: [{goal:2,title:'Another achievement'}]
        }
      );
      commitLedger(() => { progress = 2; level = 2; });
      commitLedger(() => { level = 3; });
      commitLedger(() => { progress = 3; level = 4; }, {notifyProgress:false});
      timers.forEach(callback => callback());
      return {chimes, notices, importTimers:timers.length};
    } finally {
      ACHIEVEMENTS.splice(0, ACHIEVEMENTS.length, ...achievements);
      calculateStats = calculate;
      syncDerivedState = synchronize;
      saveState = save;
      TravelLedger.restoreExpeditionPromotions = restorePromotions;
      AudioEngine.playChime = playChime;
      showProgressNotification = notify;
      setTimeout = timeout;
    }
  })()`, context);
  assert.deepEqual(Array.from(result.chimes), ['levelup', 'levelup']);
  assert.deepEqual(Array.from(result.notices[0].titles), [
    'First milestone', 'Second milestone', 'Another achievement'
  ]);
  assert.equal(result.notices[0].level, 2);
  assert.deepEqual(Array.from(result.notices[1].titles), []);
  assert.equal(result.notices[1].level, 3);
  assert.equal(result.notices.length, 2);
  assert.equal(result.importTimers, 2);
  assert.match(html, /commitLedger\(\(\) => applyPassport\(parsed\), \{\s*notifyProgress: false\s*\}\)/);
  assert.match(html, /<ul id="toastAchievementList"/);
});
check('achievement toast displays each unlocked tier as a safe list item', () => {
  const classList = (...initial) => {
    const values = new Set(initial);
    return {
      add(...tokens) { tokens.forEach(token => values.add(token)); },
      remove(...tokens) { tokens.forEach(token => values.delete(token)); },
      contains(token) { return values.has(token); },
      toggle(token, force) {
        if (force === undefined) {
          if (values.has(token)) values.delete(token);
          else values.add(token);
        } else if (force) values.add(token);
        else values.delete(token);
        return values.has(token);
      }
    };
  };
  const toastElements = {
    toastNotification: { classList: classList('opacity-0', 'pointer-events-none', 'translate-y-4') },
    toastTitle: { textContent: '' },
    toastMsg: { textContent: '', classList: classList() },
    toastIcon: { textContent: '' },
    toastAchievementList: {
      children: [], classList: classList('hidden'),
      replaceChildren() { this.children = []; },
      appendChild(child) { this.children.push(child); }
    }
  };
  const originalGetElement = context.document.getElementById;
  const originalCreateElement = context.document.createElement;
  context.document.getElementById = id => toastElements[id] || originalGetElement(id);
  context.document.createElement = tagName => ({ tagName, textContent: '' });
  try {
    vm.runInContext(`
      showProgressNotification([{title:'<First milestone>'},{title:'Second milestone'}]);
    `, context);
    assert.equal(toastElements.toastTitle.textContent, 'Achievements Unlocked');
    assert.deepEqual(
      toastElements.toastAchievementList.children.map(item => item.textContent),
      ['<First milestone>', 'Second milestone']
    );
    assert.equal(toastElements.toastMsg.classList.contains('hidden'), true);
    assert.equal(toastElements.toastAchievementList.classList.contains('hidden'), false);
    vm.runInContext('showProgressNotification([], 3)', context);
    assert.equal(toastElements.toastTitle.textContent, 'Level Up!');
    assert.equal(toastElements.toastMsg.textContent, 'You reached Level 3!');
    assert.equal(toastElements.toastIcon.textContent, '⬆️');
    assert.equal(toastElements.toastAchievementList.children.length, 0);
    assert.equal(toastElements.toastAchievementList.classList.contains('hidden'), true);
    assert.equal(toastElements.toastNotification.classList.contains('level-up-toast'), true);
  } finally {
    context.document.getElementById = originalGetElement;
    context.document.createElement = originalCreateElement;
  }
});
const achievementImages = vm.runInContext('Object.entries(ACHIEVEMENT_IMAGES)', context);
const unmetAchievementImages = vm.runInContext('Object.entries(UNMET_ACHIEVEMENT_IMAGES)', context);
for (const [title, filename] of achievementImages) {
  const data = await readFile(new URL(`./assets/achievements/${filename}`, import.meta.url));
  assert.equal(data.subarray(1, 4).toString(), 'PNG', `${title} artwork exists and is PNG`);
}
for (const [rarity, filename] of unmetAchievementImages) {
  const data = await readFile(new URL(`./assets/achievements/${filename}`, import.meta.url));
  assert.equal(data.subarray(1, 4).toString(), 'PNG', `${rarity} locked artwork exists and is PNG`);
}
check('achievement artwork maps all supplied images to real tiers and preserves emoji fallbacks', () => {
  assert.equal(achievementImages.length, 31);
  for (const [title, filename] of achievementImages) {
    context.artworkTitle = title;
    const markup = vm.runInContext(`(()=>{
      const achievement=ACHIEVEMENTS.find(a=>a.tiers.some(t=>t.title===artworkTitle));
      return achievementIconMarkup(achievement,achievement.tiers.find(t=>t.title===artworkTitle));
    })()`, context);
    assert.ok(markup.includes(`./assets/achievements/${filename}`), title);
    assert.ok(markup.includes('alt=""'), title);
  }
  assert.ok(vm.runInContext("achievementIconMarkup({icon:'🏕️'},{title:'Unmapped test tier'})", context).includes('🏕️'));
  assert.ok(html.includes('achievementIconMarkup(achievement, completed)'));
  assert.ok(html.includes('const iconTier = completed || next;'));
  assert.ok(html.includes('const unmet = !completed;'));
  delete context.artworkTitle;
});
check('unmet achievement artwork maps every rarity to its supplied placeholder', () => {
  assert.deepEqual(Object.fromEntries(unmetAchievementImages), {
    common: 'unmet-common-uncommon.png',
    uncommon: 'unmet-common-uncommon.png',
    rare: 'unmet-rare-epic.png',
    epic: 'unmet-rare-epic.png',
    legendary: 'unmet-legendary-mystic.png',
    mythic: 'unmet-legendary-mystic.png'
  });
  for (const [rarity, filename] of unmetAchievementImages) {
    context.artworkRarity = rarity;
    const markup = vm.runInContext(
      `achievementIconMarkup(ACHIEVEMENTS[0], {rarity:artworkRarity}, true)`, context
    );
    assert.ok(markup.includes(`./assets/achievements/${filename}`), rarity);
    assert.ok(markup.includes('alt=""'), rarity);
  }
  delete context.artworkRarity;
});
check('a grouped achievement uses its highest completed tier artwork instead of the next tier placeholder', () => {
  const cards = [];
  const container = element('achievementsContainer');
  const originalAppend = container.appendChild;
  const originalCreate = context.document.createElement;
  container.appendChild = card => cards.push(card);
  context.document.createElement = () => ({ innerHTML: '', className: '' });
  try {
    vm.runInContext(`
      const originalAchievements = ACHIEVEMENTS.slice();
      try {
        ACHIEVEMENTS.splice(0, ACHIEVEMENTS.length, {
          id: 'groupedArtworkTest', title: 'Explorer Class', icon: '🧭', background: '#172554',
          progress: stats => stats.testProgress,
          tiers: [
            {goal:1,title:'First Steps',desc:'First milestone',rarity:'common'},
            {goal:5,title:'Trailblazer',desc:'Next milestone',rarity:'uncommon'}
          ]
        });
        renderAchievementsView({testProgress:3});
      } finally {
        ACHIEVEMENTS.splice(0, ACHIEVEMENTS.length, ...originalAchievements);
      }
    `, context);
    assert.equal(cards.length, 1);
    assert.ok(cards[0].innerHTML.includes('./assets/achievements/first-steps.png'));
    assert.ok(!cards[0].innerHTML.includes('./assets/achievements/unmet-common-uncommon.png'));
    assert.ok(!cards[0].innerHTML.includes('./assets/achievements/trailblazer.png'));
  } finally {
    container.appendChild = originalAppend;
    context.document.createElement = originalCreate;
  }
});
check('every achievement milestone has valid difficulty rarity and distinct artwork', () => {
  assert.equal(vm.runInContext('ACHIEVEMENTS.every(a=>a.icon && /^#[0-9a-f]{6}$/i.test(a.background) && a.tiers.every(t=>ACHIEVEMENT_RARITIES[t.rarity]))', context), true);
  const stateAchievements = vm.runInContext(`ACHIEVEMENTS.filter(a=>
    ['statehopper','semiCentennial','fiftyNifty'].includes(a.id)).map(a=>({
    id:a.id,title:a.title,goal:a.tiers[0].goal,desc:a.tiers[0].desc,rarity:a.tiers[0].rarity
  }))`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(stateAchievements)), [
    { id: 'statehopper', title: 'Statehopper', goal: 10, desc: 'Claim 10 US states', rarity: 'uncommon' },
    { id: 'semiCentennial', title: 'Semi-Centennial', goal: 25, desc: 'Claim 25 US states', rarity: 'rare' },
    { id: 'fiftyNifty', title: 'Fifty-Nifty', goal: 50, desc: 'Claim all 50 US states', rarity: 'legendary' }
  ]);
  assert.equal(vm.runInContext("ACHIEVEMENTS.find(a=>a.id==='earthSandwich').icon", context), '🌍🥪');
  assert.equal(vm.runInContext("ACHIEVEMENTS.find(a=>a.id==='earthSandwich').background", context), '#172554');
  assert.equal(vm.runInContext("ACHIEVEMENTS.find(a=>a.id==='earthSandwich').tiers[0].rarity", context), 'mythic');
  assert.equal(vm.runInContext("ACHIEVEMENTS.find(a=>a.id==='nps').tiers[0].rarity", context), 'legendary');
  assert.equal(vm.runInContext("ACHIEVEMENTS.find(a=>a.id==='nps').tiers[0].desc", context),
    'Visit every non-international NPS catalog listing');
  assert.ok(html.includes('.achievement-icon[data-rarity="mythic"]'));
  assert.ok(html.includes('linear-gradient(135deg, #fb7185'));
});
check('character badges include every earned milestone without duplication or stale awards', () => {
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
    for (const [count, expected] of [
      [1, [['waterfalls_1', 'common']]],
      [4, [['waterfalls_1', 'common']]],
      [5, [['waterfalls_1', 'common'], ['waterfalls_5', 'uncommon']]],
      [10, [['waterfalls_1', 'common'], ['waterfalls_5', 'uncommon'], ['waterfalls_10', 'rare']]]
    ]) {
      captured.length = 0;
      context.badgeWaterfalls = count;
      vm.runInContext(`
        applyPassport(migratePassport({}));
        AppState.customPois=Array.from({length:badgeWaterfalls},(_,i)=>({
          ...customLocation,id:'badge_falls_'+i,category:'waterfall',status:'v',biomes:[]
        }));
        renderPassportView();
      `, context);
      const badges = captured.filter(badge => badge.attributes['data-achievement'].startsWith('waterfalls_'));
      assert.deepEqual(badges.map(badge => [
        badge.attributes['data-achievement'], badge.attributes['data-rarity']
      ]), expected);
      for (const badge of badges) {
        assert.ok(badge.attributes['aria-label'].includes('Chasing Waterfalls'));
        assert.equal(badge.attributes.title, badge.attributes['aria-label']);
        assert.ok(badge.innerHTML.includes('assets/achievements/chasing-waterfalls.png'));
      }
      assert.equal(captured.some(badge => badge.attributes['data-achievement'] === 'localLore'), false);
    }
    const waterfall = captured.find(badge => badge.attributes['data-achievement'] === 'waterfalls_1');
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
check('state milestone badges are awarded independently at their own thresholds', () => {
  const captured = [];
  const container = element('earnedAchievementBadges');
  const originalAppend = container.appendChild;
  const originalCreate = context.document.createElement;
  container.appendChild = badge => captured.push(badge);
  context.document.createElement = () => ({
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener() {}
  });
  try {
    for (const [count, expected] of [
      [10, ['statehopper']],
      [25, ['statehopper', 'semiCentennial']],
      [50, ['statehopper', 'semiCentennial', 'fiftyNifty']]
    ]) {
      captured.length = 0;
      context.stateBadgeCount = count;
      vm.runInContext(`
        (() => {
          const savedAchievements = ACHIEVEMENTS.slice();
          const stateAchievements = ACHIEVEMENTS.filter(achievement =>
            ['statehopper', 'semiCentennial', 'fiftyNifty'].includes(achievement.id));
          ACHIEVEMENTS.splice(0, ACHIEVEMENTS.length, ...stateAchievements);
          renderEarnedAchievementBadges({statesCount:stateBadgeCount});
          ACHIEVEMENTS.splice(0, ACHIEVEMENTS.length, ...savedAchievements);
        })();
      `, context);
      assert.deepEqual(captured.map(badge => badge.attributes['data-achievement']), expected);
    }
  } finally {
    container.appendChild = originalAppend;
    context.document.createElement = originalCreate;
  }
});
check('separate achievement cards show their own artwork and rarity without revealing untouched achievements', () => {
  vm.runInContext(`
    applyPassport(migratePassport({}));PARKS=[];coordinateIndexes=null;
    AppState.customPois=[{...customLocation,id:'poi_rarity_fall',category:'waterfall',status:'v'}];
    renderAchievementsView();
  `, context);
  const cards = element('achievementsContainer').innerHTML;
  assert.ok(cards.includes('assets/achievements/unmet-common-uncommon.png'));
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
  assert.ok(badges.includes('assets/achievements/country-roads.png'));
  assert.ok(badges.includes('assets/achievements/rocky-mountain-high.png'));
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
check('pans slide the cached fog bitmap and only redraw near the overscan edge', () => {
  const source = html.match(/function panFogCanvas\(\) \{[\s\S]*?\n    \}/)[0];
  assert.ok(html.includes("map.on('move', panFogCanvas)") && html.includes("map.on('moveend', scheduleFogDraw)"));
  assert.ok(!html.includes("window.addEventListener('resize'"));
  const originalRaf = context.requestAnimationFrame;
  let frames = 0;
  let offset = { x: 0, y: 0 };
  context.requestAnimationFrame = () => ++frames;
  context.panMap = { latLngToContainerPoint: () => offset };
  try {
    vm.runInContext(`AppState.currentTab='map';AppState.mode='rpg';fogZoomAnimating=false;fogDrawFrame=null;
      map=panMap;fogPadding={x:400,y:300};fogDrawAnchor={lat:1,lng:2};fogCanvas.style.transform=''`, context);
    offset = { x: 120, y: -80 };
    vm.runInContext('panFogCanvas()', context);
    assert.equal(frames, 0, source);
    assert.equal(vm.runInContext('fogCanvas.style.transform', context), 'translate3d(120px, -80px, 0)');
    offset = { x: 301, y: 0 };
    vm.runInContext('panFogCanvas()', context);
    assert.equal(frames, 1);
  } finally {
    context.requestAnimationFrame = originalRaf;
    vm.runInContext("fogDrawFrame=null;fogDrawAnchor=null;map=null;fogCanvas.style.transform=''", context);
  }
});
check('fog tiles render the viewport first, fill overscan when idle, survive pans and drop on data changes', () => {
  const saved = { raf: context.requestAnimationFrame, ric: context.requestIdleCallback, off: context.OffscreenCanvas };
  let tilesMade = 0, frame = null, idle = null, panX = 0;
  const main = [];
  const noopCtx = () => new Proxy({}, { get: (t, k) => k in t ? t[k] : () => {} });
  const point = (x, y) => ({ x, y, round() { return this; }, subtract(o) { return point(x - o.x, y - o.y); } });
  context.requestAnimationFrame = callback => { frame = callback; return 1; };
  context.requestIdleCallback = callback => { idle = callback; return 1; };
  context.OffscreenCanvas = class { constructor(w, h) { tilesMade++; this.width = w; this.height = h; } getContext() { return noopCtx(); } };
  context.tileMap = {
    options: { crs: { scale: z => 256 * 2 ** z } }, getZoom: () => 6, getSize: () => point(600, 400),
    project: ([lat, lng]) => point(lng * 10 + 5000, -lat * 10 + 5000),
    latLngToContainerPoint: ([lat, lng]) => point(lng * 10 + 200 - panX, -lat * 10 + 200),
    containerPointToLatLng: () => ({ lat: 0, lng: 0 })
  };
  const mainCtx = new Proxy({}, { get: (t, k) => k in t ? t[k] : (...args) => main.push([k, ...args]),
    set: (t, k, v) => { t[k] = v; return true; } });
  context.tileCtx = mainCtx;
  try {
    vm.runInContext(`
      globalThis.tileSaved={map,fogCtx,fogPadding,PARKS,worldGeoJson,state:Object.fromEntries(['currentTab','mode','homeBase','expeditions','routes','clearedPolygons','counties','customLocations'].map(k=>[k,AppState[k]])),w:fogCanvas.width,h:fogCanvas.height};
      AppState.currentTab='map';AppState.mode='rpg';AppState.homeBase=null;AppState.expeditions=[];AppState.routes=[];
      AppState.clearedPolygons=[];AppState.counties={};AppState.customLocations=[];
      PARKS=[];worldGeoJson=null;fogZoomAnimating=false;fogDrawFrame=null;homeAuraPulseStarted=null;discoveryPulses.clear();
      map=tileMap;fogCtx=tileCtx;fogPadding={x:600,y:400};fogCanvas.width=1800;fogCanvas.height=1200;
      drawFogOfWar();
    `, context);
    assert.equal(tilesMade, 0, 'data changes coalesce into the next frame');
    frame();
    assert.equal(tilesMade, 4, 'only the four tiles under the viewport render synchronously');
    assert.equal(main.filter(op => op[0] === 'drawImage').length, 4);
    assert.equal(main.filter(op => op[0] === 'fillRect').length, 8, 'overscan shows placeholder fog');
    idle();
    assert.equal(tilesMade, 12);
    assert.equal(main.filter(op => op[0] === 'drawImage').length, 12);
    panX = 512;
    main.length = 0;
    vm.runInContext('showFog()', context);
    assert.equal(tilesMade, 12, 'panning reuses cached tiles');
    assert.equal(main.filter(op => op[0] === 'drawImage').length, 9);
    main.length = 0;
    vm.runInContext('showFog()', context);
    assert.equal(main.length, 0, 'an unchanged view (e.g. moveend right after zoomend) does not recomposite');
    vm.runInContext('fogCanvas.getContext=()=>tileCtx', context);
    panX = 1024;
    main.length = 0;
    vm.runInContext('showFog()', context);
    const seed = main.findIndex(op => op[0] === 'setTransform' && op[5] === -512 && op[6] === 0);
    assert.ok(seed >= 0, 'the previous bitmap is shifted by the pan delta as the placeholder');
    assert.equal(main.filter(op => op[0] === 'fillRect').length, 1, 'no solid per-tile placeholder blocks');
    const draws = main.filter(op => op[0] === 'drawImage').length;
    assert.ok(draws > 1);
    assert.equal(main.filter(op => op[0] === 'clearRect').length, draws, 'each tile replaces (not blends over) the seed');
    assert.equal(main.findIndex(op => op[0] === 'drawImage'), seed + 2, 'seed is drawn before any tile');
    const madeBeforeIdle = tilesMade;
    idle();
    assert.ok(tilesMade > madeBeforeIdle, 'missing tiles still fill in during idle time');
    vm.runInContext('delete fogCanvas.getContext', context);
    const madeBeforeChange = tilesMade;
    vm.runInContext('drawFogOfWar()', context);
    frame();
    assert.equal(tilesMade - madeBeforeChange, 4, 'a data change re-renders the visible tiles');
  } finally {
    Object.assign(context, { requestAnimationFrame: saved.raf, requestIdleCallback: saved.ric, OffscreenCanvas: saved.off });
    if (!saved.off) delete context.OffscreenCanvas;
    if (!saved.ric) delete context.requestIdleCallback;
    vm.runInContext(`
      ({map,fogCtx,fogPadding,PARKS,worldGeoJson}=tileSaved);Object.assign(AppState,tileSaved.state);
      fogCanvas.width=tileSaved.w;fogCanvas.height=tileSaved.h;fogTiles.clear();fogTileQueue=[];fogTileIdle=null;
      fogComposite=null;fogDrawFrame=null;delete globalThis.tileSaved;
    `, context);
  }
});
check('cleared counties are batched into one cached blurred fill reused across zooms', () => {
  const originalPath = context.Path2D;
  let paths = 0, fills = 0, projections = 0, zoom = 5;
  const point = (x, y) => ({ x, y, round() { return this; }, subtract(o) { return point(x - o.x, y - o.y); } });
  context.Path2D = class { constructor() { paths++; } moveTo() {} lineTo() {} closePath() {} };
  const scales = [];
  context.batchMap = { options: { crs: { scale: z => 256 * 2 ** z } }, getZoom: () => zoom,
    project: ([lat, lng]) => { projections++; return point(lng, lat); },
    latLngToContainerPoint: () => point(0, 0) };
  context.batchCtx = { save() {}, restore() {}, translate() {}, scale(x) { scales.push(x); },
    fill(path, rule) { fills++; assert.equal(rule, 'nonzero'); assert.equal(this.shadowBlur, 25); } };
  try {
    vm.runInContext(`map=batchMap;fogCtx=batchCtx;countyFogBatchCache=null;
      ['91001','91002','91003'].forEach((id,i)=>countyFeaturesById[id]={geometry:{type:'Polygon',
        coordinates:[[[i,0],[i+1,0],[i+1,1],[i,0]]]}});
      punchCountyFog(['91001','91002','91003']);`, context);
    assert.equal(fills, 1);
    assert.equal(paths, 1);
    const first = projections;
    vm.runInContext("punchCountyFog(['91001','91002','91003'])", context);
    assert.equal(fills, 2);
    assert.equal(paths, 1);
    assert.equal(projections, first + 1, 'only the origin is projected on a cached frame');
    zoom++;
    vm.runInContext("punchCountyFog(['91001','91002','91003'])", context);
    assert.equal(paths, 1, 'zoom changes rescale the zoom-0 path instead of re-projecting it');
    assert.equal(projections, first + 2);
    assert.deepEqual(scales.slice(-2), [32, 64]);
    vm.runInContext("punchCountyFog(['91001','91002'])", context);
    assert.equal(paths, 2, 'a different county set rebuilds the batch');
  } finally {
    context.Path2D = originalPath;
    vm.runInContext(`map=null;fogCtx=null;countyFogBatchCache=null;
      ['91001','91002','91003'].forEach(id=>delete countyFeaturesById[id])`, context);
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
      const beforeWidthChange=projections;
      vm.runInContext('punchFogRoute(detailedRoad,160.934)',context);
      assert.equal(projections,beforeWidthChange+1,'changing width must reuse projected vertices');
      assert.ok(Math.abs(context.roadCtx.lineWidth-
        vm.runInContext('calculatePixelRadius(4.995,160.934)*2',context))<1e-10);
      assert.equal(context.roadCtx.strokeStyle,'rgba(0, 0, 0, 1)');
      vm.runInContext('punchFogRoute(detailedRoad)',context);
      assert.equal(projections,beforeWidthChange+2);
      assert.ok(Math.abs(context.roadCtx.lineWidth-
        vm.runInContext('calculatePixelRadius(4.995,20)*2',context))<1e-10);
      assert.equal(context.roadCtx.strokeStyle,'rgba(0, 0, 0, 0.95)');
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
check('custom coordinate stops can be added with an optional name and join the route itinerary', () => {
  assert.match(html, /<details class="rounded-lg border border-slate-700 bg-slate-950\/40 p-3">\s*<summary[^>]*>Add custom coordinates<\/summary>/);
  assert.doesNotMatch(html, /id="expeditionCoordinate(?:Lat|Lng)"[^>]*required/);
  context.crypto = { randomUUID: () => 'manual-stop' };
  element('expeditionCoordinateName').value = 'Statue of Liberty';
  element('expeditionCoordinateLat').value = '40.6892';
  element('expeditionCoordinateLng').value = '-74.0445';
  element('btnAddExpeditionCoordinate').handlers.click();
  const named = vm.runInContext('expeditionDraft[1]', context);
  assert.equal(named.kind, 'place');
  assert.equal(named.id, 'coord_manual-stop');
  assert.equal(named.name, 'Statue of Liberty');
  assert.deepEqual(Array.from(named.coords), [40.6892, -74.0445]);
  element('expeditionCoordinateName').value = '';
  element('expeditionCoordinateLat').value = '0';
  element('expeditionCoordinateLng').value = '0';
  element('btnAddExpeditionCoordinate').handlers.click();
  const unnamed = vm.runInContext('expeditionDraft[2]', context);
  assert.equal(unnamed.name, 'Coordinates 0, 0');
  assert.deepEqual(Array.from(unnamed.coords), [0, 0]);
  assert.equal(vm.runInContext('expeditionPreparedLegs', context), null);
  vm.runInContext('expeditionDraft.splice(1);invalidateExpeditionRoutes();renderExpeditionStops()', context);
});
check('invalid or incomplete custom coordinates report an error without changing the itinerary', () => {
  const before = vm.runInContext('expeditionDraft.length', context);
  element('expeditionCoordinateLat').value = '91';
  element('expeditionCoordinateLng').value = '0';
  element('btnAddExpeditionCoordinate').handlers.click();
  assert.equal(vm.runInContext('expeditionDraft.length', context), before);
  assert.match(element('expeditionStatus').textContent, /latitude/i);
  element('expeditionCoordinateLat').value = '';
  element('expeditionCoordinateLng').value = '0';
  element('btnAddExpeditionCoordinate').handlers.click();
  assert.equal(vm.runInContext('expeditionDraft.length', context), before);
  assert.match(element('expeditionStatus').textContent, /both a latitude and longitude/i);
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
  assert.ok(previewLines.some(line=>line.options.color==='#e879f9' && line.options.dashArray==='8, 8'));
  assert.ok(previewLines.some(line=>line.options.color==='#020617' && line.options.weight===7));
  assert.ok(element('expeditionRouteSummary').textContent.includes('10 percentage points'));
  assert.ok(element('expeditionRouteSummary').textContent.includes('100 miles'));
  assert.ok(element('expeditionRouteSummary').textContent.includes('rail/walking clear no route fog'));
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
  assert.equal(vm.runInContext('TravelLedger.fogRoutes(draftExpedition(expeditionPreparedLegs)).length',context),0);
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
const expectedScratchParkRecords = actualSnapshot.data.filter(park =>
  ['National Park', 'National Park & Preserve', 'National Parks'].includes(park.designation) ||
  ['npsa', 'redw'].includes(park.parkCode));
const expectedScratchParkCount = expectedScratchParkRecords.length +
  Number(expectedScratchParkRecords.some(park => park.parkCode === 'seki'));
check('dedicated scratch page includes current National Parks and excludes monuments or other NPS units', () => {
  assert.equal(scratchParks.length, expectedScratchParkCount);
  assert.equal(new Set(scratchParks.map(p => p.id)).size, expectedScratchParkCount);
  for (const park of expectedScratchParkRecords) {
    const ids = park.parkCode === 'seki' ? ['sequ', 'kica'] : [park.parkCode];
    for (const id of ids) assert.ok(scratchParks.some(scratchPark => scratchPark.id === id), `${park.parkCode} missing from scratch map`);
  }
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
  assert.equal(progress.reduce((sum, r) => sum + r.total, 0), scratchParks.length);
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
check('stop grips support pointer dragging, cancellation and keyboard moves without stale routes or lost modes', () => {
  let captured = null, focused = 0;
  const handlers = {};
  const rows = Array.from({length:3},(_,index)=>({
    style:{},getBoundingClientRect:()=>({top:index*100,height:80}),
    querySelector:()=>({focus(){focused++;}})
  }));
  const handle = {
    setAttribute(){},addEventListener(name,handler){handlers[name]=handler;},
    setPointerCapture(id){captured=id;},hasPointerCapture(id){return captured===id;},
    releasePointerCapture(){captured=null;}
  };
  const form=element('expeditionForm');
  const oldBounds=form.getBoundingClientRect,oldScroll=form.scrollBy;
  form.getBoundingClientRect=()=>({top:0,bottom:600});
  form.scrollBy=()=>{};
  context.dragHandle=handle;context.dragRows=rows;context.dragList={children:rows};
  try {
    vm.runInContext(`
      globalThis.dragSaved={draft:expeditionDraft,pending:expeditionPending,readOnly:AppState.viewOnly,
        render:renderExpeditionStops,legs:expeditionPreparedLegs,key:expeditionPreparedKey};
      expeditionDraft=[
        {name:'A',travelMode:'flight',coords:[0,0]},
        {name:'B',travelMode:'road',coords:[1,1]},
        {name:'C',travelMode:'ferry',coords:[2,2]}];
      expeditionPending=false;AppState.viewOnly=false;
      renderExpeditionStops=()=>{};
      expeditionPreparedLegs=[{}];expeditionPreparedKey='prepared';
      wireExpeditionStopDrag(dragHandle,dragRows[0],dragList,0);
    `,context);
    const event=(y)=>({button:0,isPrimary:true,pointerId:7,clientY:y,preventDefault(){}});
    handlers.pointerdown(event(20));
    handlers.pointermove(event(260));
    assert.equal(rows[2].style.boxShadow,'0 3px 0 #fbbf24');
    handlers.pointerup(event(260));
    assert.equal(vm.runInContext('expeditionDraft.map(s=>s.name).join(",")',context),'B,C,A');
    assert.equal(vm.runInContext('expeditionDraft[2].travelMode',context),'flight');
    assert.equal(vm.runInContext('expeditionPreparedLegs',context),null);
    assert.equal(element('btnSaveExpedition').disabled,true);
    assert.equal(captured,null);
    assert.equal(focused,1);
    handlers.pointerdown(event(20));handlers.pointermove(event(260));handlers.pointercancel(event(260));
    assert.equal(vm.runInContext('expeditionDraft.map(s=>s.name).join(",")',context),'B,C,A');
    assert.equal(rows[0].style.transform,'');
    handlers.keydown({key:'ArrowDown',preventDefault(){}});
    assert.equal(vm.runInContext('expeditionDraft.map(s=>s.name).join(",")',context),'C,B,A');
    vm.runInContext('expeditionPending=true',context);
    handlers.pointerdown(event(20));
    assert.equal(captured,null);
    assert.equal(vm.runInContext('moveExpeditionStop(0,2)',context),false);
    vm.runInContext('expeditionPending=false;AppState.viewOnly=true',context);
    assert.equal(vm.runInContext('moveExpeditionStop(0,2)',context),false);
  } finally {
    vm.runInContext(`
      expeditionDraft=dragSaved.draft;expeditionPending=dragSaved.pending;AppState.viewOnly=dragSaved.readOnly;
      renderExpeditionStops=dragSaved.render;expeditionPreparedLegs=dragSaved.legs;expeditionPreparedKey=dragSaved.key;
      delete globalThis.dragSaved;
    `,context);
    form.getBoundingClientRect=oldBounds;form.scrollBy=oldScroll;
    delete context.dragHandle;delete context.dragRows;delete context.dragList;
  }
});
check('county search finds small counties by name, state and padded FIPS, with bounded accessible results', () => {
  const create=context.document.createElement;
  const buttons=[];
  context.document.createElement=tag=>{
    const node=create(tag);
    if(tag==='button') buttons.push(node);
    return node;
  };
  try {
    vm.runInContext(`
      globalThis.countySearchSaved={countyGeoJson,usaRegionGeoJson,state:{...AppState},
        feature:countyFeaturesById['51013']};
      AppState.scratchDataset='counties';AppState.viewOnly=false;AppState.counties={};
      countyGeoJson=[
        {id:51013,properties:{name:'Arlington'}},
        {id:1001,properties:{name:'Autauga'}}];
      usaRegionGeoJson=[{id:51,properties:{name:'Virginia'}},{id:1,properties:{name:'Alabama'}}];
      countyFeaturesById['51013']=countyGeoJson[0];
    `,context);
    for(const query of ['arlington','ARLINGTON Virginia','51013']) {
      context.countySearchQuery=query;
      assert.equal(vm.runInContext('scratchCountyMatches(countySearchQuery)[0].id',context),51013);
    }
    assert.equal(vm.runInContext('scratchCountyMatches("01001")[0].id',context),1001);
    assert.equal(vm.runInContext('scratchCountyMatches("Arlington Alabama").length',context),0);
    element('scratchCountySearch').value='Arlington';
    element('scratchCountySearch').handlers.input();
    assert.ok(buttons.at(-1).textContent.includes('Arlington, Virginia'));
    assert.equal(buttons.at(-1).disabled,false);
    vm.runInContext("AppState.counties={'51013':'v'};AppState.viewOnly=true;renderCountySearch()",context);
    assert.equal(buttons.at(-1).disabled,true);
    assert.ok(buttons.at(-1).textContent.includes('Visited'));
    vm.runInContext("countyGeoJson=Array.from({length:70},(_,i)=>({id:51000+i,properties:{name:'Small'}}))",context);
    element('scratchCountySearch').value='Virginia';
    const before=buttons.length;
    element('scratchCountySearch').handlers.input();
    assert.equal(buttons.length-before,50);
    assert.ok(element('scratchCountySearchStatus').textContent.includes('70 matching counties or districts'));
    element('scratchCountySearch').value='no match';
    element('scratchCountySearch').handlers.input();
    assert.ok(element('scratchCountySearchStatus').textContent.startsWith('No matching counties or districts'));
    vm.runInContext('countyGeoJson=null;renderCountySearch()',context);
    assert.ok(element('scratchCountySearchStatus').textContent.includes('unavailable'));
  } finally {
    context.document.createElement=create;
    vm.runInContext(`
      ({countyGeoJson,usaRegionGeoJson}=countySearchSaved);
      Object.assign(AppState,countySearchSaved.state);
      if(countySearchSaved.feature) countyFeaturesById['51013']=countySearchSaved.feature;
      else delete countyFeaturesById['51013'];
      delete globalThis.countySearchSaved;
    `,context);
    delete context.countySearchQuery;
  }
});
check('international County and District filter searches and cycles the selected country', () => {
  const district = {
    type: 'Feature', id: 'CAN:CD-ON',
    properties: { name: 'Ottawa Division', country: 'CAN' },
    geometry: { type: 'Polygon', coordinates: [[[-80.8,43.2],[-80.2,43.2],[-80.2,43.8],[-80.8,43.8],[-80.8,43.2]]] }
  };
  const province = {
    type: 'Feature', id: 'CAN:ONT',
    properties: { name: 'Ontario', country: 'Canada', isoA3: 'CAN', region: 'Ontario' },
    geometry: district.geometry
  };
  context.countryFilterDistrict = district;
  context.countryFilterProvince = province;
  context.countryFilterUsCounty = {
    type: 'Feature', id: '06001',
    properties: { name: 'Alameda County', country: 'United States of America' },
    geometry: district.geometry
  };
  vm.runInContext(`
    globalThis.countryFilterSaved = {
      countyGeoJson, internationalCountyGeoJson, worldSubdivisionGeoJson,
      feature: countyFeaturesById['CAN:CD-ON'], usCountyFeature: countyFeaturesById['06001'],
      state: { ...AppState },
      commitLedger, refreshTravelUI, showNotification,
      filterValue: document.getElementById('scratchCountyCountryFilter').value,
      filterHtml: document.getElementById('scratchCountyCountryFilter').innerHTML
    };
    countyGeoJson = [countryFilterUsCounty];
    internationalCountyGeoJson = [countryFilterDistrict];
    worldSubdivisionGeoJson = [countryFilterProvince];
    countyFeaturesById['CAN:CD-ON'] = countryFilterDistrict;
    countyFeaturesById['06001'] = countryFilterUsCounty;
    AppState.scratchDataset = 'counties';
    AppState.counties = {};
    AppState.viewOnly = false;
    AppState.statusOverrides = { pins: {}, regions: {}, counties: {}, nationalParks: {} };
    document.getElementById('scratchCountyCountryFilter').value = 'US';
    commitLedger = change => {
      change();
      AppState.counties['CAN:CD-ON'] = AppState.statusOverrides.counties['CAN:CD-ON'];
      AppState.counties['06001'] = AppState.statusOverrides.counties['06001'];
    };
    refreshTravelUI = () => {};
    showNotification = () => {};
    renderCountyCountryFilter();
  `, context);
  try {
    assert.ok(element('scratchCountyCountryFilter').innerHTML.includes('value="CAN">Canada'));
    assert.ok(element('scratchCountyCountryFilter').innerHTML.includes('All Worldwide Counties / Districts'));
    assert.equal(vm.runInContext('scratchCountyFeatures().length', context), 1);
    element('scratchCountyCountryFilter').value = 'CAN';
    assert.equal(vm.runInContext('scratchCountyFeatures().length', context), 1);
    assert.equal(vm.runInContext('scratchCountyMatches("Ottawa Division Canada")[0].id', context), 'CAN:CD-ON');
    vm.runInContext('cycleScratchStatus(scratchCountyMatches("Ottawa")[0])', context);
    assert.equal(vm.runInContext("AppState.statusOverrides.counties['CAN:CD-ON']", context), 'v');
    assert.equal(vm.runInContext("AppState.counties['CAN:CD-ON']", context), 'v');
    element('scratchCountyCountryFilter').value = 'INTL';
    assert.equal(vm.runInContext('scratchCountyFeatures().length', context), 2);
    assert.equal(vm.runInContext('scratchCountyMatches("Alameda County")[0].id', context), '06001');
    vm.runInContext('cycleScratchStatus(scratchCountyMatches("Alameda County")[0])', context);
    assert.equal(vm.runInContext("AppState.statusOverrides.counties['06001']", context), 'v');
    assert.equal(vm.runInContext("AppState.counties['06001']", context), 'v');
  } finally {
    vm.runInContext(`
      countyGeoJson = countryFilterSaved.countyGeoJson;
      internationalCountyGeoJson = countryFilterSaved.internationalCountyGeoJson;
      worldSubdivisionGeoJson = countryFilterSaved.worldSubdivisionGeoJson;
      if (countryFilterSaved.feature) countyFeaturesById['CAN:CD-ON'] = countryFilterSaved.feature;
      else delete countyFeaturesById['CAN:CD-ON'];
      if (countryFilterSaved.usCountyFeature) countyFeaturesById['06001'] = countryFilterSaved.usCountyFeature;
      else delete countyFeaturesById['06001'];
      Object.assign(AppState, countryFilterSaved.state);
      commitLedger = countryFilterSaved.commitLedger;
      refreshTravelUI = countryFilterSaved.refreshTravelUI;
      showNotification = countryFilterSaved.showNotification;
      document.getElementById('scratchCountyCountryFilter').value = countryFilterSaved.filterValue;
      document.getElementById('scratchCountyCountryFilter').innerHTML = countryFilterSaved.filterHtml;
      delete globalThis.countryFilterSaved;
`, context);
    delete context.countryFilterDistrict;
    delete context.countryFilterProvince;
  }
});
check('World States and Provinces render US states without county boundaries and cycle region status', () => {
  const previousD3 = context.d3;
  const searchValue = element('scratchCountySearch').value;
  const subdivisionId = 'CAN:ON-01';
  const subdivision = {
    type: 'Feature', id: subdivisionId,
    properties: { name: 'Ontario', country: 'Canada', isoA3: 'CAN', region: 'Ontario' },
    geometry: { type: 'Polygon', coordinates: [[[0,0],[10,0],[10,10],[0,10],[0,0]]] }
  };
  const usState = {
    type: 'Feature', id: '06', properties: { name: 'California' },
    geometry: { type: 'Polygon', coordinates: [[[-125,30],[-113,30],[-113,42],[-125,42],[-125,30]]] }
  };
  const usCounty = {
    type: 'Feature', id: 6001, properties: { name: 'Alameda County' },
    geometry: usState.geometry
  };
  const usCountyFeatures = [usCounty];
  const zoomIdentity = { toString: () => 'translate(0,0) scale(1)' };
  context.d3 = {
    ...d3Geo,
    select: () => scratchSelection(),
    geoPath: () => feature => {
      generatedScratchPaths.push(feature);
      return `scratch-path-${feature.id || 'mesh'}`;
    },
    zoom: () => {
      const behavior = () => {};
      behavior.extent = () => behavior;
      behavior.scaleExtent = value => { behavior.scale = value; return behavior; };
      behavior.translateExtent = () => behavior;
      behavior.on = () => behavior;
      behavior.transform = () => {};
      return behavior;
    },
    zoomIdentity
  };
  context.worldSubdivisionFeature = subdivision;
  context.usSubdivisionState = usState;
  context.worldSubdivisionUsCounty = usCounty;
  vm.runInContext(`
    globalThis.subdivisionScratchSaved = {
      worldSubdivisionGeoJson, usaGeoJson, countyFeature: countyFeaturesById['CAN:ON-01'],
      countyGeoJson, usCountyFeature: countyFeaturesById['06001'],
      state: { ...AppState }, zoom: worldSubdivisionZoom, zoomBehavior: worldSubdivisionZoomBehavior,
      renderedDataset: renderedScratchDataset, renderedCountyFeatures, projection: scratchProjection,
      mapHeight: scratchMapHeight, commitLedger, refreshTravelUI, showNotification
    };
    worldSubdivisionGeoJson = [worldSubdivisionFeature];
    usaGeoJson = [usSubdivisionState];
    countyGeoJson = [worldSubdivisionUsCounty];
    countyFeaturesById['CAN:ON-01'] = worldSubdivisionFeature;
    countyFeaturesById['06001'] = worldSubdivisionUsCounty;
    AppState.scratchDataset = 'counties';
    AppState.currentTab = 'scratch';
    AppState.viewOnly = false;
    AppState.regions = {};
    AppState.counties = {};
    AppState.statusOverrides = { pins: {}, regions: {}, counties: {}, nationalParks: {} };
    commitLedger = change => {
      change();
      Object.assign(AppState.regions, AppState.statusOverrides.regions);
      Object.assign(AppState.counties, AppState.statusOverrides.counties);
    };
    refreshTravelUI = () => {};
    showNotification = () => {};
`, context);
  try {
    scratchNodes.length = 0;
    generatedScratchPaths.length = 0;
    element('btnScratchWorldSubdivisions').handlers.click();
    assert.equal(vm.runInContext('AppState.scratchDataset', context), 'subdivisions');
    assert.equal(vm.runInContext('worldSubdivisionZoomBehavior.scale.join(",")', context), '1,12');
    assert.ok(generatedScratchPaths.includes(subdivision));
    assert.ok(generatedScratchPaths.includes(usState));
    assert.ok(usCountyFeatures.every(feature => !generatedScratchPaths.includes(feature)));
    assert.equal(vm.runInContext('scratchStatusKey(usaGeoJson[0])', context), 's:California');
    assert.equal(vm.runInContext("scratchStatusKey(worldSubdivisionGeoJson[0])", context), `s:${subdivisionId}`);
    assert.equal(element('scratchStatsLabel').textContent, '0 / 2 Visited/Lived · 0 Transited');
    element('scratchCountySearch').value = 'Ontario';
    assert.equal(vm.runInContext('scratchCountyMatches("Ontario")[0].id', context), subdivisionId);
    vm.runInContext('cycleScratchStatus(worldSubdivisionGeoJson[0])', context);
    assert.equal(vm.runInContext(`AppState.statusOverrides.regions['s:${subdivisionId}']`, context), 'v');
    assert.equal(vm.runInContext(`AppState.regions['s:${subdivisionId}']`, context), 'v');
    assert.equal(vm.runInContext('scratchCountyMatches("California")[0].id', context), usState.id);
    assert.equal(vm.runInContext('scratchCountyMatches("Alameda").length', context), 0);
    vm.runInContext('cycleScratchStatus(usaGeoJson[0])', context);
    assert.equal(vm.runInContext("AppState.statusOverrides.regions['s:California']", context), 'v');
    assert.equal(vm.runInContext("AppState.regions['s:California']", context), 'v');
  } finally {
    context.d3 = previousD3;
    element('scratchCountySearch').value = searchValue;
    vm.runInContext(`
      worldSubdivisionGeoJson = subdivisionScratchSaved.worldSubdivisionGeoJson;
      usaGeoJson = subdivisionScratchSaved.usaGeoJson;
      if (subdivisionScratchSaved.countyFeature) countyFeaturesById['CAN:ON-01'] = subdivisionScratchSaved.countyFeature;
      else delete countyFeaturesById['CAN:ON-01'];
      countyGeoJson = subdivisionScratchSaved.countyGeoJson;
      if (subdivisionScratchSaved.usCountyFeature) countyFeaturesById['06001'] = subdivisionScratchSaved.usCountyFeature;
      else delete countyFeaturesById['06001'];
      Object.assign(AppState, subdivisionScratchSaved.state);
      worldSubdivisionZoom = subdivisionScratchSaved.zoom;
      worldSubdivisionZoomBehavior = subdivisionScratchSaved.zoomBehavior;
      renderedScratchDataset = subdivisionScratchSaved.renderedDataset;
      renderedCountyFeatures = subdivisionScratchSaved.renderedCountyFeatures;
      scratchProjection = subdivisionScratchSaved.projection;
      scratchMapHeight = subdivisionScratchSaved.mapHeight;
      commitLedger = subdivisionScratchSaved.commitLedger;
      refreshTravelUI = subdivisionScratchSaved.refreshTravelUI;
      showNotification = subdivisionScratchSaved.showNotification;
      delete globalThis.subdivisionScratchSaved;
`, context);
    delete context.worldSubdivisionFeature;
    delete context.usSubdivisionState;
  }
});
check('passport export filenames include local date and time, not UTC', () => {
  context.localExportDate = {
    getFullYear:()=>2026,getMonth:()=>0,getDate:()=>1,
    getHours:()=>0,getMinutes:()=>4,getSeconds:()=>9,
    toISOString(){throw new Error('export filenames must not use UTC');}
  };
  const captured=[];
  context.capturePassportExport=(payload,filename)=>captured.push(filename);
  try {
    assert.equal(vm.runInContext('localExportTimestamp(localExportDate)',context),'2026-01-01_00-04-09');
    vm.runInContext(`
      globalThis.savedExportFunctions={downloadJsonFile,localExportTimestamp};
      downloadJsonFile=capturePassportExport;
      localExportTimestamp=()=>savedExportFunctions.localExportTimestamp(localExportDate);
    `,context);
    element('btnExport').handlers.click();
    element('btnStorageExport').handlers.click();
    assert.deepEqual(captured,[
      'terra_incognita_passport_2026-01-01_00-04-09.json',
      'terra_incognita_passport_2026-01-01_00-04-09.json'
    ]);
  } finally {
    vm.runInContext(`
      ({downloadJsonFile,localExportTimestamp}=savedExportFunctions);
      delete globalThis.savedExportFunctions;
    `,context);
    delete context.localExportDate;
    delete context.capturePassportExport;
  }
});
check('land fog unwraps dateline rings and closes Antarctica along the Mercator floor', () => {
  const lines=[];
  let previous=null;
  context.tearPath={
    moveTo(x,y){previous=[x,y];},
    lineTo(x,y){lines.push([previous,[x,y]]);previous=[x,y];},
    closePath(){}
  };
  context.tearMap={
    project:([lat,lng])=>({x:lng,y:lat}),
    getZoom:()=>4
  };
  try {
    vm.runInContext(`
      globalThis.tearSavedMap=map;map=tearMap;
      traceLandFogPolygon({type:'Polygon',coordinates:[
        [[170,10],[170,30],[-170,30],[-170,10],[170,10]],
        [[175,15],[-175,15],[-175,25],[175,25],[175,15]]
      ]},tearPath,4);
    `,context);
    assert.ok(lines.length>0);
    assert.ok(lines.every(([a,b])=>Math.abs(a[0]-b[0])<=180 ||
      (Math.abs(a[1])>85 && Math.abs(b[1])>85)),
      'an unwrapped polygon must never connect across the ocean at nonpolar latitudes');
    assert.ok(lines.some(([a,b])=>a[0]>180 || b[0]>180),'dateline points must unwrap beyond 180');
    lines.length=0;
    vm.runInContext(`
      traceLandFogPolygon({type:'MultiPolygon',coordinates:[
        [[[ -170,10],[-170,30],[170,30],[170,10],[-170,10]]]
      ]},tearPath,4);
    `,context);
    assert.ok(lines.every(([a,b])=>Math.abs(a[0]-b[0])<=180));
    assert.ok(lines.some(([a,b])=>a[0]<-180 || b[0]<-180),'western dateline polygons must unwrap below -180');
    lines.length=0;
    vm.runInContext(`
      traceLandFogPolygon({type:'Polygon',coordinates:[
        [[-180,-80],[-60,-75],[60,-75],[180,-80],[-180,-80]]
      ]},tearPath,4);
    `,context);
    assert.ok(lines.length>0);
    assert.ok(lines.flat(2).every(Number.isFinite),'polar projection must remain finite');
    assert.ok(lines.some(([a,b])=>Math.abs(a[0]-b[0])===360 &&
      a[1]===-85.05112878 && b[1]===-85.05112878),'Antarctic seam must follow the Mercator floor');
    assert.ok(lines.every(([a,b])=>Math.abs(a[0]-b[0])<=180 ||
      (Math.abs(a[1])>85 && Math.abs(b[1])>85)));
  } finally {
    vm.runInContext('map=tearSavedMap;delete globalThis.tearSavedMap',context);
    delete context.tearPath;delete context.tearMap;
  }
});
check('land stencil normalizes shells and holes so overlapping atlases do not cancel coverage', () => {
  const rings=[];
  context.windingTarget={
    moveTo(x,y){rings.push([[x,y]]);},
    lineTo(x,y){rings.at(-1).push([x,y]);},
    closePath(){}
  };
  context.windingMap={project:([lat,lng])=>({x:lng,y:lat})};
  const windingAt=(x,y)=>rings.reduce((sum,ring)=>{
    for(let i=0;i<ring.length;i++) {
      const a=ring[i],b=ring[(i+1)%ring.length];
      const side=(b[0]-a[0])*(y-a[1])-(x-a[0])*(b[1]-a[1]);
      if(a[1]<=y && b[1]>y && side>0) sum++;
      if(a[1]>y && b[1]<=y && side<0) sum--;
    }
    return sum;
  },0);
  try {
    vm.runInContext(`
      globalThis.windingSavedMap=map;map=windingMap;
      const windingShell=[[0,0],[0,10],[10,10],[10,0],[0,0]];
      const windingHole=[[2,2],[2,4],[4,4],[4,2],[2,2]];
      traceLandFogPolygon({type:'Polygon',coordinates:[windingShell,windingHole]},windingTarget,4);
      traceLandFogPolygon({type:'Polygon',coordinates:[
        [...windingShell].reverse(),[...windingHole].reverse()
      ]},windingTarget,4);
    `,context);
    assert.equal(rings.length,4);
    assert.equal(windingAt(1,1),2,'overlapping land must reinforce, not cancel');
    assert.equal(windingAt(3,3),0,'holes must retain opposite winding');
    assert.equal(windingAt(20,20),0,'ocean outside the land must remain empty');
  } finally {
    vm.runInContext('map=windingSavedMap;delete globalThis.windingSavedMap',context);
    delete context.windingTarget;delete context.windingMap;
  }
});
check('Global Route Map renders country and expedition paths and toggles independently of the travel log', () => {
  const previousD3 = context.d3;
  const classLists = new Map();
  for (const id of ['travelGlobalRoutesPanel', 'travelLogFeed', 'btnExportRoutesPng']) {
    const state = { hidden: true };
    const classList = {
      toggle(name, force) {
        if (name === 'hidden') state.hidden = force === undefined ? !state.hidden : force;
        return state.hidden;
      },
      contains(name) { return name === 'hidden' && state.hidden; }
    };
    classLists.set(id, { state, classList, original: element(id).classList });
    element(id).classList = classList;
  }
  const toggleAttributes = {};
  const toggle = element('btnToggleTravelRoutes');
  const originalSetAttribute = toggle.setAttribute;
  toggle.setAttribute = (name, value) => { toggleAttributes[name] = value; };
  const zoomIdentity = { toString: () => 'translate(0,0) scale(1)' };
  context.d3 = {
    ...d3Geo,
    select: () => ({
      call(callback, ...args) { callback(this, ...args); return this; },
      select: () => ({ attr() { return this; } })
    }),
    zoom: () => {
      const behavior = () => {};
      behavior.scaleExtent = () => behavior;
      behavior.on = () => behavior;
      behavior.transform = () => {};
      return behavior;
    },
    zoomIdentity,
    zoomTransform: () => zoomIdentity
  };
  vm.runInContext(`
    globalThis.routeMapTestSaved = {
      expeditions: AppState.expeditions, homeBase: AppState.homeBase, worldGeoJson,
      open: globalRoutesOpen, zoom: globalRoutesZoomBehavior
    };
    worldGeoJson = [{
      type: 'Feature', properties: { name: 'Example Nation' },
      geometry: { type: 'Polygon', coordinates: [[[-160,-55],[-160,70],[165,70],[165,-55],[-160,-55]]] }
    }];
    AppState.homeBase = { name: 'Test Base', lat: 0, lng: 0 };
    AppState.expeditions = [{
      id: 'global-route-test', name: 'Atlantic Flight', startDate: '2026-06-01',
      endDate: '2026-06-02', transitTags: ['flight'], purposeTags: [],
      countyIds: [], parkIds: [], customPoiIds: [],
      routeStops: [
        { kind: 'place', name: 'New York', coords: [40.7,-74] },
        { kind: 'place', name: 'London', coords: [51.5,-0.1] }
      ],
      routeCoords: [[40.7,-74],[51.5,-0.1]],
      routeLegs: [{
        mode: 'flight', routeSource: 'direct',
        routeCoords: [[40.7,-74],[51.5,-0.1]]
      }]
    }];
    globalRoutesOpen = false;
  `, context);
  try {
    toggle.handlers.click();
    const svg = element('svgGlobalRoutesMap').innerHTML;
    assert.match(svg, /class="global-country"/);
    assert.match(svg, /class="global-route"/);
    assert.match(svg, /stroke="#38bdf8"/);
    assert.match(svg, /stroke-dasharray="6 5"/);
    assert.equal(classLists.get('travelGlobalRoutesPanel').state.hidden, false);
    assert.equal(classLists.get('travelLogFeed').state.hidden, true);
    assert.equal(classLists.get('btnExportRoutesPng').state.hidden, false);
    assert.equal(toggleAttributes['aria-expanded'], 'true');
    assert.equal(toggleAttributes['aria-pressed'], 'true');
    toggle.handlers.click();
    assert.equal(classLists.get('travelGlobalRoutesPanel').state.hidden, true);
    assert.equal(classLists.get('travelLogFeed').state.hidden, false);
    assert.equal(classLists.get('btnExportRoutesPng').state.hidden, true);
    assert.equal(toggleAttributes['aria-expanded'], 'false');
    assert.equal(toggleAttributes['aria-pressed'], 'false');
  } finally {
    for (const [id, entry] of classLists) element(id).classList = entry.original;
    toggle.setAttribute = originalSetAttribute;
    context.d3 = previousD3;
    vm.runInContext(`
      AppState.expeditions = routeMapTestSaved.expeditions;
      AppState.homeBase = routeMapTestSaved.homeBase;
      worldGeoJson = routeMapTestSaved.worldGeoJson;
      globalRoutesOpen = routeMapTestSaved.open;
      globalRoutesZoomBehavior = routeMapTestSaved.zoom;
      delete globalThis.routeMapTestSaved;
    `, context);
  }
});
console.log(`${checks} checks passed.`);
