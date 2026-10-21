import { open } from 'shapefile';
import { area } from '@turf/area';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import catalog from './nps-catalog.js';
import internationalCatalog from './international-parks.js';
import ecoregions from './ecoregions.js';

export function geometryBounds(geometry) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of polygons) for (const ring of polygon) for (const [lng, lat] of ring) {
    bounds[0] = Math.min(bounds[0], lng);
    bounds[1] = Math.min(bounds[1], lat);
    bounds[2] = Math.max(bounds[2], lng);
    bounds[3] = Math.max(bounds[3], lat);
  }
  return bounds;
}

export async function buildSnapshot(source, parks) {
  const locations = Object.fromEntries(parks.map(park => [park.id, {
    lat: park.lat, lng: park.lng, ecoregions: [],
    status: park.lat === null || park.lng === null ? 'missing-coordinates' : 'no-terrestrial-match'
  }]));
  const areas = Array(14).fill(0);
  const regionIds = new Set();
  let result;
  while (!(result = await source.read()).done) {
    const feature = result.value;
    const p = feature.properties;
    if (p.LICENSE !== 'CC-BY 4.0' || !Number.isInteger(p.BIOME_NUM) ||
        !Number.isInteger(p.ECO_ID) || typeof p.ECO_NAME !== 'string' ||
        typeof p.REALM !== 'string' || !['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)) {
      throw new Error('Unexpected RESOLVE shapefile schema or license.');
    }
    // Rock/ice and inland water polygons are not part of the 14 terrestrial biomes.
    if (p.BIOME_NUM === 98 || p.BIOME_NUM === 99) continue;
    if (p.BIOME_NUM < 1 || p.BIOME_NUM > 14) throw new Error(`Unknown biome ${p.BIOME_NUM}.`);
    regionIds.add(p.ECO_ID);
    const squareMeters = area(feature);
    if (!Number.isFinite(squareMeters) || squareMeters <= 0) throw new Error(`Invalid area for ${p.ECO_NAME}.`);
    areas[p.BIOME_NUM - 1] += squareMeters / 1e6;
    const [west, south, east, north] = geometryBounds(feature.geometry);
    for (const location of Object.values(locations)) {
      if (location.lat === null || location.lng === null ||
          location.lng < west || location.lng > east || location.lat < south || location.lat > north) continue;
      if (booleanPointInPolygon([location.lng, location.lat], feature) &&
          !location.ecoregions.some(region => region.id === p.ECO_ID)) {
        location.ecoregions.push({ id: p.ECO_ID, name: p.ECO_NAME, biomeId: p.BIOME_NUM, realm: p.REALM });
        location.status = 'matched';
      }
    }
  }
  const totalArea = areas.reduce((sum, value) => sum + value, 0);
  const snapshot = {
    version: 1, source: ecoregions.SOURCE, license: 'CC-BY-4.0',
    attribution: 'RESOLVE Ecoregions 2017, Dinerstein et al. (2017), updating WWF Terrestrial Ecoregions.',
    citation: 'https://doi.org/10.1093/biosci/bix014',
    generatedAt: new Date().toISOString(), ecoregionCount: regionIds.size,
    method: 'WGS84 destination point intersects unsimplified terrestrial ecoregion polygons. Rarity uses spherical geodesic area share: common >=10%, uncommon >=2% and <10%, rare >=0.5% and <2%, epic >=0.25% and <0.5%, legendary >=0.1% and <0.25%, mythic <0.1% of classified biome land. Rock/ice and water excluded.',
    biomes: areas.map((areaKm2, index) => {
      const areaShare = areaKm2 / totalArea * 100;
      return { id: index + 1, name: ecoregions.names[index], areaKm2, areaShare, rarity: ecoregions.rarityForShare(areaShare) };
    }),
    locations
  };
  return snapshot;
}

async function main() {
  const shapefilePath = process.argv[2];
  if (!shapefilePath) throw new Error('Pass the extracted Ecoregions2017.shp path. Download the CC-BY-4.0 source linked in README.');
  const projection = await readFile(shapefilePath.replace(/\.shp$/i, '.prj'), 'utf8');
  if (!projection.includes('GEOGCS["WGS 84"') || projection.includes('PROJCS[')) {
    throw new Error('Expected RESOLVE WGS84 longitude/latitude coordinates.');
  }
  const nps = JSON.parse(await readFile(new URL('./nps-parks.json', import.meta.url), 'utf8'));
  const worldwide = JSON.parse(await readFile(new URL('./worldwide-national-parks.json', import.meta.url), 'utf8'));
  const wikidata = JSON.parse(await readFile(new URL('./wikidata-national-parks-query.json', import.meta.url), 'utf8'));
  const internationalParks = internationalCatalog.combineParks(worldwide, wikidata).parks;
  const parks = [...catalog.normalizeParks(nps.data), ...internationalParks];
  const snapshot = await buildSnapshot(await open(shapefilePath), parks);
  ecoregions.validateSnapshot(snapshot);
  snapshot.sourceSha256 = createHash('sha256').update(await readFile(shapefilePath)).digest('hex');
  const target = new URL('./ecoregion-mapping.json', import.meta.url);
  const temporary = new URL('./ecoregion-mapping.json.tmp', import.meta.url);
  await writeFile(temporary, JSON.stringify(snapshot, null, 2) + '\n');
  await rename(temporary, target);
  const matched = Object.values(snapshot.locations).filter(location => location.status === 'matched').length;
  console.log(`Mapped ${matched}/${parks.length} destinations using ${snapshot.ecoregionCount} ecoregions. Unmatched points remain unclassified.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
