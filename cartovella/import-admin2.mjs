import mapshaper from 'mapshaper';
import { createHash } from 'node:crypto';
import { writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { get } from 'node:https';
import { feature as decode } from 'topojson-client';

export const ADMIN2_COUNTRIES = ['CAN', 'MEX', 'DEU', 'AUS'];
export const ADMIN2_METADATA_URL = iso3 => `https://www.geoboundaries.org/api/current/gbOpen/${iso3}/ADM2/`;
const MAX_BYTES = 1_500_000;

function downloadText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); }
    catch (error) { reject(error); return; }
    if (parsed.protocol !== 'https:' || redirects > 5) {
      reject(new Error('Admin-2 source must use HTTPS and no more than five redirects.'));
      return;
    }
    const request = get(parsed, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        downloadText(new URL(response.headers.location, parsed).href, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Admin-2 source request failed (HTTP ${response.statusCode}): ${parsed.href}`));
        return;
      }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      response.on('error', reject);
    });
    request.setTimeout(180000, () => request.destroy(new Error(`Admin-2 source request timed out: ${parsed.href}`)));
    request.on('error', reject);
  });
}

function featureName(feature) {
  const name = feature.properties?.shapeName;
  return typeof name === 'string' ? name.trim() : '';
}

function localFeatureId(value) {
  return String(value).trim().replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^_+|_+$/g, '');
}

export function selectAdmin2Features(collection, iso3) {
  if (!ADMIN2_COUNTRIES.includes(iso3) || collection?.type !== 'FeatureCollection' ||
      !Array.isArray(collection.features) || !collection.features.length) {
    throw new Error(`Expected a non-empty geoBoundaries ADM2 FeatureCollection for ${iso3}.`);
  }
  const ids = new Set();
  return collection.features.map(feature => {
    const name = featureName(feature);
    const rawId = feature.properties?.shapeID || name;
    const id = `${iso3}:${localFeatureId(rawId)}`;
    if (!name || !/^[A-Z]{3}:[A-Za-z0-9_.-]+$/.test(id) || ids.has(id) ||
        !['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)) {
      throw new Error(`Invalid or duplicate geoBoundaries ADM2 feature for ${iso3}: ${name || '(unnamed)'}.`);
    }
    ids.add(id);
    return {
      type: 'Feature',
      id,
      properties: { id, name, country: iso3 },
      geometry: feature.geometry
    };
  });
}

export async function collectAdmin2(fetchText = downloadText) {
  const sources = [];
  const features = [];
  for (const iso3 of ADMIN2_COUNTRIES) {
    const metadataUrl = ADMIN2_METADATA_URL(iso3);
    const metadata = JSON.parse(await fetchText(metadataUrl));
    if (!metadata || metadata.boundaryISO !== iso3 || metadata.boundaryType !== 'ADM2' ||
        typeof metadata.simplifiedGeometryGeoJSON !== 'string' ||
        !metadata.simplifiedGeometryGeoJSON.startsWith('https://')) {
      throw new Error(`geoBoundaries returned invalid ADM2 metadata for ${iso3}.`);
    }
    const geoJsonText = await fetchText(metadata.simplifiedGeometryGeoJSON);
    const collection = JSON.parse(geoJsonText);
    const selected = selectAdmin2Features(collection, iso3);
    features.push(...selected);
    sources.push({
      iso3, metadataUrl, geoJsonUrl: metadata.simplifiedGeometryGeoJSON,
      boundaryID: metadata.boundaryID || '', boundaryYear: metadata.boundaryYear || '',
      sourceSha256: createHash('sha256').update(geoJsonText).digest('hex')
    });
  }
  const ids = new Set();
  for (const feature of features) {
    if (ids.has(feature.id)) throw new Error(`Duplicate Admin-2 ID across sources: ${feature.id}.`);
    ids.add(feature.id);
  }
  return { features, sources };
}

export async function buildAdmin2(features, sources) {
  if (!Array.isArray(features) || !features.length ||
      features.some(feature => !/^[A-Z]{3}:[A-Za-z0-9_.-]+$/.test(feature.id || ''))) {
    throw new Error('Admin-2 features must have valid stable IDs.');
  }
  const output = await mapshaper.applyCommands(
    '-i source -rename-layers admin2 -filter-fields id,name,country ' +
    '-simplify weighted 1% keep-shapes -o format=topojson quantization=100000 id-field=id',
    { source: JSON.stringify({ type: 'FeatureCollection', features }) }
  );
  const topology = JSON.parse(Object.values(output)[0]);
  const geometries = topology.objects.admin2?.geometries || [];
  if (geometries.length !== features.length) throw new Error('Admin-2 simplification lost features.');
  for (const geometry of geometries) {
    if (!/^[A-Z]{3}:[A-Za-z0-9_.-]+$/.test(geometry.id || '') ||
        !geometry.properties?.name || !ADMIN2_COUNTRIES.includes(geometry.properties?.country)) {
      throw new Error('Simplified Admin-2 topology has invalid IDs or properties.');
    }
    delete geometry.properties.id;
    if (Object.keys(geometry.properties).sort().join(',') !== 'country,name') {
      throw new Error('Simplified Admin-2 topology contains unexpected properties.');
    }
  }
  topology.metadata = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'geoBoundaries gbOpen ADM2',
    license: 'CC-BY-4.0',
    attribution: 'geoBoundaries Open (gbOpen), Admin-2 boundaries for Canada, Mexico, Germany, and Australia.',
    sources,
    method: 'Weighted Visvalingam 1%, keep-shapes, TopoJSON quantization 100000.'
  };
  const json = `${JSON.stringify(topology)}\n`;
  const size = Buffer.byteLength(json);
  if (size > MAX_BYTES) {
    throw new Error(`world-admin2.topojson is ${size} bytes, exceeding the ${MAX_BYTES}-byte snapshot budget.`);
  }
  const decoded = decode(topology, topology.objects.admin2).features;
  if (decoded.length !== features.length || decoded.some(feature => !feature.geometry)) {
    throw new Error('Generated Admin-2 snapshot failed geometry validation.');
  }
  return { topology, json, featureCount: geometries.length };
}

async function main() {
  const { features, sources } = await collectAdmin2();
  const { json, featureCount } = await buildAdmin2(features, sources);
  await writeFile(new URL('./world-admin2.topojson.tmp', import.meta.url), json);
  await rename(new URL('./world-admin2.topojson.tmp', import.meta.url),
    new URL('./world-admin2.topojson', import.meta.url));
  console.log(`world-admin2.topojson: ${featureCount} county equivalents, ${(Buffer.byteLength(json) / 1024).toFixed(0)} KiB.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
