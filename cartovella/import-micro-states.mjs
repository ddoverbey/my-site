import mapshaper from 'mapshaper';
import { writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as geo from 'd3-geo';
import area from '@turf/area';
import { feature as decode } from 'topojson-client';
import microStates from './micro-states.js';
import lookups from './coordinate-lookups.js';

// Interior label point: centroid of the largest island, or the nearest interior grid sample when that centroid falls offshore.
export function labelPoint(feature) {
  const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  const largest = polygons
    .map(coordinates => lookups.normalizeFeature({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates } }, geo.geoArea))
    .sort((a, b) => area(b) - area(a))[0];
  const centroid = geo.geoCentroid(largest);
  if (geo.geoContains(largest, centroid)) return centroid;
  const [[west, south], [east, north]] = geo.geoBounds(largest);
  let best = null;
  for (let i = 0; i <= 60; i++) {
    for (let j = 0; j <= 60; j++) {
      const point = [west + (east - west) * i / 60, south + (north - south) * j / 60];
      if (!geo.geoContains(largest, point)) continue;
      const distance = geo.geoDistance(point, centroid);
      if (!best || distance < best.distance) best = { point, distance };
    }
  }
  if (!best) throw new Error(`No interior label point for ${feature.properties.name}.`);
  return best.point;
}

// `detailed` is raw Natural Earth GeoJSON (NAME/ISO_N3); `base` is the decoded world-atlas 110m Scratch Map layer.
export function selectMicroStates(detailed, base) {
  const mappedNames = new Set(base.map(feature => feature.properties.name));
  const mappedIds = new Set(base.map(feature => feature.id).filter(Boolean));
  return detailed
    .map(feature => ({ ...feature, id: feature.properties.ISO_N3, properties: { name: feature.properties.NAME } }))
    .filter(feature => /^\d{3}$/.test(feature.id) && !microStates.EXCLUDED_IDS.includes(feature.id) &&
      !mappedIds.has(feature.id) && !mappedNames.has(feature.properties.name))
    .map(feature => ({
      type: 'Feature', geometry: feature.geometry,
      properties: { id: feature.id, name: feature.properties.name }
    }));
}

// Label points are computed on the published (simplified, quantized) geometry so containment lookups resolve them.
export function addLabelPoints(topology) {
  const decoded = decode(topology, topology.objects.microStates).features;
  topology.objects.microStates.geometries.forEach((geometry, index) => {
    const [lng, lat] = labelPoint(decoded[index]).map(value => Math.round(value * 1e5) / 1e5);
    const feature = lookups.normalizeFeature(decoded[index], geo.geoArea);
    if (!geo.geoContains(feature, [lng, lat])) throw new Error(`Label point falls outside ${geometry.properties.name}.`);
    geometry.properties = { ...geometry.properties, lat, lng };
  });
  return topology;
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Atlas request failed (HTTP ${response.status}): ${url}`);
  return response.text();
}

async function main() {
  const [detailedText, baseText] = await Promise.all([fetchJson(microStates.SOURCE), fetchJson(microStates.BASE_SOURCE)]);
  const base = JSON.parse(baseText);
  const features = selectMicroStates(JSON.parse(detailedText).features, decode(base, base.objects.countries).features);
  const output = await mapshaper.applyCommands(
    '-i source -rename-layers microStates -simplify weighted 25% keep-shapes ' +
    '-o format=topojson quantization=1000000 id-field=id',
    { source: JSON.stringify({ type: 'FeatureCollection', features }) }
  );
  const topology = addLabelPoints(JSON.parse(Object.values(output)[0]));
  topology.metadata = {
    version: 1, generatedAt: new Date().toISOString(), source: microStates.SOURCE, license: 'Public domain (Natural Earth)',
    attribution: 'Made with Natural Earth (v5.1.2 admin-0 countries, 1:10m).',
    sourceSha256: createHash('sha256').update(detailedText).digest('hex'),
    method: 'Admin-0 1:10m polygons absent from the world-atlas 1:110m Scratch Map, weighted Visvalingam 25%, keep-shapes, TopoJSON quantization 1000000. Label points lie inside the largest island.'
  };
  microStates.validateTopology(topology, decode);
  const json = JSON.stringify(topology) + '\n';
  if (Buffer.byteLength(json) > 400000) throw new Error(`micro-states.topojson exceeds the 400000-byte download budget.`);
  await writeFile(new URL('./micro-states.topojson.tmp', import.meta.url), json);
  await rename(new URL('./micro-states.topojson.tmp', import.meta.url), new URL('./micro-states.topojson', import.meta.url));
  console.log(`micro-states.topojson: ${features.length} territories, ${(Buffer.byteLength(json) / 1024).toFixed(0)} KiB.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
