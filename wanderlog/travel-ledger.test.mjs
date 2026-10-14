import assert from 'node:assert/strict';
import ledger from './travel-ledger.js';
import lookups from './coordinate-lookups.js';
import catalog from './nps-catalog.js';
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
  countyId: '53059', rarityTier: 'Hidden Gem', reviewCount: null, purposeTags: ['photography']
};
const exp = {
  id: 'exp_test', name: 'Aspen Anniversary Drive', startDate: '2026-09-10', endDate: '2026-09-15',
  transitTags: ['awd', 'flight'], purposeTags: ['photography', 'anniversary'],
  countyIds: ['08065', '08097'], parkIds: ['romo'], customPoiIds: [],
  routeCoords: [[39.24, -106.29], [39.19, -106.81]], minElevationFt: 5280, maxElevationFt: 12095
};
const migrate = state => ledger.migrateState(state, lookups, catalog);
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
    { customPois: [{ ...poi, purposeTags: ['bad'] }] },
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
    { transitTags: ['awd', 'awd'] }, { purposeTags: ['unknown'] },
    { countyIds: [], parkIds: [], customPoiIds: [] }, { countyIds: ['08065', '08065'] }
  ]) assert.throws(() => ledger.validateExpeditions([{ ...exp, ...change }], lookups));
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
check('achievement metadata uses strict elevation thresholds and full visits only', () => {
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
  assert.equal(progress.thinAir, 1);
  assert.equal(progress.whispers, 6);
  assert.equal(progress.focal, 6);
});
check('tag achievements reach exact counts without collapsing expeditions into separate trips', () => {
  const state = migrate({
    customPois: [poi],
    expeditions: Array.from({ length: 5 }, (_, index) => ({
      ...exp, id: `exp_${index}`, transitTags: index < 3 ? ['awd', 'ferry'] : ['awd'],
      countyIds: index === 0 ? ['08065', '08097', '08001', '08003', '08005'] : exp.countyIds
    }))
  });
  check('waterfalls count only visited/lived POIs with an exact normalized category', () => {
    const state = migrate({ customPois: [
      { ...poi, id: 'poi_falls_visit', category: 'waterfall' },
      { ...poi, id: 'poi_falls_home', category: ' WaterFall ', status: 'l' },
      { ...poi, id: 'poi_falls_transit', category: 'waterfall', status: 't' },
      { ...poi, id: 'poi_falls_wish', category: 'waterfall', status: 'w' },
      { ...poi, id: 'poi_falls_other', category: 'waterfall viewpoint' },
      { ...poi, id: 'poi_falls_none' }
    ] });
    assert.equal(ledger.metadataProgress(state).waterfalls, 2);
    for (const count of [1, 5, 10]) {
      const progress = ledger.metadataProgress(migrate({
        customPois: Array.from({ length: count }, (_, i) => ({ ...poi, id: `poi_waterfall_${i}`, category: 'waterfall' }))
      }));
      assert.equal(progress.waterfalls, count);
    }
  });
  let progress = ledger.metadataProgress(state);
  assert.equal(progress.overlander, 5);
  assert.equal(progress.mariner, 3);
  assert.equal(progress.focal, 6);
  assert.equal(progress.borderlands, 5);
  state.expeditions.push(...Array.from({ length: 4 }, (_, index) => ({ ...exp, id: `exp_extra_${index}` })));
  progress = ledger.metadataProgress(state);
  assert.equal(progress.focal, 10);
  assert.equal(progress.borderlands, 5);
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
console.log(`${checks} travel ledger checks passed.`);
