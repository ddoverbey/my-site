(function (root) {
  'use strict';
  const source = 'https://github.com/RohanNagar/parksoftheworld';
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

  const api = { normalizeParks, source, excludedCountries };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.InternationalParks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
