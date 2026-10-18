(function (root) {
  'use strict';
  const ranks = Object.freeze({ w: 1, t: 2, v: 3, l: 4 });
  const labels = Object.freeze({ w: 'Wishlist', t: 'Transited', v: 'Visited', l: 'Lived / Home Base' });
  const colors = Object.freeze({ w: '#ec4899', t: '#64748b', v: '#10b981', l: '#3b82f6' });
  const transitTags = Object.freeze({ road: 'Drive / Road Trip', awd: 'AWD/Off-Road', ferry: 'Ferry / Boat', flight: 'Flight', rail: 'Rail / Train', foot: 'Walk / Hike' });
  const transitIcons = Object.freeze({ road: '🚙', awd: '🚙', ferry: '⛴️', flight: '✈️', rail: '🚆', foot: '🥾' });
  const purposeTags = Object.freeze({
    photography: 'Photography', anniversary: 'Anniversary', family: 'Friends/Family', solo: 'Solo', work: 'Work'
  });
  const isVisited = status => status === 'v' || status === 'l';
  const homeRadiusKm = 15 * 1.609344 / 2;
  const coloradoPlainsCounties = new Set([
    '08075', '08087', '08115', '08095', '08121', '08125', '08063', '08017',
    '08073', '08039', '08061', '08025', '08009', '08011', '08089', '08099'
  ]);
  const coloradoCounties = new Set([
    ...Array.from({ length: 63 }, (_, index) => `08${String(index * 2 + 1).padStart(3, '0')}`), '08014'
  ]);
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

  function validateStatusOverrides(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).some(field => !['pins', 'regions', 'counties', 'nationalParks'].includes(field))) {
      throw new Error('Invalid map status overrides.');
    }
    const overrides = { pins: {}, regions: {}, counties: {}, nationalParks: {} };
    for (const field of ['pins', 'regions', 'counties']) {
      const records = value[field] ?? {};
      if (!records || typeof records !== 'object' || Array.isArray(records) ||
          Object.entries(records).some(([id, status]) => !Object.hasOwn(ranks, status) && status !== 'un' ||
            (field === 'counties' ? !/^\d{5}$/.test(id) :
              !id || ['__proto__', 'constructor', 'prototype'].includes(id)))) {
        throw new Error('Invalid map status overrides.');
      }
      overrides[field] = { ...records };
    }
    const nationalParks = value.nationalParks ?? {};
    if (!nationalParks || typeof nationalParks !== 'object' || Array.isArray(nationalParks) ||
        Object.entries(nationalParks).some(([id, status]) =>
          !['sequ', 'kica'].includes(id) || (!Object.hasOwn(ranks, status) && status !== 'un'))) {
      throw new Error('Invalid map status overrides.');
    }
    overrides.nationalParks = { ...nationalParks };
    return overrides;
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
          ([exp.startDate, exp.endDate].some(date => date !== undefined && date !== null && date !== '' && !validDate(date))) ||
          (exp.startDate && exp.endDate && exp.startDate > exp.endDate) ||
          (exp.dayTrip !== undefined && typeof exp.dayTrip !== 'boolean') ||
          (exp.dayTrip && (!validDate(exp.startDate) || exp.startDate !== exp.endDate)) ||
          (exp.reason !== undefined && (typeof exp.reason !== 'string' || exp.reason.length > 1000))) {
        throw new Error('Invalid expedition name, ID or date range.');
      }
      ids.add(exp.id);
      for (const field of ['countyIds', 'parkIds', 'customPoiIds']) {
        if (!Array.isArray(exp[field]) || new Set(exp[field]).size !== exp[field].length ||
            exp[field].some(id => field === 'countyIds' ? !/^\d{5}$/.test(id) : !validId(id))) {
          throw new Error('Invalid expedition location IDs.');
        }
      }
      if (!exp.countyIds.length && !exp.parkIds.length && !exp.customPoiIds.length && !exp.routeStops?.length) {
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
          !stop || !['county', 'park', 'poi', 'place'].includes(stop.kind) || !validId(stop.id) ||
          typeof stop.name !== 'string' || !stop.name.trim() ||
          !Array.isArray(stop.coords) || stop.coords.length !== 2 ||
          JSON.stringify(stop.coords) !== JSON.stringify(exp.routeCoords[index]) ||
          (stop.kind !== 'place' && !(stop.kind === 'county' ? exp.countyIds : stop.kind === 'park' ? exp.parkIds : exp.customPoiIds).includes(stop.id)) ||
          (stop.elevationFt !== undefined && !Number.isFinite(stop.elevationFt)) ||
          (stop.terrestrial !== undefined && typeof stop.terrestrial !== 'boolean'))) throw new Error('Invalid expedition stops.');
        exp.routeStops.forEach(stop => lookups.validateCoordinates(...stop.coords));
      }
      if (exp.routeLegs !== undefined) {
        if (!exp.routeStops?.length || exp.routeStops.length > 100 || !Array.isArray(exp.routeLegs) ||
            exp.routeLegs.length !== exp.routeStops.length - 1) throw new Error('Invalid expedition travel legs.');
        exp.routeLegs.forEach((leg, index) => {
          const routeSource = leg?.routeSource ?? (leg?.mode === 'flight' ? 'none' :
            ['road', 'awd'].includes(leg?.mode) ? 'routed' : 'direct');
          if (!leg || !Object.hasOwn(transitTags, leg.mode) ||
              !['routed', 'direct', 'uploaded', 'none'].includes(routeSource) || !Array.isArray(leg.routeCoords) ||
              !Array.isArray(leg.countyIds) || new Set(leg.countyIds).size !== leg.countyIds.length ||
              leg.countyIds.some(id => !/^\d{5}$/.test(id)) ||
              (leg.mode === 'flight' ? routeSource === 'none'
                ? leg.routeCoords.length || leg.countyIds.length
                : routeSource !== 'uploaded' || leg.routeCoords.length < 2 || leg.countyIds.length :
                routeSource === 'none' || leg.routeCoords.length < 2 ||
                (routeSource === 'direct' && leg.routeCoords.length !== 2)) ||
              ((['road', 'awd'].includes(leg.mode) && !['routed', 'uploaded'].includes(routeSource)) ||
                (!['road', 'awd'].includes(leg.mode) && leg.countyIds.length) ||
                (routeSource === 'routed' && !['road', 'awd', 'ferry'].includes(leg.mode)) ||
                (['foot', 'rail'].includes(leg.mode) && !['direct', 'uploaded'].includes(routeSource)) ||
                (leg.mode === 'ferry' && !['routed', 'direct', 'uploaded'].includes(routeSource)))) {
            throw new Error('Invalid expedition travel leg.');
          }
          leg.routeCoords.forEach(point => {
            if (!Array.isArray(point) || point.length !== 2) throw new Error('Invalid leg coordinate.');
            lookups.validateCoordinates(...point);
          });
          if (routeSource !== 'none') {
            const endpoints = [leg.routeCoords[0], leg.routeCoords[leg.routeCoords.length - 1]];
            endpoints.forEach((point, offset) => {
              const stop = exp.routeStops[index + offset];
              const distance = distanceMiles(
                {lat:point[0],lng:point[1]},
                {lat:stop.coords[0],lng:stop.coords[1]}
              );
              if (distance > 1) {
                const from = exp.routeStops[index].name;
                const to = exp.routeStops[index + 1].name;
                const endpoint = offset === 0 ? 'start' : 'end';
                throw new Error(
                  `Leg ${index + 1} (${transitTags[leg.mode]}) from "${from}" to "${to}" ` +
                  `has a route ${endpoint} ${distance.toFixed(1)} miles from "${stop.name}" ` +
                  '(maximum allowed: 1 mile).'
                );
              }
            });
          }
        });
        const modes = [...new Set(exp.routeLegs.map(leg => leg.mode))];
        if (exp.routeLegs.length && JSON.stringify([...exp.transitTags].sort()) !== JSON.stringify(modes.sort())) {
          throw new Error('Expedition transit modes do not match its travel legs.');
        }
      }
      return {
        ...exp, transitTags: validateTags(exp.transitTags, transitTags),
        purposeTags: validateTags(exp.purposeTags, purposeTags),
        routeCoords: exp.routeCoords.map(point => [...point]),
        // Normalize legacy road-routed ferries without discarding imported tracks.
        ...(exp.routeLegs ? { routeLegs: exp.routeLegs.map((leg, index) => ({
          ...leg,
          routeSource: leg.mode === 'ferry' && (leg.routeSource ?? 'direct') === 'routed' ? 'direct' :
            leg.routeSource ?? (leg.mode === 'flight' ? 'none' :
              ['road', 'awd'].includes(leg.mode) ? 'routed' : 'direct'),
          routeCoords: leg.mode === 'ferry' && (leg.routeSource ?? 'direct') === 'routed'
            ? exp.routeStops.slice(index, index + 2).map(stop => [...stop.coords])
            : leg.routeCoords.map(point => [...point]),
          countyIds: [...leg.countyIds]
        })) } : {})
      };
    });
  }

  function normalizePoi(poi, lookups) {
    if (!poi || !validId(poi.id) || typeof poi.name !== 'string' || !poi.name.trim() ||
        poi.name.length > 150 || !Object.hasOwn(ranks, poi.status)) throw new Error('Invalid custom POI.');
    lookups.validateCoordinates(poi.lat, poi.lng);
    if (poi.elevation) lookups.validateCustomLocations([poi]);
    const photonCity = poi.source === 'Photon' && poi.category === 'City';
    if (photonCity && !/^(?:node|way|relation):\d+$/.test(poi.photonId || '')) {
      throw new Error('Invalid Photon city reference.');
    }
    const elevationFt = poi.elevation?.feet ?? poi.elevationFt;
    if ((!photonCity && !Number.isFinite(elevationFt)) ||
        (photonCity && elevationFt !== undefined && elevationFt !== null && !Number.isFinite(elevationFt)) ||
        !Array.isArray(poi.biomes) ||
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
      ...poi, political, elevationFt: elevationFt ?? null, country: political.countries[0] || '',
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
    const nationalParkScratch = parsed.nationalParkScratch ?? {};
    if (!nationalParkScratch || typeof nationalParkScratch !== 'object' || Array.isArray(nationalParkScratch) ||
        Object.entries(nationalParkScratch).some(([id, status]) =>
          !['sequ', 'kica'].includes(id) || !['un', 'v', 'w'].includes(status))) {
      throw new Error('Invalid National Parks scratch records.');
    }
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
      ...legacy, pins, regions, counties, customPois, expeditions, nationalParkScratch: { ...nationalParkScratch },
      statusOverrides: validateStatusOverrides(parsed.statusOverrides),
      expeditionPromotions: validatePromotions(parsed.expeditionPromotions),
      homeBase: homeBase ? { ...homeBase, radiusKm: homeRadiusKm } : null
    };
    delete migrated.customLocations;
    delete migrated.clearedCounties;
    return migrated;
  }

  function syncDerivedState(state, { parks = [], countyRegions = {}, politicalAt = () => null } = {}) {
    restoreExpeditionPromotions(state);
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
    const before = promotionValues(state);
    for (const exp of state.expeditions) {
      exp.parkIds.forEach(id => markPark(id, 'v'));
      exp.countyIds.forEach(id => markCounty(id, 'v'));
      exp.customPoiIds.forEach(id => {
        const poi = state.customPois.find(p => p.id === id);
        if (poi) {
          poi.status = promote(poi.status, 'v');
          markRegions(poi.political, poi.status);
        }
      });
      if (exp.routeLegs) {
        exp.routeCoords.forEach(([lat, lng]) => markRegions(politicalAt(lat, lng), 'v'));
        exp.routeLegs.forEach(leg => leg.countyIds.forEach(id => markCounty(id, 'v')));
      }
    }
    const after = promotionValues(state);
    state.expeditionPromotions = {};
    for (const field of Object.keys(after)) {
      const changes = {};
      for (const [id, status] of Object.entries(after[field])) {
        if (before[field][id] !== status) changes[id] = { before: before[field][id] ?? null, after: status };
      }
      if (Object.keys(changes).length) state.expeditionPromotions[field] = changes;
    }
    for (const field of ['pins', 'regions', 'counties']) {
      for (const [id, status] of Object.entries(state.statusOverrides?.[field] || {})) {
        if (status === 'un') delete state[field][id];
        else state[field][id] = status;
      }
    }
    return state;
  }

  function promotionValues(state) {
    return { pins: { ...state.pins }, regions: { ...state.regions }, counties: { ...state.counties },
      poiStatuses: Object.fromEntries(state.customPois.map(poi => [poi.id, poi.status])) };
  }

  function validatePromotions(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid expedition promotion records.');
    const result = {};
    for (const [field, changes] of Object.entries(value)) {
      if (!['pins', 'regions', 'counties', 'poiStatuses'].includes(field) || !changes ||
          typeof changes !== 'object' || Array.isArray(changes)) throw new Error('Invalid expedition promotion records.');
      result[field] = {};
      for (const [id, change] of Object.entries(changes)) {
        if (!id || ['__proto__', 'constructor', 'prototype'].includes(id) ||
            (field === 'counties' && !/^\d{5}$/.test(id)) || !change ||
            (change.before !== null && !Object.hasOwn(ranks, change.before)) || change.after !== 'v' ||
            (field === 'poiStatuses' && change.before === null) ||
            (ranks[change.before] || 0) >= ranks[change.after]) throw new Error('Invalid expedition promotion records.');
        result[field][id] = { before: change.before, after: change.after };
      }
    }
    return result;
  }

  function restoreExpeditionPromotions(state) {
    for (const [field, changes] of Object.entries(state.expeditionPromotions || {})) {
      for (const [id, change] of Object.entries(changes)) {
        if (field === 'poiStatuses') {
          const poi = state.customPois.find(poi => poi.id === id);
          if (poi?.status === change.after) poi.status = change.before;
        } else if (state.statusOverrides?.[field]?.[id] !== undefined || state[field][id] === change.after) {
          if (change.before === null) delete state[field][id];
          else state[field][id] = change.before;
        }
      }
    }
    state.expeditionPromotions = {};
  }

  function fogRoutes(expedition) {
    if (expedition.routeLegs) return expedition.routeLegs
      .filter(leg => ['road', 'awd'].includes(leg.mode) && ['routed', 'uploaded'].includes(leg.routeSource ?? 'routed'))
      .map(leg => leg.routeCoords);
    return expedition.transitTags.some(mode => !['road', 'awd'].includes(mode)) ? [] : [expedition.routeCoords];
  }

  const waterFogEndpointCache = new WeakMap();
  function waterFogRoutes(expedition) {
    if (!expedition.routeLegs) {
      return expedition.transitTags.some(mode => ['ferry', 'flight'].includes(mode))
        ? [expedition.routeCoords] : [];
    }
    return expedition.routeLegs.flatMap((leg, index) => {
      if (!['ferry', 'flight'].includes(leg.mode)) return [];
      if (leg.mode !== 'flight' || (leg.routeSource !== 'none' && leg.routeCoords?.length)) {
        return [leg.routeCoords];
      }
      const start = expedition.routeStops[index].coords;
      const end = expedition.routeStops[index + 1].coords;
      let cached = waterFogEndpointCache.get(leg);
      if (!cached || cached[0] !== start || cached[1] !== end) {
        cached = [start, end];
        waterFogEndpointCache.set(leg, cached);
      }
      return [cached];
    });
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
    return validDate(expedition.startDate) && validDate(expedition.endDate)
      ? (Date.parse(expedition.endDate) - Date.parse(expedition.startDate)) / 86400000 : 0;
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
      if (trip.routeLegs) {
        trip.routeLegs.forEach((leg, index) => {
          if (leg.mode !== 'awd') return;
          trip.routeStops.slice(index, index + 2).forEach(stop =>
            awdLocations.add(stop.kind === 'place' ? `place:${stop.coords.join(',')}` : `${stop.kind}:${stop.id}`));
        });
        return;
      }
      for (const [field, prefix] of [['parkIds', 'park'], ['customPoiIds', 'poi'], ['countyIds', 'county']]) {
        trip[field].forEach(id => awdLocations.add(`${prefix}:${id}`));
      }
    });
    const datedPoints = new Map();
    trips.filter(trip => validDate(trip.startDate) && trip.startDate === trip.endDate).forEach(trip => {
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
    const visitedCountyIds = new Set(Object.entries(state.counties)
      .filter(([, status]) => isVisited(status)).map(([id]) => id));
    pois.forEach(poi => poi.political.counties.forEach(county => visitedCountyIds.add(county.id)));
    trips.forEach(trip => trip.countyIds.forEach(id => visitedCountyIds.add(id)));
    coordinates.forEach(point => {
      sample(point.lat, point.lng, 'political')?.counties?.forEach(county => visitedCountyIds.add(county.id));
    });
    const westVirginia = isVisited(state.regions['s:West Virginia']) ||
      locations.some(location => !location.intl && (location.states || location.political?.states || []).includes('West Virginia')) ||
      coordinates.some(point => sample(point.lat, point.lng, 'political')?.states?.includes('West Virginia'));
    const visitedPark = id => isVisited(state.pins[id]) || trips.some(trip => trip.parkIds.includes(id));
    const categoryVisited = category => pois.some(poi => poi.category?.trim().toLowerCase() === category);
    const mountains = visitedPark('blri') || visitedPark('grsm') || categoryVisited('blue ridge mountains');
    const river = categoryVisited('shenandoah river');
    const countryRoadsDestination = visitedPark('shen') ? 1 : (Number(mountains) + Number(river)) / 2;
    return {
      countryRoads: Number(westVirginia) + countryRoadsDestination,
      rockyMountainHigh: [...visitedCountyIds].filter(id => coloradoCounties.has(id) && !coloradoPlainsCounties.has(id)).length,
      subterranean: pois.filter(poi => poi.biomes.length && poi.elevationFt < 0).length +
        trips.filter(exp => exp.minElevationFt !== null && exp.minElevationFt < 0).length,
      thinAir: pois.filter(poi => poi.elevationFt >= 10000).length +
        trips.filter(exp => exp.maxElevationFt !== null && exp.maxElevationFt >= 10000).length,
      whispers: pois.filter(poi => ['Uncharted', 'Hidden Gem'].includes(poi.rarityTier)).length,
      waterfalls: pois.filter(poi => poi.category?.trim().toLowerCase() === 'waterfall').length,
      overlander: awdLocations.size,
      mariner: trips.filter(exp => exp.transitTags.includes('ferry')).length,
      focal: pois.filter(poi => poi.purposeTags.includes('photography')).length +
        trips.filter(exp => exp.purposeTags.includes('photography') || /\bphotography\b/i.test(exp.reason || '')).length,
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
    ranks, labels, colors, transitTags, transitIcons, purposeTags, isVisited, clearsFog, promote,
    homeRadiusKm, hasLoggedTravel, overnightNights, distanceMiles, fogRoutes, waterFogRoutes, restoreExpeditionPromotions,
    validateStatuses, validateTags, validateExpeditions, normalizePoi, migrateState, syncDerivedState, loggedCountyStatuses, metadataProgress
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TravelLedger = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
