(function (root) {
  'use strict';

  const ELEVATION_URL = 'https://api.open-meteo.com/v1/elevation';
  const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
  const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
  const NPS_SOURCE = 'https://services1.arcgis.com/fBc8EJBxQRMcHlei/ArcGIS/rest/services/NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer/2';

  function npsBoundaryIndex(topology, decode) {
    if (topology?.type !== 'Topology' || topology.metadata?.source !== NPS_SOURCE ||
        topology.metadata.version !== 1 || !topology.objects?.parks) throw new Error('Invalid NPS boundary snapshot.');
    const features = decode(topology, topology.objects.parks).features;
    if (!Array.isArray(features) || features.length < 400) throw new Error('Incomplete NPS boundary snapshot.');
    const index = {};
    for (const feature of features) {
      const code = feature.properties?.parkCode;
      if (!/^[a-z0-9]{4}$/.test(code) || !['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)) {
        throw new Error('Invalid NPS boundary geometry or unit code.');
      }
      (index[code] ||= []).push(feature.geometry);
    }
    // The NPS API combines two units that Land Resources publishes separately.
    if (index.sequ && index.kica) index.seki = [...index.sequ, ...index.kica];
    return index;
  }

  function validateCoordinates(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new Error('Enter a latitude from -90 to 90 and a longitude from -180 to 180.');
    }
  }

  function normalizeFeature(feature, geoArea) {
    const geometry = feature.geometry;
    if (!['Polygon', 'MultiPolygon'].includes(geometry?.type)) throw new Error('Expected polygon geography.');
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    // D3's spherical containment expects clockwise exteriors, unlike RFC 7946 GeoJSON.
    const coordinates = polygons.map(rings => geoArea({ type: 'Polygon', coordinates: rings }) > 2 * Math.PI
      ? rings.map(ring => [...ring].reverse())
      : rings);
    return { ...feature, geometry: { ...geometry, coordinates: geometry.type === 'Polygon' ? coordinates[0] : coordinates } };
  }

  function indexFeatures(features, geo) {
    return features.map(feature => {
      const normalized = normalizeFeature(feature, geo.geoArea);
      return { feature: normalized, bounds: geo.geoBounds(normalized) };
    });
  }

  function findContaining(index, lat, lng, geoContains) {
    validateCoordinates(lat, lng);
    return index.filter(({ feature, bounds: [[west, south], [east, north]] }) =>
      lat >= south && lat <= north &&
      (west <= east ? lng >= west && lng <= east : lng >= west || lng <= east) &&
      geoContains(feature, [lng, lat])).map(item => item.feature);
  }

  function politicalRegion(lat, lng, indexes, geoContains) {
    const countries = findContaining(indexes.countries, lat, lng, geoContains);
    const states = findContaining(indexes.states, lat, lng, geoContains);
    const counties = findContaining(indexes.counties, lat, lng, geoContains);
    return {
      countries: countries.map(feature => feature.properties.name),
      states: states.map(feature => feature.properties.name),
      counties: counties.map(feature => ({ id: String(feature.id).padStart(5, '0'), name: feature.properties.name })),
      method: 'Simplified atlas polygon containment; approximate at borders and coasts.'
    };
  }

  function biomeRegion(lat, lng, index, geoContains) {
    const regions = findContaining(index, lat, lng, geoContains).map(feature => ({
      id: feature.properties.ECO_ID, name: feature.properties.ECO_NAME,
      biomeId: feature.properties.BIOME_NUM, realm: feature.properties.REALM
    }));
    return {
      ecoregions: regions,
      biomes: [...new Set(regions.map(region => String(region.biomeId)))],
      biomeStatus: regions.length ? 'matched' : 'no-terrestrial-match'
    };
  }

  async function fetchJson(url, options, fetcher) {
    const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error(`Lookup request failed (HTTP ${response.status}).`);
    return response.json();
  }

  async function lookupElevation(lat, lng, fetcher) {
    validateCoordinates(lat, lng);
    const data = await fetchJson(`${ELEVATION_URL}?${new URLSearchParams({ latitude: lat, longitude: lng })}`, {}, fetcher);
    if (!Array.isArray(data.elevation) || data.elevation.length !== 1 || !Number.isFinite(data.elevation[0])) {
      throw new Error('Elevation provider returned no valid elevation.');
    }
    return { meters: data.elevation[0], feet: data.elevation[0] * 3.28084, source: ELEVATION_URL };
  }

  function categoryForPoiCount(count) {
    if (!Number.isInteger(count) || count < 0) throw new Error('Invalid OSM POI count.');
    if (count > 10000) return 'Tourist Trap';
    if (count >= 1000) return 'Beaten Path';
    if (count >= 100) return 'Regional Staple';
    if (count >= 30) return 'Deep Cut';
    if (count >= 10) return 'Hidden Gem';
    return 'Uncharted';
  }

  function validateProviderRarity(data) {
    if (!data || typeof data.placeName !== 'string' || !data.placeName.trim() ||
        !(data.reviewCount === null || (Number.isSafeInteger(data.reviewCount) && data.reviewCount >= 0)) ||
        !Number.isSafeInteger(data.popularityScore) || data.popularityScore < 0 ||
        typeof data.cached !== 'boolean' || typeof data.source !== 'string' || !data.source.trim() ||
        data.source.length > 500 || data.placeName.length > 300 ||
        data.rarityTier !== categoryForPoiCount(data.reviewCount ?? data.popularityScore)) {
      throw new Error('Rarity endpoint returned invalid provider metadata.');
    }
    validateCoordinates(data.matchedLat, data.matchedLng);
    return data;
  }

  function normalizeRarity(rarity, lat, lng) {
    if (rarity?.method === 'osm-poi-density') {
      if (rarity.category !== categoryForPoiCount(rarity.nearbyPoiCount) ||
          !(rarity.nearestHighwayKm === null || (Number.isFinite(rarity.nearestHighwayKm) &&
            rarity.nearestHighwayKm >= 0 && rarity.nearestHighwayKm <= 5))) {
        throw new Error('Invalid OSM rarity metadata.');
      }
      const matchedLat = rarity.sampledAt?.lat ?? lat;
      const matchedLng = rarity.sampledAt?.lng ?? lng;
      validateCoordinates(matchedLat, matchedLng);
      return {
        ...rarity, placeName: rarity.placeName || 'OSM vicinity (not a matched place)',
        reviewCount: null, popularityScore: rarity.nearbyPoiCount, rarityTier: rarity.category,
        matchedLat, matchedLng, cached: rarity.cached ?? false,
        source: 'OpenStreetMap contributors (ODbL)'
      };
    }
    validateProviderRarity(rarity);
    return {
      ...rarity, category: rarity.rarityTier,
      method: rarity.reviewCount === null ? 'provider-popularity' : 'provider-review-count'
    };
  }

  function coordinateDistanceKm(lat, lng, matchedLat, matchedLng) {
    const radians = Math.PI / 180;
    const a = Math.sin((matchedLat - lat) * radians / 2) ** 2 +
      Math.cos(lat * radians) * Math.cos(matchedLat * radians) *
      Math.sin((matchedLng - lng) * radians / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(Math.min(1, a)));
  }

  async function lookupRarityWithFallback(lat, lng, {
    fetcher = root.fetch, storage, rarityEndpoint = '', onFallback = () => {}
  } = {}) {
    validateCoordinates(lat, lng);
    if (rarityEndpoint) {
      try {
        const url = new URL(rarityEndpoint);
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
          throw new Error('Rarity endpoint must use HTTPS (HTTP is allowed only on localhost).');
        }
        url.searchParams.set('lat', lat);
        url.searchParams.set('lng', lng);
        const response = await fetcher(url.toString(), { signal: AbortSignal.timeout(35000) });
        if (!response.ok) throw new Error(`Rarity endpoint failed (HTTP ${response.status}).`);
        const data = validateProviderRarity(await response.json());
        if (coordinateDistanceKm(lat, lng, data.matchedLat, data.matchedLng) > 1) {
          throw new Error('Rarity endpoint matched a location more than 1 km from the requested point.');
        }
        return normalizeRarity({
          ...data, method: data.reviewCount === null ? 'provider-popularity' : 'provider-review-count'
        }, lat, lng);
      } catch (error) {
        console.warn('Rarity endpoint unavailable; using the direct OSM density lookup.', error);
        onFallback(error);
      }
    }
    return normalizeRarity(await lookupRarity(lat, lng, fetcher, storage), lat, lng);
  }

  function segmentDistanceKm(lat, lng, a, b) {
    const scale = Math.cos(lat * Math.PI / 180);
    const relative = point => {
      const delta = ((point.lon - lng + 540) % 360) - 180;
      return [delta * scale * 111.195, (point.lat - lat) * 111.195];
    };
    const [ax, ay] = relative(a);
    const [bx, by] = relative(b);
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared)) : 0;
    return Math.hypot(ax + t * dx, ay + t * dy);
  }

  function summarizeOsm(elements, lat, lng) {
    if (!Array.isArray(elements)) throw new Error('Overpass returned no valid elements.');
    const pois = new Set();
    let nearest = Infinity;
    for (const element of elements) {
      if (element.type === 'node' && (element.tags?.amenity || element.tags?.tourism)) pois.add(element.id);
      if (element.type === 'way' && ['motorway', 'trunk'].includes(element.tags?.highway)) {
        if (!Array.isArray(element.geometry) || element.geometry.some(point =>
          !Number.isFinite(point.lat) || !Number.isFinite(point.lon))) {
          throw new Error('Overpass returned incomplete highway geometry.');
        }
        for (let index = 1; index < element.geometry.length; index++) {
          nearest = Math.min(nearest, segmentDistanceKm(lat, lng, element.geometry[index - 1], element.geometry[index]));
        }
      }
    }
    return {
      category: categoryForPoiCount(pois.size), nearbyPoiCount: pois.size,
      nearestHighwayKm: nearest <= 5 ? nearest : null, radiusKm: 5,
      method: 'osm-poi-density', source: 'https://www.openstreetmap.org/copyright',
      sampledAt: { lat, lng }
    };
  }

  async function lookupRarity(lat, lng, fetcher, storage) {
    validateCoordinates(lat, lng);
    const gridLat = Number(lat.toFixed(3));
    const gridLng = Number(lng.toFixed(3));
    const key = `terra_osm_v1:${gridLat.toFixed(3)},${gridLng.toFixed(3)}`;
    const now = Date.now();
    if (storage) {
      const raw = storage.getItem(key);
      if (raw) {
        try {
          const cached = JSON.parse(raw);
          if (cached.version !== 1 || !Number.isFinite(cached.savedAt) ||
              cached.data?.method !== 'osm-poi-density' || cached.data.radiusKm !== 5 ||
              cached.data.category !== categoryForPoiCount(cached.data.nearbyPoiCount) ||
              cached.data.sampledAt?.lat !== gridLat || cached.data.sampledAt?.lng !== gridLng ||
              !(cached.data.nearestHighwayKm === null || (Number.isFinite(cached.data.nearestHighwayKm) &&
                cached.data.nearestHighwayKm >= 0 && cached.data.nearestHighwayKm <= 5))) {
            throw new Error('Invalid cached OSM metadata.');
          }
          if (now - cached.savedAt >= 0 && now - cached.savedAt < CACHE_TTL) return { ...cached.data, cached: true };
        } catch (error) {
          console.warn('Discarding invalid OSM cache entry', key, error);
          storage.removeItem(key);
        }
      }
    }
    const query = `[out:json][timeout:30];(node(around:5000,${gridLat},${gridLng})["tourism"];` +
      `node(around:5000,${gridLat},${gridLng})["amenity"];` +
      `way(around:5000,${gridLat},${gridLng})["highway"~"^(motorway|trunk)$"];);out body geom;`;
    const result = await fetchJson(OVERPASS_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: query }).toString()
    }, fetcher);
    if (result.remark) throw new Error(`Overpass could not complete the query: ${result.remark}`);
    const data = summarizeOsm(result.elements, gridLat, gridLng);
    if (storage) storage.setItem(key, JSON.stringify({ version: 1, savedAt: now, data }));
    return { ...data, cached: false };
  }

  async function lookupCoordinate(lat, lng, {
    indexes, geoContains, fetcher = root.fetch, storage, rarityEndpoint = '', onFallback
  }) {
    validateCoordinates(lat, lng);
    if (!indexes?.countries?.length || !indexes?.states?.length || !indexes?.counties?.length || !indexes?.ecoregions?.length) {
      throw new Error('Coordinate geography is unavailable. Retry datasets before saving a custom location.');
    }
    const [elevation, political, biome, rarity] = await Promise.all([
      lookupElevation(lat, lng, fetcher),
      Promise.resolve().then(() => politicalRegion(lat, lng, indexes, geoContains)),
      Promise.resolve().then(() => biomeRegion(lat, lng, indexes.ecoregions, geoContains)),
      lookupRarityWithFallback(lat, lng, { fetcher, storage, rarityEndpoint, onFallback })
    ]);
    return { lat, lng, elevation, political, ...biome, rarity, lookedUpAt: new Date().toISOString() };
  }

  function validateCustomLocations(locations) {
    if (!Array.isArray(locations)) throw new Error('Custom locations must be an array.');
    const ids = new Set();
    for (const location of locations) {
      if (!location || typeof location.id !== 'string' || !/^custom-[a-zA-Z0-9-]+$/.test(location.id) ||
          ids.has(location.id) || typeof location.name !== 'string' || !location.name.trim() ||
          !['v', 'w'].includes(location.status)) throw new Error('Invalid custom location.');
      ids.add(location.id);
      validateCoordinates(location.lat, location.lng);
      if (!Number.isFinite(location.elevation?.meters) || !Number.isFinite(location.elevation?.feet) ||
          Math.abs(location.elevation.feet - location.elevation.meters * 3.28084) > 0.001 ||
          !Array.isArray(location.political?.countries) || !location.political.countries.every(value => typeof value === 'string') ||
          !Array.isArray(location.political?.states) || !location.political.states.every(value => typeof value === 'string') ||
          !Array.isArray(location.political?.counties) || !location.political.counties.every(county =>
            typeof county?.id === 'string' && typeof county.name === 'string') ||
          !Array.isArray(location.ecoregions) || !location.ecoregions.every(region =>
            Number.isInteger(region.id) && typeof region.name === 'string' && typeof region.realm === 'string' &&
            Number.isInteger(region.biomeId) && region.biomeId >= 1 && region.biomeId <= 14) ||
          !Array.isArray(location.biomes) ||
          JSON.stringify([...new Set(location.ecoregions.map(region => String(region.biomeId)))]) !== JSON.stringify(location.biomes) ||
          location.biomeStatus !== (location.ecoregions.length ? 'matched' : 'no-terrestrial-match') ||
          !Number.isFinite(Date.parse(location.lookedUpAt))) {
        throw new Error(`Invalid lookup metadata for ${location.name}.`);
      }
      normalizeRarity(location.rarity, location.lat, location.lng);
    }
    return locations;
  }

  function migrateState(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
        (parsed.version !== undefined && parsed.version !== 1 && parsed.version !== 2)) {
      throw new Error('Unsupported passport version. Expected legacy data or version 2.');
    }
    const locations = validateCustomLocations(parsed.customLocations ?? []);
    return {
      ...parsed, version: 2,
      customLocations: locations.map(location => ({
        ...location, rarity: normalizeRarity(location.rarity, location.lat, location.lng)
      }))
    };
  }

  const api = {
    validateCoordinates, normalizeFeature, indexFeatures, findContaining, politicalRegion, biomeRegion,
    lookupElevation, categoryForPoiCount, segmentDistanceKm, summarizeOsm, lookupRarity, lookupCoordinate,
    validateCustomLocations, migrateState, normalizeRarity, validateProviderRarity, coordinateDistanceKm,
    lookupRarityWithFallback, ELEVATION_URL, OVERPASS_URL, CACHE_TTL, NPS_SOURCE, npsBoundaryIndex
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CoordinateLookups = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
