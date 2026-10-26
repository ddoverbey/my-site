(function (root) {
  'use strict';

  const ELEVATION_URL = 'https://api.open-meteo.com/v1/elevation';
  const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
  const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
  const PROVIDER_TIMEOUT_MS = 3500;
  const RARITY_TIMEOUT_MS = 12000;
  const RARITY_ISOLATION_DISTANCE_KM = 15 * 1.609344;
  const HIGHWAY_SEARCH_RADIUS_KM = 50;
  const RARITY_CACHE_PREFIX = 'terra_rarity_v2:';
  const RARITY_ORDER = Object.freeze([
    'Uncharted', 'Hidden Gem', 'Deep Cut', 'Regional Staple', 'Beaten Path', 'Tourist Trap'
  ]);
  const RARITY_TIERS = Object.freeze({
    'Tourist Trap': Object.freeze({ icon: '📸', color: '#cbd5e1' }),
    'Beaten Path': Object.freeze({ icon: '🥾', color: '#4ade80' }),
    'Regional Staple': Object.freeze({ icon: '🧭', color: '#22d3ee' }),
    'Deep Cut': Object.freeze({ icon: '🗺️', color: '#c084fc' }),
    'Hidden Gem': Object.freeze({ icon: '💎', color: '#fbbf24' }),
    Uncharted: Object.freeze({ icon: '🌌', color: '#f0abfc' })
  });
  const REMOTE_NPS_RARITIES = Object.freeze({
    gaar: 'Uncharted', kova: 'Uncharted', lacl: 'Hidden Gem', katm: 'Hidden Gem',
    wrst: 'Hidden Gem', npsa: 'Deep Cut', drto: 'Deep Cut', isro: 'Hidden Gem',
    ania: 'Uncharted', noat: 'Uncharted', bela: 'Uncharted', cape: 'Deep Cut'
  });
  const ICONIC_NPS_PARKS = new Set([
    'acad', 'arch', 'badl', 'bibe', 'brca', 'cany', 'cave', 'deva', 'dena', 'ever',
    'glac', 'grca', 'grte', 'grsm', 'hale', 'havo', 'jotr', 'mora', 'olym', 'redw',
    'romo', 'sagu', 'seki', 'shen', 'yell', 'yose', 'zion'
  ]);
  const HIGH_TRAFFIC_URBAN_NPS_UNITS = new Set([
    'bost', 'fdrm', 'goga', 'gwmp', 'jeff', 'linc', 'mall', 'mlkm', 'wamo', 'wwii'
  ]);
  const MIDDLE_CATALOG_RARITIES = ['Beaten Path', 'Regional Staple', 'Deep Cut', 'Hidden Gem'];
  const NPS_SOURCE = 'https://services1.arcgis.com/fBc8EJBxQRMcHlei/ArcGIS/rest/services/NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer/2';
  const SUBDIVISION_SOURCE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson';
  const ADMIN2_COUNTRIES = ['CAN', 'MEX', 'DEU', 'AUS'];
  const ADMIN2_SOURCE = 'geoBoundaries gbOpen ADM2';
  const validSubdivisionId = id => typeof id === 'string' && /^[A-Z]{3}:[A-Za-z0-9_.-]+$/.test(id);
  const validCountyId = id => typeof id === 'string' && (/^\d{5}$/.test(id) || validSubdivisionId(id));

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

  function subdivisionFeatures(topology, decode) {
    if (topology?.type !== 'Topology' || topology.metadata?.source !== SUBDIVISION_SOURCE ||
        topology.metadata.version !== 1 || !topology.objects?.subdivisions) {
      throw new Error('Invalid world subdivision snapshot.');
    }
    const features = decode(topology, topology.objects.subdivisions).features;
    if (!Array.isArray(features) || features.length < 1000) throw new Error('Incomplete world subdivision snapshot.');
    const ids = new Set();
    for (const feature of features) {
      const id = feature.id;
      const properties = feature.properties || {};
      if (!validSubdivisionId(id) || ids.has(id) || properties.isoA3 !== id.slice(0, 3) ||
          typeof properties.name !== 'string' || !properties.name.trim() ||
          typeof properties.country !== 'string' || !properties.country.trim() ||
          typeof properties.region !== 'string' ||
          !['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)) {
        throw new Error('Invalid world subdivision geometry, ID or properties.');
      }
      ids.add(id);
    }
    return features;
  }

  function admin2Features(topology, decode) {
    if (topology?.type !== 'Topology' || topology.metadata?.source !== ADMIN2_SOURCE ||
        topology.metadata?.license !== 'CC-BY-4.0' || topology.metadata.version !== 1 ||
        !topology.objects?.admin2 || !Array.isArray(topology.metadata?.sources) ||
        topology.metadata.sources.length !== ADMIN2_COUNTRIES.length) {
      throw new Error('Invalid world Admin-2 snapshot.');
    }
    const features = decode(topology, topology.objects.admin2).features;
    if (!Array.isArray(features) || features.length < 1000) throw new Error('Incomplete world Admin-2 snapshot.');
    const ids = new Set();
    const countries = new Set();
    for (const feature of features) {
      const id = feature.id;
      const country = feature.properties?.country;
      if (!validSubdivisionId(id) || ids.has(id) || !ADMIN2_COUNTRIES.includes(country) ||
          !id.startsWith(`${country}:`) || typeof feature.properties?.name !== 'string' ||
          !feature.properties.name.trim() ||
          !['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)) {
        throw new Error('Invalid world Admin-2 geometry, ID or properties.');
      }
      ids.add(id);
      countries.add(country);
    }
    if (ADMIN2_COUNTRIES.some(country => !countries.has(country))) {
      throw new Error('World Admin-2 snapshot is missing a required country.');
    }
    return features;
  }

  function countyEquivalentFeatures(subdivisions = [], admin2 = []) {
    const overriddenCountries = new Set(ADMIN2_COUNTRIES);
    return [
      ...subdivisions.filter(feature => !overriddenCountries.has(feature.properties?.isoA3)),
      ...admin2
    ];
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
    // Detailed micro-state polygons override the coarse 110m neighbour (e.g. France swallowing Monaco).
    const microStates = indexes.microStates?.length ? findContaining(indexes.microStates, lat, lng, geoContains) : [];
    const countries = microStates.length ? microStates : findContaining(indexes.countries, lat, lng, geoContains);
    const states = findContaining(indexes.states, lat, lng, geoContains);
    const counties = findContaining(indexes.counties, lat, lng, geoContains);
    const admin1 = findContaining(indexes.subdivisions || [], lat, lng, geoContains);
    return {
      countries: countries.map(feature => feature.properties.name),
      states: states.map(feature => feature.properties.name),
      admin1: [...new Map(admin1.map(feature => [String(feature.id), {
        id: String(feature.id), name: feature.properties.name
      }])).values()],
      counties: [...new Map(counties.map(feature => {
        const id = String(feature.id);
        return [id, { id: /^\d+$/.test(id) ? id.padStart(5, '0') : id, name: feature.properties.name }];
      })).values()],
      method: 'Simplified atlas polygon containment; approximate at borders and coasts.'
    };
  }

  function biomeRegion(lat, lng, index, geoContains, mangroveIndex = []) {
    const detailedMangroves = mangroveIndex.length
      ? findContaining(mangroveIndex, lat, lng, geoContains) : [];
    const regions = (detailedMangroves.length ? detailedMangroves : findContaining(index, lat, lng, geoContains)).map(feature => ({
      id: feature.properties.ECO_ID, name: feature.properties.ECO_NAME,
      biomeId: feature.properties.BIOME_NUM, realm: feature.properties.REALM
    }));
    return {
      ecoregions: regions,
      biomes: [...new Set(regions.map(region => String(region.biomeId)))],
      biomeStatus: regions.length ? 'matched' : 'no-terrestrial-match'
    };
  }

  function predominantBiome(feature, index, geo, mangroveIndex = []) {
    if (!Array.isArray(index) || !geo?.geoArea || !geo?.geoBounds || !geo?.geoContains || !geo?.geoCentroid) {
      throw new Error('Indexed ecoregions and D3 geometry helpers are required.');
    }
    const normalized = normalizeFeature(feature, geo.geoArea);
    const [[west, south], [east, north]] = geo.geoBounds(normalized);
    const candidates = [...mangroveIndex, ...index].filter(item =>
      boundsOverlap(geo.geoBounds(normalized), item.bounds));
    const counts = new Map();
    const sample = (lng, lat) => {
      if (!geo.geoContains(normalized, [lng, lat])) return;
      for (const { feature: region, bounds } of candidates) {
        const [[regionWest, regionSouth], [regionEast, regionNorth]] = bounds;
        const longitudeMatches = regionWest <= regionEast
          ? lng >= regionWest && lng <= regionEast
          : lng >= regionWest || lng <= regionEast;
        if (lat < regionSouth || lat > regionNorth || !longitudeMatches ||
            !geo.geoContains(region, [lng, lat])) continue;
        const biome = String(region.properties.BIOME_NUM);
        counts.set(biome, (counts.get(biome) || 0) + Math.max(0.01, Math.cos(lat * Math.PI / 180)));
        break;
      }
    };
    const ranges = longitudeRanges([west, east]);
    const divisions = 9;
    for (let row = 0; row < divisions; row++) {
      const lat = south + (north - south) * (row + 0.5) / divisions;
      for (const [rangeWest, rangeEast] of ranges) {
        for (let column = 0; column < divisions; column++) {
          sample(rangeWest + (rangeEast - rangeWest) * (column + 0.5) / divisions, lat);
        }
      }
    }
    const centroid = geo.geoCentroid(normalized);
    sample(centroid[0], centroid[1]);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en', { numeric: true }))[0]?.[0] || null;
  }

  function longitudeRanges([west, east]) {
    return west <= east ? [[west, east]] : [[west, 180], [-180, east]];
  }

  function boundsOverlap(a, b) {
    if (a[1][1] < b[0][1] || a[0][1] > b[1][1]) return false;
    return longitudeRanges([a[0][0], a[1][0]]).some(([aWest, aEast]) =>
      longitudeRanges([b[0][0], b[1][0]]).some(([bWest, bEast]) =>
        aEast >= bWest && aWest <= bEast));
  }

  function geometrySegments(feature) {
    const geometry = feature?.geometry;
    if (!['Polygon', 'MultiPolygon'].includes(geometry?.type)) throw new Error('Expected polygon geography.');
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    const segments = [];
    polygons.forEach(rings => rings.forEach(ring => {
      for (let index = 1; index < ring.length; index++) segments.push([ring[index - 1], ring[index]]);
      if (ring.length > 2) {
        const first = ring[0], last = ring[ring.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) segments.push([last, first]);
      }
    }));
    return segments;
  }

  function planarSegmentsIntersect(a, b, c, d) {
    const epsilon = 1e-10;
    const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const onSegment = (p, q, r) =>
      Math.abs(cross(p, q, r)) <= epsilon &&
      r[0] >= Math.min(p[0], q[0]) - epsilon && r[0] <= Math.max(p[0], q[0]) + epsilon &&
      r[1] >= Math.min(p[1], q[1]) - epsilon && r[1] <= Math.max(p[1], q[1]) + epsilon;
    const abC = cross(a, b, c), abD = cross(a, b, d);
    const cdA = cross(c, d, a), cdB = cross(c, d, b);
    if (((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon)) &&
        ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon))) return true;
    return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
  }

  function boundaryIntersectsFeature(boundary, target, geoContains) {
    const boundarySegments = geometrySegments(boundary);
    const targetSegments = geometrySegments(target);
    for (const [originalA, originalB] of boundarySegments) {
      if (geoContains(target, originalA) || geoContains(target, originalB)) return true;
      const a = [...originalA], b = [...originalB];
      b[0] += 360 * Math.round((a[0] - b[0]) / 360);
      for (const [originalC, originalD] of targetSegments) {
        const c = [...originalC], d = [...originalD];
        c[0] += 360 * Math.round((a[0] - c[0]) / 360);
        d[0] += 360 * Math.round((c[0] - d[0]) / 360);
        if ([-360, 0, 360].some(shift =>
          planarSegmentsIntersect(a, b, [c[0] + shift, c[1]], [d[0] + shift, d[1]]))) return true;
      }
    }
    return false;
  }

  function firstBoundaryIntersection(feature, index, geo, mangroveIndex = []) {
    if (!Array.isArray(index) || !geo?.geoArea || !geo?.geoBounds || !geo?.geoContains) {
      throw new Error('Indexed geography and D3 geometry helpers are required.');
    }
    const normalized = normalizeFeature(feature, geo.geoArea);
    const bounds = geo.geoBounds(normalized);
    for (const item of [...mangroveIndex, ...index]) {
      if (boundsOverlap(bounds, item.bounds) &&
          boundaryIntersectsFeature(normalized, item.feature, geo.geoContains)) return item.feature;
    }
    return null;
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
      if (matched) {
        const id = String(feature.id);
        ids.push(/^\d+$/.test(id) ? id.padStart(5, '0') : id);
      }
    }
    return [...new Set(ids)];
  }

  async function fetchJson(url, options, fetcher, timeoutMs = 45000) {
    const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`Lookup request failed (HTTP ${response.status}).`);
    return response.json();
  }

  async function lookupElevation(lat, lng, fetcher = root.fetch) {
    validateCoordinates(lat, lng);
    const data = await fetchJson(`${ELEVATION_URL}?${new URLSearchParams({ latitude: lat, longitude: lng })}`,
      {}, fetcher, PROVIDER_TIMEOUT_MS);
    if (!Array.isArray(data.elevation) || data.elevation.length !== 1 || !Number.isFinite(data.elevation[0])) {
      throw new Error('Elevation provider returned no valid elevation.');
    }
    return { meters: data.elevation[0], feet: data.elevation[0] * 3.28084, source: ELEVATION_URL };
  }

  function categoryForPoiCount(count) {
    if (!Number.isInteger(count) || count < 0) throw new Error('Invalid rarity count.');
    if (count >= 10000) return 'Tourist Trap';
    if (count >= 1000) return 'Beaten Path';
    if (count >= 100) return 'Regional Staple';
    if (count >= 30) return 'Deep Cut';
    if (count >= 10) return 'Hidden Gem';
    return 'Uncharted';
  }

  function categoryForOpenData(poiCount, nearestHighwayKm = null) {
    if (!(nearestHighwayKm === null || (Number.isFinite(nearestHighwayKm) &&
        nearestHighwayKm >= 0 && nearestHighwayKm <= HIGHWAY_SEARCH_RADIUS_KM))) {
      throw new Error('Invalid nearest-highway distance.');
    }
    const category = categoryForPoiCount(poiCount);
    if (nearestHighwayKm === null || nearestHighwayKm <= RARITY_ISOLATION_DISTANCE_KM) return category;
    return RARITY_ORDER[Math.max(0, RARITY_ORDER.indexOf(category) - 1)];
  }

  function stableCatalogRarity(park, designation, memberships) {
    const key = [park.id, park.name, designation, ...memberships].join('|');
    let hash = 0;
    for (const character of key) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
    return MIDDLE_CATALOG_RARITIES[hash % MIDDLE_CATALOG_RARITIES.length];
  }

  function offlineCatalogRarity(park) {
    const id = String(park.id || '').toLowerCase();
    const designation = typeof park.designation === 'string' ? park.designation : '';
    const memberships = Array.isArray(park.memberships)
      ? park.memberships.filter(value => typeof value === 'string') : [];
    const membershipText = memberships.join(' ').toLowerCase();
    if (typeof park.visitorCount === 'number' && Number.isFinite(park.visitorCount) && park.visitorCount >= 0) {
      if (park.visitorCount >= 1000000) return 'Tourist Trap';
      if (park.visitorCount >= 250000) return 'Beaten Path';
      if (park.visitorCount >= 50000) return 'Regional Staple';
      if (park.visitorCount >= 10000) return 'Deep Cut';
      if (park.visitorCount >= 1000) return 'Hidden Gem';
      return 'Uncharted';
    }
    if (REMOTE_NPS_RARITIES[id]) return REMOTE_NPS_RARITIES[id];
    if (park.intl) {
      if (membershipText.includes('unesco world heritage')) return 'Beaten Path';
      if (membershipText.includes('iucn green list')) return 'Deep Cut';
      if (membershipText.includes('ramsar')) return 'Regional Staple';
      if (membershipText.includes('dark sky')) return 'Hidden Gem';
      return stableCatalogRarity(park, designation, memberships);
    }
    if (/national park/i.test(designation)) {
      return ICONIC_NPS_PARKS.has(id) ? 'Tourist Trap' : 'Beaten Path';
    }
    if (/national memorial|national parkway|national mall/i.test(designation)) {
      return HIGH_TRAFFIC_URBAN_NPS_UNITS.has(id) ? 'Tourist Trap' : 'Beaten Path';
    }
    if (/national monument|battlefield|military park/i.test(designation)) return 'Regional Staple';
    if (/preserve|wilderness|wild and scenic|wildlife refuge/i.test(designation)) return 'Hidden Gem';
    if (/historic/i.test(designation)) return 'Deep Cut';
    if (/seashore|lakeshore|recreation area|scenic river|national trail/i.test(designation)) {
      return 'Beaten Path';
    }
    return stableCatalogRarity(park, designation, memberships);
  }

  function knownCatalogRarity(value) {
    if (!value || typeof value !== 'object') return null;
    const rarity = value.rarity && typeof value.rarity === 'object'
      ? value.rarity : typeof value.method === 'string' ? value : null;
    const rarityTier = value.rarityTier || rarity?.rarityTier || rarity?.category;
    return Object.hasOwn(RARITY_TIERS, rarityTier) ? { rarity, rarityTier } : null;
  }

  function catalogParkRarity(park, { savedRarity = null, storage = root.localStorage } = {}) {
    if (!park || typeof park !== 'object') throw new Error('Catalog park metadata is required.');
    const saved = knownCatalogRarity(savedRarity);
    if (saved) return saved;
    if (Number.isFinite(park.lat) && Number.isFinite(park.lng) && storage) {
      try {
        const cached = cachedRarity(park.lat, park.lng, storage);
        const knownCache = knownCatalogRarity(cached);
        if (knownCache) return knownCache;
      } catch (error) {
        console.warn('Catalog park rarity cache lookup failed', park.id, error);
      }
    }
    const catalogRarity = knownCatalogRarity(park);
    if (catalogRarity) return catalogRarity;
    return { rarity: null, rarityTier: offlineCatalogRarity(park) };
  }

  function validateProviderRarity(data) {
    const nearestHighwayKm = data?.nearestHighwayKm ?? null;
    const expectedTier = data && Number.isSafeInteger(data.popularityScore) && data.popularityScore >= 0
      ? data.reviewCount === null
        ? categoryForOpenData(data.popularityScore, nearestHighwayKm)
        : Number.isSafeInteger(data.reviewCount) && data.reviewCount >= 0
          ? categoryForPoiCount(data.reviewCount)
          : null
      : null;
    if (!data || typeof data.placeName !== 'string' || !data.placeName.trim() ||
        !(data.reviewCount === null || (Number.isSafeInteger(data.reviewCount) && data.reviewCount >= 0)) ||
        !Number.isSafeInteger(data.popularityScore) || data.popularityScore < 0 ||
        !(nearestHighwayKm === null || (Number.isFinite(nearestHighwayKm) &&
          nearestHighwayKm >= 0 && nearestHighwayKm <= HIGHWAY_SEARCH_RADIUS_KM)) ||
        typeof data.cached !== 'boolean' || typeof data.source !== 'string' || !data.source.trim() ||
        data.source.length > 500 || data.placeName.length > 300 ||
        !(data.searchedName === undefined || data.searchedName === null ||
          (typeof data.searchedName === 'string' && data.searchedName.trim() &&
            data.searchedName.length <= 150 && !/[\u0000-\u001f\u007f]/.test(data.searchedName))) ||
        data.rarityTier !== expectedTier) {
      throw new Error('Rarity endpoint returned invalid provider metadata.');
    }
    validateCoordinates(data.matchedLat, data.matchedLng);
    return data;
  }

  function normalizeRarity(rarity, lat, lng) {
    if (rarity?.method === 'osm-poi-density') {
      if (rarity.category !== categoryForOpenData(rarity.nearbyPoiCount, rarity.nearestHighwayKm) ||
          !(rarity.nearestHighwayKm === null || (Number.isFinite(rarity.nearestHighwayKm) &&
            rarity.nearestHighwayKm >= 0 && rarity.nearestHighwayKm <= HIGHWAY_SEARCH_RADIUS_KM))) {
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
    fetcher = root.fetch, storage, rarityEndpoint = '', placeName = '', onFallback = () => {}
  } = {}) {
    validateCoordinates(lat, lng);
    const queryName = cleanPlaceName(placeName);
    const cached = cachedRarity(lat, lng, storage, Date.now(), queryName);
    if (cached && (!queryName || isNameMatchedRarity(cached, queryName))) return cached;
    if (rarityEndpoint) {
      try {
        const url = new URL(rarityEndpoint);
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
          throw new Error('Rarity endpoint must use HTTPS (HTTP is allowed only on localhost).');
        }
        url.searchParams.set('lat', lat);
        url.searchParams.set('lng', lng);
        if (queryName) url.searchParams.set('name', queryName);
        const response = await fetcher(url.toString(), { signal: AbortSignal.timeout(RARITY_TIMEOUT_MS) });
        if (!response.ok) throw new Error(`Rarity endpoint failed (HTTP ${response.status}).`);
        const data = validateProviderRarity(await response.json());
        if (coordinateDistanceKm(lat, lng, data.matchedLat, data.matchedLng) > 1) {
          throw new Error('Rarity endpoint matched a location more than 1 km from the requested point.');
        }
        const result = {
          ...data,
          ...(queryName ? { searchedName: queryName } : {}),
          method: data.reviewCount === null ? 'provider-popularity' : 'provider-review-count'
        };
        if (!queryName || isNameMatchedRarity(result, queryName)) {
          return cacheRarity(lat, lng, result, storage, Date.now(), queryName);
        }
        return result;
      } catch (error) {
        console.warn('Rarity endpoint unavailable; using the direct OSM density lookup.', error);
        onFallback(error);
      }
    }
    const fallback = await lookupRarity(lat, lng, fetcher, storage);
    const result = {
      ...fallback,
      ...(queryName ? { searchedName: queryName } : {})
    };
    return queryName ? result : cacheRarity(lat, lng, result, storage);
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
        if (!Number.isFinite(element.center?.lat) || !Number.isFinite(element.center?.lon)) {
          throw new Error('Overpass returned an incomplete highway center.');
        }
        nearest = Math.min(nearest, coordinateDistanceKm(lat, lng, element.center.lat, element.center.lon));
      }
    }
    const nearestHighwayKm = nearest <= HIGHWAY_SEARCH_RADIUS_KM ? nearest : null;
    return {
      category: categoryForOpenData(pois.size, nearestHighwayKm), nearbyPoiCount: pois.size,
      nearestHighwayKm, radiusKm: 5,
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
    const cached = cachedRarity(lat, lng, storage, now);
    if (cached) return cached;
    const query = `[out:json][timeout:10];(node(around:5000,${gridLat},${gridLng})["tourism"];` +
      `node(around:5000,${gridLat},${gridLng})["amenity"];` +
      `way(around:${HIGHWAY_SEARCH_RADIUS_KM * 1000},${gridLat},${gridLng})["highway"~"^(motorway|trunk)$"];);out center;`;
    const result = await fetchJson(OVERPASS_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: query }).toString()
    }, fetcher, RARITY_TIMEOUT_MS);
    if (result.remark) throw new Error(`Overpass could not complete the query: ${result.remark}`);
    const data = summarizeOsm(result.elements, gridLat, gridLng);
    if (storage) storage.setItem(key, JSON.stringify({ version: 1, savedAt: now, data }));
    return { ...data, cached: false };
  }

  function cachedRarity(lat, lng, storage, now = Date.now(), placeName = '') {
    validateCoordinates(lat, lng);
    if (!storage) return null;
    const sharedKey = `${RARITY_CACHE_PREFIX}${rarityCacheKey(lat, lng, placeName)}`;
    const sharedRaw = storage.getItem(sharedKey);
    if (sharedRaw) {
      try {
        const cached = JSON.parse(sharedRaw);
        if (cached.version !== 1 || !Number.isFinite(cached.savedAt)) {
          throw new Error('Invalid cached rarity metadata.');
        }
        const rarity = normalizeRarity(cached.data, lat, lng);
        if (coordinateDistanceKm(lat, lng, rarity.matchedLat, rarity.matchedLng) > 1) {
          throw new Error('Cached rarity match is more than 1 km from the requested point.');
        }
        if (now - cached.savedAt >= 0 && now - cached.savedAt < CACHE_TTL) {
          return { ...rarity, cached: true };
        }
        storage.removeItem(sharedKey);
      } catch (error) {
        console.warn('Discarding invalid shared rarity cache entry', sharedKey, error);
        try {
          storage.removeItem(sharedKey);
        } catch (removeError) {
          console.warn('Could not remove invalid shared rarity cache entry', sharedKey, removeError);
        }
      }
    }
    const gridLat = Number(lat.toFixed(3));
    const gridLng = Number(lng.toFixed(3));
    const key = `terra_osm_v1:${gridLat.toFixed(3)},${gridLng.toFixed(3)}`;
    const raw = storage.getItem(key);
    if (!raw) return null;
    try {
      const cached = JSON.parse(raw);
      if (cached.version !== 1 || !Number.isFinite(cached.savedAt) ||
          cached.data?.method !== 'osm-poi-density' || cached.data.radiusKm !== 5 ||
          cached.data.category !== categoryForOpenData(cached.data.nearbyPoiCount, cached.data.nearestHighwayKm) ||
          cached.data.sampledAt?.lat !== gridLat || cached.data.sampledAt?.lng !== gridLng ||
          !(cached.data.nearestHighwayKm === null || (Number.isFinite(cached.data.nearestHighwayKm) &&
            cached.data.nearestHighwayKm >= 0 && cached.data.nearestHighwayKm <= HIGHWAY_SEARCH_RADIUS_KM))) {
        throw new Error('Invalid cached OSM metadata.');
      }
      if (now - cached.savedAt >= 0 && now - cached.savedAt < CACHE_TTL) {
        return normalizeRarity({ ...cached.data, cached: true }, lat, lng);
      }
    } catch (error) {
      console.warn('Discarding invalid OSM cache entry', key, error);
      try {
        storage.removeItem(key);
      } catch (removeError) {
        console.warn('Could not remove invalid OSM cache entry', key, removeError);
      }
    }
    return null;
  }

  function coordinateCacheKey(lat, lng) {
    validateCoordinates(lat, lng);
    return `${lat.toFixed(2)},${lng.toFixed(2)}`;
  }

  function cleanPlaceName(value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string') throw new Error('Place name must be text.');
    const name = value.trim().replace(/\s+/g, ' ');
    if (!name) return '';
    if (name.length > 150 || /[\u0000-\u001f\u007f]/.test(name)) {
      throw new Error('Place name must be 150 characters or fewer and contain no control characters.');
    }
    return name;
  }

  function normalizePlaceName(value) {
    const name = cleanPlaceName(value);
    const normalized = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (name && !normalized) throw new Error('Place name must contain searchable letters or numbers.');
    return normalized;
  }

  function isNameMatchedRarity(rarity, placeName) {
    const normalizedName = normalizePlaceName(placeName);
    return Boolean(normalizedName && rarity?.source ===
      'Google Places API (New) + OpenStreetMap contributors (ODbL)' &&
      normalizePlaceName(rarity.searchedName) === normalizedName);
  }

  function rarityCacheKey(lat, lng, placeName = '') {
    const coordinateKey = coordinateCacheKey(lat, lng);
    const normalizedName = normalizePlaceName(placeName);
    return normalizedName ? `${coordinateKey}|name:${encodeURIComponent(normalizedName)}` : coordinateKey;
  }

  function cacheRarity(lat, lng, rarity, storage, now = Date.now(), placeName = '') {
    const normalized = normalizeRarity(rarity, lat, lng);
    if (storage) {
      const key = `${RARITY_CACHE_PREFIX}${rarityCacheKey(lat, lng, placeName)}`;
      storage.setItem(key, JSON.stringify({ version: 1, savedAt: now, data: normalized }));
    }
    return normalized;
  }

  async function lookupCoordinate(lat, lng, {
    indexes, geoContains, fetcher = root.fetch, storage, rarityEndpoint = '', onFallback,
    skipRarityLookup = false, placeName = ''
  }) {
    validateCoordinates(lat, lng);
    if (!indexes?.countries?.length || !indexes?.states?.length || !indexes?.counties?.length || !indexes?.ecoregions?.length) {
      throw new Error('Coordinate geography is unavailable. Retry datasets before saving a custom location.');
    }
    const political = politicalRegion(lat, lng, indexes, geoContains);
    const biome = biomeRegion(lat, lng, indexes.ecoregions, geoContains, indexes.mangroves);
    const rarityLookup = skipRarityLookup
      ? Promise.resolve().then(() => cachedRarity(lat, lng, storage, Date.now(), placeName))
      : lookupRarityWithFallback(lat, lng, { fetcher, storage, rarityEndpoint, placeName, onFallback });
    const [elevationResult, rarityResult] = await Promise.allSettled([
      lookupElevation(lat, lng, fetcher),
      rarityLookup
    ]);
    const lookupWarnings = [];
    const describeFailure = (label, error) => {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`${label} lookup unavailable; saving with fallback metadata.`, error);
      lookupWarnings.push(`${label} unavailable: ${detail}`);
    };
    const elevation = elevationResult.status === 'fulfilled' ? elevationResult.value : null;
    const rarity = rarityResult.status === 'fulfilled' ? rarityResult.value : null;
    if (elevationResult.status === 'rejected') describeFailure('Elevation', elevationResult.reason);
    return {
      lat, lng, elevation, elevationFt: elevation?.feet ?? 0, political, ...biome, rarity,
      rarityTier: rarity?.rarityTier ?? rarity?.category ?? 'Uncharted',
      lookupWarnings, lookedUpAt: new Date().toISOString()
    };
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
      const elevationUnavailable = location.elevation === null && location.elevationFt === 0;
      if ((!elevationUnavailable && (!Number.isFinite(location.elevation?.meters) ||
          !Number.isFinite(location.elevation?.feet) ||
          Math.abs(location.elevation.feet - location.elevation.meters * 3.28084) > 0.001)) ||
          !Array.isArray(location.political?.countries) || !location.political.countries.every(value => typeof value === 'string') ||
          !Array.isArray(location.political?.states) || !location.political.states.every(value => typeof value === 'string') ||
          !Array.isArray(location.political?.counties) || !location.political.counties.every(county =>
            validCountyId(county?.id) && typeof county.name === 'string') ||
          !Array.isArray(location.ecoregions) || !location.ecoregions.every(region =>
            Number.isInteger(region.id) && typeof region.name === 'string' && typeof region.realm === 'string' &&
            Number.isInteger(region.biomeId) && region.biomeId >= 1 && region.biomeId <= 14) ||
          !Array.isArray(location.biomes) ||
          JSON.stringify([...new Set(location.ecoregions.map(region => String(region.biomeId)))]) !== JSON.stringify(location.biomes) ||
          location.biomeStatus !== (location.ecoregions.length ? 'matched' : 'no-terrestrial-match') ||
          !Number.isFinite(Date.parse(location.lookedUpAt))) {
        throw new Error(`Invalid lookup metadata for ${location.name}.`);
      }
      if (location.rarity === null && location.rarityTier === 'Uncharted') continue;
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
    predominantBiome,
    validCountyId, validSubdivisionId, subdivisionFeatures,
    firstBoundaryIntersection, lookupRoadRoute, routeCountyIds,
    lookupElevation, categoryForPoiCount, categoryForOpenData, segmentDistanceKm, summarizeOsm, lookupRarity, cachedRarity,
    coordinateCacheKey, rarityCacheKey, normalizePlaceName, isNameMatchedRarity, cacheRarity, RARITY_ORDER,
    lookupCoordinate, catalogParkRarity, RARITY_TIERS,
    validateCustomLocations, migrateState, normalizeRarity, validateProviderRarity, coordinateDistanceKm,
    lookupRarityWithFallback, ELEVATION_URL, OVERPASS_URL, CACHE_TTL, NPS_SOURCE,
    SUBDIVISION_SOURCE, ADMIN2_COUNTRIES, ADMIN2_SOURCE, npsBoundaryIndex, admin2Features,
    countyEquivalentFeatures, PROVIDER_TIMEOUT_MS, RARITY_TIMEOUT_MS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CoordinateLookups = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
