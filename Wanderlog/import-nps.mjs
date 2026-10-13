import https from 'node:https';
import { writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import catalog from './nps-catalog.js';

export function requestPage(start, apiKey) {
  const url = new URL('https://developer.nps.gov/api/v1/parks');
  url.searchParams.set('limit', '100');
  url.searchParams.set('start', String(start));
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'X-Api-Key': apiKey } }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`NPS API returned HTTP ${response.statusCode}. Check the key or retry later.`));
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('error', reject);
      response.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('NPS API returned invalid JSON.')); }
      });
    });
    request.setTimeout(30000, () => request.destroy(new Error('NPS API request timed out.')));
    request.on('error', reject);
  });
}

export async function collectParks(getPage) {
  const records = [];
  let total;
  do {
    const page = await getPage(records.length);
    const pageTotal = Number(page.total);
    if (!Number.isInteger(pageTotal) || pageTotal < 400 ||
        (total !== undefined && total !== pageTotal) ||
        !Array.isArray(page.data) || page.data.length === 0 ||
        records.length + page.data.length > pageTotal) {
      throw new Error('Incomplete or inconsistent NPS API pagination.');
    }
    total = pageTotal;
    records.push(...page.data);
  } while (records.length < total);
  catalog.normalizeParks(records);
  return { source: 'https://developer.nps.gov/api/v1/parks', fetchedAt: new Date().toISOString(), total, data: records };
}

async function main() {
  const apiKey = process.env.NPS_API_KEY;
  if (!apiKey) throw new Error('Set NPS_API_KEY before running the importer. Never commit the key.');
  const dataset = await collectParks(start => requestPage(start, apiKey));
  const target = new URL('./nps-parks.json', import.meta.url);
  const temporary = new URL('./nps-parks.json.tmp', import.meta.url);
  await writeFile(temporary, JSON.stringify(dataset, null, 2) + '\n');
  await rename(temporary, target);
  console.log(`Imported ${dataset.total} NPS records into nps-parks.json.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
