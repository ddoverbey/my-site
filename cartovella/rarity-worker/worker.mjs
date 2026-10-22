import lookups from '../coordinate-lookups.js';

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
      try {
        if ([...url.searchParams.keys()].some(key => !['lat', 'lng'].includes(key)) ||
            url.searchParams.getAll('lat').length !== 1 || url.searchParams.getAll('lng').length !== 1) {
          throw new Error('Specify lat and lng exactly once.');
        }
        const latText = url.searchParams.get('lat').trim();
        const lngText = url.searchParams.get('lng').trim();
        if (!latText || !lngText) throw new Error('Coordinates cannot be empty.');
        grid = coordinateGrid(Number(latText), Number(lngText));
      } catch (error) {
        return reply(400, { error: error.message });
      }
      try {
        if (!env.RARITY_CACHE || !env.RARITY_RATE_LIMITER) throw new Error('Required Worker bindings are not configured.');
        const { success } = await env.RARITY_RATE_LIMITER.limit({
          key: request.headers.get('CF-Connecting-IP') || 'unidentified-client'
        });
        if (!success) return reply(429, { error: 'Too many rarity requests. Retry later.' }, { 'Retry-After': '60' });
        const cached = await env.RARITY_CACHE.get(grid.key, 'json');
        if (cached) {
          lookups.validateProviderRarity(cached);
          if (cached.reviewCount !== null || cached.source !== 'OpenStreetMap contributors (ODbL)' ||
              cached.matchedLat !== grid.matchedLat || cached.matchedLng !== grid.matchedLng) {
            throw new Error('Invalid cached open-data rarity entry.');
          }
          return reply(200, { ...cached, cached: true });
        }
        let operation = inflight.get(grid.key);
        if (!operation) {
          operation = (async () => {
            const query = `[out:json][timeout:25];(node(around:5000,${grid.matchedLat},${grid.matchedLng})["tourism"];` +
              `node(around:5000,${grid.matchedLat},${grid.matchedLng})["amenity"];` +
              `way(around:5000,${grid.matchedLat},${grid.matchedLng})["highway"~"^(motorway|trunk)$"];);out body geom;`;
            const response = await fetcher(lookups.OVERPASS_URL, {
              method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ data: query }).toString(), signal: AbortSignal.timeout(30000)
            });
            if (!response.ok) throw new Error(`Overpass HTTP ${response.status}.`);
            const data = await response.json();
            if (data.remark) throw new Error('Overpass returned an incomplete query.');
            const summary = lookups.summarizeOsm(data.elements, grid.matchedLat, grid.matchedLng);
            const result = {
              placeName: 'OSM vicinity (not a matched place)', reviewCount: null,
              popularityScore: summary.nearbyPoiCount, rarityTier: summary.category,
              matchedLat: grid.matchedLat, matchedLng: grid.matchedLng,
              cached: false, source: 'OpenStreetMap contributors (ODbL)',
              radiusKm: 5, nearestHighwayKm: summary.nearestHighwayKm,
              sampledAt: new Date().toISOString(),
              osmDataTimestamp: data.osm3s?.timestamp_osm_base || null
            };
            lookups.validateProviderRarity(result);
            await env.RARITY_CACHE.put(grid.key, JSON.stringify(result));
            return result;
          })();
          inflight.set(grid.key, operation);
          operation.then(() => inflight.delete(grid.key), () => inflight.delete(grid.key));
        }
        return reply(200, await operation);
      } catch (error) {
        console.error('Open-data rarity Worker failed', error.message);
        return reply(503, { error: 'Rarity service unavailable. Use the direct OSM fallback or retry later.' });
      }
    }
  };
}

export default createWorker();
