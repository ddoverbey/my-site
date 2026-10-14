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

  async function lookupRoadRoute(from, to, fetcher = root.fetch) {
    validateCoordinates(...from);
    validateCoordinates(...to);
    const coordinates = [from, to].map(([lat, lng]) => `${lng},${lat}`).join(';');
    const data = await fetchJson(`https://routing.openstreetmap.de/routed-car/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`, {}, fetcher);
    if (data.code !== 'Ok' || !data.routes?.length ||
        data.routes[0].geometry?.type !== 'LineString' || !Array.isArray(data.routes[0].geometry.coordinates) ||
        data.routes[0].geometry.coordinates.length < 2) throw new Error('No road route found between these stops.');
    return data.routes[0].geometry.coordinates.map(point => {
      if (!Array.isArray(point) || point.length !== 2) throw new Error('Invalid road route returned.');
      const [lng, lat] = point;
      validateCoordinates(lat, lng);
      return [lat, lng];
    });
  }

  function routeCountyIds(route, countyIndex, geoContains) {
    if (!Array.isArray(route) || route.length < 2) return [];
    route.forEach(point => validateCoordinates(...point));
    const segments = route.slice(1).map((point, index) => {
      const a = [route[index][1], route[index][0]];
      const b = [point[1], point[0]];
      // Use the short crossing at the date line, never a segment across the whole world.
      if (b[0] - a[0] > 180) b[0] -= 360;
      if (a[0] - b[0] > 180) b[0] += 360;
      return { a, b, west: Math.min(a[0], b[0]), east: Math.max(a[0], b[0]),
        south: Math.min(a[1], b[1]), north: Math.max(a[1], b[1]) };
    });
    const envelope = segments.reduce((bounds, segment) => ({
      west: Math.min(bounds.west, segment.west), east: Math.max(bounds.east, segment.east),
      south: Math.min(bounds.south, segment.south), north: Math.max(bounds.north, segment.north)
    }), { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity });
    const ids = [];
    for (const { feature, bounds: [[west, south], [east, north]] } of countyIndex) {
      if (envelope.north < south || envelope.south > north ||
          (west <= east && ![-360, 0, 360].some(shift => envelope.east + shift >= west && envelope.west + shift <= east))) continue;
      const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      const matched = segments.some(segment => {
        if (segment.north < south || segment.south > north) return false;
        return [-360, 0, 360].some(shift => {
          const left = segment.west + shift, right = segment.east + shift;
          if (west <= east && (right < west || left > east)) return false;
          const a = [segment.a[0] + shift, segment.a[1]];
          const b = [segment.b[0] + shift, segment.b[1]];
          if (geoContains(feature, a) || geoContains(feature, b)) return true;
          const dx = b[0] - a[0], dy = b[1] - a[1];
          const crossings = [0, 1];
          polygons.forEach(rings => rings.forEach(ring => {
            for (let i = 1; i < ring.length; i++) {
              const c = [...ring[i - 1]], d = [...ring[i]];
              c[0] += 360 * Math.round((a[0] - c[0]) / 360);
              d[0] += 360 * Math.round((c[0] - d[0]) / 360);
              const ex = d[0] - c[0], ey = d[1] - c[1];
              const denominator = dx * ey - dy * ex;
              if (Math.abs(denominator) < 1e-12) continue;
              const cx = c[0] - a[0], cy = c[1] - a[1];
              const t = (cx * ey - cy * ex) / denominator;
              const u = (cx * dy - cy * dx) / denominator;
              if (t > 0 && t < 1 && u >= 0 && u <= 1) crossings.push(t);
            }
          }));
          crossings.sort((x, y) => x - y);
          return crossings.slice(1).some((t, index) => {
            if (t - crossings[index] < 1e-10) return false;
            const midpoint = (t + crossings[index]) / 2;
            return geoContains(feature, [a[0] + dx * midpoint, a[1] + dy * midpoint]);
          });
        });
      });
      if (matched) ids.push(String(feature.id).padStart(5, '0'));
    }
    return [...new Set(ids)];
  }

  async function fetchJson(url, options, fetcher) {
    const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error(`Lookup request failed (HTTP ${response.status}).`);
    return response.json();
  }

  async function lookupElevation(lat, lng, fetcher = root.fetch) {
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
      if (!location || typeof location.id !== 'string' || !/^(?:custom-|poi_)[a-zA-Z0-9_-]+$/.test(location.id) ||
          ids.has(location.id) || typeof location.name !== 'string' || !location.name.trim() ||
          !['v', 'w', 't', 'l'].includes(location.status)) throw new Error('Invalid custom location.');
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
    lookupRoadRoute, routeCountyIds,
    lookupElevation, categoryForPoiCount, segmentDistanceKm, summarizeOsm, lookupRarity, lookupCoordinate,
    validateCustomLocations, migrateState, normalizeRarity, validateProviderRarity, coordinateDistanceKm,
    lookupRarityWithFallback, ELEVATION_URL, OVERPASS_URL, CACHE_TTL, NPS_SOURCE, npsBoundaryIndex
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CoordinateLookups = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
