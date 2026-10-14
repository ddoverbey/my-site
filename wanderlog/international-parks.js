(function (root) {
  'use strict';
  const source = 'https://github.com/RohanNagar/parksoftheworld';
  const wikidataSource = 'https://www.wikidata.org/';
  const excludedCountries = new Set(['US', 'AS', 'GU', 'MP', 'PR', 'VI', 'UM']);
  const membershipLabels = {
    unesco: 'UNESCO World Heritage', dark_sky: 'International Dark Sky Park',
    ramsar: 'Ramsar Site', iucn_green: 'IUCN Green List'
  };

  function slug(value) {
    return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function normalizeParks(records) {
    if (!Array.isArray(records) || !records.length) throw new Error('Worldwide parks must be a nonempty array.');
    const countryNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
    const ids = new Set();
    const parks = [];
    let excludedCount = 0;
    for (const p of records) {
      if (!p || typeof p.country !== 'string' || !/^[A-Z]{2}$/.test(p.country)) {
        throw new Error('Invalid worldwide park country code.');
      }
      if (excludedCountries.has(p.country)) {
        excludedCount++;
        continue;
      }
      const country = countryNames.of(p.country);
      if (!country || p.country === 'ZZ' || typeof p.name !== 'string' || !p.name.trim() ||
          typeof p.description !== 'string' || typeof p.url !== 'string') {
        throw new Error(`Invalid worldwide park metadata (${p.country}).`);
      }
      const name = p.name.trim();
      const id = p.country === 'NZ' && name === 'Fiordland' ? 'fiordland' : `world-${p.country.toLowerCase()}-${slug(name)}`;
      if (!slug(name) || ids.has(id)) throw new Error(`Duplicate worldwide park: ${country} / ${name}.`);
      ids.add(id);
      let url;
      try { url = new URL(p.url); }
      catch { throw new Error(`Invalid source URL for ${name}.`); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error(`Unsafe source URL for ${name}.`);
      }
      const coordinate = (value, limit) => {
        if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
        if (!['string', 'number'].includes(typeof value) || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > limit) {
          throw new Error(`Invalid coordinates for ${name}.`);
        }
        return Number(value);
      };
      const optionalNumber = (value, field) => {
        if (value === undefined || value === null) return null;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`Invalid ${field} for ${name}.`);
        return value;
      };
      const memberships = p.memberships === undefined ? {} : p.memberships;
      if (!memberships || typeof memberships !== 'object' || Array.isArray(memberships) ||
          !Object.entries(memberships).every(([key, value]) => typeof value === 'boolean' ||
            (key === 'dark_sky' && ['Reserve', 'Sanctuary', 'Park'].includes(value))) ||
          (p.established !== undefined && p.established !== null && typeof p.established !== 'string')) {
        throw new Error(`Invalid optional metadata for ${name}.`);
      }
      parks.push({
        id, name, country, countryCode: p.country, intl: true,
        desc: p.description, url: url.href, source,
        lat: coordinate(p.latitude, 90), lng: coordinate(p.longitude, 180),
        established: p.established || null, areaKm2: optionalNumber(p.size_in_km, 'size'),
        visitorCount: optionalNumber(p.visitor_count, 'visitor count'),
        memberships: Object.entries(memberships).filter(([, active]) => active)
          .map(([key, value]) => key === 'dark_sky' && typeof value === 'string'
            ? `International Dark Sky ${value}` : membershipLabels[key] || key),
        biomes: [], ecoregions: [], biomeStatus: 'unavailable'
      });
    }
    return { parks: parks.sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name)), excludedCount };
  }

  function nameKey(value) {
    const text = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const clean = text => text.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
    return clean(text.replace(/\bnational parks?\b/g, '')) || clean(text);
  }

  function distanceKm(a, b) {
    const radians = Math.PI / 180;
    const h = Math.sin((a.lat - b.lat) * radians / 2) ** 2 +
      Math.cos(a.lat * radians) * Math.cos(b.lat * radians) *
      Math.sin((a.lng - b.lng) * radians / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
  }

  function normalizeWikidata(records) {
    if (!Array.isArray(records) || !records.length) throw new Error('Wikidata parks must be a nonempty array.');
    const names = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
    const codes = new Map();
    for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      const name = names.of(code);
      if (name && code !== 'ZZ' && new Intl.Locale(`und-${code}`).region === code) codes.set(nameKey(name), code);
    }
    for (const [name, code] of Object.entries({
      'United States': 'US', 'United States of America': 'US', 'U.S. Virgin Islands': 'VI',
      'United States Virgin Islands': 'VI', 'Virgin Islands (U.S.)': 'VI',
      'United States Minor Outlying Islands': 'UM', 'Czech Republic': 'CZ',
      "People's Republic of China": 'CN', 'Ivory Coast': 'CI', 'The Bahamas': 'BS', 'The Gambia': 'GM',
      'Bosnia and Herzegovina': 'BA', 'Democratic Republic of the Congo': 'CD', 'Republic of the Congo': 'CG',
      'Saint Kitts and Nevis': 'KN', 'Myanmar': 'MM', 'Turkey': 'TR', 'Palestine': 'PS'
    })) codes.set(nameKey(name), code);
    const groups = new Map();
    let excludedCount = 0;
    for (const row of records) {
      if (!row || typeof row.parkLabel !== 'string' || !row.parkLabel.trim() ||
          (row.countryLabel !== undefined && typeof row.countryLabel !== 'string')) {
        throw new Error('Invalid Wikidata park metadata.');
      }
      const name = row.parkLabel.trim();
      const countryLabel = row.countryLabel?.trim() || 'Country unspecified';
      const countryCode = codes.get(nameKey(countryLabel)) || null;
      if (excludedCountries.has(countryCode)) { excludedCount++; continue; }
      const lat = Number(row.lat), lng = Number(row.lon);
      if (!['string', 'number'].includes(typeof row.lat) || !['string', 'number'].includes(typeof row.lon) ||
          String(row.lat).trim() === '' || String(row.lon).trim() === '' ||
          !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        throw new Error(`Invalid Wikidata coordinates for ${name}.`);
      }
      const country = countryCode ? names.of(countryCode) : countryLabel;
      const key = `${countryCode || nameKey(country)}:${nameKey(name)}`;
      if (!nameKey(name)) throw new Error(`Invalid Wikidata name: ${name}.`);
      if (!groups.has(key)) groups.set(key, { name, country, countryCode, points: [], rowCount: 0 });
      const group = groups.get(key);
      if (name.localeCompare(group.name) < 0) group.name = name;
      group.rowCount++;
      if (!group.points.some(p => p.lat === lat && p.lng === lng)) group.points.push({ lat, lng });
    }
    const candidates = [...groups.entries()].map(([key, group]) => {
      // The export contains no entity IDs or coordinate ranks. Keep a deterministic source point, never an average.
      group.points.sort((a, b) => a.lat - b.lat || a.lng - b.lng);
      const point = group.points[0];
      const warnings = [];
      if (!group.countryCode) warnings.push(`Unverified country label: ${group.country}.`);
      if (/^Q\d+$/.test(group.name)) warnings.push('Wikidata label unavailable; entity number retained.');
      if (nameKey(group.name) === 'national-park') warnings.push('Generic source label; park identity needs verification.');
      if (group.points.length > 1) warnings.push(`${group.points.length} source coordinates; deterministic first point used.`);
      if (group.points.some(p => distanceKm(point, p) > 50)) warnings.push('Source coordinates differ by more than 50 km.');
      const legacyIds = {
        'CA:banff': 'banff', 'CL:torres-del-paine': 'torres', 'TZ:serengeti': 'serengeti',
        'HR:plitvice-lakes': 'plitvice', 'IS:thingvellir': 'thingvellir', 'ZA:kruger': 'kruger',
        'AU:uluru-kata-tjuta': 'uluru', 'NZ:fiordland': 'fiordland'
      };
      return {
        id: legacyIds[key] || `wiki-${encodeURIComponent(key).replace(/%/g, '_')}`, name: group.name,
        country: group.country, countryCode: group.countryCode, intl: true, ...point,
        desc: 'Wikidata query entry. Classification and current park status are not independently verified.',
        url: /^Q\d+$/.test(group.name) ? `${wikidataSource}wiki/${group.name}` :
          `${wikidataSource}w/index.php?search=${encodeURIComponent(`${group.name} ${group.country}`)}`,
        source: wikidataSource, established: null, areaKm2: null, visitorCount: null, memberships: [],
        warnings, wikidataPoints: group.points, wikidataRows: group.rowCount,
        biomes: [], ecoregions: [], biomeStatus: 'unavailable'
      };
    });
    const parks = [];
    const identicalPoints = new Map();
    candidates.sort((a, b) => Number(!a.countryCode) - Number(!b.countryCode) || a.id.localeCompare(b.id));
    for (const park of candidates) {
      const key = `${nameKey(park.name)}:${JSON.stringify(park.wikidataPoints)}`;
      const existing = identicalPoints.get(key);
      if (existing) {
        existing.wikidataRows += park.wikidataRows;
        existing.warnings.push(`Also listed under country label: ${park.country}; identical name and coordinate set grouped.`);
      } else {
        identicalPoints.set(key, park);
        parks.push(park);
      }
    }
    return { parks, excludedCount, duplicateRowCount: records.length - excludedCount - parks.length };
  }

  function mergeParks(curatedParks, wikidataParks) {
    const aliases = {
      'AL:fir-of-drenova': 'fir-of-drenove',
      'AL:fir-of-hotove': 'fir-of-hotova',
      'AL:shebenik-jabllanice': 'shebenik',
      'AL:theth': 'thethi',
      'IM:tynwald': 'tynwald-and-arboretum',
      'TJ:tajik': 'pamir'
    };
    const curated = curatedParks.map(p => ({ ...p, warnings: [], wikidataPoints: [] }));
    const byName = new Map();
    for (const p of curated) {
      const key = `${p.countryCode}:${nameKey(p.name)}`;
      byName.set(`${p.countryCode}:${aliases[key] || nameKey(p.name)}`, p);
      // The query assigns this overseas French park to France, not Guadeloupe.
      if (p.countryCode === 'GP' && nameKey(p.name) === 'guadeloupe') byName.set('FR:guadeloupe', p);
      if (p.countryCode === 'AC' && nameKey(p.name) === 'green-mountain') byName.set('GB:green-mountain', p);
    }
    const additions = [];
    let matchedCount = 0;
    for (const p of wikidataParks) {
      const match = byName.get(`${p.countryCode}:${nameKey(p.name)}`);
      if (!match) { additions.push(p); continue; }
      matchedCount++;
      match.wikidataPoints = p.wikidataPoints;
      match.wikidataUrl = p.url;
      match.wikidataRows = p.wikidataRows;
      match.warnings.push(...p.warnings.filter(note => note.includes('country label:')));
      if (match.lat !== null && match.lng !== null) {
        const nearest = Math.min(...p.wikidataPoints.map(point => distanceKm(match, point)));
        if (nearest > 50) match.warnings.push(`Curated and Wikidata coordinates differ by ${nearest.toFixed(1)} km; curated point retained.`);
      }
    }
    return {
      parks: [...curated, ...additions].sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name)),
      matchedCount
    };
  }

  function combineParks(curatedRecords, wikidataRecords) {
    const curated = normalizeParks(curatedRecords);
    const wikidata = normalizeWikidata(wikidataRecords);
    return { ...mergeParks(curated.parks, wikidata.parks),
      excludedCount: curated.excludedCount + wikidata.excludedCount, duplicateRowCount: wikidata.duplicateRowCount };
  }

  const api = { normalizeParks, normalizeWikidata, mergeParks, combineParks, source, wikidataSource, excludedCountries };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.InternationalParks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
