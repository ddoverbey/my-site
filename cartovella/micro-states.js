(function (root) {
  'use strict';

  // Natural Earth 1:10m admin-0 polygons for countries/territories the 1:110m Scratch Map atlas omits.
  // Raw GeoJSON is used because world-atlas's quantized 10m topology collapses Vatican City to a line.
  const SOURCE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_countries.geojson';
  const BASE_SOURCE = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json';
  // Uninhabited or military-only ISO entries are not travel destinations.
  const EXCLUDED_IDS = Object.freeze(['036', '086', '334', '581']);
  const FOG_RADIUS_KM = 30;
  const abbreviations = [
    [/\bu\.s\.\s*/g, 'us '], [/\bis\.?(?=\s|$)/g, 'islands'], [/\bi\.(?=\s|$)/g, 'island'], [/\bst(?:[.-]\s*|\s+)/g, 'saint '],
    [/\bfr\.\s*/g, 'french '], [/\bn\.\s*/g, 'northern '], [/\bs\.\s*/g, 'south '], [/\bw\.\s*/g, 'western '],
    [/\beq\.\s*/g, 'equatorial '], [/\bdem\.\s*/g, 'democratic '], [/\brep\.?(?=\s|$)/g, 'republic'],
    [/\bherz\.?(?=\s|$)/g, 'herzegovina'], [/\bbarb\.?(?=\s|$)/g, 'barbuda'], [/\bgren\.?(?=\s|$)/g, 'grenadines'],
    [/\bvin\.?(?=\s|$)/g, 'vincent'], [/\bgeo\.?(?=\s|$)/g, 'georgia'], [/\bter\.?(?=\s|$)/g, 'territory'],
    [/&/g, ' and ']
  ];
  const aliases = Object.freeze({
    Vatican: ['Vatican City', 'Holy See'], Macao: ['Macau'], 'Faeroe Is.': ['Faroe Islands'],
    'Cabo Verde': ['Cape Verde'], 'São Tomé and Principe': ['Sao Tome'], Micronesia: ['Federated States of Micronesia'],
    'St-Martin': ['Saint Martin (French)'], 'Sint Maarten': ['Saint Martin (Dutch)'], 'St-Barthélemy': ['St Barts', 'Saint Barts'],
    'Hong Kong': ['HK'], 'United States of America': ['USA', 'United States'], 'United Kingdom': ['UK', 'Great Britain'],
    'Dem. Rep. Congo': ['DRC'], eSwatini: ['Swaziland'], "Côte d'Ivoire": ['Ivory Coast'], Czechia: ['Czech Republic']
  });

  function searchText(value) {
    let text = String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    for (const [pattern, replacement] of abbreviations) text = text.replace(pattern, replacement);
    return text.replace(/[^a-z0-9]+/g, ' ').trim();
  }

  const stopWords = new Set(['the', 'and', 'of']);
  const tokens = value => searchText(value).split(' ').filter(token => token && !stopWords.has(token));

  // Every query word must prefix a word in the name or an alias, so word order and "the"/"and" are irrelevant.
  function matches(name, query) {
    const needles = tokens(query);
    if (!needles.length) return false;
    return [name, ...(aliases[name] || [])].some(candidate => {
      const words = tokens(candidate);
      return needles.every(needle => words.some(word => word.startsWith(needle)));
    });
  }

  function validateTopology(topology, decode) {
    if (topology?.type !== 'Topology' || topology.metadata?.source !== SOURCE ||
        topology.metadata.version !== 1 || !topology.objects?.microStates) throw new Error('Invalid micro-state snapshot.');
    const features = decode(topology, topology.objects.microStates).features;
    const names = new Set();
    for (const feature of features) {
      const { name, lat, lng } = feature.properties || {};
      if (typeof name !== 'string' || !name.trim() || names.has(name) || !/^\d{3}$/.test(feature.id) ||
          EXCLUDED_IDS.includes(feature.id) || !['Polygon', 'MultiPolygon'].includes(feature.geometry?.type) ||
          !Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) {
        throw new Error(`Invalid micro-state ${name || feature.id}.`);
      }
      names.add(name);
    }
    if (features.length < 60) throw new Error('Incomplete micro-state snapshot.');
    return features;
  }

  function catalog(features) {
    return features.map(feature => ({
      name: feature.properties.name, key: `c:${feature.properties.name}`, id: feature.id,
      lat: feature.properties.lat, lng: feature.properties.lng
    })).sort((a, b) => a.name.localeCompare(b.name));
  }

  const api = { SOURCE, BASE_SOURCE, EXCLUDED_IDS, FOG_RADIUS_KM, searchText, matches, validateTopology, catalog };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MicroStates = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
