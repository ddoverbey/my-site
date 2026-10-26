import assert from 'node:assert/strict';
import ledger from './travel-ledger.js';
import lookups from './coordinate-lookups.js';
import catalog from './nps-catalog.js';
import characterCreator from './character-creator.js';
import { readFile } from 'node:fs/promises';
import * as d3 from 'd3-geo';
import * as topojson from 'topojson-client';

let checks = 0;
function check(name, action) {
  action();
  checks++;
  console.log(`PASS ${name}`);
}
const poi = {
  id: 'poi_test', name: 'Spirit Falls', lat: 45.7279, lng: -121.6358, status: 'v',
  elevationFt: 630, biomes: ['5'], country: 'United States of America', state: 'Washington',
  countyId: '53059', rarityTier: 'Hidden Gem', reviewCount: null
};
const exp = {
  id: 'exp_test', name: 'Aspen Anniversary Drive', startDate: '2026-09-10', endDate: '2026-09-15',
  transitTags: ['awd', 'flight'],
  countyIds: ['08065', '08097'], parkIds: ['romo'], customPoiIds: [],
  routeCoords: [[39.24, -106.29], [39.19, -106.81]], minElevationFt: 5280, maxElevationFt: 12095
};
const photo = 'data:image/jpeg;base64,YWJjZA==';
const migrate = state => ledger.migrateState(state, lookups, catalog);
check('character selections survive passport migration with safe catalog defaults', () => {
  const state = ledger.migrateState({
    character: {
      hairColor: 'teal', outfit: 'outfit_parka', pet: 'pet_kitten_gray',
      purchasedItems: ['pet_black_cat'], unsafe: true
    }
  }, lookups, catalog, characterCreator.normalizeCharacter);
  assert.equal(state.character.hairColor, 'teal');
  assert.equal(state.character.outfit, 'outfit_parka');
  assert.equal(state.character.pet, 'pet_black_cat');
  assert.deepEqual(state.character.purchasedItems, ['pet_black_cat']);
  assert.equal(Object.hasOwn(state.character, 'unsafe'), false);
  assert.equal(Object.hasOwn(state.extraPassportFields, 'character'), false);
});
check('legacy purpose tags are discarded while location categories remain', () => {
  const state = migrate({
    customPois: [{ ...poi, purposeTags: ['photography'] }],
    expeditions: [{ ...exp, purposeTags: ['photography', 'anniversary'] }]
  });
  assert.equal(Object.hasOwn(state.customPois[0], 'purposeTags'), false);
  assert.equal(Object.hasOwn(state.expeditions[0], 'purposeTags'), false);
});
check('journals and embedded photos survive Passport round-trips without changing legacy trips', () => {
  const trip = { ...exp, journal: 'A detour worth remembering.\nBack next summer!', photos: [photo] };
  const state = migrate({ expeditions: [trip] });
  assert.deepEqual(state.expeditions, [trip]);
  assert.deepEqual(migrate(JSON.parse(JSON.stringify(state))), state);
  assert.deepEqual(ledger.validateExpeditions([exp], lookups), [exp]);
  const normalized = ledger.validateExpeditions([trip], lookups)[0];
  normalized.photos.pop();
  assert.equal(trip.photos.length, 1, 'normalized photos do not alias input arrays');
});
check('journal validation enforces bounded text and portable JPEG photos', () => {
  const photo = 'data:image/jpeg;base64,YWJjZA==';
  assert.equal(ledger.validateJournal('x'.repeat(ledger.journalLimits.text), [photo]).photos.length, 1);
  for (const journal of [null, {}, 'x'.repeat(ledger.journalLimits.text + 1)]) {
    assert.throws(() => ledger.validateExpeditions([{ ...exp, journal }], lookups), /Journal entries/);
  }
  for (const photos of [null, 'not an array', Array(5).fill(photo), ['https://example.com/photo.jpg'],
    ['data:image/svg+xml;base64,YWJjZA=='], ['data:image/jpeg;base64,not base64'],
    ['data:image/jpeg;base64,' + 'A'.repeat(ledger.journalLimits.photoCharacters)]]) {
    assert.throws(() => ledger.validateExpeditions([{ ...exp, photos }], lookups), /compressed JPEG/);
  }
  assert.equal(ledger.validateJournal('', Array(4).fill(photo)).photos.length, 4);
});
check('promotion respects every tier pair and rejects invalid tiers', () => {
  for (const [current, rank] of Object.entries(ledger.ranks)) {
    for (const [next, nextRank] of Object.entries(ledger.ranks)) {
      assert.equal(ledger.promote(current, next), rank > nextRank ? current : next);
    }
  }
  assert.throws(() => ledger.promote('v', 'toString'), /Invalid/);
});
check('transit reveals fog but never counts as visited; lived grants full credit', () => {
  assert.equal(ledger.clearsFog('t'), true);
  assert.equal(ledger.isVisited('t'), false);
  assert.equal(ledger.clearsFog('w'), false);
  assert.equal(ledger.isVisited('l'), true);
});
check('combined NPS alias migration keeps the highest rank independent of ordering', () => {
  assert.deepEqual(catalog.migratePins({ sequoia: 'l', kingscanyon: 'v', seki: 'w' }), { seki: 'l' });
  assert.deepEqual(catalog.migratePins({ seki: 'w', kingscanyon: 'v', sequoia: 'l' }), { seki: 'l' });
});
check('legacy county booleans become visited without losing lived tiers, routes or polygons', () => {
  const state = migrate({
    clearedCounties: { '06073': true, '06065': true, '06001': false }, counties: { '06065': 'l' },
    routes: [[[1, 1], [2, 2]]], clearedPolygons: [{ type: 'Polygon', coordinates: [] }]
  });
  assert.deepEqual(state.counties, { '06065': 'l', '06073': 'v' });
  assert.equal(state.routes.length, 1);
  assert.equal(state.clearedPolygons.length, 1);
  assert.deepEqual(state.customPois, []);
  assert.deepEqual(state.expeditions, []);
  assert.equal(state.clearedCounties, undefined);
});
check('flat schema POIs retain fields while gaining political metadata; migration is idempotent', () => {
  const state = migrate({ version: 2, customPois: [poi], expeditions: [exp] });
  assert.equal(state.customPois[0].elevationFt, 630);
  assert.equal(state.customPois[0].rarityTier, 'Hidden Gem');
  assert.equal(state.customPois[0].reviewCount, null);
  assert.equal(state.customPois[0].countyId, '53059');
  assert.deepEqual(migrate(state), state);
  assert.deepEqual(JSON.parse(JSON.stringify(state)).expeditions, [exp]);
});
check('custom POIs with missing biome metadata normalize and count safely', () => {
  const poiWithoutBiomes = { ...poi };
  delete poiWithoutBiomes.biomes;
  const state = migrate({ customPois: [poiWithoutBiomes] });
  assert.deepEqual(state.customPois[0].biomes, []);
  delete state.customPois[0].biomes;
  delete state.customPois[0].political;
  assert.doesNotThrow(() => ledger.metadataProgress(state));
});
check('unknown top-level and nested passport fields survive migration and later migrations', () => {
  const state = migrate({
    version: 2,
    futureFeature: { enabled: true, level: 3 },
    extraPassportFields: { anotherFutureFeature: ['kept', 'intact'] }
  });
  assert.deepEqual(state.futureFeature, { enabled: true, level: 3 });
  assert.deepEqual(state.extraPassportFields, {
    anotherFutureFeature: ['kept', 'intact'],
    futureFeature: { enabled: true, level: 3 }
  });
  assert.deepEqual(migrate(JSON.parse(JSON.stringify(state))), state);
});
check('Photon city POIs persist without fabricated elevation or rarity metadata', () => {
  const city = {
    id: 'poi_photon_node_1234', photonId: 'node:1234', source: 'Photon',
    name: 'Sitka', lat: 57.053, lng: -135.33, status: 'w', category: 'City',
    political: {
      countries: ['United States of America'], states: ['Alaska'],
      counties: [{ id: '02220', name: 'Sitka City and Borough' }]
    },
    ecoregions: [{ id: 1, name: 'Pacific Coastal Mountains', realm: 'Nearctic', biomeId: 5 }],
    biomes: ['5'], biomeStatus: 'matched', lookedUpAt: '2026-10-15T00:00:00Z'
  };
  const state = migrate({ version: 2, customPois: [city] });
  assert.equal(state.customPois[0].elevationFt, null);
  assert.equal(state.customPois[0].rarity, null);
  assert.equal(state.customPois[0].category, 'City');
  assert.deepEqual(migrate(state), state);
  assert.throws(() => migrate({ version: 2, customPois: [{ ...city, photonId: 'invalid' }] }), /Photon place reference/);
});
check('legacy enriched custom locations retain exact provider metadata in customPois', () => {
  const legacy = {
    ...poi, id: 'custom-old', elevation: { meters: 100, feet: 328.084 },
    political: { countries: ['Italy'], states: [], counties: [] },
    biomes: ['12'], ecoregions: [{ id: 1, name: 'Mediterranean forest', realm: 'Palearctic', biomeId: 12 }],
    biomeStatus: 'matched', lookedUpAt: '2026-10-01T00:00:00Z',
    reviewCount: 24,
    rarity: { method: 'osm-poi-density', nearbyPoiCount: 19, category: 'Hidden Gem', nearestHighwayKm: null }
  };
  const migrated = migrate({ customLocations: [legacy] });
  assert.equal(migrated.customPois[0].id, legacy.id);
  assert.equal(migrated.customPois[0].elevationFt, 328.084);
  assert.equal(migrated.customPois[0].rarity.popularityScore, 19);
  assert.equal(migrated.customPois[0].rarity.reviewCount, null);
  assert.equal(migrated.customPois[0].reviewCount, null);
  assert.equal(migrated.customLocations, undefined);
  assert.deepEqual(migrate(migrated), migrated);
});
check('malformed and future saves reject before mutating input', () => {
  for (const state of [
    { version: 3 }, { counties: { '6073': 'v' } }, { pins: { yose: 'bad' } },
    { regions: { 's:California': 'toString' } }, { clearedCounties: { '06073': 'yes' } },
    { customPois: [poi, poi] }, { customPois: [{ ...poi, lat: 91 }] },
    { customPois: [{ ...poi, elevationFt: '630' }] },
    { customPois: [{ ...poi, rarityTier: 'fake' }] }, { homeBase: { name: 'Home', lat: 91, lng: 0 } }
  ]) {
    const before = JSON.stringify(state);
    assert.throws(() => migrate(state));
    assert.equal(JSON.stringify(state), before);
  }
});
check('date validation handles day trips, leap days, invalid days and reversed ranges', () => {
  assert.equal(ledger.validateExpeditions([{ ...exp, endDate: exp.startDate }], lookups).length, 1);
  assert.equal(ledger.validateExpeditions([{ ...exp, startDate: '2024-02-29', endDate: '2024-02-29' }], lookups).length, 1);
  for (const change of [
    { startDate: '2026-02-29' }, { endDate: '2026-09-09' }, { startDate: 'not-a-date' }, { name: '' },
    { routeCoords: [[91, 0]] }, { minElevationFt: 12000, maxElevationFt: 10000 },
    { transitTags: ['awd', 'awd'] },
    { countyIds: [], parkIds: [], customPoiIds: [] }, { countyIds: ['08065', '08065'] }
  ]) assert.throws(() => ledger.validateExpeditions([{ ...exp, ...change }], lookups));
});
check('international subdivision IDs validate in county ledgers, POIs, trips and derived country status', () => {
  const subdivisionId = 'FRA:FR75';
  const internationalPoi = {
    ...poi, id: 'poi_paris', status: 'v',
    political: {
      countries: ['France'], states: [], admin1: [{ id: subdivisionId, name: 'Paris' }],
      counties: [{ id: subdivisionId, name: 'Paris' }]
    }
  };
  const routeCoords = [[48.85, 2.35], [48.86, 2.36]];
  const trip = {
    ...exp, countyIds: [subdivisionId], transitTags: ['road'], routeCoords,
    routeStops: [
      { kind: 'county', id: subdivisionId, name: 'Paris', coords: routeCoords[0] },
      { kind: 'place', id: 'paris_destination', name: 'Paris destination', coords: routeCoords[1] }
    ],
    routeLegs: [{
      mode: 'road', routeSource: 'routed', routeCoords,
      countyIds: [subdivisionId]
    }]
  };
  const state = migrate({
    counties: { [subdivisionId]: 'v' },
    statusOverrides: { counties: { [subdivisionId]: 'w' } },
    customPois: [internationalPoi], expeditions: [trip]
  });
  assert.equal(state.counties[subdivisionId], 'v');
  assert.equal(state.statusOverrides.counties[subdivisionId], 'w');
  assert.deepEqual(state.customPois[0].political.counties, [{ id: subdivisionId, name: 'Paris' }]);
  assert.deepEqual(state.customPois[0].political.admin1, [{ id: subdivisionId, name: 'Paris' }]);
  assert.deepEqual(state.expeditions[0].countyIds, [subdivisionId]);
  assert.deepEqual(state.expeditions[0].routeLegs[0].countyIds, [subdivisionId]);
  ledger.syncDerivedState(state, {
    countyRegions: { [subdivisionId]: { countries: ['France'], states: [], counties: [] } }
  });
  assert.equal(state.regions['c:France'], 'v');
  assert.equal(state.regions[`s:${subdivisionId}`], 'v');
  for (const invalidId of ['FRA:Paris 1', 'frA:FR75', 'FRA:', 'FRA:FR/75']) {
    assert.throws(() => migrate({ counties: { [invalidId]: 'v' } }));
  }
});
check('derived route-region promotion bounds geography lookups for dense road tracks', () => {
  const state = migrate({ expeditions: [exp] });
  state.expeditions[0].routeLegs = [{
    mode: 'road',
    routeCoords: Array.from({ length: 20000 }, (_, index) => [45, -125 + index / 10000]),
    countyIds: []
  }];
  let politicalLookups = 0;
  ledger.syncDerivedState(state, {
    politicalAt: () => {
      politicalLookups++;
      return { countries: ['Canada'], states: [], admin1: [{ id: 'CAN:ON' }], counties: [] };
    }
  });
  assert.ok(politicalLookups <= 66, `expected at most 66 lookups, got ${politicalLookups}`);
  assert.equal(state.regions['c:Canada'], 'v');
  assert.equal(state.regions['s:CAN:ON'], 'v');
});
check('missing POI references and conflicting ledgers reject explicitly', () => {
  assert.throws(() => migrate({ expeditions: [{ ...exp, customPoiIds: ['poi_missing'] }] }), /missing custom/);
});
check('expeditions promote parks, POIs, counties and parent regions without downgrading lived records', () => {
  const state = migrate({
    pins: { romo: 'l' }, counties: { '08065': 'l' }, regions: { 's:Colorado': 'l' },
    customPois: [{ ...poi, status: 'w' }], expeditions: [{ ...exp, customPoiIds: [poi.id] }]
  });
  ledger.syncDerivedState(state, {
    parks: [{ id: 'romo', states: ['Colorado'] }],
    countyRegions: {
      '08065': { countries: ['United States of America'], states: ['Colorado'] },
      '08097': { countries: ['United States of America'], states: ['Colorado'] }
    }
  });
  assert.equal(state.pins.romo, 'l');
  assert.equal(state.counties['08065'], 'l');
  assert.equal(state.counties['08097'], 'v');
  assert.equal(state.regions['s:Colorado'], 'l');
  assert.equal(state.customPois[0].status, 'v');
  assert.equal(state.counties['53059'], 'v');
  assert.equal(state.regions['s:Washington'], 'v');
  const before = JSON.stringify(state);
  ledger.syncDerivedState(state);
  assert.equal(JSON.stringify(state), before);
});
check('fog county derivation ignores manual tiers and leaves the passport unchanged', () => {
  const state = migrate({
    counties: { '06001': 'v', '06013': 't', '06041': 'l', '06075': 'w' },
    customPois: [{ ...poi, status: 'w' }],
    expeditions: [{ ...exp, customPoiIds: [poi.id] }],
    pins: { park: 't', wish: 'w' },
    homeBase: { name: 'Home', lat: 33, lng: -117, radiusKm: 80, countyId: '06073' }
  });
  const before = JSON.stringify(state);
  const result = ledger.loggedCountyStatuses(state, {
    parks: [{ id: 'park', lat: 40, lng: -120 }, { id: 'wish', lat: 40, lng: -120 }],
    politicalAt: lat => lat === 40 ? { counties: [{ id: '06065' }] } : null
  });
  assert.deepEqual(result, { '08065': 'v', '08097': 'v', '06065': 't', '53059': 'v', '06073': 'l' });
  assert.equal(JSON.stringify(state), before);
});
check('logged county derivation uses home containment and POI tiers without manual rank promotion', () => {
  const state = migrate({
    counties: { '53059': 'l' }, customPois: [{ ...poi, status: 't' }],
    homeBase: { name: 'Home', lat: 33, lng: -117, radiusKm: 80 }
  });
  const before = JSON.stringify(state);
  assert.deepEqual(ledger.loggedCountyStatuses(state, {
    politicalAt: () => ({ counties: [{ id: '06073' }] })
  }), { '53059': 't', '06073': 'l' });
  assert.equal(JSON.stringify(state), before);
});
check('home migration normalizes existing radii to an exact 15-mile diameter without mutating input', () => {
  for (const radiusKm of [75, 80, 12]) {
    const homeBase = { name: 'Home', lat: 33.55, lng: -117.2, radiusKm, countyId: '06073' };
    const state = migrate({ homeBase, counties: { '06073': 'l' } });
    assert.equal(state.homeBase.radiusKm * 2 / 1.609344, 15);
    assert.equal(state.homeBase.countyId, '06073');
    assert.equal(state.counties['06073'], 'l');
    assert.equal(homeBase.radiusKm, radiusKm);
    assert.deepEqual(migrate(state), state);
  }
});
check('home-only counties do not reveal polygons but an expedition can explore that same county', () => {
  const state = migrate({
    homeBase: { name: 'Home', lat: 33.55, lng: -117.2, radiusKm: 80, countyId: '06073' }
  });
  ledger.syncDerivedState(state);
  assert.equal(state.counties['06073'], 'l');
  assert.deepEqual(ledger.loggedCountyStatuses(state), { '06073': 'l' });
  assert.deepEqual(ledger.loggedCountyStatuses(state, { includeHome: false }), {});
  state.expeditions = [{ ...exp, countyIds: ['06073'] }];
  const before = JSON.stringify(state);
  assert.deepEqual(ledger.loggedCountyStatuses(state, { includeHome: false }), { '06073': 'v' });
  assert.equal(JSON.stringify(state), before);
});
check('home growth requires logged travel, not home, wishlist or manually marked regions', () => {
  const baseline = {
    homeBase: { name: 'Home', lat: 33.55, lng: -117.2, radiusKm: 80, countyId: '06073' },
    counties: { '06073': 'l', '08065': 'v' }, regions: { 's:Colorado': 'l' },
    pins: { romo: 'w' }, customPois: [{ ...poi, status: 'w' }]
  };
  assert.equal(ledger.hasLoggedTravel(migrate(baseline)), false);
  for (const status of ['t', 'v', 'l']) {
    assert.equal(ledger.hasLoggedTravel(migrate({ ...baseline, pins: { romo: status } })), true);
    assert.equal(ledger.hasLoggedTravel(migrate({ ...baseline, customPois: [{ ...poi, status }] })), true);
  }
  for (const change of [
    { expeditions: [exp] }, { routes: [[[1, 1], [2, 2]]] },
    { clearedPolygons: [{ type: 'Polygon', coordinates: [] }] }
  ]) assert.equal(ledger.hasLoggedTravel(migrate({ ...baseline, ...change })), true);
  assert.equal(ledger.hasLoggedTravel(migrate({})), false);
});
check('home containment marks county, state and country lived and retains previous homes', () => {
  const state = migrate({ homeBase: { name: 'Home', lat: 33.55, lng: -117.2, radiusKm: 75 } });
  const political = { countries: ['United States of America'], states: ['California'], counties: [{ id: '06065', name: 'Riverside' }] };
  ledger.syncDerivedState(state, { politicalAt: () => political });
  assert.equal(state.homeBase.countyId, '06065');
  assert.equal(state.counties['06065'], 'l');
  assert.equal(state.regions['s:California'], 'l');
  assert.equal(state.regions['c:United States of America'], 'l');
  ledger.syncDerivedState(state, { politicalAt: () => ({ ...political, counties: [{ id: '06073', name: 'San Diego' }] }) });
  assert.equal(state.counties['06065'], 'l');
  assert.equal(state.counties['06073'], 'l');
});
check('achievement metadata uses inclusive high-altitude and strict below-sea thresholds for terrestrial full visits', () => {
  const state = migrate({ customPois: [
    { ...poi, id: 'poi_zero', elevationFt: 0 }, { ...poi, id: 'poi_low', elevationFt: -1 },
    { ...poi, id: 'poi_ocean', elevationFt: -50, biomes: [] },
    { ...poi, id: 'poi_high', elevationFt: 10001 }, { ...poi, id: 'poi_edge', elevationFt: 10000 },
    { ...poi, id: 'poi_transit', elevationFt: -1, status: 't' },
    { ...poi, id: 'poi_wish', elevationFt: 10001, status: 'w' },
    { ...poi, id: 'poi_lived', elevationFt: -1, status: 'l' }
  ] });
  const progress = ledger.metadataProgress(state);
  assert.equal(progress.subterranean, 2);
  assert.equal(progress.thinAir, 2);
  assert.equal(progress.whispers, 6);
  assert.equal(progress.focal, 0);
});
check('coin metadata includes visited custom-place rarity and region/county IDs', () => {
  const state = migrate({
    customPois: [{ ...poi, id: 'coin-poi', status: 'l' }],
    regions: { 's:Washington': 'l' },
    counties: { '01001': 'v' },
    expeditions: [{ ...exp, countyIds: ['08065'] }]
  });
  const progress = ledger.metadataProgress(state);
  assert.deepEqual(progress.rarityEntities, [
    { key: 'poi:coin-poi', kind: 'poi', tier: 'Hidden Gem' }
  ]);
  assert.ok(progress.visitedSubdivisionIds.includes('Washington'));
  assert.ok(progress.visitedCountyIds.includes('01001'));
  assert.ok(progress.visitedCountyIds.includes('08065'));
});
check('expedition biome credit samples route geometry between stops with a bounded lookup count', () => {
  const state = migrate({ expeditions: [{
    ...exp,
    transitTags: ['road'],
    routeCoords: [[0, 0], [0, 1]],
    routeStops: [
      { kind: 'place', id: 'route_start', name: 'Route Start', coords: [0, 0] },
      { kind: 'place', id: 'route_end', name: 'Route End', coords: [0, 1] }
    ],
    routeLegs: [{
      mode: 'road', routeSource: 'uploaded', routeCoords: [[0, 0], [0, 180], [0, 1]], countyIds: []
    }]
  }] });
  let biomeLookups = 0;
  const progress = ledger.metadataProgress(state, {
    biomeAt: (lat, lng) => {
      biomeLookups++;
      return Math.abs(lat) < 1 && lng > 49.5 && lng < 50.5 ? ['middle-of-route'] : [];
    }
  });
  assert.ok(progress.collectedBiomes.has('middle-of-route'));
  assert.deepEqual(progress.biomesByExpedition.exp_test, ['middle-of-route']);
  assert.ok(biomeLookups > 400, 'densely samples this long route within the configured ceiling');
  assert.ok(biomeLookups <= 502, 'caps expensive route lookups plus the two stops');
});
check('biome pins connect logged locations, trip stops, and their contributing expeditions', () => {
  const state = migrate({
    pins: { yose: 'v' },
    customPois: [{ ...poi, id: 'poi_pin', name: 'Falls Viewpoint', status: 'v', biomes: ['5'] }],
    expeditions: [{
      ...exp, id: 'pin_trip', name: 'Forest Weekend', parkIds: ['yose'], customPoiIds: ['poi_pin'],
      routeCoords: [[0, 0]], transitTags: ['road'],
      routeStops: [{ kind: 'place', id: 'trailhead', name: 'Forest Trailhead', coords: [0, 0] }]
    }]
  });
  const progress = ledger.metadataProgress(state, {
    parks: [{ id: 'yose', name: 'Yosemite', lat: 37, lng: -119, biomes: ['5'] }],
    biomeAt: lat => lat === 0 ? ['5'] : []
  });
  assert.deepEqual(progress.biomePins['5'], {
    locations: [
      { kind: 'park', id: 'yose', name: 'Yosemite' },
      { kind: 'poi', id: 'poi_pin', name: 'Falls Viewpoint' },
      { kind: 'place', id: 'pin_trip:trailhead', name: 'Forest Trailhead', tripId: 'pin_trip' }
    ],
    trips: ['pin_trip']
  });
});
check('flight and ferry routes do not credit transit biomes while land stops and roads do', () => {
  const state = migrate({ expeditions: [{
    ...exp,
    transitTags: ['flight', 'road'],
    routeCoords: [[0, 0], [0, 1], [0, 2]],
    routeStops: [
      { kind: 'place', id: 'airport', name: 'Airport Stop', coords: [0, 0] },
      { kind: 'place', id: 'road_start', name: 'Road Start', coords: [0, 1] },
      { kind: 'place', id: 'road_end', name: 'Road End', coords: [0, 2] }
    ],
    routeLegs: [
      { mode: 'flight', routeSource: 'none', routeCoords: [], countyIds: [] },
      { mode: 'road', routeSource: 'uploaded', routeCoords: [[0, 1], [0, 1.5], [0, 2]], countyIds: [] }
    ]
  }] });
  state.pins.falls_park = 'v';
  const progress = ledger.metadataProgress(state, {
    biomeAt: (lat, lng) => {
      if (lat !== 0) return [];
      if (lng === 0) return ['airport-stop-biome'];
      if (lng > 0.3 && lng < 0.34) return ['overflight-biome'];
      if (lng > 1.3 && lng < 1.34) return ['road-route-biome'];
      return [];
    }
  });
  assert.ok(progress.collectedBiomes.has('airport-stop-biome'));
  assert.ok(progress.biomesByExpedition.exp_test.includes('road-route-biome'));
  assert.ok(!progress.collectedBiomes.has('overflight-biome'));

  for (const mode of ['flight', 'ferry']) {
    const legacyTrip = migrate({ expeditions: [{
      ...exp, transitTags: [mode], routeCoords: [[0, 0], [0, 0.5], [0, 1]]
    }] });
    const legacyProgress = ledger.metadataProgress(legacyTrip, {
      biomeAt: (lat, lng) => lat === 0 && lng > 0.3 && lng < 0.34 ? ['transit-biome'] : []
    });
    assert.ok(!legacyProgress.collectedBiomes.has('transit-biome'), `${mode} route geometry is not land visitation`);
  }
});
check('expedition biome sampling catches a biome on a route shorter than the previous sample interval', () => {
  const state = migrate({ expeditions: [{
    ...exp,
    transitTags: ['road'],
    routeCoords: [[0, 0], [0, 0.35]],
    routeStops: [
      { kind: 'place', id: 'route_start', name: 'Route Start', coords: [0, 0] },
      { kind: 'place', id: 'route_end', name: 'Route End', coords: [0, 0.35] }
    ],
    routeLegs: [{
      mode: 'road', routeSource: 'uploaded', routeCoords: [[0, 0], [0, 0.35]], countyIds: []
    }]
  }] });
  const sampledCoordinates = [];
  const progress = ledger.metadataProgress(state, {
    biomeAt: (lat, lng) => {
      sampledCoordinates.push([lat, lng]);
      return lng > 0.3 && lng < 0.34 ? ['short-route-biome'] : [];
    }
  });
  assert.ok(progress.biomesByExpedition.exp_test.includes('short-route-biome'));
  assert.ok(sampledCoordinates.length > 2, 'adds an interior lookup on a roughly 24-mile route');
});
check('adding a long expedition does not change biome samples or credit on an existing short route', () => {
  const routeTrip = (id, coords) => ({
    ...exp, id, transitTags: ['road'], parkIds: [], customPoiIds: [], countyIds: [],
    routeCoords: coords,
    routeStops: coords.map((point, index) => ({
      kind: 'place', id: `${id}_stop_${index}`, name: `${id} stop ${index}`, coords: point
    })),
    routeLegs: [{
      mode: 'road', routeSource: 'uploaded', routeCoords: coords, countyIds: []
    }]
  });
  const shortTrip = routeTrip('short_route', [[0, 0], [0, 0.35]]);
  const longTrip = routeTrip('long_route', [[0, 0], [0, 179]]);
  const collect = trips => ledger.metadataProgress(migrate({ expeditions: trips }), {
    biomeAt: (lat, lng) => lat < 1 && lng > 0.3 && lng < 0.34 ? ['short-route-biome'] : []
  }).biomesByExpedition.short_route;
  assert.ok(collect([shortTrip]).includes('short-route-biome'));
  assert.ok(collect([shortTrip, longTrip]).includes('short-route-biome'));
});
check('trip achievements count logged expeditions and uploaded photos', () => {
  const state = migrate({
    customPois: [poi],
    expeditions: Array.from({ length: 5 }, (_, index) => ({
      ...exp, id: `exp_${index}`, transitTags: index < 3 ? ['awd', 'ferry'] : ['awd'],
      photos: index === 0 ? [photo, photo] : [],
      countyIds: index === 0 ? ['08065', '08097', '08001', '08003', '08005'] : exp.countyIds
    }))
  });
  let progress = ledger.metadataProgress(state);
  assert.equal(progress.overlander, 6);
  assert.equal(progress.mariner, 3);
  assert.equal(progress.focal, 2);
  assert.equal(progress.borderlands, undefined);
  state.expeditions.push(...Array.from({ length: 4 }, (_, index) => ({
    ...exp, id: `exp_extra_${index}`, photos: [photo]
  })));
  progress = ledger.metadataProgress(state);
  assert.equal(progress.focal, 6);
  assert.equal(progress.overlander, 6);
});
check('waterfall progress passively classifies visited locations and deduplicates trip stops', () => {
  const state = migrate({ customPois: [
    { ...poi, id: 'poi_falls_visit', category: 'waterfall' },
    { ...poi, id: 'poi_falls_home', category: ' WaterFall ', status: 'l' },
    { ...poi, id: 'poi_falls_transit', category: 'waterfall', status: 't' },
    { ...poi, id: 'poi_falls_wish', category: 'waterfall', status: 'w' },
    { ...poi, id: 'poi_falls_other', category: 'waterfall viewpoint' },
    { ...poi, id: 'poi_falls_name', name: 'Hidden Waterfall' },
    { ...poi, id: 'poi_falls_none' }
  ], expeditions: [{
    ...exp, id: 'exp_falls', parkIds: ['falls_park'], customPoiIds: ['poi_falls_visit'],
    routeCoords: [[45.7, -121.6], [45.8, -121.7], [45.8, -121.7]],
    routeStops: [
      { kind: 'park', id: 'falls_park', name: 'Waterfall National Park', coords: [45.7, -121.6] },
      { kind: 'poi', id: 'poi_falls_visit', name: 'Waterfall POI', coords: [45.8, -121.7] },
      { kind: 'place', id: 'place_falls', name: 'Waterfall Overlook', coords: [45.8, -121.7] }
    ]
  }] });
  const progress = ledger.metadataProgress(state, {
    parks: [{ id: 'falls_park', name: 'Waterfall National Park', biomes: [] }]
  });
  assert.equal(progress.waterfalls, 6);
  for (const count of [1, 5, 10]) {
    const countProgress = ledger.metadataProgress(migrate({
      customPois: Array.from({ length: count }, (_, i) => ({ ...poi, id: `poi_waterfall_${i}`, category: 'waterfall' }))
    }));
    assert.equal(countProgress.waterfalls, count);
  }
});
check('AWD locations deduplicate across trips while Water Transit counts individual trips at exact goals', () => {
  const trip = {
    ...exp, countyIds: ['08001', '08003', '08005', '08007'], parkIds: ['romo'],
    transitTags: ['awd', 'ferry']
  };
  const state = migrate({ expeditions: [{ ...trip, id: 'trip_one' }, { ...trip, id: 'trip_two' }] });
  assert.equal(ledger.transitTags.ferry, 'Water Transit');
  let progress = ledger.metadataProgress(state);
  assert.equal(progress.overlander, 5);
  assert.equal(progress.mariner, 2);
  state.expeditions.push({ ...trip, id: 'trip_three' });
  progress = ledger.metadataProgress(state);
  assert.equal(progress.overlander, 5);
  assert.equal(progress.mariner, 3);
  state.expeditions.forEach(expedition => { expedition.countyIds = expedition.countyIds.slice(0, 3); });
  assert.equal(ledger.metadataProgress(state).overlander, 4);
});
check('overnights use exact calendar dates including leap days; Southern Cross ignores day trips and northern nights', () => {
  const trip = (id, startDate, endDate, lat) => ({
    ...exp, id, startDate, endDate, routeCoords: [[lat, 20]]
  });
  const state = migrate({ expeditions: [
    trip('southern_day', '2024-02-28', '2024-02-28', -1),
    trip('northern_night', '2024-02-28', '2024-02-29', 1),
    trip('equator_night', '2024-02-28', '2024-02-29', 0),
    trip('southern_night', '2024-02-28', '2024-02-29', -1),
    trip('southern_leap', '2024-02-28', '2024-03-01', -1)
  ] });
  assert.equal(ledger.overnightNights(state.expeditions[0]), 0);
  assert.equal(ledger.overnightNights(state.expeditions[3]), 1);
  assert.equal(ledger.overnightNights(state.expeditions[4]), 2);
  assert.equal(ledger.metadataProgress(state).southernCross, 2);
  assert.throws(() => migrate({ expeditions: [trip('bad', '2024-03-01', '2024-02-28', -1)] }), /date range/);
});
check('Local Lore requires full Hidden Gem visits in the current home county and ignores unknown home geography', () => {
  const homeBase = { name: 'Home', lat: 45, lng: -121, radiusKm: 80, countyId: '53059' };
  const customPois = [
    ...Array.from({ length: 5 }, (_, index) => ({ ...poi, id: `lore_${index}`, status: index === 0 ? 'l' : 'v' })),
    { ...poi, id: 'lore_transit', status: 't' },
    { ...poi, id: 'lore_wish', status: 'w' },
    { ...poi, id: 'lore_uncharted', rarityTier: 'Uncharted' },
    { ...poi, id: 'lore_elsewhere', countyId: '06073' }
  ];
  assert.equal(ledger.metadataProgress(migrate({ homeBase, customPois })).localLore, 5);
  assert.equal(ledger.metadataProgress(migrate({ customPois })).localLore, 0);
  assert.equal(ledger.metadataProgress(migrate({ homeBase: { ...homeBase, countyId: '06073' }, customPois })).localLore, 1);
});
check('rarity achievements include catalog parks, Photon ledger places and expedition-only stops without double counting', () => {
  const photonPoi = {
    ...poi, id: 'poi_photon_node_900', source: 'Photon', photonId: 'node:900',
    elevationFt: null, countyId: '53059', rarityTier: 'Hidden Gem'
  };
  const trip = {
    ...exp, parkIds: ['rarity_park'], customPoiIds: [photonPoi.id], countyIds: [],
    routeCoords: [[45, -121], [45.1, -121], [45.2, -121]],
    routeStops: [
      { kind: 'park', id: 'rarity_park', name: 'Hidden Gem Park', coords: [45, -121], rarityTier: 'Hidden Gem' },
      { kind: 'poi', id: photonPoi.id, name: 'Photon Hidden Gem', coords: [45.1, -121], rarityTier: 'Hidden Gem' },
      { kind: 'place', id: 'unmapped-stop', name: 'Uncharted Stop', coords: [45.2, -121], rarityTier: 'Uncharted' }
    ]
  };
  const state = migrate({
    homeBase: { name: 'Home', lat: 45, lng: -121, radiusKm: 80, countyId: '53059' },
    pins: { rarity_park: 'v' }, customPois: [photonPoi], expeditions: [trip],
    parkRarity: { rarity_park: { rarity: null, rarityTier: 'Hidden Gem' } }
  });
  assert.equal(state.parkRarity.rarity_park.rarityTier, 'Hidden Gem');
  const progress = ledger.metadataProgress(state, {
    parks: [{ id: 'rarity_park', lat: 45, lng: -121, countyId: '53059', biomes: [], ...state.parkRarity.rarity_park }],
    politicalAt: () => ({ counties: [{ id: '53059', name: 'Test County' }] }),
    rarityTiers: lookups.RARITY_TIERS
  });
  assert.equal(progress.whispers, 3);
  assert.equal(progress.localLore, 2);
});
check('offline catalog rarity contributes to park and linked expedition-stop achievements', () => {
  const park = { id: 'offline_rarity_park', lat: 45, lng: -121, biomes: [] };
  const trip = {
    ...exp, parkIds: [park.id], customPoiIds: [], countyIds: [],
    routeCoords: [[45, -121]], routeStops: [
      { kind: 'park', id: park.id, name: 'Offline Park', coords: [45, -121] }
    ]
  };
  const state = migrate({ pins: { [park.id]: 'v' }, expeditions: [trip] });
  let rarityLookups = 0;
  const progress = ledger.metadataProgress(state, {
    parks: [park], rarityTiers: lookups.RARITY_TIERS,
    catalogParkRarity: () => {
      rarityLookups++;
      return { rarity: null, rarityTier: 'Uncharted' };
    }
  });
  assert.equal(progress.whispers, 1, 'the linked trip stop must not double-count the visited park');
  assert.equal(rarityLookups, 1);
});
check('distance and latitude badges use full logged coordinates, not wishlist, transits or home alone', () => {
  const homeBase = { name: 'Home', lat: 0, lng: 0, radiusKm: 80 };
  const longitude = miles => miles / 3958.7613 * 180 / Math.PI;
  const parks = [
    { id: 'near', lat: 0, lng: longitude(999), biomes: [] },
    { id: 'far', lat: 0, lng: longitude(1001), biomes: [] }
  ];
  assert.equal(ledger.metadataProgress(migrate({ homeBase }), { parks }).zeroMeridian, 1);
  assert.equal(ledger.metadataProgress(migrate({ homeBase }), { parks }).latitudeSpan, 0);
  assert.equal(ledger.metadataProgress(migrate({ homeBase }), { parks }).earthSandwich, 0);
  for (const status of ['w', 't']) {
    assert.equal(ledger.metadataProgress(migrate({ homeBase, pins: { far: status } }), { parks }).beyondHorizon, 0);
  }
  assert.equal(ledger.metadataProgress(migrate({ homeBase, pins: { near: 'v' } }), { parks }).beyondHorizon, 0);
  assert.equal(ledger.metadataProgress(migrate({ homeBase, pins: { far: 'l' } }), { parks }).beyondHorizon, 1);
  assert.equal(ledger.metadataProgress(migrate({ pins: { far: 'v' } }), { parks }).beyondHorizon, 0);
  assert.ok(Math.abs(ledger.distanceMiles({ lat: 0, lng: 179 }, { lat: 0, lng: -179 }) - 138.18684) < 0.01);
  const latitudeParks = [
    { id: 'north', lat: 66.5, lng: 0, biomes: [] },
    { id: 'south', lat: -66.5, lng: 0, biomes: [] },
    { id: 'arctic', lat: 66.5001, lng: 0, biomes: [] },
    { id: 'antarctic', lat: -66.5001, lng: 0, biomes: [] }
  ];
  const extreme = ledger.metadataProgress(migrate({ pins: { north: 'v', south: 'v', arctic: 'v', antarctic: 'l' } }), { parks: latitudeParks });
  assert.equal(extreme.longDark, 2);
  assert.equal(extreme.latitudeSpan, 133.0002);
  const span = ledger.metadataProgress(migrate({
    expeditions: [{ ...exp, routeCoords: [[-30, 0], [30, 0]] }]
  }));
  assert.equal(span.latitudeSpan, 60);
});
check('Fast Travel pairs only explicitly same-day itinerary points, including separate day trips', () => {
  const longitude = miles => miles / 3958.7613 * 180 / Math.PI;
  const trip = (id, miles, startDate = '2026-09-10', endDate = startDate) => ({
    ...exp, id, startDate, endDate, routeCoords: [[0, 0], [0, longitude(miles)]]
  });
  assert.equal(ledger.metadataProgress(migrate({ expeditions: [trip('close', 499)] })).fastTravel, 1);
  assert.equal(ledger.metadataProgress(migrate({ expeditions: [trip('far', 501)] })).fastTravel, 2);
  assert.equal(ledger.metadataProgress(migrate({ expeditions: [trip('multi', 501, '2026-09-10', '2026-09-11')] })).fastTravel, 0);
  const a = { ...trip('first', 0), routeCoords: [[0, 0]] };
  const b = { ...trip('second', 501), routeCoords: [[0, longitude(501)]] };
  assert.equal(ledger.metadataProgress(migrate({ expeditions: [a, b] })).fastTravel, 2);
  assert.equal(ledger.metadataProgress(migrate({ expeditions: [a, { ...b, startDate: '2026-09-11', endDate: '2026-09-11' }] })).fastTravel, 1);
  assert.equal(ledger.metadataProgress(migrate({ customPois: [poi] })).fastTravel, 0);
});
check('Earth Sandwich uses the configured 100-mile antipode tolerance without mistaking dateline neighbors', () => {
  const offset = miles => miles / 3958.7613 * 180 / Math.PI;
  const progress = longitude => ledger.metadataProgress(migrate({
    expeditions: [{ ...exp, routeCoords: [[0, 0], [0, longitude]] }]
  })).earthSandwich;
  assert.equal(progress(180), 2);
  assert.equal(progress(180 - offset(99)), 2);
  assert.equal(progress(180 - offset(101)), 1);
  assert.equal(ledger.metadataProgress(migrate({
    expeditions: [{ ...exp, routeCoords: [[0, 179], [0, -179]] }]
  })).earthSandwich, 1);
});
check('Touch Grass requires a park designation', () => {
  const state = migrate({
    homeBase: { name: 'Home', lat: 45, lng: -121, radiusKm: 80 },
    pins: { us: 'v', canada: 'l', unknown: 'v', history: 'v', npsa: 'v' }
  });
  const parks = [
    { id: 'us', lat: 45, lng: -121, designation: 'National Park', biomes: [] },
    { id: 'canada', lat: 51, lng: -115, designation: 'Provincial Park', biomes: [], intl: true, country: 'Canada', countryCode: 'CA' },
    { id: 'unknown', lat: 52, lng: -115, biomes: [], intl: true, country: 'Unknown label', countryCode: null },
    { id: 'history', lat: 45, lng: -121, designation: 'National Historical Park', biomes: [] },
    { id: 'npsa', lat: -14, lng: -170, designation: '', biomes: [] }
  ];
  const progress = ledger.metadataProgress(state, { parks });
  assert.equal(progress.touchGrass, 3);
});
check('biome achievements include expedition coordinates but do not invent ocean biomes or use wishlist locations', () => {
  const state = migrate({
    customPois: [{ ...poi, biomes: ['5', '10'] }, { ...poi, id: 'wish_biome', status: 'w', biomes: ['14'] }],
    expeditions: [{ ...exp, routeCoords: [[45, 0], [0, 0], [45, 0]] }]
  });
  const before = JSON.stringify(state);
  const progress = ledger.metadataProgress(state, { biomeAt: lat => lat === 45 ? ['11'] : [] });
  assert.deepEqual([...progress.collectedBiomes].sort(), ['10', '11', '5']);
  assert.equal(JSON.stringify(state), before);
});
check('Country Roads supports both alternate routes with prerequisite progress and no wishlist/transit credit', () => {
  const westVirginia = { 's:West Virginia': 'v' };
  const progress = input => ledger.metadataProgress(migrate(input)).countryRoads;
  assert.equal(progress({}), 0);
  assert.equal(progress({ regions: westVirginia }), 1);
  assert.equal(progress({ pins: { shen: 'v' } }), 1);
  for (const status of ['v', 'l']) {
    assert.equal(progress({ regions: { 's:West Virginia': status }, pins: { shen: status } }), 2);
    for (const id of ['blri', 'grsm']) {
      assert.equal(progress({
        regions: westVirginia, pins: { [id]: status },
        customPois: [{ ...poi, status, category: ' Shenandoah River ' }]
      }), 2);
    }
  }
  for (const status of ['w', 't']) {
    assert.equal(progress({
      regions: { 's:West Virginia': status }, pins: { shen: status },
      customPois: [{ ...poi, status, category: 'Shenandoah River' }]
    }), 0);
  }
  const mountains = { ...poi, id: 'poi_mountains', category: ' bLuE rIdGe MoUnTaInS ' };
  const river = { ...poi, id: 'poi_river', category: 'SHENANDOAH RIVER' };
  assert.equal(progress({ regions: westVirginia, customPois: [mountains] }), 1.5);
  assert.equal(progress({ regions: westVirginia, customPois: [river] }), 1.5);
  assert.equal(progress({ regions: westVirginia, customPois: [mountains, river] }), 2);
  assert.equal(progress({ regions: westVirginia, customPois: [
    { ...mountains, category: 'Blue Ridge Mountains viewpoint' },
    { ...river, category: 'Shenandoah River nearby' }
  ] }), 1);
  assert.equal(progress({ regions: westVirginia, expeditions: [{ ...exp, parkIds: ['shen'] }] }), 2);
});
check('Rocky Mountain High excludes exactly the requested Colorado plains counties and unknown IDs', () => {
  const excluded = [
    '08075', '08087', '08115', '08095', '08121', '08125', '08063', '08017',
    '08073', '08039', '08061', '08025', '08009', '08011', '08089', '08099'
  ];
  for (const id of excluded) {
    assert.equal(ledger.metadataProgress(migrate({ counties: { [id]: 'v' } })).rockyMountainHigh, 0, id);
    assert.equal(ledger.metadataProgress(migrate({ counties: { [id]: 'l' } })).rockyMountainHigh, 0, id);
  }
  const allColorado = [...Array.from({ length: 63 }, (_, i) => `08${String(i * 2 + 1).padStart(3, '0')}`), '08014'];
  const state = migrate({ counties: Object.fromEntries(allColorado.map(id => [id, 'v'])) });
  assert.equal(ledger.metadataProgress(state).rockyMountainHigh, 48);
  for (const id of ['08001', '08014', '08031', '08065', '08117']) {
    for (const status of ['v', 'l', 'w', 't']) {
      assert.equal(ledger.metadataProgress(migrate({ counties: { [id]: status } })).rockyMountainHigh,
        ['v', 'l'].includes(status) ? 1 : 0, `${id}: ${status}`);
    }
  }
  for (const id of ['08999', '08002', '06073']) {
    assert.equal(ledger.metadataProgress(migrate({ counties: { [id]: 'l' } })).rockyMountainHigh, 0, id);
  }
  assert.equal(ledger.metadataProgress(migrate({ regions: { 's:Colorado': 'v' } })).rockyMountainHigh, 0);
});
check('regional music badges include logged POIs, park coordinates and expedition stops without changing saves', () => {
  const state = migrate({
    customPois: [{ ...poi, countyId: '08065', state: 'Colorado' }],
    pins: { shen: 'v', wv: 'v' },
    expeditions: [{ ...exp, countyIds: ['08065'] }]
  });
  const before = JSON.stringify(state);
  const options = {
    parks: [
      { id: 'wv', lat: 38, lng: -81, states: ['West Virginia'], biomes: [] },
      { id: 'shen', lat: 38, lng: -78, states: ['Virginia'], biomes: [] }
    ],
    politicalAt: lat => lat === 39.24 ? { counties: [{ id: '08097' }] } : null
  };
  const progress = ledger.metadataProgress(state, options);
  assert.equal(progress.countryRoads, 2);
  assert.equal(progress.rockyMountainHigh, 2);
  assert.equal(JSON.stringify(state), before);
  assert.equal(ledger.metadataProgress(migrate({
    homeBase: { name: 'Home', lat: 39, lng: -105, radiusKm: 80, countyId: '08031' },
    counties: { '08031': 'l' }
  })).rockyMountainHigh, 1);
});
check('unknown international labels never fabricate country completion', () => {
  const state = migrate({ pins: { unknown: 'v' } });
  ledger.syncDerivedState(state, { parks: [{ id: 'unknown', intl: true, country: 'Unverified region' }] });
  assert.deepEqual(state.regions, {});
});
const topology = JSON.parse(await readFile(new URL('./ecoregions.topojson', import.meta.url), 'utf8'));
const ecoregions = lookups.indexFeatures(topojson.feature(topology, topology.objects.ecoregions).features, d3);
check('existing unchanged terrestrial snapshot recognizes real below-sea-level and high-altitude stops', () => {
  assert.ok(lookups.biomeRegion(36.2298, -116.7674, ecoregions, d3.geoContains).biomes.length);
  assert.ok(lookups.biomeRegion(39.1083, -106.564, ecoregions, d3.geoContains).biomes.length);
  assert.equal(lookups.biomeRegion(0, -140, ecoregions, d3.geoContains).biomes.length, 0);
});
const mixedStops = [
  {kind:'place',id:'san',name:'San Diego airport',coords:[32.7338,-117.1933]},
  {kind:'place',id:'den',name:'Denver airport',coords:[39.8561,-104.6737]},
  {kind:'place',id:'aspen',name:'Aspen',coords:[39.1911,-106.8175]},
  {kind:'place',id:'den_return',name:'Denver return',coords:[39.8561,-104.6737]}
];
const mixedExpedition = {
  ...exp, id:'mixed', name:'Fly then drive', reason:'Visiting friends', startDate:null, endDate:null, dayTrip:false,
  transitTags:['flight','road'], countyIds:[], parkIds:[], customPoiIds:[],
  routeStops:mixedStops, routeCoords:mixedStops.map(stop=>stop.coords),
  routeLegs:[
    {mode:'flight',routeSource:'none',routeCoords:[],countyIds:[]},
    {mode:'road',routeSource:'routed',routeCoords:[mixedStops[1].coords,[39.7,-105.5],mixedStops[2].coords],countyIds:['08059','08097']},
    {mode:'road',routeSource:'routed',routeCoords:[mixedStops[2].coords,[39.7,-105.5],mixedStops[3].coords],countyIds:['08059','08097']}
  ],
  minElevationFt:null,maxElevationFt:null
};
check('mixed city and airport itineraries support optional dates, reason text and separate travel legs', () => {
  assert.deepEqual(ledger.validateExpeditions([mixedExpedition],lookups)[0], mixedExpedition);
  assert.equal(ledger.validateExpeditions([{...mixedExpedition,startDate:'2026-10-01'}],lookups).length,1);
  assert.equal(ledger.validateExpeditions([{...mixedExpedition,endDate:'2026-10-01'}],lookups).length,1);
  assert.equal(ledger.validateExpeditions([{...mixedExpedition,dayTrip:true,startDate:'2026-10-01',endDate:'2026-10-01'}],lookups).length,1);
  for (const change of [{startDate:0},{endDate:false},{dayTrip:true},{reason:123},{reason:'a'.repeat(1001)}]) {
    assert.throws(()=>ledger.validateExpeditions([{...mixedExpedition,...change}],lookups));
  }
  assert.equal(ledger.overnightNights(mixedExpedition),0);
  assert.equal(ledger.metadataProgress(migrate({expeditions:[mixedExpedition]})).fastTravel,0);
  assert.equal(ledger.metadataProgress(migrate({expeditions:[{...mixedExpedition,startDate:null,endDate:null}]})).southernCross,0);
});
check('only road/AWD legs clear land route corridors; non-driving routes award no intermediate counties', () => {
  assert.equal(ledger.fogRoutes(mixedExpedition).length,2);
  assert.equal(typeof ledger.waterFogRoutes,'function');
  for (const mode of ['ferry', 'flight', 'rail', 'foot']) {
    assert.deepEqual(ledger.fogRoutes({...exp,transitTags:[mode]}),[]);
    const legs = mixedExpedition.routeLegs.map(leg => ({...leg,mode}));
    assert.deepEqual(ledger.fogRoutes({...mixedExpedition,routeLegs:legs}),[]);
  }
  assert.deepEqual(ledger.fogRoutes({...exp,transitTags:['ferry','flight']}),[]);
  assert.deepEqual(ledger.fogRoutes({...exp,transitTags:['flight']}),[]);
  assert.deepEqual(ledger.fogRoutes({...exp,transitTags:['road']}),[exp.routeCoords]);
  assert.deepEqual(ledger.fogRoutes({...exp,transitTags:['ferry']}),[]);
  assert.deepEqual(ledger.fogRoutes({...exp,transitTags:['foot']}),[]);
  assert.deepEqual(ledger.fogRoutes({...exp,transitTags:['rail']}),[]);
  for (const flight of [
    {mode:'flight',routeSource:'none',routeCoords:[mixedStops[0].coords,mixedStops[1].coords],countyIds:[]},
    {mode:'flight',routeSource:'none',routeCoords:[],countyIds:['04001']},
    {mode:'teleport',routeCoords:[],countyIds:[]}
  ]) assert.throws(()=>ledger.validateExpeditions([{...mixedExpedition,routeLegs:[flight,...mixedExpedition.routeLegs.slice(1)]}],lookups));
});
check('water routes include only ferry/flight legs and cache missing-flight endpoint geometry', () => {
  const stops=mixedExpedition.routeStops;
  const ferry=mixedExpedition.routeLegs[1].routeCoords;
  const trip={...mixedExpedition,routeLegs:[
    {mode:'flight',routeSource:'none',routeCoords:[]},
    {mode:'ferry',routeSource:'direct',routeCoords:ferry},
    {...mixedExpedition.routeLegs[2],mode:'rail'}
  ]};
  const first=ledger.waterFogRoutes(trip);
  assert.deepEqual(first,[[stops[0].coords,stops[1].coords],ferry]);
  assert.equal(ledger.waterFogRoutes(trip)[0],first[0],'endpoint arrays stay stable for the projection cache');
  const edited={...trip,routeStops:stops.map((stop,index)=>index===0?
    {...stop,coords:[1,2]}:stop)};
  assert.deepEqual(ledger.waterFogRoutes(edited)[0],[[1,2],stops[1].coords]);
  for (const change of [
    {routeSource:'none',routeCoords:[[9,9],[8,8]]},
    {routeSource:'direct',routeCoords:[]},
    {routeSource:'none'}
  ]) {
    const updated={...trip,routeLegs:[{...trip.routeLegs[0],...change},...trip.routeLegs.slice(1)]};
    assert.deepEqual(ledger.waterFogRoutes(updated)[0],[stops[0].coords,stops[1].coords]);
  }
  const flightTrack=[stops[0].coords,[40,-110],stops[1].coords];
  const uploaded={...trip,routeLegs:[{mode:'flight',routeSource:'uploaded',routeCoords:flightTrack},
    ...trip.routeLegs.slice(1)]};
  assert.equal(ledger.waterFogRoutes(uploaded)[0],flightTrack);
  for(const mode of ['road','awd','rail','foot']) {
    assert.deepEqual(ledger.waterFogRoutes({...trip,routeLegs:trip.routeLegs.map(leg=>({...leg,mode}))}),[]);
    assert.deepEqual(ledger.waterFogRoutes({...exp,transitTags:[mode]}),[]);
  }
  for(const mode of ['ferry','flight']) {
    assert.deepEqual(ledger.waterFogRoutes({...exp,transitTags:[mode]}),[exp.routeCoords]);
  }
});
check('flight stops are the deduplicated endpoints of flight legs only', () => {
  const stops=mixedExpedition.routeStops;
  const trip={...mixedExpedition,routeLegs:[
    {mode:'flight',routeSource:'none',routeCoords:[]},
    {mode:'ferry',routeSource:'direct',routeCoords:mixedExpedition.routeLegs[1].routeCoords},
    {...mixedExpedition.routeLegs[2],mode:'road'}
  ]};
  assert.deepEqual(JSON.parse(JSON.stringify(ledger.flightStops(trip))),[stops[0].coords,stops[1].coords]);
  const twoFlights={...trip,routeLegs:trip.routeLegs.map((leg,index)=>index<2?{...leg,mode:'flight'}:leg)};
  assert.deepEqual(JSON.parse(JSON.stringify(ledger.flightStops(twoFlights))),
    [stops[0].coords,stops[1].coords,stops[2].coords],'shared connecting airports are listed once');
  for(const mode of ['road','awd','ferry','rail','foot']) {
    assert.deepEqual(ledger.flightStops({...trip,routeLegs:trip.routeLegs.map(leg=>({...leg,mode}))}),[]);
    assert.deepEqual(ledger.flightStops({...exp,transitTags:[mode]}),[]);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(ledger.flightStops({...exp,transitTags:['flight']}))),
    JSON.parse(JSON.stringify(exp.routeCoords)));
  const broken={...trip,routeStops:[{...stops[0],coords:[NaN,1]},...stops.slice(1)]};
  assert.deepEqual(JSON.parse(JSON.stringify(ledger.flightStops(broken))),[stops[1].coords]);
});
check('uploaded expedition tracks preserve geometry while fog and county credit follow the transit mode', () => {
  const stops = [
    { kind: 'place', id: 'track_start', name: 'Track Start', coords: [39.24, -106.29] },
    { kind: 'place', id: 'track_end', name: 'Track End', coords: [39.19, -106.81] }
  ];
  const track = [stops[0].coords, [39.2, -106.5], stops[1].coords];
  const makeUploadedTrip = (mode, countyIds = []) => ({
    ...exp, id: `exp_uploaded_${mode}`, transitTags: [mode],
    routeCoords: stops.map(stop => stop.coords), routeStops: stops,
    routeLegs: [{ mode, routeSource: 'uploaded', routeCoords: track, countyIds }]
  });
  const road = ledger.validateExpeditions([makeUploadedTrip('road', ['08059'])], lookups)[0];
  assert.equal(road.routeLegs[0].routeSource, 'uploaded');
  assert.deepEqual(road.routeLegs[0].routeCoords, track);
  assert.deepEqual(ledger.fogRoutes(road), [track]);
  for (const mode of ['ferry', 'flight', 'rail', 'foot']) {
    const uploaded = ledger.validateExpeditions([makeUploadedTrip(mode)], lookups)[0];
    assert.equal(uploaded.routeLegs[0].routeSource,'uploaded');
    assert.deepEqual(uploaded.routeLegs[0].routeCoords, track);
    assert.deepEqual(ledger.fogRoutes(uploaded), []);
    assert.deepEqual(ledger.waterFogRoutes(uploaded),['ferry','flight'].includes(mode)?[track]:[]);
  }
  assert.throws(() => ledger.validateExpeditions([makeUploadedTrip('ferry', ['08059'])], lookups), /travel leg/);
});
check('leg validation rejects missing legs, mismatched tags, malformed coordinates and distant snapped roads', () => {
  for (const change of [
    {routeLegs:[]}, {routeLegs:mixedExpedition.routeLegs.slice(1)}, {transitTags:['road']},
    {routeLegs:[mixedExpedition.routeLegs[0],{mode:'road',routeCoords:[[0,0],[1,1]],countyIds:[]},mixedExpedition.routeLegs[2]]},
    {routeLegs:[mixedExpedition.routeLegs[0],{...mixedExpedition.routeLegs[1],countyIds:['08059','08059']},mixedExpedition.routeLegs[2]]}
  ]) assert.throws(()=>ledger.validateExpeditions([{...mixedExpedition,...change}],lookups));
  const ferry = {...mixedExpedition,transitTags:['ferry'],routeStops:mixedStops.slice(0,2),
    routeCoords:mixedStops.slice(0,2).map(stop=>stop.coords),
    routeLegs:[{mode:'ferry',routeSource:'routed',routeCoords:mixedStops.slice(0,2).map(stop=>stop.coords),countyIds:[]}]};
  const validatedFerry = ledger.validateExpeditions([ferry],lookups)[0];
  assert.deepEqual(ledger.fogRoutes(validatedFerry),[]);
  assert.equal(validatedFerry.routeLegs[0].routeSource,'direct');
  assert.throws(()=>ledger.validateExpeditions([{...ferry,
    routeLegs:[{...ferry.routeLegs[0],countyIds:['04001']}]}],lookups),/travel leg/);
  const directFerry = {...ferry,routeLegs:[{mode:'ferry',routeSource:'direct',
    routeCoords:mixedStops.slice(0,2).map(stop=>stop.coords),countyIds:[]}]};
  assert.deepEqual(ledger.fogRoutes(ledger.validateExpeditions([directFerry],lookups)[0]),[]);
  const legacyFerry = ledger.validateExpeditions([{...ferry,
    routeLegs:[{mode:'ferry',routeCoords:mixedStops.slice(0,2).map(stop=>stop.coords),countyIds:[]}]}],lookups)[0];
  assert.equal(legacyFerry.routeLegs[0].routeSource,'direct');
  assert.deepEqual(ledger.fogRoutes(legacyFerry),[]);
});
check('saved routed ferries migrate to direct stop-to-stop geometry and rail remains direct-only', () => {
  const stops=mixedStops.slice(0,2);
  const saved={...mixedExpedition,transitTags:['ferry'],routeStops:stops,
    routeCoords:stops.map(stop=>stop.coords),
    routeLegs:[{mode:'ferry',routeSource:'routed',
      routeCoords:[stops[0].coords,[40,-110],stops[1].coords],countyIds:[]}]};
  const normalized=ledger.validateExpeditions([saved],lookups)[0];
  assert.equal(normalized.routeLegs[0].routeSource,'direct');
  assert.deepEqual(normalized.routeLegs[0].routeCoords,stops.map(stop=>stop.coords));
  assert.equal(saved.routeLegs[0].routeCoords.length,3);
  const rail={...normalized,transitTags:['rail'],
    routeLegs:[{...normalized.routeLegs[0],mode:'rail'}]};
  assert.deepEqual(ledger.validateExpeditions([rail],lookups)[0],rail);
  assert.deepEqual(ledger.fogRoutes(rail),[]);
  assert.throws(()=>ledger.validateExpeditions([{...rail,
    routeLegs:[{...rail.routeLegs[0],routeSource:'routed'}]}],lookups),/travel leg/);
  assert.throws(()=>ledger.validateExpeditions([{...rail,
    routeLegs:[{...rail.routeLegs[0],countyIds:['04001']}]}],lookups),/travel leg/);
});
check('disconnected route errors identify the leg, mode, stops and failing endpoint distance', () => {
  const badRoute = {
    ...mixedExpedition,
    routeLegs: [
      mixedExpedition.routeLegs[0],
      { mode: 'road', routeSource: 'routed', routeCoords: [[38, -104], [39.7, -105.5], mixedStops[2].coords], countyIds: ['08059'] },
      mixedExpedition.routeLegs[2]
    ]
  };
  assert.throws(() => ledger.validateExpeditions([badRoute], lookups), error => {
    assert.match(error.message, /Leg 2 \(Drive \/ Road Trip\)/);
    assert.match(error.message, /Denver airport/);
    assert.match(error.message, /Aspen/);
    assert.match(error.message, /route start/);
    assert.match(error.message, /miles from "Denver airport" \(maximum allowed: 1 mile\)/);
    return true;
  });
});
const mixedPoliticalAt = (lat,lng) => ({
  countries:['United States of America'],states:[lng < -110 ? 'California' : 'Colorado'],
  counties:[{id:lng < -110 ? '06073' : lng < -106 ? '08097' : '08031'}]
});
const mixedOptions = {
  politicalAt:mixedPoliticalAt,countyRegions:{
    '08059':{countries:['United States of America'],states:['Colorado']},
    '08097':{countries:['United States of America'],states:['Colorado']}
  }
};
check('mixed flights and drives credit airport counties and driven counties, never flyover counties', () => {
  const state=migrate({expeditions:[mixedExpedition]});
  ledger.syncDerivedState(state,mixedOptions);
  assert.deepEqual(Object.keys(state.counties).sort(),['06073','08031','08059','08097']);
  assert.equal(state.counties['04001'],undefined);
  assert.deepEqual(ledger.loggedCountyStatuses(state,mixedOptions),state.counties);
  assert.deepEqual(ledger.fogRoutes(state.expeditions[0]),mixedExpedition.routeLegs.slice(1).map(leg=>leg.routeCoords));
  assert.equal(state.regions['s:California'],'v');
  assert.equal(state.regions['s:Colorado'],'v');
});
check('editing tracked expeditions retracts obsolete credit while preserving manual marks, home and other trips', () => {
  const state=migrate({
    counties:{'08059':'l','08001':'v'},homeBase:{name:'Home',lat:40,lng:-104,radiusKm:12,countyId:'08031'},
    expeditions:[mixedExpedition]
  });
  ledger.syncDerivedState(state,mixedOptions);
  const before=JSON.stringify(state);
  ledger.syncDerivedState(state,mixedOptions);
  assert.equal(JSON.stringify(state),before);
  assert.deepEqual(migrate(state),state);
  // Keep just the flight: Denver/San Diego remain visited, but the drive to Aspen no longer does.
  const flightOnly={...mixedExpedition,transitTags:['flight'],routeStops:mixedStops.slice(0,2),
    routeCoords:mixedStops.slice(0,2).map(stop=>stop.coords),routeLegs:[mixedExpedition.routeLegs[0]]};
  state.expeditions=[flightOnly];
  ledger.syncDerivedState(state,mixedOptions);
  assert.equal(state.counties['08097'],undefined);
  assert.equal(state.counties['08059'],'l');
  assert.equal(state.counties['08001'],'v');
  assert.equal(state.counties['08031'],'l');
  assert.equal(state.counties['06073'],'v');
  state.expeditions.push({...mixedExpedition,id:'another'});
  ledger.syncDerivedState(state,mixedOptions);
  state.expeditions=[state.expeditions[1]];
  ledger.syncDerivedState(state,mixedOptions);
  assert.equal(state.counties['08097'],'v');
});
check('new manual promotions survive expedition edits and legacy ambiguous marks are retained', () => {
  const state=migrate({expeditions:[mixedExpedition]});
  ledger.syncDerivedState(state,mixedOptions);
  ledger.restoreExpeditionPromotions(state);
  state.counties['08097']='v';
  ledger.syncDerivedState(state,mixedOptions);
  state.expeditions=[];
  ledger.syncDerivedState(state,mixedOptions);
  assert.deepEqual(state.counties,{'08097':'v'});
  const legacy=migrate({counties:{'08097':'v'},expeditions:[exp]});
  ledger.syncDerivedState(legacy,mixedOptions);
  legacy.expeditions=[];
  ledger.syncDerivedState(legacy,mixedOptions);
  assert.equal(legacy.counties['08097'],'v');
});
check('explicit map statuses override travel-derived pins, regions and counties without changing trips', () => {
  const state = migrate({ expeditions: [mixedExpedition] });
  ledger.syncDerivedState(state, mixedOptions);
  assert.equal(state.counties['06073'], 'v');
  state.statusOverrides.counties['06073'] = 'w';
  state.statusOverrides.regions['s:California'] = 't';
  state.statusOverrides.pins.romo = 'l';
  ledger.syncDerivedState(state, mixedOptions);
  assert.equal(state.counties['06073'], 'w');
  assert.equal(state.regions['s:California'], 't');
  assert.equal(state.pins.romo, 'l');
  assert.equal(state.expeditions[0].id, mixedExpedition.id);
  assert.deepEqual(state.expeditions[0].countyIds, mixedExpedition.countyIds);
  state.expeditions = [];
  ledger.syncDerivedState(state, mixedOptions);
  assert.equal(state.counties['06073'], 'w');
  assert.equal(state.regions['s:California'], 't');
  assert.equal(state.pins.romo, 'l');
  state.statusOverrides.counties['06073'] = 'un';
  ledger.syncDerivedState(state, mixedOptions);
  assert.equal(state.counties['06073'], undefined);
});
check('tracked park and custom POI promotions revert to their prior tiers without deleting independent visits', () => {
  const state=migrate({pins:{romo:'w'},customPois:[{...poi,status:'t'}],
    expeditions:[{...exp,customPoiIds:[poi.id]}]});
  const options={parks:[{id:'romo',states:['Colorado']}],...mixedOptions};
  ledger.syncDerivedState(state,options);
  assert.equal(state.pins.romo,'v');
  assert.equal(state.customPois[0].status,'v');
  assert.equal(state.counties['53059'],'v');
  state.expeditions=[];
  ledger.syncDerivedState(state,options);
  assert.equal(state.pins.romo,'w');
  assert.equal(state.customPois[0].status,'t');
  assert.equal(state.counties['53059'],'t');
});
check('bad promotion provenance is rejected rather than downgrading lived tiers or injecting keys', () => {
  for (const expeditionPromotions of [
    [],{bad:{}},{pins:{romo:{before:'w',after:'l'}}},{counties:{'8065':{before:null,after:'v'}}},
    {pins:{romo:{before:'v',after:'v'}}},{poiStatuses:{poi_test:{before:null,after:'v'}}}
  ]) assert.throws(()=>migrate({expeditionPromotions}));
});
check('malformed map status overrides are rejected', () => {
  for (const statusOverrides of [
    [], { invalid: {} }, { counties: { '06073': 'unknown' } },
    { counties: { '6073': 'v' } }, { pins: { romo: '__proto__' } },
    { nationalParks: { yell: 'v' } }
  ]) assert.throws(() => migrate({statusOverrides}), /map status overrides/i);
});
check('AWD counts only its endpoints and Focal Length counts uploaded photos, not purpose or reason text', () => {
  const trip={...mixedExpedition,reason:'Landscape photography',purposeTags:['photography'],
    photos:[photo],transitTags:['flight','awd','road'],
    routeLegs:[mixedExpedition.routeLegs[0],{...mixedExpedition.routeLegs[1],mode:'awd'},mixedExpedition.routeLegs[2]]};
  const stats=ledger.metadataProgress(migrate({expeditions:[trip]}));
  assert.equal(stats.overlander,2);
  assert.equal(stats.focal,1);
  const repeated={...trip,id:'repeat',routeStops:trip.routeStops.map(stop=>({...stop,id:'other_'+stop.id}))};
  const repeatedStats=ledger.metadataProgress(migrate({expeditions:[trip,repeated]}));
  assert.equal(repeatedStats.overlander,2);
  assert.equal(repeatedStats.focal,2);
});
console.log(`${checks} travel ledger checks passed.`);
