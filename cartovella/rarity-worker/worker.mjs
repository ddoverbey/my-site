import lookups from '../coordinate-lookups.js';

const GOOGLE_PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';
const GOOGLE_PLACES_FIELD_MASK = 'places.displayName,places.userRatingCount,places.location';
const GOOGLE_PLACE_MATCH_RADIUS_KM = 0.5;

export function coordinateGrid(lat, lng) {
  lookups.validateCoordinates(lat, lng);
  const latStep = 0.5 / 111.195;
  const row = Math.round(lat / latStep);
  const matchedLat = Math.max(-90, Math.min(90, row * latStep));
  const longitudeCells = Math.max(1, Math.round(360 * 111.195 * Math.cos(matchedLat * Math.PI / 180) / 0.5));
  const column = ((Math.round((lng + 180) / 360 * longitudeCells) % longitudeCells) + longitudeCells) % longitudeCells;
  return {
    key: `osm-density-v1:${row}:${column}`,
    matchedLat: Number(matchedLat.toFixed(7)),
    matchedLng: Number((column / longitudeCells * 360 - 180).toFixed(7))
  };
}

async function fetchOpenDataSummary(fetcher, grid) {
  const query = `[out:json][timeout:25];(node(around:5000,${grid.matchedLat},${grid.matchedLng})["tourism"];` +
    `node(around:5000,${grid.matchedLat},${grid.matchedLng})["amenity"];` +
    `way(around:50000,${grid.matchedLat},${grid.matchedLng})["highway"~"^(motorway|trunk)$"];);out center;`;
  const response = await fetcher(lookups.OVERPASS_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: query }).toString(), signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`Overpass HTTP ${response.status}.`);
  const data = await response.json();
  if (data.remark) throw new Error('Overpass returned an incomplete query.');
  return {
    summary: lookups.summarizeOsm(data.elements, grid.matchedLat, grid.matchedLng),
    timestamp: data.osm3s?.timestamp_osm_base || null
  };
}

function googlePlaceNameScore(placeName, candidateName) {
  const expected = lookups.normalizePlaceName(placeName);
  const candidate = lookups.normalizePlaceName(candidateName);
  if (!expected || !candidate) return 0;
  if (expected === candidate) return 1;
  const expectedTokens = new Set(expected.split(' '));
  const candidateTokens = new Set(candidate.split(' '));
  const matched = [...expectedTokens].filter(token => [...candidateTokens].some(candidateToken =>
    candidateToken === token || (token.length >= 4 && candidateToken.startsWith(token)))).length;
  const expectedCoverage = matched / expectedTokens.size;
  const candidateCoverage = matched / candidateTokens.size;
  return expectedCoverage === 1 && candidateCoverage >= 0.6 ? candidateCoverage : 0;
}

async function rarityCacheKey(grid, placeName) {
  if (!placeName) return grid.key;
  const normalizedName = lookups.normalizePlaceName(placeName);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizedName));
  const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${grid.key}:name:${hash}`;
}

async function fetchGooglePlace(fetcher, apiKey, grid, placeName = '') {
  const response = await fetcher(GOOGLE_PLACES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': GOOGLE_PLACES_FIELD_MASK
    },
    body: JSON.stringify({
      textQuery: placeName || 'points of interest',
      locationBias: {
        circle: {
          center: { latitude: grid.matchedLat, longitude: grid.matchedLng },
          radius: GOOGLE_PLACE_MATCH_RADIUS_KM * 1000
        }
      },
      maxResultCount: placeName ? 10 : 20
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Google Places HTTP ${response.status}.`);
  const data = await response.json();
  if (!Array.isArray(data.places)) throw new Error('Google Places returned an invalid response.');
  const closest = data.places.map(place => {
    const lat = place.location?.latitude;
    const lng = place.location?.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      placeName: typeof place.displayName?.text === 'string' ? place.displayName.text.trim() : '',
      reviewCount: place.userRatingCount === undefined ? null : place.userRatingCount,
      matchedLat: lat,
      matchedLng: lng,
      distanceKm: lookups.coordinateDistanceKm(grid.matchedLat, grid.matchedLng, lat, lng),
      nameScore: placeName
        ? googlePlaceNameScore(placeName, place.displayName?.text)
        : 1
    };
  }).filter(place => place?.placeName && place.distanceKm <= GOOGLE_PLACE_MATCH_RADIUS_KM &&
    place.nameScore > 0 &&
    (place.reviewCount === null || (Number.isSafeInteger(place.reviewCount) && place.reviewCount >= 0)))
    .sort((a, b) => b.nameScore - a.nameScore || a.distanceKm - b.distanceKm)[0];
  return closest || null;
}

export function createWorker(fetcher = fetch) {
  const inflight = new Map();
  return {
    async fetch(request, env) {
      const origin = request.headers.get('Origin');
      const allowedOrigins = (env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
      const headers = {
        'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
        'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff'
      };
      const reply = (status, data, extra = {}) => new Response(JSON.stringify(data), { status, headers: { ...headers, ...extra } });
      if (origin && !allowedOrigins.includes(origin)) return reply(403, { error: 'Origin not allowed.' });
      if (origin) headers['Access-Control-Allow-Origin'] = origin;
      const url = new URL(request.url);
      if (url.pathname !== '/rarity') return reply(404, { error: 'Endpoint not found.' });
      if (request.method === 'OPTIONS') {
        if (request.headers.get('Access-Control-Request-Method') !== 'GET' ||
            request.headers.get('Access-Control-Request-Headers')) return reply(403, { error: 'Preflight not allowed.' });
        return reply(200, {}, { 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' });
      }
      if (request.method !== 'GET') return reply(405, { error: 'Use GET.' }, { Allow: 'GET, OPTIONS' });
      let grid;
      let placeName = '';
      try {
        if ([...url.searchParams.keys()].some(key => !['lat', 'lng', 'name'].includes(key)) ||
            url.searchParams.getAll('lat').length !== 1 || url.searchParams.getAll('lng').length !== 1 ||
            url.searchParams.getAll('name').length > 1) {
          throw new Error('Specify lat and lng exactly once, with at most one name.');
        }
        const latText = url.searchParams.get('lat').trim();
        const lngText = url.searchParams.get('lng').trim();
        if (!latText || !lngText) throw new Error('Coordinates cannot be empty.');
        if (url.searchParams.has('name')) {
          placeName = url.searchParams.get('name').trim().replace(/\s+/g, ' ');
          if (!placeName || !lookups.normalizePlaceName(placeName)) {
            throw new Error('Name must contain searchable letters or numbers.');
          }
          if (placeName.length > 150 || /[\u0000-\u001f\u007f]/.test(placeName)) {
            throw new Error('Name must be 150 characters or fewer and contain no control characters.');
          }
        }
        grid = coordinateGrid(Number(latText), Number(lngText));
      } catch (error) {
        return reply(400, { error: error.message });
      }
      try {
        if (!env.RARITY_CACHE || !env.RARITY_RATE_LIMITER) throw new Error('Required Worker bindings are not configured.');
        const cacheKey = await rarityCacheKey(grid, placeName);
        const { success } = await env.RARITY_RATE_LIMITER.limit({
          key: request.headers.get('CF-Connecting-IP') || 'unidentified-client'
        });
        if (!success) return reply(429, { error: 'Too many rarity requests. Retry later.' }, { 'Retry-After': '60' });
        const cached = await env.RARITY_CACHE.get(cacheKey, 'json');
        if (cached) {
          lookups.validateProviderRarity(cached);
          const validSource = [
            'OpenStreetMap contributors (ODbL)',
            'Google Places API (New) + OpenStreetMap contributors (ODbL)'
          ].includes(cached.source);
          if (!validSource ||
              (cached.source === 'OpenStreetMap contributors (ODbL)' && cached.reviewCount !== null) ||
              cached.matchedLat !== grid.matchedLat || cached.matchedLng !== grid.matchedLng) {
            throw new Error('Invalid cached rarity entry.');
          }
          if (!placeName || cached.source === 'Google Places API (New) + OpenStreetMap contributors (ODbL)') {
            return reply(200, { ...cached, cached: true });
          }
        }
        let operation = inflight.get(cacheKey);
        if (!operation) {
          operation = (async () => {
            const [openDataResult, googleResult] = await Promise.allSettled([
              fetchOpenDataSummary(fetcher, grid),
              env.GOOGLE_PLACES_API_KEY
                ? fetchGooglePlace(fetcher, env.GOOGLE_PLACES_API_KEY, grid, placeName)
                : Promise.resolve(null)
            ]);
            const openData = openDataResult.status === 'fulfilled' ? openDataResult.value : null;
            const googlePlace = googleResult.status === 'fulfilled' ? googleResult.value : null;
            if (googleResult.status === 'rejected') {
              console.warn('Google Places rarity lookup failed; using open-data rarity.', googleResult.reason);
            }
            if (openDataResult.status === 'rejected') {
              console.warn('Open-data highway lookup failed.', openDataResult.reason);
            }
            if (!openData && !googlePlace) {
              throw openDataResult.status === 'rejected'
                ? openDataResult.reason : new Error('No rarity provider returned a result.');
            }
            const popularityScore = openData?.summary.nearbyPoiCount || 0;
            const nearestHighwayKm = openData?.summary.nearestHighwayKm ?? null;
            const reviewCount = googlePlace?.reviewCount ?? null;
            const result = {
              placeName: googlePlace?.placeName || 'OSM vicinity (not a matched place)',
              reviewCount, popularityScore,
              rarityTier: reviewCount === null
                ? lookups.categoryForOpenData(popularityScore, nearestHighwayKm)
                : lookups.categoryForPoiCount(reviewCount),
              matchedLat: grid.matchedLat, matchedLng: grid.matchedLng,
              searchedName: placeName || null,
              cached: false,
              source: googlePlace
                ? 'Google Places API (New) + OpenStreetMap contributors (ODbL)'
                : 'OpenStreetMap contributors (ODbL)',
              radiusKm: 5, nearestHighwayKm,
              sampledAt: new Date().toISOString(),
              osmDataTimestamp: openData?.timestamp || null
            };
            lookups.validateProviderRarity(result);
            if (!placeName || googlePlace) await env.RARITY_CACHE.put(cacheKey, JSON.stringify(result));
            return result;
          })();
          inflight.set(cacheKey, operation);
          operation.then(() => inflight.delete(cacheKey), () => inflight.delete(cacheKey));
        }
        return reply(200, await operation);
      } catch (error) {
        console.error('Rarity Worker failed', error.message);
        return reply(503, { error: 'Rarity service unavailable. Retry later or use the direct open-data fallback.' });
      }
    }
  };
}

export default createWorker();
