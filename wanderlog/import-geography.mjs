import mapshaper from 'mapshaper';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ecoregions from './ecoregions.js';
import lookups from './coordinate-lookups.js';
import { feature as decode } from 'topojson-client';
import { setTimeout as delay } from 'node:timers/promises';

export const NPS_SOURCE = lookups.NPS_SOURCE;

export async function collectBoundaries(fetchJson) {
  const count = await fetchJson({ where: '1=1', returnCountOnly: 'true', f: 'json' });
  if (!Number.isInteger(count.count) || count.count < 400) throw new Error('Expected 400+ official NPS boundary records.');
  const features = [];
  for (let offset = 0; offset < count.count; offset += 100) {
    const page = await fetchJson({
      where: '1=1', outFields: 'OBJECTID,UNIT_CODE,UNIT_NAME', outSR: '4326',
      returnGeometry: 'true', geometryPrecision: '6', orderByFields: 'OBJECTID', resultOffset: String(offset),
      resultRecordCount: '100', f: 'geojson'
    });
    if (!Array.isArray(page.features) || page.features.length !== Math.min(100, count.count - offset)) {
      throw new Error(`Incomplete NPS boundary page at ${offset}.`);
    }
    features.push(...page.features);
  }
  const ids = new Set();
  return {
    type: 'FeatureCollection',
    features: features.map(feature => {
      const code = feature.properties?.UNIT_CODE?.toLowerCase();
      const id = feature.properties?.OBJECTID;
      if (!/^[a-z0-9]{4}$/.test(code) || ids.has(id) ||
          !['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)) {
        throw new Error(`Invalid NPS boundary record ${id}: ${code}.`);
      }
      ids.add(id);
      return { type: 'Feature', properties: { parkCode: code, name: feature.properties.UNIT_NAME }, geometry: feature.geometry };
    })
  };
}

export async function simplify(input, objectName, fields) {
  const output = await mapshaper.applyCommands(
    `-i source ${fields ? `-filter-fields ${fields}` : ''} -rename-layers ${objectName} ` +
    '-simplify weighted 1.5% keep-shapes -o format=topojson quantization=10000000',
    { source: input }
  );
  const topology = JSON.parse(Object.values(output)[0]);
  if (!topology.objects[objectName]?.geometries?.length) throw new Error(`No simplified ${objectName} geometries.`);
  if (decode(topology, topology.objects[objectName]).features.some(feature => !feature.geometry)) {
    throw new Error('Simplification/quantization removed a small boundary. Increase output precision.');
  }
  return topology;
}

async function publish(name, topology, metadata, maxBytes) {
  topology.metadata = { version: 1, generatedAt: new Date().toISOString(), ...metadata };
  const json = JSON.stringify(topology) + '\n';
  const size = Buffer.byteLength(json);
  if (size > maxBytes) throw new Error(`${name} is ${size} bytes, exceeding the ${maxBytes}-byte download budget.`);
  const target = new URL(`./${name}`, import.meta.url);
  await writeFile(new URL(`./${name}.tmp`, import.meta.url), json);
  await rename(new URL(`./${name}.tmp`, import.meta.url), target);
  console.log(`${name}: ${topology.objects[Object.keys(topology.objects)[0]].geometries.length} geometries, ${(size / 1024).toFixed(0)} KiB.`);
}

export async function buildEcoregions(shapefilePath) {
  if (!shapefilePath?.endsWith('.shp')) throw new Error('Pass the extracted RESOLVE Ecoregions2017.shp path.');
  const projection = await readFile(shapefilePath.replace(/\.shp$/, '.prj'), 'utf8');
  if (!projection.includes('GEOGCS["WGS 84"') || projection.includes('PROJCS[')) throw new Error('Expected RESOLVE WGS84 coordinates.');
  const output = await mapshaper.applyCommands(
    `-i "${shapefilePath}" -filter 'BIOME_NUM >= 1 && BIOME_NUM <= 14' ` +
    '-filter-fields ECO_ID,ECO_NAME,BIOME_NUM,REALM -rename-layers ecoregions ' +
    '-simplify weighted 0.8% keep-shapes -o format=topojson quantization=100000'
  );
  const resolve = JSON.parse(Object.values(output)[0]);
  await publish('ecoregions.topojson', resolve, {
    source: ecoregions.SOURCE, license: 'CC-BY-4.0',
    attribution: 'RESOLVE Ecoregions 2017, Dinerstein et al. (2017), updating WWF Terrestrial Ecoregions.',
    citation: 'https://doi.org/10.1093/biosci/bix014',
    sourceSha256: createHash('sha256').update(await readFile(shapefilePath)).digest('hex'),
    method: 'Weighted Visvalingam 0.8%, keep-shapes, TopoJSON quantization 100000. Approximate custom-coordinate lookup; coastal/border classifications can differ from unsimplified polygons. Water and rock/ice excluded.'
  }, 1800000);
}

async function main() {
  const shapefilePath = process.argv[2];
  if (!shapefilePath?.endsWith('.shp')) throw new Error('Pass the extracted RESOLVE Ecoregions2017.shp path.');
  const boundaries = await collectBoundaries(async parameters => {
    console.log(`Fetching NPS ${parameters.returnCountOnly ? 'record count' : `boundary page ${parameters.resultOffset}`}.`);
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(`${NPS_SOURCE}/query?${new URLSearchParams(parameters)}`, { signal: AbortSignal.timeout(180000) });
        if (!response.ok) {
          if (attempt < 2 && (response.status === 429 || response.status >= 500)) {
            console.warn(`NPS HTTP ${response.status}; retrying request.`);
            await delay(2000 * (attempt + 1));
            continue;
          }
          throw new Error(`NPS boundary request failed (HTTP ${response.status}).`);
        }
        const result = await response.json();
        if (result.error) throw new Error(`NPS boundary service: ${result.error.message}`);
        return result;
      } catch (error) {
        if (attempt >= 2 || !['TimeoutError', 'TypeError'].includes(error.name)) throw error;
        console.warn(`NPS network request failed: ${error.message}; retrying.`);
        await delay(2000 * (attempt + 1));
      }
    }
  });
  const nps = await simplify(JSON.stringify(boundaries), 'parks');
  await publish('nps-boundaries.topojson', nps, {
    source: NPS_SOURCE, attribution: 'National Park Service Land Resources Division',
    sourceSha256: createHash('sha256').update(JSON.stringify(boundaries)).digest('hex'),
    method: 'WGS84 legislative boundaries, weighted Visvalingam 1.5%, keep-shapes, TopoJSON quantization 10000000 to preserve small historic sites. Administrative/game use only; not survey, ownership, navigation, or legal boundaries.'
  }, 750000);

  await buildEcoregions(shapefilePath);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
