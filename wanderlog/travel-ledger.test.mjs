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
  assert.equal(progress.overlander, 6);
  assert.equal(progress.mariner, 3);
  assert.equal(progress.focal, 6);
  assert.equal(progress.borderlands, undefined);
  state.expeditions.push(...Array.from({ length: 4 }, (_, index) => ({ ...exp, id: `exp_extra_${index}` })));
  progress = ledger.metadataProgress(state);
  assert.equal(progress.focal, 10);
  assert.equal(progress.overlander, 6);
});
check('AWD locations deduplicate across trips while Ferry / Boat counts individual trips at exact goals', () => {
  const trip = {
    ...exp, countyIds: ['08001', '08003', '08005', '08007'], parkIds: ['romo'],
    transitTags: ['awd', 'ferry']
  };
  const state = migrate({ expeditions: [{ ...trip, id: 'trip_one' }, { ...trip, id: 'trip_two' }] });
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
check('international coordinates require a known home country; Touch Grass requires a park designation', () => {
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
  const options = { parks, politicalAt: lat => lat === 45 ? { countries: ['United States of America'] } : null };
  const progress = ledger.metadataProgress(state, options);
  assert.equal(progress.international, 1);
  assert.equal(progress.touchGrass, 3);
  assert.equal(ledger.metadataProgress({ ...state, homeBase: null }, options).international, 0);
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
  transitTags:['flight','road'], purposeTags:[], countyIds:[], parkIds:[], customPoiIds:[],
  routeStops:mixedStops, routeCoords:mixedStops.map(stop=>stop.coords),
  routeLegs:[
    {mode:'flight',routeCoords:[],countyIds:[]},
    {mode:'road',routeCoords:[mixedStops[1].coords,[39.7,-105.5],mixedStops[2].coords],countyIds:['08059','08097']},
    {mode:'road',routeCoords:[mixedStops[2].coords,[39.7,-105.5],mixedStops[3].coords],countyIds:['08059','08097']}
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
check('flight legs cannot carry path geometry or intermediate counties and legacy flights never clear corridors', () => {
  assert.equal(ledger.fogRoutes(mixedExpedition).length,2);
  assert.deepEqual(ledger.fogRoutes({...exp,transitTags:['flight']}),[]);
  assert.deepEqual(ledger.fogRoutes({...exp,transitTags:['road']}),[exp.routeCoords]);
  for (const flight of [
    {mode:'flight',routeCoords:[mixedStops[0].coords,mixedStops[1].coords],countyIds:[]},
    {mode:'flight',routeCoords:[],countyIds:['04001']},
    {mode:'teleport',routeCoords:[],countyIds:[]}
  ]) assert.throws(()=>ledger.validateExpeditions([{...mixedExpedition,routeLegs:[flight,...mixedExpedition.routeLegs.slice(1)]}],lookups));
});
check('leg validation rejects missing legs, mismatched tags, malformed coordinates and distant snapped roads', () => {
  for (const change of [
    {routeLegs:[]}, {routeLegs:mixedExpedition.routeLegs.slice(1)}, {transitTags:['road']},
    {routeLegs:[mixedExpedition.routeLegs[0],{mode:'road',routeCoords:[[0,0],[1,1]],countyIds:[]},mixedExpedition.routeLegs[2]]},
    {routeLegs:[mixedExpedition.routeLegs[0],{...mixedExpedition.routeLegs[1],countyIds:['08059','08059']},mixedExpedition.routeLegs[2]]}
  ]) assert.throws(()=>ledger.validateExpeditions([{...mixedExpedition,...change}],lookups));
  const ferry = {...mixedExpedition,transitTags:['ferry'],routeStops:mixedStops.slice(0,2),
    routeCoords:mixedStops.slice(0,2).map(stop=>stop.coords),
    routeLegs:[{mode:'ferry',routeCoords:mixedStops.slice(0,2).map(stop=>stop.coords),countyIds:[]}]};
  assert.equal(ledger.fogRoutes(ledger.validateExpeditions([ferry],lookups)[0]).length,1);
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
check('AWD achievement counts only the endpoints of AWD legs and photography reason preserves existing badge logic', () => {
  const trip={...mixedExpedition,reason:'Landscape photography',transitTags:['flight','awd','road'],
    routeLegs:[mixedExpedition.routeLegs[0],{...mixedExpedition.routeLegs[1],mode:'awd'},mixedExpedition.routeLegs[2]]};
  const stats=ledger.metadataProgress(migrate({expeditions:[trip]}));
  assert.equal(stats.overlander,2);
  assert.equal(stats.focal,1);
  const repeated={...trip,id:'repeat',routeStops:trip.routeStops.map(stop=>({...stop,id:'other_'+stop.id}))};
  assert.equal(ledger.metadataProgress(migrate({expeditions:[trip,repeated]})).overlander,2);
});
console.log(`${checks} travel ledger checks passed.`);
