import mapshaper from 'mapshaper';
import { createHash } from 'node:crypto';
import { writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { get } from 'node:https';
import { feature as decode } from 'topojson-client';

export const SUBDIVISION_SOURCE =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson';
const MAX_BYTES = 1_500_000;

function downloadSourceText(url) {
  return new Promise((resolve, reject) => {
    const request = get(url, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Natural Earth subdivision request failed (HTTP ${response.statusCode}).`));
        return;
      }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      response.on('error', reject);
    });
    request.setTimeout(120000, () => request.destroy(new Error('Natural Earth subdivision request timed out.')));
    request.on('error', reject);
  });
}

export function selectSubdivisionFeatures(features) {
  if (!Array.isArray(features)) throw new Error('Natural Earth subdivisions must be a feature array.');
  const ids = new Set();
  return features.flatMap(feature => {
    const properties = feature.properties || {};
    if (properties.adm0_a3 === 'USA' || properties.iso_a2 === 'US') return [];
    const isoA3 = properties.adm0_a3;
    const rawId = properties.adm1_code || properties.diss_me || properties.name || properties.name_en;
    const country = [properties.admin, properties.geonunit, properties.sov_a3]
      .find(value => typeof value === 'string' && value.trim());
    const name = [properties.name, properties.name_en, properties.name_local, properties.name_alt]
      .find(value => typeof value === 'string' && value.trim()) || (rawId ? String(rawId) : '');
    if (!/^[A-Z]{3}$/.test(isoA3 || '') || !rawId ||
        !['Polygon', 'MultiPolygon'].includes(feature.geometry?.type) ||
        !name || !country) {
      throw new Error(`Invalid Natural Earth subdivision: ${name || '(unnamed)'}.`);
    }
    const localId = String(rawId).replace(/[^A-Za-z0-9_.-]/g, '_');
    const id = `${isoA3}:${localId}`;
    if (!/^[A-Z]{3}:[A-Za-z0-9_.-]+$/.test(id) || ids.has(id)) {
      throw new Error(`Invalid or duplicate Natural Earth subdivision ID: ${id}.`);
    }
    ids.add(id);
    return [{
      type: 'Feature',
      id,
      properties: {
        id, name, country, isoA3, region: typeof properties.region === 'string' ? properties.region : ''
      },
      geometry: feature.geometry
    }];
  });
}

export async function buildSubdivisions(sourceText) {
  const source = JSON.parse(sourceText);
  const features = selectSubdivisionFeatures(source.features);
  const output = await mapshaper.applyCommands(
    '-i source -rename-layers subdivisions -filter-fields id,name,country,isoA3,region ' +
    '-simplify weighted 5% keep-shapes -o format=topojson quantization=100000 id-field=id',
    { source: JSON.stringify({ type: 'FeatureCollection', features }) }
  );
  const topology = JSON.parse(Object.values(output)[0]);
  const geometries = topology.objects.subdivisions?.geometries || [];
  if (geometries.length !== features.length) throw new Error('Subdivision simplification lost features.');
  for (const geometry of geometries) {
    if (!/^[A-Z]{3}:[A-Za-z0-9_.-]+$/.test(geometry.id || '') ||
        !geometry.properties?.name || !geometry.properties?.country ||
        !/^[A-Z]{3}$/.test(geometry.properties?.isoA3 || '') ||
        geometry.properties.isoA3 === 'USA') {
      throw new Error('Simplified subdivision topology has invalid IDs or properties.');
    }
    delete geometry.properties.id;
    if (Object.keys(geometry.properties).sort().join(',') !== 'country,isoA3,name,region') {
      throw new Error('Simplified subdivision topology contains unexpected properties.');
    }
  }
  topology.metadata = {
    version: 1, generatedAt: new Date().toISOString(), source: SUBDIVISION_SOURCE,
    license: 'Public domain (Natural Earth)',
    attribution: 'Made with Natural Earth v5.1.2, 1:10m Admin 1 states/provinces.',
    sourceSha256: createHash('sha256').update(sourceText).digest('hex'),
    method: 'Weighted Visvalingam 5%, keep-shapes, TopoJSON quantization 100000; US features excluded because the atlas uses dedicated US states and counties.'
  };
  const json = `${JSON.stringify(topology)}\n`;
  const size = Buffer.byteLength(json);
  if (size > MAX_BYTES) {
    throw new Error(`world-subdivisions.topojson is ${size} bytes, exceeding the ${MAX_BYTES}-byte snapshot budget.`);
  }
  return { topology, json, featureCount: geometries.length };
}

async function main() {
  const sourceText = await downloadSourceText(SUBDIVISION_SOURCE);
  const { topology, json, featureCount } = await buildSubdivisions(sourceText);
  const decoded = decode(topology, topology.objects.subdivisions).features;
  if (decoded.length !== featureCount || decoded.some(feature =>
    !feature.geometry || feature.properties?.isoA3 === 'USA')) {
    throw new Error('Generated subdivision snapshot failed validation.');
  }
  await writeFile(new URL('./world-subdivisions.topojson.tmp', import.meta.url), json);
  await rename(new URL('./world-subdivisions.topojson.tmp', import.meta.url),
    new URL('./world-subdivisions.topojson', import.meta.url));
  console.log(`world-subdivisions.topojson: ${featureCount} subdivisions, ${(Buffer.byteLength(json) / 1024).toFixed(0)} KiB.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
