(function (root) {
  'use strict';
  const ranks = Object.freeze({ w: 1, t: 2, v: 3, l: 4 });
  const labels = Object.freeze({ w: 'Wishlist', t: 'Transited', v: 'Visited', l: 'Lived / Home Base' });
  const colors = Object.freeze({ w: '#f59e0b', t: '#64748b', v: '#10b981', l: '#facc15' });
  const transitTags = Object.freeze({ awd: 'AWD/Off-Road', ferry: 'Ferry', flight: 'Flight', foot: 'Foot' });
  const purposeTags = Object.freeze({
    photography: 'Photography', anniversary: 'Anniversary', family: 'Friends/Family', solo: 'Solo', work: 'Work'
  });
  const isVisited = status => status === 'v' || status === 'l';
  const clearsFog = status => status === 't' || isVisited(status);
  const promote = (current, next) => {
    if (!Object.hasOwn(ranks, next)) throw new Error('Invalid status promotion.');
    return (ranks[current] || 0) > ranks[next] ? current : next;
  };
  const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id);

  function validateStatuses(values, county = false) {
    if (!values || typeof values !== 'object' || Array.isArray(values) ||
        Object.entries(values).some(([id, status]) => !Object.hasOwn(ranks, status) ||
          (county ? !/^\d{5}$/.test(id) : !id || ['__proto__', 'constructor', 'prototype'].includes(id)))) {
      throw new Error('Invalid passport status tiers.');
    }
    return { ...values };
  }

  function validateTags(tags, allowed) {
    if (!Array.isArray(tags) || new Set(tags).size !== tags.length || tags.some(tag => !Object.hasOwn(allowed, tag))) {
      throw new Error('Invalid expedition or location tags.');
    }
    return [...tags];
  }

  function validDate(date) {
    return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  }

  function validateExpeditions(expeditions, lookups) {
    if (!Array.isArray(expeditions)) throw new Error('Expeditions must be an array.');
    const ids = new Set();
    return expeditions.map(exp => {
      if (!exp || !validId(exp.id) || ids.has(exp.id) ||
          typeof exp.name !== 'string' || !exp.name.trim() || exp.name.length > 150 ||
          !validDate(exp.startDate) || !validDate(exp.endDate) || exp.startDate > exp.endDate) {
        throw new Error('Invalid expedition name, ID or date range.');
      }
      ids.add(exp.id);
      for (const field of ['countyIds', 'parkIds', 'customPoiIds']) {
        if (!Array.isArray(exp[field]) || new Set(exp[field]).size !== exp[field].length ||
            exp[field].some(id => field === 'countyIds' ? !/^\d{5}$/.test(id) : !validId(id))) {
          throw new Error('Invalid expedition location IDs.');
        }
      }
      if (!exp.countyIds.length && !exp.parkIds.length && !exp.customPoiIds.length) {
        throw new Error('Select at least one expedition location.');
      }
      if (!Array.isArray(exp.routeCoords)) throw new Error('Invalid expedition route.');
      exp.routeCoords.forEach(point => {
        if (!Array.isArray(point) || point.length !== 2) throw new Error('Invalid route coordinate.');
        lookups.validateCoordinates(...point);
      });
      const min = exp.minElevationFt;
      const max = exp.maxElevationFt;
      if (!(min === null && max === null) &&
          (!Number.isFinite(min) || !Number.isFinite(max) || min > max)) {
        throw new Error('Invalid expedition elevation extremes.');
      }
      if (exp.routeStops !== undefined) {
        if (!Array.isArray(exp.routeStops) || exp.routeStops.length !== exp.routeCoords.length || exp.routeStops.some((stop, index) =>
          !stop || !['county', 'park', 'poi'].includes(stop.kind) || !validId(stop.id) ||
          typeof stop.name !== 'string' || !stop.name.trim() ||
          !Array.isArray(stop.coords) || stop.coords.length !== 2 ||
          JSON.stringify(stop.coords) !== JSON.stringify(exp.routeCoords[index]) ||
          !(stop.kind === 'county' ? exp.countyIds : stop.kind === 'park' ? exp.parkIds : exp.customPoiIds).includes(stop.id) ||
          (stop.elevationFt !== undefined && !Number.isFinite(stop.elevationFt)) ||
          (stop.terrestrial !== undefined && typeof stop.terrestrial !== 'boolean'))) throw new Error('Invalid expedition stops.');
        exp.routeStops.forEach(stop => lookups.validateCoordinates(...stop.coords));
      }
      return {
        ...exp, transitTags: validateTags(exp.transitTags, transitTags),
        purposeTags: validateTags(exp.purposeTags, purposeTags),
        routeCoords: exp.routeCoords.map(point => [...point])
      };
    });
  }

  function normalizePoi(poi, lookups) {
    if (!poi || !validId(poi.id) || typeof poi.name !== 'string' || !poi.name.trim() ||
        poi.name.length > 150 || !Object.hasOwn(ranks, poi.status)) throw new Error('Invalid custom POI.');
    lookups.validateCoordinates(poi.lat, poi.lng);
    if (poi.elevation) lookups.validateCustomLocations([poi]);
    const elevationFt = poi.elevation?.feet ?? poi.elevationFt;
    if (!Number.isFinite(elevationFt) || !Array.isArray(poi.biomes) ||
        poi.biomes.some(biome => !/^(?:[1-9]|1[0-4])$/.test(biome))) throw new Error('Invalid POI elevation or biomes.');
    const political = poi.political || {
      countries: poi.country ? [poi.country] : [],
      states: poi.state ? [poi.state] : [],
      counties: poi.countyId ? [{ id: poi.countyId, name: poi.countyId }] : []
    };
    if (![political.countries, political.states].every(names => Array.isArray(names) &&
        names.every(name => typeof name === 'string' && name.trim())) ||
        !Array.isArray(political.counties) || political.counties.some(county =>
          !/^\d{5}$/.test(county?.id) || typeof county.name !== 'string')) throw new Error('Invalid POI regions.');
    const rarity = poi.rarity ? lookups.normalizeRarity(poi.rarity, poi.lat, poi.lng) : null;
    const rarityTier = rarity?.rarityTier ?? poi.rarityTier;
    if (rarityTier !== undefined && !['Uncharted', 'Hidden Gem', 'Deep Cut', 'Regional Staple', 'Beaten Path', 'Tourist Trap'].includes(rarityTier)) {
      throw new Error('Invalid POI rarity tier.');
    }
    const reviewCount = rarity ? rarity.reviewCount : poi.reviewCount ?? null;
    if (reviewCount !== null && (!Number.isSafeInteger(reviewCount) || reviewCount < 0)) throw new Error('Invalid POI review count.');
    if (reviewCount !== null && rarityTier !== undefined && rarityTier !== lookups.categoryForPoiCount(reviewCount)) {
      throw new Error('POI review count does not match its rarity tier.');
    }
    return {
      ...poi, political, elevationFt, country: political.countries[0] || '',
      state: political.states[0] || '', countyId: political.counties[0]?.id || null,
      rarity, rarityTier, reviewCount,
      category: typeof poi.category === 'string' ? poi.category : '',
      purposeTags: validateTags(poi.purposeTags ?? [], purposeTags)
    };
  }

  function migrateState(parsed, lookups, catalog) {
    const legacy = lookups.migrateState(parsed);
    const counties = validateStatuses(legacy.counties ?? {}, true);
    if (legacy.clearedCounties && (typeof legacy.clearedCounties !== 'object' || Array.isArray(legacy.clearedCounties))) {
      throw new Error('Invalid legacy county records.');
    }
    for (const [id, cleared] of Object.entries(legacy.clearedCounties ?? {})) {
      if (!/^\d{5}$/.test(id) || typeof cleared !== 'boolean') throw new Error('Invalid legacy county record.');
      if (cleared) counties[id] = promote(counties[id], 'v');
    }
    const incoming = parsed.customPois ?? legacy.customLocations;
    if (!Array.isArray(incoming)) throw new Error('Custom POIs must be an array.');
    const customPois = incoming.map(poi => normalizePoi(poi, lookups));
    if (new Set(customPois.map(poi => poi.id)).size !== customPois.length) throw new Error('Duplicate custom POI IDs.');
    if (parsed.customPois && legacy.customLocations.length &&
        JSON.stringify(customPois) !== JSON.stringify(legacy.customLocations.map(poi => normalizePoi(poi, lookups)))) {
      throw new Error('Conflicting custom POI and legacy custom-location ledgers.');
    }
    const pins = catalog.migratePins(validateStatuses(legacy.pins ?? {}));
    const regions = validateStatuses(legacy.regions ?? {});
    const expeditions = validateExpeditions(legacy.expeditions ?? [], lookups).map(exp => ({
      ...exp, parkIds: [...new Set(exp.parkIds.map(id => catalog.aliases[id] || id))],
      ...(exp.routeStops ? { routeStops: exp.routeStops.map(stop => ({
        ...stop, id: stop.kind === 'park' ? catalog.aliases[stop.id] || stop.id : stop.id
      })) } : {})
    }));
    if (expeditions.some(exp => exp.customPoiIds.some(id => !customPois.some(poi => poi.id === id)))) {
      throw new Error('Expedition references a missing custom POI.');
    }
    const homeBase = legacy.homeBase;
    if (homeBase) {
      lookups.validateCoordinates(homeBase.lat, homeBase.lng);
      if (typeof homeBase.name !== 'string' || !homeBase.name.trim() ||
          !Number.isFinite(homeBase.radiusKm) || homeBase.radiusKm <= 0 ||
          (homeBase.countyId && !/^\d{5}$/.test(homeBase.countyId))) throw new Error('Invalid home base.');
    }
    const migrated = { ...legacy, pins, regions, counties, customPois, expeditions };
    delete migrated.customLocations;
    delete migrated.clearedCounties;
    return migrated;
  }

  function syncDerivedState(state, { parks = [], countyRegions = {}, politicalAt = () => null } = {}) {
    const markRegions = (political, status) => {
      if (!political) return;
      for (const name of political.countries || []) state.regions[`c:${name}`] = promote(state.regions[`c:${name}`], status);
      for (const name of political.states || []) state.regions[`s:${name}`] = promote(state.regions[`s:${name}`], status);
      for (const county of political.counties || []) state.counties[county.id] = promote(state.counties[county.id], status);
    };
    const markCounty = (id, status) => {
      state.counties[id] = promote(state.counties[id], status);
      markRegions(countyRegions[id], status);
    };
    const markPark = (id, status) => {
      state.pins[id] = promote(state.pins[id], status);
      const park = parks.find(p => p.id === id);
      if (!park) return;
      // Catalog states can span many states; coordinate containment identifies the actual stop.
      const political = Number.isFinite(park.lat) && Number.isFinite(park.lng) ? politicalAt(park.lat, park.lng) : null;
      markRegions(political || {
        countries: park.intl ? (park.countryCode ? [park.country] : []) : ['United States of America'],
        states: park.intl ? [] : park.states || []
      }, status);
    };
    for (const exp of state.expeditions) {
      exp.parkIds.forEach(id => markPark(id, 'v'));
      exp.countyIds.forEach(id => markCounty(id, 'v'));
      exp.customPoiIds.forEach(id => {
        const poi = state.customPois.find(p => p.id === id);
        if (poi) poi.status = promote(poi.status, 'v');
      });
    }
    state.customPois.forEach(poi => markRegions(poi.political, poi.status));
    for (const [id, status] of Object.entries(state.pins)) markPark(id, status);
    for (const [id, status] of Object.entries(state.counties)) markCounty(id, status);
    if (state.homeBase) {
      const political = politicalAt(state.homeBase.lat, state.homeBase.lng);
      if (political) {
        state.homeBase.countyId = political.counties[0]?.id || null;
        markRegions(political, 'l');
      } else if (state.homeBase.countyId) markCounty(state.homeBase.countyId, 'l');
    }
    return state;
  }

  function metadataProgress(state) {
    const pois = state.customPois.filter(poi => isVisited(poi.status));
    const trips = state.expeditions;
    return {
      subterranean: pois.filter(poi => poi.biomes.length && poi.elevationFt < 0).length +
        trips.filter(exp => exp.minElevationFt !== null && exp.minElevationFt < 0).length,
      thinAir: pois.filter(poi => poi.elevationFt > 10000).length +
        trips.filter(exp => exp.maxElevationFt !== null && exp.maxElevationFt > 10000).length,
      whispers: pois.filter(poi => ['Uncharted', 'Hidden Gem'].includes(poi.rarityTier)).length,
      waterfalls: pois.filter(poi => poi.category?.trim().toLowerCase() === 'waterfall').length,
      overlander: trips.filter(exp => exp.transitTags.includes('awd')).length,
      mariner: trips.filter(exp => exp.transitTags.includes('ferry')).length,
      focal: pois.filter(poi => poi.purposeTags.includes('photography')).length +
        trips.filter(exp => exp.purposeTags.includes('photography')).length,
      borderlands: Math.max(0, ...trips.map(exp => exp.countyIds.length))
    };
  }

  const api = {
    ranks, labels, colors, transitTags, purposeTags, isVisited, clearsFog, promote,
    validateStatuses, validateTags, validateExpeditions, normalizePoi, migrateState, syncDerivedState, metadataProgress
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TravelLedger = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
