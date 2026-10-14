(function (root) {
  'use strict';
  const ranks = Object.freeze({ w: 1, t: 2, v: 3, l: 4 });
  const labels = Object.freeze({ w: 'Wishlist', t: 'Transited', v: 'Visited', l: 'Lived / Home Base' });
  const colors = Object.freeze({ w: '#f59e0b', t: '#64748b', v: '#10b981', l: '#facc15' });
  const transitTags = Object.freeze({ awd: 'AWD/Off-Road', ferry: 'Ferry / Boat', flight: 'Flight', foot: 'Foot' });
  const purposeTags = Object.freeze({
    photography: 'Photography', anniversary: 'Anniversary', family: 'Friends/Family', solo: 'Solo', work: 'Work'
  });
  const isVisited = status => status === 'v' || status === 'l';
  const homeRadiusKm = 15 * 1.609344 / 2;
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
    const migrated = {
      ...legacy, pins, regions, counties, customPois, expeditions,
      homeBase: homeBase ? { ...homeBase, radiusKm: homeRadiusKm } : null
    };
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

  function hasLoggedTravel(state) {
    return state.expeditions.length > 0 ||
      Object.values(state.pins).some(clearsFog) ||
      state.customPois.some(poi => clearsFog(poi.status)) ||
      (state.routes?.length || 0) > 0 || (state.clearedPolygons?.length || 0) > 0;
  }

  function loggedCountyStatuses(state, { includeHome = true, ...options } = {}) {
    // Re-derive exploration without manual county/region marks or mutating the passport.
    return syncDerivedState({
      pins: { ...state.pins }, regions: {}, counties: {},
      customPois: state.customPois.map(poi => ({ ...poi })),
      expeditions: state.expeditions,
      homeBase: includeHome && state.homeBase ? { ...state.homeBase } : null
    }, options).counties;
  }

  function overnightNights(expedition) {
    return (Date.parse(expedition.endDate) - Date.parse(expedition.startDate)) / 86400000;
  }

  function distanceMiles(a, b) {
    const radians = Math.PI / 180;
    const haversine = Math.sin((b.lat - a.lat) * radians / 2) ** 2 +
      Math.cos(a.lat * radians) * Math.cos(b.lat * radians) *
      Math.sin((b.lng - a.lng) * radians / 2) ** 2;
    return 3958.7613 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, haversine))));
  }

  function metadataProgress(state, { parks = [], politicalAt = () => null, biomeAt = () => [] } = {}) {
    const pois = state.customPois.filter(poi => isVisited(poi.status));
    const trips = state.expeditions;
    const visitedParks = parks.filter(park => isVisited(state.pins[park.id]));
    const locations = [...visitedParks, ...pois];
    const samples = new Map();
    const sample = (lat, lng, kind) => {
      const key = `${lat},${lng},${kind}`;
      if (!samples.has(key)) samples.set(key, kind === 'political' ? politicalAt(lat, lng) : biomeAt(lat, lng));
      return samples.get(key);
    };
    const points = new Map();
    const addPoint = point => {
      if (Number.isFinite(point.lat) && Number.isFinite(point.lng)) points.set(`${point.lat},${point.lng}`, point);
    };
    locations.forEach(addPoint);
    trips.forEach(trip => trip.routeCoords.forEach(([lat, lng]) => addPoint({ lat, lng })));
    const coordinates = [...points.values()];
    const collectedBiomes = new Set(locations.flatMap(location => location.biomes).map(String));
    trips.forEach(trip => trip.routeCoords.forEach(([lat, lng]) =>
      sample(lat, lng, 'biomes').forEach(biome => collectedBiomes.add(String(biome)))));
    const homeCounties = new Set(state.homeBase
      ? (sample(state.homeBase.lat, state.homeBase.lng, 'political')?.counties?.map(county => county.id) ||
        (state.homeBase.countyId ? [state.homeBase.countyId] : [])) : []);
    const homeCountries = new Set(state.homeBase
      ? sample(state.homeBase.lat, state.homeBase.lng, 'political')?.countries || [] : []);
    const awdLocations = new Set();
    trips.filter(trip => trip.transitTags.includes('awd')).forEach(trip => {
      for (const [field, prefix] of [['parkIds', 'park'], ['customPoiIds', 'poi'], ['countyIds', 'county']]) {
        trip[field].forEach(id => awdLocations.add(`${prefix}:${id}`));
      }
    });
    const datedPoints = new Map();
    trips.filter(trip => trip.startDate === trip.endDate).forEach(trip => {
      if (!datedPoints.has(trip.startDate)) datedPoints.set(trip.startDate, []);
      trip.routeCoords.forEach(([lat, lng]) => datedPoints.get(trip.startDate).push({ lat, lng }));
    });
    let fastTravel = 0;
    for (const dailyPoints of datedPoints.values()) {
      if (dailyPoints.length) fastTravel = Math.max(fastTravel, 1);
      for (let i = 0; i < dailyPoints.length && fastTravel < 2; i++) {
        for (let j = i + 1; j < dailyPoints.length; j++) {
          if (distanceMiles(dailyPoints[i], dailyPoints[j]) > 500) { fastTravel = 2; break; }
        }
      }
      if (fastTravel === 2) break;
    }
    const radians = Math.PI / 180;
    const vectors = coordinates.map(point => [
      Math.cos(point.lat * radians) * Math.cos(point.lng * radians),
      Math.cos(point.lat * radians) * Math.sin(point.lng * radians), Math.sin(point.lat * radians)
    ]);
    const antipodeLimit = -Math.cos(100 / 3958.7613);
    let earthSandwich = coordinates.length ? 1 : 0;
    for (let i = 0; i < vectors.length && earthSandwich < 2; i++) {
      for (let j = i + 1; j < vectors.length; j++) {
        if (vectors[i][0] * vectors[j][0] + vectors[i][1] * vectors[j][1] + vectors[i][2] * vectors[j][2] <= antipodeLimit) {
          earthSandwich = 2; break;
        }
      }
    }
    return {
      subterranean: pois.filter(poi => poi.biomes.length && poi.elevationFt < 0).length +
        trips.filter(exp => exp.minElevationFt !== null && exp.minElevationFt < 0).length,
      thinAir: pois.filter(poi => poi.elevationFt >= 10000).length +
        trips.filter(exp => exp.maxElevationFt !== null && exp.maxElevationFt >= 10000).length,
      whispers: pois.filter(poi => ['Uncharted', 'Hidden Gem'].includes(poi.rarityTier)).length,
      waterfalls: pois.filter(poi => poi.category?.trim().toLowerCase() === 'waterfall').length,
      overlander: awdLocations.size,
      mariner: trips.filter(exp => exp.transitTags.includes('ferry')).length,
      focal: pois.filter(poi => poi.purposeTags.includes('photography')).length +
        trips.filter(exp => exp.purposeTags.includes('photography')).length,
      southernCross: trips.filter(trip => overnightNights(trip) >= 1 &&
        trip.routeCoords.some(([lat]) => lat < 0)).length,
      localLore: pois.filter(poi => poi.rarityTier === 'Hidden Gem' &&
        poi.political.counties.some(county => homeCounties.has(county.id))).length,
      zeroMeridian: state.homeBase ? 1 : 0,
      beyondHorizon: coordinates.some(point => state.homeBase && distanceMiles(state.homeBase, point) > 1000) ? 1 : 0,
      international: homeCountries.size ? coordinates.filter(point => {
        const countries = point.political?.countries ||
          (point.intl && point.countryCode ? [point.country] : sample(point.lat, point.lng, 'political')?.countries || []);
        return countries.some(country => !homeCountries.has(country));
      }).length : 0,
      touchGrass: visitedParks.filter(park =>
        /\b(?:National|State|Provincial) (?:Park(?:s)?|and State Parks)\b/i.test(park.designation || '') ||
        (!park.intl && park.id === 'npsa')).length,
      fastTravel,
      earthSandwich,
      longDark: coordinates.filter(point => point.lat > 66.5 || point.lat < -66.5).length,
      latitudeSpan: coordinates.length
        ? Math.max(...coordinates.map(point => point.lat)) - Math.min(...coordinates.map(point => point.lat)) : 0,
      collectedBiomes
    };
  }

  const api = {
    ranks, labels, colors, transitTags, purposeTags, isVisited, clearsFog, promote,
    homeRadiusKm, hasLoggedTravel, overnightNights, distanceMiles, validateStatuses, validateTags, validateExpeditions, normalizePoi, migrateState, syncDerivedState, loggedCountyStatuses, metadataProgress
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TravelLedger = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
